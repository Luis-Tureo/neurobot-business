import type { AppDatabase } from '../persistence/database.js';

export type CommercialPlan = 'BASIC' | 'ADVANCED';
export type MetaTemplateApprovalStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISABLED';

export type CommercialPlanConfiguration = {
  plan: CommercialPlan;
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
    return this.database.getSetting<CommercialPlanConfiguration>(settingKey(botId), {
      plan: 'BASIC',
      quoteReference: null,
      activatedAt: null,
      updatedAt: new Date(0).toISOString(),
      managedByProvider: true,
    });
  }

  public set(input: {
    botId: string;
    plan: CommercialPlan;
    quoteReference?: string | null;
    activatedAt?: string | null;
  }): CommercialPlanConfiguration {
    const current = this.get(input.botId);
    const now = new Date().toISOString();
    const quoteReference = normalizeQuoteReference(input.quoteReference);
    if (input.plan === 'ADVANCED' && quoteReference === null) {
      throw new Error(
        'El plan comercial avanzado requiere una referencia de presupuesto aprobado.',
      );
    }
    const configuration: CommercialPlanConfiguration = {
      plan: input.plan,
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
    this.database.setSetting(settingKey(input.botId), configuration);
    this.database.recordTechnicalEvent({
      botId: input.botId,
      eventType: 'COMMERCIAL_PLAN_UPDATED',
      result: configuration.plan.toLowerCase(),
    });
    return configuration;
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

function normalizeQuoteReference(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized === '') return null;
  if (normalized.length > 120) throw new Error('La referencia del presupuesto es demasiado larga.');
  return normalized;
}
