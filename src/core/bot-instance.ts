import type { Logger } from 'pino';
import type { AIProvider } from '../ai/ai-provider.js';
import { AssistantQueryService } from '../ai/assistant-query-service.js';
import { AIRequestQueueService } from '../ai/ai-request-queue-service.js';
import type { BotRecord, ConnectionSnapshot, GroupJoinEvent } from '../domain/types.js';
import { serializeError } from '../infrastructure/safe-error.js';
import type { MessagingClient } from '../messaging/messaging-client.js';
import { canonicalPhoneIdentity } from '../messaging/identifiers.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import type { SecretVault } from '../security/secret-vault.js';
import { ModerationService } from '../moderation/moderation-service.js';
import { AutomaticMessageService } from './automatic-message-service.js';
import { ConnectionManager } from './connection-manager.js';
import { ConversationFlowService } from './conversation-flow-service.js';
import { GroupDiscoveryService } from './group-discovery-service.js';
import { MessageProcessor } from './message-processor.js';
import { PollRepository } from './poll-repository.js';
import { PollScheduler } from './poll-scheduler.js';
import { PollSender } from './poll-sender.js';
import { PollService } from './poll-service.js';
import { PollTemplateSelector } from './poll-template-selector.js';
import { OutboundMessageQueueService } from './outbound-message-queue-service.js';

export type BotInstanceOptions = {
  maxMessageLength: number;
  repeatWindowMs: number;
  maxReconnectAttempts: number;
  maxReconnectDelayMs: number;
  developmentMode: boolean;
  mediaRoot: string;
  onReady?: (botId: string) => void;
  onGroupJoin?: (botId: string, event: GroupJoinEvent) => Promise<void>;
  isPaused?: () => boolean;
  secretVault?: SecretVault;
};

export class BotInstance {
  private readonly connection: ConnectionManager;
  private readonly discovery: GroupDiscoveryService;
  private readonly processor: MessageProcessor;
  private readonly automaticMessages: AutomaticMessageService;
  private readonly pollRepository: PollRepository;
  private readonly pollService: PollService;
  private readonly pollScheduler: PollScheduler;
  private readonly aiQueue: AIRequestQueueService;
  private readonly outboundQueue: OutboundMessageQueueService;
  private readonly moderation: ModerationService | null;
  private readonly communityServicesEnabled: boolean;

