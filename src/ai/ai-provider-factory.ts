import type { AppDatabase } from '../persistence/database.js';
import type {
  AIProvider,
  AIProviderConnectionResult,
  AIProviderErrorCode,
  GroundedResponseRequest,
  GroundedResponseResult,
} from './ai-provider.js';
import { AIProviderRegistry, type AIProviderDescriptor } from './ai-provider-registry.js';
import { DisabledAIProvider } from './disabled-ai-provider.js';
import { GroqAIProvider } from './groq-ai-provider.js';

export class AIProviderFactory {
  private readonly registry: AIProviderRegistry;

  public constructor(
    private readonly database: AppDatabase,
    private readonly globalApiKey: string | undefined,
    private readonly model: string,
    private readonly providerName: 'groq' | 'disabled',
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.registry = new AIProviderRegistry(model);
  }

  public forBot(botId: string): AIProvider {
    return new ScopedBotAIProvider(() => this.resolve(botId));
  }

  public catalog(): AIProviderDescriptor[] {
    return this.registry.list();
  }

  public defaultModel(): string {
    return this.registry.defaultModel('groq');
  }

  public isSelectionValid(provider: 'groq' | 'disabled', model: string): boolean {
    return this.registry.isAllowedModel(provider, model);
  }

  private resolve(botId: string): AIProvider {
    const bot = this.database.getBot(botId);
    if (bot === null) return new DisabledAIProvider();
    const settings = this.database.getAISettings(bot.profileId);
    if (
      this.providerName === 'disabled' ||
      settings.provider === 'disabled' ||
      !this.registry.isAllowedModel(settings.provider, settings.model)
    ) {
      return new DisabledAIProvider();
    }
    return new GroqAIProvider(this.globalApiKey, settings.model, this.fetchImplementation);
  }
}

class ScopedBotAIProvider implements AIProvider {
  public constructor(private readonly resolve: () => AIProvider) {}

  public isConfigured(): boolean {
    return this.resolve().isConfigured();
  }

  public testConnection(timeoutMs?: number): Promise<AIProviderConnectionResult> {
    return this.resolve().testConnection(timeoutMs);
  }

  public generateGroundedResponse(
    request: GroundedResponseRequest,
  ): Promise<GroundedResponseResult> {
    return this.resolve().generateGroundedResponse(request);
  }

  public getModelInformation(): { provider: string; model: string } {
    return this.resolve().getModelInformation();
  }

  public normalizeUsage(value: unknown): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } {
    return this.resolve().normalizeUsage(value);
  }

  public classifyProviderError(error: unknown): AIProviderErrorCode {
    return this.resolve().classifyProviderError(error);
  }
}
