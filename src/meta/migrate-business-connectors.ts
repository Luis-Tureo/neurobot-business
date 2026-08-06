import BetterSqlite3 from 'better-sqlite3';

export type BusinessConnectorMigrationResult = {
  inspected: number;
  migrated: number;
};

export function migrateBusinessConnectorsToMeta(input: {
  databasePath: string;
  metaPhoneNumberId?: string;
}): BusinessConnectorMigrationResult {
  const database = new BetterSqlite3(input.databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  const assistants = database
    .prepare(
      `SELECT id, active_connector_id
       FROM bots
       WHERE mode = 'business' AND connector_type <> 'WHATSAPP_CLOUD_API'`,
    )
    .all() as Array<{ id: string; active_connector_id: number | null }>;
  const now = new Date().toISOString();
  let migrated = 0;

  const operation = database.transaction(() => {
    for (const assistant of assistants) {
      let connectorId = assistant.active_connector_id;
      if (connectorId === null) {
        const result = database
          .prepare(
            `INSERT INTO assistant_connectors(
               assistant_id, connector_type, meta_phone_number_id,
               public_webhook_identifier, connector_status, created_at, updated_at
             ) VALUES (?, 'WHATSAPP_CLOUD_API', ?, ?, 'UNLINKED', ?, ?)`,
          )
          .run(
            assistant.id,
            input.metaPhoneNumberId ?? null,
            assistant.id,
            now,
            now,
          );
        connectorId = Number(result.lastInsertRowid);
      } else {
        database
          .prepare(
            `UPDATE assistant_connectors
             SET connector_type = 'WHATSAPP_CLOUD_API',
                 whatsapp_web_client_id = NULL,
                 local_auth_session_key = NULL,
                 local_auth_session_path = NULL,
                 normalized_phone_hash = NULL,
                 whatsapp_identity_hash = NULL,
                 meta_phone_number_id = ?,
                 public_webhook_identifier = ?,
                 session_ownership_verified = 0,
                 connector_status = 'UNLINKED',
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(input.metaPhoneNumberId ?? null, assistant.id, now, connectorId);
      }

      database
        .prepare(
          `UPDATE bots
           SET connector_type = 'WHATSAPP_CLOUD_API',
               operating_mode = 'BUSINESS_PRIVATE',
               group_channel_enabled = 0,
               private_channel_enabled = 1,
               private_business_mode_enabled = 0,
               active_connector_id = ?,
               connector_migration_locked = 1,
               lifecycle_status = 'UNLINKED',
               masked_number = NULL,
               last_connected_at = NULL,
               groups_enabled = 0,
               private_messages_enabled = 1,
               real_mention_required = 0,
               continued_conversations_enabled = 1,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(connectorId, now, assistant.id);
      migrated += 1;
    }
  });

  try {
    operation();
    return { inspected: assistants.length, migrated };
  } finally {
    database.close();
  }
}
