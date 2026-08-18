import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { buildAdminServer } from '../src/admin/server.js';
import {
  LEGACY_ORGANIZATION_TYPE_ALIASES,
  ORGANIZATION_TYPE_OPTIONS,
} from '../src/domain/organization-types.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';
import { hashPassword } from '../src/security/password.js';

type Authentication = { cookie: string; csrf: string };

describe('API administrativa de Neurobot Business', () => {
  let app: FastifyInstance;
  let database: AppDatabase;

  beforeEach(async () => {
    database = new AppDatabase(':memory:');
    database.migrate();
    database.setPanelPasswordHash(await hashPassword('contraseña-de-prueba'));
    app = await buildAdminServer({
      database,
      anonymizer: new Anonymizer('x'.repeat(32)),
      logger: createLogger('silent'),
      sessionSecret: 's'.repeat(32),
      applicationVersion: '0.1.0-test',
      developmentMode: false,
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it('publica salud y protege los datos privados con sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/api/bots' })).statusCode).toBe(401);

    const auth = await login(app);
    expect(auth.cookie).toContain('panel_session=');
    const response = await app.inject({
      method: 'GET',
      url: '/api/bots',
      headers: { cookie: auth.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().bots).toEqual([
      expect.objectContaining({
        id: 'negocio-ejemplo',
        organizationName: 'Negocio de ejemplo',
        organizationType: 'Comercio',
        connectorType: 'WHATSAPP_CLOUD_API',
        enabled: false,
      }),
    ]);
    expect(response.json()).toMatchObject({
      organizationTypes: ORGANIZATION_TYPE_OPTIONS,
      legacyOrganizationTypeAliases: LEGACY_ORGANIZATION_TYPE_ALIASES,
    });
    expect(response.body).not.toMatch(/community|groupsEnabled|activationAlias/iu);
  });

  it('no expone rutas heredadas ajenas a atención privada', async () => {
    const auth = await login(app);
    const removedRoutes = [
      '/api/groups',
      '/api/commands',
      '/api/polls',
      '/api/moderation',
      '/api/settings',
      '/api/connection/restart',
      '/api/bots/negocio-ejemplo/groups',
      '/api/bots/negocio-ejemplo/polls',
      '/api/bots/negocio-ejemplo/moderation',
      '/api/bots/negocio-ejemplo/automatic-messages',
    ];
    for (const url of removedRoutes) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie: auth.cookie } });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it('actualiza solamente configuración privada y rechaza contratos heredados', async () => {
    const auth = await login(app);
    const valid = await injectAuthenticated(app, auth, {
      method: 'PATCH',
      url: '/api/bots/negocio-ejemplo/configuration',
      payload: {
        enabled: false,
        continuedConversationsEnabled: true,
        menuType: 'numbered',
      },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().bot).toMatchObject({
      enabled: false,
      continuedConversationsEnabled: true,
      menuType: 'numbered',
    });

    const inherited = await injectAuthenticated(app, auth, {
      method: 'PATCH',
      url: '/api/bots/negocio-ejemplo/configuration',
      payload: {
        enabled: false,
        continuedConversationsEnabled: true,
        menuType: 'numbered',
        groupsEnabled: false,
      },
    });
    expect(inherited.statusCode).toBe(400);
  });

  it('expone actividad segura con hashes de conversación y cliente', async () => {
    database.recordTechnicalEvent({
      botId: 'negocio-ejemplo',
      eventType: 'AI_CALL_SUCCESS',
      source: 'private',
      conversationHash: 'conversacion-anonima',
      customerHash: 'cliente-anonimo',
      result: 'ok',
      durationMs: 25,
    });
    const auth = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/bots/negocio-ejemplo/history?limit=20',
      headers: { cookie: auth.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        eventType: 'AI_CALL_SUCCESS',
        conversationHash: 'conversacion-anonima',
        customerHash: 'cliente-anonimo',
        result: 'ok',
        durationMs: 25,
      }),
    ]);
  });

  it('administra números autorizados sin exponerlos completos', async () => {
    const auth = await login(app);
    const created = await injectAuthenticated(app, auth, {
      method: 'POST',
      url: '/api/administrators',
      payload: { number: '+56 9 1234 5678' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('56912345678');
    expect(created.json()).toMatchObject({ masked: '*******5678' });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/administrators',
      headers: { cookie: auth.cookie },
    });
    expect(listed.json().administrators).toHaveLength(1);
  });
});

async function login(app: FastifyInstance): Promise<Authentication> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'contraseña-de-prueba' },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieValue?.split(';')[0];
  if (cookie === undefined) throw new Error('No se recibió cookie de sesión.');
  return { cookie, csrf: response.json().csrfToken as string };
}

async function injectAuthenticated(
  app: FastifyInstance,
  auth: Authentication,
  options: { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; payload?: unknown },
): Promise<InjectResponse> {
  return app.inject({
    method: options.method,
    url: options.url,
    headers: {
      cookie: auth.cookie,
      'x-csrf-token': auth.csrf,
      ...(options.payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.payload === undefined ? {} : { body: JSON.stringify(options.payload) }),
  });
}
