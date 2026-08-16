import type { Logger } from 'pino';
import type { AssistantQueryService } from '../src/ai/assistant-query-service.js';
import { ConversationFlowService } from '../src/core/conversation-flow-service.js';
import { MessageProcessor } from '../src/core/message-processor.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';

describe('enrutamiento del flujo conversacional', () => {
  let database: AppDatabase;
  let client: SimulatedMessagingClient;
  let answerQuestion: ReturnType<typeof vi.fn>;
  let flow: ConversationFlowService;
  const botId = 'negocio-enrutamiento';
  const chatId = '56911111111@c.us';
  const chatHash = 'chat-hash';
  const userHash = 'user-hash';

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
    database.createBot({
      id: botId,
      profile: createProfileFromPreset({
        organizationName: 'Negocio de prueba',
        botName: 'Asistente de prueba',
        organizationType: 'Comercio',
        timezone: 'America/Santiago',
        preset: 'store',
      }),
    });
    client = new SimulatedMessagingClient();
    answerQuestion = vi.fn(async () => ({
      text: 'Atendemos de lunes a viernes de 9:00 a 18:00.',
      code: 'KNOWLEDGE_DIRECT' as const,
    }));
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
    const queryService = { answerQuestion } as unknown as AssistantQueryService;
    flow = new ConversationFlowService(database, client, logger, botId, 'data/media', queryService);
  });

  afterEach(() => database.close());

  it('envía el primer texto libre a conocimiento/IA sin mostrar el menú', async () => {
    const now = new Date('2026-08-15T15:00:00.000Z');
    answerQuestion.mockResolvedValueOnce({ text: 'La respuesta es 4.', code: 'AI_RESPONSE' });

    await expect(
      flow.handle(chatId, chatHash, userHash, '¿Cuánto es 2 + 2?', now, false),
    ).resolves.toBe(true);

    expect(answerQuestion).toHaveBeenCalledWith(
      '¿Cuánto es 2 + 2?',
      chatHash,
      userHash,
      now,
      expect.any(Function),
      'free_text_fallback',
    );
    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0]?.text).toBe('La respuesta es 4.');
  });

  it('responde horarios solo con la configuración local confirmada', async () => {
    const now = new Date('2026-08-15T15:00:00.000Z');
    database.replaceBusinessHours(botId, [
      {
        weekday: 1,
        localDate: null,
        openingTime: '09:00',
        closingTime: '18:00',
        closed: false,
        label: '',
      },
    ]);

    await expect(
      flow.handle(chatId, chatHash, userHash, '¿Cuál es el horario de atención?', now, false),
    ).resolves.toBe(true);

    expect(answerQuestion).not.toHaveBeenCalled();
    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0]?.text).toBe('lunes: 09:00 a 18:00.');
  });

  it('mantiene los saludos y opciones nuevas en la ruta de menú', async () => {
    const now = new Date('2026-08-15T15:00:00.000Z');
    await expect(flow.handle(chatId, chatHash, userHash, 'Hola', now, false)).resolves.toBe(false);
    await expect(flow.handle(chatId, chatHash, userHash, '1', now, false)).resolves.toBe(false);
    expect(answerQuestion).not.toHaveBeenCalled();
    expect(client.sentMessages).toHaveLength(0);
  });

  it('procesa de extremo a extremo las dos consultas sin alterar el transporte', async () => {
    database.updateBotConfiguration({
      botId,
      enabled: true,
      continuedConversationsEnabled: true,
      menuType: 'numbered',
    });
    database.replaceBusinessHours(botId, [
      {
        weekday: 1,
        localDate: null,
        openingTime: '09:00',
        closingTime: '18:00',
        closed: false,
        label: '',
      },
    ]);
    answerQuestion.mockResolvedValueOnce({ text: 'La respuesta es 4.', code: 'AI_RESPONSE' });
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
    const processor = new MessageProcessor(
      database,
      new Anonymizer('x'.repeat(32)),
      logger,
      { maxMessageLength: 2000 },
      botId,
      flow,
    );

    await expect(
      processor.process({
        id: 'math-1',
        chatId,
        customerId: '56911111111',
        body: '¿Cuánto es 2 + 2?',
        hasMedia: false,
        isReplyToBot: false,
      }),
    ).resolves.toBe('responded');
    await expect(
      processor.process({
        id: 'hours-1',
        chatId: '56922222222@c.us',
        customerId: '56922222222',
        body: '¿Cuál es el horario de atención?',
        hasMedia: false,
        isReplyToBot: false,
      }),
    ).resolves.toBe('responded');

    expect(client.sentMessages.map((message) => message.text)).toEqual([
      'La respuesta es 4.',
      'lunes: 09:00 a 18:00.',
    ]);
    expect(answerQuestion).toHaveBeenCalledTimes(1);
  });

  it('preserva opciones interactivas y el comando menú', async () => {
    const now = new Date('2026-08-15T15:00:00.000Z');
    await flow.start(chatId, chatHash, userHash, now);

    await expect(flow.handle(chatId, chatHash, userHash, 'Horarios', now, true)).resolves.toBe(
      true,
    );
    expect(answerQuestion).not.toHaveBeenCalled();
    expect(client.sentMessages[1]?.text).toContain('horario');

    await expect(flow.handle(chatId, chatHash, userHash, 'menú', now, false)).resolves.toBe(true);
    expect(client.sentMessages[2]?.text).toContain('¿En qué podemos ayudarte?');
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('no consulta conocimiento/IA cuando las conversaciones continuadas están desactivadas', async () => {
    const now = new Date('2026-08-15T15:00:00.000Z');
    await flow.start(chatId, chatHash, userHash, now);
    database.updateBotConfiguration({
      botId,
      enabled: true,
      continuedConversationsEnabled: false,
      menuType: 'numbered',
    });

    await expect(
      flow.handle(chatId, chatHash, userHash, '¿Dónde están ubicados?', now, false),
    ).resolves.toBe(false);
    expect(answerQuestion).not.toHaveBeenCalled();
  });
});
