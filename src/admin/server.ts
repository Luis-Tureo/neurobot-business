import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AIProviderFactory } from '../ai/ai-provider-factory.js';
import { AIProviderRegistry } from '../ai/ai-provider-registry.js';
import { hashNormalizedQuestion, normalizeQuestionForCache } from '../ai/answer-cache-service.js';
import { CatalogService } from '../core/catalog-service.js';
import { ActionRegistry } from '../core/action-registry.js';
import { calculateAssistantReadiness } from '../core/assistant-readiness-service.js';
import { ToolRegistry } from '../core/tool-registry.js';
import {
  AssistantModuleVisibilityService,
  type AssistantModuleKey,
} from '../core/assistant-module-visibility-service.js';
import { InteractiveMessageAdapter } from '../core/interactive-message-adapter.js';
import {
  MaintenanceAlreadyRunningError,
  type MaintenanceService,
} from '../core/maintenance-service.js';
import type { MultiBotManager } from '../core/multi-bot-manager.js';
import { createProfileFromPreset, PROFILE_PRESETS } from '../core/profile-presets.js';
import {
  LEGACY_ORGANIZATION_TYPE_ALIASES,
  ORGANIZATION_TYPE_OPTIONS,
  ORGANIZATION_TYPES,
} from '../domain/organization-types.js';
import { serializeError } from '../infrastructure/safe-error.js';
import {
  isValidMetaWebhookPayload,
  parseMetaWebhookEvents,
  secureTokenMatches,
  verifyMetaWebhookSignature,
} from '../messaging/whatsapp-cloud-api-adapter.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { maskPhoneNumber, normalizeBotIdentifier, normalizePhoneNumber } from '../utils/text.js';
import { LoginAttemptGate, SessionStore, type PanelSession } from './session-store.js';

const COOKIE_NAME = 'panel_session';

const organizationTypeSchema = z.enum(ORGANIZATION_TYPES);

const profileFieldsSchema = z
  .object({
    internalName: z.string().trim().min(1).max(120),
    organizationName: z.string().trim().min(1).max(160),
    botName: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(1000),
    organizationType: organizationTypeSchema,
    industry: z.string().trim().min(1).max(160),
    objective: z.string().trim().min(1).max(1200),
    allowedTopics: z.array(z.string().trim().min(1).max(180)).max(30),
    excludedTopics: z.array(z.string().trim().min(1).max(180)).max(30),
    tone: z.string().trim().min(1).max(300),
    outOfScopeMessage: z.string().trim().min(1).max(600),
    noInformationMessage: z.string().trim().min(1).max(600),
    limitMessage: z.string().trim().min(1).max(600),
    aiErrorMessage: z.string().trim().min(1).max(600),
    medicalMessage: z.string().trim().min(1).max(600),
    contactInformation: z.string().trim().max(1000),
    businessHours: z.string().trim().max(1000),
    address: z.string().trim().max(500).nullable(),
    logoPath: z.string().trim().max(200).nullable(),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
    secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
    timezone: z.string().trim().min(1).max(80),
    applicationName: z.string().trim().min(1).max(120),
    headerText: z.string().trim().min(1).max(160),
    footerText: z.string().trim().max(300),
    supportInformation: z.string().trim().max(500),
  })
  .strict();

const profileUpdateSchema = profileFieldsSchema.extend({
  language: z
    .string()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u)
    .optional(),
});

const knowledgeCategorySchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
  })
  .strict();

const knowledgeEntrySchema = z
  .object({
    id: z.number().int().positive().optional(),
    categoryId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(8000),
    keywords: z.array(z.string().trim().min(1).max(180)).max(50),
    synonyms: z.array(z.string().trim().min(1).max(180)).max(50),
    enabled: z.boolean(),
    priority: z.number().int().min(-100).max(100),
    internalSource: z.string().trim().max(300).nullable(),
  })
  .strict();

const aiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['groq', 'disabled']),
    model: z.string().trim().min(2).max(120),
    providerConfig: z
      .object({ model: z.string().trim().min(2).max(120).optional() })
      .strict()
      .optional(),
    questionMaxChars: z.number().int().min(1).max(3000),
    contextMaxTokens: z.number().int().min(1).max(7000),
    inputMaxTokens: z.number().int().min(1).max(10_000),
    responseMaxTokens: z.number().int().min(1).max(1200),
    responseMaxChars: z.number().int().min(1).max(6000),
    responseMaxLines: z.number().int().min(1).max(50),
    temperature: z.number().min(0).max(1),
    userHourlyLimit: z.number().int().min(1).max(500),
    userDailyLimit: z.number().int().min(1).max(1000),
    userCooldownSeconds: z.number().int().min(0).max(3600),
    interactionHourlyLimit: z.number().int().min(1).max(5000),
    interactionCooldownSeconds: z.number().int().min(0).max(3600),
    duplicateQueryWindowSeconds: z.number().int().min(0).max(3600),
    conversationHourlyLimit: z.number().int().min(1).max(2000),
    conversationDailyLimit: z.number().int().min(1).max(10_000),
    globalDailyLimit: z.number().int().min(1).max(100_000),
    globalMonthlyLimit: z.number().int().min(1).max(1_000_000),
    globalDailyTokenLimit: z.number().int().min(1).max(100_000_000),
    globalMonthlyTokenLimit: z.number().int().min(1).max(1_000_000_000),
    timeoutMs: z.number().int().min(1000).max(60_000),
    confirmIncreasedLimits: z.boolean().default(false),
  })
  .strict();

const cachedAnswerCreateSchema = z
  .object({
    canonicalQuestion: z.string().trim().min(1).max(1000),
    answer: z.string().trim().min(1).max(8000),
    category: z.string().trim().min(1).max(200),
    sourceType: z.enum(['ADMIN_FAQ', 'MANUAL']).default('ADMIN_FAQ'),
    variants: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  })
  .strict();

const cachedAnswerActionSchema = z
  .object({
    action: z.enum([
      'approve',
      'edit',
      'disable',
      'invalidate',
      'convert_faq',
      'add_variant',
      'regenerate',
      'view_sources',
    ]),
    answer: z.string().trim().min(1).max(8000).optional(),
    category: z.string().trim().min(1).max(200).optional(),
    variant: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

const resetCountersSchema = z
  .object({
    password: z.string().min(1).max(200),
    confirmation: z.literal('RESTABLECER CONTADORES'),
  })
  .strict();

const trashAssistantSchema = z
  .object({
    password: z.string().min(1).max(200),
    confirmationName: z.string().trim().min(1).max(160),
  })
  .strict();

const restoreAssistantSchema = z.object({ confirmed: z.literal(true) }).strict();

const permanentlyDeleteAssistantSchema = z
  .object({
    password: z.string().min(1).max(200),
    confirmationPhrase: z.string().trim().min(1).max(240),
  })
  .strict();

const panelEventSchema = z
  .object({
    eventType: z.enum([
      'GLOBAL_PANEL_OPENED',
      'ASSISTANT_ADMIN_OPENED',
      'ASSISTANT_CONTEXT_CHANGED',
    ]),
    assistantId: z
      .string()
      .regex(/^[a-z][a-z0-9-]{2,39}$/u)
      .optional(),
  })
  .strict();

const globalAILimitsSchema = z
  .object({
    dailyRequestLimit: z.number().int().min(1).max(100_000),
    monthlyRequestLimit: z.number().int().min(1).max(1_000_000),
    dailyTokenLimit: z.number().int().min(1).max(100_000_000),
    monthlyTokenLimit: z.number().int().min(1).max(1_000_000_000),
  })
  .strict();

const botCreateSchema = z
  .object({
    id: z
      .preprocess(
        (value) => (typeof value === 'string' ? normalizeBotIdentifier(value) : value),
        z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u),
      )
      .optional(),
    organizationName: z.string().trim().min(1).max(160),
    botName: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(1000),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u),
    organizationType: organizationTypeSchema,
    timezone: z.string().trim().min(1).max(80),
    connectorType: z.literal('WHATSAPP_CLOUD_API'),
    whatsappSetupMode: z.enum(['EXISTING', 'NEW_CUSTOMER']),
    provider: z.literal('groq'),
    model: z.string().trim().min(2).max(120),
    behavior: z
      .object({
        showInitialMenuOnGreeting: z.boolean(),
        allowFreeQuestions: z.boolean(),
        useAIForUnmatched: z.boolean(),
        useBusinessKnowledge: z.boolean(),
        allowDynamicButtons: z.boolean().default(true),
        allowDynamicLists: z.boolean().default(true),
        allowBusinessDataQueries: z.boolean().default(true),
        showAISuggestedActions: z.boolean().default(true),
        allowWriteTools: z.boolean().default(false),
        fallbackMessage: z.string().trim().min(1).max(600),
      })
      .strict(),
    preset: z.enum(['store', 'restaurant', 'service', 'empty']),
    menuType: z
      .enum(['automatic', 'native_buttons', 'native_list', 'numbered'])
      .default('automatic'),
  })
  .strict();

const assistantBehaviorSchema = z
  .object({
    showInitialMenuOnGreeting: z.boolean(),
    allowFreeQuestions: z.boolean(),
    useAIForUnmatched: z.boolean(),
    useBusinessKnowledge: z.boolean(),
    allowDynamicButtons: z.boolean().default(true),
    allowDynamicLists: z.boolean().default(true),
    allowBusinessDataQueries: z.boolean().default(true),
    showAISuggestedActions: z.boolean().default(true),
    allowWriteTools: z.boolean().default(false),
    fallbackMessage: z.string().trim().min(1).max(600),
    humanHandoffReady: z.boolean().default(false),
  })
  .strict();

const whatsappSetupSchema = z.object({ setupMode: z.enum(['EXISTING', 'NEW_CUSTOMER']) }).strict();

const toolConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    permissions: z
      .array(z.enum(['READ', 'SUGGEST', 'EXECUTE']))
      .min(1)
      .max(3),
  })
  .strict();

const dynamicInteractionSettingsSchema = z
  .object({
    allowDynamicButtons: z.boolean(),
    allowDynamicLists: z.boolean(),
    allowBusinessDataQueries: z.boolean(),
    showAISuggestedActions: z.boolean(),
    allowWriteTools: z.boolean(),
  })
  .strict();

const assistantSimulationSchema = z
  .object({ message: z.string().trim().min(1).max(2000) })
  .strict();

const botConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    continuedConversationsEnabled: z.boolean(),
    menuType: z.enum(['automatic', 'native_buttons', 'native_list', 'numbered']),
  })
  .strict();

const menuSchema = z
  .object({
    id: z.number().int().positive().optional(),
    parentMenuId: z.number().int().positive().nullable(),
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(600),
    helpText: z.string().trim().max(300),
    presentation: z.enum(['AUTOMATIC', 'BUTTONS', 'LIST']).default('AUTOMATIC'),
    listButtonLabel: z.string().trim().min(1).max(20).default('Ver opciones'),
    enabled: z.boolean(),
    isInitial: z.boolean(),
    expirationMinutes: z.number().int().min(1).max(1440),
  })
  .strict();

