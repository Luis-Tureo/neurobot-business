import BetterSqlite3 from 'better-sqlite3';
import { migrateBusinessSchema } from '../src/persistence/business-schema.js';

describe('migración irreversible a Business', () => {
  it('elimina asistentes heredados y conserva negocio, administradores e historial privado', () => {
    const database = legacyDatabase();
    try {
      insertLegacyAssistant(database, {
        id: 'negocio-real',
        name: 'Tienda Real',
        type: 'Tienda',
        enabled: 1,
      });
      insertLegacyAssistant(database, {
        id: 'asistente-heredado',
        name: 'Comunidad Neurodivergente – Autismo y TDAH',
        type: 'Comunidad',
        enabled: 1,
      });
      database
        .prepare('INSERT INTO administrators(participant_id,created_at) VALUES (?,?)')
        .run('56912345678@c.us', '2026-08-01T00:00:00.000Z');
      insertConversation(database, 'business-conversation', 'negocio-real', '56911111111');
      insertConversation(database, 'legacy-conversation', 'asistente-heredado', '56922222222');

      migrateBusinessSchema(database);
      migrateBusinessSchema(database);

      expect(tableNames(database)).not.toEqual(
        expect.arrayContaining(['groups', 'poll_templates', 'commands']),
      );
      expect(
        database.prepare('SELECT id FROM bots ORDER BY id').all() as Array<{ id: string }>,
      ).toEqual([{ id: 'negocio-real' }]);
      expect(
        database.prepare('SELECT organization_type FROM assistant_profiles').get() as {
          organization_type: string;
        },
      ).toEqual({ organization_type: 'Comercio' });
      expect(
        database.prepare('SELECT phone_number FROM administrators').get() as {
          phone_number: string;
        },
      ).toEqual({ phone_number: '56912345678@c.us' });
      expect(
        database
          .prepare(
            `SELECT id,assistant_id,assistant_name_snapshot
             FROM conversations ORDER BY id`,
          )
          .all() as Array<Record<string, unknown>>,
      ).toEqual([
        {
          id: 'business-conversation',
          assistant_id: 'negocio-real',
          assistant_name_snapshot: 'Tienda Real',
        },
        {
          id: 'legacy-conversation',
          assistant_id: null,
          assistant_name_snapshot: 'Comunidad Neurodivergente – Autismo y TDAH',
        },
      ]);
      expect(database.prepare('SELECT COUNT(*) AS count FROM conversation_messages').get()).toEqual(
        { count: 2 },
      );
      expect(database.prepare('SELECT version FROM migrations ORDER BY version').all()).toEqual([
        { version: 23 },
        { version: 24 },
        { version: 25 },
        { version: 26 },
      ]);
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('crea un negocio de ejemplo solo cuando no queda ningún negocio válido', () => {
    const database = legacyDatabase();
    try {
      insertLegacyAssistant(database, {
        id: 'solo-heredado',
        name: 'Comunidad Neurodivergente – Autismo y TDAH',
        type: 'Comunidad',
        enabled: 1,
      });

      migrateBusinessSchema(database);

      expect(database.prepare('SELECT * FROM bots').all()).toEqual([
        expect.objectContaining({
          id: 'negocio-ejemplo',
          connector_type: 'WHATSAPP_CLOUD_API',
          lifecycle_status: 'UNLINKED',
          enabled: 0,
        }),
      ]);
      expect(
        database
          .prepare('SELECT organization_name,organization_type FROM assistant_profiles')
          .get(),
      ).toEqual({ organization_name: 'Negocio de ejemplo', organization_type: 'Comercio' });
      expect(
        database.prepare('SELECT meta_phone_number_id FROM assistant_connectors').get(),
      ).toEqual({ meta_phone_number_id: null });
    } finally {
      database.close();
    }
  });
});

function legacyDatabase(): BetterSqlite3.Database {
  const database = new BetterSqlite3(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO migrations VALUES (23,'2026-08-01T00:00:00.000Z');
    CREATE TABLE bots(
      id TEXT PRIMARY KEY,internal_identifier TEXT NOT NULL UNIQUE,client_id TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,connector_type TEXT NOT NULL,lifecycle_status TEXT NOT NULL,
      deletion_locked INTEGER NOT NULL DEFAULT 0,deleted_at TEXT,
      scheduled_permanent_deletion_at TEXT,active_connector_id INTEGER,
      enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE assistant_profiles(
      id INTEGER PRIMARY KEY AUTOINCREMENT,profile_key TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      internal_name TEXT NOT NULL,organization_name TEXT NOT NULL,bot_name TEXT NOT NULL,
      activation_alias TEXT NOT NULL,description TEXT NOT NULL,organization_type TEXT NOT NULL,
      industry TEXT NOT NULL,objective TEXT NOT NULL,allowed_topics TEXT NOT NULL,
      excluded_topics TEXT NOT NULL,tone TEXT NOT NULL,out_of_scope_message TEXT NOT NULL,
      no_information_message TEXT NOT NULL,limit_message TEXT NOT NULL,ai_error_message TEXT NOT NULL,
      medical_message TEXT NOT NULL,mention_prompt_message TEXT NOT NULL,
      community_greeting_message TEXT NOT NULL,contact_information TEXT NOT NULL,
      business_hours TEXT NOT NULL,address TEXT,timezone TEXT NOT NULL,active INTEGER NOT NULL,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE bot_profiles(
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL UNIQUE REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE administrators(participant_id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE conversations(
      id TEXT PRIMARY KEY,assistant_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      phone_number_id TEXT NOT NULL,wa_id TEXT NOT NULL,contact_name TEXT,status TEXT NOT NULL,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_message_at TEXT NOT NULL,
      UNIQUE(assistant_id,phone_number_id,wa_id)
    );
    CREATE TABLE conversation_messages(
      id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      whatsapp_message_id TEXT,direction TEXT NOT NULL,sender_type TEXT NOT NULL,
      message_type TEXT NOT NULL,text_content TEXT,caption TEXT,message_timestamp TEXT NOT NULL,
      whatsapp_status TEXT NOT NULL,error_code TEXT,error_message TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE groups(id TEXT PRIMARY KEY);
    CREATE TABLE poll_templates(id INTEGER PRIMARY KEY);
    CREATE TABLE commands(id INTEGER PRIMARY KEY);
  `);
  return database;
}

function insertLegacyAssistant(
  database: BetterSqlite3.Database,
  input: { id: string; name: string; type: string; enabled: number },
): void {
  const now = '2026-08-01T00:00:00.000Z';
  database
    .prepare(
      `INSERT INTO bots(
         id,internal_identifier,client_id,mode,connector_type,lifecycle_status,
         enabled,created_at,updated_at
       ) VALUES (?,?,?,'community','WHATSAPP_CLOUD_API','CONNECTED',?,?,?)`,
    )
    .run(input.id, input.id, input.id, input.enabled, now, now);
  if (input.type !== 'Comunidad') {
    database.prepare('UPDATE bots SET mode=? WHERE id=?').run('business', input.id);
  }
  const profile = database
    .prepare(
      `INSERT INTO assistant_profiles(
         profile_key,bot_id,internal_name,organization_name,bot_name,activation_alias,
         description,organization_type,industry,objective,allowed_topics,excluded_topics,tone,
         out_of_scope_message,no_information_message,limit_message,ai_error_message,medical_message,
         mention_prompt_message,community_greeting_message,contact_information,business_hours,
         address,timezone,active,created_at,updated_at
       ) VALUES (?,?,?,?,?,'@asistente','Descripción',?,'Rubro','Objetivo','[]','[]','Claro',
         'Fuera de alcance','Sin información','Límite','Error','Consulta a un profesional',
         'Consulta incompleta','Saludo heredado','','',NULL,'America/Santiago',1,?,?)`,
    )
    .run(`${input.id}-profile`, input.id, input.name, input.name, input.name, input.type, now, now);
  database
    .prepare('INSERT INTO bot_profiles(bot_id,profile_id,created_at,updated_at) VALUES (?,?,?,?)')
    .run(input.id, Number(profile.lastInsertRowid), now, now);
}

function insertConversation(
  database: BetterSqlite3.Database,
  id: string,
  assistantId: string,
  waId: string,
): void {
  const now = '2026-08-01T12:00:00.000Z';
  database
    .prepare(
      `INSERT INTO conversations(
         id,assistant_id,phone_number_id,wa_id,contact_name,status,
         created_at,updated_at,last_message_at
       ) VALUES (?,?, '123456789012345',?,'Cliente','active',?,?,?)`,
    )
    .run(id, assistantId, waId, now, now, now);
  database
    .prepare(
      `INSERT INTO conversation_messages(
         id,conversation_id,whatsapp_message_id,direction,sender_type,message_type,
         text_content,message_timestamp,whatsapp_status,created_at,updated_at
       ) VALUES (?,?,?,'inbound','customer','text','Mensaje privado',?,'received',?,?)`,
    )
    .run(`${id}-message`, id, `${id}-wa`, now, now, now);
}

function tableNames(database: BetterSqlite3.Database): string[] {
  return (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}
