import type { Logger } from 'pino';
import { DEFAULT_BUSINESS_ASSISTANT_ID } from '../domain/business-defaults.js';
import type { IncomingMessage } from '../domain/types.js';
import { serializeError } from '../infrastructure/safe-error.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import { ExpiringSet } from './expiring-cache.js';
import type { ConversationFlowService } from './conversation-flow-service.js';

export type MessageProcessorOptions = {
  maxMessageLength: number;
  isMaintenanceActive?: () => boolean;
};

export type ProcessResult = 'ignored' | 'duplicate' | 'bot_disabled' | 'responded' | 'send_failed';

export class MessageProcessor {
  private readonly processedMessages = new ExpiringSet(10 * 60 * 1000);

  public constructor(
    private readonly database: AppDatabase,
    private readonly anonymizer: Anonymizer,
    private readonly logger: Logger,
    private readonly options: MessageProcessorOptions,
    private readonly botId = DEFAULT_BUSINESS_ASSISTANT_ID,
    private readonly conversationFlow?: ConversationFlowService,
  ) {}

  public async process(message: IncomingMessage): Promise<ProcessResult> {
    const conversationHash = this.anonymizer.identifier(message.chatId);
    const customerHash = this.anonymizer.identifier(message.customerId);
    const messageHash = this.anonymizer.identifier(message.id);
    const context = { conversationHash, customerHash, messageHash };

    if (this.options.isMaintenanceActive?.() === true) {
      this.logger.info(
        { operation: 'PRIVATE_MESSAGE_IGNORED', reason: 'MAINTENANCE_MODE', ...context },
        'El procesamiento privado está pausado por mantenimiento',
      );
      return 'ignored';
    }
    if (message.body.trim() === '' || message.body.length > this.options.maxMessageLength) {
      this.logger.info(
        { operation: 'PRIVATE_MESSAGE_IGNORED', reason: 'INVALID_MESSAGE_LENGTH', ...context },
        'Se ignoró un mensaje privado incompatible',
      );
      return 'ignored';
    }

    const bot = this.database.getBot(this.botId);
    if (bot === null || !bot.enabled) return 'bot_disabled';
    if (!bot.capabilities.privateChatsEnabled || this.conversationFlow === undefined) {
      this.logger.info(
        {
          operation: 'PRIVATE_MESSAGE_IGNORED',
          reason: 'PRIVATE_CHAT_DISABLED',
          botId: this.botId,
          ...context,
        },
        'El canal privado está desactivado',
      );
      return 'ignored';
    }
    if (!this.processedMessages.checkAndAdd(message.id)) return 'duplicate';

    try {
      const interactiveReply =
        message.messageType === 'interactive' || message.messageType === 'button';
      const handled = await this.conversationFlow.handle(
        message.chatId,
        conversationHash,
        customerHash,
        message.body,
        new Date(),
        interactiveReply,
      );
      if (handled) return 'responded';
      return (await this.conversationFlow.start(message.chatId, conversationHash, customerHash))
        ? 'responded'
        : 'ignored';
    } catch (error) {
      this.logger.error(
        {
          operation: 'PRIVATE_RESPONSE_FAILED',
          botId: this.botId,
          ...context,
          ...serializeError(error, 'PRIVATE_RESPONSE_FAILED', false),
        },
        'No fue posible responder la conversación privada',
      );
      return 'send_failed';
    }
  }

  public resetTransientState(): void {
    this.processedMessages.clear();
  }
}
