import type { Logger } from 'pino';
import type {
  DetectedGroup,
  GroupListSource,
  IncomingMessage,
  NativePoll,
} from '../domain/types.js';
import type {
  InteractiveMenuPayload,
  MessagingClient,
  MessagingClientEvents,
  SelectableMenuPayload,
} from '../messaging/messaging-client.js';
import { CommercialMessagingPolicy } from './commercial-plan-policy.js';
import type {
  CommercialPlanService,
  MetaTemplateApprovalStatus,
} from './commercial-plan-policy.js';
import type { MetaBillingLedger, MetaMessageDeliveryStatus } from './meta-billing-ledger.js';
import type { MetaTemplateCategory } from './template-library.js';

type FetchImplementation = typeof fetch;

type MetaTextParameter = {
  type: 'text';
  text: string;
};

export type MetaTemplateSendInput = {
  recipient: string;
  templateName: string;
  language: string;
  category: MetaTemplateCategory;
  approvalStatus: MetaTemplateApprovalStatus;
  bodyParameters?: string[];
};

export type MetaWebhookResult = {
  receivedMessages: number;
  statusUpdates: number;
};

export type MetaCloudApiClientOptions = {
  botId: string;
  graphApiVersion: string;
  phoneNumberId?: string;
  accessToken?: string;
  maxMessageLength: number;
  planService: CommercialPlanService;
  billingLedger: MetaBillingLedger;
  customerReference: (recipient: string) => string;
  fetchImplementation?: FetchImplementation;
};

export class MetaCloudApiClient implements MessagingClient {
  private events: MessagingClientEvents | null = null;
  private ready = false;
  private readonly fetchImplementation: FetchImplementation;
  private readonly policy: CommercialMessagingPolicy;

  public constructor(
    private readonly options: MetaCloudApiClientOptions,
    private readonly logger: Logger,
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.policy = new CommercialMessagingPolicy(
      () => this.options.planService.get(this.options.botId).plan,
    );
  }

  public setEvents(events: MessagingClientEvents): void {
    this.events = events;
  }

  public async initialize(): Promise<void> {
    this.events?.onStateChange('initializing');
    if (!this.isConfigured()) {
      this.events?.onStateChange('auth_failure', 'META_CLOUD_API_NOT_CONFIGURED');
      throw new Error(
        'Meta Cloud API no está configurada. Complete META_PHONE_NUMBER_ID y META_ACCESS_TOKEN.',
      );
    }
    this.ready = true;
    this.events?.onStateChange('connected');
    await this.events?.onReady();
  }

  public async destroy(): Promise<void> {
    if (!this.ready) return;
    this.ready = false;
    this.events?.onStateChange('disconnected', 'CLIENT_STOPPED');
  }

