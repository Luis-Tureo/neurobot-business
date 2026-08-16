import type { Logger } from 'pino';
import type {
  AIProvider,
  AIProviderConnectionResult,
  AIProviderErrorCode,
  GroundedResponseRequest,
  GroundedResponseResult,
} from '../src/ai/ai-provider.js';
import { AssistantQueryService } from '../src/ai/assistant-query-service.js';
import { AppDatabase } from '../src/persistence/database.js';

class IdentifiedProvider implements AIProvider {
  public isConfigured(): boolean {
    return true;
  }

  public async testConnection(): Promise<AIProviderConnectionResult> {
    return { successful: true };
  }

  public async generateGroundedResponse(
    _request: GroundedResponseRequest,
  ): Promise<GroundedResponseResult> {
    return { text: 'Respuesta', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }

  public getModelInformation(): { provider: string; model: string } {
    return { provider: 'groq', model: 'openai/gpt-oss-120b' };
  }

  public normalizeUsage(): { inputTokens: number; outputTokens: number; totalTokens: number } {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  public classifyProviderError(): AIProviderErrorCode {
    return 'AI_TEMPORARY_ERROR';
  }
}

describe('enrutamiento seguro de consultas de IA', () => {
  it('registra proveedor, modelo y ruta sin incluir credenciales', async () => {
    const database = new AppDatabase(':memory:');
    database.migrate();
    const info = vi.fn();
    const logger = { info, error: vi.fn() } as unknown as Logger;
    const service = new AssistantQueryService(
      database,
      new IdentifiedProvider(),
      logger,
      'negocio-ejemplo',
    );

    await service.answerQuestion(
      '¿Cuánto es 2 + 2?',
      'conversation-hash',
      'customer-hash',
      new Date('2026-08-15T15:00:00.000Z'),
      undefined,
      'free_text_fallback',
    );

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'AI_QUERY_ROUTED',
        AI_PROVIDER: 'groq',
        AI_MODEL: 'openai/gpt-oss-120b',
        AI_ROUTE: 'free_text_fallback',
      }),
      expect.any(String),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('apiKey');
    database.close();
  });
});
