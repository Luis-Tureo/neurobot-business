import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Logger } from 'pino';
import { ConnectionManager } from '../src/core/connection-manager.js';
import { GroupDiscoveryService } from '../src/core/group-discovery-service.js';
import {
  assertAllowedMaintenancePath,
  MaintenanceAlreadyRunningError,
  MaintenanceService,
  type MaintenanceStage,
  UnsafeMaintenancePathError,
} from '../src/core/maintenance-service.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';
import { hashPassword, verifyPassword } from '../src/security/password.js';

type Subject = ReturnType<typeof createSubject>;

describe('mantenimiento destructivo sin sesiones de WhatsApp Web', () => {
  const subjects: Subject[] = [];

  afterEach(() => {
    for (const subject of subjects.splice(0)) {
      if (subject.database.isOpen()) subject.database.close();
      rmSync(subject.projectRoot, { recursive: true, force: true });
    }
  });

  it('restablece SQLite sin crear respaldos ni tocar configuración del proyecto', async () => {
    const subject = createSubject();
    subjects.push(subject);
    const newHash = await hashPassword('contraseña-nueva-segura');

    subject.service.startFactoryReset({
      passwordHash: newHash,
      administratorHash: 'administrador-anónimo',
    });
    const result = await subject.service.waitForCompletion();

    expect(result).toMatchObject({
      result: 'completed',
      code: 'FACTORY_RESET_COMPLETED',
      logoutRequired: true,
    });
    expect(subject.database.isOpen()).toBe(true);
    expect(subject.database.listGroups()).toHaveLength(0);
    expect(subject.database.listAdministrators()).toHaveLength(0);
    expect(subject.database.getCommand('personalizado')).toBeNull();
    expect(subject.database.getBot('neurobot')?.connectorType).toBe('WHATSAPP_CLOUD_API');
    expect(
      await verifyPassword(
        'contraseña-nueva-segura',
        subject.database.getPanelPasswordHash() ?? '',
      ),
    ).toBe(true);
    expect(subject.client.destroyCalls).toBe(1);
    expect(subject.client.initializeCalls).toBe(1);
    expect(subject.transientReset).toHaveBeenCalledOnce();
    expect(existsSync(join(subject.projectRoot, 'backups'))).toBe(false);
    expect(existsSync(subject.legacyDatabasePath)).toBe(false);
    expect(readFileSync(join(subject.projectRoot, '.env'), 'utf8')).toBe('SECRETO=conservado');
    expect(readFileSync(join(subject.projectRoot, 'package.json'), 'utf8')).toBe('{}');
  });

  it('recupera una base nueva cuando una etapa posterior falla', async () => {
    const subject = createSubject({
      beforeStage: (stage) => {
        if (stage === 'creating_database') throw new Error('fallo de creación simulado');
      },
    });
    subjects.push(subject);
    subject.service.startFactoryReset({
      passwordHash: await hashPassword('contraseña-nueva-segura'),
      administratorHash: 'administrador-anónimo',
    });
    const result = await subject.service.waitForCompletion();
    expect(result).toMatchObject({ result: 'failed', code: 'RESET_DATABASE_CREATE_FAILED' });
    expect(subject.database.isOpen()).toBe(true);
    expect(subject.database.getCommand('personalizado')).toBeNull();
  });

  it('impide dos restablecimientos simultáneos', async () => {
    let releaseStage: () => void = () => undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      releaseStage = resolvePromise;
    });
    const subject = createSubject({
      beforeStage: async (stage) => {
        if (stage === 'stopping_messaging') await blocked;
      },
    });
    subjects.push(subject);
    const input = {
      passwordHash: await hashPassword('contraseña-nueva-segura'),
      administratorHash: 'administrador-anónimo',
    };
    subject.service.startFactoryReset(input);
    expect(() => subject.service.startFactoryReset(input)).toThrow(MaintenanceAlreadyRunningError);
    releaseStage();
    await subject.service.waitForCompletion();
  });

  it('valida rutas permitidas y rechaza destinos externos', () => {
    const projectRoot = resolve('C:\\proyecto-seguro');
    expect(() =>
      assertAllowedMaintenancePath(
        projectRoot,
        join(projectRoot, 'data', 'asistente.db'),
        join(projectRoot, 'data'),
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowedMaintenancePath(projectRoot, resolve('C:\\fuera', 'datos.db'), projectRoot),
    ).toThrow(UnsafeMaintenancePathError);
  });

  it('no filtra contraseñas ni identificadores en estados o registros', async () => {
    const subject = createSubject();
    subjects.push(subject);
    subject.service.startFactoryReset({
      passwordHash: await hashPassword('contraseña-nueva-segura'),
      administratorHash: 'administrador-anónimo',
    });
    await subject.service.waitForCompletion();
    expect(JSON.stringify(subject.service.snapshot())).not.toContain('contraseña-nueva-segura');
    expect(JSON.stringify(subject.logEntries)).not.toContain('56912345678');
  });
});

function createSubject(
  options: { beforeStage?: (stage: MaintenanceStage) => void | Promise<void> } = {},
) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'neurobot-maintenance-'));
  const dataRoot = join(projectRoot, 'data');
  const databasePath = join(dataRoot, 'asistente.db');
  const legacyDatabasePath = join(dataRoot, 'anterior.sqlite3');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, '.env'), 'SECRETO=conservado');
  writeFileSync(join(projectRoot, 'package.json'), '{}');

  const database = new AppDatabase(databasePath);
  database.migrate();
  database.setPanelPasswordHash('hash-inicial');
  database.upsertDetectedGroup('grupo-secreto@g.us', 'Grupo secreto');
  database.setGroupAuthorized('grupo-secreto@g.us', true);
  database.addAdministrator('56912345678@c.us');
  database.saveCommand({
    name: 'personalizado',
    response: 'Respuesta configurada',
    enabled: true,
    priority: 1,
    healthRelated: false,
  });
  database.checkpoint();
  writeFileSync(legacyDatabasePath, 'base-anterior');

  const { logger, entries: logEntries } = createCapturedLogger();
  const transientReset = vi.fn();
  const client = new SimulatedMessagingClient();
  const manager = new ConnectionManager(client, logger, { maxAttempts: 1, maxDelayMs: 10 });
  const discovery = new GroupDiscoveryService(
    client,
    database,
    logger,
    {
      onLoading: () => manager.updateState('loading_chats'),
      onLoaded: () => manager.updateState('connected'),
      onFailure: (code) => manager.updateState('loading_chats', code),
    },
    { developmentMode: false, readyRetryDelaysMs: [0] },
  );
  const service = new MaintenanceService(
    database,
    manager,
    discovery,
    new Anonymizer('a'.repeat(32)),
    logger,
    {
      projectRoot,
      databasePath,
      now: () => new Date('2026-08-02T03:04:05.000Z'),
      resetTransientState: transientReset,
      ...(options.beforeStage === undefined ? {} : { beforeStage: options.beforeStage }),
    },
  );
  return {
    projectRoot,
    legacyDatabasePath,
    database,
    client,
    manager,
    service,
    transientReset,
    logEntries,
  };
}

function createCapturedLogger(): { logger: Logger; entries: unknown[] } {
  const entries: unknown[] = [];
  const method = (first: unknown, second?: unknown): void => {
    entries.push([first, second]);
  };
  return {
    logger: {
      trace: method,
      debug: method,
      info: method,
      warn: method,
      error: method,
      fatal: method,
    } as unknown as Logger,
    entries,
  };
}
