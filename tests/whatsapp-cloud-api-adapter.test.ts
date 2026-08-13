import pino from 'pino';
import { createLogger } from '../src/infrastructure/logger.js';
import {
  MetaCloudApiTimeoutError,
  MetaGraphApiError,
  WhatsAppCloudApiAdapter,
} from '../src/messaging/whatsapp-cloud-api-adapter.js';

const account = {
  accessToken: 'token-de-prueba-no-real-1234567890',
  phoneNumberId: '123456789012345',
  wabaId: '987654321098765',
  apiVersion: 'v25.0',
};

function subject(
  fetchImplementation?: (input: string | URL, init?: RequestInit) => Promise<Response>,
) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher =
    fetchImplementation ??
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.outbound' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  const received: unknown[] = [];
  const statuses: unknown[] = [];
  const outbound: unknown[] = [];
  const adapter = new WhatsAppCloudApiAdapter(account, createLogger('silent'), fetcher);
  adapter.setEvents({
    onMessage: async (message) => {
      received.push(message);
    },
    onDeliveryStatus: (status) => {
      statuses.push(status);
    },
    onOutboundMessage: (message) => {
      outbound.push(message);
    },
    onStateChange: vi.fn(),
    onReady: vi.fn(),
  });
  return { adapter, requests, received, statuses, outbound, fetcher };
}

