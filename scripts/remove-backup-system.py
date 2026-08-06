from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str, optional: bool = False) -> str:
    count = text.count(old)
    if count == 0 and optional:
        return text
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def remove_method(text: str, marker: str, label: str, optional: bool = False) -> str:
    start = text.find(marker)
    if start < 0:
        if optional:
            return text
        raise RuntimeError(f"{label}: method marker not found")
    brace = text.find("{", start)
    if brace < 0:
        raise RuntimeError(f"{label}: opening brace not found")
    depth = 0
    i = brace
    in_string: str | None = None
    escaped = False
    in_line_comment = False
    in_block_comment = False
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
        elif in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 1
        elif in_string is not None:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == in_string:
                in_string = None
        else:
            if ch == "/" and nxt == "/":
                in_line_comment = True
                i += 1
            elif ch == "/" and nxt == "*":
                in_block_comment = True
                i += 1
            elif ch in ("'", '"', "`"):
                in_string = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    while end < len(text) and text[end] in " \t":
                        end += 1
                    if end < len(text) and text[end] == "\n":
                        end += 1
                    return text[:start] + text[end:]
        i += 1
    raise RuntimeError(f"{label}: closing brace not found")


MAINTENANCE_SERVICE = r"""import { randomBytes } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Logger } from 'pino';
import { serializeError } from '../infrastructure/safe-error.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import type { ConnectionManager } from './connection-manager.js';
import type { GroupDiscoveryService } from './group-discovery-service.js';

export type MaintenanceOperation = 'factory_reset' | 'unlink_whatsapp';
export type MaintenanceResult = 'running' | 'completed' | 'failed';
export type MaintenanceStage =
  | 'idle'
  | 'verifying_authorization'
  | 'stopping_whatsapp'
  | 'closing_database'
  | 'deleting_previous_state'
  | 'creating_database'
  | 'restoring_defaults'
  | 'restarting_services'
  | 'waiting_qr'
  | 'finished';

export type MaintenanceSnapshot = {
  operationId: string | null;
  operation: MaintenanceOperation | null;
  result: MaintenanceResult | 'idle';
  stage: MaintenanceStage;
  code: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  logoutRequired: boolean;
};

export type MaintenanceServiceOptions = {
  projectRoot: string;
  databasePath: string;
  sessionPath: string;
  cachePath?: string;
  now?: () => Date;
  beforeStage?: (stage: MaintenanceStage) => void | Promise<void>;
  resetTransientState?: () => void;
};

type FactoryResetInput = {
  passwordHash: string;
  administratorHash: string;
};

type UnlinkInput = {
  administratorHash: string;
};

const DATABASE_PATTERN = /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/iu;

export class MaintenanceAlreadyRunningError extends Error {
  public readonly code = 'RESET_ALREADY_RUNNING';

  public constructor() {
    super('Ya existe una operación de mantenimiento en curso.');
    this.name = 'MaintenanceAlreadyRunningError';
  }
}

export class UnsafeMaintenancePathError extends Error {
  public readonly code = 'RESET_PATH_OUTSIDE_PROJECT';

  public constructor() {
    super('La configuración contiene una ruta de mantenimiento no permitida.');
    this.name = 'UnsafeMaintenancePathError';
  }
}

export class MaintenanceService {
  private readonly projectRoot: string;
  private readonly dataRoot: string;
  private readonly databasePath: string;
  private readonly sessionPath: string;
  private readonly cachePath: string;
  private readonly temporaryRoots: string[];
  private readonly now: () => Date;
  private current: MaintenanceSnapshot = emptySnapshot();
  private activeOperation: Promise<void> | null = null;

  public constructor(
    private readonly database: AppDatabase,
    private readonly connectionManager: ConnectionManager,
    private readonly groupDiscovery: GroupDiscoveryService,
    anonymizer: Anonymizer,
    private readonly logger: Logger,
    private readonly options: MaintenanceServiceOptions,
  ) {
    void anonymizer;
    this.projectRoot = resolve(options.projectRoot);
    this.dataRoot = resolve(this.projectRoot, 'data');
    this.databasePath = resolve(options.databasePath);
    this.sessionPath = resolve(options.sessionPath);
    this.cachePath = resolve(options.cachePath ?? join(this.projectRoot, '.wwebjs_cache'));
    this.temporaryRoots = [
      resolve(this.projectRoot, 'logs'),
      resolve(this.projectRoot, 'tmp'),
      resolve(this.projectRoot, 'temp'),
    ];
    this.now = options.now ?? (() => new Date());
    this.validateConfiguredPaths();
  }

  public isRunning(): boolean {
    return this.activeOperation !== null;
  }

  public snapshot(): MaintenanceSnapshot {
    return { ...this.current };
  }

  public startFactoryReset(input: FactoryResetInput): string {
    this.assertAvailable();
    const operationId = randomBytes(12).toString('hex');
    this.current = this.startedSnapshot(operationId, 'factory_reset', true);
    this.recordAudit('factory_reset', 'started', input.administratorHash, 0);
    this.activeOperation = this.runFactoryReset(input).finally(() => {
      this.activeOperation = null;
    });
    return operationId;
  }

  public startWhatsAppUnlink(input: UnlinkInput): string {
    this.assertAvailable();
    const operationId = randomBytes(12).toString('hex');
    this.current = this.startedSnapshot(operationId, 'unlink_whatsapp', false);
    this.recordAudit('whatsapp_unlink', 'started', input.administratorHash, 0);
    this.activeOperation = this.runWhatsAppUnlink(input).finally(() => {
      this.activeOperation = null;
    });
    return operationId;
  }

  public async waitForCompletion(): Promise<MaintenanceSnapshot> {
    await this.activeOperation;
    return this.snapshot();
  }

  private async runFactoryReset(input: FactoryResetInput): Promise<void> {
    const startedAt = Date.now();
    let databaseClosed = false;

    try {
      await this.changeStage('stopping_whatsapp', 'FACTORY_RESET_STARTED');
      this.groupDiscovery.cancel();
      this.connectionManager.updateState('resetting');
      await this.connectionManager.stop();
      this.connectionManager.updateState('resetting');

      await this.changeStage('closing_database', 'FACTORY_RESET_STARTED');
      this.database.checkpoint();
      this.database.close();
      databaseClosed = true;

      await this.changeStage('deleting_previous_state', 'FACTORY_RESET_STARTED');
      await this.deleteFactoryResetTargets();

      await this.changeStage('creating_database', 'FACTORY_RESET_STARTED');
      this.database.reopen();
      databaseClosed = false;
      this.database.migrate();
      this.database.setPanelPasswordHash(input.passwordHash);

      await this.changeStage('restoring_defaults', 'FACTORY_RESET_STARTED');
      this.assertFactoryDefaults();
      this.options.resetTransientState?.();

      await this.changeStage('restarting_services', 'FACTORY_RESET_STARTED');
      await this.restartWhatsAppAfterMaintenance();

      await this.changeStage('waiting_qr', 'FACTORY_RESET_STARTED');
      this.connectionManager.updateState('waiting_qr');
      this.finish('completed', 'FACTORY_RESET_COMPLETED');
      this.recordAudit(
        'factory_reset',
        'completed',
        input.administratorHash,
        Date.now() - startedAt,
      );
    } catch (error) {
      const failureCode = factoryFailureCode(this.current.stage, error);
      this.logFailure(error, failureCode);
      await this.recoverStoppedServices(databaseClosed);
      this.finish('failed', failureCode);
      this.recordAudit(
        'factory_reset',
        'failed',
        input.administratorHash,
        Date.now() - startedAt,
        failureCode,
      );
    }
  }

  private async runWhatsAppUnlink(input: UnlinkInput): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.changeStage('stopping_whatsapp', 'WHATSAPP_UNLINK_STARTED');
      this.groupDiscovery.cancel();
      this.connectionManager.updateState('resetting');
      await this.connectionManager.stop();
      this.connectionManager.updateState('resetting');

      await this.changeStage('deleting_previous_state', 'WHATSAPP_UNLINK_STARTED');
      await this.deleteWhatsAppState();

      await this.changeStage('restarting_services', 'WHATSAPP_UNLINK_STARTED');
      await this.restartWhatsAppAfterMaintenance();

      await this.changeStage('waiting_qr', 'WHATSAPP_UNLINK_STARTED');
      this.connectionManager.updateState('waiting_qr');
      this.finish('completed', 'WHATSAPP_UNLINK_COMPLETED');
      this.recordAudit(
        'whatsapp_unlink',
        'completed',
        input.administratorHash,
        Date.now() - startedAt,
      );
    } catch (error) {
      const code = 'WHATSAPP_UNLINK_FAILED';
      this.logFailure(error, code);
      await this.recoverStoppedServices(false);
      this.finish('failed', code);
      this.recordAudit(
        'whatsapp_unlink',
        'failed',
        input.administratorHash,
        Date.now() - startedAt,
        code,
      );
    }
  }

  private async deleteFactoryResetTargets(): Promise<void> {
    await this.deleteWhatsAppState();
    const databaseFiles = await this.listDatabaseFiles();
    for (const path of databaseFiles) {
      assertAllowedMaintenancePath(this.projectRoot, path, this.dataRoot);
      await rm(path, { force: true });
    }
    for (const root of this.temporaryRoots) {
      assertAllowedMaintenancePath(this.projectRoot, root, root);
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });
    }
    await mkdir(dirname(this.databasePath), { recursive: true });
  }

  private async deleteWhatsAppState(): Promise<void> {
    assertAllowedMaintenancePath(this.projectRoot, this.sessionPath, this.dataRoot);
    assertAllowedMaintenancePath(this.projectRoot, this.cachePath, this.cachePath);
    await rm(this.sessionPath, { recursive: true, force: true });
    await rm(this.cachePath, { recursive: true, force: true });
    await mkdir(this.sessionPath, { recursive: true });
    await mkdir(this.cachePath, { recursive: true });
  }

  private async restartWhatsAppAfterMaintenance(): Promise<void> {
    await this.connectionManager.start();
    const state = this.connectionManager.snapshot().state;
    if (state === 'disconnected' || state === 'auth_failure' || state === 'reconnecting') {
      throw new Error('No fue posible iniciar WhatsApp. Intente reiniciar la conexión.');
    }
    if (state === 'initializing' || state === 'resetting') {
      this.connectionManager.updateState('waiting_qr');
    }
  }

  private async recoverStoppedServices(databaseClosed: boolean): Promise<void> {
    try {
      await this.connectionManager.stop();
      if (databaseClosed && !this.database.isOpen()) {
        this.database.reopen();
        this.database.migrate();
      }
      await this.restartWhatsAppAfterMaintenance();
    } catch (error) {
      this.logFailure(error, 'RESET_RECOVERY_FAILED');
    }
  }

  private assertFactoryDefaults(): void {
    if (!this.database.getSetting('bot_enabled', false)) {
      throw new Error('No se restauró la configuración predeterminada del bot.');
    }
    if (this.database.listGroups().length !== 0 || this.database.getAdministratorCount() !== 0) {
      throw new Error('La base de datos nueva contiene autorizaciones anteriores.');
    }
    if (this.database.listCommands().length === 0) {
      throw new Error('No se restauraron los comandos predeterminados.');
    }
  }

  private listDatabaseFiles(): Promise<string[]> {
    return listFiles(
      this.dataRoot,
      (path) => DATABASE_PATTERN.test(path) && !isInside(this.sessionPath, path),
    );
  }

  private validateConfiguredPaths(): void {
    if (!DATABASE_PATTERN.test(this.databasePath) || this.database.getPath() !== this.databasePath) {
      throw new UnsafeMaintenancePathError();
    }
    assertAllowedMaintenancePath(this.projectRoot, this.dataRoot, this.projectRoot);
    assertAllowedMaintenancePath(this.projectRoot, this.databasePath, this.dataRoot);
    assertAllowedMaintenancePath(this.projectRoot, this.sessionPath, this.dataRoot);
    assertAllowedMaintenancePath(
      this.projectRoot,
      this.cachePath,
      resolve(this.projectRoot, '.wwebjs_cache'),
    );
    assertNoSymbolicLinks(this.projectRoot, this.databasePath);
    assertNoSymbolicLinks(this.projectRoot, this.sessionPath);
    assertNoSymbolicLinks(this.projectRoot, this.cachePath);
    for (const root of this.temporaryRoots) {
      assertAllowedMaintenancePath(this.projectRoot, root, this.projectRoot);
    }
  }

  private assertAvailable(): void {
    if (this.activeOperation !== null) throw new MaintenanceAlreadyRunningError();
  }

  private startedSnapshot(
    operationId: string,
    operation: MaintenanceOperation,
    logoutRequired: boolean,
  ): MaintenanceSnapshot {
    return {
      operationId,
      operation,
      result: 'running',
      stage: 'verifying_authorization',
      code: operation === 'factory_reset' ? 'FACTORY_RESET_STARTED' : 'WHATSAPP_UNLINK_STARTED',
      startedAt: this.now().toISOString(),
      finishedAt: null,
      logoutRequired,
    };
  }

  private async changeStage(stage: MaintenanceStage, code: string): Promise<void> {
    this.current = { ...this.current, stage, code };
    await this.options.beforeStage?.(stage);
    this.logger.info(
      {
        operation: 'maintenanceStage',
        maintenanceOperation: this.current.operation,
        operationId: this.current.operationId,
        stage,
        code,
      },
      'Etapa de mantenimiento actualizada',
    );
  }

  private finish(result: Exclude<MaintenanceResult, 'running'>, code: string): void {
    this.current = {
      ...this.current,
      result,
      stage: 'finished',
      code,
      finishedAt: this.now().toISOString(),
    };
  }

  private recordAudit(
    actionType: string,
    result: string,
    administratorHash: string,
    durationMs: number,
    errorCode?: string,
  ): void {
    try {
      if (!this.database.isOpen()) return;
      this.database.recordAudit({
        actionType,
        resource: 'maintenance',
        result,
        administratorHash,
        durationMs,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
    } catch (error) {
      this.logFailure(error, 'MAINTENANCE_AUDIT_FAILED');
    }
  }

  private logFailure(error: unknown, code: string): void {
    this.logger.error(
      {
        ...serializeError(error, code, false),
        operation: 'maintenanceFailure',
        maintenanceOperation: this.current.operation,
        operationId: this.current.operationId,
        stage: this.current.stage,
      },
      'Falló una operación de mantenimiento',
    );
  }
}

export function assertAllowedMaintenancePath(
  projectRoot: string,
  candidatePath: string,
  allowedRoot: string,
): void {
  const project = resolve(projectRoot);
  const candidate = resolve(candidatePath);
  const allowed = resolve(allowedRoot);
  if (!isInside(project, allowed) || !isInside(project, candidate) || !isInside(allowed, candidate)) {
    throw new UnsafeMaintenancePathError();
  }
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function assertNoSymbolicLinks(projectRoot: string, candidatePath: string): void {
  const project = resolve(projectRoot);
  const candidate = resolve(candidatePath);
  let current = project;
  for (const part of relative(project, candidate)
    .split(/[\\/]+/u)
    .filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new UnsafeMaintenancePathError();
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }
}

async function listFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && predicate(path)) files.push(path);
    }
  }
  return files.sort();
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    Reflect.get(error, 'code') === 'ENOENT'
  );
}

function factoryFailureCode(stage: MaintenanceStage, error: unknown): string {
  if (error instanceof UnsafeMaintenancePathError) return error.code;
  const byStage: Partial<Record<MaintenanceStage, string>> = {
    stopping_whatsapp: 'RESET_WHATSAPP_STOP_FAILED',
    closing_database: 'RESET_DATABASE_CLOSE_FAILED',
    deleting_previous_state: 'RESET_SESSION_DELETE_FAILED',
    creating_database: 'RESET_DATABASE_CREATE_FAILED',
    restoring_defaults: 'RESET_DATABASE_CREATE_FAILED',
    restarting_services: 'RESET_WHATSAPP_RESTART_FAILED',
    waiting_qr: 'RESET_WHATSAPP_RESTART_FAILED',
  };
  return byStage[stage] ?? 'FACTORY_RESET_FAILED';
}

function emptySnapshot(): MaintenanceSnapshot {
  return {
    operationId: null,
    operation: null,
    result: 'idle',
    stage: 'idle',
    code: null,
    startedAt: null,
    finishedAt: null,
    logoutRequired: false,
  };
}
"""