const menuOptionSchema = z
  .object({
    id: z.number().int().positive().optional(),
    menuId: z.number().int().positive(),
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().max(72).default(''),
    section: z.string().trim().max(24).default(''),
    aliases: z.array(z.string().trim().min(1).max(100)).max(20),
    order: z.number().int().min(1).max(100),
    actionType: z.enum([
      'text',
      'catalog_item',
      'catalog_category',
      'media',
      'submenu',
      'knowledge',
      'ai',
      'hours',
      'address',
      'payments',
      'shipping',
      'human_assistance',
      'reservation_request',
      'back',
      'exit',
    ]),
    actionPayload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    enabled: z.boolean(),
  })
  .strict();

const catalogCategorySchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(600),
    enabled: z.boolean(),
  })
  .strict();

const catalogItemSchema = z
  .object({
    id: z.number().int().nonnegative().default(0),
    categoryId: z.number().int().positive().nullable(),
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1200),
    priceAmount: z.number().int().min(0).nullable(),
    offerPriceAmount: z.number().int().min(0).nullable(),
    currency: z.string().trim().min(3).max(8),
    presentation: z.string().trim().max(200),
    size: z.string().trim().max(100),
    variants: z.array(z.string().trim().min(1).max(180)).max(50),
    availability: z.string().trim().max(300),
    informedStock: z.number().int().min(0).nullable(),
    primaryMediaId: z.number().int().positive().nullable(),
    authorizedLink: z.string().url().startsWith('https://').nullable(),
    enabled: z.boolean(),
  })
  .strict();

const businessHourSchema = z
  .object({
    weekday: z.number().int().min(0).max(6).nullable(),
    localDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    openingTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
      .nullable(),
    closingTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
      .nullable(),
    closed: z.boolean(),
    label: z.string().trim().max(160),
  })
  .strict();

const manualBotTestSchema = z
  .object({
    kind: z.enum(['menu', 'catalog_item', 'media']),
    recipient: z.string().trim().min(8).max(24),
    resourceId: z.number().int().positive().optional(),
    confirmed: z.literal(true),
  })
  .strict();

const loginSchema = z.object({
  username: z.string().trim().min(1).max(50).default('admin'),
  password: z.string().min(1).max(128),
});

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => utcDateBoundary(value) !== null, 'La fecha no es válida.');

const conversationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(20),
    search: z.string().trim().max(120).optional(),
    assistantId: z.string().trim().min(1).max(120).optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .strict();

const conversationMessagesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(50),
  })
  .strict();

const aiQueueSettingsSchema = z
  .object({
    maxConcurrent: z.number().int().min(1).max(10),
    maxQueueSize: z.number().int().min(1).max(100),
    maxQueueWaitSeconds: z.number().int().min(5).max(300),
    providerTimeoutSeconds: z.number().int().min(5).max(60),
    maxRetries: z.number().int().min(0).max(5),
    initialRetryDelaySeconds: z.number().int().min(1).max(30),
    maximumRetryDelaySeconds: z.number().int().min(1).max(60),
    waitNoticeSeconds: z.number().int().min(1).max(60),
    userCooldownSeconds: z.number().int().min(0).max(300),
    duplicateWindowSeconds: z.number().int().min(0).max(300),
    singleFlightWindowSeconds: z.number().int().min(1).max(300),
    outboundMessageIntervalMs: z.number().int().min(0).max(10_000),
    suggestedRetrySeconds: z.number().int().min(5).max(600),
  })
  .strict();

const aiQueueSimulationSchema = z
  .object({
    requests: z.number().int().min(1).max(30),
    scenario: z.enum(['normal', 'repeated', 'rate_limited', 'timeout']),
  })
  .strict();

const factoryResetSchema = z
  .object({
    confirmation: z.string().max(40),
    currentPassword: z.string().min(1).max(128),
    understood: z.boolean(),
    passwordChoice: z.enum(['keep', 'replace']),
    newPassword: z.string().min(12).max(128).optional(),
    newPasswordConfirmation: z.string().min(12).max(128).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.passwordChoice !== 'replace') return;
    if (value.newPassword === undefined || value.newPassword !== value.newPasswordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['newPasswordConfirmation'],
        message: 'La nueva contraseña y su confirmación deben coincidir.',
      });
    }
  });

export type AdminServerContext = {
  database: AppDatabase;
  anonymizer: Anonymizer;
  logger: Logger;
  sessionSecret: string;
  applicationVersion: string;
  developmentMode: boolean;
  publicDirectory?: string;
  maintenance?: MaintenanceService;
  brandingDirectory?: string;
  multiBotManager?: MultiBotManager;
  aiProviderFactory?: AIProviderFactory;
  mediaDirectory?: string;
  metaWebhook?: {
    appSecret?: string;
    verifyToken?: string;
  };
  metaWebhookProcessor?: {
    ingestMetaWebhook(
      phoneNumberId: string,
      payload: unknown,
      acceptedEventIds: ReadonlySet<string>,
    ): Promise<{ messages: number; statuses: number; unsupportedMessages: number }>;
  };
};

