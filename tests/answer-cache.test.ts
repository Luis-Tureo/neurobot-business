import type {
  AIProvider,
  AIProviderConnectionResult,
  AIProviderErrorCode,
  GroundedResponseRequest,
  GroundedResponseResult,
} from '../src/ai/ai-provider.js';
import {
  AnswerCacheService,
  hashNormalizedQuestion,
  knowledgeVersion,
  normalizeQuestionForCache,
} from '../src/ai/answer-cache-service.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { AppDatabase } from '../src/persistence/database.js';

class CountingProvider implements AIProvider {
  public calls = 0;

  public isConfigured(): boolean {
    return true;
  }

  public async testConnection(): Promise<AIProviderConnectionResult> {
    return { successful: true };
  }

  public async generateGroundedResponse(
    _request: GroundedResponseRequest,
  ): Promise<GroundedResponseResult> {
    this.calls += 1;
    return {
      text: 'Respuesta oficial sintetizada para el negocio.',
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
    };
  }

  public getModelInformation(): { provider: string; model: string } {
    return { provider: 'fake', model: 'fake' };
  }

  public normalizeUsage(): { inputTokens: number; outputTokens: number; totalTokens: number } {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  public classifyProviderError(): AIProviderErrorCode {
    return 'AI_TEMPORARY_ERROR';
  }
}

describe('respuestas guardadas y cuotas privadas de IA', () => {
  let database: AppDatabase;
  let profileId: number;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
    profileId = database.getBotProfile('negocio-ejemplo').id;
  });

  afterEach(() => database.close());

  it('prioriza una FAQ administrativa sin llamar al proveedor', () => {
    addFaq('¿Cuál es el horario?', 'Atendemos de lunes a viernes.');
    const cache = new AnswerCacheService(database, createLogger('silent'), 'negocio-ejemplo');
    const found = cache.find(profileId, 'cual es el horario');
    expect(found).toMatchObject({
      kind: 'FAQ',
      answer: { answer: 'Atendemos de lunes a viernes.' },
    });
    expect(database.listCachedAnswers('negocio-ejemplo')[0]?.hitCount).toBe(1);
  });

  it('guarda respuestas generadas solo cuando son reutilizables y tienen fuentes', () => {
    const source = addKnowledge();
    const cache = new AnswerCacheService(database, createLogger('silent'), 'negocio-ejemplo');
    const saved = cache.saveGenerated(
      '¿Qué servicios ofrecen?',
      'Ofrecemos instalación y soporte técnico.',
      [
        {
          entryId: source.id,
          category: 'Servicios',
          title: source.title,
          content: source.content,
          keywords: source.keywords,
          internalSource: source.internalSource,
          relevance: source.priority,
          updatedAt: source.updatedAt,
        },
      ],
    );
    expect(saved).toMatchObject({ promptVersion: 'business-v1', status: 'AUTO_VERIFIED' });
    expect(cache.saveGenerated('Mi RUT es 12.345.678-9', 'Dato personal', [])).toBeNull();
  });

  it('invalida una respuesta cuando cambia su fuente de conocimiento', () => {
    const source = addKnowledge();
    database.saveCachedAnswer({
      botId: 'negocio-ejemplo',
      canonicalQuestion: 'Pregunta relacionada',
      normalizedQuestionHash: hashNormalizedQuestion('pregunta relacionada'),
      answer: 'Respuesta relacionada',
      category: 'Servicios',
      knowledgeSourceIds: [source.id],
      knowledgeVersion: knowledgeVersion([{ entryId: source.id, updatedAt: source.updatedAt }]),
      promptVersion: 'business-v1',
      status: 'ADMIN_APPROVED',
      sourceType: 'MANUAL',
      confidence: 1,
    });
    database.saveKnowledgeEntry({ ...source, content: 'Contenido actualizado y revisado.' });
    expect(database.listCachedAnswers('negocio-ejemplo')[0]?.status).toBe('INVALIDATED');
  });

  it('fusiona solicitudes idénticas en una única operación', async () => {
    const cache = new AnswerCacheService(database, createLogger('silent'), 'negocio-ejemplo');
    let release: () => void = () => undefined;
    const blocked = new Promise<string>((resolve) => {
      release = () => resolve('respuesta');
    });
    const first = cache.singleFlight('¿Cuánto cuesta?', () => blocked);
    const second = cache.singleFlight('cuanto cuesta', () => Promise.resolve('duplicada'));
    release();
    expect(await first).toEqual({ value: 'respuesta', coalesced: false });
    expect(await second).toEqual({ value: 'respuesta', coalesced: true });
  });

