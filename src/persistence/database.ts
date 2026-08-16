import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { DEFAULT_BUSINESS_ASSISTANT_ID } from '../domain/business-defaults.js';
import type {
  AssistantBehaviorSettings,
  AssistantToolConfiguration,
  BotRecord,
  Business,
  BusinessStatus,
  BusinessHour,
  CatalogCategory,
  CatalogItem,
  CachedAnswer,
  CachedAnswerSourceType,
  CachedAnswerStatus,
  AISettings,
  AIProviderStatus,
  AIProviderHealthState,
  AIQueueMetrics,
  AIQueueSettings,
  AIReservationDecision,
  AIUsageSummary,
  AssistantLifecycleStatus,
  AssistantProfile,
  ConversationState,
  ConnectorType,
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeFragment,
  HumanAssistanceRequest,
  MediaAsset,
  MenuActionType,
  MenuDefinition,
  MenuOption,
  MenuType,
  OrganizationType,
  EphemeralInteraction,
  ToolPermission,
  WhatsAppConnection,
  WhatsAppSetupMode,
} from '../domain/types.js';
import { canonicalPhoneIdentity } from '../messaging/identifiers.js';
import { migrateBusinessSchema } from './business-schema.js';
import {
  ConversationHistoryRepository,
  type ConversationListQuery,
  type ConversationMessageRecord,
  type ConversationMessageStatus,
  type ConversationRecord,
  type PaginatedResult,
  type ConversationListItem,
} from './conversation-history-repository.js';

type AssistantProfileRow = {
  id: number;
  internal_name: string;
  organization_name: string;
  bot_name: string;
  description: string;
  organization_type: OrganizationType;
  industry: string;
  objective: string;
  allowed_topics: string;
  excluded_topics: string;
  tone: string;
  out_of_scope_message: string;
  no_information_message: string;
  limit_message: string;
  ai_error_message: string;
  medical_message: string;
  contact_information: string;
  business_hours: string;
  address: string | null;
  timezone: string;
  active: number;
  created_at: string;
  updated_at: string;
  application_name: string | null;
  header_text: string | null;
  footer_text: string | null;
  support_information: string | null;
  logo_path: string | null;
  primary_color: string | null;
  secondary_color: string | null;
};

type KnowledgeEntryRow = {
  id: number;
  profile_id: number;
  category_id: number;
  category_name: string;
  title: string;
  content: string;
  keywords: string;
  synonyms: string;
  enabled: number;
  priority: number;
  internal_source: string | null;
  created_at: string;
  updated_at: string;
};

export type TechnicalEvent = {
  botId?: string;
  businessId?: string;
  eventType: string;
  source?: string;
  activationType?: string;
  channel?: string;
  route?: string;
  aiProvider?: string;
  aiModel?: string;
  knowledgeUsed?: boolean;
  status?: string;
  toolRequested?: string;
  toolExecuted?: string;
  resultCount?: number;
  presentation?: string;
  actionIds?: string[];
  conversationHash?: string;
  customerHash?: string;
  result: string;
  durationMs?: number;
  errorCode?: string;
  itemCount?: number;
};

export type AssistantActivityEvent = {
  id: number;
  occurredAt: string;
  eventType: string;
  source: string | null;
  customerHash: string | null;
  conversationHash: string | null;
  result: string;
  errorCode: string | null;
  durationMs: number | null;
};

export type AuditEvent = {
  botId?: string;
  actionType: string;
  resource: string;
  result: string;
  administratorHash: string;
  durationMs?: number;
  errorCode?: string;
};

export type PanelUserAuthorization = {
  username: string;
  role: 'global_admin' | 'business_admin';
  businessIds: string[];
};

export class AppDatabase {
  private db: BetterSqlite3.Database;
  private closed = false;

  public constructor(private readonly path: string) {
    this.db = this.open(path);
  }

  private open(path: string): BetterSqlite3.Database {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const database = new BetterSqlite3(path);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    return database;
  }

  private conversationHistory(): ConversationHistoryRepository {
    return new ConversationHistoryRepository(this.db);
  }

  public getPath(): string {
    return this.path;
  }

  public isOpen(): boolean {
    return !this.closed;
  }