export async function buildAdminServer(context: AdminServerContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 600 * 1024, trustProxy: '127.0.0.1' });
  const rawJsonBodies = new WeakMap<object, Buffer>();
  const webhookTasks = new Set<Promise<void>>();
  const sessions = new SessionStore(context.sessionSecret);
  const loginGate = new LoginAttemptGate();
  const maintenanceGate = new LoginAttemptGate(3, 15 * 60 * 1000, 15 * 60 * 1000);
  const moduleVisibility = new AssistantModuleVisibilityService();

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    rawJsonBodies.set(request, rawBody);
    try {
      done(null, JSON.parse(rawBody.toString('utf8')) as unknown);
    } catch (error) {
      done(error instanceof Error ? error : new Error('El cuerpo JSON no es válido.'), undefined);
    }
  });

  app.addHook('onClose', async () => {
    await Promise.allSettled([...webhookTasks]);
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  const publicDirectory = context.publicDirectory ?? resolve(process.cwd(), 'public');
  await app.register(fastifyStatic, {
    root: publicDirectory,
    prefix: '/',
    setHeaders(response, filePath) {
      if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
        response.header('Cache-Control', 'no-store, max-age=0');
      }
    },
  });

  app.get('/privacy', async (_request, reply) =>
    reply
      .header('Cache-Control', 'public, max-age=300')
      .type('text/html; charset=utf-8')
      .sendFile('privacy.html'),
  );

  app.get('/terms', async (_request, reply) =>
    reply
      .header('Cache-Control', 'public, max-age=300')
      .type('text/html; charset=utf-8')
      .sendFile('terms.html'),
  );

  app.get('/data-deletion', async (_request, reply) =>
    reply
      .header('Cache-Control', 'public, max-age=300')
      .type('text/html; charset=utf-8')
      .sendFile('data-deletion.html'),
  );

  app.get('/api/webhooks/meta/whatsapp', async (request, reply) => {
    const query = z
      .object({
        'hub.mode': z.string(),
        'hub.verify_token': z.string(),
        'hub.challenge': z.string(),
      })
      .passthrough()
      .safeParse(request.query);
    if (
      !query.success ||
      query.data['hub.mode'] !== 'subscribe' ||
      !secureTokenMatches(context.metaWebhook?.verifyToken, query.data['hub.verify_token'])
    ) {
      return reply.code(403).type('text/plain').send('Forbidden');
    }
    return reply.code(200).type('text/plain').send(query.data['hub.challenge']);
  });

  app.post('/api/webhooks/meta/whatsapp', async (request, reply) => {
    const webhookProcessor = context.metaWebhookProcessor ?? context.multiBotManager;
    if (context.metaWebhook?.appSecret === undefined || webhookProcessor === undefined) {
      return reply.code(503).send({
        error: 'El webhook de Meta no está configurado.',
        code: 'META_WEBHOOK_NOT_CONFIGURED',
      });
    }
    const rawBody = rawJsonBodies.get(request);
    const signatureHeader = request.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (
      rawBody === undefined ||
      !verifyMetaWebhookSignature(rawBody, signature, context.metaWebhook.appSecret)
    ) {
      context.logger.warn(
        { operation: 'META_WEBHOOK_SIGNATURE_REJECTED' },
        'Se rechazó un webhook de Meta con firma inválida',
      );
      return reply.code(401).send({ error: 'Firma inválida.', code: 'INVALID_META_SIGNATURE' });
    }
    if (!isValidMetaWebhookPayload(request.body)) {
      return reply
        .code(400)
        .send({ error: 'Payload de Meta inválido.', code: 'INVALID_META_WEBHOOK_PAYLOAD' });
    }

    const events = parseMetaWebhookEvents(request.body);
    const acceptedByPhone = new Map<string, Set<string>>();
    for (const event of events) {
      const accepted = context.database.claimMetaWebhookEvent(event);
      if (!accepted) continue;
      const eventIds = acceptedByPhone.get(event.phoneNumberId) ?? new Set<string>();
      eventIds.add(event.eventId);
      acceptedByPhone.set(event.phoneNumberId, eventIds);
    }

    if (acceptedByPhone.size > 0) {
      const payload = request.body;
      const manager = webhookProcessor;
      const task = new Promise<void>((resolveTask) => {
        setImmediate(() => {
          void (async () => {
            for (const [phoneNumberId, eventIds] of acceptedByPhone) {
              try {
                await manager.ingestMetaWebhook(phoneNumberId, payload, eventIds);
                context.database.finishMetaWebhookEvents([...eventIds], { status: 'PROCESSED' });
              } catch (error) {
                const details = serializeError(error, 'META_WEBHOOK_PROCESSING_FAILED', false);
                context.database.finishMetaWebhookEvents([...eventIds], {
                  status: 'FAILED',
                  errorCode: details.errorCode,
                });
                context.logger.error(
                  {
                    operation: 'META_WEBHOOK_PROCESSING_FAILED',
                    errorCode: details.errorCode,
                    eventCount: eventIds.size,
                  },
                  'Falló el procesamiento asíncrono de un webhook de Meta',
                );
              }
            }
          })().finally(resolveTask);
        });
      });
      webhookTasks.add(task);
      void task.finally(() => webhookTasks.delete(task));
    }

    return reply.code(200).send({ received: true });
  });

  app.addHook('preHandler', async (request, reply) => {
    if (context.maintenance?.isRunning() !== true || !request.url.startsWith('/api/')) return;
    const route = request.routeOptions.url;
    if (
      route === '/api/health' ||
      route === '/api/admin/maintenance/status' ||
      route === '/api/admin/maintenance/factory-reset'
    ) {
      return;
    }
    await reply.code(423).send({
      error: 'El panel está temporalmente bloqueado por una operación de mantenimiento.',
      code: 'MAINTENANCE_IN_PROGRESS',
    });
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const route = request.routeOptions.url ?? '';
    if (
      route === '/api/health' ||
      route === '/api/auth/login' ||
      route === '/api/webhooks/meta/whatsapp'
    ) {
      return;
    }
    const session = getSession(request, sessions);
    if (session === null) return;
    const authorization = context.database.getPanelUserAuthorization(session.username);
    if (authorization === null) {
      await reply.code(401).send({ error: 'La sesión ya no tiene acceso al panel.' });
      return;
    }
    const botId = botIdForProtectedRoute(request, route);
    if (botId !== null && !context.database.canPanelUserAccessBot(session.username, botId)) {
      await reply.code(404).send({ error: 'Asistente no encontrado.' });
      return;
    }
    if (route === '/api/conversations/:conversationId/messages') {
      const conversationId = (request.params as { conversationId?: unknown } | null)
        ?.conversationId;
      if (
        typeof conversationId === 'string' &&
        !context.database.canPanelUserAccessConversation(session.username, conversationId)
      ) {
        await reply.code(404).send({ error: 'Conversación no encontrada.' });
        return;
      }
    }
    if (
      authorization.role !== 'global_admin' &&
      isGlobalAdministratorRoute(route, request.method)
    ) {
      await reply.code(403).send({
        error: 'Esta acción requiere permisos de administración global.',
        code: 'GLOBAL_ADMIN_REQUIRED',
      });
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const route = request.routeOptions.url ?? '';
    const module = moduleForProtectedRoute(route);
    if (module === null) return;
    const botId = botIdForProtectedRoute(request, route);
    if (botId === null) return;
    const bot = context.database.getBot(botId);
    if (bot === null || !moduleVisibility.visibleModules(bot).includes(module)) {
      context.database.recordTechnicalEvent({
        ...(bot === null ? {} : { botId }),
        eventType: 'ASSISTANT_ROUTE_REJECTED',
        activationType: module,
        result: 'rejected',
        errorCode: 'ASSISTANT_MODULE_NOT_AVAILABLE',
      });
      await reply.code(404).send({
        error: 'Este módulo no está disponible para el asistente seleccionado.',
        code: 'ASSISTANT_MODULE_NOT_AVAILABLE',
      });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const knownError = error instanceof Error ? error : new Error('Solicitud inválida.');
    const candidateStatus =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 400;
    const statusCode = candidateStatus < 500 ? candidateStatus : 500;
    const details = serializeError(knownError, 'ADMIN_REQUEST_REJECTED', context.developmentMode);
    const invalidOrganizationType =
      knownError instanceof z.ZodError &&
      knownError.issues.some((issue) => issue.path.includes('organizationType'));
    context.logger.warn(
      {
        ...details,
        operation: 'adminRequest',
        method: request.method,
        route: request.routeOptions.url,
      },
      'Solicitud administrativa rechazada',
    );
    void reply.code(statusCode).send({
      error:
        statusCode >= 500
          ? 'Error interno.'
          : invalidOrganizationType
            ? 'No se pudo guardar porque el tipo de negocio seleccionado no es válido.'
            : details.errorMessage,
      ...(invalidOrganizationType ? { code: 'INVALID_ORGANIZATION_TYPE' } : {}),
    });
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.post(
    '/api/panel-events',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const input = panelEventSchema.parse(request.body);
      if (input.assistantId !== undefined && context.database.getBot(input.assistantId) === null) {
        return reply.code(404).send({ error: 'Asistente no encontrado.' });
      }
      const session = getSession(request, sessions) as PanelSession;
      if (
        input.assistantId !== undefined &&
        !context.database.canPanelUserAccessBot(session.username, input.assistantId)
      ) {
        return reply.code(404).send({ error: 'Asistente no encontrado.' });
      }
      context.database.recordTechnicalEvent({
        ...(input.assistantId === undefined ? {} : { botId: input.assistantId }),
        eventType: input.eventType,
        result: 'opened',
      });
      return { recorded: true };
    },
  );

  app.post('/api/auth/login', async (request, reply) => {
    const key = request.ip;
    if (!loginGate.canAttempt(key)) {
      return reply.code(429).send({ error: 'Demasiados intentos. Inténtalo más tarde.' });
    }
    const input = loginSchema.parse(request.body);
    const hash = context.database.getPanelPasswordHash(input.username);
    const valid = hash !== null && (await verifyPassword(input.password, hash));
    if (!valid) {
      loginGate.failure(key);
      return reply.code(401).send({ error: 'Credenciales inválidas.' });
    }
    loginGate.success(key);
    const { token, session } = sessions.create(input.username);
    reply.setCookie(COOKIE_NAME, token, cookieOptions(request));
    const authorization = context.database.getPanelUserAuthorization(input.username);
    return {
      authenticated: true,
      csrfToken: session.csrfToken,
      role: authorization?.role ?? 'global_admin',
    };
  });

  app.get('/api/auth/session', { preHandler: requireSession(sessions) }, async (request) => {
    const session = getSession(request, sessions) as PanelSession;
    const authorization = context.database.getPanelUserAuthorization(session.username);
    return {
      authenticated: true,
      username: session.username,
      csrfToken: session.csrfToken,
      role: authorization?.role ?? 'global_admin',
    };
  });

  app.get('/api/bots', { preHandler: requireSession(sessions) }, async (request) => {
    const session = getSession(request, sessions) as PanelSession;
    const authorization = context.database.getPanelUserAuthorization(session.username);
    return {
      bots: (
        context.multiBotManager?.snapshots() ??
        context.database.listBots().map((bot) => ({ bot, runtime: null }))
      )
        .filter(
          ({ bot }) =>
            !['ARCHIVED', 'PENDING_DELETION', 'DELETED'].includes(bot.lifecycleStatus) &&
            (authorization?.role === 'global_admin' ||
              authorization?.businessIds.includes(bot.businessId) === true),
        )
        .map(({ bot, runtime }) => {
          const period = localPeriod(new Date(), bot.timezone);
          const usage = context.database.getAIUsageSummary(
            bot.profileId,
            period.date,
            period.month,
          );
          const provider = context.aiProviderFactory?.forBot(bot.id);
          const aiSettings = context.database.getAISettings(bot.profileId);
          const readiness = readinessFor(context, bot);
          return {
            id: bot.id,
            businessId: bot.businessId,
            businessName: bot.businessName,
            internalIdentifier: bot.internalIdentifier,
            botName: bot.botName,
            assistantName: bot.botName,
            organizationName: bot.organizationName,
            organizationType: bot.organizationType,
            connectorType: bot.connectorType,
            channel: bot.channel,
            capabilities: bot.capabilities,
            enabled: bot.enabled,
            maskedNumber: bot.maskedNumber,
            phoneNumber: adminPhoneNumberFor(context, bot.id),
            whatsappStatus: runtime?.connection.state ?? bot.whatsappStatus,
            aiConfigured: provider?.isConfigured() ?? false,
            aiEnabled: aiSettings.enabled,
            aiProvider: aiSettings.provider,
            aiModel: aiSettings.model,
            knowledgeStatus: readiness.knowledge,
            assistantStatus: readiness.assistant,
            readiness,
            requestsToday: usage.requests,
            tokensToday: usage.totalTokens,
            lastConnectedAt: runtime?.connection.lastConnectedAt ?? bot.lastConnectedAt,
            lastUpdatedAt: context.database.getAssistantLastUpdatedAt(bot.id),
            meta: metaConfigurationFor(context, bot.id),
            lifecycleStatus: bot.lifecycleStatus,
            deletionLocked: bot.deletionLocked,
            connectorConflict: safeConnectorConflict(context, bot),
            visibleModules: moduleVisibility.visibleModules(bot),
          };
        }),
      templates: PROFILE_PRESETS,
      organizationTypes: ORGANIZATION_TYPE_OPTIONS,
      legacyOrganizationTypeAliases: LEGACY_ORGANIZATION_TYPE_ALIASES,
    };
  });

  app.get('/api/assistants/trash', { preHandler: requireSession(sessions) }, async (request) => {
    const session = getSession(request, sessions) as PanelSession;
    const authorization = context.database.getPanelUserAuthorization(session.username);
    return {
      assistants: context.database
        .listBots()
        .filter(
          (bot) =>
            authorization?.role === 'global_admin' ||
            authorization?.businessIds.includes(bot.businessId) === true,
        )
        .filter((bot) => bot.lifecycleStatus === 'ARCHIVED')
        .map((bot) => ({
          id: bot.id,
          businessId: bot.businessId,
          businessName: bot.businessName,
          botName: bot.botName,
          organizationName: bot.organizationName,
          organizationType: bot.organizationType,
          phoneNumber: adminPhoneNumberFor(context, bot.id),
          deletedAt: bot.deletedAt,
          scheduledPermanentDeletionAt: bot.scheduledPermanentDeletionAt,
          deletionLocked: bot.deletionLocked,
        })),
    };
  });

  app.post(
    '/api/bots/:botId/trash',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const bot = context.database.getBot(botId);
      if (bot === null) return reply.code(404).send({ error: 'Asistente no encontrado.' });
      if (bot.deletionLocked) {
        context.database.recordTechnicalEvent({
          botId,
          eventType: 'PROTECTED_ASSISTANT_DELETION_BLOCKED',
          result: 'blocked',
        });
        return reply.code(403).send({
          error: 'Este asistente está protegido y no puede enviarse a la papelera.',
          code: 'PROTECTED_ASSISTANT_DELETION_BLOCKED',
        });
      }
      const input = trashAssistantSchema.parse(request.body);
      if (input.confirmationName !== bot.botName) {
        return reply.code(400).send({
          error: 'El nombre de confirmación no coincide.',
          code: 'CONFIRMATION_NAME_MISMATCH',
        });
      }
      const session = getSession(request, sessions) as PanelSession;
      const passwordHash = context.database.getPanelPasswordHash(session.username);
      if (passwordHash === null || !(await verifyPassword(input.password, passwordHash))) {
        return reply
          .code(401)
          .send({ error: 'La contraseña actual no es válida.', code: 'INVALID_PASSWORD' });
      }
      await context.multiBotManager?.stop(botId);
      const archived = context.database.sendBotToTrash(
        botId,
        context.anonymizer.identifier(session.username),
      );
      audit(context, 'assistant_sent_to_trash', botId, 'ok', botId);
      return { assistant: adminBotResponse(context, archived) };
    },
  );

  app.post(
    '/api/bots/:botId/restore',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      restoreAssistantSchema.parse(request.body);
      const session = getSession(request, sessions) as PanelSession;
      try {
        const restored = context.database.restoreBotFromTrash(
          botId,
          context.anonymizer.identifier(session.username),
        );
        audit(context, 'assistant_restored', botId, 'ok', botId);
        return { assistant: adminBotResponse(context, restored) };
      } catch (error) {
        if (error instanceof Error && error.message === 'RESTORE_PHONE_CONFLICT') {
          return reply.code(409).send({
            error:
              'No se puede restaurar porque esa identidad de WhatsApp pertenece a otro asistente activo.',
            code: 'RESTORE_PHONE_CONFLICT',
          });
        }
        if (error instanceof Error && error.message === 'ASSISTANT_NOT_ARCHIVED') {
          return reply.code(404).send({
            error: 'El asistente no está en la papelera.',
            code: 'ASSISTANT_NOT_ARCHIVED',
          });
        }
        throw error;
      }
    },
  );

  app.delete(
    '/api/bots/:botId/permanent',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const bot = context.database.getBot(botId);
      if (bot === null || bot.lifecycleStatus !== 'ARCHIVED') {
        return reply
          .code(404)
          .send({ error: 'El asistente no está en la papelera.', code: 'ASSISTANT_NOT_ARCHIVED' });
      }
      if (bot.deletionLocked) {
        context.database.recordTechnicalEvent({
          botId,
          eventType: 'PROTECTED_ASSISTANT_DELETION_BLOCKED',
          result: 'blocked',
        });
        return reply.code(403).send({
          error: 'Este asistente está protegido y no puede eliminarse.',
          code: 'PROTECTED_ASSISTANT_DELETION_BLOCKED',
        });
      }
      const input = permanentlyDeleteAssistantSchema.parse(request.body);
      const expectedPhrase = `ELIMINAR PERMANENTEMENTE ${bot.botName}`;
      if (input.confirmationPhrase !== expectedPhrase) {
        return reply.code(400).send({
          error: 'La frase de confirmación no coincide.',
          code: 'CONFIRMATION_PHRASE_MISMATCH',
        });
      }
      const session = getSession(request, sessions) as PanelSession;
      const passwordHash = context.database.getPanelPasswordHash(session.username);
      if (passwordHash === null || !(await verifyPassword(input.password, passwordHash))) {
        return reply
          .code(401)
          .send({ error: 'La contraseña actual no es válida.', code: 'INVALID_PASSWORD' });
      }
      await context.multiBotManager?.stop(botId);
      context.database.permanentlyDeleteBot(botId, context.anonymizer.identifier(session.username));
      audit(context, 'assistant_permanently_deleted', botId, 'ok', botId);
      return { deleted: true };
    },
  );

  app.post(
    '/api/bots',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      if (context.multiBotManager === undefined)
        return reply.code(503).send({ error: 'El gestor multibot no está disponible.' });
      const input = botCreateSchema.parse(request.body);
      const registry = new AIProviderRegistry(context.aiProviderFactory?.defaultModel());
      if (!registry.isAllowedModel(input.provider, input.model)) {
        return reply.code(400).send({
          error: 'El modelo seleccionado no está habilitado para Groq.',
          code: 'AI_MODEL_NOT_ALLOWED',
        });
      }
      const profile = {
        ...createProfileFromPreset(input),
        description: input.description,
        applicationName: 'Don Gato Digital',
      };
      const bot = await context.multiBotManager.create({
        ...(input.id === undefined ? {} : { id: input.id }),
        business: {
          name: input.organizationName,
          description: input.description,
          language: input.language,
          timezone: input.timezone,
        },
        connectorType: input.connectorType,
        menuType: input.menuType,
        whatsappSetupMode: input.whatsappSetupMode,
        ai: { provider: input.provider, model: input.model, enabled: true },
        behavior: { ...input.behavior, humanHandoffReady: false },
        profile,
      });
      audit(context, 'bot_create', bot.id, 'ok', bot.id);
      return reply.code(201).send({
        bot: adminBotResponse(context, bot),
        meta: context.multiBotManager.metaConfiguration(bot.id),
      });
    },
  );

  app.get('/api/bots/:botId', { preHandler: requireSession(sessions) }, async (request, reply) => {
    const botId = parseBotId(request.params);
    const bot = context.database.getBot(botId);
    if (bot === null) return reply.code(404).send({ error: 'Asistente no encontrado.' });
    const profile = context.database.getBotProfile(botId);
    const period = localPeriod(new Date(), profile.timezone);
    const provider = context.aiProviderFactory?.forBot(botId);
    const aiStatus = context.database.getAIProviderStatus(
      profile.id,
      provider?.isConfigured() ?? false,
      provider?.getModelInformation().model ?? 'disabled',
    );
    return {
      bot: adminBotResponse(context, bot),
      business: context.database.getBusinessByBotId(botId),
      whatsapp: adminWhatsAppConnection(context, botId),
      behavior: context.database.getAssistantBehavior(botId),
      readiness: readinessFor(context, bot),
      visibleModules: moduleVisibility.visibleModules(bot),
      connectorConflict: safeConnectorConflict(context, bot),
      profile,
      runtime: context.multiBotManager?.snapshot(botId) ?? null,
      ai: aiStatus,
      usage: context.database.getAIUsageSummary(profile.id, period.date, period.month),
      activeConversations: context.database.countActiveConversationStates(botId),
      pendingRequests: context.database
        .listHumanAssistanceRequests(botId)
        .filter((item) => item.status === 'pending').length,
    };
  });

  app.get('/api/ai/providers', { preHandler: requireSession(sessions) }, async () => ({
    providers: context.aiProviderFactory?.catalog() ?? new AIProviderRegistry().list(),
    defaultProvider: 'groq',
    defaultModel:
      context.aiProviderFactory?.defaultModel() ?? new AIProviderRegistry().defaultModel('groq'),
  }));

  app.get(
    '/api/conversations',
    { preHandler: requireSession(sessions) },
    async (request, reply) => {
      const query = conversationListQuerySchema.parse(request.query ?? {});
      const session = getSession(request, sessions) as PanelSession;
      const authorization = context.database.getPanelUserAuthorization(session.username);
      if (
        query.assistantId !== undefined &&
        !context.database.canPanelUserAccessBot(session.username, query.assistantId)
      ) {
        return reply.code(404).send({ error: 'Asistente no encontrado.' });
      }
      if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
        return reply.code(400).send({
          error: 'La fecha inicial no puede ser posterior a la fecha final.',
          code: 'INVALID_CONVERSATION_DATE_RANGE',
        });
      }
      const from = query.from === undefined ? null : utcDateBoundary(query.from);
      const toExclusive = query.to === undefined ? null : utcDateBoundary(query.to, 1);
      const result = context.database.listConversations({
        page: query.page,
        pageSize: query.pageSize,
        ...(query.search === undefined ? {} : { search: query.search }),
        ...(query.assistantId === undefined ? {} : { assistantId: query.assistantId }),
        ...(authorization?.role === 'business_admin'
          ? { businessIds: authorization.businessIds }
          : {}),
        ...(from === null ? {} : { from }),
        ...(toExclusive === null ? {} : { toExclusive }),
      });
      return {
        items: result.items.map(adminConversationResponse),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
        },
      };
    },
  );

  app.get(
    '/api/conversations/:conversationId/messages',
    { preHandler: requireSession(sessions) },
    async (request, reply) => {
      const conversationId = z
        .object({ conversationId: z.string().uuid() })
        .parse(request.params).conversationId;
      const query = conversationMessagesQuerySchema.parse(request.query ?? {});
      const result = context.database.listConversationMessages(
        conversationId,
        query.page,
        query.pageSize,
      );
      if (result === null) return reply.code(404).send({ error: 'Conversación no encontrada.' });
      return {
        conversation: adminConversationResponse(result.conversation),
        items: result.messages.items.map((message) => ({
          id: message.id,
          direction: message.direction,
          senderType: message.senderType,
          messageType: message.messageType,
          text: message.text,
          caption: message.caption,
          timestamp: message.messageTimestamp,
          status: message.whatsappStatus,
          error:
            message.whatsappStatus === 'failed'
              ? { code: message.errorCode, message: message.errorMessage }
              : null,
        })),
        pagination: {
          page: result.messages.page,
          pageSize: result.messages.pageSize,
          total: result.messages.total,
          totalPages: result.messages.totalPages,
        },
      };
    },
  );

  app.get(
    '/api/bots/:botId/history',
    { preHandler: requireSession(sessions) },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      if (context.database.getBot(botId) === null) {
        return reply.code(404).send({ error: 'Asistente no encontrado.' });
      }
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(200) })
        .strict()
        .parse(request.query ?? {});
      return { items: context.database.listAssistantActivity(botId, query.limit) };
    },
  );

  app.patch(
    '/api/bots/:botId/configuration',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = botConfigurationSchema.parse(request.body);
      const previous = context.database.getBot(botId);
      if (previous === null) return reply.code(404).send({ error: 'Asistente no encontrado.' });
      if (input.enabled && !previous.enabled) {
        const readiness = readinessFor(context, previous);
        if (!readiness.canActivate) {
          return reply.code(409).send({
            error: `El asistente todavía no puede activarse: ${readiness.missingRequirements.join(' ')}`,
            code: 'ASSISTANT_NOT_READY',
            missingRequirements: readiness.missingRequirements,
            readiness,
          });
        }
      }
      const bot = context.database.updateBotConfiguration({ botId, ...input });
      if (context.multiBotManager !== undefined) {
        const connectionSettingsChanged = previous !== null && previous.enabled !== bot.enabled;
        if (!bot.enabled) await context.multiBotManager.stop(botId);
        else if (connectionSettingsChanged) {
          await context.multiBotManager.stop(botId);
          await context.multiBotManager.start(botId);
        }
      }
      audit(context, 'bot_configuration_update', botId, 'ok', botId);
      return { bot: adminBotResponse(context, bot) };
    },
  );

  app.patch(
    '/api/bots/:botId/profile',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const existing = context.database.getBotProfile(botId);
      const business = context.database.getBusinessByBotId(botId);
      const input = profileUpdateSchema.parse(request.body);
      const { language, ...profileFields } = input;
      const updatedBusiness = context.database.saveBusiness({
        id: business.id,
        name: profileFields.organizationName,
        description: profileFields.description,
        language: language ?? business.language,
        timezone: profileFields.timezone,
      });
      const profile = context.database.saveAssistantProfile({ ...existing, ...profileFields });
      audit(context, 'bot_profile_update', String(profile.id), 'ok', botId);
      return {
        profile,
        business: updatedBusiness,
        readiness: readinessFor(context, context.database.getBot(botId)!),
      };
    },
  );

  app.get(
    '/api/bots/:botId/behavior',
    { preHandler: requireSession(sessions) },
    async (request) => ({
      behavior: context.database.getAssistantBehavior(parseBotId(request.params)),
    }),
  );

  app.patch(
    '/api/bots/:botId/behavior',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const behavior = context.database.saveAssistantBehavior({
        assistantId: botId,
        ...assistantBehaviorSchema.parse(request.body),
      });
      audit(context, 'assistant_behavior_update', botId, 'ok', botId);
      return {
        behavior,
        readiness: readinessFor(context, context.database.getBot(botId)!),
      };
    },
  );

  app.get(
    '/api/bots/:botId/whatsapp',
    { preHandler: requireSession(sessions) },
    async (request) => ({
      connection: adminWhatsAppConnection(context, parseBotId(request.params)),
    }),
  );

  app.patch(
    '/api/bots/:botId/whatsapp/setup',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const connection = context.database.saveWhatsAppSetupMode(
        botId,
        whatsappSetupSchema.parse(request.body).setupMode,
      );
      audit(context, 'whatsapp_setup_mode_update', botId, 'ok', botId);
      return { connection };
    },
  );

  app.post(
    '/api/bots/:botId/simulator',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = assistantSimulationSchema.parse(request.body);
      if (context.multiBotManager === undefined) {
        return reply.code(503).send({
          error: 'El simulador no está disponible en esta instalación.',
          code: 'ASSISTANT_SIMULATOR_UNAVAILABLE',
        });
      }
      const result = await context.multiBotManager.simulateAssistantQuestion(botId, input.message);
      audit(context, 'assistant_simulator_query', botId, result.debug.status, botId);
      return {
        response: result.response.message,
        presentation: result.response.presentation,
        options: result.response.options,
        debug: {
          route: result.debug.route,
          provider: result.debug.provider,
          model: result.debug.model,
          knowledgeUsed: result.debug.knowledgeUsed,
          toolCalled: result.debug.toolCalled,
          toolResultCount: result.debug.toolResultCount,
          presentation: result.debug.presentation,
          actions: result.debug.actionIds,
          durationMs: result.debug.durationMs,
          status: result.debug.status,
          error: result.debug.error,
        },
      };
    },
  );

  app.get(
    '/api/bots/:botId/knowledge',
    { preHandler: requireSession(sessions) },
    async (request) => {
      const botId = parseBotId(request.params);
      const profile = context.database.getBotProfile(botId);
      return {
        categories: context.database.listKnowledgeCategories(profile.id),
        entries: context.database.listKnowledgeEntries(profile.id),
      };
    },
  );

  app.post(
    '/api/bots/:botId/knowledge/categories',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const profile = context.database.getBotProfile(botId);
      const input = knowledgeCategorySchema.parse(request.body);
      const category = context.database.saveKnowledgeCategory({
        ...(input.id === undefined ? {} : { id: input.id }),
        profileId: profile.id,
        name: input.name,
        enabled: input.enabled,
      });
      audit(context, 'bot_knowledge_category_save', String(category.id), 'ok', botId);
      return reply.code(input.id === undefined ? 201 : 200).send({ category });
    },
  );

  app.post(
    '/api/bots/:botId/knowledge/entries',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const profile = context.database.getBotProfile(botId);
      const input = knowledgeEntrySchema.parse(request.body);
      const entry = context.database.saveKnowledgeEntry({
        ...input,
        id: input.id ?? 0,
        profileId: profile.id,
      });
      audit(context, 'bot_knowledge_entry_save', String(entry.id), 'ok', botId);
      return reply.code(input.id === undefined ? 201 : 200).send({ entry });
    },
  );

  app.delete(
    '/api/bots/:botId/knowledge/entries/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const profile = context.database.getBotProfile(botId);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      if (!context.database.deleteKnowledgeEntry(profile.id, id))
        return reply.code(404).send({ error: 'Entrada no encontrada.' });
      audit(context, 'bot_knowledge_entry_delete', String(id), 'ok', botId);
      return { deleted: true };
    },
  );

  app.get(
    '/api/bots/:botId/cached-answers',
    { preHandler: requireSession(sessions) },
    async (request) => {
      const botId = parseBotId(request.params);
      const search = z
        .object({ search: z.string().trim().max(200).default('') })
        .parse(request.query).search;
      return { answers: context.database.listCachedAnswers(botId, search) };
    },
  );

  app.post(
    '/api/bots/:botId/cached-answers',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = cachedAnswerCreateSchema.parse(request.body);
      const normalized = normalizeQuestionForCache(input.canonicalQuestion);
      const answer = context.database.saveCachedAnswer({
        botId,
        canonicalQuestion: input.canonicalQuestion,
        normalizedQuestionHash: hashNormalizedQuestion(normalized),
        answer: input.answer,
        category: input.category,
        knowledgeSourceIds: [],
        knowledgeVersion: '',
        promptVersion: 'admin-v1',
        status: input.sourceType === 'ADMIN_FAQ' ? 'ADMIN_APPROVED' : 'ADMIN_EDITED',
        sourceType: input.sourceType,
        confidence: 1,
      });
      for (const variant of input.variants) {
        context.database.addCachedAnswerVariant(
          botId,
          answer.id,
          variant,
          hashNormalizedQuestion(normalizeQuestionForCache(variant)),
        );
      }
      context.database.recordTechnicalEvent({
        botId,
        eventType: 'ANSWER_CACHE_ADMIN_APPROVED',
        result: input.sourceType,
      });
      audit(context, 'cached_answer_create', String(answer.id), 'ok', botId);
      return reply.code(201).send({ answer: context.database.getCachedAnswer(botId, answer.id) });
    },
  );

  app.patch(
    '/api/bots/:botId/cached-answers/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      const input = cachedAnswerActionSchema.parse(request.body);
      const existing = context.database.getCachedAnswer(botId, id);
      if (existing === null)
        return reply.code(404).send({ error: 'Respuesta guardada no encontrada.' });
      if (input.action === 'view_sources')
        return { answer: existing, sourceIds: existing.knowledgeSourceIds };
      let answer: typeof existing;
      let technicalEvent = 'ANSWER_CACHE_ADMIN_EDITED';
      if (input.action === 'approve') {
        answer = context.database.setCachedAnswerStatus(botId, id, 'ADMIN_APPROVED');
        technicalEvent = 'ANSWER_CACHE_ADMIN_APPROVED';
      } else if (input.action === 'disable') {
        answer = context.database.setCachedAnswerStatus(botId, id, 'DISABLED');
      } else if (input.action === 'invalidate' || input.action === 'regenerate') {
        answer = context.database.setCachedAnswerStatus(
          botId,
          id,
          'INVALIDATED',
          input.action === 'regenerate' ? 'MANUAL_REGENERATE' : 'ADMIN_INVALIDATION',
        );
        technicalEvent = 'ANSWER_CACHE_INVALIDATED';
      } else if (input.action === 'add_variant') {
        if (input.variant === undefined)
          return reply.code(400).send({ error: 'Escribe la variante.' });
        answer = context.database.addCachedAnswerVariant(
          botId,
          id,
          input.variant,
          hashNormalizedQuestion(normalizeQuestionForCache(input.variant)),
        );
      } else {
        const sourceType = input.action === 'convert_faq' ? 'ADMIN_FAQ' : existing.sourceType;
        answer = context.database.saveCachedAnswer({
          id,
          botId,
          canonicalQuestion: existing.canonicalQuestion,
          normalizedQuestionHash: existing.normalizedQuestionHash,
          answer: input.answer ?? existing.answer,
          category: input.category ?? existing.category,
          knowledgeSourceIds: existing.knowledgeSourceIds,
          knowledgeVersion: existing.knowledgeVersion,
          promptVersion: existing.promptVersion,
          status: input.action === 'convert_faq' ? 'ADMIN_APPROVED' : 'ADMIN_EDITED',
          sourceType,
          confidence: existing.confidence,
          expiresAt: existing.expiresAt,
        });
        if (input.action === 'convert_faq') technicalEvent = 'ANSWER_CACHE_ADMIN_APPROVED';
      }
      context.database.recordTechnicalEvent({
        botId,
        eventType: technicalEvent,
        result: input.action,
      });
      audit(context, `cached_answer_${input.action}`, String(id), 'ok', botId);
      return { answer };
    },
  );

  app.delete(
    '/api/bots/:botId/cached-answers/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      if (!context.database.deleteCachedAnswer(botId, id))
        return reply.code(404).send({ error: 'Respuesta guardada no encontrada.' });
      audit(context, 'cached_answer_delete', String(id), 'ok', botId);
      return { deleted: true };
    },
  );

  app.get('/api/bots/:botId/ai', { preHandler: requireSession(sessions) }, async (request) => {
    const botId = parseBotId(request.params);
    const profile = context.database.getBotProfile(botId);
    const provider = context.aiProviderFactory?.forBot(botId);
    const period = localPeriod(new Date(), profile.timezone);
    const queue = context.multiBotManager?.aiQueue(botId)?.snapshot() ?? {
      processing: 0,
      waiting: 0,
      settings: context.database.getAIQueueSettings(botId),
      metrics: context.database.getAIQueueMetrics(botId, period.date),
      providerHealth: context.database.getAIProviderQueueHealth(botId),
    };
    if (provider?.isConfigured() !== true)
      queue.providerHealth = { ...queue.providerHealth, state: 'NOT_CONFIGURED' };
    return {
      developmentMode: context.developmentMode,
      settings: context.database.getAISettings(profile.id),
      status: context.database.getAIProviderStatus(
        profile.id,
        provider?.isConfigured() ?? false,
        provider?.getModelInformation().model ?? 'disabled',
      ),
      usage: context.database.getAIUsageSummary(profile.id, period.date, period.month),
      operationalMetrics: context.database.getBotOperationalMetrics(botId),
      queue,
      recentEvents: context.database.listRecentAIUsageEvents(profile.id),
      credential: {
        mode: 'platform_managed',
        configured: provider?.isConfigured() ?? false,
      },
    };
  });

  app.patch(
    '/api/bots/:botId/ai/queue-settings',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const settings = context.database.saveAIQueueSettings(
        botId,
        aiQueueSettingsSchema.parse(request.body),
      );
      audit(context, 'ai_queue_settings_update', botId, 'ok', botId);
      return { settings };
    },
  );

  app.post(
    '/api/bots/:botId/ai/queue-settings/recommended',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const current = context.database.getAIQueueSettings(botId);
      const settings = context.database.saveAIQueueSettings(botId, {
        ...current,
        maxConcurrent: 3,
        maxQueueSize: 20,
        maxQueueWaitSeconds: 60,
        providerTimeoutSeconds: 25,
        maxRetries: 2,
        initialRetryDelaySeconds: 2,
        maximumRetryDelaySeconds: 15,
        waitNoticeSeconds: 5,
        userCooldownSeconds: 10,
        duplicateWindowSeconds: 15,
        singleFlightWindowSeconds: 60,
        outboundMessageIntervalMs: 1000,
        suggestedRetrySeconds: 60,
      });
      audit(context, 'ai_queue_settings_restore_recommended', botId, 'ok', botId);
      return { settings };
    },
  );

  app.post(
    '/api/bots/:botId/ai/simulate-queue',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      if (!context.developmentMode)
        return reply.code(404).send({ error: 'Operación no disponible.' });
      const botId = parseBotId(request.params);
      const input = aiQueueSimulationSchema.parse(request.body);
      const settings = context.database.getAIQueueSettings(botId);
      const unique = input.scenario === 'repeated' ? 1 : input.requests;
      const processing = Math.min(unique, settings.maxConcurrent);
      const waiting = Math.min(Math.max(0, unique - processing), settings.maxQueueSize);
      const rejected = Math.max(0, unique - processing - waiting);
      return {
        simulated: true,
        requests: input.requests,
        processing,
        waiting,
        rejected,
        coalesced: input.scenario === 'repeated' ? Math.max(0, input.requests - 1) : 0,
        providerError:
          input.scenario === 'normal' || input.scenario === 'repeated'
            ? null
            : input.scenario === 'timeout'
              ? 'AI_TIMEOUT'
              : 'AI_PROVIDER_RATE_LIMITED',
      };
    },
  );

  app.get('/api/ai/global-limits', { preHandler: requireSession(sessions) }, async () => ({
    limits: context.database.getGlobalAILimits(),
  }));

  app.patch(
    '/api/ai/global-limits',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const limits = context.database.saveGlobalAILimits(globalAILimitsSchema.parse(request.body));
      audit(context, 'global_ai_limits_update', 'installation', 'ok');
      return { limits };
    },
  );

  app.patch(
    '/api/bots/:botId/ai/settings',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const profile = context.database.getBotProfile(botId);
      const input = aiSettingsSchema.parse(request.body);
      const selectedModel = input.provider === 'disabled' ? 'disabled' : input.model;
      const registry = new AIProviderRegistry(context.aiProviderFactory?.defaultModel());
      if (!registry.isAllowedModel(input.provider, selectedModel)) {
        return reply.code(400).send({
          error: 'El modelo seleccionado no está habilitado para este proveedor.',
          code: 'AI_MODEL_NOT_ALLOWED',
        });
      }
      if (exceedsSafeDefaults(input) && !input.confirmIncreasedLimits) {
        return reply.code(409).send({
          error: 'Confirma explícitamente el aumento sobre los límites seguros iniciales.',
          code: 'AI_LIMIT_INCREASE_CONFIRMATION_REQUIRED',
        });
      }
      const { confirmIncreasedLimits, ...values } = input;
      void confirmIncreasedLimits;
      const settings = context.database.saveAISettings({
        ...values,
        model: selectedModel,
        providerConfig: input.provider === 'groq' ? { model: selectedModel } : {},
        profileId: profile.id,
        updatedAt: new Date().toISOString(),
      });
      audit(context, 'bot_ai_settings_update', botId, 'ok', botId);
      return { settings };
    },
  );

  app.post(
    '/api/bots/:botId/ai/test-connection',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const profile = context.database.getBotProfile(botId);
      const provider = context.aiProviderFactory?.forBot(botId);
      if (provider === undefined)
        return reply.code(503).send({ configured: false, connection: 'failed' });
      const result = await provider.testConnection(
        context.database.getAISettings(profile.id).timeoutMs,
      );
      context.database.updateAIProviderHealth(
        profile.id,
        provider.getModelInformation().provider,
        result.successful,
        result.successful ? null : result.errorCode,
      );
      return {
        configured: provider.isConfigured(),
        connection: result.successful ? 'successful' : 'failed',
      };
    },
  );

  app.post(
    '/api/bots/:botId/ai/reset-development-counters',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      if (!context.developmentMode)
        return reply.code(404).send({ error: 'Operación no disponible.' });
      const botId = parseBotId(request.params);
      const input = resetCountersSchema.parse(request.body);
      const session = getSession(request, sessions) as PanelSession;
      const passwordHash = context.database.getPanelPasswordHash(session.username);
      if (passwordHash === null || !(await verifyPassword(input.password, passwordHash))) {
        return reply.code(401).send({ error: 'Contraseña incorrecta.' });
      }
      const profile = context.database.getBotProfile(botId);
      context.database.resetAIUsageForDevelopment(profile.id);
      context.database.recordTechnicalEvent({
        botId,
        eventType: 'TEST_COUNTERS_RESET',
        result: 'ok',
      });
      audit(context, 'TEST_COUNTERS_RESET', String(profile.id), 'ok', botId);
      return { reset: true };
    },
  );

  app.get(
    '/api/bots/:botId/ai/export',
    { preHandler: requireSession(sessions) },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const profile = context.database.getBotProfile(botId);
      const exportData = {
        botId,
        profileId: profile.id,
        exportedAt: new Date().toISOString(),
        events: context.database.listRecentAIUsageEvents(profile.id, 500),
      };
      return reply
        .header('content-disposition', `attachment; filename="${botId}-ai-usage.json"`)
        .type('application/json')
        .send(exportData);
    },
  );

  app.post(
    '/api/bots/:botId/restart',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      if (context.multiBotManager === undefined)
        return reply.code(503).send({ error: 'El gestor multibot no está disponible.' });
      const botId = parseBotId(request.params);
      await context.multiBotManager.restart(botId);
      audit(context, 'bot_restart', botId, 'ok', botId);
      return { restarted: true };
    },
  );

  app.get('/api/bots/:botId/menus', { preHandler: requireSession(sessions) }, async (request) => {
    const botId = parseBotId(request.params);
    return {
      menus: context.database.listMenus(botId),
      options: context.database.listMenuOptions(botId),
    };
  });

  app.get(
    '/api/bots/:botId/interactions',
    { preHandler: requireSession(sessions) },
    async (request) => {
      const botId = parseBotId(request.params);
      return {
        persistent: {
          menus: context.database.listMenus(botId),
          options: context.database.listMenuOptions(botId),
        },
        dynamic: context.database.getAssistantBehavior(botId),
        tools: new ToolRegistry(context.database).list(botId),
        actions: new ActionRegistry().list(),
      };
    },
  );

  app.patch(
    '/api/bots/:botId/interactions/dynamic',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const current = context.database.getAssistantBehavior(botId);
      const input = dynamicInteractionSettingsSchema.parse(request.body);
      const behavior = context.database.saveAssistantBehavior({
        ...current,
        ...input,
        assistantId: botId,
      });
      audit(context, 'dynamic_interactions_update', botId, 'ok', botId);
      return { behavior };
    },
  );

  app.get('/api/bots/:botId/tools', { preHandler: requireSession(sessions) }, async (request) => {
    const botId = parseBotId(request.params);
    return { tools: new ToolRegistry(context.database).list(botId) };
  });

  app.patch(
    '/api/bots/:botId/tools/:toolId',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const toolId = z
        .object({ toolId: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/u) })
        .parse(request.params).toolId;
      const registry = new ToolRegistry(context.database);
      const descriptor = registry.list(botId).find((tool) => tool.id === toolId);
      if (descriptor === undefined) {
        return reply.code(404).send({ error: 'Herramienta no encontrada.' });
      }
      const input = toolConfigurationSchema.parse(request.body);
      if (descriptor.availability === 'FUTURE' && input.enabled) {
        return reply.code(409).send({
          error: 'La herramienta requiere una fuente real antes de habilitarse.',
          code: 'TOOL_REAL_SOURCE_REQUIRED',
        });
      }
      const configuration = context.database.saveAssistantToolConfiguration({
        assistantId: botId,
        toolId,
        enabled: input.enabled,
        permissions: input.permissions,
      });
      audit(context, 'tool_configuration_update', toolId, 'ok', botId);
      return { configuration, tools: registry.list(botId) };
    },
  );

  app.post(
    '/api/bots/:botId/menus',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = menuSchema.parse(request.body);
      const menu = context.database.saveMenu({
        ...(input.id === undefined ? {} : { id: input.id }),
        botId,
        parentMenuId: input.parentMenuId,
        title: input.title,
        message: input.message,
        helpText: input.helpText,
        presentation: input.presentation,
        listButtonLabel: input.listButtonLabel,
        enabled: input.enabled,
        isInitial: input.isInitial,
        expirationMinutes: input.expirationMinutes,
      });
      audit(context, 'menu_save', String(menu.id), 'ok', botId);
      return reply.code(input.id === undefined ? 201 : 200).send({ menu });
    },
  );

  app.delete(
    '/api/bots/:botId/menus/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      if (!context.database.deleteMenu(botId, id))
        return reply.code(404).send({ error: 'Menú no encontrado.' });
      audit(context, 'menu_delete', String(id), 'ok', botId);
      return { deleted: true };
    },
  );

  app.post(
    '/api/bots/:botId/menu-options',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = menuOptionSchema.parse(request.body);
      const option = context.database.saveMenuOption({
        ...(input.id === undefined ? {} : { id: input.id }),
        botId,
        menuId: input.menuId,
        label: input.label,
        description: input.description,
        section: input.section,
        aliases: input.aliases,
        order: input.order,
        actionType: input.actionType,
        actionPayload: input.actionPayload,
        enabled: input.enabled,
      });
      audit(context, 'menu_option_save', String(option.id), 'ok', botId);
      return reply.code(input.id === undefined ? 201 : 200).send({ option });
    },
  );

  app.delete(
    '/api/bots/:botId/menu-options/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      if (!context.database.deleteMenuOption(botId, id))
        return reply.code(404).send({ error: 'Opción no encontrada.' });
      audit(context, 'menu_option_delete', String(id), 'ok', botId);
      return { deleted: true };
    },
  );

  app.get('/api/bots/:botId/catalog', { preHandler: requireSession(sessions) }, async (request) => {
    const botId = parseBotId(request.params);
    return {
      categories: context.database.listCatalogCategories(botId),
      items: context.database.listCatalogItems(botId),
    };
  });

  app.post(
    '/api/bots/:botId/catalog/categories',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = catalogCategorySchema.parse(request.body);
      const category = context.database.saveCatalogCategory({
        ...(input.id === undefined ? {} : { id: input.id }),
        botId,
        name: input.name,
        description: input.description,
        enabled: input.enabled,
      });
      audit(context, 'catalog_category_save', String(category.id), 'ok', botId);
      return reply.code(input.id === undefined ? 201 : 200).send({ category });
    },
  );

  app.post(
    '/api/bots/:botId/catalog/items',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = catalogItemSchema.parse(request.body);
      const item = context.database.saveCatalogItem({ ...input, botId });
      audit(context, 'catalog_item_save', String(item.id), 'ok', botId);
      return reply.code(input.id === 0 ? 201 : 200).send({ item });
    },
  );

  app.delete(
    '/api/bots/:botId/catalog/items/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      if (!context.database.deleteCatalogItem(botId, id))
        return reply.code(404).send({ error: 'Producto o servicio no encontrado.' });
      audit(context, 'catalog_item_delete', String(id), 'ok', botId);
      return { deleted: true };
    },
  );

  app.get('/api/bots/:botId/hours', { preHandler: requireSession(sessions) }, async (request) => ({
    hours: context.database.listBusinessHours(parseBotId(request.params)),
  }));

  app.put(
    '/api/bots/:botId/hours',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const input = z
        .object({ hours: z.array(businessHourSchema).max(100) })
        .strict()
        .parse(request.body);
      const hours = context.database.replaceBusinessHours(botId, input.hours);
      audit(context, 'business_hours_replace', botId, 'ok', botId);
      return { hours };
    },
  );

  app.get(
    '/api/bots/:botId/requests',
    { preHandler: requireSession(sessions) },
    async (request) => ({
      requests: context.database.listHumanAssistanceRequests(parseBotId(request.params)),
    }),
  );

  app.patch(
    '/api/bots/:botId/requests/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      const input = z
        .object({
          status: z.enum(['pending', 'confirmed', 'rejected', 'attended', 'cancelled']),
          note: z.string().trim().max(300),
        })
        .strict()
        .parse(request.body);
      const assistanceRequest = context.database.updateHumanAssistanceRequest(
        botId,
        id,
        input.status,
        input.note,
      );
      audit(context, 'human_request_update', String(id), 'ok', botId);
      return { request: assistanceRequest };
    },
  );

  app.get('/api/bots/:botId/media', { preHandler: requireSession(sessions) }, async (request) => ({
    assets: context.database
      .listMediaAssets(parseBotId(request.params))
      .map((asset) => ({ ...asset, sha256: undefined, relativePath: undefined })),
  }));

  app.post(
    '/api/bots/:botId/media',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      if (context.database.getBot(botId) === null)
        return reply.code(404).send({ error: 'Asistente no encontrado.' });
      const input = z
        .object({
          mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
          data: z.string().min(1).max(520_000),
          caption: z.string().trim().max(300),
        })
        .strict()
        .parse(request.body);
      if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(input.data))
        return reply.code(400).send({ error: 'Archivo inválido.' });
      const content = Buffer.from(input.data, 'base64');
      if (
        content.length === 0 ||
        content.length > 384 * 1024 ||
        !matchesImageSignature(content, input.mimeType)
      ) {
        return reply
          .code(400)
          .send({ error: 'La imagen debe ser PNG, JPEG o WebP y pesar menos de 384 KB.' });
      }
      const extension =
        input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const fileName = `${randomUUID()}.${extension}`;
      const root = context.mediaDirectory ?? resolve(process.cwd(), 'data', 'media');
      const botDirectory = join(root, botId);
      await mkdir(botDirectory, { recursive: true });
      const filePath = join(botDirectory, fileName);
      await writeFile(filePath, content, { flag: 'wx' });
      let asset: ReturnType<AppDatabase['createMediaAsset']>;
      try {
        asset = context.database.createMediaAsset({
          botId,
          internalName: `${botId}-${fileName}`,
          relativePath: fileName,
          mimeType: input.mimeType,
          byteSize: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
          caption: input.caption,
        });
      } catch (error) {
        const trash = join(root, '.trash', botId);
        await mkdir(trash, { recursive: true });
        await rename(filePath, join(trash, `${Date.now()}-${fileName}`));
        throw error;
      }
      audit(context, 'media_upload', String(asset.id), 'ok', botId);
      return reply
        .code(201)
        .send({ asset: { ...asset, sha256: undefined, relativePath: undefined } });
    },
  );

  app.get(
    '/api/bots/:botId/media/:id/file',
    { preHandler: requireSession(sessions) },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      const asset = context.database
        .listMediaAssets(botId)
        .find((item) => item.id === id && item.enabled);
      if (asset === undefined) return reply.code(404).send({ error: 'Imagen no encontrada.' });
      const root = context.mediaDirectory ?? resolve(process.cwd(), 'data', 'media');
      const content = await readFile(join(root, botId, basename(asset.relativePath)));
      return reply.type(asset.mimeType).send(content);
    },
  );

  app.delete(
    '/api/bots/:botId/media/:id',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const id = z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id;
      const asset = context.database.listMediaAssets(botId).find((item) => item.id === id) ?? null;
      if (asset === null) return reply.code(404).send({ error: 'Imagen no encontrada.' });
      const root = context.mediaDirectory ?? resolve(process.cwd(), 'data', 'media');
      const trash = join(root, '.trash', botId);
      await mkdir(trash, { recursive: true });
      const source = join(root, botId, basename(asset.relativePath));
      const destination = join(trash, `${Date.now()}-${basename(asset.relativePath)}`);
      await rename(source, destination);
      try {
        if (context.database.deleteMediaAsset(botId, id) === null) {
          await rename(destination, source);
          return reply.code(404).send({ error: 'Imagen no encontrada.' });
        }
      } catch (error) {
        await rename(destination, source);
        throw error;
      }
      audit(context, 'media_delete', String(id), 'ok', botId);
      return { deleted: true, recoverable: true };
    },
  );

  app.post(
    '/api/bots/:botId/manual-test',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const botId = parseBotId(request.params);
      const input = manualBotTestSchema.parse(request.body);
      const recipient = normalizePhoneNumber(input.recipient);
      const client = context.multiBotManager?.client(botId) ?? null;
      if (client === null || !client.isReady()) {
        return reply.code(503).send({ error: 'WhatsApp no está conectado para este asistente.' });
      }
      const bot = context.database.getBot(botId);
      if (bot === null) return reply.code(404).send({ error: 'Asistente no encontrado.' });
      if (input.kind === 'menu' && !bot.capabilities.interactiveMenusEnabled) {
        return reply
          .code(409)
          .send({ error: 'Este asistente funciona con preguntas únicas y no utiliza menús.' });
      }
      if (input.kind !== 'menu' && !bot.capabilities.catalogEnabled) {
        return reply
          .code(409)
          .send({ error: 'Este asistente no tiene funciones comerciales habilitadas.' });
      }
      if (input.kind === 'menu') {
        const menu = context.database
          .listMenus(botId)
          .find((item) => item.isInitial && item.enabled);
        if (menu === undefined)
          return reply.code(404).send({ error: 'No existe un menú inicial activo.' });
        const adapter = new InteractiveMessageAdapter(client, context.logger, botId);
        await adapter.sendMenu(
          recipient,
          menu,
          context.database.listMenuOptions(botId, menu.id),
          context.database.getBot(botId)?.menuType ?? 'numbered',
        );
      } else if (input.kind === 'catalog_item') {
        if (input.resourceId === undefined)
          return reply.code(400).send({ error: 'Selecciona un producto o servicio.' });
        await client.sendMessage(
          recipient,
          new CatalogService(context.database, botId).itemText(input.resourceId),
        );
      } else {
        if (input.resourceId === undefined || client.sendMedia === undefined) {
          return reply.code(400).send({ error: 'Selecciona una imagen compatible.' });
        }
        const asset = context.database
          .listMediaAssets(botId)
          .find((item) => item.id === input.resourceId && item.enabled);
        if (asset === undefined)
          return reply.code(404).send({ error: 'La imagen no está disponible.' });
        const root = context.mediaDirectory ?? resolve(process.cwd(), 'data', 'media');
        await client.sendMedia(
          recipient,
          join(root, botId, basename(asset.relativePath)),
          asset.caption,
        );
      }
      audit(
        context,
        `manual_${input.kind}_test`,
        context.anonymizer.identifier(recipient),
        'sent',
        botId,
      );
      return { sent: true, kind: input.kind };
    },
  );

  app.post(
    '/api/auth/logout',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      sessions.destroy(request.cookies[COOKIE_NAME]);
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return { authenticated: false };
    },
  );

  app.get('/api/administrators', { preHandler: requireSession(sessions) }, async () => ({
    administrators: context.database.listAdministrators().map((phoneNumber) => ({
      key: context.anonymizer.identifier(phoneNumber),
      masked: maskPhoneNumber(phoneNumber),
    })),
  }));

  app.post(
    '/api/administrators',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const number = z.object({ number: z.string().trim() }).parse(request.body).number;
      const phoneNumber = normalizePhoneNumber(number);
      if (!context.database.addAdministrator(phoneNumber)) {
        return reply.code(409).send({ error: 'El administrador ya existe.' });
      }
      const key = context.anonymizer.identifier(phoneNumber);
      audit(context, 'administrator_add', key, 'ok');
      return reply.code(201).send({ key, masked: maskPhoneNumber(phoneNumber) });
    },
  );

  app.delete(
    '/api/administrators/:key',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const key = z.object({ key: z.string().length(20) }).parse(request.params).key;
      const phoneNumber = context.database
        .listAdministrators()
        .find((item) => context.anonymizer.identifier(item) === key);
      if (phoneNumber === undefined || !context.database.removeAdministrator(phoneNumber)) {
        return reply.code(404).send({ error: 'Administrador no encontrado.' });
      }
      audit(context, 'administrator_remove', key, 'ok');
      return { deleted: true };
    },
  );

  app.get(
    '/api/admin/maintenance/status',
    { preHandler: requireSession(sessions) },
    async (request, reply) => {
      if (context.maintenance === undefined) {
        return reply.code(503).send({
          error: 'El servicio de mantenimiento no está disponible.',
          code: 'MAINTENANCE_UNAVAILABLE',
        });
      }
      const query = z
        .object({ operationId: z.string().length(24).optional() })
        .parse(request.query ?? {});
      const snapshot = context.maintenance.snapshot();
      const acknowledgeLogout =
        query.operationId !== undefined &&
        query.operationId === snapshot.operationId &&
        snapshot.logoutRequired &&
        snapshot.result !== 'running' &&
        snapshot.result !== 'idle';
      if (acknowledgeLogout) {
        sessions.clearAll();
        reply.clearCookie(COOKIE_NAME, { path: '/' });
      }
      return snapshot;
    },
  );

  app.post(
    '/api/admin/maintenance/factory-reset',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      if (context.maintenance === undefined) return maintenanceUnavailable(reply);
      if (context.maintenance.isRunning()) return maintenanceAlreadyRunning(reply);
      const input = factoryResetSchema.parse(request.body);
      if (!maintenanceGate.canAttempt(request.ip)) {
        return maintenanceRejection(
          reply,
          429,
          'RESET_RATE_LIMITED',
          'Se alcanzó temporalmente el límite de intentos de mantenimiento.',
        );
      }
      if (input.confirmation !== 'RESTABLECER BOT' || input.understood !== true) {
        maintenanceGate.failure(request.ip);
        return maintenanceRejection(
          reply,
          400,
          'RESET_CONFIRMATION_INVALID',
          'La frase o la casilla de confirmación no son válidas.',
        );
      }
      const session = getSession(request, sessions) as PanelSession;
      const currentHash = context.database.getPanelPasswordHash(session.username);
      if (currentHash === null || !(await verifyPassword(input.currentPassword, currentHash))) {
        maintenanceGate.failure(request.ip);
        return maintenanceRejection(
          reply,
          401,
          'RESET_PASSWORD_INVALID',
          'La contraseña actual no es válida.',
        );
      }
      maintenanceGate.success(request.ip);
      const passwordHash =
        input.passwordChoice === 'replace'
          ? await hashPassword(input.newPassword as string)
          : currentHash;
      try {
        const operationId = context.maintenance.startFactoryReset({
          passwordHash,
          administratorHash: context.anonymizer.identifier(`panel:${session.username}`),
        });
        scheduleFactoryResetSessionInvalidation(context.maintenance, sessions, context.logger);
        return reply.code(202).send({
          accepted: true,
          operationId,
          code: 'FACTORY_RESET_STARTED',
        });
      } catch (error) {
        return maintenanceStartFailure(error, reply);
      }
    },
  );

  return app;
}

