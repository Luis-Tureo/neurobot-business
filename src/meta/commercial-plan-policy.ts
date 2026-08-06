import type { AppDatabase } from '../persistence/database.js';
import type { TemplateBusinessUseCase } from './template-library.js';

export type CommercialPlan = 'BASIC' | 'ADVANCED';
export type CommercialPlanRequestStatus = 'NONE' | 'QUOTE_REQUIRED' | 'ACTIVE';
export type MetaTemplateApprovalStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISABLED';

export type CommercialPlanConfiguration = {
  plan: CommercialPlan;
  requestedPlan: 'ADVANCED' | null;
  requestedUseCase: TemplateBusinessUseCase | null;
  requestStatus: CommercialPlanRequestStatus;
  requestedAt: string | null;
  quoteReference: string | null;
  activatedAt: string | null;
  updatedAt: string;
  managedByProvider: true;
};

export type MessagingPolicyErrorCode =
  | 'META_SERVICE_WINDOW_CLOSED'
  | 'ADVANCED_PLAN_REQUIRED'
  | 'META_TEMPLATE_NOT_APPROVED';

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class MessagingPolicyError extends Error {
  public constructor(
    public readonly code: MessagingPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MessagingPolicyError';
  }
}

export class CommercialPlanService {
  public constructor(private readonly database: AppDatabase) {}

  public get(botId: string): CommercialPlanConfiguration {
    const stored = this.database.getSetting<Partial<CommercialPlanConfiguration>>(
      settingKey(botId),
      {},
    );
    const plan = stored.plan === 'ADVANCED' ? 'ADVANCED' : 'BASIC';
    const requestedUseCase = isUseCase(stored.requestedUseCase)
      ? stored.requestedUseCase
      : null;
    const requestedPlan = stored.requestedPlan === 'ADVANCED' ? 'ADVANCED' : null;
    const quoteReference = normalizeQuoteReference(stored.quoteReference);
    const activatedAt = normalizeDate(stored.activatedAt);
    const requestedAt = normalizeDate(stored.requestedAt);
    return {
      plan,
      requestedPlan: plan === 'ADVANCED' ? null : requestedPlan,
      requestedUseCase,
      requestStatus:
        plan === 'ADVANCED'
          ? 'ACTIVE'
          : requestedPlan === 'ADVANCED'
            ? 'QUOTE_REQUIRED'
            : 'NONE',
      requestedAt,
      quoteReference: plan === 'ADVANCED' ? quoteReference : null,
      activatedAt: plan === 'ADVANCED' ? activatedAt : null,
      updatedAt: normalizeDate(stored.updatedAt) ?? new Date(0).toISOString(),
      managedByProvider: true,
    };
  }

  public requestAdvanced(input: {
    botId: string;
    useCase: TemplateBusinessUseCase;
  }): CommercialPlanConfiguration {
    const current = this.get(input.botId);
    if (current.plan === 'ADVANCED') return current;
    const now = new Date().toISOString();
    const configuration: CommercialPlanConfiguration = {
      plan: 'BASIC',
      requestedPlan: 'ADVANCED',
      requestedUseCase: input.useCase,
      requestStatus: 'QUOTE_REQUIRED',
      requestedAt: now,
      quoteReference: null,
      activatedAt: null,
      updatedAt: now,
      managedByProvider: true,
    };
    this.persist(input.botId, configuration);
    this.database.recordTechnicalEvent({
      botId: input.botId,
      eventType: 'ADVANCED_PLAN_QUOTE_REQUESTED',
      result: input.useCase.toLowerCase(),
    });
    return configuration;
  }

  public cancelAdvancedRequest(botId: string): CommercialPlanConfiguration {
    const current = this.get(botId);
    if (current.plan === 'ADVANCED') {
      throw new Error('El plan avanzado activo debe ser modificado por el proveedor.');
    }
    const configuration: CommercialPlanConfiguration = {
      ...current,
      requestedPlan: null,
      requestedUseCase: null,
      requestStatus: 'NONE',
      requestedAt: null,
      updatedAt: new Date().toISOString(),
    };
    this.persist(botId, configuration);
    this.database.recordTechnicalEvent({
      botId,
      eventType: 'ADVANCED_PLAN_QUOTE_REQUEST_CANCELLED',
      result: 'cancelled',
    });
    return configuration;
  }

