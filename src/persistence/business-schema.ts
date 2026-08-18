import type BetterSqlite3 from 'better-sqlite3';
import { DEFAULT_BUSINESS_ASSISTANT_ID } from '../domain/business-defaults.js';
import {
  LEGACY_ORGANIZATION_TYPE_ALIASES,
  ORGANIZATION_TYPES,
} from '../domain/organization-types.js';

const LEGACY_BUSINESS_SCHEMA_VERSION = 24;
const SAAS_SCHEMA_VERSION = 25;
const ASSISTANT_PLATFORM_SCHEMA_VERSION = 26;
const ORGANIZATION_TYPE_SQL_VALUES = ORGANIZATION_TYPES.map(sqlStringLiteral).join(',');
const LEGACY_ORGANIZATION_TYPE_SQL_CASES = Object.entries(LEGACY_ORGANIZATION_TYPE_ALIASES)
  .map(
    ([legacy, canonical]) => `WHEN ${sqlStringLiteral(legacy)} THEN ${sqlStringLiteral(canonical)}`,
  )
  .join('\n      ');

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function migrateBusinessSchema(database: BetterSqlite3.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const legacyApplied =
    database
      .prepare('SELECT 1 FROM migrations WHERE version = ?')
      .get(LEGACY_BUSINESS_SCHEMA_VERSION) !== undefined;
  const saasApplied =
    database.prepare('SELECT 1 FROM migrations WHERE version = ?').get(SAAS_SCHEMA_VERSION) !==
    undefined;
  const assistantPlatformApplied =
    database
      .prepare('SELECT 1 FROM migrations WHERE version = ?')
      .get(ASSISTANT_PLATFORM_SCHEMA_VERSION) !== undefined;
  if (legacyApplied && saasApplied && assistantPlatformApplied) {
    normalizeBusinessOrganizationTypes(database);
    createBusinessSchema(database);
    createSaasSchema(database);
    createAssistantPlatformSchema(database);
    ensureBusinessExample(database);
    return;
  }

  const foreignKeysEnabled = Number(database.pragma('foreign_keys', { simple: true })) === 1;
  if (foreignKeysEnabled) database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      if (
        !legacyApplied &&
        tableExists(database, 'bots') &&
        columnExists(database, 'bots', 'mode')
      ) {
        migrateLegacySchema(database);
      }
      normalizeBusinessOrganizationTypes(database);
      createBusinessSchema(database);
      if (!legacyApplied) {
        ensureBusinessExample(database);
        database
          .prepare('INSERT INTO migrations(version, applied_at) VALUES (?, ?)')
          .run(LEGACY_BUSINESS_SCHEMA_VERSION, new Date().toISOString());
      }
      createSaasSchema(database);
      createAssistantPlatformSchema(database);
      ensureBusinessExample(database);
      if (!saasApplied) {
        database
          .prepare('INSERT INTO migrations(version, applied_at) VALUES (?, ?)')
          .run(SAAS_SCHEMA_VERSION, new Date().toISOString());
      }
      if (!assistantPlatformApplied) {
        database
          .prepare('INSERT INTO migrations(version, applied_at) VALUES (?, ?)')
          .run(ASSISTANT_PLATFORM_SCHEMA_VERSION, new Date().toISOString());
      }
    })();
  } finally {
    if (foreignKeysEnabled) database.pragma('foreign_keys = ON');
  }

  const violations = database.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('BUSINESS_MIGRATION_FOREIGN_KEY_CHECK_FAILED');
}

function migrateLegacySchema(database: BetterSqlite3.Database): void {
  const communityAssistantIds = (
    database
      .prepare(
        `SELECT DISTINCT bots.id
         FROM bots
         LEFT JOIN bot_profiles mapping ON mapping.bot_id=bots.id
         LEFT JOIN assistant_profiles profiles ON profiles.id=mapping.profile_id
         WHERE lower(bots.mode)='community'
            OR lower(COALESCE(profiles.organization_type,'')) IN ('comunidad','community','grupo','group')
            OR lower(COALESCE(profiles.organization_name,'')) LIKE 'comunidad neurodivergente%'`,
      )
      .all() as Array<{ id: string }>
  ).map((row) => row.id);

  preserveConversationHistory(database, new Set(communityAssistantIds));
  dropLegacyDomainTables(database);
  deleteCommunityAssistantData(database, communityAssistantIds);

  database.exec(`
    DROP INDEX IF EXISTS idx_ai_group_daily;
    DROP INDEX IF EXISTS idx_bot_interaction_latest;
  `);
  renameTable(database, 'ai_usage_by_group', 'ai_usage_by_conversation');
  renameColumn(database, 'ai_usage_by_conversation', 'group_hash', 'conversation_hash');
  renameColumn(database, 'ai_request_reservations', 'group_hash', 'conversation_hash');
  renameColumn(database, 'ai_usage_events', 'group_hash', 'conversation_hash');
  renameColumn(database, 'technical_events', 'group_hash', 'conversation_hash');
  renameColumn(database, 'technical_events', 'user_hash', 'customer_hash');
  renameColumn(database, 'administrators', 'participant_id', 'phone_number');
  renameColumn(database, 'ai_settings', 'group_hourly_limit', 'conversation_hourly_limit');
  renameColumn(database, 'ai_settings', 'group_daily_limit', 'conversation_daily_limit');

  for (const column of [
    'activation_alias',
    'mention_prompt_message',
    'community_greeting_message',
  ]) {
    dropColumn(database, 'assistant_profiles', column);
  }
  for (const column of [
    'mode',
    'operating_mode',
    'assistant_type',
    'group_channel_enabled',
    'private_channel_enabled',
    'private_business_mode_enabled',
    'connector_migration_locked',
  ]) {
    dropColumn(database, 'bots', column);
  }
  for (const column of ['groups_enabled', 'private_messages_enabled', 'real_mention_required']) {
    dropColumn(database, 'bot_channel_settings', column);
  }
  for (const column of [
    'community_single_turn_mode',
    'polls_as_menus_enabled',
    'polls_for_community_engagement_enabled',
  ]) {
    dropColumn(database, 'bot_capabilities', column);
  }
  for (const column of [
    'command_name',
    'template_id',
    'category',
    'local_date',
    'local_time',
    'attempt',
  ]) {
    dropColumn(database, 'technical_events', column);
  }

  rebuildKnowledgeEntries(database);
  if (tableExists(database, 'cached_answers')) {
    database
      .prepare(
        "UPDATE cached_answers SET prompt_version='business-v1' WHERE prompt_version='community-v1'",
      )
      .run();
  }
}

function normalizeBusinessOrganizationTypes(database: BetterSqlite3.Database): void {
  if (!tableExists(database, 'assistant_profiles')) return;
  database.exec(`
    UPDATE assistant_profiles SET organization_type = CASE organization_type
      ${LEGACY_ORGANIZATION_TYPE_SQL_CASES}
      ELSE organization_type
    END;
  `);
}