function adminConversationResponse(
  conversation: ReturnType<AppDatabase['listConversations']>['items'][number],
) {
  return {
    id: conversation.id,
    customerName: conversation.contactName,
    waId: conversation.waId,
    assistantId: conversation.assistantId,
    assistantName: conversation.assistantName,
    status: conversation.status,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt,
    lastMessage:
      conversation.lastMessage === null
        ? null
        : {
            direction: conversation.lastMessage.direction,
            messageType: conversation.lastMessage.messageType,
            text: conversation.lastMessage.text,
            caption: conversation.lastMessage.caption,
            status: conversation.lastMessage.whatsappStatus,
            timestamp: conversation.lastMessage.timestamp,
          },
  };
}

function utcDateBoundary(value: string, addDays = 0): string | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (matched === null) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day + addDays));
  if (
    addDays === 0 &&
    (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day)
  ) {
    return null;
  }
  return date.toISOString();
}

function requireSession(sessions: SessionStore) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (getSession(request, sessions) === null) {
      await reply.code(401).send({ error: 'Se requiere iniciar sesión.' });
    }
  };
}

function requireCsrf(sessions: SessionStore) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = getSession(request, sessions);
    const header = request.headers['x-csrf-token'];
    if (session === null || typeof header !== 'string' || header !== session.csrfToken) {
      await reply.code(403).send({ error: 'Token CSRF inválido.' });
    }
  };
}

