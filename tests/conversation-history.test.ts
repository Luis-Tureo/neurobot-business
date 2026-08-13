import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { AppDatabase } from '../src/persistence/database.js';

function profile(name: string) {
  return createProfileFromPreset({
    organizationName: name,
    botName: `Asistente ${name}`,
    organizationType: 'Tienda',
    timezone: 'America/Santiago',
    preset: 'store',
  });
}

function createBusiness(database: AppDatabase, id: string, name: string) {
  return database.createBot({ id, mode: 'business', profile: profile(name) });
}

describe('historial persistente de conversaciones', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
  });

  afterEach(() => database.close());

  it('crea, reutiliza y separa conversaciones por asistente y cliente', () => {
    const first = createBusiness(database, 'historial-uno', 'Uno');
    const second = createBusiness(database, 'historial-dos', 'Dos');
    const initial = database.getOrCreateConversation({
      assistantId: first.id,
      phoneNumberId: '111111111111111',
      waId: '56911111111',
      contactName: 'Ana',
      activityAt: '2026-08-10T10:00:00.000Z',
    });
    const reused = database.getOrCreateConversation({
      assistantId: first.id,
      phoneNumberId: '111111111111111',
      waId: '56911111111@c.us',
      contactName: 'Ana María',
      activityAt: '2026-08-10T10:01:00.000Z',
    });
    const anotherCustomer = database.getOrCreateConversation({
      assistantId: first.id,
      phoneNumberId: '111111111111111',
      waId: '56922222222',
    });
    const anotherAssistant = database.getOrCreateConversation({
      assistantId: second.id,
      phoneNumberId: '222222222222222',
      waId: '56911111111',
    });

    expect(reused.id).toBe(initial.id);
    expect(reused.contactName).toBe('Ana María');
    expect(anotherCustomer.id).not.toBe(initial.id);
    expect(anotherAssistant.id).not.toBe(initial.id);
  });

  it('guarda inbound, outbound y multimedia, deduplica wamid y actualiza estados sin retroceder', () => {
    const bot = createBusiness(database, 'historial-mensajes', 'Mensajes');
    const common = {
      assistantId: bot.id,
      phoneNumberId: '123456789012345',
      waId: '56912345678',
      contactName: 'Cliente Real',
    };
    const inbound = database.recordConversationMessage({
      ...common,
      whatsappMessageId: 'wamid.inbound.text',
      direction: 'inbound',
      senderType: 'customer',
      messageType: 'text',
      text: '¿Tienen horario hoy?',
      messageTimestamp: '2026-08-10T10:00:00.000Z',
    });
    const duplicate = database.recordConversationMessage({
      ...common,
      whatsappMessageId: 'wamid.inbound.text',
      direction: 'inbound',
      senderType: 'customer',
      messageType: 'text',
      text: 'Texto que no debe reemplazar el original',
      messageTimestamp: '2026-08-10T10:00:01.000Z',
    });
    const outbound = database.recordConversationMessage({
      ...common,
      whatsappMessageId: 'wamid.outbound.text',
      direction: 'outbound',
      senderType: 'assistant',
      messageType: 'text',
      text: 'Atendemos hasta las 18:00.',
      messageTimestamp: '2026-08-10T10:00:02.000Z',
    });
    database.recordConversationMessage({
      ...common,
      whatsappMessageId: 'wamid.inbound.image',
      direction: 'inbound',
      senderType: 'customer',
      messageType: 'image',
      text: 'Producto consultado',
      caption: 'Producto consultado',
      messageTimestamp: '2026-08-10T10:00:03.000Z',
    });
    database.recordConversationMessage({
      ...common,
      whatsappMessageId: 'wamid.inbound.audio',
      direction: 'inbound',
      senderType: 'customer',
      messageType: 'audio',
      text: '[Audio]',
      messageTimestamp: '2026-08-10T10:00:04.000Z',
    });

    expect(inbound.inserted).toBe(true);
    expect(duplicate).toMatchObject({ inserted: false, message: { text: '¿Tienen horario hoy?' } });
    expect(outbound.conversation.id).toBe(inbound.conversation.id);
    expect(
      database.updateConversationMessageStatus({
        whatsappMessageId: 'wamid.outbound.text',
        status: 'sent',
        occurredAt: '2026-08-10T10:00:05.000Z',
      }),
    ).toBe(true);
    expect(
      database.updateConversationMessageStatus({
        whatsappMessageId: 'wamid.outbound.text',
        status: 'delivered',
        occurredAt: '2026-08-10T10:00:06.000Z',
      }),
    ).toBe(true);
    expect(
      database.updateConversationMessageStatus({
        whatsappMessageId: 'wamid.outbound.text',
        status: 'read',
        occurredAt: '2026-08-10T10:00:07.000Z',
      }),
    ).toBe(true);
    expect(
      database.updateConversationMessageStatus({
        whatsappMessageId: 'wamid.outbound.text',
        status: 'sent',
        occurredAt: '2026-08-10T10:00:08.000Z',
      }),
    ).toBe(false);

    database.recordConversationMessage({
      ...common,
      whatsappMessageId: 'wamid.outbound.failed',
      direction: 'outbound',
      senderType: 'assistant',
      messageType: 'text',
      text: 'Mensaje rechazado',
      messageTimestamp: '2026-08-10T10:00:09.000Z',
    });
    const unsafeError =
      'Bearer secreto-real https://temporary.example/file?access_token=secreto access_token=otro\n' +
      'x'.repeat(500);
    expect(
      database.updateConversationMessageStatus({
        whatsappMessageId: 'wamid.outbound.failed',
        status: 'failed',
        occurredAt: '2026-08-10T10:00:10.000Z',
        errorCode: '131047 / unsafe',
        errorMessage: unsafeError,
      }),
    ).toBe(true);

    const messages = database.listConversationMessages(inbound.conversation.id, 1, 20);
    expect(messages?.messages.total).toBe(5);
    expect(messages?.messages.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: 'image', caption: 'Producto consultado' }),
        expect.objectContaining({ messageType: 'audio', text: '[Audio]', caption: null }),
        expect.objectContaining({
          whatsappMessageId: 'wamid.outbound.text',
          whatsappStatus: 'read',
        }),
      ]),
    );
    const failed = messages?.messages.items.find(
      (message) => message.whatsappMessageId === 'wamid.outbound.failed',
    );
    expect(failed).toMatchObject({ whatsappStatus: 'failed', errorCode: '131047___unsafe' });
    expect(failed?.errorMessage).toContain('Bearer [oculto]');
    expect(failed?.errorMessage).not.toContain('secreto-real');
    expect(failed?.errorMessage).not.toContain('temporary.example');
    expect(failed?.errorMessage?.length).toBeLessThanOrEqual(300);
  });

  it('busca, filtra por asistente y fecha, y pagina en SQLite conversaciones y mensajes', () => {
    const first = createBusiness(database, 'historial-filtro-uno', 'Filtro Uno');
    const second = createBusiness(database, 'historial-filtro-dos', 'Filtro Dos');
    const records = [
      [first.id, '111111111111111', '56910000001', 'Alicia', '2026-08-09T12:00:00.000Z'],
      [first.id, '111111111111111', '56910000002', 'Beatriz', '2026-08-10T12:00:00.000Z'],
      [second.id, '222222222222222', '56910000003', 'Carla', '2026-08-11T12:00:00.000Z'],
    ] as const;
    for (const [assistantId, phoneNumberId, waId, contactName, timestamp] of records) {
      database.recordConversationMessage({
        assistantId,
        phoneNumberId,
        waId,
        contactName,
        whatsappMessageId: `wamid.${waId}.1`,
        direction: 'inbound',
        senderType: 'customer',
        messageType: 'text',
        text: `Mensaje de ${contactName}`,
        messageTimestamp: timestamp,
      });
    }

    expect(database.listConversations({ page: 1, pageSize: 10, search: 'Bea' }).items).toHaveLength(
      1,
    );
    expect(
      database.listConversations({ page: 1, pageSize: 10, search: '56910000003' }).items[0],
    ).toMatchObject({ contactName: 'Carla' });
    expect(database.listConversations({ page: 1, pageSize: 10, assistantId: first.id }).total).toBe(
      2,
    );
    expect(
      database.listConversations({
        page: 1,
        pageSize: 10,
        from: '2026-08-10T00:00:00.000Z',
        toExclusive: '2026-08-11T00:00:00.000Z',
      }).items[0],
    ).toMatchObject({ contactName: 'Beatriz' });
    expect(database.listConversations({ page: 1, pageSize: 2 })).toMatchObject({
      total: 3,
      totalPages: 2,
      items: [{ contactName: 'Carla' }, { contactName: 'Beatriz' }],
    });
    expect(database.listConversations({ page: 2, pageSize: 2 }).items[0]).toMatchObject({
      contactName: 'Alicia',
    });

    const conversation = database.listConversations({ page: 1, pageSize: 10, search: 'Alicia' })
      .items[0]!;
    for (let index = 2; index <= 5; index += 1) {
      database.recordConversationMessage({
        assistantId: first.id,
        phoneNumberId: '111111111111111',
        waId: '56910000001',
        whatsappMessageId: `wamid.56910000001.${index}`,
        direction: 'outbound',
        senderType: 'assistant',
        messageType: 'text',
        text: `Respuesta ${index}`,
        messageTimestamp: `2026-08-09T12:0${index}:00.000Z`,
      });
    }
    const latest = database.listConversationMessages(conversation.id, 1, 2);
    const older = database.listConversationMessages(conversation.id, 2, 2);
    expect(latest?.messages).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(latest?.messages.items.map((message) => message.text)).toEqual([
      'Respuesta 4',
      'Respuesta 5',
    ]);
    expect(older?.messages.items.map((message) => message.text)).toEqual([
      'Respuesta 2',
      'Respuesta 3',
    ]);
  });
});

describe('migración de historial', () => {
  it('funciona en una base nueva, es idempotente y pasa PRAGMA quick_check', () => {
    const database = new AppDatabase(':memory:');
    database.migrate();
    database.migrate();
    expect(database.getMigrationVersions()).toContain(23);
    expect(database.quickCheck()).toEqual(['ok']);
    database.close();
  });

  it('migra una base existente sin perder datos anteriores', () => {
    const directory = mkdtempSync(join(tmpdir(), 'neurobot-conversation-migration-'));
    const path = join(directory, 'existing.sqlite');
    try {
      const initial = new AppDatabase(path);
      initial.migrate();
      initial.setSetting('legacy_marker', { preserved: true });
      initial.close();

      const legacy = new BetterSqlite3(path);
      legacy.exec(`
        PRAGMA foreign_keys=OFF;
        DROP TABLE conversation_messages;
        DROP TABLE conversations;
        DELETE FROM migrations WHERE version=23;
      `);
      legacy.close();

      const migrated = new AppDatabase(path);
      migrated.migrate();
      expect(migrated.getSetting('legacy_marker', null)).toEqual({ preserved: true });
      expect(migrated.getMigrationVersions()).toContain(23);
      expect(migrated.quickCheck()).toEqual(['ok']);
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
