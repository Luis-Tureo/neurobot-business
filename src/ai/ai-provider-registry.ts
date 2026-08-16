import type { AIProviderId } from '../domain/types.js';

export type AIModelDescriptor = {
  id: string;
  label: string;
  recommended: boolean;
};

export type AIProviderDescriptor = {
  id: 'groq' | 'meta_business_agent';
  label: string;
  enabled: boolean;
  comingSoon: boolean;
  credentialMode: 'platform_managed';
  models: AIModelDescriptor[];
};

const GROQ_MODELS: ReadonlyArray<Omit<AIModelDescriptor, 'recommended'>> = [
  { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
  { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B' },
  { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B · Vista previa' },
];

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export class AIProviderRegistry {
  private readonly groqModels: AIModelDescriptor[];
  private readonly platformDefaultGroqModel: string;

  public constructor(configuredDefaultGroqModel = DEFAULT_GROQ_MODEL) {
    this.platformDefaultGroqModel = GROQ_MODELS.some(
      (model) => model.id === configuredDefaultGroqModel,
    )
      ? configuredDefaultGroqModel
      : DEFAULT_GROQ_MODEL;
    this.groqModels = GROQ_MODELS.map((model) => ({
      ...model,
      recommended: model.id === this.platformDefaultGroqModel,
    }));
  }

  public list(): AIProviderDescriptor[] {
    return [
      {
        id: 'groq',
        label: 'Groq',
        enabled: true,
        comingSoon: false,
        credentialMode: 'platform_managed',
        models: this.groqModels.map((model) => ({ ...model })),
      },
      {
        id: 'meta_business_agent',
        label: 'Meta Business Agent / Meta AI Agent',
        enabled: false,
        comingSoon: true,
        credentialMode: 'platform_managed',
        models: [],
      },
    ];
  }

  public defaultModel(provider: AIProviderId): string {
    return provider === 'groq' ? this.platformDefaultGroqModel : 'disabled';
  }

  public isAllowedModel(provider: AIProviderId, model: string): boolean {
    if (provider === 'disabled') return model === 'disabled';
    return this.groqModels.some((candidate) => candidate.id === model);
  }

  public requireAllowedModel(provider: AIProviderId, model: string): string {
    const normalized = model.trim();
    if (!this.isAllowedModel(provider, normalized)) {
      throw new Error('El modelo seleccionado no está habilitado para este proveedor.');
    }
    return normalized;
  }
}
