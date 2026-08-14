import type { Logger } from 'pino';
import type { AIProviderFactory } from '../ai/ai-provider-factory.js';
import type { AssistantProfile, BotRecord, ConnectorType, MenuType } from '../domain/types.js';
import { serializeError } from '../infrastructure/safe-error.js';
import type { MessagingClient } from '../messaging/messaging-client.js';
import { WhatsAppCloudApiAdapter } from '../messaging/whatsapp-cloud-api-adapter.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import type { AIRequestQueueService } from '../ai/ai-request-queue-service.js';
import { BotInstance, type BotInstanceOptions } from './bot-instance.js';

export type MetaBotAccount = {
  botId: string;
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
};

export type MetaCloudRuntimeConfiguration = {
  apiVersion: string;
  requestTimeoutMs: number;
  accounts: MetaBotAccount[];
};

type ClientFactory = (bot: BotRecord, account: MetaBotAccount | undefined) => MessagingClient;

export class MultiBotManager {
  private readonly instances = new Map<string, BotInstance>();
  private readonly started = new Set<string>();
  private readonly accountsByBot = new Map<string, MetaBotAccount>();

  public constructor(
    private readonly database: AppDatabase,
    private readonly providers: AIProviderFactory,
    private readonly anonymizer: Anonymizer,
    private readonly logger: Logger,
    private readonly options: BotInstanceOptions,
    private readonly meta: MetaCloudRuntimeConfiguration,
    private readonly clientFactory: ClientFactory = (_bot, account) =>
      new WhatsAppCloudApiAdapter(
        {
          ...(account?.accessToken === undefined ? {} : { accessToken: account.accessToken }),
          ...(account?.phoneNumberId === undefined ? {} : { phoneNumberId: account.phoneNumberId }),
          ...(account?.wabaId === undefined ? {} : { wabaId: account.wabaId }),
          apiVersion: meta.apiVersion,
          requestTimeoutMs: meta.requestTimeoutMs,
        },
        logger,
      ),
  ) {
    for (const account of meta.accounts) {
      this.accountsByBot.set(account.botId, account);
      if (account.phoneNumberId !== undefined && this.database.getBot(account.botId) !== null) {
        this.database.configureMetaConnector(account.botId, account.phoneNumberId);
      } else if (this.database.getBot(account.botId) === null) {
        this.logger.warn(
          { operation: 'META_ACCOUNT_ASSISTANT_MISSING', botId: account.botId },
          'La cuenta Meta se conservará sin asociar hasta que exista el negocio correspondiente',
        );
      }
    }
  }

  public async startAll(): Promise<void> {
    for (const bot of this.database.listBots().filter((candidate) => this.canStart(candidate))) {
      try {
        await this.start(bot.id);
      } catch (error) {
        this.recordInstanceFailure('BOT_START_FAILED', bot.id, error);
      }
    }
  }

  public async start(botId: string): Promise<void> {
    const instance = await this.prepare(botId);
    if (this.started.has(botId)) return;
    this.started.add(botId);
    try {
      await instance.start();
    } catch (error) {
      this.started.delete(botId);
      throw error;
    }
  }

  public async prepareAll(): Promise<void> {
    for (const bot of this.database.listBots().filter((candidate) => this.canPrepare(candidate))) {
      try {
        await this.prepare(bot.id);
      } catch (error) {
        this.recordInstanceFailure('BOT_PREPARE_FAILED', bot.id, error);
      }
    }
  }

  public async prepare(botId: string): Promise<BotInstance> {
    const existing = this.instances.get(botId);
    if (existing !== undefined) return existing;
    const bot = this.database.getBot(botId);
    if (bot === null) throw new Error('El asistente no existe.');
    if (!this.canPrepare(bot))
      throw new Error('El asistente no puede prepararse en su estado actual.');
    const account = this.accountsByBot.get(botId);
    const instance = new BotInstance(
      bot,
      this.clientFactory(bot, account),
      this.database,
      this.providers.forBot(bot.id),
      this.anonymizer,
      this.logger,
      this.options,
    );
    this.instances.set(botId, instance);
    return instance;
  }