  public checkpoint(): void {
    if (this.closed) throw new Error('La base de datos está cerrada.');
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  public reopen(): void {
    if (!this.closed) throw new Error('La base de datos ya está abierta.');
    this.db = this.open(this.path);
    this.closed = false;
  }

  public migrate(): void {
    migrateBusinessSchema(this.db);
  }

  public recordAudit(event: AuditEvent): void {
    this.db
      .prepare(
        `INSERT INTO audit_events
          (created_at, action_type, resource, result, administrator_hash, duration_ms, error_code, bot_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        event.actionType,
        event.resource,
        event.result,
        event.administratorHash,
        event.durationMs ?? null,
        event.errorCode ?? null,
        event.botId ?? null,
      );
  }

  public close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  public getMigrationVersions(): number[] {
    return this.db
      .prepare('SELECT version FROM migrations ORDER BY version')
      .all()
      .map((row) => (row as { version: number }).version);
  }

  public quickCheck(): string[] {
    return (this.db.pragma('quick_check') as Array<{ quick_check: string }>).map(
      (row) => row.quick_check,
    );
  }

  public listBots(): BotRecord[] {
    const rows = this.db
      .prepare(
        `SELECT bots.*, profiles.id AS profile_id, profiles.organization_name,
           profiles.bot_name, profiles.organization_type, profiles.timezone,
           businesses.name AS business_name, businesses.description AS business_description,
           businesses.language AS business_language, businesses.status AS business_status,
           runtime.status AS whatsapp_status, runtime.masked_number, runtime.last_connected_at,
           channels.continued_conversations_enabled, channels.menu_type,
           capabilities.private_chats_enabled,
           capabilities.conversation_continuation_enabled,
           capabilities.interactive_menus_enabled,
           capabilities.numeric_menu_replies_enabled,
           capabilities.catalog_enabled, capabilities.human_assistance_enabled
         FROM bots
         JOIN businesses ON businesses.id=bots.business_id
         JOIN bot_profiles mapping ON mapping.bot_id=bots.id
         JOIN assistant_profiles profiles ON profiles.id=mapping.profile_id
         JOIN messaging_runtime runtime ON runtime.bot_id=bots.id
         JOIN bot_channel_settings channels ON channels.bot_id=bots.id
         JOIN bot_capabilities capabilities ON capabilities.bot_id=bots.id
         ORDER BY bots.created_at,bots.internal_identifier`,
      )
      .all() as Array<{
      id: string;
      business_id: string;
      business_name: string;
      business_description: string;
      business_language: string;
      business_status: BusinessStatus;
      channel_type: 'WHATSAPP';
      is_primary: number;
      internal_identifier: string;
      client_id: string;
      connector_type: ConnectorType;
      lifecycle_status: AssistantLifecycleStatus;
      deletion_locked: number;
      deleted_at: string | null;
      scheduled_permanent_deletion_at: string | null;
      active_connector_id: number | null;
      enabled: number;
      profile_id: number;
      organization_name: string;
      bot_name: string;
      organization_type: OrganizationType;
      timezone: string;
      whatsapp_status: string;
      masked_number: string | null;
      last_connected_at: string | null;
      continued_conversations_enabled: number;
      menu_type: MenuType;
      private_chats_enabled: number;
      conversation_continuation_enabled: number;
      interactive_menus_enabled: number;
      numeric_menu_replies_enabled: number;
      catalog_enabled: number;
      human_assistance_enabled: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      businessName: row.business_name,
      businessDescription: row.business_description,
      businessLanguage: row.business_language,
      businessStatus: row.business_status,
      channel: row.channel_type,
      isPrimary: row.is_primary === 1,
      internalIdentifier: row.internal_identifier,
      clientId: row.client_id,
      connectorType: row.connector_type,
      lifecycleStatus: row.lifecycle_status,
      deletionLocked: row.deletion_locked === 1,
      deletedAt: row.deleted_at,
      scheduledPermanentDeletionAt: row.scheduled_permanent_deletion_at,
      activeConnectorId: row.active_connector_id,
      capabilities: {
        privateChatsEnabled: row.private_chats_enabled === 1,
        conversationContinuationEnabled: row.conversation_continuation_enabled === 1,
        interactiveMenusEnabled: row.interactive_menus_enabled === 1,
        numericMenuRepliesEnabled: row.numeric_menu_replies_enabled === 1,
        catalogEnabled: row.catalog_enabled === 1,
        humanAssistanceEnabled: row.human_assistance_enabled === 1,
      },
      enabled: row.enabled === 1,
      profileId: row.profile_id,
      organizationName: row.organization_name,
      botName: row.bot_name,
      organizationType: row.organization_type,
      timezone: row.timezone,
      whatsappStatus: row.whatsapp_status,
      maskedNumber: row.masked_number,
      lastConnectedAt: row.last_connected_at,
      continuedConversationsEnabled: row.continued_conversations_enabled === 1,
      menuType: row.menu_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  public getBot(botId: string): BotRecord | null {
    return this.listBots().find((bot) => bot.id === botId) ?? null;
  }

  public listBusinesses(): Business[] {
    return (
      this.db.prepare('SELECT * FROM businesses ORDER BY name COLLATE NOCASE,id').all() as Array<{
        id: string;
        slug: string;
        name: string;
        description: string;
        language: string;
        timezone: string;
        status: BusinessStatus;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      language: row.language,
      timezone: row.timezone,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public getBusiness(businessId: string): Business | null {
    return this.listBusinesses().find((business) => business.id === businessId) ?? null;
  }

  public getBusinessByBotId(botId: string): Business {
    const bot = this.getBot(botId);
    if (bot === null) throw new Error('El asistente no existe.');
    const business = this.getBusiness(bot.businessId);
    if (business === null) throw new Error('El negocio del asistente no existe.');
    return business;
  }

  public saveBusiness(input: {
    id: string;
    name: string;
    description: string;
    language: string;
    timezone: string;
    status?: BusinessStatus;
  }): Business {
    const current = this.getBusiness(input.id);
    if (current === null) throw new Error('El negocio no existe.');
    const now = new Date().toISOString();
    const name = validatePlainText(input.name, 'nombre del negocio', 160);
    const description = validatePlainText(input.description, 'descripción del negocio', 1000);
    const language = validateLanguage(input.language);
    const timezone = validateTimezone(input.timezone);
    const status = input.status ?? current.status;
    if (!['DRAFT', 'ACTIVE', 'PAUSED', 'ERROR'].includes(status)) {
      throw new Error('El estado del negocio no es válido.');
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE businesses SET name=?,description=?,language=?,timezone=?,status=?,updated_at=?
           WHERE id=?`,
        )
        .run(name, description, language, timezone, status, now, input.id);
      this.db.prepare('UPDATE bots SET updated_at=? WHERE business_id=?').run(now, input.id);
    })();
    return this.getBusiness(input.id) as Business;
  }

  public configureMetaConnector(
    botId: string,
    configuration:
      | string
      | {
          phoneNumberId: string;
          wabaId?: string;
          displayPhoneNumber?: string;
          credentialReference?: string;
        },
  ): void {
    const bot = this.getBot(botId);
    if (bot === null) throw new Error(`El asistente configurado para Meta no existe: ${botId}.`);
    const phoneNumberId =
      typeof configuration === 'string' ? configuration : configuration.phoneNumberId;
    if (!/^\d{6,30}$/u.test(phoneNumberId)) throw new Error('META_PHONE_NUMBER_ID no es válido.');
    const wabaId = typeof configuration === 'string' ? undefined : configuration.wabaId;
    if (wabaId !== undefined && !/^\d{6,30}$/u.test(wabaId)) {
      throw new Error('META_WABA_ID no es válido.');
    }
    const displayPhoneNumber =
      typeof configuration === 'string' ? undefined : configuration.displayPhoneNumber;
    const credentialReference =
      typeof configuration === 'string' ? undefined : configuration.credentialReference;
    const connector = this.db
      .prepare(
        `SELECT id FROM assistant_connectors
         WHERE assistant_id=? AND id=(SELECT active_connector_id FROM bots WHERE id=?)`,
      )
      .get(botId, botId) as { id: number } | undefined;
    if (connector === undefined) throw new Error('CONNECTOR_NOT_FOUND');
    const now = new Date().toISOString();
    const configure = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE assistant_connectors SET connector_type='WHATSAPP_CLOUD_API',
             business_id=?,meta_phone_number_id=?,meta_waba_id=COALESCE(?,meta_waba_id),
             display_phone_number=COALESCE(?,display_phone_number),
             credential_reference=COALESCE(?,credential_reference),
             connector_status='UNLINKED',webhook_status='PENDING',conflict_reason=NULL,
             linked_assistant_id=NULL, updated_at=? WHERE id=?`,
        )
        .run(
          bot.businessId,
          phoneNumberId,
          wabaId ?? null,
          displayPhoneNumber === undefined ? null : maskStoredPhoneNumber(displayPhoneNumber),
          credentialReference === undefined
            ? null
            : validateCredentialReference(credentialReference),
          now,
          connector.id,
        );
      this.db
        .prepare(`UPDATE bots SET connector_type='WHATSAPP_CLOUD_API', updated_at=? WHERE id=?`)
        .run(now, botId);
    });
    try {
      configure();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new Error('META_PHONE_NUMBER_ID ya está asignado a otro asistente.', {
          cause: error,
        });
      }
      throw error;
    }
  }

  public getWhatsAppConnection(botId: string): WhatsAppConnection {
    const row = this.db
      .prepare(
        `SELECT * FROM assistant_connectors
         WHERE assistant_id=? AND id=(SELECT active_connector_id FROM bots WHERE id=?)`,
      )
      .get(botId, botId) as
      | {
          id: number;
          assistant_id: string;
          business_id: string;
          meta_phone_number_id: string | null;
          meta_waba_id: string | null;
          display_phone_number: string | null;
          setup_mode: WhatsAppSetupMode;
          connector_status: WhatsAppConnection['status'];
          webhook_status: WhatsAppConnection['webhookStatus'];
          credential_reference: string | null;
          connected_at: string | null;
          last_verified_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (row === undefined) throw new Error('La conexión de WhatsApp no existe.');
    return {
      id: row.id,
      businessId: row.business_id,
      assistantId: row.assistant_id,
      provider: 'META_CLOUD_API',
      setupMode: row.setup_mode,
      phoneNumberIdConfigured: row.meta_phone_number_id !== null,
      wabaIdConfigured: row.meta_waba_id !== null,
      displayPhoneNumber: row.display_phone_number,
      status: row.connector_status,
      webhookStatus: row.webhook_status,
      credentialReference: row.credential_reference,
      connectedAt: row.connected_at,
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public saveWhatsAppSetupMode(botId: string, setupMode: WhatsAppSetupMode): WhatsAppConnection {
    if (!['EXISTING', 'NEW_CUSTOMER', 'NEW_PLATFORM'].includes(setupMode)) {
      throw new Error('La modalidad de WhatsApp no es válida.');
    }
    if (setupMode === 'NEW_PLATFORM') {
      throw new Error('La provisión de números por Don Gato Digital todavía no está disponible.');
    }
    const result = this.db
      .prepare('UPDATE assistant_connectors SET setup_mode=?,updated_at=? WHERE assistant_id=?')
      .run(setupMode, new Date().toISOString(), botId);
    if (result.changes !== 1) throw new Error('La conexión de WhatsApp no existe.');
    return this.getWhatsAppConnection(botId);
  }

  public getBotIdByMetaPhoneNumberId(phoneNumberId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT assistant_id FROM assistant_connectors
         WHERE meta_phone_number_id=? AND connector_type='WHATSAPP_CLOUD_API'
           AND connector_status NOT IN ('ARCHIVED','DISABLED') LIMIT 1`,
      )
      .get(phoneNumberId) as { assistant_id: string } | undefined;
    return row?.assistant_id ?? null;
  }

  public markMetaConnectorConnected(botId: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE assistant_connectors SET connector_status='CONNECTED',webhook_status='ACTIVE',
             connected_at=COALESCE(connected_at,?),last_verified_at=?,updated_at=?
           WHERE assistant_id=? AND connector_type='WHATSAPP_CLOUD_API'
             AND id=(SELECT active_connector_id FROM bots WHERE id=?)`,
        )
        .run(now, now, now, botId, botId);
      this.db
        .prepare(`UPDATE bots SET lifecycle_status='CONNECTED',updated_at=? WHERE id=?`)
        .run(now, botId);
      this.db
        .prepare(
          `UPDATE messaging_runtime SET status='connected',masked_number=NULL,
             last_connected_at=?,updated_at=? WHERE bot_id=?`,
        )
        .run(now, now, botId);
    })();
  }

  public claimMetaWebhookEvent(input: {
    eventId: string;
    phoneNumberId: string;
    eventType: 'message' | 'status';
  }): boolean {
    const now = new Date().toISOString();
    const eventHash = metaIdentifierHash(input.eventId);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO meta_webhook_events(
           event_hash,phone_number_id,event_type,processing_status,delivery_count,
           error_code,first_received_at,last_received_at,processed_at
         ) VALUES (?, ?, ?, 'ACCEPTED', 1, NULL, ?, ?, NULL)`,
      )
      .run(eventHash, input.phoneNumberId, input.eventType, now, now);
    if (result.changes === 1) return true;
    this.db
      .prepare(
        `UPDATE meta_webhook_events SET delivery_count=delivery_count+1,last_received_at=?
         WHERE event_hash=?`,
      )
      .run(now, eventHash);
    return false;
  }

  public finishMetaWebhookEvents(
    eventIds: readonly string[],
    result: { status: 'PROCESSED' | 'FAILED'; errorCode?: string },
  ): void {
    if (eventIds.length === 0) return;
    const update = this.db.prepare(
      `UPDATE meta_webhook_events SET processing_status=?,error_code=?,processed_at=?
       WHERE event_hash=?`,
    );
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const eventId of eventIds) {
        update.run(
          result.status,
          result.errorCode?.replace(/[^A-Z0-9_-]/giu, '_').slice(0, 80) ?? null,
          now,
          metaIdentifierHash(eventId),
        );
      }
    })();
  }

  public recordMetaMessageStatus(input: {
    eventId: string;
    botId: string;
    messageId: string;
    phoneNumberId: string;
    recipientId: string | null;
    status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | 'unknown';
    occurredAt: string;
    conversationId: string | null;
    errorCode: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO meta_message_statuses(
           event_hash,bot_id,message_hash,phone_number_id,recipient_hash,status,
           occurred_at,conversation_hash,error_code,created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        metaIdentifierHash(input.eventId),
        input.botId,
        metaIdentifierHash(input.messageId),
        input.phoneNumberId,
        input.recipientId === null ? null : metaIdentifierHash(input.recipientId),
        input.status,
        input.occurredAt,
        input.conversationId === null ? null : metaIdentifierHash(input.conversationId),
        input.errorCode,
        new Date().toISOString(),
      );
  }

  public getOrCreateConversation(input: {
    assistantId: string;
    phoneNumberId: string;
    waId: string;
    contactName?: string | null;
    activityAt?: string;
  }): ConversationRecord {
    return this.conversationHistory().getOrCreateConversation(input);
  }

  public recordConversationMessage(input: {
    assistantId: string;
    phoneNumberId: string;
    waId: string;
    contactName?: string | null;
    whatsappMessageId?: string | null;
    direction: 'inbound' | 'outbound';
    senderType: 'customer' | 'assistant' | 'system';
    messageType: string;
    text?: string | null;
    caption?: string | null;
    messageTimestamp?: string;
    whatsappStatus?: ConversationMessageStatus;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): { conversation: ConversationRecord; message: ConversationMessageRecord; inserted: boolean } {
    return this.conversationHistory().recordMessage(input);
  }

  public updateConversationMessageStatus(input: {
    whatsappMessageId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    occurredAt: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): boolean {
    return this.conversationHistory().updateMessageStatus(input);
  }

  public listConversations(query: ConversationListQuery): PaginatedResult<ConversationListItem> {
    return this.conversationHistory().listConversations(query);
  }

  public listConversationMessages(
    conversationId: string,
    page: number,
    pageSize: number,
  ): {
    conversation: ConversationListItem;
    messages: PaginatedResult<ConversationMessageRecord>;
  } | null {
    return this.conversationHistory().listMessages(conversationId, page, pageSize);
  }

  public getMetaWebhookEvent(eventId: string): {
    status: 'ACCEPTED' | 'PROCESSED' | 'FAILED';
    deliveryCount: number;
    errorCode: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT processing_status,delivery_count,error_code FROM meta_webhook_events
         WHERE event_hash=?`,
      )
      .get(metaIdentifierHash(eventId)) as
      | {
          processing_status: 'ACCEPTED' | 'PROCESSED' | 'FAILED';
          delivery_count: number;
          error_code: string | null;
        }
      | undefined;
    return row === undefined
      ? null
      : {
          status: row.processing_status,
          deliveryCount: row.delivery_count,
          errorCode: row.error_code,
        };
  }

  public listMetaMessageStatuses(botId: string): Array<{
    status: string;
    occurredAt: string;
    errorCode: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT status,occurred_at,error_code FROM meta_message_statuses
         WHERE bot_id=? ORDER BY occurred_at`,
      )
      .all(botId)
      .map((row) => {
        const value = row as { status: string; occurred_at: string; error_code: string | null };
        return { status: value.status, occurredAt: value.occurred_at, errorCode: value.error_code };
      });
  }

  public getConnectorConflict(botId: string): {
    reason: string;
    existingBotId: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT conflict_reason, linked_assistant_id FROM assistant_connectors
       WHERE assistant_id=? AND connector_status='CONFLICT' LIMIT 1`,
      )
      .get(botId) as
      { conflict_reason: string | null; linked_assistant_id: string | null } | undefined;
    return row?.conflict_reason && row.linked_assistant_id
      ? { reason: row.conflict_reason, existingBotId: row.linked_assistant_id }
      : null;
  }

  public sendBotToTrash(botId: string, actorHash: string): BotRecord {
    const bot = this.getBot(botId);
    if (bot === null) throw new Error('ASSISTANT_NOT_FOUND');
    if (bot.deletionLocked) throw new Error('PROTECTED_ASSISTANT_DELETION_BLOCKED');
    const now = new Date();
    const deleteAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const operation = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE bots SET lifecycle_status='ARCHIVED', enabled=0, deleted_at=?,
           scheduled_permanent_deletion_at=?, updated_at=? WHERE id=?`,
        )
        .run(now.toISOString(), deleteAt, now.toISOString(), botId);
      this.db
        .prepare(
          `UPDATE assistant_connectors SET connector_status='ARCHIVED', updated_at=? WHERE assistant_id=?`,
        )
        .run(now.toISOString(), botId);
      this.db
        .prepare(
          `INSERT INTO assistant_deletion_audit(assistant_id,action,created_at,safe_actor_hash,backup_reference,result)
         VALUES (?, 'ASSISTANT_SENT_TO_TRASH', ?, ?, NULL, 'ok')`,
        )
        .run(botId, now.toISOString(), actorHash);
    });
    operation();
    return this.getBot(botId) as BotRecord;
  }

  public restoreBotFromTrash(botId: string, actorHash: string): BotRecord {
    const bot = this.getBot(botId);
    if (bot === null || bot.lifecycleStatus !== 'ARCHIVED')
      throw new Error('ASSISTANT_NOT_ARCHIVED');
    const connector = this.db
      .prepare(
        `SELECT meta_phone_number_id FROM assistant_connectors
       WHERE assistant_id=? ORDER BY id DESC LIMIT 1`,
      )
      .get(botId) as { meta_phone_number_id: string | null } | undefined;
    if (connector?.meta_phone_number_id) {
      const conflict = this.db
        .prepare(
          `SELECT 1 FROM assistant_connectors WHERE assistant_id<>?
         AND connector_status NOT IN ('ARCHIVED','DISABLED')
         AND meta_phone_number_id=?`,
        )
        .get(botId, connector.meta_phone_number_id);
      if (conflict !== undefined) throw new Error('RESTORE_PHONE_CONFLICT');
    }
    const now = new Date().toISOString();
    const operation = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE bots SET lifecycle_status='DISABLED', enabled=0, deleted_at=NULL,
          scheduled_permanent_deletion_at=NULL, updated_at=? WHERE id=?`,
        )
        .run(now, botId);
      this.db
        .prepare(
          `UPDATE assistant_connectors SET connector_status='DISABLED', updated_at=? WHERE assistant_id=?`,
        )
        .run(now, botId);
      this.db
        .prepare(
          `INSERT INTO assistant_deletion_audit(assistant_id,action,created_at,safe_actor_hash,backup_reference,result)
         VALUES (?, 'ASSISTANT_RESTORED', ?, ?, NULL, 'ok')`,
        )
        .run(botId, now, actorHash);
    });
    operation();
    return this.getBot(botId) as BotRecord;
  }

  public permanentlyDeleteBot(botId: string, actorHash: string): void {
    const bot = this.getBot(botId);
    if (bot === null || bot.lifecycleStatus !== 'ARCHIVED')
      throw new Error('ASSISTANT_NOT_ARCHIVED');
    if (bot.deletionLocked) throw new Error('PROTECTED_ASSISTANT_DELETION_BLOCKED');
    const now = new Date().toISOString();
    const operation = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO assistant_deletion_audit(assistant_id,action,created_at,safe_actor_hash,backup_reference,result)
         VALUES (?, 'ASSISTANT_PERMANENTLY_DELETED', ?, ?, ?, 'ok')`,
        )
        .run(botId, now, actorHash, null);
      this.db.prepare('DELETE FROM bots WHERE id=?').run(botId);
    });
    operation();
  }

  public createBot(input: {
    id?: string;
    businessId?: string;
    business?: {
      name: string;
      description: string;
      language: string;
      timezone: string;
    };
    connectorType?: ConnectorType;
    profile: Omit<AssistantProfile, 'id' | 'active' | 'createdAt' | 'updatedAt'>;
    menuType?: MenuType;
    whatsappSetupMode?: WhatsAppSetupMode;
    ai?: { provider: 'groq' | 'disabled'; model: string; enabled: boolean };
    behavior?: Partial<Omit<AssistantBehaviorSettings, 'assistantId' | 'updatedAt'>>;
  }): BotRecord {
    const botId = validateBotIdentifier(input.id ?? `assistant-${randomUUID().slice(0, 12)}`);
    if (this.getBot(botId) !== null)
      throw new Error('Ya existe un asistente con ese identificador.');
    const now = new Date().toISOString();
    const connectorType: ConnectorType = input.connectorType ?? 'WHATSAPP_CLOUD_API';
    const existingBusiness =
      input.businessId === undefined ? null : this.getBusiness(input.businessId);
    if (input.businessId !== undefined && existingBusiness === null) {
      throw new Error('El negocio indicado no existe.');
    }
    const businessId =
      existingBusiness?.id ??
      (input.business === undefined && input.id !== undefined
        ? botId
        : `business-${randomUUID().slice(0, 12)}`);
    const businessName = validatePlainText(
      input.business?.name ?? input.profile.organizationName,
      'nombre del negocio',
      160,
    );
    const businessDescription = validatePlainText(
      input.business?.description ?? input.profile.description,
      'descripción del negocio',
      1000,
    );
    const businessLanguage = validateLanguage(input.business?.language ?? 'es-CL');
    const businessTimezone = validateTimezone(input.business?.timezone ?? input.profile.timezone);
    const isPrimary =
      existingBusiness === null ||
      Number(
        (
          this.db
            .prepare(
              `SELECT COUNT(*) AS count FROM bots
               WHERE business_id=? AND channel_type='WHATSAPP' AND lifecycle_status<>'DELETED'`,
            )
            .get(businessId) as { count: number }
        ).count,
      ) === 0;
    const create = this.db.transaction(() => {
      if (existingBusiness === null) {
        this.db
          .prepare(
            `INSERT INTO businesses(
               id,slug,name,description,language,timezone,status,created_at,updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
          )
          .run(
            businessId,
            this.uniqueBusinessSlug(businessName),
            businessName,
            businessDescription,
            businessLanguage,
            businessTimezone,
            now,
            now,
          );
      }
      this.db
        .prepare(
          `INSERT INTO bots(
             id,business_id,channel_type,is_primary,internal_identifier,client_id,connector_type,
             lifecycle_status,deletion_locked,enabled,created_at,updated_at
           ) VALUES (?, ?, 'WHATSAPP', ?, ?, ?, ?, 'DRAFT', 0, 0, ?, ?)`,
        )
        .run(botId, businessId, isPrimary ? 1 : 0, botId, botId, connectorType, now, now);
      const profile = this.createAssistantProfile(input.profile, botId);
      this.activateAssistantProfile(profile.id);
      this.db
        .prepare(
          "INSERT INTO messaging_runtime(bot_id,status,updated_at) VALUES (?, 'disconnected', ?)",
        )
        .run(botId, now);
      const connector = this.db
        .prepare(
          `INSERT INTO assistant_connectors(
             assistant_id,business_id,connector_type,connector_status,setup_mode,
             webhook_status,created_at,updated_at
           ) VALUES (?, ?, ?, 'UNLINKED', ?, 'NOT_CONFIGURED', ?, ?)`,
        )
        .run(botId, businessId, connectorType, input.whatsappSetupMode ?? 'EXISTING', now, now);
      this.db
        .prepare('UPDATE bots SET active_connector_id=? WHERE id=?')
        .run(Number(connector.lastInsertRowid), botId);
      this.db
        .prepare(
          `INSERT INTO bot_channel_settings(
             bot_id,continued_conversations_enabled,private_initial_menu_id,menu_type,updated_at
           ) VALUES (?, 1, NULL, ?, ?)`,
        )
        .run(botId, input.menuType ?? 'automatic', now);
      this.db
        .prepare(
          `INSERT INTO bot_capabilities(
             bot_id,private_chats_enabled,conversation_continuation_enabled,
             interactive_menus_enabled,numeric_menu_replies_enabled,catalog_enabled,
             human_assistance_enabled,updated_at
           ) VALUES (?, 1, 1, 1, 1, 1, 1, ?)`,
        )
        .run(botId, now);
      this.db
        .prepare(
          'INSERT INTO assistant_ai_queue_settings(assistant_id,created_at,updated_at) VALUES (?, ?, ?)',
        )
        .run(botId, now, now);
      this.db
        .prepare(
          `INSERT INTO assistant_ai_provider_health(assistant_id,provider,state,updated_at)
           VALUES (?, 'groq', 'NOT_CONFIGURED', ?)`,
        )
        .run(botId, now);
      const currentAI = this.getAISettings(profile.id);
      this.saveAISettings({
        ...currentAI,
        provider: input.ai?.provider ?? currentAI.provider,
        model: input.ai?.model ?? currentAI.model,
        providerConfig: {
          model: input.ai?.model ?? currentAI.providerConfig.model ?? currentAI.model,
        },
        enabled: input.ai?.enabled ?? currentAI.enabled,
      });
      const behavior = input.behavior;
      this.db
        .prepare(
          `INSERT INTO assistant_behavior_settings(
             assistant_id,show_initial_menu_on_greeting,allow_free_questions,
             use_ai_for_unmatched,use_business_knowledge,allow_dynamic_buttons,
             allow_dynamic_lists,allow_business_data_queries,show_ai_suggested_actions,
             allow_write_tools,fallback_message,human_handoff_ready,created_at,updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          botId,
          behavior?.showInitialMenuOnGreeting === false ? 0 : 1,
          behavior?.allowFreeQuestions === false ? 0 : 1,
          behavior?.useAIForUnmatched === false ? 0 : 1,
          behavior?.useBusinessKnowledge === false ? 0 : 1,
          behavior?.allowDynamicButtons === false ? 0 : 1,
          behavior?.allowDynamicLists === false ? 0 : 1,
          behavior?.allowBusinessDataQueries === false ? 0 : 1,
          behavior?.showAISuggestedActions === false ? 0 : 1,
          behavior?.allowWriteTools === true ? 1 : 0,
          validatePlainText(
            behavior?.fallbackMessage ??
              'No pude responder en este momento. Intenta nuevamente o contacta al negocio.',
            'mensaje alternativo',
            600,
          ),
          behavior?.humanHandoffReady === true ? 1 : 0,
          now,
          now,
        );
      const insertTool = this.db.prepare(
        `INSERT OR IGNORE INTO assistant_tool_configurations(
           assistant_id,business_id,tool_id,enabled,permissions,created_at,updated_at
         ) VALUES (?, ?, ?, 1, '["READ","SUGGEST"]', ?, ?)`,
      );
      for (const toolId of [
        'get_business_hours',
        'get_services',
        'get_products',
        'get_product_stock',
        'get_locations',
        'show_menu',
      ]) {
        insertTool.run(botId, businessId, toolId, now, now);
      }
      this.seedBotKnowledgeCategories(botId, profile.id, now);
      this.seedBotInitialMenu(botId, now);
      this.recordTechnicalEvent({
        eventType: 'BOT_CREATED',
        result: 'created',
        botId,
        businessId,
        channel: 'WHATSAPP',
      });
    });
    create();
    return this.getBot(botId) as BotRecord;
  }

  private uniqueBusinessSlug(name: string): string {
    const base = slugifyBusinessName(name);
    let candidate = base;
    let suffix = 2;
    while (this.db.prepare('SELECT 1 FROM businesses WHERE slug=?').get(candidate) !== undefined) {
      candidate = `${base.slice(0, 72)}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private seedBotKnowledgeCategories(botId: string, profileId: number, now: string): void {
    const categories = [
      'Productos',
      'Servicios',
      'Precios',
      'Horarios',
      'Dirección',
      'Pagos',
      'Despachos',
      'Cambios',
      'Garantías',
      'Promociones',
      'Contacto',
      'Preguntas frecuentes',
    ];
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO knowledge_categories(
         profile_id,bot_id,name,enabled,created_at,updated_at
       ) VALUES (?, ?, ?, 1, ?, ?)`,
    );
    for (const category of categories) insert.run(profileId, botId, category, now, now);
  }

  private seedBotInitialMenu(botId: string, now: string): void {
    const result = this.db
      .prepare(
        `INSERT INTO menu_definitions(
           bot_id,parent_menu_id,title,message,help_text,enabled,is_initial,
           expiration_minutes,created_at,updated_at
         ) VALUES (?, NULL, 'Atención', '¡Hola! ¿En qué podemos ayudarte?',
           'Selecciona una opción.', 1, 1, 15, ?, ?)`,
      )
      .run(botId, now, now);
    const menuId = Number(result.lastInsertRowid);
    const assistanceMenuId = Number(
      this.db
        .prepare(
          `INSERT INTO menu_definitions(
             bot_id,parent_menu_id,title,message,help_text,enabled,is_initial,
             expiration_minutes,created_at,updated_at
           ) VALUES (?, ?, 'Atención humana',
             'Selecciona un horario para que una persona del equipo pueda contactarte.',
             'La disponibilidad debe ser confirmada por el equipo.', 1, 0, 15, ?, ?)`,
        )
        .run(botId, menuId, now, now).lastInsertRowid,
    );
    const labels = [
      'Productos o servicios',
      'Precios',
      'Horarios',
      'Dirección',
      'Despachos',
      'Formas de pago',
      'Promociones',
      'Hablar con una persona',
    ];
    const actions: MenuActionType[] = [
      'catalog_category',
      'knowledge',
      'hours',
      'address',
      'shipping',
      'payments',
      'knowledge',
      'submenu',
    ];
    const insert = this.db.prepare(
      `INSERT INTO menu_options(
         bot_id,menu_id,label,aliases,option_order,action_type,action_payload,
         enabled,created_at,updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    labels.forEach((label, index) =>
      insert.run(
        botId,
        menuId,
        label,
        JSON.stringify([normalizeMenuAlias(label)]),
        index + 1,
        actions[index],
        JSON.stringify(index === labels.length - 1 ? { id: assistanceMenuId } : { query: label }),
        now,
        now,
      ),
    );
    ['08:00 a 12:00', '12:00 a 16:00', '16:00 a 20:00'].forEach((interval, index) => {
      insert.run(
        botId,
        assistanceMenuId,
        interval,
        JSON.stringify([normalizeMenuAlias(interval)]),
        index + 1,
        'human_assistance',
        JSON.stringify({ interval }),
        now,
        now,
      );
    });
    insert.run(
      botId,
      assistanceMenuId,
      'Volver',
      JSON.stringify(['volver']),
      4,
      'back',
      '{}',
      now,
      now,
    );
    this.db
      .prepare('UPDATE bot_channel_settings SET private_initial_menu_id=? WHERE bot_id=?')
      .run(menuId, botId);
  }

  public updateBotConfiguration(input: {
    botId: string;
    enabled: boolean;
    continuedConversationsEnabled: boolean;
    menuType: MenuType;
  }): BotRecord {
    if (this.getBot(input.botId) === null) throw new Error('El asistente no existe.');
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const changed = this.db
        .prepare(
          `UPDATE bots SET enabled=?,lifecycle_status=CASE
             WHEN ?=0 AND lifecycle_status IN ('DRAFT','UNLINKED','LINKING') THEN lifecycle_status
             WHEN ?=0 THEN 'DISABLED'
             WHEN EXISTS (
               SELECT 1 FROM assistant_connectors connector
               WHERE connector.assistant_id=bots.id AND connector.connector_status='CONNECTED'
             ) THEN 'CONNECTED'
             WHEN lifecycle_status='DISABLED' THEN 'UNLINKED'
             ELSE lifecycle_status END,
             updated_at=? WHERE id=?`,
        )
        .run(input.enabled ? 1 : 0, input.enabled ? 1 : 0, input.enabled ? 1 : 0, now, input.botId);
      if (changed.changes !== 1) throw new Error('El asistente no existe.');
      this.db
        .prepare(
          `UPDATE bot_channel_settings SET continued_conversations_enabled=?,menu_type=?,updated_at=?
           WHERE bot_id=?`,
        )
        .run(input.continuedConversationsEnabled ? 1 : 0, input.menuType, now, input.botId);
      this.db
        .prepare(
          `UPDATE bot_capabilities SET conversation_continuation_enabled=?,updated_at=?
           WHERE bot_id=?`,
        )
        .run(input.continuedConversationsEnabled ? 1 : 0, now, input.botId);
      this.db
        .prepare(
          `UPDATE businesses SET status=CASE
             WHEN EXISTS (SELECT 1 FROM bots WHERE business_id=businesses.id AND enabled=1)
               THEN 'ACTIVE'
             WHEN EXISTS (
               SELECT 1 FROM bots WHERE business_id=businesses.id
                 AND lifecycle_status NOT IN ('DRAFT','UNLINKED','LINKING','DELETED')
             ) THEN 'PAUSED'
             ELSE 'DRAFT' END,
             updated_at=?
           WHERE id=(SELECT business_id FROM bots WHERE id=?)`,
        )
        .run(now, input.botId);
    })();
    return this.getBot(input.botId) as BotRecord;
  }
  public updateBotWhatsAppStatus(
    botId: string,
    status: string,
    maskedNumber: string | null = null,
    connectedAt: string | null = null,
  ): void {
    this.db
      .prepare(
        `UPDATE messaging_runtime SET status = ?,
           masked_number = COALESCE(?, masked_number),
           last_connected_at = COALESCE(?, last_connected_at), updated_at = ? WHERE bot_id = ?`,
      )
      .run(status, maskedNumber, connectedAt, new Date().toISOString(), botId);
  }

  public getBotProfile(botId: string): AssistantProfile {
    const row = this.db
      .prepare('SELECT profile_id FROM bot_profiles WHERE bot_id = ?')
      .get(botId) as { profile_id: number } | undefined;
    if (row === undefined) throw new Error('El perfil del asistente no existe.');
    return this.getAssistantProfile(row.profile_id) as AssistantProfile;
  }

  public getAssistantBehavior(botId: string): AssistantBehaviorSettings {
    const row = this.db
      .prepare('SELECT * FROM assistant_behavior_settings WHERE assistant_id=?')
      .get(botId) as
      | {
          assistant_id: string;
          show_initial_menu_on_greeting: number;
          allow_free_questions: number;
          use_ai_for_unmatched: number;
          use_business_knowledge: number;
          allow_dynamic_buttons: number;
          allow_dynamic_lists: number;
          allow_business_data_queries: number;
          show_ai_suggested_actions: number;
          allow_write_tools: number;
          fallback_message: string;
          human_handoff_ready: number;
          updated_at: string;
        }
      | undefined;
    if (row === undefined) throw new Error('La configuración de comportamiento no existe.');
    return {
      assistantId: row.assistant_id,
      showInitialMenuOnGreeting: row.show_initial_menu_on_greeting === 1,
      allowFreeQuestions: row.allow_free_questions === 1,
      useAIForUnmatched: row.use_ai_for_unmatched === 1,
      useBusinessKnowledge: row.use_business_knowledge === 1,
      allowDynamicButtons: row.allow_dynamic_buttons === 1,
      allowDynamicLists: row.allow_dynamic_lists === 1,
      allowBusinessDataQueries: row.allow_business_data_queries === 1,
      showAISuggestedActions: row.show_ai_suggested_actions === 1,
      allowWriteTools: row.allow_write_tools === 1,
      fallbackMessage: row.fallback_message,
      humanHandoffReady: row.human_handoff_ready === 1,
      updatedAt: row.updated_at,
    };
  }

  public saveAssistantBehavior(
    settings: Omit<AssistantBehaviorSettings, 'updatedAt'>,
  ): AssistantBehaviorSettings {
    const fallbackMessage = validatePlainText(settings.fallbackMessage, 'mensaje alternativo', 600);
    const now = new Date().toISOString();
    const changed = this.db
      .prepare(
        `UPDATE assistant_behavior_settings SET
           show_initial_menu_on_greeting=?,allow_free_questions=?,use_ai_for_unmatched=?,
           use_business_knowledge=?,allow_dynamic_buttons=?,allow_dynamic_lists=?,
           allow_business_data_queries=?,show_ai_suggested_actions=?,allow_write_tools=?,
           fallback_message=?,human_handoff_ready=?,updated_at=?
         WHERE assistant_id=?`,
      )
      .run(
        settings.showInitialMenuOnGreeting ? 1 : 0,
        settings.allowFreeQuestions ? 1 : 0,
        settings.useAIForUnmatched ? 1 : 0,
        settings.useBusinessKnowledge ? 1 : 0,
        settings.allowDynamicButtons ? 1 : 0,
        settings.allowDynamicLists ? 1 : 0,
        settings.allowBusinessDataQueries ? 1 : 0,
        settings.showAISuggestedActions ? 1 : 0,
        settings.allowWriteTools ? 1 : 0,
        fallbackMessage,
        settings.humanHandoffReady ? 1 : 0,
        now,
        settings.assistantId,
      );
    if (changed.changes !== 1) throw new Error('La configuración de comportamiento no existe.');
    this.db.prepare('UPDATE bots SET updated_at=? WHERE id=?').run(now, settings.assistantId);
    return this.getAssistantBehavior(settings.assistantId);
  }

  public countEnabledKnowledgeEntries(botId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM knowledge_entries WHERE bot_id=? AND enabled=1')
      .get(botId) as { count: number };
    return Number(row.count);
  }

  public getAssistantLastUpdatedAt(botId: string): string {
    const row = this.db
      .prepare(
        `SELECT MAX(updated_at) AS updated_at FROM (
           SELECT updated_at FROM bots WHERE id=@botId
           UNION ALL SELECT updated_at FROM businesses
             WHERE id=(SELECT business_id FROM bots WHERE id=@botId)
           UNION ALL SELECT updated_at FROM assistant_profiles WHERE bot_id=@botId
           UNION ALL SELECT updated_at FROM assistant_connectors WHERE assistant_id=@botId
           UNION ALL SELECT updated_at FROM ai_settings WHERE bot_id=@botId
           UNION ALL SELECT updated_at FROM assistant_behavior_settings WHERE assistant_id=@botId
           UNION ALL SELECT updated_at FROM knowledge_entries WHERE bot_id=@botId
           UNION ALL SELECT updated_at FROM menu_definitions WHERE bot_id=@botId
         )`,
      )
      .get({ botId }) as { updated_at: string | null };
    return row.updated_at ?? this.getBot(botId)?.updatedAt ?? new Date(0).toISOString();
  }

  public listMenus(botId: string): MenuDefinition[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM menu_definitions WHERE bot_id = ? ORDER BY is_initial DESC, title COLLATE NOCASE',
        )
        .all(botId) as Array<{
        id: number;
        bot_id: string;
        parent_menu_id: number | null;
        title: string;
        message: string;
        help_text: string;
        presentation_type: 'AUTOMATIC' | 'BUTTONS' | 'LIST';
        list_button_label: string;
        enabled: number;
        is_initial: number;
        expiration_minutes: number;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      parentMenuId: row.parent_menu_id,
      title: row.title,
      message: row.message,
      helpText: row.help_text,
      presentation: row.presentation_type,
      listButtonLabel: row.list_button_label,
      enabled: row.enabled === 1,
      isInitial: row.is_initial === 1,
      expirationMinutes: row.expiration_minutes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public getMenu(botId: string, id: number): MenuDefinition | null {
    return this.listMenus(botId).find((menu) => menu.id === id) ?? null;
  }

  public saveMenu(input: {
    id?: number;
    botId: string;
    parentMenuId: number | null;
    title: string;
    message: string;
    helpText: string;
    presentation?: 'AUTOMATIC' | 'BUTTONS' | 'LIST';
    listButtonLabel?: string;
    enabled: boolean;
    isInitial: boolean;
    expirationMinutes: number;
  }): MenuDefinition {
    const now = new Date().toISOString();
    const title = validatePlainText(input.title, 'título del menú', 120);
    const message = validatePlainText(input.message, 'mensaje del menú', 600);
    const helpText = validatePlainText(input.helpText, 'ayuda del menú', 300, true);
    const presentation = input.presentation ?? 'AUTOMATIC';
    const listButtonLabel = validatePlainText(
      input.listButtonLabel ?? 'Ver opciones',
      'botón de lista',
      20,
    );
    if (
      !Number.isInteger(input.expirationMinutes) ||
      input.expirationMinutes < 1 ||
      input.expirationMinutes > 1440
    ) {
      throw new Error('La expiración del menú no es válida.');
    }
    const save = this.db.transaction(() => {
      if (input.isInitial) {
        this.db
          .prepare('UPDATE menu_definitions SET is_initial = 0 WHERE bot_id = ?')
          .run(input.botId);
      }
      if (input.id === undefined) {
        return Number(
          this.db
            .prepare(
              `INSERT INTO menu_definitions(
                 bot_id, parent_menu_id, title, message, help_text, presentation_type,
                 list_button_label, enabled, is_initial, expiration_minutes, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.botId,
              input.parentMenuId,
              title,
              message,
              helpText,
              presentation,
              listButtonLabel,
              input.enabled ? 1 : 0,
              input.isInitial ? 1 : 0,
              input.expirationMinutes,
              now,
              now,
            ).lastInsertRowid,
        );
      }
      const changed = this.db
        .prepare(
          `UPDATE menu_definitions SET parent_menu_id = ?, title = ?, message = ?, help_text = ?,
             presentation_type = ?, list_button_label = ?, enabled = ?, is_initial = ?,
             expiration_minutes = ?, updated_at = ?
           WHERE id = ? AND bot_id = ?`,
        )
        .run(
          input.parentMenuId,
          title,
          message,
          helpText,
          presentation,
          listButtonLabel,
          input.enabled ? 1 : 0,
          input.isInitial ? 1 : 0,
          input.expirationMinutes,
          now,
          input.id,
          input.botId,
        );
      if (changed.changes !== 1) throw new Error('El menú no existe.');
      return input.id;
    });
    const id = save();
    return this.getMenu(input.botId, id) as MenuDefinition;
  }

  public deleteMenu(botId: string, id: number): boolean {
    const menu = this.getMenu(botId, id);
    if (menu?.isInitial === true) throw new Error('El menú inicial no se puede eliminar.');
    return (
      this.db.prepare('DELETE FROM menu_definitions WHERE id = ? AND bot_id = ?').run(id, botId)
        .changes === 1
    );
  }

  public listMenuOptions(botId: string, menuId?: number): MenuOption[] {
    const rows = (
      menuId === undefined
        ? this.db
            .prepare('SELECT * FROM menu_options WHERE bot_id = ? ORDER BY menu_id, option_order')
            .all(botId)
        : this.db
            .prepare(
              'SELECT * FROM menu_options WHERE bot_id = ? AND menu_id = ? ORDER BY option_order',
            )
            .all(botId, menuId)
    ) as Array<{
      id: number;
      bot_id: string;
      menu_id: number;
      label: string;
      description: string;
      section_title: string;
      aliases: string;
      option_order: number;
      action_type: MenuActionType;
      action_payload: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      botId: row.bot_id,
      menuId: row.menu_id,
      label: row.label,
      description: row.description,
      section: row.section_title,
      aliases: parseStringArray(row.aliases),
      order: row.option_order,
      actionType: row.action_type,
      actionPayload: parseSafeObject(row.action_payload),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public saveMenuOption(input: {
    id?: number;
    botId: string;
    menuId: number;
    label: string;
    description?: string;
    section?: string;
    aliases: string[];
    order: number;
    actionType: MenuActionType;
    actionPayload: Record<string, string | number | boolean | null>;
    enabled: boolean;
  }): MenuOption {
    if (this.getMenu(input.botId, input.menuId) === null) throw new Error('El menú no existe.');
    const label = validatePlainText(input.label, 'opción', 100);
    const description = validatePlainText(
      input.description ?? '',
      'descripción de opción',
      72,
      true,
    );
    const section = validatePlainText(input.section ?? '', 'sección de lista', 24, true);
    const aliases = validateTextArray(input.aliases, 'alias de opción', 20);
    if (!Number.isInteger(input.order) || input.order < 1 || input.order > 100)
      throw new Error('El orden no es válido.');
    validateActionPayload(input.actionType, input.actionPayload);
    const now = new Date().toISOString();
    let id = input.id;
    if (id === undefined) {
      id = Number(
        this.db
          .prepare(
            `INSERT INTO menu_options(
               bot_id, menu_id, label, description, section_title, aliases, option_order,
               action_type, action_payload, enabled, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.botId,
            input.menuId,
            label,
            description,
            section,
            JSON.stringify(aliases),
            input.order,
            input.actionType,
            JSON.stringify(input.actionPayload),
            input.enabled ? 1 : 0,
            now,
            now,
          ).lastInsertRowid,
      );
    } else {
      const changed = this.db
        .prepare(
          `UPDATE menu_options SET menu_id = ?, label = ?, description = ?, section_title = ?, aliases = ?, option_order = ?,
             action_type = ?, action_payload = ?, enabled = ?, updated_at = ?
           WHERE id = ? AND bot_id = ?`,
        )
        .run(
          input.menuId,
          label,
          description,
          section,
          JSON.stringify(aliases),
          input.order,
          input.actionType,
          JSON.stringify(input.actionPayload),
          input.enabled ? 1 : 0,
          now,
          id,
          input.botId,
        );
      if (changed.changes !== 1) throw new Error('La opción no existe.');
    }
    return this.listMenuOptions(input.botId).find((option) => option.id === id) as MenuOption;
  }

  public deleteMenuOption(botId: string, id: number): boolean {
    return (
      this.db.prepare('DELETE FROM menu_options WHERE id = ? AND bot_id = ?').run(id, botId)
        .changes === 1
    );
  }

  public listAssistantToolConfigurations(botId: string): AssistantToolConfiguration[] {
    const bot = this.getBot(botId);
    if (bot === null) throw new Error('El asistente no existe.');
    return (
      this.db
        .prepare(
          `SELECT assistant_id,business_id,tool_id,enabled,permissions,updated_at
           FROM assistant_tool_configurations WHERE assistant_id=? ORDER BY tool_id`,
        )
        .all(botId) as Array<{
        assistant_id: string;
        business_id: string;
        tool_id: string;
        enabled: number;
        permissions: string;
        updated_at: string;
      }>
    ).map((row) => ({
      assistantId: row.assistant_id,
      businessId: row.business_id,
      toolId: row.tool_id,
      enabled: row.enabled === 1,
      permissions: parseToolPermissions(row.permissions),
      updatedAt: row.updated_at,
    }));
  }

  public saveAssistantToolConfiguration(input: {
    assistantId: string;
    toolId: string;
    enabled: boolean;
    permissions: ToolPermission[];
  }): AssistantToolConfiguration {
    const bot = this.getBot(input.assistantId);
    if (bot === null) throw new Error('El asistente no existe.');
    const toolId = validateStableIdentifier(input.toolId, 'herramienta');
    const permissions = [...new Set(input.permissions)];
    if (
      permissions.length === 0 ||
      permissions.some((permission) => !['READ', 'SUGGEST', 'EXECUTE'].includes(permission))
    ) {
      throw new Error('Los permisos de la herramienta no son válidos.');
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO assistant_tool_configurations(
           assistant_id,business_id,tool_id,enabled,permissions,created_at,updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(assistant_id,tool_id) DO UPDATE SET
           enabled=excluded.enabled,permissions=excluded.permissions,updated_at=excluded.updated_at`,
      )
      .run(
        bot.id,
        bot.businessId,
        toolId,
        input.enabled ? 1 : 0,
        JSON.stringify(permissions),
        now,
        now,
      );
    return this.listAssistantToolConfigurations(bot.id).find(
      (configuration) => configuration.toolId === toolId,
    ) as AssistantToolConfiguration;
  }

  public createEphemeralInteraction(input: {
    businessId: string;
    assistantId: string;
    conversationHash: string;
    toolId: string;
    actionId: string;
    resourceId: string;
    label: string;
    volatile: boolean;
    expiresAt: string;
  }): EphemeralInteraction {
    const bot = this.getBot(input.assistantId);
    if (bot === null || bot.businessId !== input.businessId) {
      throw new Error('La interacción no pertenece al negocio del asistente.');
    }
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error('La expiración de la interacción no es válida.');
    }
    const id = `dyn_${randomUUID().replaceAll('-', '')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ephemeral_interactions(
           id,business_id,assistant_id,conversation_hash,tool_id,action_id,resource_id,label,
           volatile,payload_json,status,expires_at,created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'ACTIVE', ?, ?)`,
      )
      .run(
        id,
        input.businessId,
        input.assistantId,
        validateOpaqueHash(input.conversationHash),
        validateStableIdentifier(input.toolId, 'herramienta'),
        validateStableIdentifier(input.actionId, 'acción'),
        validateResourceIdentifier(input.resourceId),
        validatePlainText(input.label, 'etiqueta de interacción', 80),
        input.volatile ? 1 : 0,
        expiresAt.toISOString(),
        now,
      );
    return this.getEphemeralInteraction(
      id,
      input.assistantId,
      input.conversationHash,
    ) as EphemeralInteraction;
  }

  public getEphemeralInteraction(
    id: string,
    assistantId: string,
    conversationHash: string,
    now = new Date(),
  ): EphemeralInteraction | null {
    this.db
      .prepare(
        `UPDATE ephemeral_interactions SET status='EXPIRED'
         WHERE id=? AND assistant_id=? AND conversation_hash=? AND status='ACTIVE' AND expires_at<=?`,
      )
      .run(id, assistantId, conversationHash, now.toISOString());
    const row = this.db
      .prepare(
        `SELECT id,business_id,assistant_id,conversation_hash,tool_id,action_id,resource_id,
                label,volatile,status,expires_at,created_at,consumed_at
         FROM ephemeral_interactions WHERE id=? AND assistant_id=? AND conversation_hash=?`,
      )
      .get(id, assistantId, conversationHash) as
      | {
          id: string;
          business_id: string;
          assistant_id: string;
          conversation_hash: string;
          tool_id: string;
          action_id: string;
          resource_id: string;
          label: string;
          volatile: number;
          status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED';
          expires_at: string;
          created_at: string;
          consumed_at: string | null;
        }
      | undefined;
    if (row === undefined) return null;
    return {
      id: row.id,
      businessId: row.business_id,
      assistantId: row.assistant_id,
      conversationHash: row.conversation_hash,
      toolId: row.tool_id,
      actionId: row.action_id,
      resourceId: row.resource_id,
      label: row.label,
      volatile: row.volatile === 1,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      consumedAt: row.consumed_at,
    };
  }

  public markEphemeralInteractionConsumed(
    id: string,
    assistantId: string,
    conversationHash: string,
    now = new Date(),
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE ephemeral_interactions SET status='CONSUMED',consumed_at=?
           WHERE id=? AND assistant_id=? AND conversation_hash=? AND status='ACTIVE' AND expires_at>?`,
        )
        .run(now.toISOString(), id, assistantId, conversationHash, now.toISOString()).changes === 1
    );
  }

  public expireEphemeralInteractions(now = new Date()): number {
    return this.db
      .prepare(
        "UPDATE ephemeral_interactions SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at<=?",
      )
      .run(now.toISOString()).changes;
  }

  public getConversationState(
    botId: string,
    chatHash: string,
    userHash: string,
  ): ConversationState | null {
    const row = this.db
      .prepare(
        'SELECT * FROM conversation_states WHERE bot_id = ? AND chat_hash = ? AND user_hash = ?',
      )
      .get(botId, chatHash, userHash) as
      | {
          bot_id: string;
          chat_hash: string;
          user_hash: string;
          active_flow: string;
          current_menu_id: number | null;
          previous_menu_id: number | null;
          current_step: string;
          expires_at: string;
          updated_at: string;
        }
      | undefined;
    return row === undefined
      ? null
      : {
          botId: row.bot_id,
          chatHash: row.chat_hash,
          userHash: row.user_hash,
          activeFlow: row.active_flow,
          currentMenuId: row.current_menu_id,
          previousMenuId: row.previous_menu_id,
          currentStep: row.current_step,
          expiresAt: row.expires_at,
          updatedAt: row.updated_at,
        };
  }

  public saveConversationState(state: ConversationState): void {
    this.db
      .prepare(
        `INSERT INTO conversation_states(
           bot_id, chat_hash, user_hash, active_flow, current_menu_id, previous_menu_id,
           current_step, expires_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, chat_hash, user_hash) DO UPDATE SET
           active_flow = excluded.active_flow, current_menu_id = excluded.current_menu_id,
           previous_menu_id = excluded.previous_menu_id, current_step = excluded.current_step,
           expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      )
      .run(
        state.botId,
        state.chatHash,
        state.userHash,
        state.activeFlow,
        state.currentMenuId,
        state.previousMenuId,
        state.currentStep,
        state.expiresAt,
        state.updatedAt,
      );
  }

  public deleteConversationState(botId: string, chatHash: string, userHash: string): void {
    this.db
      .prepare(
        'DELETE FROM conversation_states WHERE bot_id = ? AND chat_hash = ? AND user_hash = ?',
      )
      .run(botId, chatHash, userHash);
  }

  public clearConversationStates(botId: string): number {
    return this.db.prepare('DELETE FROM conversation_states WHERE bot_id = ?').run(botId).changes;
  }

  public deleteExpiredConversationStates(now = new Date()): number {
    return this.db
      .prepare('DELETE FROM conversation_states WHERE expires_at <= ?')
      .run(now.toISOString()).changes;
  }

  public countActiveConversationStates(botId: string, now = new Date()): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS total FROM conversation_states WHERE bot_id = ? AND expires_at > ?',
      )
      .get(botId, now.toISOString()) as { total: number };
    return row.total;
  }

  public listCatalogCategories(botId: string): CatalogCategory[] {
    return (
      this.db
        .prepare('SELECT * FROM catalog_categories WHERE bot_id = ? ORDER BY name COLLATE NOCASE')
        .all(botId) as Array<{
        id: number;
        bot_id: string;
        name: string;
        description: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      name: row.name,
      description: row.description,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public saveCatalogCategory(input: {
    id?: number;
    botId: string;
    name: string;
    description: string;
    enabled: boolean;
  }): CatalogCategory {
    const name = validatePlainText(input.name, 'categoría del catálogo', 120);
    const description = validatePlainText(input.description, 'descripción', 600, true);
    const now = new Date().toISOString();
    let id = input.id;
    if (id === undefined) {
      id = Number(
        this.db
          .prepare(
            'INSERT INTO catalog_categories(bot_id, name, description, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(input.botId, name, description, input.enabled ? 1 : 0, now, now).lastInsertRowid,
      );
    } else {
      const changed = this.db
        .prepare(
          'UPDATE catalog_categories SET name = ?, description = ?, enabled = ?, updated_at = ? WHERE id = ? AND bot_id = ?',
        )
        .run(name, description, input.enabled ? 1 : 0, now, id, input.botId);
      if (changed.changes !== 1) throw new Error('La categoría no existe.');
    }
    return this.listCatalogCategories(input.botId).find(
      (category) => category.id === id,
    ) as CatalogCategory;
  }

  public listCatalogItems(botId: string): CatalogItem[] {
    return (
      this.db
        .prepare('SELECT * FROM catalog_items WHERE bot_id = ? ORDER BY name COLLATE NOCASE')
        .all(botId) as Array<{
        id: number;
        bot_id: string;
        category_id: number | null;
        name: string;
        code: string;
        description: string;
        price_amount: number | null;
        offer_price_amount: number | null;
        currency: string;
        presentation: string;
        size: string;
        variants: string;
        availability: string;
        informed_stock: number | null;
        primary_media_id: number | null;
        authorized_link: string | null;
        enabled: number;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      categoryId: row.category_id,
      name: row.name,
      code: row.code,
      description: row.description,
      priceAmount: row.price_amount,
      offerPriceAmount: row.offer_price_amount,
      currency: row.currency,
      presentation: row.presentation,
      size: row.size,
      variants: parseStringArray(row.variants),
      availability: row.availability,
      informedStock: row.informed_stock,
      primaryMediaId: row.primary_media_id,
      authorizedLink: row.authorized_link,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public saveCatalogItem(input: Omit<CatalogItem, 'createdAt' | 'updatedAt'>): CatalogItem {
    const name = validatePlainText(input.name, 'producto o servicio', 160);
    const code = validatePlainText(input.code, 'código', 80);
    const description = validatePlainText(input.description, 'descripción', 1200, true);
    const currency = validatePlainText(input.currency, 'moneda', 8).toUpperCase();
    validateMoney(input.priceAmount);
    validateMoney(input.offerPriceAmount);
    if (
      input.informedStock !== null &&
      (!Number.isInteger(input.informedStock) || input.informedStock < 0)
    )
      throw new Error('El stock informado no es válido.');
    if (input.authorizedLink !== null && !/^https:\/\//u.test(input.authorizedLink))
      throw new Error('El enlace autorizado debe utilizar HTTPS.');
    const now = new Date().toISOString();
    let id = input.id;
    if (id <= 0) {
      id = Number(
        this.db
          .prepare(
            `INSERT INTO catalog_items(
           bot_id, category_id, name, code, description, price_amount, offer_price_amount, currency,
           presentation, size, variants, availability, informed_stock, primary_media_id,
           authorized_link, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.botId,
            input.categoryId,
            name,
            code,
            description,
            input.priceAmount,
            input.offerPriceAmount,
            currency,
            validatePlainText(input.presentation, 'presentación', 200, true),
            validatePlainText(input.size, 'tamaño', 100, true),
            JSON.stringify(validateTextArray(input.variants, 'variantes', 50)),
            validatePlainText(input.availability, 'disponibilidad', 300, true),
            input.informedStock,
            input.primaryMediaId,
            input.authorizedLink,
            input.enabled ? 1 : 0,
            now,
            now,
          ).lastInsertRowid,
      );
    } else {
      const changed = this.db
        .prepare(
          `UPDATE catalog_items SET category_id = ?, name = ?, code = ?, description = ?, price_amount = ?,
           offer_price_amount = ?, currency = ?, presentation = ?, size = ?, variants = ?, availability = ?,
           informed_stock = ?, primary_media_id = ?, authorized_link = ?, enabled = ?, updated_at = ?
         WHERE id = ? AND bot_id = ?`,
        )
        .run(
          input.categoryId,
          name,
          code,
          description,
          input.priceAmount,
          input.offerPriceAmount,
          currency,
          validatePlainText(input.presentation, 'presentación', 200, true),
          validatePlainText(input.size, 'tamaño', 100, true),
          JSON.stringify(validateTextArray(input.variants, 'variantes', 50)),
          validatePlainText(input.availability, 'disponibilidad', 300, true),
          input.informedStock,
          input.primaryMediaId,
          input.authorizedLink,
          input.enabled ? 1 : 0,
          now,
          id,
          input.botId,
        );
      if (changed.changes !== 1) throw new Error('El producto o servicio no existe.');
    }
    return this.listCatalogItems(input.botId).find((item) => item.id === id) as CatalogItem;
  }

  public deleteCatalogItem(botId: string, id: number): boolean {
    return (
      this.db.prepare('DELETE FROM catalog_items WHERE id = ? AND bot_id = ?').run(id, botId)
        .changes === 1
    );
  }

  public listMediaAssets(botId: string): MediaAsset[] {
    return (
      this.db
        .prepare('SELECT * FROM media_assets WHERE bot_id = ? ORDER BY created_at DESC')
        .all(botId) as Array<{
        id: number;
        bot_id: string;
        internal_name: string;
        relative_path: string;
        mime_type: 'image/png' | 'image/jpeg' | 'image/webp';
        byte_size: number;
        sha256: string;
        caption: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      internalName: row.internal_name,
      relativePath: row.relative_path,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
      caption: row.caption,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public createMediaAsset(input: {
    botId: string;
    internalName: string;
    relativePath: string;
    mimeType: MediaAsset['mimeType'];
    byteSize: number;
    sha256: string;
    caption: string;
  }): MediaAsset {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO media_assets(
         bot_id, internal_name, relative_path, mime_type, byte_size, sha256, caption, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        input.botId,
        input.internalName,
        input.relativePath,
        input.mimeType,
        input.byteSize,
        input.sha256,
        validatePlainText(input.caption, 'texto de imagen', 300, true),
        now,
        now,
      );
    return this.listMediaAssets(input.botId).find(
      (asset) => asset.id === Number(result.lastInsertRowid),
    ) as MediaAsset;
  }

  public deleteMediaAsset(botId: string, id: number): MediaAsset | null {
    const asset = this.listMediaAssets(botId).find((item) => item.id === id) ?? null;
    if (asset === null) return null;
    const remove = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE catalog_items SET primary_media_id = NULL WHERE bot_id = ? AND primary_media_id = ?',
        )
        .run(botId, id);
      this.db
        .prepare('DELETE FROM catalog_item_media WHERE bot_id = ? AND media_id = ?')
        .run(botId, id);
      this.db.prepare('DELETE FROM media_assets WHERE bot_id = ? AND id = ?').run(botId, id);
    });
    remove();
    return asset;
  }

  public listBusinessHours(botId: string): BusinessHour[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM business_hours WHERE bot_id = ? ORDER BY local_date, weekday, opening_time',
        )
        .all(botId) as Array<{
        id: number;
        bot_id: string;
        weekday: number | null;
        local_date: string | null;
        opening_time: string | null;
        closing_time: string | null;
        closed: number;
        label: string;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      weekday: row.weekday,
      localDate: row.local_date,
      openingTime: row.opening_time,
      closingTime: row.closing_time,
      closed: row.closed === 1,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public replaceBusinessHours(
    botId: string,
    hours: Array<Omit<BusinessHour, 'id' | 'botId' | 'createdAt' | 'updatedAt'>>,
  ): BusinessHour[] {
    if (hours.length > 100) throw new Error('Se excedió la cantidad máxima de horarios.');
    const now = new Date().toISOString();
    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM business_hours WHERE bot_id = ?').run(botId);
      const insert = this.db.prepare(
        `INSERT INTO business_hours(
           bot_id, weekday, local_date, opening_time, closing_time, closed, label, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const hour of hours) {
        validateBusinessHour(hour);
        insert.run(
          botId,
          hour.weekday,
          hour.localDate,
          hour.openingTime,
          hour.closingTime,
          hour.closed ? 1 : 0,
          validatePlainText(hour.label, 'etiqueta de horario', 160, true),
          now,
          now,
        );
      }
    });
    replace();
    return this.listBusinessHours(botId);
  }

  public createHumanAssistanceRequest(input: {
    botId: string;
    chatHash: string;
    userHash: string;
    requestedInterval: string;
    localDate: string;
    note?: string;
  }): HumanAssistanceRequest {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO human_assistance_requests(
         bot_id, chat_hash, user_hash, requested_interval, local_date, status, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(
        input.botId,
        input.chatHash,
        input.userHash,
        validatePlainText(input.requestedInterval, 'intervalo', 120, true),
        validateDate(input.localDate),
        validatePlainText(input.note ?? '', 'nota', 300, true),
        now,
        now,
      );
    return this.listHumanAssistanceRequests(input.botId).find(
      (item) => item.id === Number(result.lastInsertRowid),
    ) as HumanAssistanceRequest;
  }

  public listHumanAssistanceRequests(botId: string): HumanAssistanceRequest[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM human_assistance_requests WHERE bot_id = ? ORDER BY created_at DESC',
        )
        .all(botId) as Array<{
        id: number;
        bot_id: string;
        chat_hash: string;
        user_hash: string;
        requested_interval: string;
        local_date: string;
        status: HumanAssistanceRequest['status'];
        note: string;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      botId: row.bot_id,
      chatHash: row.chat_hash,
      userHash: row.user_hash,
      requestedInterval: row.requested_interval,
      localDate: row.local_date,
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public updateHumanAssistanceRequest(
    botId: string,
    id: number,
    status: HumanAssistanceRequest['status'],
    note: string,
  ): HumanAssistanceRequest {
    const changed = this.db
      .prepare(
        'UPDATE human_assistance_requests SET status = ?, note = ?, updated_at = ? WHERE bot_id = ? AND id = ?',
      )
      .run(status, validatePlainText(note, 'nota', 300, true), new Date().toISOString(), botId, id);
    if (changed.changes !== 1) throw new Error('La solicitud no existe.');
    return this.listHumanAssistanceRequests(botId).find(
      (request) => request.id === id,
    ) as HumanAssistanceRequest;
  }

  public listAssistantProfiles(): AssistantProfile[] {
    return (
      this.db
        .prepare(
          `SELECT profiles.*, branding.application_name, branding.header_text,
             branding.footer_text, branding.support_information, branding.logo_path,
             branding.primary_color, branding.secondary_color
           FROM assistant_profiles profiles
           LEFT JOIN profile_branding branding ON branding.profile_id = profiles.id
           ORDER BY profiles.active DESC, profiles.organization_name COLLATE NOCASE`,
        )
        .all() as AssistantProfileRow[]
    ).map(mapAssistantProfile);
  }

  public getActiveAssistantProfile(): AssistantProfile {
    const profile = this.listAssistantProfiles().find((item) => item.active);
    if (profile === undefined) throw new Error('No existe un perfil de asistente activo.');
    return profile;
  }

  public getAssistantProfile(id: number): AssistantProfile | null {
    const row = this.db
      .prepare(
        `SELECT profiles.*, branding.application_name, branding.header_text,
           branding.footer_text, branding.support_information, branding.logo_path,
           branding.primary_color, branding.secondary_color
         FROM assistant_profiles profiles
         LEFT JOIN profile_branding branding ON branding.profile_id = profiles.id
         WHERE profiles.id = ?`,
      )
      .get(id) as AssistantProfileRow | undefined;
    return row === undefined ? null : mapAssistantProfile(row);
  }

  public createAssistantProfile(
    input: Omit<AssistantProfile, 'id' | 'active' | 'createdAt' | 'updatedAt'>,
    botId = DEFAULT_BUSINESS_ASSISTANT_ID,
  ): AssistantProfile {
    const values = validateAssistantProfile(input);
    const now = new Date().toISOString();
    const create = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO assistant_profiles(
             profile_key, bot_id, internal_name, organization_name, bot_name,
             description, organization_type, industry, objective, allowed_topics, excluded_topics,
             tone, out_of_scope_message, no_information_message, limit_message, ai_error_message,
             medical_message, contact_information, business_hours, address,
             timezone, active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          `profile-${randomUUID()}`,
          botId,
          values.internalName,
          values.organizationName,
          values.botName,
          values.description,
          values.organizationType,
          values.industry,
          values.objective,
          JSON.stringify(values.allowedTopics),
          JSON.stringify(values.excludedTopics),
          values.tone,
          values.outOfScopeMessage,
          values.noInformationMessage,
          values.limitMessage,
          values.aiErrorMessage,
          values.medicalMessage,
          values.contactInformation,
          values.businessHours,
          values.address,
          values.timezone,
          now,
          now,
        );
      const profileId = Number(result.lastInsertRowid);
      this.saveProfileBranding(profileId, values, now);
      this.db
        .prepare(
          `INSERT INTO ai_settings(profile_id, enabled, provider, updated_at, bot_id)
           VALUES (?, 0, 'groq', ?, ?)`,
        )
        .run(profileId, now, botId);
      this.db
        .prepare(
          `INSERT INTO provider_health(profile_id, provider, connection_status, updated_at, bot_id)
           VALUES (?, 'groq', 'not_tested', ?, ?)`,
        )
        .run(profileId, now, botId);
      return profileId;
    });
    return this.getAssistantProfile(create()) as AssistantProfile;
  }

  public saveAssistantProfile(profile: AssistantProfile): AssistantProfile {
    if (this.getAssistantProfile(profile.id) === null) throw new Error('El perfil no existe.');
    const values = validateAssistantProfile(profile);
    const now = new Date().toISOString();
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE assistant_profiles SET
             internal_name = ?, organization_name = ?, bot_name = ?,
             description = ?, organization_type = ?, industry = ?, objective = ?,
             allowed_topics = ?, excluded_topics = ?, tone = ?, out_of_scope_message = ?,
             no_information_message = ?, limit_message = ?, ai_error_message = ?,
             medical_message = ?, contact_information = ?,
             business_hours = ?, address = ?, timezone = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          values.internalName,
          values.organizationName,
          values.botName,
          values.description,
          values.organizationType,
          values.industry,
          values.objective,
          JSON.stringify(values.allowedTopics),
          JSON.stringify(values.excludedTopics),
          values.tone,
          values.outOfScopeMessage,
          values.noInformationMessage,
          values.limitMessage,
          values.aiErrorMessage,
          values.medicalMessage,
          values.contactInformation,
          values.businessHours,
          values.address,
          values.timezone,
          now,
          profile.id,
        );
      this.saveProfileBranding(profile.id, values, now);
    });
    save();
    return this.getAssistantProfile(profile.id) as AssistantProfile;
  }

  private saveProfileBranding(
    profileId: number,
    values: Pick<
      AssistantProfile,
      | 'applicationName'
      | 'headerText'
      | 'footerText'
      | 'supportInformation'
      | 'logoPath'
      | 'primaryColor'
      | 'secondaryColor'
    >,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO profile_branding(
           profile_id, application_name, header_text, footer_text, support_information,
           logo_path, primary_color, secondary_color, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
           application_name = excluded.application_name, header_text = excluded.header_text,
           footer_text = excluded.footer_text, support_information = excluded.support_information,
           logo_path = excluded.logo_path, primary_color = excluded.primary_color,
           secondary_color = excluded.secondary_color, updated_at = excluded.updated_at`,
      )
      .run(
        profileId,
        values.applicationName,
        values.headerText,
        values.footerText,
        values.supportInformation,
        values.logoPath,
        values.primaryColor,
        values.secondaryColor,
        now,
      );
  }

  public activateAssistantProfile(id: number): AssistantProfile {
    if (this.getAssistantProfile(id) === null) throw new Error('El perfil no existe.');
    const owner = this.db.prepare('SELECT bot_id FROM assistant_profiles WHERE id = ?').get(id) as {
      bot_id: string;
    };
    const activate = this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE assistant_profiles SET active = 0, updated_at = ? WHERE bot_id = ?')
        .run(now, owner.bot_id);
      this.db
        .prepare('UPDATE assistant_profiles SET active = 1, updated_at = ? WHERE id = ?')
        .run(now, id);
      this.db
        .prepare(
          `INSERT INTO bot_profiles(bot_id, profile_id, created_at, updated_at)
           VALUES (?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET
             profile_id = excluded.profile_id, updated_at = excluded.updated_at`,
        )
        .run(owner.bot_id, id, now, now);
    });
    activate();
    return this.getAssistantProfile(id) as AssistantProfile;
  }

  public listKnowledgeCategories(profileId: number): KnowledgeCategory[] {
    return (
      this.db
        .prepare(
          `SELECT id, profile_id, name, enabled, created_at, updated_at
           FROM knowledge_categories WHERE profile_id = ? ORDER BY name COLLATE NOCASE`,
        )
        .all(profileId) as Array<{
        id: number;
        profile_id: number;
        name: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      name: row.name,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public saveKnowledgeCategory(input: {
    id?: number;
    profileId: number;
    name: string;
    enabled: boolean;
  }): KnowledgeCategory {
    const name = validatePlainText(input.name, 'nombre de categoría', 100);
    const now = new Date().toISOString();
    let id = input.id;
    if (id === undefined) {
      const owner = this.db
        .prepare('SELECT bot_id FROM assistant_profiles WHERE id = ?')
        .get(input.profileId) as { bot_id: string } | undefined;
      if (owner === undefined) throw new Error('El perfil no existe.');
      const result = this.db
        .prepare(
          `INSERT INTO knowledge_categories(profile_id, name, enabled, created_at, updated_at, bot_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.profileId, name, input.enabled ? 1 : 0, now, now, owner.bot_id);
      id = Number(result.lastInsertRowid);
    } else {
      const relatedEntries = this.db
        .prepare('SELECT id FROM knowledge_entries WHERE profile_id = ? AND category_id = ?')
        .all(input.profileId, id) as Array<{ id: number }>;
      for (const entry of relatedEntries)
        this.invalidateCachedAnswersForKnowledgeEntry(input.profileId, entry.id);
      const result = this.db
        .prepare(
          `UPDATE knowledge_categories SET name = ?, enabled = ?, updated_at = ?
           WHERE id = ? AND profile_id = ?`,
        )
        .run(name, input.enabled ? 1 : 0, now, id, input.profileId);
      if (result.changes !== 1) throw new Error('La categoría no existe.');
    }
    return this.listKnowledgeCategories(input.profileId).find(
      (item) => item.id === id,
    ) as KnowledgeCategory;
  }

  public deleteKnowledgeCategory(profileId: number, id: number): boolean {
    const entries = this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM knowledge_entries WHERE category_id = ? AND profile_id = ?',
      )
      .get(id, profileId) as { count: number };
    if (entries.count > 0) return false;
    return (
      this.db
        .prepare('DELETE FROM knowledge_categories WHERE id = ? AND profile_id = ?')
        .run(id, profileId).changes === 1
    );
  }

  public listKnowledgeEntries(profileId: number): KnowledgeEntry[] {
    return (
      this.db
        .prepare(
          `SELECT entries.*, categories.name AS category_name
           FROM knowledge_entries entries
           JOIN knowledge_categories categories ON categories.id = entries.category_id
           WHERE entries.profile_id = ?
           ORDER BY entries.priority DESC, entries.title COLLATE NOCASE`,
        )
        .all(profileId) as KnowledgeEntryRow[]
    ).map(mapKnowledgeEntry);
  }

  public saveKnowledgeEntry(
    input: Omit<KnowledgeEntry, 'categoryName' | 'createdAt' | 'updatedAt'> & { id: number },
  ): KnowledgeEntry {
    const values = validateKnowledgeEntry(input);
    const category = this.db
      .prepare('SELECT 1 FROM knowledge_categories WHERE id=? AND profile_id=?')
      .get(input.categoryId, input.profileId);
    if (category === undefined) {
      throw new Error('La categoría no pertenece a la base de conocimiento de este negocio.');
    }
    const now = new Date().toISOString();
    let id = input.id;
    if (id <= 0) {
      const owner = this.db
        .prepare('SELECT bot_id FROM assistant_profiles WHERE id = ?')
        .get(input.profileId) as { bot_id: string } | undefined;
      if (owner === undefined) throw new Error('El perfil no existe.');
      const result = this.db
        .prepare(
          `INSERT INTO knowledge_entries(
             profile_id, category_id, title, content, keywords, synonyms, enabled, priority,
             internal_source, created_at, updated_at, bot_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.profileId,
          input.categoryId,
          values.title,
          values.content,
          JSON.stringify(values.keywords),
          JSON.stringify(values.synonyms),
          input.enabled ? 1 : 0,
          values.priority,
          values.internalSource,
          now,
          now,
          owner.bot_id,
        );
      id = Number(result.lastInsertRowid);
    } else {
      this.invalidateCachedAnswersForKnowledgeEntry(input.profileId, id);
      const result = this.db
        .prepare(
          `UPDATE knowledge_entries SET category_id = ?, title = ?, content = ?, keywords = ?,
             synonyms = ?, enabled = ?, priority = ?, internal_source = ?, updated_at = ?
           WHERE id = ? AND profile_id = ?`,
        )
        .run(
          input.categoryId,
          values.title,
          values.content,
          JSON.stringify(values.keywords),
          JSON.stringify(values.synonyms),
          input.enabled ? 1 : 0,
          values.priority,
          values.internalSource,
          now,
          id,
          input.profileId,
        );
      if (result.changes !== 1) throw new Error('La entrada no existe.');
    }
    return this.listKnowledgeEntries(input.profileId).find(
      (item) => item.id === id,
    ) as KnowledgeEntry;
  }

  public deleteKnowledgeEntry(profileId: number, id: number): boolean {
    this.invalidateCachedAnswersForKnowledgeEntry(profileId, id);
    return (
      this.db
        .prepare('DELETE FROM knowledge_entries WHERE id = ? AND profile_id = ?')
        .run(id, profileId).changes === 1
    );
  }

  public searchKnowledge(
    profileId: number,
    question: string,
    maximumFragments = 3,
    maximumTokens = 700,
  ): KnowledgeFragment[] {
    const terms = normalizeSearchTerms(question);
    if (terms.length === 0) return [];
    const limit = Math.min(3, Math.max(1, Math.trunc(maximumFragments)));
    const query = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    let rows: Array<KnowledgeEntryRow & { relevance: number }>;
    try {
      rows = this.db
        .prepare(
          `SELECT entries.*, categories.name AS category_name,
             bm25(knowledge_entries_fts, 4.0, 1.0, 3.0, 2.0) AS relevance
           FROM knowledge_entries_fts
           JOIN knowledge_entries entries ON entries.id = knowledge_entries_fts.rowid
           JOIN knowledge_categories categories ON categories.id = entries.category_id
           WHERE knowledge_entries_fts MATCH ? AND entries.profile_id = ?
             AND entries.enabled = 1 AND categories.enabled = 1
           ORDER BY relevance ASC, entries.priority DESC LIMIT ?`,
        )
        .all(query, profileId, limit) as Array<KnowledgeEntryRow & { relevance: number }>;
    } catch {
      const like = `%${terms[0]}%`;
      rows = this.db
        .prepare(
          `SELECT entries.*, categories.name AS category_name, 100.0 AS relevance
           FROM knowledge_entries entries
           JOIN knowledge_categories categories ON categories.id = entries.category_id
           WHERE entries.profile_id = ? AND entries.enabled = 1 AND categories.enabled = 1
             AND (entries.title LIKE ? OR entries.content LIKE ? OR entries.keywords LIKE ?)
           ORDER BY entries.priority DESC LIMIT ?`,
        )
        .all(profileId, like, like, like, limit) as Array<
        KnowledgeEntryRow & { relevance: number }
      >;
    }
    let remainingCharacters = Math.max(1, Math.trunc(maximumTokens)) * 4;
    const fragments: KnowledgeFragment[] = [];
    for (const row of rows) {
      if (remainingCharacters <= 0) break;
      const content = row.content.slice(0, remainingCharacters).trim();
      if (content === '') continue;
      fragments.push({
        entryId: row.id,
        title: row.title,
        category: row.category_name,
        content,
        relevance: row.relevance,
        keywords: parseStringArray(row.keywords),
        internalSource: row.internal_source,
        updatedAt: row.updated_at,
      });
      remainingCharacters -= content.length;
    }
    return fragments;
  }

  public listCachedAnswers(botId: string, search = ''): CachedAnswer[] {
    const normalizedSearch = search.trim();
    const rows = this.db
      .prepare(
        `SELECT * FROM cached_answers
         WHERE bot_id = ? AND (? = '' OR canonical_question LIKE ? OR answer LIKE ? OR category LIKE ?)
         ORDER BY CASE status WHEN 'ADMIN_APPROVED' THEN 0 WHEN 'ADMIN_EDITED' THEN 1
           WHEN 'AUTO_VERIFIED' THEN 2 ELSE 3 END, updated_at DESC`,
      )
      .all(
        botId,
        normalizedSearch,
        `%${normalizedSearch}%`,
        `%${normalizedSearch}%`,
        `%${normalizedSearch}%`,
      ) as Array<Record<string, unknown>>;
    const variants = this.db.prepare(
      'SELECT variant FROM cached_answer_variants WHERE cached_answer_id = ? ORDER BY id',
    );
    return rows.map((row) =>
      mapCachedAnswer(
        row,
        (variants.all(Number(row.id)) as Array<{ variant: string }>).map((item) => item.variant),
      ),
    );
  }

  public getCachedAnswer(botId: string, id: number): CachedAnswer | null {
    return this.listCachedAnswers(botId).find((answer) => answer.id === id) ?? null;
  }

  public findExactCachedAnswer(
    botId: string,
    normalizedQuestionHash: string,
    now = new Date(),
  ): CachedAnswer | null {
    const row = this.db
      .prepare(
        `SELECT DISTINCT answers.* FROM cached_answers answers
         LEFT JOIN cached_answer_variants variants ON variants.cached_answer_id = answers.id
         WHERE answers.bot_id = ?
           AND (answers.normalized_question_hash = ? OR variants.normalized_question_hash = ?)
           AND answers.status IN ('AUTO_VERIFIED', 'ADMIN_APPROVED', 'ADMIN_EDITED')
           AND (answers.expires_at IS NULL OR answers.expires_at > ?)
         ORDER BY CASE answers.source_type WHEN 'ADMIN_FAQ' THEN 0 ELSE 1 END,
           CASE answers.status WHEN 'ADMIN_APPROVED' THEN 0 WHEN 'ADMIN_EDITED' THEN 1 ELSE 2 END
         LIMIT 1`,
      )
      .get(botId, normalizedQuestionHash, normalizedQuestionHash, now.toISOString()) as
      Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return this.getCachedAnswer(botId, Number(row.id));
  }

  public listReusableCachedAnswers(botId: string, now = new Date()): CachedAnswer[] {
    return this.listCachedAnswers(botId).filter(
      (answer) =>
        ['AUTO_VERIFIED', 'ADMIN_APPROVED', 'ADMIN_EDITED'].includes(answer.status) &&
        (answer.expiresAt === null || answer.expiresAt > now.toISOString()),
    );
  }

  public saveCachedAnswer(input: {
    id?: number;
    botId: string;
    canonicalQuestion: string;
    normalizedQuestionHash: string;
    answer: string;
    category: string;
    knowledgeSourceIds: number[];
    knowledgeVersion: string;
    promptVersion: string;
    status: CachedAnswerStatus;
    sourceType: CachedAnswerSourceType;
    confidence: number;
    expiresAt?: string | null;
  }): CachedAnswer {
    const canonicalQuestion = validatePlainText(input.canonicalQuestion, 'pregunta canónica', 1000);
    const answer = validatePlainText(input.answer, 'respuesta guardada', 8000);
    const category = validatePlainText(input.category, 'categoría', 200);
    if (!/^[a-f0-9]{64}$/u.test(input.normalizedQuestionHash))
      throw new Error('La huella de la pregunta no es válida.');
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
      throw new Error('La confianza no es válida.');
    const sourceIds = [
      ...new Set(input.knowledgeSourceIds.map((id) => Math.trunc(id)).filter((id) => id > 0)),
    ];
    const now = new Date().toISOString();
    let id = input.id;
    if (id === undefined) {
      const result = this.db
        .prepare(
          `INSERT INTO cached_answers(
           bot_id, canonical_question, normalized_question_hash, answer, category,
           knowledge_source_ids, knowledge_version, prompt_version, status, source_type,
           confidence, created_at, updated_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, normalized_question_hash) DO UPDATE SET
           canonical_question = excluded.canonical_question, answer = excluded.answer,
           category = excluded.category, knowledge_source_ids = excluded.knowledge_source_ids,
           knowledge_version = excluded.knowledge_version, prompt_version = excluded.prompt_version,
           status = excluded.status, source_type = excluded.source_type,
           confidence = excluded.confidence, updated_at = excluded.updated_at,
           expires_at = excluded.expires_at, invalidated_at = NULL, invalidation_reason = NULL`,
        )
        .run(
          input.botId,
          canonicalQuestion,
          input.normalizedQuestionHash,
          answer,
          category,
          JSON.stringify(sourceIds),
          input.knowledgeVersion,
          input.promptVersion,
          input.status,
          input.sourceType,
          input.confidence,
          now,
          now,
          input.expiresAt ?? null,
        );
      id =
        result.changes === 1
          ? Number(
              (
                this.db
                  .prepare(
                    'SELECT id FROM cached_answers WHERE bot_id = ? AND normalized_question_hash = ?',
                  )
                  .get(input.botId, input.normalizedQuestionHash) as { id: number }
              ).id,
            )
          : Number(result.lastInsertRowid);
    } else {
      const changed = this.db
        .prepare(
          `UPDATE cached_answers SET canonical_question = ?, normalized_question_hash = ?,
           answer = ?, category = ?, knowledge_source_ids = ?, knowledge_version = ?,
           prompt_version = ?, status = ?, source_type = ?, confidence = ?, updated_at = ?,
           expires_at = ?, invalidated_at = NULL, invalidation_reason = NULL
         WHERE id = ? AND bot_id = ?`,
        )
        .run(
          canonicalQuestion,
          input.normalizedQuestionHash,
          answer,
          category,
          JSON.stringify(sourceIds),
          input.knowledgeVersion,
          input.promptVersion,
          input.status,
          input.sourceType,
          input.confidence,
          now,
          input.expiresAt ?? null,
          id,
          input.botId,
        );
      if (changed.changes !== 1) throw new Error('La respuesta guardada no existe.');
    }
    return this.getCachedAnswer(input.botId, id) as CachedAnswer;
  }

  public addCachedAnswerVariant(
    botId: string,
    answerId: number,
    variant: string,
    normalizedHash: string,
  ): CachedAnswer {
    if (this.getCachedAnswer(botId, answerId) === null)
      throw new Error('La respuesta guardada no existe.');
    if (!/^[a-f0-9]{64}$/u.test(normalizedHash))
      throw new Error('La huella de la variante no es válida.');
    this.db
      .prepare(
        `INSERT INTO cached_answer_variants(cached_answer_id, variant, normalized_question_hash, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(cached_answer_id, normalized_question_hash) DO UPDATE SET variant = excluded.variant`,
      )
      .run(
        answerId,
        validatePlainText(variant, 'variante', 1000),
        normalizedHash,
        new Date().toISOString(),
      );
    return this.getCachedAnswer(botId, answerId) as CachedAnswer;
  }

  public setCachedAnswerStatus(
    botId: string,
    answerId: number,
    status: CachedAnswerStatus,
    reason: string | null = null,
  ): CachedAnswer {
    const now = new Date().toISOString();
    const invalidated = status === 'INVALIDATED';
    const changed = this.db
      .prepare(
        `UPDATE cached_answers SET status = ?, updated_at = ?, invalidated_at = ?, invalidation_reason = ?
       WHERE id = ? AND bot_id = ?`,
      )
      .run(
        status,
        now,
        invalidated ? now : null,
        invalidated ? validatePlainText(reason ?? 'ADMIN_INVALIDATION', 'motivo', 200) : null,
        answerId,
        botId,
      );
    if (changed.changes !== 1) throw new Error('La respuesta guardada no existe.');
    return this.getCachedAnswer(botId, answerId) as CachedAnswer;
  }

  public deleteCachedAnswer(botId: string, answerId: number): boolean {
    return (
      this.db.prepare('DELETE FROM cached_answers WHERE id = ? AND bot_id = ?').run(answerId, botId)
        .changes === 1
    );
  }

  public recordCachedAnswerHit(botId: string, answerId: number): void {
    this.db
      .prepare(
        `UPDATE cached_answers SET hit_count = hit_count + 1, api_calls_saved = api_calls_saved + 1,
       last_used_at = ?, updated_at = ? WHERE id = ? AND bot_id = ?`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), answerId, botId);
  }

  public invalidateCachedAnswersForKnowledgeEntry(profileId: number, entryId: number): number {
    const owner = this.db
      .prepare('SELECT bot_id FROM assistant_profiles WHERE id = ?')
      .get(profileId) as { bot_id: string } | undefined;
    if (owner === undefined) return 0;
    const now = new Date().toISOString();
    return this.db
      .prepare(
        `UPDATE cached_answers SET status = 'INVALIDATED', invalidated_at = ?, updated_at = ?,
         invalidation_reason = 'KNOWLEDGE_SOURCE_CHANGED'
       WHERE bot_id = ? AND status IN ('AUTO_VERIFIED', 'ADMIN_APPROVED', 'ADMIN_EDITED')
         AND EXISTS (SELECT 1 FROM json_each(cached_answers.knowledge_source_ids) WHERE value = ?)`,
      )
      .run(now, now, owner.bot_id, entryId).changes;
  }

  public getAISettings(profileId: number): AISettings {
    const row = this.db.prepare('SELECT * FROM ai_settings WHERE profile_id = ?').get(profileId) as
      Record<string, number | string> | undefined;
    if (row === undefined) throw new Error('No existe configuración de IA para el perfil.');
    return mapAISettings(row);
  }

  public saveAISettings(settings: AISettings): AISettings {
    validateAISettings(settings);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE ai_settings SET enabled = ?, provider = ?, model = ?, provider_config = ?, question_max_chars = ?,
           context_max_tokens = ?, input_max_tokens = ?, response_max_tokens = ?,
           response_max_chars = ?, response_max_lines = ?, temperature = ?,
           user_hourly_limit = ?, user_daily_limit = ?, user_cooldown_seconds = ?,
           interaction_hourly_limit = ?, interaction_cooldown_seconds = ?,
           duplicate_query_window_seconds = ?, conversation_hourly_limit = ?, conversation_daily_limit = ?, global_daily_limit = ?,
           global_monthly_limit = ?, global_daily_token_limit = ?,
           global_monthly_token_limit = ?, timeout_ms = ?, updated_at = ? WHERE profile_id = ?`,
      )
      .run(
        settings.enabled ? 1 : 0,
        settings.provider,
        settings.model,
        JSON.stringify(settings.provider === 'groq' ? { model: settings.model } : {}),
        settings.questionMaxChars,
        settings.contextMaxTokens,
        settings.inputMaxTokens,
        settings.responseMaxTokens,
        settings.responseMaxChars,
        settings.responseMaxLines,
        settings.temperature,
        settings.userHourlyLimit,
        settings.userDailyLimit,
        settings.userCooldownSeconds,
        settings.interactionHourlyLimit,
        settings.interactionCooldownSeconds,
        settings.duplicateQueryWindowSeconds,
        settings.conversationHourlyLimit,
        settings.conversationDailyLimit,
        settings.globalDailyLimit,
        settings.globalMonthlyLimit,
        settings.globalDailyTokenLimit,
        settings.globalMonthlyTokenLimit,
        settings.timeoutMs,
        now,
        settings.profileId,
      );
    if (result.changes !== 1) throw new Error('La configuración de IA no existe.');
    return this.getAISettings(settings.profileId);
  }

  public getAIProviderStatus(
    profileId: number,
    configured: boolean,
    _model?: string,
  ): AIProviderStatus {
    const settings = this.getAISettings(profileId);
    const row = this.db
      .prepare('SELECT * FROM provider_health WHERE profile_id = ?')
      .get(profileId) as
      | {
          connection_status: 'not_tested' | 'successful' | 'failed';
          last_checked_at: string | null;
          last_error_code: string | null;
        }
      | undefined;
    return {
      configured,
      enabled: settings.enabled,
      provider: settings.provider,
      model: settings.model,
      connection: row?.connection_status ?? 'not_tested',
      lastCheckedAt: row?.last_checked_at ?? null,
      lastErrorCode: row?.last_error_code ?? null,
    };
  }

  public getGlobalAILimits(): {
    dailyRequestLimit: number;
    monthlyRequestLimit: number;
    dailyTokenLimit: number;
    monthlyTokenLimit: number;
  } {
    const row = this.db.prepare('SELECT * FROM global_ai_limits WHERE id = 1').get() as {
      daily_request_limit: number;
      monthly_request_limit: number;
      daily_token_limit: number;
      monthly_token_limit: number;
    };
    return {
      dailyRequestLimit: row.daily_request_limit,
      monthlyRequestLimit: row.monthly_request_limit,
      dailyTokenLimit: row.daily_token_limit,
      monthlyTokenLimit: row.monthly_token_limit,
    };
  }

  public saveGlobalAILimits(input: {
    dailyRequestLimit: number;
    monthlyRequestLimit: number;
    dailyTokenLimit: number;
    monthlyTokenLimit: number;
  }): ReturnType<AppDatabase['getGlobalAILimits']> {
    if (input.monthlyRequestLimit < input.dailyRequestLimit)
      throw new Error('El límite mensual global no puede ser menor que el diario.');
    if (input.monthlyTokenLimit < input.dailyTokenLimit)
      throw new Error('El límite mensual global de tokens no puede ser menor que el diario.');
    const changed = this.db
      .prepare(
        `UPDATE global_ai_limits SET daily_request_limit = ?, monthly_request_limit = ?,
           daily_token_limit = ?, monthly_token_limit = ?, updated_at = ? WHERE id = 1`,
      )
      .run(
        input.dailyRequestLimit,
        input.monthlyRequestLimit,
        input.dailyTokenLimit,
        input.monthlyTokenLimit,
        new Date().toISOString(),
      );
    if (changed.changes !== 1) throw new Error('No fue posible guardar el presupuesto global.');
    return this.getGlobalAILimits();
  }

  public updateAIProviderHealth(
    profileId: number,
    provider: string,
    successful: boolean,
    errorCode: string | null,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO provider_health(
           profile_id, provider, connection_status, last_checked_at, last_error_code, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET provider = excluded.provider,
           connection_status = excluded.connection_status, last_checked_at = excluded.last_checked_at,
           last_error_code = excluded.last_error_code, updated_at = excluded.updated_at`,
      )
      .run(profileId, provider, successful ? 'successful' : 'failed', now, errorCode, now);
  }

  public getAIQueueSettings(botId: string): AIQueueSettings {
    const row = this.db
      .prepare('SELECT * FROM assistant_ai_queue_settings WHERE assistant_id = ?')
      .get(botId) as Record<string, number> | undefined;
    if (row === undefined) {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO assistant_ai_queue_settings(assistant_id, created_at, updated_at)
        VALUES (?, ?, ?)`,
        )
        .run(botId, now, now);
      return this.getAIQueueSettings(botId);
    }
    return {
      maxConcurrent: row.max_concurrent ?? 3,
      maxQueueSize: row.max_queue_size ?? 20,
      maxQueueWaitSeconds: row.max_queue_wait_seconds ?? 60,
      providerTimeoutSeconds: row.provider_timeout_seconds ?? 25,
      maxRetries: row.max_retries ?? 2,
      initialRetryDelaySeconds: row.initial_retry_delay_seconds ?? 2,
      maximumRetryDelaySeconds: row.maximum_retry_delay_seconds ?? 15,
      waitNoticeSeconds: row.wait_notice_seconds ?? 5,
      userCooldownSeconds: row.user_cooldown_seconds ?? 10,
      duplicateWindowSeconds: row.duplicate_window_seconds ?? 15,
      singleFlightWindowSeconds: row.single_flight_window_seconds ?? 60,
      outboundMessageIntervalMs: row.outbound_message_interval_ms ?? 1000,
      suggestedRetrySeconds: row.suggested_retry_seconds ?? 60,
    };
  }

  public saveAIQueueSettings(botId: string, settings: AIQueueSettings): AIQueueSettings {
    const now = new Date().toISOString();
    const changed = this.db
      .prepare(
        `UPDATE assistant_ai_queue_settings SET
      max_concurrent=?, max_queue_size=?, max_queue_wait_seconds=?, provider_timeout_seconds=?,
      max_retries=?, initial_retry_delay_seconds=?, maximum_retry_delay_seconds=?, wait_notice_seconds=?,
      user_cooldown_seconds=?, duplicate_window_seconds=?, single_flight_window_seconds=?,
      outbound_message_interval_ms=?, suggested_retry_seconds=?, updated_at=? WHERE assistant_id=?`,
      )
      .run(
        settings.maxConcurrent,
        settings.maxQueueSize,
        settings.maxQueueWaitSeconds,
        settings.providerTimeoutSeconds,
        settings.maxRetries,
        settings.initialRetryDelaySeconds,
        settings.maximumRetryDelaySeconds,
        settings.waitNoticeSeconds,
        settings.userCooldownSeconds,
        settings.duplicateWindowSeconds,
        settings.singleFlightWindowSeconds,
        settings.outboundMessageIntervalMs,
        settings.suggestedRetrySeconds,
        now,
        botId,
      );
    if (changed.changes !== 1) throw new Error('AI_QUEUE_SETTINGS_NOT_FOUND');
    return this.getAIQueueSettings(botId);
  }

  public recordAIQueueMetric(
    botId: string,
    localDate: string,
    field: keyof Omit<AIQueueMetrics, 'averageWaitMs' | 'maximumWaitMs'>,
    waitMs = 0,
  ): void {
    const columns: Record<string, string> = {
      queuedCount: 'queued_count',
      processedCount: 'processed_count',
      completedCount: 'completed_count',
      failedCount: 'failed_count',
      expiredCount: 'expired_count',
      rejectedCount: 'rejected_count',
      timeoutCount: 'timeout_count',
      rateLimitCount: 'rate_limit_count',
      retryCount: 'retry_count',
      coalescedCount: 'coalesced_count',
      duplicateSuppressedCount: 'duplicate_suppressed_count',
      cacheBypassCount: 'cache_bypass_count',
    };
    const column = columns[field];
    if (column === undefined) throw new Error('AI_QUEUE_METRIC_INVALID');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO assistant_ai_queue_metrics(
      assistant_id, local_date, ${column}, total_wait_ms, maximum_wait_ms, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(assistant_id, local_date) DO UPDATE SET ${column}=${column}+1,
      total_wait_ms=total_wait_ms+excluded.total_wait_ms,
      maximum_wait_ms=MAX(maximum_wait_ms, excluded.maximum_wait_ms), updated_at=excluded.updated_at`,
      )
      .run(
        botId,
        localDate,
        Math.max(0, Math.trunc(waitMs)),
        Math.max(0, Math.trunc(waitMs)),
        now,
        now,
      );
  }

  public getAIQueueMetrics(botId: string, localDate: string): AIQueueMetrics {
    const row = this.db
      .prepare('SELECT * FROM assistant_ai_queue_metrics WHERE assistant_id=? AND local_date=?')
      .get(botId, localDate) as Record<string, number> | undefined;
    const value = (key: string): number => row?.[key] ?? 0;
    const processed = value('processed_count');
    return {
      queuedCount: value('queued_count'),
      processedCount: processed,
      completedCount: value('completed_count'),
      failedCount: value('failed_count'),
      expiredCount: value('expired_count'),
      rejectedCount: value('rejected_count'),
      timeoutCount: value('timeout_count'),
      rateLimitCount: value('rate_limit_count'),
      retryCount: value('retry_count'),
      coalescedCount: value('coalesced_count'),
      duplicateSuppressedCount: value('duplicate_suppressed_count'),
      cacheBypassCount: value('cache_bypass_count'),
      averageWaitMs: processed === 0 ? 0 : Math.round(value('total_wait_ms') / processed),
      maximumWaitMs: value('maximum_wait_ms'),
    };
  }

  public saveAIProviderQueueHealth(input: {
    botId: string;
    provider: string;
    state: AIProviderHealthState;
    consecutiveFailures: number;
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    circuitOpenedAt: string | null;
    circuitRetryAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastSafeErrorCode: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO assistant_ai_provider_health(
      assistant_id,provider,state,consecutive_failures,circuit_state,circuit_opened_at,circuit_retry_at,
      last_success_at,last_failure_at,last_safe_error_code,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(assistant_id,provider) DO UPDATE SET
      state=excluded.state,consecutive_failures=excluded.consecutive_failures,circuit_state=excluded.circuit_state,
      circuit_opened_at=excluded.circuit_opened_at,circuit_retry_at=excluded.circuit_retry_at,
      last_success_at=excluded.last_success_at,last_failure_at=excluded.last_failure_at,
      last_safe_error_code=excluded.last_safe_error_code,updated_at=excluded.updated_at`,
      )
      .run(
        input.botId,
        input.provider,
        input.state,
        input.consecutiveFailures,
        input.circuitState,
        input.circuitOpenedAt,
        input.circuitRetryAt,
        input.lastSuccessAt,
        input.lastFailureAt,
        input.lastSafeErrorCode,
        new Date().toISOString(),
      );
  }

  public getAIProviderQueueHealth(botId: string): Record<string, unknown> {
    return (
      (this.db
        .prepare(
          `SELECT provider,state,consecutive_failures AS consecutiveFailures,
      circuit_state AS circuitState,circuit_opened_at AS circuitOpenedAt,circuit_retry_at AS circuitRetryAt,
      last_success_at AS lastSuccessAt,last_failure_at AS lastFailureAt,last_safe_error_code AS lastSafeErrorCode,
      updated_at AS updatedAt FROM assistant_ai_provider_health WHERE assistant_id=? AND provider='groq'`,
        )
        .get(botId) as Record<string, unknown> | undefined) ?? {
        provider: 'groq',
        state: 'NOT_CONFIGURED',
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        lastSafeErrorCode: null,
      }
    );
  }

  public reserveAIUsage(input: {
    botId?: string;
    profileId: number;
    userHash: string;
    conversationHash: string;
    localDate: string;
    localMonth: string;
    hourBucket: string;
    estimatedInputTokens: number;
    reservedOutputTokens: number;
    now?: Date;
  }): AIReservationDecision {
    const reserve = this.db.transaction((): AIReservationDecision => {
      const now = input.now ?? new Date();
      const nowIso = now.toISOString();
      this.db
        .prepare(
          "UPDATE ai_request_reservations SET status = 'RELEASED' WHERE status = 'PENDING' AND expires_at <= ?",
        )
        .run(nowIso);
      const settings = this.getAISettings(input.profileId);
      const botId = input.botId ?? DEFAULT_BUSINESS_ASSISTANT_ID;
      const pending = this.db
        .prepare(
          `SELECT COUNT(*) AS requests,
             COALESCE(SUM(estimated_input_tokens + reserved_output_tokens), 0) AS tokens
           FROM ai_request_reservations
           WHERE profile_id = ? AND status = 'PENDING' AND expires_at > ?`,
        )
        .get(input.profileId, nowIso) as { requests: number; tokens: number };
      const globalPending = this.db
        .prepare(
          `SELECT COUNT(*) AS requests,
             COALESCE(SUM(estimated_input_tokens + reserved_output_tokens), 0) AS tokens
           FROM ai_request_reservations WHERE status = 'PENDING' AND expires_at > ?`,
        )
        .get(nowIso) as { requests: number; tokens: number };
      const user = this.db
        .prepare(
          `SELECT COALESCE(SUM(requests), 0) AS daily,
             COALESCE(SUM(CASE WHEN hour_bucket = ? THEN requests ELSE 0 END), 0) AS hourly,
             MAX(last_request_at) AS last_request_at
           FROM ai_usage_by_anonymized_user
           WHERE profile_id = ? AND user_hash = ? AND local_date = ?`,
        )
        .get(input.hourBucket, input.profileId, input.userHash, input.localDate) as {
        daily: number;
        hourly: number;
        last_request_at: string | null;
      };
      const pendingUser = this.db
        .prepare(
          `SELECT COUNT(*) AS daily,
             COALESCE(SUM(CASE WHEN hour_bucket = ? THEN 1 ELSE 0 END), 0) AS hourly,
             MAX(created_at) AS last_request_at
           FROM ai_request_reservations
           WHERE profile_id = ? AND user_hash = ? AND local_date = ?
             AND status = 'PENDING' AND expires_at > ?`,
        )
        .get(input.hourBucket, input.profileId, input.userHash, input.localDate, nowIso) as {
        daily: number;
        hourly: number;
        last_request_at: string | null;
      };
      if (user.hourly + pendingUser.hourly >= settings.userHourlyLimit)
        return { allowed: false, code: 'AI_LIMIT_USER_HOURLY_REACHED' };
      if (user.daily + pendingUser.daily >= settings.userDailyLimit)
        return { allowed: false, code: 'AI_LIMIT_USER_DAILY_REACHED' };
      const conversation = this.db
        .prepare(
          `SELECT COALESCE(SUM(requests), 0) AS daily,
             COALESCE(SUM(CASE WHEN hour_bucket = ? THEN requests ELSE 0 END), 0) AS hourly
           FROM ai_usage_by_conversation
           WHERE profile_id = ? AND conversation_hash = ? AND local_date = ?`,
        )
        .get(input.hourBucket, input.profileId, input.conversationHash, input.localDate) as {
        daily: number;
        hourly: number;
      };
      const pendingConversation = this.db
        .prepare(
          `SELECT COUNT(*) AS daily,
             COALESCE(SUM(CASE WHEN hour_bucket = ? THEN 1 ELSE 0 END), 0) AS hourly
           FROM ai_request_reservations
           WHERE profile_id = ? AND conversation_hash = ? AND local_date = ?
             AND status = 'PENDING' AND expires_at > ?`,
        )
        .get(
          input.hourBucket,
          input.profileId,
          input.conversationHash,
          input.localDate,
          nowIso,
        ) as {
        daily: number;
        hourly: number;
      };
      if (conversation.hourly + pendingConversation.hourly >= settings.conversationHourlyLimit)
        return { allowed: false, code: 'AI_LIMIT_CONVERSATION_HOURLY_REACHED' };
      if (conversation.daily + pendingConversation.daily >= settings.conversationDailyLimit)
        return { allowed: false, code: 'AI_LIMIT_CONVERSATION_DAILY_REACHED' };
      const daily = this.db
        .prepare(
          'SELECT requests, total_tokens FROM ai_usage_daily WHERE profile_id = ? AND local_date = ?',
        )
        .get(input.profileId, input.localDate) as
        { requests: number; total_tokens: number } | undefined;
      const monthly = this.db
        .prepare(
          'SELECT requests, total_tokens FROM ai_usage_monthly WHERE profile_id = ? AND local_month = ?',
        )
        .get(input.profileId, input.localMonth) as
        { requests: number; total_tokens: number } | undefined;
      const globalLimits = this.db.prepare('SELECT * FROM global_ai_limits WHERE id = 1').get() as {
        daily_request_limit: number;
        monthly_request_limit: number;
        daily_token_limit: number;
        monthly_token_limit: number;
      };
      const globalDaily = this.db
        .prepare(
          'SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens FROM ai_usage_daily WHERE local_date = ?',
        )
        .get(input.localDate) as { requests: number; tokens: number };
      const globalMonthly = this.db
        .prepare(
          'SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens FROM ai_usage_monthly WHERE local_month = ?',
        )
        .get(input.localMonth) as { requests: number; tokens: number };
      if ((daily?.requests ?? 0) + pending.requests >= settings.globalDailyLimit)
        return { allowed: false, code: 'AI_LIMIT_DAILY_REACHED' };
      if ((monthly?.requests ?? 0) + pending.requests >= settings.globalMonthlyLimit)
        return { allowed: false, code: 'AI_LIMIT_MONTHLY_REACHED' };
      const reservationTokens = input.estimatedInputTokens + input.reservedOutputTokens;
      if (
        (daily?.total_tokens ?? 0) + pending.tokens + reservationTokens >
        settings.globalDailyTokenLimit
      )
        return { allowed: false, code: 'AI_LIMIT_DAILY_TOKENS_REACHED' };
      if (
        (monthly?.total_tokens ?? 0) + pending.tokens + reservationTokens >
        settings.globalMonthlyTokenLimit
      )
        return { allowed: false, code: 'AI_LIMIT_MONTHLY_TOKENS_REACHED' };
      if (globalDaily.requests + globalPending.requests >= globalLimits.daily_request_limit)
        return { allowed: false, code: 'AI_LIMIT_DAILY_REACHED' };
      if (globalMonthly.requests + globalPending.requests >= globalLimits.monthly_request_limit)
        return { allowed: false, code: 'AI_LIMIT_MONTHLY_REACHED' };
      if (
        globalDaily.tokens + globalPending.tokens + reservationTokens >
        globalLimits.daily_token_limit
      )
        return { allowed: false, code: 'AI_LIMIT_DAILY_TOKENS_REACHED' };
      if (
        globalMonthly.tokens + globalPending.tokens + reservationTokens >
        globalLimits.monthly_token_limit
      )
        return { allowed: false, code: 'AI_LIMIT_MONTHLY_TOKENS_REACHED' };
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO ai_request_reservations(
             id, profile_id, user_hash, conversation_hash, local_date, local_month, hour_bucket,
             bot_id,
             estimated_input_tokens, reserved_output_tokens, status, created_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        )
        .run(
          id,
          input.profileId,
          input.userHash,
          input.conversationHash,
          input.localDate,
          input.localMonth,
          input.hourBucket,
          botId,
          input.estimatedInputTokens,
          input.reservedOutputTokens,
          nowIso,
          new Date(now.getTime() + settings.timeoutMs * 2 + 5000).toISOString(),
        );
      return {
        allowed: true,
        reservation: {
          id,
          profileId: input.profileId,
          estimatedInputTokens: input.estimatedInputTokens,
          reservedOutputTokens: input.reservedOutputTokens,
        },
      };
    });
    return reserve();
  }

  public completeAIUsageReservation(
    reservationId: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
    result: 'success' | 'failed',
    errorCode: string | null,
    hourBucket: string,
  ): boolean {
    const complete = this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM ai_request_reservations WHERE id = ? AND status = 'PENDING'")
        .get(reservationId) as
        | {
            profile_id: number;
            user_hash: string;
            conversation_hash: string;
            local_date: string;
            local_month: string;
            bot_id: string;
          }
        | undefined;
      if (row === undefined) return false;
      const now = new Date().toISOString();
      if (result === 'failed') {
        this.db
          .prepare(
            `INSERT INTO ai_usage_events(
             profile_id, local_date, local_month, conversation_hash, user_hash, result, error_code,
             input_tokens, output_tokens, total_tokens, created_at, bot_id
           ) VALUES (?, ?, ?, ?, ?, 'failed', ?, 0, 0, 0, ?, ?)`,
          )
          .run(
            row.profile_id,
            row.local_date,
            row.local_month,
            row.conversation_hash,
            row.user_hash,
            errorCode,
            now,
            row.bot_id,
          );
        this.db
          .prepare(
            "UPDATE ai_request_reservations SET status = 'RELEASED', completed_at = ? WHERE id = ?",
          )
          .run(now, reservationId);
        return true;
      }
      this.upsertAIUsageAggregate(
        'ai_usage_daily',
        'local_date',
        row.bot_id,
        row.profile_id,
        row.local_date,
        usage,
        0,
        now,
      );
      this.upsertAIUsageAggregate(
        'ai_usage_monthly',
        'local_month',
        row.bot_id,
        row.profile_id,
        row.local_month,
        usage,
        0,
        now,
      );
      this.db
        .prepare(
          `INSERT INTO ai_usage_by_anonymized_user(
             profile_id, user_hash, local_date, hour_bucket, requests, input_tokens,
             output_tokens, total_tokens, last_request_at, bot_id
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, user_hash, local_date, hour_bucket) DO UPDATE SET
             requests = requests + 1, input_tokens = input_tokens + excluded.input_tokens,
             output_tokens = output_tokens + excluded.output_tokens,
             total_tokens = total_tokens + excluded.total_tokens,
             last_request_at = excluded.last_request_at`,
        )
        .run(
          row.profile_id,
          row.user_hash,
          row.local_date,
          hourBucket,
          usage.inputTokens,
          usage.outputTokens,
          usage.totalTokens,
          now,
          row.bot_id,
        );
      this.db
        .prepare(
          `INSERT INTO ai_usage_by_conversation(
             profile_id, conversation_hash, local_date, hour_bucket, requests, input_tokens,
             output_tokens, total_tokens, updated_at, bot_id
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, conversation_hash, local_date, hour_bucket) DO UPDATE SET
             requests = requests + 1, input_tokens = input_tokens + excluded.input_tokens,
             output_tokens = output_tokens + excluded.output_tokens,
             total_tokens = total_tokens + excluded.total_tokens, updated_at = excluded.updated_at`,
        )
        .run(
          row.profile_id,
          row.conversation_hash,
          row.local_date,
          hourBucket,
          usage.inputTokens,
          usage.outputTokens,
          usage.totalTokens,
          now,
          row.bot_id,
        );
      this.db
        .prepare(
          `INSERT INTO ai_usage_events(
             profile_id, local_date, local_month, conversation_hash, user_hash, result, error_code,
             input_tokens, output_tokens, total_tokens, created_at, bot_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.profile_id,
          row.local_date,
          row.local_month,
          row.conversation_hash,
          row.user_hash,
          result,
          errorCode,
          usage.inputTokens,
          usage.outputTokens,
          usage.totalTokens,
          now,
          row.bot_id,
        );
      this.db
        .prepare(
          "UPDATE ai_request_reservations SET status = 'COMPLETED', completed_at = ? WHERE id = ?",
        )
        .run(now, reservationId);
      return true;
    });
    return complete();
  }

  private upsertAIUsageAggregate(
    table: 'ai_usage_daily' | 'ai_usage_monthly',
    periodColumn: 'local_date' | 'local_month',
    botId: string,
    profileId: number,
    period: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
    failed: number,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${table}(
           profile_id, ${periodColumn}, requests, failed_requests, input_tokens,
           output_tokens, total_tokens, updated_at, bot_id
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, ${periodColumn}) DO UPDATE SET
           requests = requests + 1, failed_requests = failed_requests + excluded.failed_requests,
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           total_tokens = total_tokens + excluded.total_tokens, updated_at = excluded.updated_at`,
      )
      .run(
        profileId,
        period,
        failed,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        now,
        botId,
      );
  }

  public releaseAIUsageReservation(reservationId: string): void {
    this.db
      .prepare(
        "UPDATE ai_request_reservations SET status = 'RELEASED' WHERE id = ? AND status = 'PENDING'",
      )
      .run(reservationId);
  }

  public getAIUsageSummary(
    profileId: number,
    localDate: string,
    localMonth: string,
  ): AIUsageSummary & { monthlyRequests: number; monthlyTokens: number } {
    const daily = this.db
      .prepare('SELECT * FROM ai_usage_daily WHERE profile_id = ? AND local_date = ?')
      .get(profileId, localDate) as Record<string, number> | undefined;
    const monthly = this.db
      .prepare('SELECT * FROM ai_usage_monthly WHERE profile_id = ? AND local_month = ?')
      .get(profileId, localMonth) as Record<string, number> | undefined;
    const settings = this.getAISettings(profileId);
    const requests = daily?.requests ?? 0;
    const totalTokens = daily?.total_tokens ?? 0;
    return {
      requests,
      failedRequests: Number(
        (
          this.db
            .prepare(
              "SELECT COUNT(*) AS count FROM ai_usage_events WHERE profile_id = ? AND local_date = ? AND result = 'failed'",
            )
            .get(profileId, localDate) as { count: number }
        ).count,
      ),
      inputTokens: daily?.input_tokens ?? 0,
      outputTokens: daily?.output_tokens ?? 0,
      totalTokens,
      dailyBudgetPercent: Math.min(
        100,
        Math.max(
          (requests / settings.globalDailyLimit) * 100,
          (totalTokens / settings.globalDailyTokenLimit) * 100,
        ),
      ),
      monthlyBudgetPercent: Math.min(
        100,
        Math.max(
          ((monthly?.requests ?? 0) / settings.globalMonthlyLimit) * 100,
          ((monthly?.total_tokens ?? 0) / settings.globalMonthlyTokenLimit) * 100,
        ),
      ),
      monthlyRequests: monthly?.requests ?? 0,
      monthlyTokens: monthly?.total_tokens ?? 0,
    };
  }

  public listRecentAIUsageEvents(profileId: number, limit = 50): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        `SELECT local_date, local_month, result, error_code, input_tokens, output_tokens,
           total_tokens, created_at FROM ai_usage_events
         WHERE profile_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(profileId, Math.min(500, Math.max(1, Math.trunc(limit)))) as Array<
      Record<string, unknown>
    >;
  }

  public getBotOperationalMetrics(botId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT event_type, COUNT(*) AS count FROM technical_events
       WHERE bot_id = ? GROUP BY event_type`,
      )
      .all(botId) as Array<{ event_type: string; count: number }>;
    const count = new Map(rows.map((row) => [row.event_type, row.count]));
    const value = (event: string): number => count.get(event) ?? 0;
    const faqs = value('LOCAL_FAQ_RESPONSE');
    const knowledge = value('KNOWLEDGE_DIRECT_RESPONSE');
    const exact = value('ANSWER_CACHE_EXACT_HIT');
    const equivalent = value('ANSWER_CACHE_EQUIVALENT_HIT');
    return {
      localResponses: faqs + knowledge + exact + equivalent,
      faqs,
      cacheHits: exact + equivalent,
      directKnowledge: knowledge,
      aiCalls: value('AI_CALL_SUCCESS') + value('AI_CALL_FAILED'),
      aiSuccesses: value('AI_CALL_SUCCESS'),
      aiFailures: value('AI_CALL_FAILED'),
      quotaRejections: value('AI_LIMIT_REACHED'),
      outOfScope: value('OUT_OF_SCOPE_LOCAL_RESPONSE'),
      noInformation: value('KNOWLEDGE_NOT_FOUND'),
      avoidedAICalls: faqs + knowledge + exact + equivalent,
      duplicateQueries: value('DUPLICATE_QUERY_SUPPRESSED'),
      coalescedQueries: value('CONCURRENT_QUERY_COALESCED'),
    };
  }

  public resetAIUsageForDevelopment(profileId: number): void {
    const reset = this.db.transaction(() => {
      for (const table of [
        'ai_usage_daily',
        'ai_usage_monthly',
        'ai_usage_by_anonymized_user',
        'ai_usage_by_conversation',
        'ai_request_reservations',
        'ai_usage_events',
      ]) {
        this.db.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profileId);
      }
      this.db
        .prepare(
          'DELETE FROM technical_events WHERE bot_id = (SELECT bot_id FROM assistant_profiles WHERE id = ?)',
        )
        .run(profileId);
    });
    reset();
  }

  public addAdministrator(phoneNumber: string): boolean {
    const normalized = requireAdministratorPhoneNumber(phoneNumber);
    const result = this.db
      .prepare('INSERT OR IGNORE INTO administrators(phone_number, created_at) VALUES (?, ?)')
      .run(normalized, new Date().toISOString());
    return result.changes === 1;
  }

  public removeAdministrator(phoneNumber: string): boolean {
    const normalized = canonicalPhoneIdentity(phoneNumber);
    if (normalized === null) return false;
    return (
      this.db.prepare('DELETE FROM administrators WHERE phone_number = ?').run(normalized)
        .changes === 1
    );
  }

  public isAdministrator(phoneNumber: string): boolean {
    const normalized = canonicalPhoneIdentity(phoneNumber);
    if (normalized === null) return false;
    return (
      this.db.prepare('SELECT 1 FROM administrators WHERE phone_number = ?').get(normalized) !==
      undefined
    );
  }

  public getAdministratorCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM administrators').get() as {
      count: number;
    };
    return row.count;
  }

  public listAdministrators(): string[] {
    return (
      this.db
        .prepare('SELECT phone_number FROM administrators ORDER BY created_at')
        .all() as Array<{
        phone_number: string;
      }>
    ).map((row) => row.phone_number);
  }

  public recordTechnicalEvent(event: TechnicalEvent): void {
    const businessId =
      event.businessId ??
      (event.botId === undefined ? null : (this.getBot(event.botId)?.businessId ?? null));
    this.db
      .prepare(
        `
        INSERT INTO technical_events
          (bot_id, event_type, source, activation_type, conversation_hash, customer_hash,
           result, duration_ms, error_code, item_count, business_id, channel, route,
           ai_provider, ai_model, knowledge_used, status, tool_requested, tool_executed,
           result_count, presentation, action_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        event.botId ?? null,
        event.eventType,
        event.source ?? null,
        event.activationType ?? null,
        event.conversationHash ?? null,
        event.customerHash ?? null,
        event.result,
        event.durationMs ?? null,
        event.errorCode ?? null,
        event.itemCount ?? null,
        businessId,
        event.channel ?? null,
        event.route ?? null,
        event.aiProvider ?? null,
        event.aiModel ?? null,
        event.knowledgeUsed === undefined ? null : event.knowledgeUsed ? 1 : 0,
        event.status ?? event.result,
        event.toolRequested ?? null,
        event.toolExecuted ?? null,
        event.resultCount ?? null,
        event.presentation ?? null,
        event.actionIds === undefined ? null : JSON.stringify(event.actionIds),
        new Date().toISOString(),
      );
  }

  public getTechnicalEvents(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM technical_events ORDER BY id').all() as Array<
      Record<string, unknown>
    >;
  }

  public listAssistantActivity(botId: string, limit = 200): AssistantActivityEvent[] {
    const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `SELECT id, created_at, event_type, source, customer_hash, conversation_hash, result, error_code,
                duration_ms
         FROM technical_events
         WHERE bot_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(botId, boundedLimit) as Array<{
      id: number;
      created_at: string;
      event_type: string;
      source: string | null;
      customer_hash: string | null;
      conversation_hash: string | null;
      result: string;
      error_code: string | null;
      duration_ms: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.created_at,
      eventType: row.event_type,
      source: row.source,
      customerHash: row.customer_hash,
      conversationHash: row.conversation_hash,
      result: row.result,
      errorCode: row.error_code,
      durationMs: row.duration_ms,
    }));
  }

  public getAuditEvents(): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT * FROM audit_events ORDER BY id').all() as Array<
      Record<string, unknown>
    >;
  }

  public getPanelPasswordHash(username = 'admin'): string | null {
    const row = this.db
      .prepare('SELECT password_hash FROM panel_users WHERE username = ?')
      .get(username) as { password_hash: string } | undefined;
    return row?.password_hash ?? null;
  }

  public setPanelPasswordHash(passwordHash: string, username = 'admin'): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO panel_users(username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
      )
      .run(username, passwordHash, now, now);
  }

  public setPanelUserRole(username: string, role: 'global_admin' | 'business_admin'): void {
    const result = this.db
      .prepare('UPDATE panel_users SET role=?,updated_at=? WHERE username=?')
      .run(role, new Date().toISOString(), username);
    if (result.changes !== 1) throw new Error('El usuario del panel no existe.');
  }

  public grantPanelUserBusinessAccess(username: string, businessId: string): void {
    if (this.getBusiness(businessId) === null) throw new Error('El negocio no existe.');
    if (this.getPanelPasswordHash(username) === null)
      throw new Error('El usuario del panel no existe.');
    this.db
      .prepare(
        `INSERT OR IGNORE INTO panel_user_business_access(username,business_id,created_at)
         VALUES (?, ?, ?)`,
      )
      .run(username, businessId, new Date().toISOString());
  }

  public getPanelUserAuthorization(username: string): PanelUserAuthorization | null {
    const user = this.db.prepare('SELECT role FROM panel_users WHERE username=?').get(username) as
      { role: string } | undefined;
    if (user === undefined) return null;
    const role = user.role === 'business_admin' ? 'business_admin' : 'global_admin';
    const businessIds =
      role === 'global_admin'
        ? this.listBusinesses().map((business) => business.id)
        : (
            this.db
              .prepare(
                'SELECT business_id FROM panel_user_business_access WHERE username=? ORDER BY business_id',
              )
              .all(username) as Array<{ business_id: string }>
          ).map((row) => row.business_id);
    return { username, role, businessIds };
  }

  public canPanelUserAccessBot(username: string, botId: string): boolean {
    const authorization = this.getPanelUserAuthorization(username);
    const bot = this.getBot(botId);
    return (
      authorization !== null &&
      bot !== null &&
      (authorization.role === 'global_admin' || authorization.businessIds.includes(bot.businessId))
    );
  }

  public canPanelUserAccessConversation(username: string, conversationId: string): boolean {
    const authorization = this.getPanelUserAuthorization(username);
    if (authorization === null) return false;
    if (authorization.role === 'global_admin') return true;
    const row = this.db
      .prepare('SELECT business_id FROM conversations WHERE id=?')
      .get(conversationId) as { business_id: string | null } | undefined;
    return (
      row !== undefined &&
      row.business_id !== null &&
      authorization.businessIds.includes(row.business_id)
    );
  }
}

