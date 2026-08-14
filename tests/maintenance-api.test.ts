import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { buildAdminServer } from '../src/admin/server.js';
import { MaintenanceService, type MaintenanceStage } from '../src/core/maintenance-service.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';
import { hashPassword } from '../src/security/password.js';

const CURRENT_PASSWORD = 'contraseña-de-prueba';
type Authentication = { cookie: string; csrf: string };
type ApiSubject = Awaited<ReturnType<typeof createApiSubject>>;

describe('API de mantenimiento', () => {
  const subjects: ApiSubject[] = [];

  afterEach(async () => {
    for (const subject of subjects.splice(0)) {
      await subject.app.close();
      if (subject.database.isOpen()) subject.database.close();
      rmSync(subject.projectRoot, { recursive: true, force: true });
    }
  });

  it('protege el restablecimiento con sesión, CSRF, frase y contraseña', async () => {
    const subject = await createApiSubject();
    subjects.push(subject);
    expect(
      (
        await subject.app.inject({
          method: 'POST',
          url: '/api/admin/maintenance/factory-reset',
          payload: factoryPayload(),
        })
      ).statusCode,
    ).toBe(401);
    const auth = await login(subject.app);
    expect(
      (
        await subject.app.inject({
          method: 'POST',
          url: '/api/admin/maintenance/factory-reset',
          headers: { cookie: auth.cookie },
          payload: factoryPayload(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await injectAuthenticated(subject.app, auth, {
          method: 'POST',
          url: '/api/admin/maintenance/factory-reset',
          payload: { ...factoryPayload(), currentPassword: 'incorrecta' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('restablece la instalación y mantiene Cloud API como transporte', async () => {
    const subject = await createApiSubject();
    subjects.push(subject);
    const auth = await login(subject.app);
    const response = await injectAuthenticated(subject.app, auth, {
      method: 'POST',
      url: '/api/admin/maintenance/factory-reset',
      payload: {
        ...factoryPayload(),
        passwordChoice: 'replace',
        newPassword: 'contraseña-nueva-segura',
        newPasswordConfirmation: 'contraseña-nueva-segura',
      },
    });
    expect(response.statusCode).toBe(202);
    await subject.maintenance.waitForCompletion();
    expect(subject.maintenance.snapshot()).toMatchObject({
      result: 'completed',
      code: 'FACTORY_RESET_COMPLETED',
      logoutRequired: true,
    });
    expect(subject.database.getBot('negocio-ejemplo')?.connectorType).toBe('WHATSAPP_CLOUD_API');
    await vi.waitFor(
      async () => {
        const session = await subject.app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: auth.cookie },
        });
        expect(session.statusCode).toBe(401);
      },
      { timeout: 3_500 },
    );
    expect((await login(subject.app, 'contraseña-nueva-segura')).cookie).toContain(
      'panel_session=',
    );
  });

  it('bloquea cambios durante un restablecimiento y evita duplicados', async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const subject = await createApiSubject(async (stage) => {
      if (stage === 'stopping_messaging') await blocked;
    });
    subjects.push(subject);
    const auth = await login(subject.app);
    const first = await injectAuthenticated(subject.app, auth, {
      method: 'POST',
      url: '/api/admin/maintenance/factory-reset',
      payload: factoryPayload(),
    });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(() =>
      expect(subject.maintenance.snapshot()).toMatchObject({
        result: 'running',
        stage: 'stopping_messaging',
      }),
    );
    const blockedAction = await injectAuthenticated(subject.app, auth, {
      method: 'PATCH',
      url: '/api/bots/negocio-ejemplo/configuration',
      payload: {
        enabled: false,
        continuedConversationsEnabled: true,
        menuType: 'automatic',
      },
    });
    expect(blockedAction.statusCode).toBe(423);
    const duplicate = await injectAuthenticated(subject.app, auth, {
      method: 'POST',
      url: '/api/admin/maintenance/factory-reset',
      payload: factoryPayload(),
    });
    expect(duplicate.statusCode).toBe(409);
    release();
    await subject.maintenance.waitForCompletion();
  });
});

async function createApiSubject(beforeStage?: (stage: MaintenanceStage) => void | Promise<void>) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'neurobot-maintenance-api-'));
  const databasePath = join(projectRoot, 'data', 'asistente.db');
  const database = new AppDatabase(databasePath);
  database.migrate();
  database.setPanelPasswordHash(await hashPassword(CURRENT_PASSWORD));
  const logger = createLogger('silent');
  const anonymizer = new Anonymizer('a'.repeat(32));
  const maintenance = new MaintenanceService(database, logger, {
    projectRoot,
    databasePath,
    stopMessaging: async () => undefined,
    startMessaging: async () => undefined,
    ...(beforeStage === undefined ? {} : { beforeStage }),
  });
  const app = await buildAdminServer({
    database,
    anonymizer,
    logger,
    sessionSecret: 's'.repeat(32),
    applicationVersion: 'test',
    developmentMode: false,
    maintenance,
  });
  return { projectRoot, database, maintenance, app };
}

function factoryPayload() {
  return {
    confirmation: 'RESTABLECER BOT',
    currentPassword: CURRENT_PASSWORD,
    understood: true,
    passwordChoice: 'keep',
  };
}

async function login(app: FastifyInstance, password = CURRENT_PASSWORD): Promise<Authentication> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieValue?.split(';')[0];
  if (cookie === undefined) throw new Error('No se recibió cookie de sesión.');
  return { cookie, csrf: response.json().csrfToken };
}

async function injectAuthenticated(
  app: FastifyInstance,
  auth: Authentication,
  options: { method: 'POST' | 'PATCH'; url: string; payload?: Record<string, unknown> },
): Promise<InjectResponse> {
  const headers = {
    cookie: auth.cookie,
    'x-csrf-token': auth.csrf,
    ...(options.payload === undefined ? {} : { 'content-type': 'application/json' }),
  };
  return options.payload === undefined
    ? app.inject({ method: options.method, url: options.url, headers })
    : app.inject({ method: options.method, url: options.url, headers, payload: options.payload });
}
