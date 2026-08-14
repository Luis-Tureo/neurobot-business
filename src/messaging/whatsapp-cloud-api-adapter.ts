import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import type { IncomingMessage, MetaMessageStatus } from '../domain/types.js';
import { serializeError } from '../infrastructure/safe-error.js';
import type {
  InteractiveMenuPayload,
  MessagingClient,
  MessagingClientEvents,
} from './messaging-client.js';

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type WhatsAppCloudApiOptions = {
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
  apiVersion: string;
  requestTimeoutMs?: number;
};

export type MetaWebhookEventDescriptor = {
  eventId: string;
  phoneNumberId: string;
  eventType: 'message' | 'status';
};

export type MetaWebhookIngestionResult = {
  messages: number;
  statuses: number;
  unsupportedMessages: number;
};

export class MetaGraphApiError extends Error {
  public override readonly name = 'MetaGraphApiError';

  public constructor(
    public readonly httpStatus: number,
    public readonly graphCode: string | null,
    public readonly graphSubcode: string | null,
  ) {
    super(
      graphCode === null
        ? `Meta Graph API rechazó el envío (HTTP ${httpStatus}).`
        : `Meta Graph API rechazó el envío (HTTP ${httpStatus}, código ${graphCode}).`,
    );
  }
}

export class MetaCloudApiTimeoutError extends Error {
  public override readonly name = 'MetaCloudApiTimeoutError';
  public readonly code = 'META_GRAPH_API_TIMEOUT';

  public constructor() {
    super('Meta Graph API no respondió dentro del tiempo permitido.');
  }
}

export class WhatsAppCloudApiAdapter implements MessagingClient {
  private events: MessagingClientEvents | null = null;
  private ready = false;
  private lastErrorCode: string | null = null;

  public constructor(
    private readonly options: WhatsAppCloudApiOptions,
    private readonly logger: Logger,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  public setEvents(events: MessagingClientEvents): void {
    this.events = events;
  }

  public configurationIssues(): string[] {
    const missing: string[] = [];
    if (!validCredential(this.options.accessToken)) missing.push('META_ACCESS_TOKEN');
    if (!validMetaIdentifier(this.options.phoneNumberId)) missing.push('META_PHONE_NUMBER_ID');
    if (!/^v\d+\.\d+$/u.test(this.options.apiVersion)) missing.push('META_GRAPH_API_VERSION');
    return missing;
  }

  public isConfigured(): boolean {
    return this.configurationIssues().length === 0;
  }

  public async initialize(): Promise<void> {
    if (this.ready) return;
    const issues = this.configurationIssues();
    if (issues.length > 0) {
      this.lastErrorCode = 'META_CREDENTIALS_MISSING';
      this.events?.onStateChange('auth_failure', 'META_CREDENTIALS_MISSING');
      throw new Error(
        `La configuración de WhatsApp Cloud API está incompleta: ${issues.join(', ')}.`,
      );
    }
    this.lastErrorCode = null;
    this.ready = true;
    this.events?.onStateChange('connected');
    await this.events?.onReady();
  }

  public async destroy(): Promise<void> {
    if (!this.ready) return;
    this.ready = false;
    this.events?.onStateChange('disconnected', 'CLIENT_STOPPED');
  }

  public async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
    await this.sendTextMessage(chatId, text, replyToMessageId);
  }

