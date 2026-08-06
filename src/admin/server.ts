import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recommendedTemplateDrafts } from '../meta/template-library.js';
import type { TemplateBusinessUseCase } from '../meta/template-library.js';
import { buildAdminServer as buildAdminServerBase } from './server-base.js';

const commercialPlanRequestSchema = z
  .object({
    useCase: z.enum(['DELIVERY', 'APPOINTMENTS', 'GENERAL']),
  })
  .strict();

const commercialPlanQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/u)
      .optional(),
  })
  .strict();

type BaseAdminServerContext = Parameters<typeof buildAdminServerBase>[0];

export type CommercialPlanPricing = {
  advancedMonthlyPriceUsd: number;
  metaChargesIncluded: false;
  customerPaysMetaDirectly: true;
};

export type AdminServerContext = BaseAdminServerContext & {
  commercialPlanPricing?: CommercialPlanPricing;
};

export async function buildAdminServer(context: AdminServerContext): Promise<FastifyInstance> {
  const app = await buildAdminServerBase(context);
  registerCommercialPlanRoutes(app, context);
  return app;
}

function registerCommercialPlanRoutes(app: FastifyInstance, context: AdminServerContext): void {
  const pricing: CommercialPlanPricing = context.commercialPlanPricing ?? {
    advancedMonthlyPriceUsd: 50,
    metaChargesIncluded: false,
    customerPaysMetaDirectly: true,
  };

  app.get('/api/commercial-plan/options', async (request, reply) => {
    if (!(await requireExistingPanelSession(app, request, reply))) return;
    return {
      plans: [
        {
          id: 'BASIC',
          title: 'Plan básico',
          description:
            'Atención automática dentro de la ventana de 24 horas iniciada por el cliente.',
          monthlyPriceUsd: 0,
          metaChargesIncluded: false,
        },
        {
          id: 'ADVANCED',
          title: 'Comercio avanzado',
          description:
            'Plantillas y automatizaciones para entregas o agenda, activadas después de una cotización.',
          monthlyPriceUsd: pricing.advancedMonthlyPriceUsd,
          metaChargesIncluded: pricing.metaChargesIncluded,
        },
      ],
      useCases: [
        { id: 'DELIVERY', title: 'Reparto y entregas' },
        { id: 'APPOINTMENTS', title: 'Agenda de horas' },
        { id: 'GENERAL', title: 'Otro proceso comercial' },
      ],
      customerPaysMetaDirectly: pricing.customerPaysMetaDirectly,
      clientCanConfigureSpendingLimits: false,
    };
  });

  app.get('/api/bots/:botId/commercial-plan', async (request, reply) => {
    if (!(await requireExistingPanelSession(app, request, reply))) return;
    const botId = parseBotId(request.params);
    const bot = context.database.getBot(botId);
    if (bot === null) return reply.code(404).send({ error: 'Asistente no encontrado.' });
    const query = commercialPlanQuerySchema.parse(request.query ?? {});
    const planService = context.multiBotManager?.commercialPlanService();
    const ledger = context.multiBotManager?.metaBillingLedger();
    if (planService === undefined || ledger === undefined) {
      return reply.code(503).send({ error: 'El módulo comercial no está disponible.' });
    }
    const configuration = planService.get(botId);
    const useCase = configuration.requestedUseCase ?? inferUseCase(bot.organizationType);
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    const usage = await ledger.summarizeMonth(month);
    return {
      configuration: publicPlanConfiguration(configuration),
      pricing,
      usage,
      templates: recommendedTemplateDrafts(useCase).map((template) => ({
        ...template,
        status: configuration.plan === 'ADVANCED' ? 'DRAFT' : 'PREVIEW',
        enabled: configuration.plan === 'ADVANCED',
      })),
      policies: {
        serviceWindowHours: 24,
        freeFormOutsideWindowBlocked: true,
        templatesRequireAdvancedPlan: true,
        templatesRequireMetaApproval: true,
        clientCanConfigureSpendingLimits: false,
      },
    };
  });

  app.post('/api/bots/:botId/commercial-plan/request', async (request, reply) => {
    if (!(await requireExistingPanelSession(app, request, reply, true))) return;
    const botId = parseBotId(request.params);
    const bot = context.database.getBot(botId);
    if (bot === null) return reply.code(404).send({ error: 'Asistente no encontrado.' });
    const input = commercialPlanRequestSchema.parse(request.body);
    const service = context.multiBotManager?.commercialPlanService();
    if (service === undefined) {
      return reply.code(503).send({ error: 'El módulo comercial no está disponible.' });
    }
    const configuration = service.requestAdvanced({ botId, useCase: input.useCase });
    return reply.code(202).send({
      configuration: publicPlanConfiguration(configuration),
      message:
        'Solicitud registrada. El proveedor debe preparar y aprobar la cotización antes de activar el plan.',
    });
  });

  app.delete('/api/bots/:botId/commercial-plan/request', async (request, reply) => {
    if (!(await requireExistingPanelSession(app, request, reply, true))) return;
    const botId = parseBotId(request.params);
    const bot = context.database.getBot(botId);
    if (bot === null) return reply.code(404).send({ error: 'Asistente no encontrado.' });
    const service = context.multiBotManager?.commercialPlanService();
    if (service === undefined) {
      return reply.code(503).send({ error: 'El módulo comercial no está disponible.' });
    }
    try {
      const configuration = service.cancelAdvancedRequest(botId);
      return { configuration: publicPlanConfiguration(configuration) };
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : 'No se pudo cancelar la solicitud.',
      });
    }
  });
}

