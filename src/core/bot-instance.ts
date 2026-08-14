import type { Logger } from 'pino';
import type { AIProvider } from '../ai/ai-provider.js';
import { AssistantQueryService } from '../ai/assistant-query-service.js';
import { AIRequestQueueService } from '../ai/ai-request-queue-service.js';
import type { BotRecord, ConnectionSnapshot } from '../domain/types.js';
import { serializeError } from '../infrastructure/safe-error.js';
import type { MessagingClient } from '../messaging/messaging-client.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import { ConnectionManager } from './connection-manager.js';
import { ConversationFlowService } from './conversation-flow-service.js';
import { MessageProcessor } from './message-processor.js';
import { OutboundMessageQueueService } from './outbound-message-queue-service.js';

export type BotInstanceOptions = {
  maxMessageLength: number;
  maxReconnectAttempts: number;
  maxReconnectDelayMs: number;
  developmentMode: boolean;
  mediaRoot: string;
  onReady?: (botId: string) => void;
  isPaused?: () => boolean;
};

export class BotInstance {
  private readonly connection: ConnectionManager;
  private readonly processor: MessageProcessor;
  private readonly aiQueue: AIRequestQueueService;
  private readonly outboundQueue: OutboundMessageQueueService;

  public constructor(
    public readonly bot: BotRecord,
    private readonly client: MessagingClient,
    database: AppDatabase,
    provider: AIProvider,
    anonymizer: Anonymizer,
    private readonly logger: Logger,
    options: BotInstanceOptions,
  ) {
    this.connection = new ConnectionManager(client, logger, {
      maxAttempts: options.maxReconnectAttempts,
      maxDelayMs: options.maxReconnectDelayMs,
      developmentMode: options.developmentMode,
    });
    this.aiQueue = new AIRequestQueueService(database, logger, bot.id);
    this.outboundQueue = new OutboundMessageQueueService(client, database, logger, bot.id);
    const query = new AssistantQueryService(database, provider, logger, bot.id, this.aiQueue);
    const flow = new ConversationFlowService(
      database,
      client,
      logger,
      bot.id,
      options.mediaRoot,
      query,
      this.outboundQueue,
    );
    this.processor = new MessageProcessor(
      database,
      anonymizer,
      logger,
      {
        maxMessageLength: options.maxMessageLength,
        ...(options.isPaused === undefined ? {} : { isMaintenanceActive: options.isPaused }),
      },
      bot.id,
      flow,
    );

    client.setEvents({
      onMessage: async (message) => {
        if (message.businessPhoneNumberId !== undefined) {
          try {
            database.recordConversationMessage({
              assistantId: bot.id,
              phoneNumberId: message.businessPhoneNumberId,
              waId: message.customerId,
              contactName: message.contactName ?? null,
              whatsappMessageId: message.id,
              direction: 'inbound',
              senderType: 'customer',
              messageType: message.messageType ?? 'unknown',
              text: message.visibleText ?? message.body,
              caption: message.caption ?? null,
              messageTimestamp: message.receivedAt ?? new Date().toISOString(),
              whatsappStatus: 'received',
            });
          } catch (error) {
            this.logger.error(
              {
                ...serializeError(error, 'CONVERSATION_INBOUND_PERSIST_FAILED', false),
                operation: 'CONVERSATION_INBOUND_PERSIST_FAILED',
                botId: bot.id,
              },
              'No fue posible registrar el mensaje entrante; el procesamiento continuará',
            );
          }
        }
        await this.processor.process(message);
      },
      onStateChange: (state, reason) => {
        this.connection.updateState(state, reason);
        database.updateBotWhatsAppStatus(
          bot.id,
          state,
          null,
          state === 'connected' ? new Date().toISOString() : null,
        );
        database.recordTechnicalEvent({
          botId: bot.id,
          eventType:
            state === 'connected'
              ? 'BOT_CONNECTED'
              : state === 'disconnected'
                ? 'BOT_DISCONNECTED'
                : 'BOT_STATE_CHANGED',
          result: state,
          ...(reason === undefined ? {} : { errorCode: reason }),
        });
      },
      onReady: () => {
        database.updateBotWhatsAppStatus(bot.id, 'connected', null, new Date().toISOString());
        database.markMetaConnectorConnected(bot.id);
        options.onReady?.(bot.id);
      },
      onDeliveryStatus: (status) => {
        database.recordMetaMessageStatus({ ...status, botId: bot.id });
        if (['sent', 'delivered', 'read', 'failed'].includes(status.status)) {
          database.updateConversationMessageStatus({
            whatsappMessageId: status.messageId,
            status: status.status as 'sent' | 'delivered' | 'read' | 'failed',
            occurredAt: status.occurredAt,
            errorCode: status.errorCode,
            errorMessage: status.errorMessage,
          });
        }
        database.recordTechnicalEvent({
          botId: bot.id,
          eventType: 'META_MESSAGE_STATUS_RECEIVED',
          result: status.status,
          ...(status.errorCode === null ? {} : { errorCode: status.errorCode }),
        });
      },
      onOutboundMessage: (message) => {
        try {
          database.recordConversationMessage({
            assistantId: bot.id,
            phoneNumberId: message.phoneNumberId,
            waId: message.recipientId,
            whatsappMessageId: message.messageId,
            direction: 'outbound',
            senderType: 'assistant',
            messageType: message.messageType,
            text: message.text,
            caption: message.caption,
            messageTimestamp: message.acceptedAt,
            whatsappStatus: 'accepted',
          });
        } catch (error) {
          this.logger.error(
            {
              ...serializeError(error, 'CONVERSATION_OUTBOUND_PERSIST_FAILED', false),
              operation: 'CONVERSATION_OUTBOUND_PERSIST_FAILED',
              botId: bot.id,
            },
            'No fue posible registrar el mensaje saliente aceptado por Meta',
          );
        }
      },
    });
  }

  public async start(): Promise<void> {
    this.logger.info(
      { operation: 'BOT_STARTED', botId: this.bot.id },
      'Se inició una instancia aislada',
    );
    await this.connection.start();
  }

  public async stop(): Promise<void> {
    this.aiQueue.shutdown();
    await this.connection.stop();
    this.logger.info(
      { operation: 'BOT_STOPPED', botId: this.bot.id },
      'Se detuvo una instancia aislada',
    );
  }

  public async restart(): Promise<void> {
    await this.connection.restart();
  }

  public resetTransientState(): void {
    this.processor.resetTransientState();
  }

  public messagingClient(): MessagingClient {
    return this.client;
  }

  public connectionManager(): ConnectionManager {
    return this.connection;
  }

  public aiRequestQueue(): AIRequestQueueService {
    return this.aiQueue;
  }

  public snapshot(): { connection: ConnectionSnapshot } {
    return { connection: this.connection.snapshot() };
  }
}