function preserveConversationHistory(
  database: BetterSqlite3.Database,
  removedAssistantIds: ReadonlySet<string>,
): void {
  if (!tableExists(database, 'conversations')) return;
  database.exec(`
    DROP INDEX IF EXISTS idx_conversation_messages_whatsapp_id;
    DROP INDEX IF EXISTS idx_conversation_messages_timeline;
    DROP INDEX IF EXISTS idx_conversations_assistant_activity;
    DROP INDEX IF EXISTS idx_conversations_activity;
    DROP INDEX IF EXISTS idx_conversations_wa_id;
    DROP INDEX IF EXISTS idx_conversations_phone_number;
    DROP INDEX IF EXISTS idx_conversations_contact_name;
    ALTER TABLE conversation_messages RENAME TO conversation_messages_v23;
    ALTER TABLE conversations RENAME TO conversations_v23;
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      assistant_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
      assistant_name_snapshot TEXT NOT NULL,
      phone_number_id TEXT NOT NULL,
      wa_id TEXT NOT NULL,
      contact_name TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      UNIQUE(assistant_id, phone_number_id, wa_id)
    );
    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      whatsapp_message_id TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
      sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','assistant','system')),
      message_type TEXT NOT NULL,
      text_content TEXT,
      caption TEXT,
      message_timestamp TEXT NOT NULL,
      whatsapp_status TEXT NOT NULL CHECK (whatsapp_status IN (
        'received','accepted','sent','delivered','read','failed','deleted','unknown'
      )),
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const selectName = tableExists(database, 'bot_profiles')
    ? `(SELECT profiles.bot_name FROM bot_profiles mapping
        JOIN assistant_profiles profiles ON profiles.id=mapping.profile_id
        WHERE mapping.bot_id=legacy.assistant_id)`
    : 'NULL';
  const insert = database.prepare(
    `INSERT INTO conversations(
       id,assistant_id,assistant_name_snapshot,phone_number_id,wa_id,contact_name,status,
       created_at,updated_at,last_message_at
     ) SELECT id,?,COALESCE(${selectName},'Asistente eliminado'),phone_number_id,wa_id,
       contact_name,status,created_at,updated_at,last_message_at
     FROM conversations_v23 legacy WHERE id=?`,
  );
  const rows = database.prepare('SELECT id,assistant_id FROM conversations_v23').all() as Array<{
    id: string;
    assistant_id: string;
  }>;
  for (const row of rows) {
    insert.run(removedAssistantIds.has(row.assistant_id) ? null : row.assistant_id, row.id);
  }
  database.exec(`
    INSERT INTO conversation_messages SELECT * FROM conversation_messages_v23;
    DROP TABLE conversation_messages_v23;
    DROP TABLE conversations_v23;
  `);
}

function dropLegacyDomainTables(database: BetterSqlite3.Database): void {
  const tables = [
    'group_moderation_admin_recipients',
    'group_moderation_tests',
    'group_moderation_profiles',
    'moderation_rule_conditions',
    'moderation_rule_exceptions',
    'moderation_terms',
    'moderation_cases',
    'moderation_recurrence',
    'moderation_metrics',
    'moderation_rules',
    'assistant_group_moderation_settings',
    'assistant_moderation_settings',
    'assistant_poll_template_settings',
    'bot_poll_send_history',
    'bot_poll_date_overrides',
    'bot_poll_configurations',
    'bot_poll_options',
    'bot_poll_templates',
    'poll_send_history',
    'poll_date_overrides',
    'poll_schedule_config',
    'poll_options',
    'poll_templates',
    'poll_settings',
    'bot_welcome_group_runtime',
    'bot_welcome_deduplication',
    'bot_welcome_baseline',
    'bot_welcome_runtime',
    'assistant_group_welcome_settings',
    'assistant_welcome_settings',
    'bot_scheduled_message_deliveries',
    'bot_automatic_group_backoff',
    'bot_automatic_configurations',
    'bot_automation_settings',
    'scheduled_message_deliveries',
    'automatic_group_backoff',
    'automatic_message_templates',
    'automatic_message_tasks',
    'bot_groups',
    'blocked_groups',
    'linked_groups',
    'groups',
    'silences',
    'keywords',
    'commands',
    'bot_activation_aliases',
    'bot_interaction_usage',
    'assistant_capability_assignments',
    'assistant_modules',
    'settings',
  ];
  for (const table of tables) database.exec(`DROP TABLE IF EXISTS "${table}"`);
}

function deleteCommunityAssistantData(
  database: BetterSqlite3.Database,
  assistantIds: readonly string[],
): void {
  for (const assistantId of assistantIds) {
    const profileIds = tableExists(database, 'bot_profiles')
      ? (
          database
            .prepare('SELECT profile_id FROM bot_profiles WHERE bot_id=?')
            .all(assistantId) as Array<{ profile_id: number }>
        ).map((row) => row.profile_id)
      : [];
    deleteBy(
      database,
      'cached_answer_variants',
      'cached_answer_id',
      'cached_answers',
      'id',
      'bot_id',
      assistantId,
    );
    deleteBy(
      database,
      'catalog_item_media',
      'media_id',
      'media_assets',
      'id',
      'bot_id',
      assistantId,
    );
    for (const table of [
      'technical_events',
      'audit_events',
      'meta_message_statuses',
      'cached_answers',
      'assistant_ai_queue_metrics',
      'assistant_ai_queue_settings',
      'assistant_ai_provider_health',
      'assistant_connectors',
      'assistant_deletion_audit',
      'human_assistance_requests',
      'business_hours',
      'catalog_item_media',
      'catalog_items',
      'catalog_categories',
      'media_assets',
      'conversation_states',
      'menu_options',
      'menu_definitions',
      'bot_capabilities',
      'bot_ai_credentials',
      'bot_channel_settings',
      'messaging_runtime',
      'bot_profiles',
    ]) {
      deleteWhere(
        database,
        table,
        table.startsWith('assistant_') ? 'assistant_id' : 'bot_id',
        assistantId,
      );
    }
    for (const profileId of profileIds) {
      for (const table of [
        'ai_usage_events',
        'ai_request_reservations',
        'ai_usage_by_group',
        'ai_usage_by_anonymized_user',
        'ai_usage_monthly',
        'ai_usage_daily',
        'provider_health',
        'ai_settings',
        'knowledge_entries',
        'knowledge_categories',
        'profile_branding',
      ]) {
        deleteWhere(database, table, 'profile_id', profileId);
      }
      deleteWhere(database, 'assistant_profiles', 'id', profileId);
    }
    deleteWhere(database, 'bots', 'id', assistantId);
  }
}

function createBusinessSchema(database: BetterSqlite3.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      internal_identifier TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL UNIQUE,
      connector_type TEXT NOT NULL DEFAULT 'WHATSAPP_CLOUD_API'
        CHECK (connector_type='WHATSAPP_CLOUD_API'),
      lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN (
        'DRAFT','UNLINKED','LINKING','CONNECTED','DUPLICATE_CONFIGURATION','DISABLED',
        'ARCHIVED','PENDING_DELETION','DELETED'
      )),
      deletion_locked INTEGER NOT NULL DEFAULT 0 CHECK (deletion_locked IN (0,1)),
      deleted_at TEXT,
      scheduled_permanent_deletion_at TEXT,
      active_connector_id INTEGER,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assistant_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_key TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      internal_name TEXT NOT NULL,
      organization_name TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      description TEXT NOT NULL,
      organization_type TEXT NOT NULL CHECK (organization_type IN (${ORGANIZATION_TYPE_SQL_VALUES})),
      industry TEXT NOT NULL,
      objective TEXT NOT NULL,
      allowed_topics TEXT NOT NULL,
      excluded_topics TEXT NOT NULL,
      tone TEXT NOT NULL,
      out_of_scope_message TEXT NOT NULL,
      no_information_message TEXT NOT NULL,
      limit_message TEXT NOT NULL,
      ai_error_message TEXT NOT NULL,
      medical_message TEXT NOT NULL,
      contact_information TEXT NOT NULL,
      business_hours TEXT NOT NULL,
      address TEXT,
      timezone TEXT NOT NULL DEFAULT 'America/Santiago',
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_profiles_active_per_bot
      ON assistant_profiles(bot_id) WHERE active=1;
    CREATE TABLE IF NOT EXISTS profile_branding (
      profile_id INTEGER PRIMARY KEY REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      application_name TEXT NOT NULL DEFAULT 'Panel del Asistente',
      header_text TEXT NOT NULL DEFAULT 'Panel del Asistente',
      footer_text TEXT NOT NULL DEFAULT '',
      support_information TEXT NOT NULL DEFAULT '',
      logo_path TEXT,
      primary_color TEXT NOT NULL DEFAULT '#176b61',
      secondary_color TEXT NOT NULL DEFAULT '#d8a446',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_profiles (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL UNIQUE REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messaging_runtime (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'disconnected',
      masked_number TEXT,
      last_connected_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_channel_settings (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      continued_conversations_enabled INTEGER NOT NULL DEFAULT 1 CHECK (continued_conversations_enabled IN (0,1)),
      private_initial_menu_id INTEGER,
      menu_type TEXT NOT NULL DEFAULT 'automatic' CHECK (menu_type IN (
        'automatic','native_buttons','native_list','numbered'
      )),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_ai_credentials (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      credential_mode TEXT NOT NULL DEFAULT 'global' CHECK (credential_mode IN ('global','per_bot')),
      encrypted_api_key TEXT,
      key_fingerprint TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_capabilities (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      private_chats_enabled INTEGER NOT NULL DEFAULT 1 CHECK (private_chats_enabled IN (0,1)),
      conversation_continuation_enabled INTEGER NOT NULL DEFAULT 1 CHECK (conversation_continuation_enabled IN (0,1)),
      interactive_menus_enabled INTEGER NOT NULL DEFAULT 1 CHECK (interactive_menus_enabled IN (0,1)),
      numeric_menu_replies_enabled INTEGER NOT NULL DEFAULT 1 CHECK (numeric_menu_replies_enabled IN (0,1)),
      catalog_enabled INTEGER NOT NULL DEFAULT 1 CHECK (catalog_enabled IN (0,1)),
      human_assistance_enabled INTEGER NOT NULL DEFAULT 1 CHECK (human_assistance_enabled IN (0,1)),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assistant_connectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assistant_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      connector_type TEXT NOT NULL CHECK (connector_type='WHATSAPP_CLOUD_API'),
      meta_phone_number_id TEXT,
      public_webhook_identifier TEXT,
      connector_status TEXT NOT NULL DEFAULT 'UNLINKED' CHECK (connector_status IN (
        'DRAFT','UNLINKED','LINKING','CONNECTED','CONFLICT','DISABLED','ARCHIVED'
      )),
      conflict_reason TEXT,
      linked_assistant_id TEXT REFERENCES bots(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_connector_per_assistant
      ON assistant_connectors(assistant_id) WHERE connector_status NOT IN ('ARCHIVED','DISABLED');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_meta_phone_unique
      ON assistant_connectors(meta_phone_number_id)
      WHERE meta_phone_number_id IS NOT NULL AND connector_status NOT IN ('ARCHIVED','DISABLED');
    CREATE TABLE IF NOT EXISTS assistant_deletion_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assistant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      safe_actor_hash TEXT NOT NULL,
      backup_reference TEXT,
      result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(profile_id,name)
    );
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES knowledge_categories(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '[]',
      synonyms TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      priority INTEGER NOT NULL DEFAULT 0,
      internal_source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_profile
      ON knowledge_entries(profile_id,enabled,priority DESC,updated_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_entries_fts USING fts5(
      title,content,keywords,synonyms,content='knowledge_entries',content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS knowledge_entries_ai AFTER INSERT ON knowledge_entries BEGIN
      INSERT INTO knowledge_entries_fts(rowid,title,content,keywords,synonyms)
      VALUES (new.id,new.title,new.content,new.keywords,new.synonyms);
    END;
    CREATE TRIGGER IF NOT EXISTS knowledge_entries_ad AFTER DELETE ON knowledge_entries BEGIN
      INSERT INTO knowledge_entries_fts(knowledge_entries_fts,rowid,title,content,keywords,synonyms)
      VALUES ('delete',old.id,old.title,old.content,old.keywords,old.synonyms);
    END;
    CREATE TRIGGER IF NOT EXISTS knowledge_entries_au AFTER UPDATE ON knowledge_entries BEGIN
      INSERT INTO knowledge_entries_fts(knowledge_entries_fts,rowid,title,content,keywords,synonyms)
      VALUES ('delete',old.id,old.title,old.content,old.keywords,old.synonyms);
      INSERT INTO knowledge_entries_fts(rowid,title,content,keywords,synonyms)
      VALUES (new.id,new.title,new.content,new.keywords,new.synonyms);
    END;
    CREATE TABLE IF NOT EXISTS ai_settings (
      profile_id INTEGER PRIMARY KEY REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
      provider TEXT NOT NULL DEFAULT 'groq' CHECK (provider IN ('groq','disabled')),
      question_max_chars INTEGER NOT NULL DEFAULT 300,
      context_max_tokens INTEGER NOT NULL DEFAULT 700,
      input_max_tokens INTEGER NOT NULL DEFAULT 1000,
      response_max_tokens INTEGER NOT NULL DEFAULT 120,
      response_max_chars INTEGER NOT NULL DEFAULT 600,
      response_max_lines INTEGER NOT NULL DEFAULT 5,
      temperature REAL NOT NULL DEFAULT 0.2,
      user_hourly_limit INTEGER NOT NULL DEFAULT 20,
      user_daily_limit INTEGER NOT NULL DEFAULT 50,
      user_cooldown_seconds INTEGER NOT NULL DEFAULT 10,
      interaction_hourly_limit INTEGER NOT NULL DEFAULT 60,
      interaction_cooldown_seconds INTEGER NOT NULL DEFAULT 3,
      duplicate_query_window_seconds INTEGER NOT NULL DEFAULT 15,
      conversation_hourly_limit INTEGER NOT NULL DEFAULT 150,
      conversation_daily_limit INTEGER NOT NULL DEFAULT 500,
      global_daily_limit INTEGER NOT NULL DEFAULT 500,
      global_monthly_limit INTEGER NOT NULL DEFAULT 10000,
      global_daily_token_limit INTEGER NOT NULL DEFAULT 50000,
      global_monthly_token_limit INTEGER NOT NULL DEFAULT 1000000,
      timeout_ms INTEGER NOT NULL DEFAULT 15000,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_health (
      profile_id INTEGER PRIMARY KEY REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      connection_status TEXT NOT NULL DEFAULT 'not_tested' CHECK (connection_status IN ('not_tested','successful','failed')),
      last_checked_at TEXT,
      last_error_code TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS global_ai_limits (
      id INTEGER PRIMARY KEY CHECK (id=1),
      daily_request_limit INTEGER NOT NULL DEFAULT 250,
      monthly_request_limit INTEGER NOT NULL DEFAULT 5000,
      daily_token_limit INTEGER NOT NULL DEFAULT 250000,
      monthly_token_limit INTEGER NOT NULL DEFAULT 5000000,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO global_ai_limits(id,updated_at) VALUES (1,datetime('now'));
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      profile_id INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      local_date TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      failed_requests INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(profile_id,local_date)
    );
    CREATE TABLE IF NOT EXISTS ai_usage_monthly (
      profile_id INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      local_month TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      failed_requests INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(profile_id,local_month)
    );
    CREATE TABLE IF NOT EXISTS ai_usage_by_anonymized_user (
      profile_id INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      user_hash TEXT NOT NULL,
      local_date TEXT NOT NULL,
      hour_bucket TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      last_request_at TEXT NOT NULL,
      PRIMARY KEY(profile_id,user_hash,local_date,hour_bucket)
    );
    CREATE TABLE IF NOT EXISTS ai_usage_by_conversation (
      profile_id INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      conversation_hash TEXT NOT NULL,
      local_date TEXT NOT NULL,
      hour_bucket TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(profile_id,conversation_hash,local_date,hour_bucket)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conversation_daily
      ON ai_usage_by_conversation(profile_id,conversation_hash,local_date);
    CREATE TABLE IF NOT EXISTS ai_request_reservations (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      profile_id INTEGER NOT NULL,
      user_hash TEXT NOT NULL,
      conversation_hash TEXT NOT NULL,
      local_date TEXT NOT NULL,
      local_month TEXT NOT NULL,
      hour_bucket TEXT NOT NULL,
      estimated_input_tokens INTEGER NOT NULL,
      reserved_output_tokens INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED','RELEASED')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      local_date TEXT NOT NULL,
      local_month TEXT NOT NULL,
      conversation_hash TEXT,
      user_hash TEXT,
      result TEXT NOT NULL,
      error_code TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assistant_ai_queue_settings (
      assistant_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      max_concurrent INTEGER NOT NULL DEFAULT 3,
      max_queue_size INTEGER NOT NULL DEFAULT 20,
      max_queue_wait_seconds INTEGER NOT NULL DEFAULT 60,
      provider_timeout_seconds INTEGER NOT NULL DEFAULT 25,
      max_retries INTEGER NOT NULL DEFAULT 2,
      initial_retry_delay_seconds INTEGER NOT NULL DEFAULT 2,
      maximum_retry_delay_seconds INTEGER NOT NULL DEFAULT 15,
      wait_notice_seconds INTEGER NOT NULL DEFAULT 5,
      user_cooldown_seconds INTEGER NOT NULL DEFAULT 10,
      duplicate_window_seconds INTEGER NOT NULL DEFAULT 15,
      single_flight_window_seconds INTEGER NOT NULL DEFAULT 60,
      outbound_message_interval_ms INTEGER NOT NULL DEFAULT 1000,
      suggested_retry_seconds INTEGER NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assistant_ai_queue_metrics (
      assistant_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      local_date TEXT NOT NULL,
      queued_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      expired_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      timeout_count INTEGER NOT NULL DEFAULT 0,
      rate_limit_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      coalesced_count INTEGER NOT NULL DEFAULT 0,
      duplicate_suppressed_count INTEGER NOT NULL DEFAULT 0,
      cache_bypass_count INTEGER NOT NULL DEFAULT 0,
      total_wait_ms INTEGER NOT NULL DEFAULT 0,
      maximum_wait_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(assistant_id,local_date)
    );
    CREATE TABLE IF NOT EXISTS assistant_ai_provider_health (
      assistant_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'AVAILABLE',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      circuit_state TEXT NOT NULL DEFAULT 'CLOSED',
      circuit_opened_at TEXT,
      circuit_retry_at TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      last_safe_error_code TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(assistant_id,provider)
    );
    CREATE TABLE IF NOT EXISTS cached_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      canonical_question TEXT NOT NULL,
      normalized_question_hash TEXT NOT NULL,
      answer TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      knowledge_source_ids TEXT NOT NULL DEFAULT '[]',
      knowledge_version TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT 'business-v1',
      status TEXT NOT NULL,
      source_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 0,
      api_calls_saved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      invalidated_at TEXT,
      invalidation_reason TEXT,
      UNIQUE(bot_id,normalized_question_hash)
    );
    CREATE TABLE IF NOT EXISTS cached_answer_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cached_answer_id INTEGER NOT NULL REFERENCES cached_answers(id) ON DELETE CASCADE,
      variant TEXT NOT NULL,
      normalized_question_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(cached_answer_id,normalized_question_hash)
    );
    CREATE TABLE IF NOT EXISTS menu_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      parent_menu_id INTEGER REFERENCES menu_definitions(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      help_text TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      is_initial INTEGER NOT NULL DEFAULT 0 CHECK (is_initial IN (0,1)),
      expiration_minutes INTEGER NOT NULL DEFAULT 15,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_initial_per_bot
      ON menu_definitions(bot_id) WHERE is_initial=1;
    CREATE TABLE IF NOT EXISTS menu_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      menu_id INTEGER NOT NULL REFERENCES menu_definitions(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      option_order INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      action_payload TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_states (
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      chat_hash TEXT NOT NULL,
      user_hash TEXT NOT NULL,
      active_flow TEXT NOT NULL,
      current_menu_id INTEGER,
      previous_menu_id INTEGER,
      current_step TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(bot_id,chat_hash,user_hash)
    );
    CREATE TABLE IF NOT EXISTS catalog_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bot_id,name)
    );
    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bot_id,sha256)
    );
    CREATE TABLE IF NOT EXISTS catalog_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES catalog_categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price_amount INTEGER,
      offer_price_amount INTEGER,
      currency TEXT NOT NULL DEFAULT 'CLP',
      presentation TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      variants TEXT NOT NULL DEFAULT '[]',
      availability TEXT NOT NULL DEFAULT '',
      informed_stock INTEGER,
      primary_media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
      authorized_link TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bot_id,code)
    );
    CREATE TABLE IF NOT EXISTS catalog_item_media (
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      media_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      media_order INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(bot_id,item_id,media_id)
    );
    CREATE TABLE IF NOT EXISTS business_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      weekday INTEGER,
      local_date TEXT,
      opening_time TEXT,
      closing_time TEXT,
      closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1)),
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS human_assistance_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      chat_hash TEXT NOT NULL,
      user_hash TEXT NOT NULL,
      requested_interval TEXT NOT NULL,
      local_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','resolved','cancelled')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS administrators (
      phone_number TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS technical_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT,
      event_type TEXT NOT NULL,
      source TEXT,
      activation_type TEXT,
      conversation_hash TEXT,
      customer_hash TEXT,
      result TEXT NOT NULL,
      duration_ms INTEGER,
      error_code TEXT,
      item_count INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT,
      action_type TEXT NOT NULL,
      resource TEXT NOT NULL,
      result TEXT NOT NULL,
      administrator_hash TEXT NOT NULL,
      duration_ms INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS panel_users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta_webhook_events (
      event_hash TEXT PRIMARY KEY,
      phone_number_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('message','status')),
      processing_status TEXT NOT NULL DEFAULT 'ACCEPTED' CHECK (processing_status IN ('ACCEPTED','PROCESSED','FAILED')),
      delivery_count INTEGER NOT NULL DEFAULT 1,
      error_code TEXT,
      first_received_at TEXT NOT NULL,
      last_received_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS meta_message_statuses (
      event_hash TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      message_hash TEXT NOT NULL,
      phone_number_id TEXT NOT NULL,
      recipient_hash TEXT,
      status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      conversation_hash TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      assistant_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
      assistant_name_snapshot TEXT NOT NULL,
      phone_number_id TEXT NOT NULL,
      wa_id TEXT NOT NULL,
      contact_name TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      UNIQUE(assistant_id,phone_number_id,wa_id)
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      whatsapp_message_id TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
      sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','assistant','system')),
      message_type TEXT NOT NULL,
      text_content TEXT,
      caption TEXT,
      message_timestamp TEXT NOT NULL,
      whatsapp_status TEXT NOT NULL CHECK (whatsapp_status IN (
        'received','accepted','sent','delivered','read','failed','deleted','unknown'
      )),
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_whatsapp_id
      ON conversation_messages(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_timeline
      ON conversation_messages(conversation_id,message_timestamp DESC,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_activity
      ON conversations(last_message_at DESC,id DESC);
  `);
}