function mapAssistantProfile(row: AssistantProfileRow): AssistantProfile {
  return {
    id: row.id,
    internalName: row.internal_name,
    organizationName: row.organization_name,
    botName: row.bot_name,
    description: row.description,
    organizationType: row.organization_type,
    industry: row.industry,
    objective: row.objective,
    allowedTopics: parseStringArray(row.allowed_topics),
    excludedTopics: parseStringArray(row.excluded_topics),
    tone: row.tone,
    outOfScopeMessage: row.out_of_scope_message,
    noInformationMessage: row.no_information_message,
    limitMessage: row.limit_message,
    aiErrorMessage: row.ai_error_message,
    medicalMessage: row.medical_message,
    contactInformation: row.contact_information,
    businessHours: row.business_hours,
    address: row.address,
    logoPath: row.logo_path,
    primaryColor: row.primary_color ?? '#176b61',
    secondaryColor: row.secondary_color ?? '#d8a446',
    timezone: row.timezone,
    active: row.active === 1,
    applicationName: row.application_name ?? 'Panel del Asistente',
    headerText: row.header_text ?? 'Panel del Asistente',
    footerText: row.footer_text ?? '',
    supportInformation: row.support_information ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeEntry(row: KnowledgeEntryRow): KnowledgeEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    title: row.title,
    content: row.content,
    keywords: parseStringArray(row.keywords),
    synonyms: parseStringArray(row.synonyms),
    enabled: row.enabled === 1,
    priority: row.priority,
    internalSource: row.internal_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCachedAnswer(row: Record<string, unknown>, variants: string[]): CachedAnswer {
  return {
    id: Number(row.id),
    botId: String(row.bot_id),
    canonicalQuestion: String(row.canonical_question),
    normalizedQuestionHash: String(row.normalized_question_hash),
    answer: String(row.answer),
    category: String(row.category),
    knowledgeSourceIds: parseNumberArray(String(row.knowledge_source_ids)),
    knowledgeVersion: String(row.knowledge_version),
    promptVersion: String(row.prompt_version),
    status: String(row.status) as CachedAnswerStatus,
    sourceType: String(row.source_type) as CachedAnswerSourceType,
    confidence: Number(row.confidence),
    hitCount: Number(row.hit_count),
    apiCallsSaved: Number(row.api_calls_saved),
    variants,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
    expiresAt: row.expires_at === null ? null : String(row.expires_at),
    invalidatedAt: row.invalidated_at === null ? null : String(row.invalidated_at),
    invalidationReason: row.invalidation_reason === null ? null : String(row.invalidation_reason),
  };
}

function parseNumberArray(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item) && item > 0)
      : [];
  } catch {
    return [];
  }
}

