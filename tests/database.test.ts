import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { AppDatabase } from '../src/persistence/database.js';

describe('persistencia Business', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
  });

  afterEach(() => database.close());

  it('crea una base nueva con un negocio de ejemplo desactivado y sin vincular', () => {
    expect(database.getMigrationVersions()).toEqual([24]);
    expect(database.quickCheck()).toEqual(['ok']);
    expect(database.listBots()).toEqual([
      expect.objectContaining({
        id: 'negocio-ejemplo',
        organizationName: 'Negocio de ejemplo',
        organizationType: 'Comercio',
        connectorType: 'WHATSAPP_CLOUD_API',
        lifecycleStatus: 'UNLINKED',
        enabled: false,
        maskedNumber: null,
      }),
    ]);
    expect(database.getBotProfile('negocio-ejemplo')).toMatchObject({
      organizationName: 'Negocio de ejemplo',
      organizationType: 'Comercio',
      active: true,
    });
    expect(database.listMenus('negocio-ejemplo')).toEqual([
      expect.objectContaining({ isInitial: true, enabled: true }),
    ]);
  });

  it('crea asistentes empresariales aislados con Cloud API', () => {
    const bot = database.createBot({
      id: 'tienda-central',
      connectorType: 'WHATSAPP_CLOUD_API',
      menuType: 'numbered',
      profile: createProfileFromPreset({
        organizationName: 'Tienda Central',
        botName: 'Asistente Central',
        organizationType: 'Comercio',
        timezone: 'America/Santiago',
        preset: 'store',
      }),
    });

    expect(bot).toMatchObject({
      id: 'tienda-central',
      connectorType: 'WHATSAPP_CLOUD_API',
      lifecycleStatus: 'DRAFT',
      enabled: false,
      menuType: 'numbered',
    });
    expect(bot.capabilities).toEqual({
      privateChatsEnabled: true,
      conversationContinuationEnabled: true,
      interactiveMenusEnabled: true,
      numericMenuRepliesEnabled: true,
      catalogEnabled: true,
      humanAssistanceEnabled: true,
    });
    expect(database.getBotProfile(bot.id).organizationName).toBe('Tienda Central');
  });

  it('mantiene únicos los números de Meta entre asistentes activos', () => {
    const second = database.createBot({
      id: 'segundo-negocio',
      profile: createProfileFromPreset({
        organizationName: 'Segundo negocio',
        botName: 'Segundo asistente',
        organizationType: 'Servicios',
        timezone: 'America/Santiago',
        preset: 'service',
      }),
    });
    database.configureMetaConnector('negocio-ejemplo', '123456789012345');
    expect(() => database.configureMetaConnector(second.id, '123456789012345')).toThrow();
    expect(database.getBotIdByMetaPhoneNumberId('123456789012345')).toBe('negocio-ejemplo');
  });

  it('registra administradores y actividad con identificadores seguros', () => {
    expect(database.addAdministrator('+56 9 1234 5678')).toBe(true);
    expect(database.addAdministrator('56912345678@c.us')).toBe(false);
    expect(database.isAdministrator('56912345678')).toBe(true);
    expect(database.listAdministrators()).toEqual(['56912345678@c.us']);

    database.recordTechnicalEvent({
      botId: 'negocio-ejemplo',
      eventType: 'PRIVATE_RESPONSE_SENT',
      source: 'private',
      conversationHash: 'conversation-hash',
      customerHash: 'customer-hash',
      result: 'ok',
    });
    expect(database.listAssistantActivity('negocio-ejemplo')).toEqual([
      expect.objectContaining({
        eventType: 'PRIVATE_RESPONSE_SENT',
        conversationHash: 'conversation-hash',
        customerHash: 'customer-hash',
      }),
    ]);
  });
});
