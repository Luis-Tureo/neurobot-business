import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

export type ConversationStatus = 'active' | 'closed';
export type ConversationDirection = 'inbound' | 'outbound';
export type ConversationSenderType = 'customer' | 'assistant' | 'system';
export type ConversationMessageStatus =
  'received' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | 'unknown';

export type ConversationRecord = {
  id: string;
  assistantId: string;
  phoneNumberId: string;
  waId: string;
  contactName: string | null;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export type ConversationMessageRecord = {
  id: string;
  conversationId: string;
  whatsappMessageId: string | null;
  direction: ConversationDirection;
  senderType: ConversationSenderType;
  messageType: string;
  text: string | null;
  caption: string | null;
  messageTimestamp: string;
  whatsappStatus: ConversationMessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationListItem = ConversationRecord & {
  assistantName: string;
  lastMessage: {
    direction: ConversationDirection;
    messageType: string;
    text: string | null;
    caption: string | null;
    whatsappStatus: ConversationMessageStatus;
    timestamp: string;
  } | null;
};

export type ConversationListQuery = {
  page: number;
  pageSize: number;
  search?: string;
  assistantId?: string;
  from?: string;
  toExclusive?: string;
};

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ConversationRow = {
  id: string;
  assistant_id: string;
  phone_number_id: string;
  wa_id: string;
  contact_name: string | null;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  whatsapp_message_id: string | null;
  direction: ConversationDirection;
  sender_type: ConversationSenderType;
  message_type: string;
  text_content: string | null;
  caption: string | null;
  message_timestamp: string;
  whatsapp_status: ConversationMessageStatus;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export class ConversationHistoryRepository {
  public constructor(private readonly database: BetterSqlite3.Database) {}

  public getOrCreateConversation(input: {
    assistantId: string;
    phoneNumberId: string;
    waId: string;
    contactName?: string | null;
    activityAt?: string;
  }): ConversationRecord {
    const assistantId = requiredText(input.assistantId, 120, 'assistantId');
    const phoneNumberId = normalizePhoneNumberId(input.phoneNumberId);
    const waId = normalizeWaId(input.waId);
    const contactName = normalizeOptionalText(input.contactName, 200);
    const now = new Date().toISOString();
    const activityAt = normalizeTimestamp(input.activityAt ?? now);
    return mapConversation(
      this.upsertConversation({ assistantId, phoneNumberId, waId, contactName, now, activityAt }),
    );
  }

  public recordMessage(input: {
    assistantId: string;
    phoneNumberId: string;
    waId: string;
    contactName?: string | null;
    whatsappMessageId?: string | null;
    direction: ConversationDirection;
    senderType: ConversationSenderType;
    messageType: string;
    text?: string | null;
    caption?: string | null;
    messageTimestamp?: string;
    whatsappStatus?: ConversationMessageStatus;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): { conversation: ConversationRecord; message: ConversationMessageRecord; inserted: boolean } {
    const normalized = {
      assistantId: requiredText(input.assistantId, 120, 'assistantId'),
      phoneNumberId: normalizePhoneNumberId(input.phoneNumberId),
      waId: normalizeWaId(input.waId),
      contactName: normalizeOptionalText(input.contactName, 200),
      whatsappMessageId: normalizeOptionalText(input.whatsappMessageId, 512),
      direction: input.direction,
      senderType: input.senderType,
      messageType: normalizeMessageType(input.messageType),
      text: normalizeOptionalText(input.text, 4096),
      caption: normalizeOptionalText(input.caption, 1024),
      messageTimestamp: normalizeTimestamp(input.messageTimestamp ?? new Date().toISOString()),
      whatsappStatus:
        input.whatsappStatus ?? (input.direction === 'inbound' ? 'received' : 'accepted'),
      errorCode: sanitizeConversationErrorCode(input.errorCode),
      errorMessage: sanitizeConversationError(input.errorMessage),
    };
    assertDirectionAndSender(normalized.direction, normalized.senderType);
    assertMessageStatus(normalized.whatsappStatus);

    const record = this.database.transaction(() => {
      const now = new Date().toISOString();
      const conversationRow = this.upsertConversation({
        assistantId: normalized.assistantId,
        phoneNumberId: normalized.phoneNumberId,
        waId: normalized.waId,
        contactName: normalized.contactName,
        now,
        activityAt: normalized.messageTimestamp,
      });
      const messageId = randomUUID();
      const result = this.database
        .prepare(
          `INSERT INTO conversation_messages(
             id,conversation_id,whatsapp_message_id,direction,sender_type,message_type,
             text_content,caption,message_timestamp,whatsapp_status,error_code,error_message,
             created_at,updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL DO NOTHING`,
        )
        .run(
          messageId,
          conversationRow.id,
          normalized.whatsappMessageId,
          normalized.direction,
          normalized.senderType,
          normalized.messageType,
          normalized.text,
          normalized.caption,
          normalized.messageTimestamp,
          normalized.whatsappStatus,
          normalized.errorCode,
          normalized.errorMessage,
          now,
          now,
        );

      const inserted = result.changes === 1;
      const storedMessage = (
        inserted
          ? this.database.prepare('SELECT * FROM conversation_messages WHERE id=?').get(messageId)
          : this.database
              .prepare('SELECT * FROM conversation_messages WHERE whatsapp_message_id=?')
              .get(normalized.whatsappMessageId)
      ) as MessageRow | undefined;
      if (storedMessage === undefined) throw new Error('CONVERSATION_MESSAGE_NOT_STORED');

      if (inserted) {
        this.database
          .prepare(
            `UPDATE conversations SET
               contact_name=COALESCE(?,contact_name),status='active',
               last_message_at=CASE WHEN last_message_at < ? THEN ? ELSE last_message_at END,
               updated_at=?
             WHERE id=?`,
          )
          .run(
            normalized.contactName,
            normalized.messageTimestamp,
            normalized.messageTimestamp,
            now,
            conversationRow.id,
          );
      }
      const currentConversation = this.database
        .prepare('SELECT * FROM conversations WHERE id=?')
        .get(storedMessage.conversation_id) as ConversationRow | undefined;
      if (currentConversation === undefined) throw new Error('CONVERSATION_NOT_FOUND');
      return {
        conversation: mapConversation(currentConversation),
        message: mapMessage(storedMessage),
        inserted,
      };
    })();
    return record;
  }

  public updateMessageStatus(input: {
    whatsappMessageId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    occurredAt: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): boolean {
    const whatsappMessageId = requiredText(input.whatsappMessageId, 512, 'whatsappMessageId');
    const row = this.database
      .prepare(
        `SELECT whatsapp_status FROM conversation_messages
         WHERE whatsapp_message_id=? AND direction='outbound'`,
      )
      .get(whatsappMessageId) as { whatsapp_status: ConversationMessageStatus } | undefined;
    if (row === undefined || !shouldAdvanceStatus(row.whatsapp_status, input.status)) return false;
    const occurredAt = normalizeTimestamp(input.occurredAt);
    const errorCode =
      input.status === 'failed' ? sanitizeConversationErrorCode(input.errorCode) : null;
    const errorMessage =
      input.status === 'failed' ? sanitizeConversationError(input.errorMessage) : null;
    return (
      this.database
        .prepare(
          `UPDATE conversation_messages SET whatsapp_status=?,error_code=?,error_message=?,updated_at=?
           WHERE whatsapp_message_id=? AND direction='outbound'`,
        )
        .run(input.status, errorCode, errorMessage, occurredAt, whatsappMessageId).changes === 1
    );
  }

  public listConversations(query: ConversationListQuery): PaginatedResult<ConversationListItem> {
    const page = positiveInteger(query.page, 1, 1_000_000);
    const pageSize = positiveInteger(query.pageSize, 25, 100);
    const where = ['1=1'];
    const parameters: Record<string, string | number> = {};
    const search = query.search?.trim();
    if (search) {
      where.push(
        `(conversations.contact_name LIKE @search ESCAPE '\\' COLLATE NOCASE
          OR conversations.wa_id LIKE @search ESCAPE '\\')`,
      );
      parameters.search = `${escapeLike(search.slice(0, 120))}%`;
    }
    if (query.assistantId) {
      where.push('conversations.assistant_id=@assistantId');
      parameters.assistantId = requiredText(query.assistantId, 120, 'assistantId');
    }
    if (query.from) {
      where.push('conversations.last_message_at>=@from');
      parameters.from = normalizeTimestamp(query.from);
    }
    if (query.toExclusive) {
      where.push('conversations.last_message_at<@toExclusive');
      parameters.toExclusive = normalizeTimestamp(query.toExclusive);
    }
    const clause = where.join(' AND ');
    const count = this.database
      .prepare(`SELECT COUNT(*) AS total FROM conversations WHERE ${clause}`)
      .get(parameters) as { total: number };
    parameters.limit = pageSize;
    parameters.offset = (page - 1) * pageSize;
    const rows = this.database
      .prepare(
        `SELECT conversations.*,profiles.bot_name AS assistant_name,
           last_message.direction AS last_direction,
           last_message.message_type AS last_message_type,
           last_message.text_content AS last_text_content,
           last_message.caption AS last_caption,
           last_message.whatsapp_status AS last_whatsapp_status,
           last_message.message_timestamp AS last_message_timestamp
         FROM conversations
         JOIN bot_profiles mapping ON mapping.bot_id=conversations.assistant_id
         JOIN assistant_profiles profiles ON profiles.id=mapping.profile_id
         LEFT JOIN conversation_messages last_message ON last_message.id=(
           SELECT candidate.id FROM conversation_messages candidate
           WHERE candidate.conversation_id=conversations.id
           ORDER BY candidate.message_timestamp DESC,candidate.created_at DESC,candidate.id DESC
           LIMIT 1
         )
         WHERE ${clause}
         ORDER BY conversations.last_message_at DESC,conversations.id DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all(parameters) as Array<ConversationRow & Record<string, unknown>>;
    const total = Number(count.total);
    return {
      items: rows.map(mapConversationListItem),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  public listMessages(
    conversationId: string,
    page: number,
    pageSize: number,
  ): {
    conversation: ConversationListItem;
    messages: PaginatedResult<ConversationMessageRecord>;
  } | null {
    const normalizedId = requiredText(conversationId, 80, 'conversationId');
    const conversationRow = this.database
      .prepare(
        `SELECT conversations.*,profiles.bot_name AS assistant_name,
           NULL AS last_direction,NULL AS last_message_type,NULL AS last_text_content,
           NULL AS last_caption,NULL AS last_whatsapp_status,NULL AS last_message_timestamp
         FROM conversations
         JOIN bot_profiles mapping ON mapping.bot_id=conversations.assistant_id
         JOIN assistant_profiles profiles ON profiles.id=mapping.profile_id
         WHERE conversations.id=?`,
      )
      .get(normalizedId) as (ConversationRow & Record<string, unknown>) | undefined;
    if (conversationRow === undefined) return null;
    const normalizedPage = positiveInteger(page, 1, 1_000_000);
    const normalizedPageSize = positiveInteger(pageSize, 50, 100);
    const count = this.database
      .prepare('SELECT COUNT(*) AS total FROM conversation_messages WHERE conversation_id=?')
      .get(normalizedId) as { total: number };
    const rows = this.database
      .prepare(
        `SELECT * FROM (
           SELECT * FROM conversation_messages WHERE conversation_id=?
           ORDER BY message_timestamp DESC,created_at DESC,id DESC
           LIMIT ? OFFSET ?
         ) recent
         ORDER BY message_timestamp ASC,created_at ASC,id ASC`,
      )
      .all(
        normalizedId,
        normalizedPageSize,
        (normalizedPage - 1) * normalizedPageSize,
      ) as MessageRow[];
    const total = Number(count.total);
    return {
      conversation: mapConversationListItem(conversationRow),
      messages: {
        items: rows.map(mapMessage),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
      },
    };
  }

  private upsertConversation(input: {
    assistantId: string;
    phoneNumberId: string;
    waId: string;
    contactName: string | null;
    now: string;
    activityAt: string;
  }): ConversationRow {
    this.database
      .prepare(
        `INSERT INTO conversations(
           id,assistant_id,phone_number_id,wa_id,contact_name,status,
           created_at,updated_at,last_message_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT(assistant_id,phone_number_id,wa_id) DO UPDATE SET
           contact_name=COALESCE(excluded.contact_name,conversations.contact_name),
           status='active',updated_at=excluded.updated_at`,
      )
      .run(
        randomUUID(),
        input.assistantId,
        input.phoneNumberId,
        input.waId,
        input.contactName,
        input.now,
        input.now,
        input.activityAt,
      );
    const row = this.database
      .prepare(
        `SELECT * FROM conversations
         WHERE assistant_id=? AND phone_number_id=? AND wa_id=?`,
      )
      .get(input.assistantId, input.phoneNumberId, input.waId) as ConversationRow | undefined;
    if (row === undefined) throw new Error('CONVERSATION_NOT_CREATED');
    return row;
  }
}

export function sanitizeConversationError(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = replaceControlCharacters(value, ' ')
    .replace(/https?:\/\/\S+/giu, '[URL omitida]')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [oculto]')
    .replace(
      /\b(?:access[_-]?token|app[_-]?secret|verify[_-]?token)\s*[:=]\s*\S+/giu,
      '[secreto oculto]',
    )
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 300);
  return sanitized === '' ? null : sanitized;
}

function sanitizeConversationErrorCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const code = value.replace(/[^a-z0-9_-]/giu, '_').slice(0, 80);
  return code === '' ? null : code;
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    assistantId: row.assistant_id,
    phoneNumberId: row.phone_number_id,
    waId: row.wa_id,
    contactName: row.contact_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}

function mapMessage(row: MessageRow): ConversationMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    whatsappMessageId: row.whatsapp_message_id,
    direction: row.direction,
    senderType: row.sender_type,
    messageType: row.message_type,
    text: row.text_content,
    caption: row.caption,
    messageTimestamp: row.message_timestamp,
    whatsappStatus: row.whatsapp_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversationListItem(
  row: ConversationRow & Record<string, unknown>,
): ConversationListItem {
  const conversation = mapConversation(row);
  const timestamp = optionalString(row.last_message_timestamp);
  return {
    ...conversation,
    assistantName: String(row.assistant_name),
    lastMessage:
      timestamp === null
        ? null
        : {
            direction: String(row.last_direction) as ConversationDirection,
            messageType: String(row.last_message_type),
            text: optionalString(row.last_text_content),
            caption: optionalString(row.last_caption),
            whatsappStatus: String(row.last_whatsapp_status) as ConversationMessageStatus,
            timestamp,
          },
  };
}

function normalizeWaId(value: string): string {
  const digits = value.replace(/@(?:c\.us|s\.whatsapp\.net)$/iu, '').replace(/\D/gu, '');
  if (!/^\d{8,15}$/u.test(digits)) throw new Error('INVALID_WHATSAPP_WA_ID');
  return digits;
}

function normalizePhoneNumberId(value: string): string {
  const normalized = value.trim();
  if (!/^\d{5,32}$/u.test(normalized)) throw new Error('INVALID_META_PHONE_NUMBER_ID');
  return normalized;
}

function normalizeMessageType(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/gu, '')
      .slice(0, 40) || 'unknown'
  );
}

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_CONVERSATION_TIMESTAMP');
  return date.toISOString();
}

function normalizeOptionalText(
  value: string | null | undefined,
  maximumLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = removeUnsafeControlCharacters(value).trim();
  return normalized === '' ? null : normalized.slice(0, maximumLength);
}

function requiredText(value: string, maximumLength: number, field: string): string {
  const normalized = normalizeOptionalText(value, maximumLength);
  if (normalized === null) throw new Error(`INVALID_${field.toUpperCase()}`);
  return normalized;
}

function assertDirectionAndSender(
  direction: ConversationDirection,
  senderType: ConversationSenderType,
): void {
  const valid =
    (direction === 'inbound' && senderType === 'customer') ||
    (direction === 'outbound' && senderType === 'assistant') ||
    senderType === 'system';
  if (!valid) throw new Error('INVALID_CONVERSATION_MESSAGE_SENDER');
}

function assertMessageStatus(status: ConversationMessageStatus): void {
  if (
    !['received', 'accepted', 'sent', 'delivered', 'read', 'failed', 'deleted', 'unknown'].includes(
      status,
    )
  ) {
    throw new Error('INVALID_CONVERSATION_MESSAGE_STATUS');
  }
}

function shouldAdvanceStatus(
  current: ConversationMessageStatus,
  next: 'sent' | 'delivered' | 'read' | 'failed',
): boolean {
  if (current === 'read' || current === 'deleted') return false;
  if (next === 'failed') return current !== 'failed';
  if (current === 'failed') return false;
  const rank: Record<ConversationMessageStatus, number> = {
    unknown: -1,
    received: 0,
    accepted: 0,
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 4,
    deleted: 5,
  };
  return rank[next] > rank[current];
}

function positiveInteger(value: number, fallback: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function replaceControlCharacters(value: string, replacement: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? replacement : character;
    })
    .join('');
}

function removeUnsafeControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code > 31 && code !== 127);
    })
    .join('');
}
