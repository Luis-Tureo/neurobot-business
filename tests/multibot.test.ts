import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { CatalogService } from '../src/core/catalog-service.js';
import { ConversationFlowService, selectOption } from '../src/core/conversation-flow-service.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';
import { AppDatabase } from '../src/persistence/database.js';
import { SecretVault } from '../src/security/secret-vault.js';
import { PollRepository } from '../src/core/poll-repository.js';
import { AIProviderFactory } from '../src/ai/ai-provider-factory.js';
import { MultiBotManager } from '../src/core/multi-bot-manager.js';
import { WhatsAppCloudApiAdapter } from '../src/messaging/whatsapp-cloud-api-adapter.js';
import { Anonymizer } from '../src/security/anonymizer.js';

function storeProfile(name: string) {
  return createProfileFromPreset({
    organizationName: name,
    botName: `Bot ${name}`,
    organizationType: 'Tienda',
    timezone: 'America/Santiago',
    preset: 'store',
  });
}

describe('aislamiento multibot', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
  });

  afterEach(() => database.close());

  it('crea dos bots con perfiles, sesiones, menús y datos independientes', () => {
    const first = database.createBot({ id: 'tienda-uno', mode: 'business', profile: storeProfile('Uno') });
    const second = database.createBot({ id: 'tienda-dos', mode: 'mixed', profile: storeProfile('Dos') });

    expect(first.clientId).not.toBe(second.clientId);
    expect(first).toMatchObject({
      connectorType: 'WHATSAPP_CLOUD_API',
      operatingMode: 'BUSINESS_PRIVATE',
      groupsEnabled: false,
      privateMessagesEnabled: true,
      continuedConversationsEnabled: true,
      capabilities: { interactiveMenusEnabled: true, conversationContinuationEnabled: true },
    });
    expect(database.getBotProfile(first.id).organizationName).toBe('Uno');
    expect(database.getBotProfile(second.id).organizationName).toBe('Dos');
    expect(database.listMenus(first.id)).toHaveLength(2);
    expect(database.listMenus(second.id)).toHaveLength(2);
  });

  it('no permite leer conocimiento, catálogo ni solicitudes de otro bot', () => {
    const first = database.createBot({ id: 'tienda-uno', mode: 'business', profile: storeProfile('Uno') });
    const second = database.createBot({ id: 'tienda-dos', mode: 'business', profile: storeProfile('Dos') });
    const category = database.saveCatalogCategory({ botId: first.id, name: 'Productos', description: '', enabled: true });
    database.saveCatalogItem({
      id: 0,
      botId: first.id,
      categoryId: category.id,
      name: 'Producto reservado',
      code: 'SKU-1',
      description: 'Solo pertenece al primer bot.',
      priceAmount: 1000,
      offerPriceAmount: null,
      currency: 'CLP',
      presentation: '',
      size: '',
      variants: [],
      availability: '',
      informedStock: null,
      primaryMediaId: null,
      authorizedLink: null,
      enabled: true,
    });
    database.createHumanAssistanceRequest({ botId: first.id, chatHash: 'chat-a', userHash: 'user-a', requestedInterval: 'Mañana', localDate: '2026-08-02' });

    expect(database.listCatalogItems(first.id)).toHaveLength(1);
    expect(database.listCatalogItems(second.id)).toHaveLength(0);
    expect(database.listHumanAssistanceRequests(first.id)).toHaveLength(1);
    expect(database.listHumanAssistanceRequests(second.id)).toHaveLength(0);
  });

  it('cifra claves por bot con autenticación de ámbito', () => {
    const vault = new SecretVault('k'.repeat(32));
    const encrypted = vault.encrypt('clave-de-prueba-no-real', 'bot:tienda-uno:groq');
    expect(encrypted.encrypted).not.toContain('clave-de-prueba-no-real');
    expect(vault.decrypt(encrypted.encrypted, 'bot:tienda-uno:groq')).toBe('clave-de-prueba-no-real');
    expect(() => vault.decrypt(encrypted.encrypted, 'bot:tienda-dos:groq')).toThrow();
  });

  it('selecciona opciones por número, nombre y alias', () => {
    const bot = database.createBot({ id: 'tienda-menu', mode: 'business', profile: storeProfile('Menú') });
    const menu = database.listMenus(bot.id)[0];
    const options = database.listMenuOptions(bot.id, menu?.id);
    expect(selectOption(options, '1')?.label).toBe('Productos o servicios');
    expect(selectOption(options, 'precios')?.label).toBe('Precios');
    expect(selectOption(options, 'formas de pago')?.actionType).toBe('payments');
  });

  it('usa fallback numerado y mantiene un estado temporal sin conversación completa', async () => {
    const bot = database.createBot({ id: 'tienda-flujo', mode: 'business', profile: storeProfile('Flujo'), menuType: 'automatic' });
    const client = new SimulatedMessagingClient();
    const flow = new ConversationFlowService(database, client, createLogger('silent'), bot.id, 'data/media');
    await flow.start('chat@c.us', 'chat-hash', 'user-hash', new Date('2026-08-02T12:00:00Z'));
    expect(client.sentMessages[0]?.text).toContain('1. Productos o servicios');
    const state = database.getConversationState(bot.id, 'chat-hash', 'user-hash');
    expect(state).toMatchObject({ activeFlow: 'menu', currentStep: 'waiting_option' });
    expect(JSON.stringify(state)).not.toContain('chat@c.us');
  });

  it('no inventa precios ausentes', () => {
    const bot = database.createBot({ id: 'tienda-precio', mode: 'business', profile: storeProfile('Precio') });
    const category = database.saveCatalogCategory({ botId: bot.id, name: 'General', description: '', enabled: true });
    const item = database.saveCatalogItem({
      id: 0, botId: bot.id, categoryId: category.id, name: 'Servicio', code: 'SERV-1', description: '',
      priceAmount: null, offerPriceAmount: null, currency: 'CLP', presentation: '', size: '', variants: [],
      availability: '', informedStock: null, primaryMediaId: null, authorizedLink: null, enabled: true,
    });
    expect(new CatalogService(database, bot.id).itemText(item.id)).toContain('No tengo un precio actualizado');
  });

  it('mantiene automatizaciones y encuestas separadas por bot', () => {
    const first = database.createBot({ id: 'tienda-auto-uno', mode: 'business', profile: storeProfile('Auto Uno') });
    const second = database.createBot({ id: 'tienda-auto-dos', mode: 'business', profile: storeProfile('Auto Dos') });
    const firstAutomatic = database.getAutomaticMessageConfiguration(first.id);
    firstAutomatic.welcome.template = 'Bienvenida exclusiva del primer asistente.';
    firstAutomatic.welcome.enabled = true;
    database.saveAutomaticMessageConfiguration(firstAutomatic, first.id);

    const firstPolls = new PollRepository(database, first.id);
    const secondPolls = new PollRepository(database, second.id);
    const originalFirst = firstPolls.templates()[0]!;
    firstPolls.saveTemplate({
      id: originalFirst.id,
      question: 'Pregunta exclusiva del primer asistente',
      category: originalFirst.category,
      options: originalFirst.options,
      allowMultipleAnswers: originalFirst.allowMultipleAnswers,
      enabled: originalFirst.enabled,
      favorite: originalFirst.favorite,
      disabledUntil: originalFirst.disabledUntil,
    });

    expect(database.getAutomaticMessageConfiguration(first.id).welcome.template).toContain('primer asistente');
    expect(database.getAutomaticMessageConfiguration(second.id).welcome.template).not.toContain('primer asistente');
    expect(firstPolls.templates()[0]?.question).toContain('primer asistente');
    expect(secondPolls.templates().some((template) => template.question.includes('primer asistente'))).toBe(false);
  });

  it('aplica el presupuesto global entre bots sin mezclar sus consumos', () => {
    const first = database.createBot({ id: 'tienda-ia-uno', mode: 'business', profile: storeProfile('IA Uno') });
    const second = database.createBot({ id: 'tienda-ia-dos', mode: 'business', profile: storeProfile('IA Dos') });
    database.saveGlobalAILimits({
      dailyRequestLimit: 1,
      monthlyRequestLimit: 10,
      dailyTokenLimit: 10_000,
      monthlyTokenLimit: 100_000,
    });
    const now = new Date('2026-08-02T12:00:00.000Z');
    const reservation = (botId: string, profileId: number, suffix: string) =>
      database.reserveAIUsage({
        botId,
        profileId,
        userHash: `user-${suffix}`,
        groupHash: `group-${suffix}`,
        localDate: '2026-08-02',
        localMonth: '2026-08',
        hourBucket: '2026-08-02T08',
        estimatedInputTokens: 20,
        reservedOutputTokens: 20,
        now,
      });

    expect(reservation(first.id, first.profileId, 'uno')).toMatchObject({ allowed: true });
    expect(reservation(second.id, second.profileId, 'dos')).toEqual({
      allowed: false,
      code: 'AI_LIMIT_DAILY_REACHED',
    });
    expect(database.getAIUsageSummary(first.profileId, '2026-08-02', '2026-08').requests).toBe(0);
    expect(database.getAIUsageSummary(second.profileId, '2026-08-02', '2026-08').requests).toBe(0);
  });

  it('enruta un webhook por phone_number_id al asistente correcto y responde por su Graph API', async () => {
    const second = database.createBot({
      id: 'tienda-meta-dos',
      mode: 'business',
      profile: storeProfile('Meta Dos'),
    });
    const requests = new Map<string, Array<{ url: string; body: unknown }>>();
    const adapters = new Map<string, WhatsAppCloudApiAdapter>();
    const accounts = [
      {
        botId: 'neurobot',
        accessToken: 'token-neurobot-de-prueba-123456789',
        phoneNumberId: '111111111111111',
        wabaId: '999999999999991',
      },
      {
        botId: second.id,
        accessToken: 'token-segundo-de-prueba-1234567890',
        phoneNumberId: '222222222222222',
        wabaId: '999999999999992',
      },
    ];
    const logger = createLogger('silent');
    const manager = new MultiBotManager(
      database,
      new AIProviderFactory(
        database,
        new SecretVault(undefined),
        undefined,
        'llama-3.1-8b-instant',
        'disabled',
      ),
      new Anonymizer('a'.repeat(32)),
      logger,
      {
        maxMessageLength: 2_000,
        repeatWindowMs: 120_000,
        maxReconnectAttempts: 1,
        maxReconnectDelayMs: 10,
        developmentMode: false,
        mediaRoot: 'data/media',
      },
      { apiVersion: 'v25.0', requestTimeoutMs: 1_000, accounts },
      (bot, account) => {
        if (account?.accessToken === undefined || account.phoneNumberId === undefined) {
          throw new Error('Cuenta de prueba incompleta.');
        }
        const botRequests: Array<{ url: string; body: unknown }> = [];
        requests.set(bot.id, botRequests);
        const adapter = new WhatsAppCloudApiAdapter(
          {
            accessToken: account.accessToken,
            phoneNumberId: account.phoneNumberId,
            ...(account.wabaId === undefined ? {} : { wabaId: account.wabaId }),
            apiVersion: 'v25.0',
          },
          logger,
          async (input, init) => {
            botRequests.push({
              url: String(input),
              body: JSON.parse(String(init?.body)) as unknown,
            });
            return new Response(JSON.stringify({ messages: [{ id: `wamid.${bot.id}` }] }), {
              status: 200,
            });
          },
        );
        adapters.set(bot.id, adapter);
        return adapter;
      },
    );

    await manager.prepareAll();
    await manager.startAll();
    const firstIngest = vi.spyOn(adapters.get('neurobot')!, 'ingestWebhook');
    const secondIngest = vi.spyOn(adapters.get(second.id)!, 'ingestWebhook');
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '222222222222222' },
                messages: [
                  {
                    id: 'wamid.inbound.second',
                    from: '56912345678',
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

    await expect(
      manager.ingestMetaWebhook(
        '222222222222222',
        payload,
        new Set(['message:wamid.inbound.second']),
      ),
    ).resolves.toMatchObject({ messages: 1 });
    expect(firstIngest).not.toHaveBeenCalled();
    expect(secondIngest).toHaveBeenCalledTimes(1);
    expect(requests.get('neurobot')).toHaveLength(0);
    expect(requests.get(second.id)).toHaveLength(1);
    expect(requests.get(second.id)?.[0]).toMatchObject({
      url: 'https://graph.facebook.com/v25.0/222222222222222/messages',
      body: { to: '56912345678' },
    });
    await manager.stopAll();
  });
});
