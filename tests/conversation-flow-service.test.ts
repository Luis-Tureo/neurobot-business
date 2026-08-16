import type { Logger } from 'pino';
import type { AssistantQueryService } from '../src/ai/assistant-query-service.js';
import { ConversationFlowService } from '../src/core/conversation-flow-service.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';
import { AppDatabase } from '../src/persistence/database.js';

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

  it('envía texto libre a conocimiento/IA sin volver a mostrar el menú activo', async () => {
    const now = new Date('2026-08-15T15:00:00.000Z');
    await flow.start(chatId, chatHash, userHash, now);

    await expect(
      flow.handle(chatId, chatHash, userHash, '¿Cuál es el horario de atención?', now, false),
    ).resolves.toBe(true);

    expect(answerQuestion).toHaveBeenCalledWith(
      '¿Cuál es el horario de atención?',
      chatHash,
      userHash,
      now,
      expect.any(Function),
    );
    expect(client.sentMessages).toHaveLength(2);
    expect(client.sentMessages[1]?.text).toBe('Atendemos de lunes a viernes de 9:00 a 18:00.');
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