async function requireExistingPanelSession(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  requireCsrf = false,
): Promise<boolean> {
  const cookie = request.headers.cookie;
  const sessionResponse = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: cookie === undefined ? {} : { cookie },
  });
  if (sessionResponse.statusCode !== 200) {
    reply.code(401).send({ error: 'Debes iniciar sesión para continuar.' });
    return false;
  }
  if (!requireCsrf) return true;
  const session = sessionResponse.json() as { csrfToken?: unknown };
  const supplied = request.headers['x-csrf-token'];
  const csrfToken = Array.isArray(supplied) ? supplied[0] : supplied;
  if (typeof session.csrfToken !== 'string' || csrfToken !== session.csrfToken) {
    reply.code(403).send({ error: 'La validación de seguridad expiró. Actualiza la página.' });
    return false;
  }
  return true;
}

function parseBotId(params: unknown): string {
  const parsed = z
    .object({
      botId: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u),
    })
    .parse(params);
  return parsed.botId;
}

function publicPlanConfiguration(configuration: {
  plan: 'BASIC' | 'ADVANCED';
  requestedPlan: 'ADVANCED' | null;
  requestedUseCase: TemplateBusinessUseCase | null;
  requestStatus: 'NONE' | 'QUOTE_REQUIRED' | 'ACTIVE';
  requestedAt: string | null;
  quoteReference: string | null;
  activatedAt: string | null;
  updatedAt: string;
  managedByProvider: true;
}): Record<string, unknown> {
  return {
    plan: configuration.plan,
    requestedPlan: configuration.requestedPlan,
    requestedUseCase: configuration.requestedUseCase,
    requestStatus: configuration.requestStatus,
    requestedAt: configuration.requestedAt,
    quoteReferenceConfigured: configuration.quoteReference !== null,
    activatedAt: configuration.activatedAt,
    updatedAt: configuration.updatedAt,
    managedByProvider: true,
  };
}

function inferUseCase(organizationType: string): TemplateBusinessUseCase {
  const normalized = organizationType.toLocaleLowerCase('es-CL');
  if (/restaurante|tienda|distribuidora/u.test(normalized)) return 'DELIVERY';
  if (/servicio|salud|peluquer|consulta|clínica|clinica/u.test(normalized)) return 'APPOINTMENTS';
  return 'GENERAL';
}