  public async create(input: {
    id: string;
    connectorType: ConnectorType;
    menuType: MenuType;
    profile: Omit<AssistantProfile, 'id' | 'active' | 'createdAt' | 'updatedAt'>;
  }): Promise<BotRecord> {
    const bot = this.database.createBot({ ...input });
    this.database.recordTechnicalEvent({
      botId: bot.id,
      eventType: 'ASSISTANT_DRAFT_CREATED',
      result: 'awaiting_meta_configuration',
    });
    return bot;
  }

  public async ingestMetaWebhook(
    phoneNumberId: string,
    payload: unknown,
    acceptedEventIds: ReadonlySet<string>,
  ): Promise<{ messages: number; statuses: number; unsupportedMessages: number }> {
    const botId = this.database.getBotIdByMetaPhoneNumberId(phoneNumberId);
    if (botId === null) throw new Error('META_PHONE_NUMBER_NOT_CONFIGURED');
    if (!this.started.has(botId)) await this.start(botId);
    const client = this.client(botId);
    if (!(client instanceof WhatsAppCloudApiAdapter)) throw new Error('META_ADAPTER_NOT_AVAILABLE');
    return client.ingestWebhook(payload, acceptedEventIds);
  }

  public metaConfiguration(botId: string): {
    configured: boolean;
    credentialsMissing: string[];
    phoneNumberIdConfigured: boolean;
    lastErrorCode: string | null;
  } {
    const account = this.accountsByBot.get(botId);
    const client = this.client(botId);
    const credentialsMissing = [
      ...(account?.accessToken === undefined ? ['META_ACCESS_TOKEN'] : []),
      ...(account?.phoneNumberId === undefined ? ['META_PHONE_NUMBER_ID'] : []),
      ...(account?.wabaId === undefined ? ['META_WABA_ID'] : []),
    ];
    return {
      configured: credentialsMissing.length === 0,
      credentialsMissing,
      phoneNumberIdConfigured: account?.phoneNumberId !== undefined,
      lastErrorCode:
        client instanceof WhatsAppCloudApiAdapter ? client.status().lastErrorCode : null,
    };
  }

  public async restart(botId: string): Promise<void> {
    const instance = this.instances.get(botId);
    if (instance === undefined) return this.start(botId);
    await instance.restart();
  }

  public async stop(botId: string): Promise<void> {
    const instance = this.instances.get(botId);
    if (instance === undefined) return;
    await instance.stop();
    this.instances.delete(botId);
    this.started.delete(botId);
  }

  public async stopAll(): Promise<void> {
    await Promise.all([...this.instances.values()].map((instance) => instance.stop()));
    this.instances.clear();
    this.started.clear();
  }

  public snapshots(): Array<{
    bot: BotRecord;
    runtime: ReturnType<BotInstance['snapshot']> | null;
  }> {
    return this.database
      .listBots()
      .map((bot) => ({ bot, runtime: this.instances.get(bot.id)?.snapshot() ?? null }));
  }

  public snapshot(botId: string): ReturnType<BotInstance['snapshot']> | null {
    return this.instances.get(botId)?.snapshot() ?? null;
  }

  public client(botId: string): MessagingClient | null {
    return this.instances.get(botId)?.messagingClient() ?? null;
  }

  public connectionManager(botId: string): ReturnType<BotInstance['connectionManager']> | null {
    return this.instances.get(botId)?.connectionManager() ?? null;
  }

  public aiQueue(botId: string): AIRequestQueueService | null {
    return this.instances.get(botId)?.aiRequestQueue() ?? null;
  }

  public resetTransientState(): void {
    for (const instance of this.instances.values()) instance.resetTransientState();
  }

  private recordInstanceFailure(operation: string, botId: string, error: unknown): void {
    const details = serializeError(error, operation, false);
    this.logger.error(
      { operation, botId, ...details },
      'Falló una instancia aislada; las demás continuarán',
    );
    this.database.recordTechnicalEvent({
      botId,
      eventType: operation,
      result: 'failed',
      errorCode: details.errorCode,
    });
  }

  private canPrepare(bot: BotRecord): boolean {
    return (
      bot.enabled &&
      bot.connectorType === 'WHATSAPP_CLOUD_API' &&
      !['ARCHIVED', 'PENDING_DELETION', 'DELETED', 'DUPLICATE_CONFIGURATION', 'DISABLED'].includes(
        bot.lifecycleStatus,
      )
    );
  }

  private canStart(bot: BotRecord): boolean {
    return this.canPrepare(bot) && this.metaConfiguration(bot.id).configured;
  }
}