SESSION_MANAGER = r"""import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BotRecord } from '../domain/types.js';

export class WhatsAppSessionManager {
  public constructor(private readonly sessionsRoot: string) {}

  public async pathFor(bot: BotRecord): Promise<string> {
    const path = resolve(bot.sessionPath);
    await mkdir(path, { recursive: true });
    return path;
  }

  public newBotPath(botId: string): string {
    if (!/^[a-z][a-z0-9-]{2,39}$/u.test(botId)) throw new Error('Identificador de bot inválido.');
    return resolve(this.sessionsRoot, botId);
  }

  public async clear(bot: BotRecord): Promise<void> {
    const path = resolve(bot.sessionPath);
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true });
  }
}
"""

MAINTENANCE_TEST = r"""import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

describe('mantenimiento destructivo sin respaldos', () => {
  const subjects: Subject[] = [];

  afterEach(() => {
    for (const subject of subjects.splice(0)) {
      if (subject.database.isOpen()) subject.database.close();
      rmSync(subject.projectRoot, { recursive: true, force: true });
    }
  });

  it('restablece SQLite y WhatsApp sin crear carpetas de respaldo', async () => {
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
    expect(subject.database.listCommands().length).toBeGreaterThan(0);
    expect(subject.database.getSetting('bot_enabled', false)).toBe(true);
    expect(
      await verifyPassword(
        'contraseña-nueva-segura',
        subject.database.getPanelPasswordHash() ?? '',
      ),
    ).toBe(true);
    expect(subject.client.destroyCalls).toBe(1);
    expect(subject.client.initializeCalls).toBe(1);
    expect(subject.manager.snapshot().state).toBe('waiting_qr');
    expect(subject.transientReset).toHaveBeenCalledOnce();
    expect(existsSync(join(subject.projectRoot, 'backups'))).toBe(false);
    expect(existsSync(subject.legacyDatabasePath)).toBe(false);
    expect(existsSync(`${subject.legacyDatabasePath}-wal`)).toBe(false);
    expect(readFileSync(join(subject.projectRoot, '.env'), 'utf8')).toBe('SECRETO=conservado');
    expect(readFileSync(join(subject.projectRoot, 'package.json'), 'utf8')).toBe('{}');
    expect(readFileSync(join(subject.projectRoot, 'src', 'sentinel.ts'), 'utf8')).toBe(
      'export {};',
    );
  });

  it('no reconstruye el estado anterior cuando una etapa posterior falla', async () => {
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
    expect(subject.database.isGroupAuthorized('grupo-secreto@g.us')).toBe(false);
    expect(subject.database.isAdministrator('56912345678@c.us')).toBe(false);
    expect(existsSync(join(subject.projectRoot, 'backups'))).toBe(false);
  });

  it('desvincula WhatsApp sin modificar SQLite ni otros archivos del proyecto', async () => {
    const subject = createSubject();
    subjects.push(subject);

    subject.service.startWhatsAppUnlink({ administratorHash: 'administrador-anónimo' });
    const result = await subject.service.waitForCompletion();

    expect(result).toMatchObject({
      result: 'completed',
      code: 'WHATSAPP_UNLINK_COMPLETED',
      logoutRequired: false,
    });
    expect(subject.database.isGroupAuthorized('grupo-secreto@g.us')).toBe(true);
    expect(subject.database.isAdministrator('56912345678@c.us')).toBe(true);
    expect(subject.database.getCommand('personalizado')).not.toBeNull();
    expect(findFiles(subject.sessionPath)).toHaveLength(0);
    expect(findFiles(subject.cachePath)).toHaveLength(0);
    expect(existsSync(join(subject.projectRoot, 'backups'))).toBe(false);
  });

  it('impide dos operaciones simultáneas', async () => {
    let releaseStage: () => void = () => undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      releaseStage = resolvePromise;
    });
    const subject = createSubject({
      beforeStage: async (stage) => {
        if (stage === 'stopping_whatsapp') await blocked;
      },
    });
    subjects.push(subject);
    subject.service.startWhatsAppUnlink({ administratorHash: 'administrador-anónimo' });
    expect(() =>
      subject.service.startWhatsAppUnlink({ administratorHash: 'administrador-anónimo' }),
    ).toThrow(MaintenanceAlreadyRunningError);
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
    const logs = JSON.stringify(subject.logEntries);
    expect(logs).not.toContain('56912345678');
    expect(logs).not.toContain('grupo-secreto@g.us');
    expect(logs).not.toContain('credencial-de-sesion');
  });
});

function createSubject(
  options: {
    beforeStage?: (stage: MaintenanceStage) => void | Promise<void>;
  } = {},
) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'neurobot-maintenance-'));
  const dataRoot = join(projectRoot, 'data');
  const databasePath = join(dataRoot, 'asistente.db');
  const legacyDatabasePath = join(dataRoot, 'anterior.sqlite3');
  const sessionPath = join(dataRoot, 'whatsapp-session');
  const cachePath = join(projectRoot, '.wwebjs_cache');
  mkdirSync(sessionPath, { recursive: true });
  mkdirSync(cachePath, { recursive: true });
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(sessionPath, 'session.bin'), 'credencial-de-sesion');
  writeFileSync(join(cachePath, 'cache.bin'), 'cache');
  writeFileSync(join(projectRoot, '.env'), 'SECRETO=conservado');
  writeFileSync(join(projectRoot, 'package.json'), '{}');
  writeFileSync(join(projectRoot, 'src', 'sentinel.ts'), 'export {};');

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
  writeFileSync(`${legacyDatabasePath}-wal`, 'wal-anterior');

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
      sessionPath,
      cachePath,
      now: () => new Date('2026-08-02T03:04:05.000Z'),
      resetTransientState: transientReset,
      ...(options.beforeStage === undefined ? {} : { beforeStage: options.beforeStage }),
    },
  );
  return {
    projectRoot,
    databasePath,
    legacyDatabasePath,
    sessionPath,
    cachePath,
    database,
    client,
    manager,
    discovery,
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

function findFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}
"""