function mapAISettings(row: Record<string, number | string>): AISettings {
  return {
    profileId: Number(row.profile_id),
    enabled: row.enabled === 1,
    provider: row.provider === 'disabled' ? 'disabled' : 'groq',
    model: String(row.model),
    providerConfig: parseProviderConfig(String(row.provider_config ?? '{}'), String(row.model)),
    questionMaxChars: Number(row.question_max_chars),
    contextMaxTokens: Number(row.context_max_tokens),
    inputMaxTokens: Number(row.input_max_tokens),
    responseMaxTokens: Number(row.response_max_tokens),
    responseMaxChars: Number(row.response_max_chars),
    responseMaxLines: Number(row.response_max_lines),
    temperature: Number(row.temperature),
    userHourlyLimit: Number(row.user_hourly_limit),
    userDailyLimit: Number(row.user_daily_limit),
    userCooldownSeconds: Number(row.user_cooldown_seconds),
    interactionHourlyLimit: Number(row.interaction_hourly_limit),
    interactionCooldownSeconds: Number(row.interaction_cooldown_seconds),
    duplicateQueryWindowSeconds: Number(row.duplicate_query_window_seconds),
    conversationHourlyLimit: Number(row.conversation_hourly_limit),
    conversationDailyLimit: Number(row.conversation_daily_limit),
    globalDailyLimit: Number(row.global_daily_limit),
    globalMonthlyLimit: Number(row.global_monthly_limit),
    globalDailyTokenLimit: Number(row.global_daily_token_limit),
    globalMonthlyTokenLimit: Number(row.global_monthly_token_limit),
    timeoutMs: Number(row.timeout_ms),
    updatedAt: String(row.updated_at),
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseSafeObject(value: string): Record<string, string | number | boolean | null> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string | number | boolean | null] =>
          entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function parseProviderConfig(value: string, fallbackModel: string): { model?: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).model === 'string'
    ) {
      return { model: String((parsed as Record<string, unknown>).model) };
    }
  } catch {
    // La columna heredada model sigue siendo la fuente de compatibilidad.
  }
  return { model: fallbackModel };
}