function createSaasSchema(database: BetterSqlite3.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'es-CL',
      timezone TEXT NOT NULL DEFAULT 'America/Santiago',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ERROR')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addColumn(database, 'bots', 'business_id', 'TEXT');
  addColumn(database, 'bots', 'channel_type', "TEXT NOT NULL DEFAULT 'WHATSAPP'");
  addColumn(database, 'bots', 'is_primary', 'INTEGER NOT NULL DEFAULT 1');
  backfillBusinesses(database);

  addColumn(database, 'ai_settings', 'model', "TEXT NOT NULL DEFAULT 'openai/gpt-oss-120b'");

  addColumn(database, 'assistant_connectors', 'business_id', 'TEXT');
  addColumn(database, 'assistant_connectors', 'meta_waba_id', 'TEXT');
  addColumn(database, 'assistant_connectors', 'display_phone_number', 'TEXT');
  addColumn(database, 'assistant_connectors', 'setup_mode', "TEXT NOT NULL DEFAULT 'EXISTING'");
  addColumn(
    database,
    'assistant_connectors',
    'webhook_status',
    "TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'",
  );
  addColumn(database, 'assistant_connectors', 'credential_reference', 'TEXT');
  addColumn(database, 'assistant_connectors', 'connected_at', 'TEXT');
  addColumn(database, 'assistant_connectors', 'last_verified_at', 'TEXT');
  database.exec(`
    UPDATE assistant_connectors
    SET business_id=(SELECT business_id FROM bots WHERE bots.id=assistant_connectors.assistant_id)
    WHERE business_id IS NULL;
    UPDATE assistant_connectors
    SET webhook_status=CASE
      WHEN connector_status='CONNECTED' THEN 'ACTIVE'
      WHEN meta_phone_number_id IS NOT NULL THEN 'PENDING'
      ELSE 'NOT_CONFIGURED'
    END
    WHERE webhook_status='NOT_CONFIGURED';
    UPDATE assistant_connectors
    SET connected_at=(SELECT last_connected_at FROM messaging_runtime
                      WHERE messaging_runtime.bot_id=assistant_connectors.assistant_id)
    WHERE connected_at IS NULL AND connector_status='CONNECTED';
  `);

  addColumn(database, 'panel_users', 'role', "TEXT NOT NULL DEFAULT 'global_admin'");
  addColumn(database, 'technical_events', 'business_id', 'TEXT');
  addColumn(database, 'technical_events', 'channel', 'TEXT');
  addColumn(database, 'technical_events', 'route', 'TEXT');
  addColumn(database, 'technical_events', 'ai_provider', 'TEXT');
  addColumn(database, 'technical_events', 'ai_model', 'TEXT');
  addColumn(database, 'technical_events', 'knowledge_used', 'INTEGER');
  addColumn(database, 'technical_events', 'status', 'TEXT');
  addColumn(database, 'conversations', 'business_id', 'TEXT');
  database.exec(`
    UPDATE conversations
    SET business_id=(SELECT business_id FROM bots WHERE bots.id=conversations.assistant_id)
    WHERE business_id IS NULL AND assistant_id IS NOT NULL;
    UPDATE profile_branding
    SET application_name='Don Gato Digital',updated_at=datetime('now')
    WHERE application_name='Neurobot Business';

    CREATE TABLE IF NOT EXISTS assistant_behavior_settings (
      assistant_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      show_initial_menu_on_greeting INTEGER NOT NULL DEFAULT 1 CHECK (show_initial_menu_on_greeting IN (0,1)),
      allow_free_questions INTEGER NOT NULL DEFAULT 1 CHECK (allow_free_questions IN (0,1)),
      use_ai_for_unmatched INTEGER NOT NULL DEFAULT 1 CHECK (use_ai_for_unmatched IN (0,1)),
      use_business_knowledge INTEGER NOT NULL DEFAULT 1 CHECK (use_business_knowledge IN (0,1)),
      fallback_message TEXT NOT NULL DEFAULT 'No pude responder en este momento. Intenta nuevamente o contacta al negocio.',
      human_handoff_ready INTEGER NOT NULL DEFAULT 0 CHECK (human_handoff_ready IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO assistant_behavior_settings(assistant_id,created_at,updated_at)
      SELECT id,created_at,updated_at FROM bots;

    CREATE TABLE IF NOT EXISTS panel_user_business_access (
      username TEXT NOT NULL REFERENCES panel_users(username) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(username,business_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bots_business_channel
      ON bots(business_id,channel_type,lifecycle_status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_primary_assistant_per_business_channel
      ON bots(business_id,channel_type) WHERE is_primary=1 AND lifecycle_status<>'DELETED';
    CREATE INDEX IF NOT EXISTS idx_connectors_business
      ON assistant_connectors(business_id,connector_status);
    CREATE INDEX IF NOT EXISTS idx_conversations_business_activity
      ON conversations(business_id,last_message_at DESC,id DESC);

    CREATE TRIGGER IF NOT EXISTS bots_require_business_insert
    BEFORE INSERT ON bots
    WHEN NEW.business_id IS NULL OR NEW.business_id=''
      OR NOT EXISTS (SELECT 1 FROM businesses WHERE id=NEW.business_id)
    BEGIN SELECT RAISE(ABORT,'BUSINESS_ID_REQUIRED'); END;

    CREATE TRIGGER IF NOT EXISTS connectors_require_matching_business_insert
    BEFORE INSERT ON assistant_connectors
    WHEN NEW.business_id IS NULL OR NEW.business_id<>(SELECT business_id FROM bots WHERE id=NEW.assistant_id)
    BEGIN SELECT RAISE(ABORT,'CONNECTOR_BUSINESS_MISMATCH'); END;

    CREATE TRIGGER IF NOT EXISTS connectors_require_matching_business_update
    BEFORE UPDATE OF business_id,assistant_id ON assistant_connectors
    WHEN NEW.business_id IS NULL OR NEW.business_id<>(SELECT business_id FROM bots WHERE id=NEW.assistant_id)
    BEGIN SELECT RAISE(ABORT,'CONNECTOR_BUSINESS_MISMATCH'); END;

    CREATE TRIGGER IF NOT EXISTS knowledge_category_require_matching_owner_insert
    BEFORE INSERT ON knowledge_categories
    WHEN NEW.bot_id<>(SELECT bot_id FROM assistant_profiles WHERE id=NEW.profile_id)
    BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_BUSINESS_MISMATCH'); END;

    CREATE TRIGGER IF NOT EXISTS knowledge_entry_require_matching_owner_insert
    BEFORE INSERT ON knowledge_entries
    WHEN NEW.bot_id<>(SELECT bot_id FROM assistant_profiles WHERE id=NEW.profile_id)
      OR NEW.profile_id<>(SELECT profile_id FROM knowledge_categories WHERE id=NEW.category_id)
    BEGIN SELECT RAISE(ABORT,'KNOWLEDGE_BUSINESS_MISMATCH'); END;
  `);
}