NO_BACKUP_TEST = r"""import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

describe('límite arquitectónico sin respaldos automáticos', () => {
  it('no conserva implementaciones activas de respaldo en src ni public', () => {
    const root = process.cwd();
    const files = [...collect(join(root, 'src')), ...collect(join(root, 'public'))];
    const failures: string[] = [];

    for (const file of files) {
      const relativePath = relative(root, file).replaceAll('\\', '/');
      const content = readFileSync(file, 'utf8');
      if (relativePath === 'src/persistence/database.ts') {
        for (const forbidden of [
          'public async backupTo',
          'public backupAssistantProfile',
          'event.backupCreated',
        ]) {
          if (content.includes(forbidden)) failures.push(`${relativePath}: ${forbidden}`);
        }
        continue;
      }
      for (const forbidden of [
        'creating_backup',
        'restoring_backup',
        'backupCreated',
        'backupName',
        "join(process.cwd(), 'backups'",
        '.archive(bot',
        'respaldo final de seguridad',
      ]) {
        if (content.includes(forbidden)) failures.push(`${relativePath}: ${forbidden}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

function collect(root: string): string[] {
  const output: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (['.ts', '.js', '.html'].includes(extname(path))) output.push(path);
    }
  }
  return output;
}
"""


def rewrite_index() -> None:
    path = "src/index.ts"
    text = read(path)
    old = """  const sessionManager = new WhatsAppSessionManager(
    resolve(process.cwd(), 'data', 'whatsapp-sessions'),
    resolve(process.cwd(), 'backups', 'sessions'),
  );"""
    new = """  const sessionManager = new WhatsAppSessionManager(
    resolve(process.cwd(), 'data', 'whatsapp-sessions'),
  );"""
    text = replace_once(text, old, new, f"{path}: session manager")
    text = text.replace("      encryptionSecret: environment.panelSessionSecret,\n", "")
    write(path, text)