  public async sendTextMessage(
    chatId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<{ messageId: string | null }> {
    const result = await this.sendPayload({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientNumber(chatId),
      ...(replyToMessageId === undefined ? {} : { context: { message_id: replyToMessageId } }),
      type: 'text',
      text: { preview_url: false, body: text.slice(0, 4096) },
    });
    return { messageId: readOutboundMessageId(result) };
  }

  public async sendInteractiveMenu(
    chatId: string,
    payload: InteractiveMenuPayload,
  ): Promise<boolean> {
    const options = payload.options.filter((option) => option.label.trim() !== '');
    if (payload.kind === 'buttons' && options.length >= 1 && options.length <= 3) {
      await this.sendPayload({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientNumber(chatId),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: payload.message.slice(0, 1024) },
          action: {
            buttons: options.map((option) => ({
              type: 'reply',
              reply: { id: option.id.slice(0, 256), title: option.label.slice(0, 20) },
            })),
          },
        },
      });
      return true;
    }
    if (payload.kind === 'list' && options.length >= 1 && options.length <= 10) {
      await this.sendPayload({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientNumber(chatId),
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: payload.title.slice(0, 60) },
          body: { text: payload.message.slice(0, 1024) },
          action: {
            button: 'Ver opciones',
            sections: [
              {
                title: payload.title.slice(0, 24),
                rows: options.map((option) => ({
                  id: option.id.slice(0, 200),
                  title: option.label.slice(0, 24),
                })),
              },
            ],
          },
        },
      });
      return true;
    }
    return false;
  }

  public async sendTemplate(
    chatId: string,
    templateName: string,
    languageCode: string,
  ): Promise<void> {
    await this.sendPayload({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientNumber(chatId),
      type: 'template',
      template: {
        name: templateName.trim().slice(0, 512),
        language: { code: languageCode.trim().slice(0, 35) },
      },
    });
  }

  public async getState(): Promise<string | null> {
    return this.ready ? 'CONNECTED' : null;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public status(): { lastErrorCode: string | null } {
    return { lastErrorCode: this.lastErrorCode };
  }

  public async ingestWebhook(
    payload: unknown,
    acceptedEventIds?: ReadonlySet<string>,
  ): Promise<MetaWebhookIngestionResult> {
    const result: MetaWebhookIngestionResult = {
      messages: 0,
      statuses: 0,
      unsupportedMessages: 0,
    };
    if (!this.ready || this.events === null || this.options.phoneNumberId === undefined) {
      return result;
    }

    for (const change of webhookChanges(payload)) {
      if (change.phoneNumberId !== this.options.phoneNumberId) continue;
      for (const rawMessage of change.messages) {
        const descriptor = messageDescriptor(rawMessage, change.phoneNumberId);
        if (descriptor === null || !eventAccepted(descriptor.eventId, acceptedEventIds)) continue;
        const adapted = adaptCloudMessage(
          rawMessage,
          change.phoneNumberId,
          contactNameFor(change.contacts, rawMessage),
        );
        if (adapted === null) {
          result.unsupportedMessages += 1;
          this.logger.info(
            {
              operation: 'META_UNSUPPORTED_MESSAGE_IGNORED',
              messageType: safeMessageType(rawMessage),
            },
            'Meta envió un tipo de mensaje no soportado; el evento fue ignorado',
          );
          continue;
        }
        await this.events.onMessage(adapted);
        result.messages += 1;
      }
      for (const rawStatus of change.statuses) {
        const status = adaptCloudStatus(rawStatus, change.phoneNumberId);
        if (status === null || !eventAccepted(status.eventId, acceptedEventIds)) continue;
        await this.events.onDeliveryStatus?.(status);
        result.statuses += 1;
      }
    }

    if (result.messages > 0 || result.statuses > 0 || result.unsupportedMessages > 0) {
      this.logger.info(
        {
          operation: 'META_WEBHOOK_PROCESSED',
          messageCount: result.messages,
          statusCount: result.statuses,
          unsupportedCount: result.unsupportedMessages,
        },
        'Se procesó un webhook oficial de WhatsApp',
      );
    }
    return result;
  }

  private async sendPayload(payload: Record<string, unknown>): Promise<unknown> {
    if (!this.ready || this.options.phoneNumberId === undefined) {
      throw new Error('WhatsApp Cloud API no está configurado o conectado.');
    }
    const accessToken = this.options.accessToken;
    if (accessToken === undefined) throw new Error('META_ACCESS_TOKEN no está configurado.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 10_000);
    try {
      const response = await this.fetchImplementation(
        `https://graph.facebook.com/${encodeURIComponent(this.options.apiVersion)}/${encodeURIComponent(this.options.phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );
      const responsePayload = await parseGraphResponse(response);
      const graphError = readGraphError(responsePayload);
      if (!response.ok || graphError !== null) {
        const error = new MetaGraphApiError(
          response.status,
          graphError?.code ?? null,
          graphError?.subcode ?? null,
        );
        this.lastErrorCode = `META_GRAPH_API_${error.graphCode ?? `HTTP_${response.status}`}`
          .replace(/[^A-Z0-9_]/gu, '_')
          .slice(0, 80);
        this.logger.error(
          {
            operation: 'META_GRAPH_API_REQUEST_FAILED',
            httpStatus: response.status,
            graphCode: error.graphCode,
            graphSubcode: error.graphSubcode,
          },
          'Meta Graph API rechazó un envío',
        );
        throw error;
      }
      const messageId = readOutboundMessageId(responsePayload);
      this.logger.debug(
        { operation: 'META_GRAPH_API_MESSAGE_ACCEPTED', hasMessageId: messageId !== null },
        'Meta Graph API aceptó un mensaje',
      );
      this.lastErrorCode = null;
      this.emitOutboundMessage(payload, messageId);
      return responsePayload;
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        this.lastErrorCode = 'META_GRAPH_API_TIMEOUT';
        this.logger.error(
          {
            operation: 'META_GRAPH_API_TIMEOUT',
            timeoutMs: this.options.requestTimeoutMs ?? 10_000,
          },
          'Meta Graph API excedió el tiempo de espera',
        );
        throw new MetaCloudApiTimeoutError();
      }
      if (error instanceof MetaGraphApiError) throw error;
      const details = serializeError(error, 'META_GRAPH_API_NETWORK_ERROR', false);
      this.lastErrorCode = 'META_GRAPH_API_NETWORK_ERROR';
      this.logger.error(
        { operation: 'META_GRAPH_API_NETWORK_ERROR', errorCode: details.errorCode },
        'Falló la comunicación con Meta Graph API',
      );
      throw new Error('No fue posible comunicarse con Meta Graph API.', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private emitOutboundMessage(payload: Record<string, unknown>, messageId: string | null): void {
    if (this.events?.onOutboundMessage === undefined || this.options.phoneNumberId === undefined)
      return;
    const recipientId = typeof payload.to === 'string' ? payload.to : null;
    if (recipientId === null || !validRecipient(recipientId)) return;
    const content = outboundPayloadContent(payload);
    try {
      const pending = this.events.onOutboundMessage({
        messageId,
        phoneNumberId: this.options.phoneNumberId,
        recipientId: recipientNumber(recipientId),
        messageType: safeMessageType(payload),
        text: content.text,
        caption: content.caption,
        acceptedAt: new Date().toISOString(),
      });
      if (pending instanceof Promise) {
        void pending.catch(() => {
          this.logger.error(
            { operation: 'CONVERSATION_OUTBOUND_PERSIST_FAILED' },
            'No fue posible registrar un mensaje saliente ya aceptado por Meta',
          );
        });
      }
    } catch {
      this.logger.error(
        { operation: 'CONVERSATION_OUTBOUND_PERSIST_FAILED' },
        'No fue posible registrar un mensaje saliente ya aceptado por Meta',
      );
    }
  }
}

export function isValidMetaWebhookPayload(payload: unknown): boolean {
  if (!isRecord(payload) || payload.object !== 'whatsapp_business_account') return false;
  if (!Array.isArray(payload.entry)) return false;
  return payload.entry.every(
    (entry) =>
      isRecord(entry) &&
      Array.isArray(entry.changes) &&
      entry.changes.every((change) => isRecord(change)),
  );
}

export function parseMetaWebhookEvents(payload: unknown): MetaWebhookEventDescriptor[] {
  if (!isValidMetaWebhookPayload(payload)) return [];
  const descriptors: MetaWebhookEventDescriptor[] = [];
  for (const change of webhookChanges(payload)) {
    for (const message of change.messages) {
      const descriptor = messageDescriptor(message, change.phoneNumberId);
      if (descriptor !== null) descriptors.push(descriptor);
    }
    for (const status of change.statuses) {
      const adapted = adaptCloudStatus(status, change.phoneNumberId);
      if (adapted !== null) {
        descriptors.push({
          eventId: adapted.eventId,
          phoneNumberId: change.phoneNumberId,
          eventType: 'status',
        });
      }
    }
  }
  return descriptors;
}

export function verifyMetaWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (appSecret === undefined || appSecret.length === 0 || signature === undefined) return false;
  const supplied = signature.startsWith('sha256=') ? signature.slice(7) : '';
  if (!/^[a-f0-9]{64}$/iu.test(supplied)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(supplied, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function secureTokenMatches(expected: string | undefined, supplied: unknown): boolean {
  if (expected === undefined || typeof supplied !== 'string') return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

type WebhookChange = {
  phoneNumberId: string;
  messages: unknown[];
  statuses: unknown[];
  contacts: unknown[];
};

function webhookChanges(payload: unknown): WebhookChange[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];
  const changes: WebhookChange[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== 'messages' || !isRecord(change.value)) continue;
      const metadata = change.value.metadata;
      if (!isRecord(metadata) || !validMetaIdentifier(metadata.phone_number_id)) continue;
      changes.push({
        phoneNumberId: metadata.phone_number_id,
        messages: Array.isArray(change.value.messages) ? change.value.messages : [],
        statuses: Array.isArray(change.value.statuses) ? change.value.statuses : [],
        contacts: Array.isArray(change.value.contacts) ? change.value.contacts : [],
      });
    }
  }
  return changes;
}

function messageDescriptor(
  value: unknown,
  phoneNumberId: string,
): MetaWebhookEventDescriptor | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim() === '') return null;
  return { eventId: `message:${value.id}`, phoneNumberId, eventType: 'message' };
}

function adaptCloudMessage(
  value: unknown,
  phoneNumberId: string,
  contactName: string | null,
): IncomingMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isPrivateMessageEnvelope(value) ||
    !validRecipient(value.from)
  ) {
    return null;
  }
  const content = cloudMessageContent(value);
  if (content === null) return null;
  const customerId = recipientNumber(value.from);
  const context = isRecord(value.context) ? value.context : null;
  const receivedAt = metaTimestamp(value.timestamp);
  return {
    id: value.id,
    ...(context !== null && typeof context.id === 'string' ? { replyToMessageId: context.id } : {}),
    businessPhoneNumberId: phoneNumberId,
    ...(receivedAt === null ? {} : { receivedAt }),
    chatId: customerId,
    customerId,
    messageType: typeof value.type === 'string' ? value.type : 'unknown',
    visibleText: content.visibleText,
    ...(content.caption === null ? {} : { caption: content.caption }),
    ...(contactName === null ? {} : { contactName }),
    body: content.body,
    hasMedia: content.hasMedia,
    isReplyToBot: context !== null && typeof context.id === 'string',
  };
}

function isPrivateMessageEnvelope(value: Record<string, unknown>): boolean {
  if (value.recipient_type === 'group' || value.type === 'group') return false;
  return !('group_id' in value) && !('group' in value);
}

function adaptCloudStatus(value: unknown, phoneNumberId: string): MetaMessageStatus | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.status !== 'string') {
    return null;
  }
  const occurredAt = metaTimestamp(value.timestamp) ?? new Date(0).toISOString();
  const status = normalizeMetaStatus(value.status);
  const conversation = isRecord(value.conversation) ? value.conversation : null;
  const firstError =
    Array.isArray(value.errors) && isRecord(value.errors[0]) ? value.errors[0] : null;
  return {
    eventId: `status:${value.id}:${status}:${occurredAt}`,
    messageId: value.id,
    phoneNumberId,
    recipientId: typeof value.recipient_id === 'string' ? value.recipient_id : null,
    status,
    occurredAt,
    conversationId:
      conversation !== null && typeof conversation.id === 'string' ? conversation.id : null,
    errorCode:
      firstError !== null &&
      (typeof firstError.code === 'string' || typeof firstError.code === 'number')
        ? String(firstError.code).slice(0, 80)
        : null,
    errorMessage: safeMetaErrorText(firstError),
  };
}

function cloudMessageContent(value: Record<string, unknown>): {
  body: string;
  visibleText: string;
  caption: string | null;
  hasMedia: boolean;
} | null {
  if (value.type === 'text' && isRecord(value.text) && typeof value.text.body === 'string') {
    return {
      body: value.text.body,
      visibleText: value.text.body,
      caption: null,
      hasMedia: false,
    };
  }
  if (value.type === 'interactive' && isRecord(value.interactive)) {
    for (const key of ['button_reply', 'list_reply']) {
      const reply = value.interactive[key];
      if (!isRecord(reply)) continue;
      const identifier = typeof reply.id === 'string' ? reply.id.trim() : '';
      const title = typeof reply.title === 'string' ? reply.title.trim() : '';
      if (identifier !== '' || title !== '') {
        return {
          body: identifier || title,
          visibleText: title || identifier,
          caption: null,
          hasMedia: false,
        };
      }
    }
  }
  if (value.type === 'button' && isRecord(value.button)) {
    const payload = typeof value.button.payload === 'string' ? value.button.payload.trim() : '';
    const text = typeof value.button.text === 'string' ? value.button.text.trim() : '';
    if (payload !== '' || text !== '') {
      return {
        body: payload || text,
        visibleText: text || payload,
        caption: null,
        hasMedia: false,
      };
    }
  }
  const labels: Record<string, string> = {
    image: '[Imagen]',
    video: '[Video]',
    document: '[Documento]',
    audio: '[Audio]',
  };
  if (typeof value.type === 'string' && value.type in labels) {
    const rawMedia = value[value.type];
    const media = isRecord(rawMedia) ? rawMedia : null;
    const caption =
      media !== null && typeof media.caption === 'string' && media.caption.trim() !== ''
        ? media.caption.trim().slice(0, 1024)
        : null;
    const visibleText = caption ?? labels[value.type] ?? '[Multimedia]';
    return { body: visibleText, visibleText, caption, hasMedia: true };
  }
  return null;
}

function contactNameFor(contacts: unknown[], rawMessage: unknown): string | null {
  if (!isRecord(rawMessage) || typeof rawMessage.from !== 'string') return null;
  const sender = recipientNumber(rawMessage.from);
  for (const contact of contacts) {
    if (!isRecord(contact) || typeof contact.wa_id !== 'string') continue;
    if (!validRecipient(contact.wa_id) || recipientNumber(contact.wa_id) !== sender) continue;
    const profile = isRecord(contact.profile) ? contact.profile : null;
    if (profile === null || typeof profile.name !== 'string') return null;
    const name = replaceControlCharacters(profile.name, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 200);
    return name === '' ? null : name;
  }
  return null;
}

function outboundPayloadContent(payload: Record<string, unknown>): {
  text: string | null;
  caption: string | null;
} {
  if (payload.type === 'text' && isRecord(payload.text) && typeof payload.text.body === 'string') {
    return { text: payload.text.body.slice(0, 4096), caption: null };
  }
  if (payload.type === 'interactive' && isRecord(payload.interactive)) {
    const visible: string[] = [];
    const header = isRecord(payload.interactive.header) ? payload.interactive.header : null;
    const body = isRecord(payload.interactive.body) ? payload.interactive.body : null;
    if (header !== null && typeof header.text === 'string') visible.push(header.text);
    if (body !== null && typeof body.text === 'string') visible.push(body.text);
    const action = isRecord(payload.interactive.action) ? payload.interactive.action : null;
    if (action !== null && Array.isArray(action.buttons)) {
      const labels = action.buttons
        .map((button) => (isRecord(button) && isRecord(button.reply) ? button.reply.title : null))
        .filter((label): label is string => typeof label === 'string');
      if (labels.length > 0) visible.push(`Opciones: ${labels.join(' · ')}`);
    }
    if (action !== null && Array.isArray(action.sections)) {
      const labels = action.sections.flatMap((section) => {
        if (!isRecord(section) || !Array.isArray(section.rows)) return [];
        return section.rows
          .map((row) => (isRecord(row) ? row.title : null))
          .filter((label): label is string => typeof label === 'string');
      });
      if (labels.length > 0) visible.push(`Opciones: ${labels.join(' · ')}`);
    }
    return { text: visible.join('\n').slice(0, 4096) || '[Mensaje interactivo]', caption: null };
  }
  const mediaLabels: Record<string, string> = {
    image: '[Imagen]',
    video: '[Video]',
    document: '[Documento]',
    audio: '[Audio]',
  };
  if (typeof payload.type === 'string' && payload.type in mediaLabels) {
    const rawMedia = payload[payload.type];
    const media = isRecord(rawMedia) ? rawMedia : null;
    const caption =
      media !== null && typeof media.caption === 'string' && media.caption.trim() !== ''
        ? media.caption.trim().slice(0, 1024)
        : null;
    return { text: caption ?? mediaLabels[payload.type] ?? '[Multimedia]', caption };
  }
  if (payload.type === 'template') return { text: '[Plantilla]', caption: null };
  return { text: `[Mensaje ${safeMessageType(payload)}]`, caption: null };
}

function safeMetaErrorText(error: Record<string, unknown> | null): string | null {
  if (error === null) return null;
  const errorData = isRecord(error.error_data) ? error.error_data : null;
  const candidate = [error.title, error.message, errorData?.details].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  if (candidate === undefined) return null;
  const sanitized = replaceControlCharacters(candidate, ' ')
    .replace(/https?:\/\/\S+/giu, '[URL omitida]')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [oculto]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 300);
  return sanitized === '' ? null : sanitized;
}

function replaceControlCharacters(value: string, replacement: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? replacement : character;
    })
    .join('');
}

function normalizeMetaStatus(value: string): MetaMessageStatus['status'] {
  return ['sent', 'delivered', 'read', 'failed', 'deleted'].includes(value)
    ? (value as MetaMessageStatus['status'])
    : 'unknown';
}

function metaTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function recipientNumber(identifier: string): string {
  const normalized = identifier
    .trim()
    .replace(/@(c\.us|lid)$/iu, '')
    .replace(/^\+/u, '');
  if (!/^\d{8,15}$/u.test(normalized)) {
    throw new Error('El destinatario de Cloud API no es válido.');
  }
  return normalized;
}

function validRecipient(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    recipientNumber(value);
    return true;
  } catch {
    return false;
  }
}

function validCredential(value: string | undefined): boolean {
  return value !== undefined && value.trim().length >= 20;
}

function validMetaIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6,30}$/u.test(value);
}

function eventAccepted(
  eventId: string,
  acceptedEventIds: ReadonlySet<string> | undefined,
): boolean {
  return acceptedEventIds === undefined || acceptedEventIds.has(eventId);
}

function safeMessageType(value: unknown): string {
  if (!isRecord(value) || typeof value.type !== 'string') return 'unknown';
  return value.type.replace(/[^a-z0-9_-]/giu, '').slice(0, 40) || 'unknown';
}

async function parseGraphResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readGraphError(payload: unknown): { code: string | null; subcode: string | null } | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const code = payload.error.code;
  const subcode = payload.error.error_subcode;
  return {
    code: typeof code === 'string' || typeof code === 'number' ? String(code) : null,
    subcode: typeof subcode === 'string' || typeof subcode === 'number' ? String(subcode) : null,
  };
}

function readOutboundMessageId(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.messages) || !isRecord(payload.messages[0])) {
    return null;
  }
  return typeof payload.messages[0].id === 'string' ? payload.messages[0].id : null;
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