describe('conector oficial WhatsApp Cloud API', () => {
  it('envía texto, respuesta, botones y listas al endpoint oficial del número configurado', async () => {
    const { adapter, requests, outbound } = subject();
    await adapter.initialize();
    await expect(
      adapter.sendTextMessage('56912345678@c.us', 'Hola', 'wamid.inbound'),
    ).resolves.toEqual({ messageId: 'wamid.outbound' });
    await expect(
      adapter.sendInteractiveMenu('56912345678@c.us', {
        title: 'Atención',
        message: '¿Qué necesitas?',
        helpText: '',
        kind: 'buttons',
        options: [
          { id: 'products', label: 'Productos' },
          { id: 'hours', label: 'Horarios' },
        ],
      }),
    ).resolves.toBe(true);
    await expect(
      adapter.sendInteractiveMenu('56912345678@c.us', {
        title: 'Opciones',
        message: 'Selecciona una opción',
        helpText: '',
        kind: 'list',
        options: Array.from({ length: 5 }, (_, index) => ({
          id: `option-${index}`,
          label: `Opción ${index + 1}`,
        })),
      }),
    ).resolves.toBe(true);

    expect(requests).toHaveLength(3);
    expect(requests[0]?.url).toBe('https://graph.facebook.com/v25.0/123456789012345/messages');
    const bodies = requests.map(
      (request) => JSON.parse(String(request.init?.body)) as Record<string, unknown>,
    );
    expect(bodies[0]).toMatchObject({
      to: '56912345678',
      type: 'text',
      context: { message_id: 'wamid.inbound' },
    });
    expect(bodies[1]).toMatchObject({ type: 'interactive', interactive: { type: 'button' } });
    expect(bodies[2]).toMatchObject({ type: 'interactive', interactive: { type: 'list' } });
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: `Bearer ${account.accessToken}`,
    });
    expect(outbound).toMatchObject([
      {
        messageId: 'wamid.outbound',
        phoneNumberId: account.phoneNumberId,
        recipientId: '56912345678',
        messageType: 'text',
        text: 'Hola',
      },
      {
        messageType: 'interactive',
        text: expect.stringContaining('¿Qué necesitas?'),
      },
      {
        messageType: 'interactive',
        text: expect.stringContaining('Selecciona una opción'),
      },
    ]);
  });

  it('adapta texto e identifica remitente, receptor, ID y timestamp', async () => {
    const { adapter, received } = subject();
    await adapter.initialize();
    const result = await adapter.ingestWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  display_phone_number: '+56 9 0000 0000',
                  phone_number_id: account.phoneNumberId,
                },
                contacts: [{ wa_id: '56912345678', profile: { name: 'Persona Real' } }],
                messages: [
                  {
                    id: 'wamid.text',
                    from: '56912345678',
                    timestamp: '1786550400',
                    type: 'text',
                    text: { body: 'Hola' },
                  },
                  {
                    id: 'wamid.list',
                    from: '56912345678',
                    type: 'interactive',
                    interactive: { list_reply: { id: 'hours', title: 'Horarios' } },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({ messages: 2, statuses: 0 });
    expect(received).toMatchObject([
      {
        id: 'wamid.text',
        chatId: '56912345678@c.us',
        participantId: '56912345678@c.us',
        recipientId: account.phoneNumberId,
        receivedAt: '2026-08-12T16:00:00.000Z',
        body: 'Hola',
        visibleText: 'Hola',
        contactName: 'Persona Real',
        isGroup: false,
      },
      {
        id: 'wamid.list',
        recipientId: account.phoneNumberId,
        body: 'hours',
        visibleText: 'Horarios',
        contactName: 'Persona Real',
      },
    ]);
  });

  it('procesa estados y omite mensajes desconocidos sin provocar errores', async () => {
    const { adapter, received, statuses } = subject();
    await adapter.initialize();
    const result = await adapter.ingestWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: account.phoneNumberId },
                messages: [
                  {
                    id: 'wamid.image',
                    from: '56912345678',
                    type: 'image',
                    image: { id: 'media' },
                  },
                ],
                statuses: [
                  {
                    id: 'wamid.outbound',
                    recipient_id: '56912345678',
                    status: 'delivered',
                    timestamp: '1786550400',
                    conversation: { id: 'conversation-1' },
                  },
                  {
                    id: 'wamid.failed',
                    status: 'failed',
                    timestamp: '1786550401',
                    errors: [{ code: 131047, title: 'Re-engagement message' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({ messages: 1, statuses: 2, unsupportedMessages: 0 });
    expect(received).toMatchObject([
      {
        id: 'wamid.image',
        messageType: 'image',
        body: '[Imagen]',
        visibleText: '[Imagen]',
        hasMedia: true,
      },
    ]);
    expect(statuses).toMatchObject([
      {
        messageId: 'wamid.outbound',
        phoneNumberId: account.phoneNumberId,
        recipientId: '56912345678',
        status: 'delivered',
      },
      {
        messageId: 'wamid.failed',
        status: 'failed',
        errorCode: '131047',
        errorMessage: 'Re-engagement message',
      },
    ]);
  });

  it('devuelve cero para eventos sin mensajes ni estados', async () => {
    const { adapter } = subject();
    await adapter.initialize();
    await expect(
      adapter.ingestWebhook({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: { metadata: { phone_number_id: account.phoneNumberId } },
              },
            ],
          },
        ],
      }),
    ).resolves.toEqual({ messages: 0, statuses: 0, unsupportedMessages: 0 });
  });

  it('propaga de forma segura errores HTTP y de Graph API', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: `Token inválido ${account.accessToken}`,
              type: 'OAuthException',
              code: 190,
              error_subcode: 463,
            },
          }),
          { status: 400 },
        ),
    );
    const { adapter } = subject(fetcher);
    await adapter.initialize();
    await expect(adapter.sendMessage('56912345678@c.us', 'Hola')).rejects.toMatchObject({
      name: 'MetaGraphApiError',
      httpStatus: 400,
      graphCode: '190',
      graphSubcode: '463',
    } satisfies Partial<MetaGraphApiError>);
    expect(adapter.status()).toEqual({ lastErrorCode: 'META_GRAPH_API_190' });
  });

  it('cancela la solicitud cuando Meta excede el timeout', async () => {
    const fetcher = vi.fn(
      async (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const adapter = new WhatsAppCloudApiAdapter(
      { ...account, requestTimeoutMs: 5 },
      createLogger('silent'),
      fetcher,
    );
    adapter.setEvents({ onMessage: vi.fn(), onStateChange: vi.fn(), onReady: vi.fn() });
    await adapter.initialize();
    await expect(adapter.sendMessage('56912345678@c.us', 'Hola')).rejects.toBeInstanceOf(
      MetaCloudApiTimeoutError,
    );
    expect(adapter.status()).toEqual({ lastErrorCode: 'META_GRAPH_API_TIMEOUT' });
  });

  it('falla claramente sin credenciales obligatorias', async () => {
    const adapter = new WhatsAppCloudApiAdapter({ apiVersion: 'v25.0' }, createLogger('silent'));
    adapter.setEvents({ onMessage: vi.fn(), onStateChange: vi.fn(), onReady: vi.fn() });
    expect(adapter.configurationIssues()).toEqual(['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID']);
    await expect(adapter.initialize()).rejects.toThrow('META_ACCESS_TOKEN, META_PHONE_NUMBER_ID');
    expect(adapter.status()).toEqual({ lastErrorCode: 'META_CREDENTIALS_MISSING' });
  });

  it('no registra el access token ni el mensaje devuelto por Meta', async () => {
    let output = '';
    const logger = pino({ level: 'debug', base: null }, { write: (line) => (output += line) });
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 190, message: `secreto ${account.accessToken}` } }),
          { status: 401 },
        ),
    );
    const adapter = new WhatsAppCloudApiAdapter(account, logger, fetcher);
    adapter.setEvents({ onMessage: vi.fn(), onStateChange: vi.fn(), onReady: vi.fn() });
    await adapter.initialize();
    await expect(adapter.sendMessage('56912345678@c.us', 'Hola')).rejects.toBeInstanceOf(
      MetaGraphApiError,
    );
    expect(output).not.toContain(account.accessToken);
    expect(output).not.toContain('secreto');
  });
});