def rewrite_server() -> None:
    path = "src/admin/server.ts"
    text = read(path)

    marker = "      await context.multiBotManager?.stop(botId);\n      const backupRoot = join("
    start = text.find(marker)
    if start < 0:
        raise RuntimeError(f"{path}: permanent deletion backup block not found")
    end_marker = "      return { deleted: true, backupCreated: true };"
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{path}: permanent deletion return not found")
    end += len(end_marker)
    replacement = """      await context.multiBotManager?.stop(botId);
      if (context.sessionManager !== undefined) {
        await context.sessionManager.clear(bot);
      }
      context.database.permanentlyDeleteBot(
        botId,
        context.anonymizer.identifier(session.username),
      );
      context.multiBotManager?.forgetAdminPhoneNumber(botId);
      audit(context, 'assistant_permanently_deleted', botId, 'ok', botId);
      return { deleted: true };"""
    text = text[:start] + replacement + text[end:]

    transfer_marker = """      const backupRoot = join(
        dirname(context.database.getPath()),
        'backups',
        'configuration-transfers',
      );"""
    transfer_start = text.find(transfer_marker)
    if transfer_start >= 0:
        result_marker = (
            "      const result = context.database.transferCommercialConfigurationToNeurobot("
        )
        result_start = text.find(result_marker, transfer_start)
        if result_start < 0:
            raise RuntimeError(f"{path}: transfer result marker not found")
        text = text[:transfer_start] + text[result_start:]

    old_unlink = """      const backupPath = await context.sessionManager.archive(bot);
      context.database.updateBotWhatsAppStatus(botId, 'disconnected');
      await context.multiBotManager.start(botId);
      audit(context, 'bot_unlink', botId, 'ok', botId);
      return { unlinked: true, backupCreated: true, backupName: basename(backupPath) };"""
    new_unlink = """      await context.sessionManager.clear(bot);
      context.database.updateBotWhatsAppStatus(botId, 'disconnected');
      await context.multiBotManager.start(botId);
      audit(context, 'bot_unlink', botId, 'ok', botId);
      return { unlinked: true };"""
    text = replace_once(text, old_unlink, new_unlink, f"{path}: unlink backup")

    old_profile = """      const backupId = context.database.backupAssistantProfile(id, `Plantilla ${input.preset}`);
      const profile = context.database.saveAssistantProfile(
        applyProfilePreset(existing, input.preset),
      );
      audit(context, 'profile_template_apply', String(id), 'ok');
      return { profile, backupCreated: true, backupId };"""
    new_profile = """      const profile = context.database.saveAssistantProfile(
        applyProfilePreset(existing, input.preset),
      );
      audit(context, 'profile_template_apply', String(id), 'ok');
      return { profile };"""
    text = replace_once(text, old_profile, new_profile, f"{path}: profile backup")

    write(path, text)