function parseToolPermissions(value: string): ToolPermission[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed)].filter(
      (permission): permission is ToolPermission =>
        permission === 'READ' || permission === 'SUGGEST' || permission === 'EXECUTE',
    );
  } catch {
    return [];
  }
}

function validateStableIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_]{2,63}$/u.test(normalized)) {
    throw new Error(`El identificador de ${field} no es válido.`);
  }
  return normalized;
}

function validateOpaqueHash(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(normalized)) {
    throw new Error('El identificador de conversación no es válido.');
  }
  return normalized;
}

function validateResourceIdentifier(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(normalized)) {
    throw new Error('El identificador del recurso no es válido.');
  }
  return normalized;
}

function validateAssistantProfile<
  T extends Omit<AssistantProfile, 'id' | 'active' | 'createdAt' | 'updatedAt'>,
>(input: T): T {
  const organizationTypes: OrganizationType[] = [
    'Comercio',
    'Restaurante',
    'Servicios',
    'Salud',
    'Belleza',
    'Turismo',
    'Transporte',
    'Educación',
    'Profesional independiente',
    'Otro',
  ];
  if (!organizationTypes.includes(input.organizationType))
    throw new Error('El tipo de organización no es válido.');
  const timezone = validateTimezone(input.timezone);
  const logoPath = input.logoPath === null ? null : validateLogoPath(input.logoPath);
  return {
    ...input,
    internalName: validatePlainText(input.internalName, 'nombre interno', 120),
    organizationName: validatePlainText(input.organizationName, 'nombre público', 160),
    botName: validatePlainText(input.botName, 'nombre del bot', 80),
    description: validatePlainText(input.description, 'descripción', 1000),
    industry: validatePlainText(input.industry, 'rubro', 160),
    objective: validatePlainText(input.objective, 'objetivo', 1200),
    allowedTopics: validateTextArray(input.allowedTopics, 'temas permitidos'),
    excludedTopics: validateTextArray(input.excludedTopics, 'temas excluidos'),
    tone: validatePlainText(input.tone, 'tono', 300),
    outOfScopeMessage: validatePlainText(input.outOfScopeMessage, 'mensaje fuera de tema', 600),
    noInformationMessage: validatePlainText(
      input.noInformationMessage,
      'mensaje sin información',
      600,
    ),
    limitMessage: validatePlainText(input.limitMessage, 'mensaje de límite', 600),
    aiErrorMessage: validatePlainText(input.aiErrorMessage, 'mensaje de error', 600),
    medicalMessage: validatePlainText(input.medicalMessage, 'mensaje médico', 600),
    contactInformation: validatePlainText(input.contactInformation, 'contacto', 1000, true),
    businessHours: validatePlainText(input.businessHours, 'horarios', 1000, true),
    address:
      input.address === null ? null : validatePlainText(input.address, 'dirección', 500, true),
    logoPath,
    primaryColor: validateColor(input.primaryColor),
    secondaryColor: validateColor(input.secondaryColor),
    timezone,
    applicationName: validatePlainText(input.applicationName, 'nombre de aplicación', 120),
    headerText: validatePlainText(input.headerText, 'encabezado', 160),
    footerText: validatePlainText(input.footerText, 'pie', 300, true),
    supportInformation: validatePlainText(input.supportInformation, 'soporte', 500, true),
  };
}