  public set(input: {
    botId: string;
    plan: CommercialPlan;
    quoteReference?: string | null;
    activatedAt?: string | null;
    useCase?: TemplateBusinessUseCase | null;
  }): CommercialPlanConfiguration {
    const current = this.get(input.botId);
    const now = new Date().toISOString();
    const quoteReference = normalizeQuoteReference(input.quoteReference);
    if (input.plan === 'ADVANCED' && quoteReference === null) {
      throw new Error(
        'El plan comercial avanzado requiere una referencia de presupuesto aprobado.',
      );
    }
    const useCase = input.useCase === undefined ? current.requestedUseCase : input.useCase;
    const configuration: CommercialPlanConfiguration = {
      plan: input.plan,
      requestedPlan: input.plan === 'ADVANCED' ? null : current.requestedPlan,
      requestedUseCase: useCase ?? null,
      requestStatus:
        input.plan === 'ADVANCED'
          ? 'ACTIVE'
          : current.requestedPlan === 'ADVANCED'
            ? 'QUOTE_REQUIRED'
            : 'NONE',
      requestedAt: input.plan === 'ADVANCED' ? current.requestedAt : current.requestedAt,
      quoteReference: input.plan === 'ADVANCED' ? quoteReference : null,
      activatedAt:
        input.activatedAt === undefined
          ? input.plan === 'ADVANCED'
            ? current.plan === 'ADVANCED'
              ? current.activatedAt ?? now
              : now
            : null
          : input.activatedAt,
      updatedAt: now,
      managedByProvider: true,
    };
    this.persist(input.botId, configuration);
    this.database.recordTechnicalEvent({
      botId: input.botId,
      eventType: 'COMMERCIAL_PLAN_UPDATED',
      result: configuration.plan.toLowerCase(),
    });
    return configuration;
  }

  private persist(botId: string, configuration: CommercialPlanConfiguration): void {
    this.database.setSetting(settingKey(botId), configuration);
  }
}

export class CommercialMessagingPolicy {
  private readonly lastCustomerMessageAt = new Map<string, number>();

  public constructor(
    private readonly plan: () => CommercialPlan,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public recordCustomerMessage(customerId: string, timestampMs = this.now()): void {
    this.lastCustomerMessageAt.set(customerId, timestampMs);
  }

  public serviceWindowExpiresAt(customerId: string): Date | null {
    const lastMessageAt = this.lastCustomerMessageAt.get(customerId);
    return lastMessageAt === undefined ? null : new Date(lastMessageAt + SERVICE_WINDOW_MS);
  }

  public isServiceWindowOpen(customerId: string, atMs = this.now()): boolean {
    const lastMessageAt = this.lastCustomerMessageAt.get(customerId);
    if (lastMessageAt === undefined) return false;
    return atMs >= lastMessageAt && atMs - lastMessageAt < SERVICE_WINDOW_MS;
  }

  public assertFreeFormMessageAllowed(customerId: string): void {
    if (this.isServiceWindowOpen(customerId)) return;
    throw new MessagingPolicyError(
      'META_SERVICE_WINDOW_CLOSED',
      'La ventana gratuita de 24 horas está cerrada. Se bloqueó el mensaje para evitar un envío no permitido.',
    );
  }

  public assertTemplateMessageAllowed(status: MetaTemplateApprovalStatus): void {
    if (this.plan() !== 'ADVANCED') {
      throw new MessagingPolicyError(
        'ADVANCED_PLAN_REQUIRED',
        'Las plantillas comerciales solo están disponibles en el plan avanzado contratado.',
      );
    }
    if (status !== 'APPROVED') {
      throw new MessagingPolicyError(
        'META_TEMPLATE_NOT_APPROVED',
        'Meta todavía no ha aprobado esta plantilla.',
      );
    }
  }
}

function settingKey(botId: string): string {
  return `commercial_plan:${botId}`;
}

function normalizeQuoteReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized === '') return null;
  if (normalized.length > 120) throw new Error('La referencia del presupuesto es demasiado larga.');
  return normalized;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function isUseCase(value: unknown): value is TemplateBusinessUseCase {
  return value === 'DELIVERY' || value === 'APPOINTMENTS' || value === 'GENERAL';
}