function getSession(request: FastifyRequest, sessions: SessionStore): PanelSession | null {
  return sessions.get(request.cookies[COOKIE_NAME]);
}

function cookieOptions(request: FastifyRequest) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: request.protocol === 'https',
    maxAge: 8 * 60 * 60,
  };
}

function audit(
  context: AdminServerContext,
  actionType: string,
  resource: string,
  result: string,
  botId?: string,
): void {
  context.database.recordAudit({
    ...(botId === undefined ? {} : { botId }),
    actionType,
    resource,
    result,
    administratorHash: context.anonymizer.identifier('panel:admin'),
  });
}

function parseBotId(params: unknown): string {
  return z.object({ botId: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u) }).parse(params).botId;
}

function moduleForProtectedRoute(route: string): AssistantModuleKey | null {
  if (route.includes('/catalog')) return 'catalog';
  if (route.includes('/media')) return 'media';
  if (route.includes('/hours')) return 'hours';
  if (route.includes('/requests')) return 'requests';
  if (route.includes('/menus')) return 'menus';
  return null;
}

function botIdForProtectedRoute(request: FastifyRequest, route: string): string | null {
  if (route.includes(':botId')) {
    const value = (request.params as { botId?: unknown } | null)?.botId;
    return typeof value === 'string' && /^[a-z][a-z0-9-]{2,39}$/u.test(value) ? value : null;
  }
  return null;
}