  public constructor(
    public readonly bot: BotRecord,
    private readonly client: MessagingClient,
    database: AppDatabase,
    provider: AIProvider,
    anonymizer: Anonymizer,
    private readonly logger: Logger,
    options: BotInstanceOptions,
  ) {
    this.communityServicesEnabled = bot.groupChannelEnabled;
    this.connection = new ConnectionManager(client, logger, {
      maxAttempts: options.maxReconnectAttempts,
      maxDelayMs: options.maxReconnectDelayMs,
      developmentMode: options.developmentMode,
    });
    this.discovery = new GroupDiscoveryService(
      client,
      database,
      logger,
      {
        onLoading: () => this.connection.updateState('loading_chats'),
        onLoaded: () => this.connection.updateState('connected'),
        onFailure: (code) => this.connection.updateState('loading_chats', code),
      },
      {
        botId: bot.id,
        developmentMode: options.developmentMode,
        anonymize: (identifier) => anonymizer.identifier(identifier),
      },
    );
    this.aiQueue = new AIRequestQueueService(database, logger, bot.id);
    this.outboundQueue = new OutboundMessageQueueService(client, database, logger, bot.id);
    this.moderation = bot.groupChannelEnabled
      ? new ModerationService(database, this.outboundQueue, logger, bot.id, options.secretVault)
      : null;
    const query = new AssistantQueryService(database, provider, logger, bot.id, this.aiQueue);
    if (bot.capabilities.communitySingleTurnMode) database.clearConversationStates(bot.id);
    const flow =
      bot.capabilities.conversationContinuationEnabled || bot.capabilities.interactiveMenusEnabled
        ? new ConversationFlowService(
            database,
            client,
            logger,
            bot.id,
            options.mediaRoot,
            query,
            this.outboundQueue,
          )
        : undefined;
    this.automaticMessages = new AutomaticMessageService(database, client, logger, anonymizer, {
      botId: bot.id,
      ...(options.isPaused === undefined ? {} : { isPaused: options.isPaused }),
    });
    this.pollRepository = new PollRepository(database, bot.id);
    const pollSelector = new PollTemplateSelector(this.pollRepository);
    const pollSender = new PollSender(this.pollRepository, database, client, logger, anonymizer);
    this.pollService = new PollService(
      this.pollRepository,
      pollSelector,
      pollSender,
      database,
      client,
      logger,
      anonymizer,
      options.isPaused === undefined ? {} : { isPaused: options.isPaused },
    );
    this.pollScheduler = new PollScheduler(this.pollService, logger);
    this.processor = new MessageProcessor(
      database,
      client,
      query,
      anonymizer,
      logger,
      () => this.connection.snapshot(),
      {
        maxMessageLength: options.maxMessageLength,
        repeatWindowMs: options.repeatWindowMs,
        developmentMode: options.developmentMode,
      },
      bot.id,
      flow,
      this.outboundQueue,
      this.moderation ?? undefined,
    );
    client.setEvents({
      onMessage: async (message) => {
        if (!message.isGroup && message.recipientId !== undefined) {
          const waId = waIdFromIdentity(message.participantId);
          if (waId !== null) {
            try {
              database.recordConversationMessage({
                assistantId: bot.id,
                phoneNumberId: message.recipientId,
                waId,
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
        if (state === 'disconnected' || state === 'auth_failure') this.discovery.cancel();
      },
      onReady: async () => {
        database.updateBotWhatsAppStatus(bot.id, 'connected', null, new Date().toISOString());
        database.markMetaConnectorConnected(bot.id);
        if (this.communityServicesEnabled) void this.discovery.refreshAfterReady();
        if (this.communityServicesEnabled) {
          this.automaticMessages.reconfigure();
          this.pollScheduler.reconfigure();
        }
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
      onGroupJoin: async (event) => {
        if (this.communityServicesEnabled) await this.automaticMessages.handleGroupJoin(event);
        await options.onGroupJoin?.(bot.id, event);
      },
      onGroupChanged: async (event) => {
        await this.discovery.handleGroupChange(event);
      },
    });
  }

  public async start(): Promise<void> {
    this.logger.info(
      { operation: 'BOT_STARTED', botId: this.bot.id },
      'Se inició una instancia aislada',
    );
    if (this.communityServicesEnabled) this.discovery.startPeriodic();
    if (this.communityServicesEnabled) {
      this.automaticMessages.start();
      this.pollScheduler.start();
    } else {
      this.logger.info(
        { operation: 'POLL_SERVICE_NOT_REQUIRED', botId: this.bot.id },
        'Los servicios comunitarios no son necesarios para este asistente',
      );
    }
    try {
      await this.connection.start();
    } catch (error) {
      if (this.communityServicesEnabled) this.discovery.stop();
      if (this.communityServicesEnabled) {
        this.automaticMessages.stop();
        this.pollScheduler.stop();
      }
      throw error;
    }
  }

  public moderationService(): ModerationService | null {
    return this.moderation;
  }

  public async stop(): Promise<void> {
    this.aiQueue.shutdown();
    if (this.communityServicesEnabled) this.discovery.stop();
    if (this.communityServicesEnabled) {
      this.automaticMessages.stop();
      this.pollScheduler.stop();
    }
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

  public groupDiscovery(): GroupDiscoveryService {
    return this.discovery;
  }

  public automaticMessageService(): AutomaticMessageService {
    return this.automaticMessages;
  }

  public pollDataRepository(): PollRepository {
    return this.pollRepository;
  }

  public pollSendingService(): PollService {
    return this.pollService;
  }

  public pollTaskScheduler(): PollScheduler {
    return this.pollScheduler;
  }

  public aiRequestQueue(): AIRequestQueueService {
    return this.aiQueue;
  }

  public snapshot(): {
    connection: ConnectionSnapshot;
    discovery: ReturnType<GroupDiscoveryService['snapshot']>;
  } {
    return { connection: this.connection.snapshot(), discovery: this.discovery.snapshot() };
  }
}

function waIdFromIdentity(identifier: string): string | null {
  const canonical = canonicalPhoneIdentity(identifier);
  return canonical === null ? null : canonical.slice(0, -'@c.us'.length);
}
