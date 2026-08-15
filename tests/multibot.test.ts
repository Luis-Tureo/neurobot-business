import { AIProviderFactory } from '../src/ai/ai-provider-factory.js';
import { loadEnvironment } from '../src/config/environment.js';
import { CatalogService } from '../src/core/catalog-service.js';
import { ConversationFlowService, selectOption } from '../src/core/conversation-flow-service.js';
import { MultiBotManager } from '../src/core/multi-bot-manager.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';
import { SecretVault } from '../src/security/secret-vault.js';

function storeProfile(name: string) {
  return createProfileFromPreset({
    organizationName: name,
    botName: `Asistente ${name}`,
    organizationType: 'Comercio',
    timezone: 'America/Santiago',
    preset: 'store',
  });
}

describe('aislamiento de asistentes empresariales', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
  });

  afterEach(() => database.close());

  it('crea negocios con perfiles, menús y datos independientes', () => {
    const first = database.createBot({ id: 'tienda-uno', profile: storeProfile('Uno') });
    const second = database.createBot({ id: 'tienda-dos', profile: storeProfile('Dos') });

    expect(first.clientId).not.toBe(second.clientId);
    expect(first).toMatchObject({
      connectorType: 'WHATSAPP_CLOUD_API',
      continuedConversationsEnabled: true,
      capabilities: { interactiveMenusEnabled: true, conversationContinuationEnabled: true },
    });
    expect(database.getBotProfile(first.id).organizationName).toBe('Uno');
    expect(database.getBotProfile(second.id).organizationName).toBe('Dos');
    expect(database.listMenus(first.id)).toHaveLength(2);
    expect(database.listMenus(second.id)).toHaveLength(2);
  });

  it('aísla catálogo y solicitudes entre negocios', () => {
    const first = database.createBot({ id: 'tienda-uno', profile: storeProfile('Uno') });
    const second = database.createBot({ id: 'tienda-dos', profile: storeProfile('Dos') });
    const category = database.saveCatalogCategory({
      botId: first.id,
      name: 'Productos',
      description: '',
      enabled: true,
    });
    database.saveCatalogItem({
      id: 0,
      botId: first.id,
      categoryId: category.id,
      name: 'Producto reservado',
      code: 'SKU-1',
      description: 'Solo pertenece al primer negocio.',
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
    database.createHumanAssistanceRequest({
      botId: first.id,
      chatHash: 'chat-a',
      userHash: 'user-a',
      requestedInterval: 'Mañana',
      localDate: '2026-08-02',
    });

    expect(database.listCatalogItems(first.id)).toHaveLength(1);
    expect(database.listCatalogItems(second.id)).toHaveLength(0);
    expect(database.listHumanAssistanceRequests(first.id)).toHaveLength(1);
    expect(database.listHumanAssistanceRequests(second.id)).toHaveLength(0);
  });

  it('cifra claves por negocio con autenticación de ámbito', () => {
    const vault = new SecretVault('k'.repeat(32));
    const encrypted = vault.encrypt('clave-de-prueba-no-real', 'bot:tienda-uno:groq');
    expect(encrypted.encrypted).not.toContain('clave-de-prueba-no-real');
    expect(vault.decrypt(encrypted.encrypted, 'bot:tienda-uno:groq')).toBe(
      'clave-de-prueba-no-real',
    );
    expect(() => vault.decrypt(encrypted.encrypted, 'bot:tienda-dos:groq')).toThrow();
  });

  it('selecciona menús y mantiene estado temporal privado', async () => {
    const bot = database.createBot({
      id: 'tienda-menu',
      profile: storeProfile('Menú'),
      menuType: 'automatic',
    });
    const menu = database.listMenus(bot.id)[0];
    const options = database.listMenuOptions(bot.id, menu?.id);
    expect(selectOption(options, '1')?.label).toBe('Productos o servicios');
    expect(selectOption(options, 'precios')?.label).toBe('Precios');

    const client = new SimulatedMessagingClient();
    const flow = new ConversationFlowService(
      database,
      client,
      createLogger('silent'),
      bot.id,
      'data/media',
    );
    await flow.start('56911111111@c.us', 'chat-hash', 'user-hash');
    expect(client.sentMessages[0]?.text).toContain('1. Productos o servicios');
    expect(database.getConversationState(bot.id, 'chat-hash', 'user-hash')).toMatchObject({
      activeFlow: 'menu',
      currentStep: 'waiting_option',
    });
  });

  it('no inventa precios ausentes', () => {
    const bot = database.createBot({ id: 'tienda-precio', profile: storeProfile('Precio') });
    const category = database.saveCatalogCategory({
      botId: bot.id,
      name: 'General',
      description: '',
      enabled: true,
    });
    const item = database.saveCatalogItem({
      id: 0,
      botId: bot.id,
      categoryId: category.id,
      name: 'Servicio',
      code: 'SERV-1',
      description: '',
      priceAmount: null,
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
    expect(new CatalogService(database, bot.id).itemText(item.id)).toContain(
      'No tengo un precio actualizado',
    );
  });

  it('prepara solo asistentes habilitados y vinculados por Meta', async () => {
    const bot = database.createBot({ id: 'tienda-cloud', profile: storeProfile('Cloud') });
    database.configureMetaConnector(bot.id, '123456789012345');
    database.updateBotConfiguration({
      botId: bot.id,
      enabled: true,
      continuedConversationsEnabled: true,
      menuType: 'numbered',
    });
    const client = new SimulatedMessagingClient();
    const logger = createLogger('silent');
    const manager = new MultiBotManager(
      database,
      new AIProviderFactory(
        database,
        new SecretVault(undefined),
        undefined,
        'disabled',
        'disabled',
      ),
      new Anonymizer('x'.repeat(32)),
      logger,
      {
        maxMessageLength: 2000,
        maxReconnectAttempts: 1,
        maxReconnectDelayMs: 10,
        developmentMode: false,
        mediaRoot: 'data/media',
      },
      {
        apiVersion: 'v23.0',
        requestTimeoutMs: 1000,
        accounts: [
          {
            botId: bot.id,
            accessToken: 'token-ficticio-de-prueba',
            phoneNumberId: '123456789012345',
            wabaId: '987654321098765',
          },
        ],
      },
      () => client,
    );

    await manager.startAll();
    expect(client.initializeCalls).toBe(1);
    expect(manager.client(bot.id)).toBe(client);
    await manager.stopAll();
    expect(client.destroyCalls).toBe(1);
  });

  it('asocia la cuenta Meta simple con el asistente creado por la base inicial', () => {
    const environment = loadEnvironment({
      ANONYMIZATION_SECRET: 'a'.repeat(32),
      PANEL_SESSION_SECRET: 'b'.repeat(32),
      META_ACCESS_TOKEN: 'token-ficticio-de-prueba-1234567890',
      META_PHONE_NUMBER_ID: '123456789012345',
      META_WABA_ID: '987654321098765',
    });
    const logger = createLogger('silent');
    const warn = vi.spyOn(logger, 'warn');

    new MultiBotManager(
      database,
      new AIProviderFactory(
        database,
        new SecretVault(undefined),
        undefined,
        'disabled',
        'disabled',
      ),
      new Anonymizer('x'.repeat(32)),
      logger,
      {
        maxMessageLength: 2000,
        maxReconnectAttempts: 1,
        maxReconnectDelayMs: 10,
        developmentMode: false,
        mediaRoot: 'data/media',
      },
      environment.metaWhatsApp,
    );

    expect(environment.metaWhatsApp.accounts[0]?.botId).toBe('negocio-ejemplo');
    expect(database.getBotIdByMetaPhoneNumberId('123456789012345')).toBe('negocio-ejemplo');
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'META_ACCOUNT_ASSISTANT_MISSING' }),
      expect.any(String),
    );
  });
});