function isGlobalAdministratorRoute(route: string, method: string): boolean {
  return (
    route.startsWith('/api/administrators') ||
    route.startsWith('/api/admin/maintenance') ||
    route === '/api/ai/global-limits' ||
    (route === '/api/bots' && method === 'POST')
  );
}

function safeBotResponse(bot: NonNullable<ReturnType<AppDatabase['getBot']>>) {
  return {
    id: bot.id,
    businessId: bot.businessId,
    businessName: bot.businessName,
    businessDescription: bot.businessDescription,
    businessLanguage: bot.businessLanguage,
    businessStatus: bot.businessStatus,
    channel: bot.channel,
    isPrimary: bot.isPrimary,
    internalIdentifier: bot.internalIdentifier,
    connectorType: bot.connectorType,
    lifecycleStatus: bot.lifecycleStatus,
    deletionLocked: bot.deletionLocked,
    deletedAt: bot.deletedAt,
    scheduledPermanentDeletionAt: bot.scheduledPermanentDeletionAt,
    capabilities: bot.capabilities,
    enabled: bot.enabled,
    profileId: bot.profileId,
    organizationName: bot.organizationName,
    botName: bot.botName,
    organizationType: bot.organizationType,
    timezone: bot.timezone,
    whatsappStatus: bot.whatsappStatus,
    maskedNumber: bot.maskedNumber,
    lastConnectedAt: bot.lastConnectedAt,
    continuedConversationsEnabled: bot.continuedConversationsEnabled,
    menuType: bot.menuType,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}

function adminPhoneNumberFor(context: AdminServerContext, botId: string): string | null {
  return context.database.getWhatsAppConnection(botId).displayPhoneNumber;
}

function adminWhatsAppConnection(context: AdminServerContext, botId: string) {
  const { credentialReference: omittedCredentialReference, ...connection } =
    context.database.getWhatsAppConnection(botId);
  void omittedCredentialReference;
  return connection;
}

function adminBotResponse(
  context: AdminServerContext,
  bot: NonNullable<ReturnType<AppDatabase['getBot']>>,
) {
  return {
    ...safeBotResponse(bot),
    phoneNumber: adminPhoneNumberFor(context, bot.id),
    meta: metaConfigurationFor(context, bot.id),
  };
}

function metaConfigurationFor(context: AdminServerContext, botId: string) {
  const connection = context.database.getWhatsAppConnection(botId);
  const account = context.multiBotManager?.metaConfiguration(botId) ?? {
    configured: false,
    credentialsMissing: ['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_WABA_ID'],
    phoneNumberIdConfigured: connection.phoneNumberIdConfigured,
    wabaIdConfigured: connection.wabaIdConfigured,
    setupMode: connection.setupMode,
    connectionStatus: connection.status,
    webhookStatus: connection.webhookStatus,
    lastErrorCode: null,
  };
  const webhookCredentialsMissing = [
    ...(context.metaWebhook?.appSecret === undefined ? ['META_APP_SECRET'] : []),
    ...(context.metaWebhook?.verifyToken === undefined ? ['META_WEBHOOK_VERIFY_TOKEN'] : []),
  ];
  const webhookAvailable = webhookCredentialsMissing.length === 0;
  return {
    ...account,
    configured: account.configured && webhookAvailable,
    credentialsMissing: [...account.credentialsMissing, ...webhookCredentialsMissing],
    webhookAvailable,
  };
}

function readinessFor(
  context: AdminServerContext,
  bot: NonNullable<ReturnType<AppDatabase['getBot']>>,
) {
  const meta = metaConfigurationFor(context, bot.id);
  const provider = context.aiProviderFactory?.forBot(bot.id);
  const settings = context.database.getAISettings(bot.profileId);
  const status = context.database.getAIProviderStatus(
    bot.profileId,
    provider?.isConfigured() ?? false,
    provider?.getModelInformation().model ?? 'disabled',
  );
  const registry = new AIProviderRegistry(context.aiProviderFactory?.defaultModel());
  return calculateAssistantReadiness(context.database, bot, {
    metaConfigured: meta.configured,
    webhookAvailable: meta.webhookAvailable,
    phoneNumberIdConfigured: meta.phoneNumberIdConfigured,
    metaLastErrorCode: meta.lastErrorCode,
    aiConfigured: provider?.isConfigured() ?? false,
    aiSelectionValid: registry.isAllowedModel(settings.provider, settings.model),
    aiConnection: status.connection,
  });
}

function safeConnectorConflict(
  context: AdminServerContext,
  bot: NonNullable<ReturnType<AppDatabase['getBot']>>,
) {
  const conflict = context.database.getConnectorConflict(bot.id);
  if (conflict === null) return null;
  const existing = context.database.getBot(conflict.existingBotId);
  if (existing === null) return { reason: conflict.reason };
  return {
    reason: conflict.reason,
    existingAssistantId: existing.id,
    existingAssistantName: existing.botName,
    existingAssistantType: existing.organizationType,
    existingAssistantStatus: existing.lifecycleStatus,
    phoneNumber: adminPhoneNumberFor(context, existing.id),
  };
}

function localPeriod(now: Date, timezone: string): { date: string; month: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return { date, month: date.slice(0, 7) };
}

function matchesImageSignature(
  content: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
): boolean {
  if (mimeType === 'image/png') {
    return (
      content.length >= 8 &&
      content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (mimeType === 'image/jpeg')
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  return (
    content.length >= 12 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function exceedsSafeDefaults(settings: z.infer<typeof aiSettingsSchema>): boolean {
  return (
    settings.questionMaxChars > 300 ||
    settings.contextMaxTokens > 700 ||
    settings.inputMaxTokens > 1000 ||
    settings.responseMaxTokens > 120 ||
    settings.responseMaxChars > 600 ||
    settings.responseMaxLines > 5 ||
    settings.temperature > 0.2 ||
    settings.userHourlyLimit > 20 ||
    settings.userDailyLimit > 50 ||
    settings.interactionHourlyLimit > 60 ||
    settings.interactionCooldownSeconds > 3 ||
    settings.duplicateQueryWindowSeconds > 15 ||
    settings.conversationHourlyLimit > 150 ||
    settings.conversationDailyLimit > 500 ||
    settings.globalDailyLimit > 500 ||
    settings.globalMonthlyLimit > 10_000 ||
    settings.globalDailyTokenLimit > 50_000 ||
    settings.globalMonthlyTokenLimit > 1_000_000 ||
    settings.timeoutMs > 15_000
  );
}

function maintenanceUnavailable(reply: FastifyReply): FastifyReply {
  return reply.code(503).send({
    error: 'El servicio de mantenimiento no está disponible.',
    code: 'MAINTENANCE_UNAVAILABLE',
  });
}

function maintenanceRejection(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  error: string,
): FastifyReply {
  return reply.code(statusCode).send({ error, code });
}

function maintenanceStartFailure(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof MaintenanceAlreadyRunningError) {
    return maintenanceRejection(reply, 409, error.code, error.message);
  }
  throw error;
}

function maintenanceAlreadyRunning(reply: FastifyReply): FastifyReply {
  return maintenanceRejection(
    reply,
    409,
    'RESET_ALREADY_RUNNING',
    'Ya existe una operación de mantenimiento en curso.',
  );
}

function scheduleFactoryResetSessionInvalidation(
  maintenance: MaintenanceService,
  sessions: SessionStore,
  logger: Logger,
): void {
  maintenance
    .waitForCompletion()
    .then(() => {
      const timer = setTimeout(() => sessions.clearAll(), 2000);
      timer.unref();
    })
    .catch((error: unknown) => {
      logger.error(
        {
          ...serializeError(error, 'RESET_SESSION_INVALIDATION_FAILED', false),
          operation: 'factoryResetSessionInvalidation',
        },
        'No fue posible programar el cierre de sesiones administrativas',
      );
    });
}