function validateKnowledgeEntry(input: {
  title: string;
  content: string;
  keywords: string[];
  synonyms: string[];
  priority: number;
  internalSource: string | null;
}): {
  title: string;
  content: string;
  keywords: string[];
  synonyms: string[];
  priority: number;
  internalSource: string | null;
} {
  const priority = Math.trunc(input.priority);
  if (priority < -100 || priority > 100)
    throw new Error('La prioridad debe estar entre -100 y 100.');
  return {
    title: validatePlainText(input.title, 'título', 200),
    content: validatePlainText(input.content, 'contenido', 8000),
    keywords: validateTextArray(input.keywords, 'palabras clave', 50),
    synonyms: validateTextArray(input.synonyms, 'sinónimos', 50),
    priority,
    internalSource:
      input.internalSource === null
        ? null
        : validatePlainText(input.internalSource, 'fuente interna', 300, true),
  };
}

function validateAISettings(settings: AISettings): void {
  if (!/^[a-z0-9][a-z0-9._/-]{1,119}$/u.test(settings.model)) {
    throw new Error('El modelo de IA no es válido.');
  }
  const integers: Array<[number, number, number, string]> = [
    [settings.interactionHourlyLimit, 1, 5000, 'activaciones por usuario y hora'],
    [settings.interactionCooldownSeconds, 0, 3600, 'espera entre activaciones'],
    [settings.duplicateQueryWindowSeconds, 0, 3600, 'ventana de consulta duplicada'],
    [settings.questionMaxChars, 1, 3000, 'pregunta máxima'],
    [settings.contextMaxTokens, 1, 7000, 'contexto máximo'],
    [settings.inputMaxTokens, 1, 10_000, 'entrada máxima'],
    [settings.responseMaxTokens, 1, 1200, 'respuesta máxima'],
    [settings.responseMaxChars, 1, 6000, 'caracteres de respuesta'],
    [settings.responseMaxLines, 1, 50, 'líneas de respuesta'],
    [settings.userHourlyLimit, 1, 500, 'límite por usuario y hora'],
    [settings.userDailyLimit, 1, 1000, 'límite por usuario y día'],
    [settings.userCooldownSeconds, 0, 3600, 'espera por usuario'],
    [settings.conversationHourlyLimit, 1, 2000, 'límite por conversación y hora'],
    [settings.conversationDailyLimit, 1, 10_000, 'límite por conversación y día'],
    [settings.globalDailyLimit, 1, 100_000, 'límite diario'],
    [settings.globalMonthlyLimit, 1, 1_000_000, 'límite mensual'],
    [settings.globalDailyTokenLimit, 1, 100_000_000, 'tokens diarios'],
    [settings.globalMonthlyTokenLimit, 1, 1_000_000_000, 'tokens mensuales'],
    [settings.timeoutMs, 1000, 60_000, 'tiempo de espera'],
  ];
  for (const [value, minimum, maximum, label] of integers) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`El valor de ${label} no es válido.`);
    }
  }
  if (settings.temperature < 0 || settings.temperature > 1)
    throw new Error('La temperatura no es válida.');
  if (settings.userDailyLimit < settings.userHourlyLimit)
    throw new Error('El límite diario por usuario no puede ser menor que el límite horario.');
  if (settings.conversationDailyLimit < settings.conversationHourlyLimit)
    throw new Error('El límite diario por conversación no puede ser menor que el horario.');
  if (settings.globalMonthlyLimit < settings.globalDailyLimit)
    throw new Error('El límite mensual no puede ser menor que el diario.');
}