  it('aplica cuotas por persona, conversación y negocio', () => {
    const settings = database.getAISettings(profileId);
    database.saveAISettings({
      ...settings,
      userHourlyLimit: 2,
      userDailyLimit: 2,
      conversationHourlyLimit: 100,
      conversationDailyLimit: 100,
      globalDailyLimit: 100,
      globalMonthlyLimit: 100,
    });
    completeReservations([
      { userHash: 'same-user', conversationHash: 'conversation-1' },
      { userHash: 'same-user', conversationHash: 'conversation-2' },
    ]);
    expect(reserve('same-user', 'conversation-3')).toMatchObject({
      allowed: false,
      code: 'AI_LIMIT_USER_HOURLY_REACHED',
    });

    database.resetAIUsageForDevelopment(profileId);
    database.saveAISettings({
      ...database.getAISettings(profileId),
      userHourlyLimit: 100,
      userDailyLimit: 100,
      conversationHourlyLimit: 2,
      conversationDailyLimit: 2,
      globalDailyLimit: 100,
      globalMonthlyLimit: 100,
    });
    completeReservations([
      { userHash: 'user-1', conversationHash: 'same-conversation' },
      { userHash: 'user-2', conversationHash: 'same-conversation' },
    ]);
    expect(reserve('user-3', 'same-conversation')).toMatchObject({
      allowed: false,
      code: 'AI_LIMIT_CONVERSATION_HOURLY_REACHED',
    });

    database.resetAIUsageForDevelopment(profileId);
    database.saveAISettings({
      ...database.getAISettings(profileId),
      userHourlyLimit: 100,
      userDailyLimit: 100,
      conversationHourlyLimit: 100,
      conversationDailyLimit: 100,
      globalDailyLimit: 2,
      globalMonthlyLimit: 100,
    });
    completeReservations([
      { userHash: 'user-1', conversationHash: 'conversation-1' },
      { userHash: 'user-2', conversationHash: 'conversation-2' },
    ]);
    expect(reserve('user-3', 'conversation-3')).toMatchObject({
      allowed: false,
      code: 'AI_LIMIT_DAILY_REACHED',
    });
  });

  it('restablece contadores sin borrar caché, conocimiento ni configuración', () => {
    const knowledgeCount = database.listKnowledgeEntries(profileId).length;
    addFaq('Pregunta persistente', 'Respuesta persistente');
    completeReservations([{ userHash: 'user', conversationHash: 'conversation' }]);

    database.resetAIUsageForDevelopment(profileId);

    expect(database.listCachedAnswers('negocio-ejemplo')).toHaveLength(1);
    expect(database.listKnowledgeEntries(profileId)).toHaveLength(knowledgeCount);
    expect(database.getAISettings(profileId).userHourlyLimit).toBe(20);
    expect(database.getAIUsageSummary(profileId, '2026-08-03', '2026-08').requests).toBe(0);
  });

  function addFaq(question: string, answer: string) {
    return database.saveCachedAnswer({
      botId: 'negocio-ejemplo',
      canonicalQuestion: question,
      normalizedQuestionHash: hashNormalizedQuestion(normalizeQuestionForCache(question)),
      answer,
      category: 'FAQ',
      knowledgeSourceIds: [],
      knowledgeVersion: '',
      promptVersion: 'admin-v1',
      status: 'ADMIN_APPROVED',
      sourceType: 'ADMIN_FAQ',
      confidence: 1,
    });
  }

  function addKnowledge() {
    const category = database.listKnowledgeCategories(profileId)[0];
    if (category === undefined) throw new Error('Falta la categoría de prueba.');
    return database.saveKnowledgeEntry({
      id: 0,
      profileId,
      categoryId: category.id,
      title: 'Servicios disponibles',
      content: 'El negocio ofrece instalación y soporte técnico.',
      keywords: ['servicios', 'soporte'],
      synonyms: [],
      enabled: true,
      priority: 100,
      internalSource: 'Documento oficial revisado',
    });
  }

  function reserve(userHash: string, conversationHash: string) {
    return database.reserveAIUsage({
      botId: 'negocio-ejemplo',
      profileId,
      userHash,
      conversationHash,
      localDate: '2026-08-03',
      localMonth: '2026-08',
      hourBucket: '2026-08-03T01',
      estimatedInputTokens: 10,
      reservedOutputTokens: 10,
      now: new Date('2026-08-03T01:00:00Z'),
    });
  }

  function completeReservations(
    identities: Array<{ userHash: string; conversationHash: string }>,
  ): void {
    for (const identity of identities) {
      const decision = reserve(identity.userHash, identity.conversationHash);
      if (!decision.allowed) throw new Error(`Reserva rechazada: ${decision.code}`);
      database.completeAIUsageReservation(
        decision.reservation.id,
        { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        'success',
        null,
        '2026-08-03T01',
      );
    }
  }
});

void CountingProvider;