function createAssistantPlatformSchema(database: BetterSqlite3.Database): void {
  addColumn(database, 'ai_settings', 'provider_config', "TEXT NOT NULL DEFAULT '{}'");
  addColumn(database, 'menu_definitions', 'presentation_type', "TEXT NOT NULL DEFAULT 'AUTOMATIC'");
  addColumn(
    database,
    'menu_definitions',
    'list_button_label',
    "TEXT NOT NULL DEFAULT 'Ver opciones'",
  );
  addColumn(database, 'menu_options', 'description', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'menu_options', 'section_title', "TEXT NOT NULL DEFAULT ''");
  addColumn(
    database,
    'assistant_behavior_settings',
    'allow_dynamic_buttons',
    'INTEGER NOT NULL DEFAULT 1',
  );
  addColumn(
    database,
    'assistant_behavior_settings',
    'allow_dynamic_lists',
    'INTEGER NOT NULL DEFAULT 1',
  );
  addColumn(
    database,
    'assistant_behavior_settings',
    'allow_business_data_queries',
    'INTEGER NOT NULL DEFAULT 1',
  );
  addColumn(
    database,
    'assistant_behavior_settings',
    'show_ai_suggested_actions',
    'INTEGER NOT NULL DEFAULT 1',
  );
  addColumn(
    database,
    'assistant_behavior_settings',
    'allow_write_tools',
    'INTEGER NOT NULL DEFAULT 0',
  );
  addColumn(database, 'technical_events', 'tool_requested', 'TEXT');
  addColumn(database, 'technical_events', 'tool_executed', 'TEXT');
  addColumn(database, 'technical_events', 'result_count', 'INTEGER');
  addColumn(database, 'technical_events', 'presentation', 'TEXT');
  addColumn(database, 'technical_events', 'action_ids', 'TEXT');

  database.exec(`
    UPDATE ai_settings
    SET provider_config=printf('{"model":"%s"}',model)
    WHERE provider='groq' AND (provider_config='{}' OR provider_config='');

    CREATE TABLE IF NOT EXISTS assistant_tool_configurations (
      assistant_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      permissions TEXT NOT NULL DEFAULT '["READ","SUGGEST"]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(assistant_id,tool_id)
    );

    CREATE TABLE IF NOT EXISTS ephemeral_interactions (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      assistant_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      conversation_hash TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      label TEXT NOT NULL,
      volatile INTEGER NOT NULL DEFAULT 0 CHECK (volatile IN (0,1)),
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tool_config_business
      ON assistant_tool_configurations(business_id,assistant_id,enabled);
    CREATE INDEX IF NOT EXISTS idx_ephemeral_interaction_lookup
      ON ephemeral_interactions(assistant_id,conversation_hash,status,expires_at);
    CREATE INDEX IF NOT EXISTS idx_ephemeral_interaction_expiry
      ON ephemeral_interactions(status,expires_at);

    CREATE TRIGGER IF NOT EXISTS tool_configuration_require_matching_business_insert
    BEFORE INSERT ON assistant_tool_configurations
    WHEN NEW.business_id<>(SELECT business_id FROM bots WHERE id=NEW.assistant_id)
    BEGIN SELECT RAISE(ABORT,'TOOL_CONFIGURATION_BUSINESS_MISMATCH'); END;

    CREATE TRIGGER IF NOT EXISTS tool_configuration_require_matching_business_update
    BEFORE UPDATE OF business_id,assistant_id ON assistant_tool_configurations
    WHEN NEW.business_id<>(SELECT business_id FROM bots WHERE id=NEW.assistant_id)
    BEGIN SELECT RAISE(ABORT,'TOOL_CONFIGURATION_BUSINESS_MISMATCH'); END;

    CREATE TRIGGER IF NOT EXISTS ephemeral_interaction_require_matching_business_insert
    BEFORE INSERT ON ephemeral_interactions
    WHEN NEW.business_id<>(SELECT business_id FROM bots WHERE id=NEW.assistant_id)
    BEGIN SELECT RAISE(ABORT,'EPHEMERAL_INTERACTION_BUSINESS_MISMATCH'); END;

    INSERT OR IGNORE INTO assistant_tool_configurations(
      assistant_id,business_id,tool_id,enabled,permissions,created_at,updated_at
    )
    SELECT id,business_id,tool_id,1,'["READ","SUGGEST"]',created_at,updated_at
    FROM bots
    CROSS JOIN (
      SELECT 'get_business_hours' AS tool_id
      UNION ALL SELECT 'get_services'
      UNION ALL SELECT 'get_products'
      UNION ALL SELECT 'get_product_stock'
      UNION ALL SELECT 'get_locations'
      UNION ALL SELECT 'show_menu'
    );
  `);
}