  public async sendMessage(
    chatId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void> {
    this.assertReady();
    const recipient = normalizeRecipient(chatId);
    this.policy.assertFreeFormMessageAllowed(recipient);
    const body = text.trim().slice(0, this.options.maxMessageLength);
    if (body === '') throw new Error('No es posible enviar un mensaje vacío.');

    await this.sendGraphMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { body },
      ...(replyToMessageId === undefined
        ? {}
        : { context: { message_id: replyToMessageId } }),
    });
  }

  public async sendInteractiveMenu(
    chatId: string,
    payload: InteractiveMenuPayload,
  ): Promise<boolean> {
    this.assertReady();
    const recipient = normalizeRecipient(chatId);
    this.policy.assertFreeFormMessageAllowed(recipient);

    if (payload.kind === 'buttons' && payload.options.length <= 3) {
      await this.sendGraphMessage({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'text', text: payload.title.slice(0, 60) },
          body: { text: payload.message.slice(0, 1024) },
          footer: { text: payload.helpText.slice(0, 60) },
          action: {
            buttons: payload.options.map((option) => ({
              type: 'reply',
              reply: {
                id: option.id.slice(0, 256),
                title: option.label.slice(0, 20),
              },
            })),
          },
        },
      });
      return true;
    }

    return this.sendListMenu(recipient, payload);
  }

  public async sendSelectableMenu(
    chatId: string,
    payload: SelectableMenuPayload,
  ): Promise<boolean> {
    this.assertReady();
    const recipient = normalizeRecipient(chatId);
    this.policy.assertFreeFormMessageAllowed(recipient);
    return this.sendListMenu(recipient, payload);
  }

  public async sendTemplate(input: MetaTemplateSendInput): Promise<string> {
    this.assertReady();
    this.policy.assertTemplateMessageAllowed(input.approvalStatus);
    const recipient = normalizeRecipient(input.recipient);
    const parameters: MetaTextParameter[] = (input.bodyParameters ?? []).map((text) => ({
      type: 'text',
      text,
    }));
    const response = await this.sendGraphMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.language },
        ...(parameters.length === 0
          ? {}
          : {
              components: [
                {
                  type: 'body',
                  parameters,
                },
              ],
            }),
      },
    });
    const messageId = response.messages?.[0]?.id;
    if (messageId === undefined) throw new Error('Meta no devolvió el identificador del mensaje.');
    await this.options.billingLedger.recordTemplateSubmitted({
      botId: this.options.botId,
      messageId,
      templateName: input.templateName,
      category: input.category,
      customerReference: this.options.customerReference(recipient),
      occurredAt: new Date().toISOString(),
    });
    return messageId;
  }

  public async handleWebhook(payload: unknown): Promise<MetaWebhookResult> {
    const values = webhookValues(payload).filter(
      (value) => value.metadata?.phone_number_id === this.options.phoneNumberId,
    );
    let receivedMessages = 0;
    let statusUpdates = 0;

    for (const value of values) {
      for (const status of value.statuses ?? []) {
        if (!isDeliveryStatus(status.status)) continue;
        await this.options.billingLedger.recordStatus({
          botId: this.options.botId,
          messageId: status.id,
          status: status.status,
          occurredAt: timestampToIso(status.timestamp),
          errorCode: status.errors?.[0]?.code?.toString() ?? null,
        });
        statusUpdates += 1;
      }

      for (const message of value.messages ?? []) {
        const recipient = normalizeRecipient(message.from);
        const timestampMs = parseTimestamp(message.timestamp);
        this.policy.recordCustomerMessage(recipient, timestampMs);
        await this.events?.onMessage(toIncomingMessage(message, recipient));
        receivedMessages += 1;
      }
    }

    return { receivedMessages, statusUpdates };
  }

  public async sendPoll(_chatId: string, _poll: NativePoll): Promise<void> {
    throw new Error('Las encuestas comunitarias no están disponibles en Meta Cloud API.');
  }

  public async listGroups(): Promise<DetectedGroup[]> {
    return [];
  }

  public getLastGroupScanSkippedCount(): number {
    return 0;
  }

  public getLastGroupListSource(): GroupListSource | null {
    return null;
  }

  public async getState(): Promise<string | null> {
    return this.ready ? 'CONNECTED' : 'DISCONNECTED';
  }

  public isReady(): boolean {
    return this.ready;
  }

  public isOwnIdentifier(identifier: string): boolean {
    if (this.options.phoneNumberId === undefined) return false;
    try {
      return normalizeRecipient(identifier) === normalizeRecipient(this.options.phoneNumberId);
    } catch {
      return false;
    }
  }

  public getOwnIdentifier(): string | null {
    return null;
  }

  public phoneNumberId(): string | null {
    return this.options.phoneNumberId ?? null;
  }

  private async sendListMenu(
    recipient: string,
    payload: SelectableMenuPayload,
  ): Promise<boolean> {
    const rows = payload.options.slice(0, 10).map((option) => ({
      id: option.id.slice(0, 200),
      title: option.label.slice(0, 24),
    }));
    if (rows.length === 0) return false;
    await this.sendGraphMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: payload.title.slice(0, 60) },
        body: { text: payload.message.slice(0, 1024) },
        footer: { text: payload.helpText.slice(0, 60) },
        action: {
          button: 'Ver opciones',
          sections: [{ title: payload.title.slice(0, 24), rows }],
        },
      },
    });
    return true;
  }

  private async sendGraphMessage(body: Record<string, unknown>): Promise<MetaSendResponse> {
    if (!this.isConfigured()) throw new Error('Meta Cloud API no está configurada.');
    const response = await this.fetchImplementation(
      `https://graph.facebook.com/${this.options.graphApiVersion}/${this.options.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const parsed = parseJson(await response.text());
    if (!response.ok) {
      const message = errorMessage(parsed) ?? `Meta respondió HTTP ${response.status}.`;
      this.logger.error(
        {
          operation: 'META_CLOUD_API_SEND_FAILED',
          botId: this.options.botId,
          statusCode: response.status,
        },
        message,
      );
      throw new Error(message);
    }
    return parsed as MetaSendResponse;
  }

  private isConfigured(): boolean {
    return Boolean(this.options.phoneNumberId?.trim() && this.options.accessToken?.trim());
  }

  private assertReady(): void {
    if (!this.ready) throw new Error('El cliente de Meta Cloud API no está conectado.');
  }
}

type MetaSendResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string };
};

type MetaWebhookValue = {
  metadata?: { phone_number_id?: string };
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
};

type MetaWebhookMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  context?: { id?: string };
};

type MetaWebhookStatus = {
  id: string;
  status: string;
  timestamp: string;
  errors?: Array<{ code?: number | string }>;
};

function webhookValues(payload: unknown): MetaWebhookValue[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];
  const values: MetaWebhookValue[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      values.push(change.value as MetaWebhookValue);
    }
  }
  return values;
}

export function phoneNumberIdsFromWebhook(payload: unknown): string[] {
  return [
    ...new Set(
      webhookValues(payload)
        .map((value) => value.metadata?.phone_number_id)
        .filter((value): value is string => typeof value === 'string' && value !== ''),
    ),
  ];
}

function toIncomingMessage(message: MetaWebhookMessage, recipient: string): IncomingMessage {
  return {
    id: message.id,
    ...(message.context?.id === undefined ? {} : { replyToMessageId: message.context.id }),
    chatId: `${recipient}@c.us`,
    participantId: `${recipient}@c.us`,
    participantIdentityStatus: 'phone',
    messageType: message.type,
    body: messageBody(message),
    isGroup: false,
    fromMe: false,
    isStatus: false,
    isBroadcast: false,
    isChannel: false,
    hasMedia: !['text', 'button', 'interactive'].includes(message.type),
    mentionsBot: false,
    isReplyToBot: message.context?.id !== undefined,
  };
}

function messageBody(message: MetaWebhookMessage): string {
  if (message.type === 'text') return message.text?.body?.trim() ?? '';
  if (message.type === 'button') return message.button?.text?.trim() ?? '';
  if (message.type === 'interactive') {
    return (
      message.interactive?.button_reply?.title?.trim() ??
      message.interactive?.list_reply?.title?.trim() ??
      ''
    );
  }
  return `[Mensaje ${message.type}]`;
}

function normalizeRecipient(identifier: string): string {
  const local = identifier.split('@')[0] ?? identifier;
  const digits = local.replace(/\D/gu, '');
  if (digits.length < 8 || digits.length > 15) {
    throw new Error('El número de WhatsApp no tiene un formato válido.');
  }
  return digits;
}

function parseTimestamp(timestamp: string): number {
  const value = Number(timestamp);
  return Number.isFinite(value) && value > 0 ? value * 1000 : Date.now();
}

function timestampToIso(timestamp: string): string {
  return new Date(parseTimestamp(timestamp)).toISOString();
}

function isDeliveryStatus(value: string): value is MetaMessageDeliveryStatus {
  const statuses: readonly string[] = ['sent', 'delivered', 'read', 'failed', 'deleted'];
  return statuses.includes(value);
}

function parseJson(value: string): unknown {
  if (value.trim() === '') return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function errorMessage(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return typeof value.error.message === 'string' ? value.error.message : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
