import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildAdminServer } from '../src/admin/server.js';
import { ConnectionManager } from '../src/core/connection-manager.js';
import { GroupDiscoveryService } from '../src/core/group-discovery-service.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';

const appSecret = 'app-secret-de-prueba-no-real';
const verifyToken = 'verify-token-de-prueba-no-real';
const phoneNumberId = '123456789012345';

describe('webhook oficial de Meta para WhatsApp', () => {
  let app: FastifyInstance;
  let database: AppDatabase;
  let processor: ReturnType<typeof createProcessor>;

  beforeEach(async () => {
    database = new AppDatabase(':memory:');
    database.migrate();
    const client = new SimulatedMessagingClient();
    const logger = createLogger('silent');
    const connectionManager = new ConnectionManager(client, logger, {
      maxAttempts: 1,
      maxDelayMs: 10,
    });
    const groupDiscovery = new GroupDiscoveryService(
      client,
      database,
      logger,
      {
        onLoading: vi.fn(),
        onLoaded: vi.fn(),
        onFailure: vi.fn(),
      },
      { developmentMode: false },
    );
    processor = createProcessor();
    app = await buildAdminServer({
      database,
      connectionManager,
      groupDiscovery,
      anonymizer: new Anonymizer('a'.repeat(32)),
      logger,
      sessionSecret: 's'.repeat(32),
      applicationVersion: 'test',
      developmentMode: false,
      metaWebhook: { appSecret, verifyToken },
      metaWebhookProcessor: { ingestMetaWebhook: processor },
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it('publica la política de privacidad sin autenticación y conserva sus cabeceras de seguridad', async () => {
    const response = await app.inject({ method: 'GET', url: '/privacy' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).toContain('Política de Privacidad');
    expect(response.body).toContain('WhatsApp Cloud API');
    expect(response.body).toContain('Meta');
    expect(response.body).toContain('Groq');
    expect(response.body).toContain('no vende datos personales');
    expect(response.body).toContain('mismo número empresarial de WhatsApp');

    const stylesheet = await app.inject({ method: 'GET', url: '/privacy.css' });
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.headers['content-type']).toContain('text/css');
  });

  it('publica las condiciones del servicio sin autenticación', async () => {
    const response = await app.inject({ method: 'GET', url: '/terms' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).toContain('Condiciones del servicio');
    expect(response.body).toContain('WhatsApp Cloud API');
    expect(response.body).toContain('Meta');
    expect(response.body).toContain('inteligencia artificial');
    expect(response.body).toContain('Usos prohibidos');
    expect(response.body).toContain('Política de Privacidad');
  });

  it('publica las instrucciones de eliminación de datos sin autenticación', async () => {
    const response = await app.inject({ method: 'GET', url: '/data-deletion' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).toContain('Eliminación de datos de usuario');
    expect(response.body).toContain('Solicitud de eliminación de datos');
    expect(response.body).toContain('No envíes contraseñas, tokens');
    expect(response.body).toContain('prevenir o investigar fraude');
    expect(response.body).toContain('Meta, WhatsApp u otros proveedores');
    expect(response.body).toContain('Política de Privacidad');
  });

  it('devuelve el challenge solo con modo y verify token correctos', async () => {
    const accepted = await app.inject({
      method: 'GET',
      url: `/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=challenge-123`,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).toBe('challenge-123');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=no',
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain(verifyToken);
  });

  it('acepta rápidamente un mensaje firmado y lo procesa de forma asíncrona', async () => {
    const payload = messagePayload('wamid.inbound');
    const response = await signedPost(app, payload);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });

    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(1));
    expect(processor).toHaveBeenCalledWith(
      phoneNumberId,
      payload,
      new Set(['message:wamid.inbound']),
    );
    await vi.waitFor(() =>
      expect(database.getMetaWebhookEvent('message:wamid.inbound')).toMatchObject({
        status: 'PROCESSED',
        deliveryCount: 1,
      }),
    );
  });

  it('rechaza una firma inválida sin procesar el payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      },
      payload: JSON.stringify(messagePayload('wamid.invalid-signature')),
    });
    expect(response.statusCode).toBe(401);
    expect(processor).not.toHaveBeenCalled();
  });

  it('rechaza un payload firmado pero estructuralmente inválido', async () => {
    const response = await signedPost(app, { object: 'otro', entry: [] });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_META_WEBHOOK_PAYLOAD' });
    expect(processor).not.toHaveBeenCalled();
  });

  it('ignora de forma segura un evento relevante que no contiene mensajes ni estados', async () => {
    const response = await signedPost(app, {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: { metadata: { phone_number_id: phoneNumberId } },
            },
          ],
        },
      ],
    });
    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(processor).not.toHaveBeenCalled();
  });

  it('deduplica el reintento del mismo webhook y registra sus entregas', async () => {
    const payload = messagePayload('wamid.duplicate');
    expect((await signedPost(app, payload)).statusCode).toBe(200);
    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(1));
    expect((await signedPost(app, payload)).statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(processor).toHaveBeenCalledTimes(1);
    expect(database.getMetaWebhookEvent('message:wamid.duplicate')).toMatchObject({
      status: 'PROCESSED',
      deliveryCount: 2,
    });
  });

  it('extrae y entrega estados de mensajes', async () => {
    processor.mockResolvedValue({ messages: 0, statuses: 1, unsupportedMessages: 0 });
    const payload = statusPayload('wamid.outbound', 'delivered', '1786550400');
    expect((await signedPost(app, payload)).statusCode).toBe(200);
    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(1));
    const accepted = processor.mock.calls[0]?.[2] as Set<string>;
    expect([...accepted]).toEqual(['status:wamid.outbound:delivered:2026-08-12T16:00:00.000Z']);
  });
});

function messagePayload(messageId: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '987654321098765',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '+56 9 0000 0000', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: '56912345678', profile: { name: 'Persona' } }],
              messages: [
                {
                  from: '56912345678',
                  id: messageId,
                  timestamp: '1786550400',
                  type: 'text',
                  text: { body: 'Hola' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function statusPayload(messageId: string, status: string, timestamp: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '987654321098765',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: phoneNumberId },
              statuses: [{ id: messageId, recipient_id: '56912345678', status, timestamp }],
            },
          },
        ],
      },
    ],
  };
}

async function signedPost(app: FastifyInstance, payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/meta/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    payload: rawBody,
  });
}

function createProcessor() {
  return vi.fn(
    async (
      _phoneNumberId: string,
      _payload: unknown,
      _acceptedEventIds: ReadonlySet<string>,
    ): Promise<{ messages: number; statuses: number; unsupportedMessages: number }> => ({
      messages: 1,
      statuses: 0,
      unsupportedMessages: 0,
    }),
  );
}