function backfillBusinesses(database: BetterSqlite3.Database): void {
  if (!columnExists(database, 'bots', 'business_id')) return;
  database.exec(`
    INSERT OR IGNORE INTO businesses(
      id,slug,name,description,language,timezone,status,created_at,updated_at
    )
    SELECT bots.client_id,bots.client_id,
      COALESCE(profiles.organization_name,bots.client_id),
      COALESCE(profiles.description,''),'es-CL',
      COALESCE(profiles.timezone,'America/Santiago'),
      CASE WHEN bots.enabled=1 THEN 'ACTIVE'
           WHEN bots.lifecycle_status IN ('DRAFT','UNLINKED','LINKING') THEN 'DRAFT'
           ELSE 'PAUSED' END,
      bots.created_at,bots.updated_at
    FROM bots
    LEFT JOIN bot_profiles mapping ON mapping.bot_id=bots.id
    LEFT JOIN assistant_profiles profiles ON profiles.id=mapping.profile_id;

    UPDATE bots SET business_id=client_id WHERE business_id IS NULL;
  `);
}

function ensureBusinessExample(database: BetterSqlite3.Database): void {
  const count = database
    .prepare("SELECT COUNT(*) AS count FROM bots WHERE lifecycle_status<>'DELETED'")
    .get() as {
    count: number;
  };
  if (Number(count.count) > 0) return;
  const now = new Date().toISOString();
  const botId = DEFAULT_BUSINESS_ASSISTANT_ID;
  const hasBusinessOwnership = columnExists(database, 'bots', 'business_id');
  if (hasBusinessOwnership) {
    database
      .prepare(
        `INSERT OR IGNORE INTO businesses(
           id,slug,name,description,language,timezone,status,created_at,updated_at
         ) VALUES (?, ?, 'Negocio de ejemplo',
           'Configuración inicial editable de Don Gato Digital.',
           'es-CL','America/Santiago','DRAFT',?,?)`,
      )
      .run(botId, botId, now, now);
    database
      .prepare(
        `INSERT INTO bots(
           id,business_id,channel_type,is_primary,internal_identifier,client_id,connector_type,
           lifecycle_status,deletion_locked,enabled,created_at,updated_at
         ) VALUES (?, ?, 'WHATSAPP', 1, ?, ?, 'WHATSAPP_CLOUD_API', 'UNLINKED', 0, 0, ?, ?)`,
      )
      .run(botId, botId, botId, botId, now, now);
  } else {
    database
      .prepare(
        `INSERT INTO bots(
           id,internal_identifier,client_id,connector_type,lifecycle_status,deletion_locked,
           enabled,created_at,updated_at
         ) VALUES (?, ?, ?, 'WHATSAPP_CLOUD_API', 'UNLINKED', 0, 0, ?, ?)`,
      )
      .run(botId, botId, botId, now, now);
  }
  const profile = database
    .prepare(
      `INSERT INTO assistant_profiles(
         profile_key,bot_id,internal_name,organization_name,bot_name,description,
         organization_type,industry,objective,allowed_topics,excluded_topics,tone,
         out_of_scope_message,no_information_message,limit_message,ai_error_message,
         medical_message,contact_information,business_hours,address,timezone,active,
         created_at,updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'Comercio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', NULL,
         'America/Santiago', 1, ?, ?)`,
    )
    .run(
      `${botId}-profile`,
      botId,
      'Negocio de ejemplo',
      'Negocio de ejemplo',
      'Asistente del negocio',
      'Perfil empresarial editable para configurar atención privada por WhatsApp.',
      'Comercio',
      'Atender consultas privadas de clientes con información verificada del negocio.',
      JSON.stringify(['productos', 'servicios', 'precios', 'horarios', 'contacto']),
      JSON.stringify(['diagnósticos médicos', 'asesoría legal', 'operaciones no confirmadas']),
      'Claro, cordial y directo.',
      'Puedo ayudarte únicamente con información de este negocio.',
      'Todavía no tengo información verificada sobre esa consulta.',
      'Alcanzaste temporalmente el límite de consultas. Intenta nuevamente más tarde.',
      'No pude procesar la consulta en este momento. Intenta nuevamente más tarde.',
      'No realizo diagnósticos ni indico tratamientos. Consulta a un profesional calificado.',
      now,
      now,
    );
  const profileId = Number(profile.lastInsertRowid);
  database
    .prepare(
      'INSERT INTO bot_profiles(bot_id,profile_id,created_at,updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(botId, profileId, now, now);
  database
    .prepare(
      `INSERT INTO profile_branding(
         profile_id,application_name,header_text,footer_text,support_information,
         logo_path,primary_color,secondary_color,updated_at
       ) VALUES (?, 'Don Gato Digital', 'Negocio de ejemplo', '', '', NULL, '#176b61', '#d8a446', ?)`,
    )
    .run(profileId, now);
  database
    .prepare(
      "INSERT INTO messaging_runtime(bot_id,status,updated_at) VALUES (?, 'disconnected', ?)",
    )
    .run(botId, now);
  if (columnExists(database, 'assistant_connectors', 'business_id')) {
    database
      .prepare(
        `INSERT INTO assistant_connectors(
           assistant_id,business_id,connector_type,connector_status,setup_mode,
           webhook_status,created_at,updated_at
         ) VALUES (?, ?, 'WHATSAPP_CLOUD_API', 'UNLINKED', 'EXISTING',
           'NOT_CONFIGURED', ?, ?)`,
      )
      .run(botId, botId, now, now);
  } else {
    database
      .prepare(
        `INSERT INTO assistant_connectors(
           assistant_id,connector_type,connector_status,created_at,updated_at
         ) VALUES (?, 'WHATSAPP_CLOUD_API', 'UNLINKED', ?, ?)`,
      )
      .run(botId, now, now);
  }
  const connector = database
    .prepare('SELECT id FROM assistant_connectors WHERE assistant_id=?')
    .get(botId) as { id: number };
  database.prepare('UPDATE bots SET active_connector_id=? WHERE id=?').run(connector.id, botId);
  database
    .prepare(
      `INSERT INTO bot_channel_settings(
         bot_id,continued_conversations_enabled,private_initial_menu_id,menu_type,updated_at
       ) VALUES (?, 1, NULL, 'automatic', ?)`,
    )
    .run(botId, now);
  if (tableExists(database, 'assistant_behavior_settings')) {
    database
      .prepare(
        `INSERT OR IGNORE INTO assistant_behavior_settings(assistant_id,created_at,updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(botId, now, now);
  }
  database
    .prepare(
      `INSERT INTO bot_capabilities(
         bot_id,private_chats_enabled,conversation_continuation_enabled,
         interactive_menus_enabled,numeric_menu_replies_enabled,catalog_enabled,
         human_assistance_enabled,updated_at
       ) VALUES (?, 1, 1, 1, 1, 1, 1, ?)`,
    )
    .run(botId, now);
  database
    .prepare('INSERT INTO ai_settings(profile_id,bot_id,updated_at) VALUES (?, ?, ?)')
    .run(profileId, botId, now);
  database
    .prepare(
      `INSERT INTO provider_health(
         profile_id,bot_id,provider,connection_status,updated_at
       ) VALUES (?, ?, 'groq', 'not_tested', ?)`,
    )
    .run(profileId, botId, now);
  database
    .prepare(
      `INSERT INTO assistant_ai_queue_settings(assistant_id,created_at,updated_at)
       VALUES (?, ?, ?)`,
    )
    .run(botId, now, now);
  database
    .prepare(
      `INSERT INTO assistant_ai_provider_health(assistant_id,provider,state,updated_at)
       VALUES (?, 'groq', 'NOT_CONFIGURED', ?)`,
    )
    .run(botId, now);
  const categories = ['Productos', 'Servicios', 'Precios', 'Horarios', 'Contacto'];
  const insertCategory = database.prepare(
    `INSERT INTO knowledge_categories(profile_id,bot_id,name,enabled,created_at,updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  );
  for (const category of categories) insertCategory.run(profileId, botId, category, now, now);
  const menu = database
    .prepare(
      `INSERT INTO menu_definitions(
         bot_id,parent_menu_id,title,message,help_text,enabled,is_initial,
         expiration_minutes,created_at,updated_at
       ) VALUES (?, NULL, 'Atención', '¡Hola! ¿En qué podemos ayudarte?',
         'Selecciona una opción.', 1, 1, 15, ?, ?)`,
    )
    .run(botId, now, now);
  const menuId = Number(menu.lastInsertRowid);
  const insertOption = database.prepare(
    `INSERT INTO menu_options(
       bot_id,menu_id,label,aliases,option_order,action_type,action_payload,
       enabled,created_at,updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const options = [
    ['Productos o servicios', 'catalog_category'],
    ['Precios', 'knowledge'],
    ['Horarios', 'hours'],
    ['Hablar con una persona', 'human_assistance'],
  ] as const;
  options.forEach(([label, action], index) =>
    insertOption.run(
      botId,
      menuId,
      label,
      JSON.stringify([label.toLocaleLowerCase('es')]),
      index + 1,
      action,
      JSON.stringify(action === 'knowledge' ? { query: label } : {}),
      now,
      now,
    ),
  );
  database
    .prepare('UPDATE bot_channel_settings SET private_initial_menu_id=? WHERE bot_id=?')
    .run(menuId, botId);
}

function rebuildKnowledgeEntries(database: BetterSqlite3.Database): void {
  if (
    !tableExists(database, 'knowledge_entries') ||
    !columnExists(database, 'knowledge_entries', 'legacy_command_id')
  ) {
    return;
  }
  database.exec(`
    DROP TRIGGER IF EXISTS knowledge_entries_ai;
    DROP TRIGGER IF EXISTS knowledge_entries_ad;
    DROP TRIGGER IF EXISTS knowledge_entries_au;
    DROP TABLE IF EXISTS knowledge_entries_fts;
    ALTER TABLE knowledge_entries RENAME TO knowledge_entries_v23;
    CREATE TABLE knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES assistant_profiles(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES knowledge_categories(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '[]',
      synonyms TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      priority INTEGER NOT NULL DEFAULT 0,
      internal_source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO knowledge_entries(
      id,profile_id,bot_id,category_id,title,content,keywords,synonyms,enabled,
      priority,internal_source,created_at,updated_at
    ) SELECT id,profile_id,bot_id,category_id,title,content,keywords,synonyms,enabled,
      priority,internal_source,created_at,updated_at FROM knowledge_entries_v23;
    DROP TABLE knowledge_entries_v23;
  `);
}

function deleteBy(
  database: BetterSqlite3.Database,
  table: string,
  column: string,
  ownerTable: string,
  ownerId: string,
  ownerFilter: string,
  ownerValue: string | number,
): void {
  if (!tableExists(database, table) || !tableExists(database, ownerTable)) return;
  database
    .prepare(
      `DELETE FROM "${table}" WHERE "${column}" IN (
         SELECT "${ownerId}" FROM "${ownerTable}" WHERE "${ownerFilter}"=?
       )`,
    )
    .run(ownerValue);
}

function deleteWhere(
  database: BetterSqlite3.Database,
  table: string,
  column: string,
  value: string | number,
): void {
  if (!tableExists(database, table) || !columnExists(database, table, column)) return;
  database.prepare(`DELETE FROM "${table}" WHERE "${column}"=?`).run(value);
}

function renameTable(database: BetterSqlite3.Database, from: string, to: string): void {
  if (tableExists(database, from) && !tableExists(database, to)) {
    database.exec(`ALTER TABLE "${from}" RENAME TO "${to}"`);
  }
}

function renameColumn(
  database: BetterSqlite3.Database,
  table: string,
  from: string,
  to: string,
): void {
  if (columnExists(database, table, from) && !columnExists(database, table, to)) {
    database.exec(`ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`);
  }
}

function dropColumn(database: BetterSqlite3.Database, table: string, column: string): void {
  if (columnExists(database, table, column)) {
    database.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
  }
}

function addColumn(
  database: BetterSqlite3.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (tableExists(database, table) && !columnExists(database, table, column)) {
    database.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  }
}

function tableExists(database: BetterSqlite3.Database, table: string): boolean {
  return (
    database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !==
    undefined
  );
}

function columnExists(database: BetterSqlite3.Database, table: string, column: string): boolean {
  if (!tableExists(database, table)) return false;
  return (database.pragma(`table_info("${table}")`) as Array<{ name: string }>).some(
    (candidate) => candidate.name === column,
  );
}