def rewrite_database() -> None:
    path = "src/persistence/database.ts"
    text = read(path)
    text = text.replace("  backupCreated?: boolean;\n", "")
    text, count = re.subn(
        r"public permanentlyDeleteBot\(\s*botId: string,\s*actorHash: string,\s*backupReference: string,\s*\): void",
        "public permanentlyDeleteBot(botId: string, actorHash: string): void",
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError(f"{path}: permanentlyDeleteBot signature count={count}")
    text = text.replace(
        ".run(botId, now, actorHash, backupReference);",
        ".run(botId, now, actorHash, null);",
        1,
    )
    text = remove_method(text, "  public async backupTo(", f"{path}: backupTo")
    text = remove_method(
        text,
        "  public backupAssistantProfile(",
        f"{path}: backupAssistantProfile",
    )

    record_replacement = """  public recordAudit(event: AuditEvent): void {
    this.db
      .prepare(
        `INSERT INTO audit_events
          (created_at, action_type, resource, result, administrator_hash, duration_ms, error_code, bot_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        event.actionType,
        event.resource,
        event.result,
        event.administratorHash,
        event.durationMs ?? null,
        event.errorCode ?? null,
        event.botId ?? null,
      );
  }
"""
    text = remove_method(text, "  public recordAudit(event: AuditEvent): void {", f"{path}: recordAudit")
    insert_at = text.find("  public close(): void")
    if insert_at < 0:
        raise RuntimeError(f"{path}: close method not found after recordAudit removal")
    text = text[:insert_at] + record_replacement + "\n" + text[insert_at:]

    migration_loop = text.find("    for (const migration of migrations)")
    if migration_loop < 0:
        raise RuntimeError(f"{path}: migration loop not found")
    array_end = text.rfind("    ];", 0, migration_loop)
    if array_end < 0:
        raise RuntimeError(f"{path}: migrations array end not found")
    if "DROP TABLE IF EXISTS assistant_profile_backups;" not in text:
        versions = [int(value) for value in re.findall(r"\bversion:\s*(\d+)", text[:migration_loop])]
        next_version = max(versions) + 1
        cleanup = f"""      {{
        version: {next_version},
        sql: `
          DROP TABLE IF EXISTS assistant_profile_backups;
        `,
      }},
"""
        text = text[:array_end] + cleanup + text[array_end:]

    write(path, text)


def rewrite_tests() -> None:
    write("tests/maintenance-service.test.ts", MAINTENANCE_TEST)
    api_test = read("tests/maintenance-api.test.ts")
    api_test = api_test.replace("    encryptionSecret: 'e'.repeat(32),\n", "")
    write("tests/maintenance-api.test.ts", api_test)

    for path in (ROOT / "tests").glob("*.ts"):
        text = path.read_text(encoding="utf-8")
        text = text.replace(".archive(bot)", ".clear(bot)")
        text = re.sub(
            r"new WhatsAppSessionManager\(([^,\n]+),\s*[^)\n]+\)",
            r"new WhatsAppSessionManager(\1)",
            text,
        )
        path.write_text(text, encoding="utf-8")

    write("tests/no-backup-system.test.ts", NO_BACKUP_TEST)


def clean_visible_text() -> None:
    replacements = {
        "Asistente eliminado. Se creó un respaldo final de seguridad.": "Asistente eliminado definitivamente.",
        "Se creó un respaldo final de seguridad.": "La eliminación terminó correctamente.",
    }
    for root_name in ("public", "README.md", "docs"):
        root = ROOT / root_name
        paths: list[Path]
        if root.is_file():
            paths = [root]
        elif root.is_dir():
            paths = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in {".md", ".js", ".html", ".css"}]
        else:
            continue
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for old, new in replacements.items():
                text = text.replace(old, new)
            path.write_text(text, encoding="utf-8")

    gitignore = ROOT / ".gitignore"
    if gitignore.exists():
        lines = gitignore.read_text(encoding="utf-8").splitlines()
        lines = [line for line in lines if line.strip().rstrip("/") != "backups"]
        gitignore.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    write("src/core/maintenance-service.ts", MAINTENANCE_SERVICE)
    write("src/core/whatsapp-session-manager.ts", SESSION_MANAGER)
    rewrite_index()
    rewrite_server()
    rewrite_database()
    rewrite_tests()
    clean_visible_text()
    print("Backup system removal transformation completed.")


if __name__ == "__main__":
    main()
