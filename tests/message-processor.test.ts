import type { Logger } from 'pino';
import type { ConversationFlowService } from '../src/core/conversation-flow-service.js';
import { MessageProcessor } from '../src/core/message-processor.js';
import type { IncomingMessage } from '../src/domain/types.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';

describe('procesador de conversaciones privadas', () => {
  let database: AppDatabase;
  let flow: { handle: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
  let processor: MessageProcessor;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
    database.updateBotConfiguration({
      botId: 'negocio-ejemplo',
      enabled: true,
      continuedConversationsEnabled: true,
      menuType: 'numbered',
    });
    flow = {
      handle: vi.fn(async () => false),
      start: vi.fn(async () => true),
    };
    processor = createProcessor(database, flow);
  });

  afterEach(() => database.close());

  it('abre el menú inicial al recibir un mensaje privado nuevo', async () => {
    await expect(processor.process(message())).resolves.toBe('responded');
    expect(flow.handle).toHaveBeenCalledWith(
      '56912345678@c.us',
      expect.any(String),
      expect.any(String),
      'Hola',
      expect.any(Date),
      false,
    );
    expect(flow.start).toHaveBeenCalledOnce();
  });

  it('continúa una conversación cuando el flujo reconoce la respuesta', async () => {
    flow.handle.mockResolvedValueOnce(true);
    await expect(
      processor.process(message({ id: 'interactive-1', messageType: 'interactive' })),
    ).resolves.toBe('responded');
    expect(flow.handle).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'Hola',
      expect.any(Date),
      true,
    );
    expect(flow.start).not.toHaveBeenCalled();
  });

  it('deduplica eventos y descarta mensajes vacíos o demasiado largos', async () => {
    const repeated = message({ id: 'same-message' });
    await expect(processor.process(repeated)).resolves.toBe('responded');
    await expect(processor.process(repeated)).resolves.toBe('duplicate');
    await expect(processor.process(message({ id: 'empty', body: '  ' }))).resolves.toBe('ignored');
    await expect(processor.process(message({ id: 'long', body: 'x'.repeat(201) }))).resolves.toBe(
      'ignored',
    );
  });

  it('respeta desactivación y mantenimiento sin procesar el mensaje', async () => {
    database.updateBotConfiguration({
      botId: 'negocio-ejemplo',
      enabled: false,
      continuedConversationsEnabled: true,
      menuType: 'numbered',
    });
    await expect(processor.process(message({ id: 'disabled' }))).resolves.toBe('bot_disabled');

    const paused = createProcessor(database, flow, () => true);
    await expect(paused.process(message({ id: 'paused' }))).resolves.toBe('ignored');
    expect(flow.handle).not.toHaveBeenCalled();
  });

  it('devuelve un error seguro si falla el flujo privado', async () => {
    flow.handle.mockRejectedValueOnce(new Error('detalle sensible simulado'));
    await expect(processor.process(message({ id: 'failure' }))).resolves.toBe('send_failed');
  });
});

function createProcessor(
  database: AppDatabase,
  flow: { handle: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> },
  isMaintenanceActive?: () => boolean,
): MessageProcessor {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  return new MessageProcessor(
    database,
    new Anonymizer('x'.repeat(32)),
    logger,
    {
      maxMessageLength: 200,
      ...(isMaintenanceActive === undefined ? {} : { isMaintenanceActive }),
    },
    'negocio-ejemplo',
    flow as unknown as ConversationFlowService,
  );
}

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'message-1',
    chatId: '56912345678@c.us',
    customerId: '56912345678',
    body: 'Hola',
    hasMedia: false,
    isReplyToBot: false,
    ...overrides,
  };
}