function validateTextArray(values: string[], field: string, maximumItems = 30): string[] {
  if (!Array.isArray(values) || values.length > maximumItems)
    throw new Error(`La lista de ${field} no es válida.`);
  return [...new Set(values.map((value) => validatePlainText(value, field, 180)).filter(Boolean))];
}

function validatePlainText(
  value: string,
  field: string,
  maximumLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string') throw new Error(`El campo ${field} no es válido.`);
  const normalized = value.normalize('NFKC').trim();
  if ((!allowEmpty && normalized.length === 0) || normalized.length > maximumLength) {
    throw new Error(`El campo ${field} debe tener hasta ${maximumLength} caracteres.`);
  }
  if (
    /[<>]/u.test(normalized) ||
    [...normalized].some((character) => character.codePointAt(0) === 0) ||
    normalized.includes('```')
  ) {
    throw new Error(`El campo ${field} debe contener solamente texto plano.`);
  }
  return normalized;
}

function validateColor(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/u.test(normalized))
    throw new Error('El color debe usar el formato #RRGGBB.');
  return normalized;
}

function validateTimezone(value: string): string {
  const normalized = validatePlainText(value, 'zona horaria', 80);
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: normalized }).format();
    return normalized;
  } catch {
    throw new Error('La zona horaria no es válida.');
  }
}

function validateLanguage(value: string): string {
  const normalized = validatePlainText(value, 'idioma', 35);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(normalized)) {
    throw new Error('El idioma no es válido.');
  }
  return normalized;
}

function slugifyBusinessName(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/u, '');
  return slug.length >= 3 ? slug : `negocio-${randomUUID().slice(0, 8)}`;
}

function maskStoredPhoneNumber(value: string): string {
  const normalized = value.replace(/\D/gu, '');
  if (normalized.length < 8 || normalized.length > 20) {
    throw new Error('El número visible de WhatsApp no es válido.');
  }
  return `${'*'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`;
}

function validateCredentialReference(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9+.-]{1,30}:[a-zA-Z0-9_./:-]{1,180}$/u.test(normalized)) {
    throw new Error('La referencia de credenciales no es válida.');
  }
  return normalized;
}

function validateLogoPath(value: string): string {
  const normalized = value.trim();
  if (!/^\/branding\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/u.test(normalized)) {
    throw new Error('La ruta del logo no es válida.');
  }
  return normalized;
}

function normalizeSearchTerms(value: string): string[] {
  const stopWords = new Set([
    'a',
    'al',
    'de',
    'del',
    'el',
    'en',
    'es',
    'la',
    'las',
    'lo',
    'los',
    'por',
    'que',
    'un',
    'una',
    'y',
  ]);
  return [
    ...new Set(
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLocaleLowerCase('es')
        .match(/[a-z0-9]{2,}/gu)
        ?.filter((term) => !stopWords.has(term)) ?? [],
    ),
  ].slice(0, 12);
}

function validateBotIdentifier(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('es');
  if (!/^[a-z][a-z0-9-]{2,39}$/u.test(normalized)) {
    throw new Error('El identificador debe usar letras minúsculas, números o guiones.');
  }
  return normalized;
}

function metaIdentifierHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeMenuAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function validateActionPayload(
  actionType: MenuActionType,
  payload: Record<string, string | number | boolean | null>,
): void {
  const serialized = JSON.stringify(payload);
  if (
    serialized.length > 1000 ||
    /(?:powershell|cmd\.exe|\/bin\/|javascript:|\bselect\b.+\bfrom\b|\bdrop\s+table\b)/iu.test(
      serialized,
    )
  ) {
    throw new Error('La acción contiene datos no permitidos.');
  }
  const referenceActions: MenuActionType[] = [
    'catalog_item',
    'catalog_category',
    'media',
    'submenu',
  ];
  if (referenceActions.includes(actionType) && !Number.isInteger(payload.id)) {
    throw new Error('La acción requiere un identificador interno válido.');
  }
  if (actionType === 'text' && typeof payload.text !== 'string') {
    throw new Error('La acción de texto requiere un mensaje.');
  }
}

function validateMoney(value: number | null): void {
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1_000_000_000_00)) {
    throw new Error('El precio no es válido.');
  }
}

function validateBusinessHour(
  value: Omit<BusinessHour, 'id' | 'botId' | 'createdAt' | 'updatedAt'>,
): void {
  if (
    value.weekday !== null &&
    (!Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6)
  ) {
    throw new Error('El día de la semana no es válido.');
  }
  if (value.localDate !== null) validateDate(value.localDate);
  if (value.weekday === null && value.localDate === null)
    throw new Error('El horario requiere un día o una fecha.');
  if (!value.closed) {
    if (
      value.openingTime === null ||
      value.closingTime === null ||
      !isTime(value.openingTime) ||
      !isTime(value.closingTime)
    ) {
      throw new Error('El intervalo de atención no es válido.');
    }
  }
}

function requireAdministratorPhoneNumber(value: string): string {
  const normalized = canonicalPhoneIdentity(value);
  if (normalized === null) throw new Error('El número del administrador no es válido.');
  return normalized;
}

function validateDate(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  ) {
    throw new Error('La fecha no es válida.');
  }
  return value;
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}
