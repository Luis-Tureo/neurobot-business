import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { AIProvider } from '../ai/ai-provider.js';
import type { AIProviderFactory } from '../ai/ai-provider-factory.js';
import { hashNormalizedQuestion, normalizeQuestionForCache } from '../ai/answer-cache-service.js';
import { CatalogService } from '../core/catalog-service.js';
import { AUTOMATIC_TEMPLATE_KEYS, DEFAULT_AUTOMATIC_MESSAGE_CONFIGURATION } from '../core/automatic-message-defaults.js';
import { messageMetrics } from '../core/brief-message-defaults.js';
import { AssistantModuleVisibilityService, type AssistantModuleKey } from '../core/assistant-module-visibility-service.js';
import { InteractiveMessageAdapter } from '../core/interactive-message-adapter.js';
import { MaintenanceAlreadyRunningError, type MaintenanceService } from '../core/maintenance-service.js';
import type { MultiBotManager } from '../core/multi-bot-manager.js';
import { applyProfilePreset, createProfileFromPreset, PROFILE_PRESETS } from '../core/profile-presets.js';
import type { WhatsAppSessionManager } from '../core/whatsapp-session-manager.js';
import { toLocalDateTime } from '../core/automatic-message-service.js';
import { serializeError } from '../infrastructure/safe-error.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import type { SecretVault } from '../security/secret-vault.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { assertPlainText, maskPhoneNumber, normalizeBotIdentifier, normalizeParticipantId } from '../utils/text.js';
import { LoginAttemptGate, SessionStore, type PanelSession } from './session-store.js';
const COOKIE_NAME = 'panel_session';
const organizationTypeSchema = z.enum(['Comunidad', 'Tienda', 'Restaurante', 'Distribuidora', 'Servicio profesional', 'Organización social', 'Institución educativa', 'Otro']);
const profileFieldsSchema = z.object({
  internalName: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(1).max(160),
  botName: z.string().trim().min(1).max(80),
  activationAlias: z.string().trim().startsWith('@').max(80),
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
  mentionPromptMessage: z.string().trim().min(1).max(600),
  communityGreetingMessage: z.string().trim().min(1).max(1200),
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
  supportInformation: z.string().trim().max(500)
}).strict();
const knowledgeCategorySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean()
}).strict();
const knowledgeEntrySchema = z.object({
  id: z.number().int().positive().optional(),
  categoryId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  keywords: z.array(z.string().trim().min(1).max(180)).max(50),
  synonyms: z.array(z.string().trim().min(1).max(180)).max(50),
  enabled: z.boolean(),
  priority: z.number().int().min(-100).max(100),
  internalSource: z.string().trim().max(300).nullable()
}).strict();
const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['groq', 'disabled']),
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
  groupHourlyLimit: z.number().int().min(1).max(2000),
  groupDailyLimit: z.number().int().min(1).max(10_000),
  globalDailyLimit: z.number().int().min(1).max(100_000),
  globalMonthlyLimit: z.number().int().min(1).max(1_000_000),
  globalDailyTokenLimit: z.number().int().min(1).max(100_000_000),
  globalMonthlyTokenLimit: z.number().int().min(1).max(1_000_000_000),
  timeoutMs: z.number().int().min(1000).max(60_000),
  confirmIncreasedLimits: z.boolean().default(false)
}).strict();
const cachedAnswerCreateSchema = z.object({
  canonicalQuestion: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(8000),
  category: z.string().trim().min(1).max(200),
  sourceType: z.enum(['ADMIN_FAQ', 'MANUAL']).default('ADMIN_FAQ'),
  variants: z.array(z.string().trim().min(1).max(1000)).max(30).default([])
}).strict();
const cachedAnswerActionSchema = z.object({
  action: z.enum(['approve', 'edit', 'disable', 'invalidate', 'convert_faq', 'add_variant', 'regenerate', 'view_sources']),
  answer: z.string().trim().min(1).max(8000).optional(),
  category: z.string().trim().min(1).max(200).optional(),
  variant: z.string().trim().min(1).max(1000).optional()
}).strict();
const resetCountersSchema = z.object({
  password: z.string().min(1).max(200),
  confirmation: z.literal('RESTABLECER CONTADORES')
}).strict();
const trashAssistantSchema = z.object({
  password: z.string().min(1).max(200),
  confirmationName: z.string().trim().min(1).max(160)
}).strict();
const restoreAssistantSchema = z.object({
  confirmed: z.literal(true)
}).strict();
const permanentlyDeleteAssistantSchema = z.object({
  password: z.string().min(1).max(200),
  confirmationPhrase: z.string().trim().min(1).max(240)
}).strict();
const transferCommercialConfigurationSchema = z.object({
  password: z.string().min(1).max(200),
  confirmationPhrase: z.literal('TRANSFERIR A NEUROBOT')
}).strict();
const panelEventSchema = z.object({
  eventType: z.enum(['GLOBAL_PANEL_OPENED', 'ASSISTANT_ADMIN_OPENED', 'ASSISTANT_CONTEXT_CHANGED']),
  assistantId: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u).optional()
}).strict();
const globalAILimitsSchema = z.object({
  dailyRequestLimit: z.number().int().min(1).max(100_000),
  monthlyRequestLimit: z.number().int().min(1).max(1_000_000),
  dailyTokenLimit: z.number().int().min(1).max(100_000_000),
  monthlyTokenLimit: z.number().int().min(1).max(1_000_000_000)
}).strict();
const botCreateSchema = z.object({
  id: z.preprocess(value => typeof value === 'string' ? normalizeBotIdentifier(value) : value, z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u, 'Escribe un identificador de al menos 3 caracteres.')),
  organizationName: z.string().trim().min(1).max(160),
  botName: z.string().trim().min(1).max(80),
  organizationType: organizationTypeSchema,
  timezone: z.string().trim().min(1).max(80),
  mode: z.enum(['community', 'business', 'mixed']),
  connectorType: z.enum(['WHATSAPP_WEB', 'WHATSAPP_CLOUD_API']),
  provider: z.enum(['groq', 'disabled']),
  preset: z.enum(['community', 'store', 'restaurant', 'distributor', 'service', 'empty']),
  menuType: z.enum(['automatic', 'native_buttons', 'native_list', 'numbered']).default('automatic')
}).strict();
const botConfigurationSchema = z.object({
  mode: z.enum(['community', 'business', 'mixed']),
  enabled: z.boolean(),
  groupsEnabled: z.boolean(),
  privateMessagesEnabled: z.boolean(),
  realMentionRequired: z.boolean(),
  continuedConversationsEnabled: z.boolean(),
  menuType: z.enum(['automatic', 'native_buttons', 'native_list', 'numbered'])
}).strict();
const activationAliasesSchema = z.object({
  aliases: z.array(z.string().trim().regex(/^@[\p{L}\p{N}_.-]{2,40}$/u)).min(1).max(10)
}).strict();
const menuSchema = z.object({
  id: z.number().int().positive().optional(),
  parentMenuId: z.number().int().positive().nullable(),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(600),
  helpText: z.string().trim().max(300),
  enabled: z.boolean(),
  isInitial: z.boolean(),
  expirationMinutes: z.number().int().min(1).max(1440)
}).strict();
const menuOptionSchema = z.object({
  id: z.number().int().positive().optional(),
  menuId: z.number().int().positive(),
  label: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20),
  order: z.number().int().min(1).max(100),
  actionType: z.enum(['text', 'catalog_item', 'catalog_category', 'media', 'submenu', 'knowledge', 'ai', 'hours', 'address', 'payments', 'shipping', 'human_assistance', 'reservation_request', 'back', 'exit']),
  actionPayload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  enabled: z.boolean()
}).strict();
const catalogCategorySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600),
  enabled: z.boolean()
}).strict();
const catalogItemSchema = z.object({
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
  enabled: z.boolean()
}).strict();
const businessHourSchema = z.object({
  weekday: z.number().int().min(0).max(6).nullable(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  openingTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  closingTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  closed: z.boolean(),
  label: z.string().trim().max(160)
}).strict();
const manualBotTestSchema = z.object({
  kind: z.enum(['menu', 'catalog_item', 'media']),
  groupKey: z.string().length(20),
  resourceId: z.number().int().positive().optional(),
  confirmed: z.literal(true)
}).strict();
const loginSchema = z.object({
  username: z.string().trim().min(1).max(50).default('admin'),
  password: z.string().min(1).max(128)
});
const commandSchema = z.object({
  name: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,32}$/),
  response: z.string().trim().min(1).max(4000),
  enabled: z.boolean(),
  priority: z.number().int().min(-1000).max(1000),
  healthRelated: z.boolean()
});
const keywordSchema = z.object({
  keywords: z.array(z.object({
    term: z.string().trim().min(2).max(100),
    priority: z.number().int().min(-1000).max(1000),
    enabled: z.boolean()
  })).max(100)
});
const settingsSchema = z.object({
  bot_enabled: z.boolean().optional(),
  fallback_response: z.string().trim().min(1).max(4000).optional(),
  professional_warning: z.string().trim().min(1).max(1000).optional(),
  log_level: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  user_rate_limit: z.number().int().min(1).max(100).optional(),
  group_rate_limit: z.number().int().min(1).max(500).optional(),
  rate_window_seconds: z.number().int().min(10).max(3600).optional(),
  user_cooldown_seconds: z.number().int().min(0).max(3600).optional(),
  repeat_window_seconds: z.number().int().min(0).max(86_400).optional(),
  require_authorized_admin_in_group: z.boolean().optional(),
  group_archive_after_hours: z.number().int().min(1).max(720).optional(),
  group_delete_after_days: z.number().int().min(1).max(3650).optional(),
  group_auto_delete_enabled: z.boolean().optional(),
  group_sync_interval_minutes: z.number().int().min(5).max(1440).optional()
}).strict();
const welcomeTemplateSchema = z.string().trim().min(1).max(2000).superRefine((value, context) => {
  try {
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Plantilla inválida.'
    });
  }
});
const automaticManualSendSchema = z.object({
  groupKey: z.string().length(20),
  confirmed: z.literal(true),
  fictitiousName: z.string().trim().min(1).max(80).optional()
}).strict();
const welcomeGroupSettingSchema = z.object({
  groupKey: z.string().length(20),
  enabled: z.boolean(),
  inheritAssistantTemplate: z.boolean(),
  customTemplate: welcomeTemplateSchema.nullable()
}).strict();
const welcomePreviewSchema = z.object({
  fictitiousName: z.string().trim().min(1).max(80),
  groupKey: z.string().length(20).optional()
}).strict();
const pollConfigurationSchema = z.object({
  enabled: z.boolean(),
  sendTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  timezone: z.string().trim().min(1).max(80),
  toleranceMinutes: z.number().int().min(0).max(180),
  selectionMode: z.enum(['SAME_FOR_ALL', 'PER_GROUP'])
}).strict();
const pollTemplateSchema = z.object({
  id: z.number().int().positive().optional(),
  question: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(12),
  allowMultipleAnswers: z.boolean(),
  enabled: z.boolean(),
  favorite: z.boolean(),
  disabledUntil: z.string().datetime().nullable()
}).strict();
const pollOverrideSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  templateId: z.number().int().positive(),
  replaceConfirmed: z.boolean().default(false)
}).strict();
const pollManualSendSchema = z.object({
  groupKey: z.string().length(20),
  templateId: z.number().int().positive(),
  countsAsDaily: z.boolean(),
  confirmed: z.literal(true)
}).strict();
const aiQueueSettingsSchema = z.object({
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
  suggestedRetrySeconds: z.number().int().min(5).max(600)
}).strict();
const aiQueueSimulationSchema = z.object({
  requests: z.number().int().min(1).max(30),
  scenario: z.enum(['normal', 'repeated', 'rate_limited', 'timeout'])
}).strict();
const moderationSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultGroupMode: z.enum(['INHERIT', 'ENABLED', 'DISABLED']),
  reviewThreshold: z.number().int().min(1).max(20),
  warningThreshold: z.number().int().min(1).max(20),
  adminNotificationThreshold: z.number().int().min(1).max(20),
  recurrenceWindowDays: z.number().int().min(1).max(90),
  warningCooldownMinutes: z.number().int().min(1).max(1440),
  publicWarningLimit: z.number().int().min(1).max(20),
  publicWarningWindowMinutes: z.number().int().min(1).max(1440),
  temporaryEvidenceEnabled: z.boolean(),
  temporaryEvidenceHours: z.number().int().min(1).max(168),
  warningMode: z.enum(['GROUP_GENERAL', 'GROUP_MENTION', 'ADMIN_ONLY']),
  automaticAIReviewEnabled: z.literal(false),
  manualAIReviewEnabled: z.literal(false),
  automaticBanEnabled: z.literal(false),
  automaticDeletionEnabled: z.literal(false),
  firstWarningMessage: z.string().trim().min(40).max(1000),
  secondWarningMessage: z.string().trim().min(40).max(1000),
  repeatedWarningMessage: z.string().trim().min(20).max(1000)
}).strict().superRefine((value, context) => {
  if (value.reviewThreshold > value.warningThreshold) context.addIssue({
    code: 'custom',
    path: ['reviewThreshold'],
    message: 'El umbral de revisión no puede superar al de advertencia.'
  });
  const first = value.firstWarningMessage.toLocaleLowerCase('es');
  for (const phrase of ['advertencia automática', 'podría incumplir', 'generada automáticamente', 'revisada por la administración']) if (!first.includes(phrase)) context.addIssue({
    code: 'custom',
    path: ['firstWarningMessage'],
    message: `La primera advertencia debe incluir “${phrase}”.`
  });
  const second = value.secondWarningMessage.toLocaleLowerCase('es');
  for (const phrase of ['segunda advertencia automática', 'administración', 'generada automáticamente', 'no implica una expulsión automática']) if (!second.includes(phrase)) context.addIssue({
    code: 'custom',
    path: ['secondWarningMessage'],
    message: `La segunda advertencia debe incluir “${phrase}”.`
  });
});
const moderationConditionSchema = z.object({
  id: z.number().int().nonnegative().default(0),
  conditionType: z.enum(['EXACT_WORD', 'EXACT_PHRASE', 'COMBINED_WORDS', 'TERM_CONTAINS', 'REPETITION', 'FREQUENCY', 'BLOCKED_DOMAIN', 'ADVERTISING', 'PERSONAL_INFO', 'EXCESSIVE_CAPS', 'SAFE_REGEX']),
  operator: z.enum(['ALL', 'ANY', 'EXCLUDE']),
  normalizedValue: z.string().trim().max(500),
  configuration: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  enabled: z.boolean()
}).strict();
const moderationExceptionSchema = z.object({
  id: z.number().int().nonnegative().default(0),
  exceptionType: z.enum(['ADMINISTRATOR', 'EXACT_PHRASE', 'EXACT_WORD', 'ALLOWED_DOMAIN']),
  normalizedValue: z.string().trim().max(500),
  enabled: z.boolean()
}).strict();
const moderationRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  category: z.string().trim().min(1).max(80),
  severity: z.enum(['INFORMATIVA', 'LEVE', 'MEDIA', 'ALTA', 'CRITICA']),
  detectionType: z.string().trim().min(1).max(80),
  score: z.number().int().min(0).max(20),
  reviewThreshold: z.number().int().min(1).max(20),
  warningThreshold: z.number().int().min(1).max(20),
  adminNotificationThreshold: z.number().int().min(1).max(20),
  enabled: z.boolean(),
  appliesToAllGroups: z.boolean(),
  conditions: z.array(moderationConditionSchema).max(50),
  exceptions: z.array(moderationExceptionSchema).max(50)
}).strict().superRefine((value, context) => {
  if (value.enabled && !value.conditions.some(condition => condition.enabled)) context.addIssue({
    code: 'custom',
    path: ['conditions'],
    message: 'Una regla activa requiere al menos una condición.'
  });
  const valueOptional = new Set(['REPETITION', 'FREQUENCY', 'PERSONAL_INFO', 'EXCESSIVE_CAPS', 'ADVERTISING']);
  for (const [index, condition] of value.conditions.entries()) if (condition.enabled && !valueOptional.has(condition.conditionType) && condition.normalizedValue.trim() === '') context.addIssue({
    code: 'custom',
    path: ['conditions', index, 'normalizedValue'],
    message: 'Esta condición requiere un valor concreto.'
  });
  for (const [index] of value.conditions.entries()) void index;
});
const moderationTermSchema = z.object({
  ruleId: z.number().int().positive().nullable(),
  term: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80),
  severity: z.enum(['INFORMATIVA', 'LEVE', 'MEDIA', 'ALTA', 'CRITICA']),
  matchMode: z.enum(['WHOLE_WORD', 'EXACT_PHRASE']),
  score: z.number().int().min(0).max(20),
  enabled: z.boolean()
}).strict();
const moderationImportSchema = z.object({
  rules: z.array(moderationRuleSchema).max(200),
  terms: z.array(moderationTermSchema).max(1000),
  settings: moderationSettingsSchema.optional(),
  confirmed: z.literal(true)
}).strict();
const maintenanceBaseSchema = z.object({
  confirmation: z.string().max(40),
  currentPassword: z.string().min(1).max(128)
}).strict();
const factoryResetSchema = z.object({
  confirmation: z.string().max(40),
  currentPassword: z.string().min(1).max(128),
  understood: z.boolean(),
  passwordChoice: z.enum(['keep', 'replace']),
  newPassword: z.string().min(12).max(128).optional(),
  newPasswordConfirmation: z.string().min(12).max(128).optional()
}).strict().superRefine((value, context) => {
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
  connectionManager: ConnectionManager;
  anonymizer: Anonymizer;
  logger: Logger;
  sessionSecret: string;
  applicationVersion: string;
  developmentMode: boolean;
  publicDirectory?: string;
  maintenance?: MaintenanceService;
  automaticMessages?: AutomaticMessageService;
  aiProvider?: AIProvider;
  brandingDirectory?: string;
  multiBotManager?: MultiBotManager;
  aiProviderFactory?: AIProviderFactory;
  secretVault?: SecretVault;
  sessionManager?: WhatsAppSessionManager;
  mediaDirectory?: string;
};

export async function buildAdminServer(context: AdminServerContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 600 * 1024, trustProxy: false });
  const sessions = new SessionStore(context.sessionSecret);
  const loginGate = new LoginAttemptGate();
  const maintenanceGate = new LoginAttemptGate(3, 15 * 60 * 1000, 15 * 60 * 1000);
  const manualAutomaticSendGate = new Map<string, number>();
  const manualPollSendGate = new Map<string, number>();
  const moduleVisibility = new AssistantModuleVisibilityService();

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

  app.addHook('preHandler', async (request, reply) => {
    if (context.maintenance?.isRunning() !== true || !request.url.startsWith('/api/')) return;
    const route = request.routeOptions.url;
    if (
      route === '/api/health' ||
      route === '/api/admin/maintenance/status' ||
      route === '/api/admin/maintenance/factory-reset' ||
      route === '/api/admin/maintenance/unlink-whatsapp'
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
    context.logger.warn(
      {
        ...details,
        operation: 'adminRequest',
        method: request.method,
        route: request.routeOptions.url,
      },
      'Solicitud administrativa rechazada',
    );
    void reply
      .code(statusCode)
      .send({ error: statusCode >= 500 ? 'Error interno.' : details.errorMessage });
  });
  app.get('/api/health', async () => ({
    ok: true
  }));
  app.post(
    '/api/panel-events',
    { preHandler: [requireSession(sessions), requireCsrf(sessions)] },
    async (request, reply) => {
      const input = panelEventSchema.parse(request.body);
      if (input.assistantId !== undefined && context.database.getBot(input.assistantId) === null) {
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
    return { authenticated: true, csrfToken: session.csrfToken };
  });


  app.get('/api/auth/session', { preHandler: requireSession(sessions) }, async (request) => {
    const session = getSession(request, sessions) as PanelSession;
    return { authenticated: true, username: session.username, csrfToken: session.csrfToken };
  });

  app.delete('/api/bots/:botId/permanent', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    if (bot === null || bot.lifecycleStatus !== 'ARCHIVED') {
      return reply.code(404).send({
        error: 'El asistente no está en la papelera.',
        code: 'ASSISTANT_NOT_ARCHIVED'
      });
    }
    if (bot.deletionLocked) {
      return reply.code(403).send({
        error: 'Este asistente está protegido y no puede eliminarse.',
        code: 'PROTECTED_ASSISTANT_DELETION_BLOCKED'
      });
    }
    const input = permanentlyDeleteAssistantSchema.parse(request.body);
    const expectedPhrase = `ELIMINAR PERMANENTEMENTE ${bot.botName}`;
    if (input.confirmationPhrase !== expectedPhrase) {
      return reply.code(400).send({
        error: 'La frase de confirmación no coincide.',
        code: 'CONFIRMATION_PHRASE_MISMATCH'
      });
    }
    const session = getSession(request, sessions) as PanelSession;
    const backupRoot = join(dirname(context.database.getPath()), 'backups', 'assistant-deletions');
    await mkdir(backupRoot, {
      recursive: true
    });
    const databaseBackup = join(backupRoot, `${bot.id}-${stamp}.db`);
    await context.database.backupTo(databaseBackup);
    if (context.sessionManager !== undefined) {
      sessionBackup = await context.sessionManager.archive(bot);
    }
    audit(context, 'assistant_permanently_deleted', botId, 'ok', botId);
    return {
      deleted: true,
      backupCreated: true
    };
  });
  app.post('/api/bots', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    if (context.multiBotManager === undefined) return reply.code(503).send({
      error: 'El gestor multibot no está disponible.'
    });
    const profile = createProfileFromPreset(input);
    const aiSettings = context.database.getAISettings(bot.profileId);
    audit(context, 'bot_create', bot.id, 'ok', bot.id);
  });
  app.patch('/api/bots/:botId/configuration', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async request => {
    const input = botConfigurationSchema.parse(request.body);
    audit(context, 'bot_configuration_update', botId, 'ok', botId);
  });
  app.patch('/api/bots/:botId/profile', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async request => {
    const input = profileFieldsSchema.parse(request.body);
    audit(context, 'bot_profile_update', String(profile.id), 'ok', botId);
    return {
      profile
    };
  });
  app.get('/api/bots/:botId/knowledge', {
    preHandler: requireSession(sessions)
  }, async request => {
  });
  app.post('/api/bots/:botId/cached-answers', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    const botId = parseBotId(request.params);
    const input = cachedAnswerCreateSchema.parse(request.body);
    for (const variant of input.variants) {
      context.database.addCachedAnswerVariant(botId, answer.id, variant, hashNormalizedQuestion(normalizeQuestionForCache(variant)));
    }
    context.database.recordTechnicalEvent({
      botId,
      eventType: 'ANSWER_CACHE_ADMIN_APPROVED',
      result: input.sourceType
    });
    audit(context, 'cached_answer_create', String(answer.id), 'ok', botId);
  });
  app.delete('/api/bots/:botId/cached-answers/:id', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (reply) => {
    if (!context.database.deleteCachedAnswer(botId, id)) return reply.code(404).send({
      error: 'Respuesta guardada no encontrada.'
    });
    audit(context, 'cached_answer_delete', String(id), 'ok', botId);
  });
  app.get('/api/bots/:botId/moderation', {
    preHandler: requireSession(sessions)
  }, async request => {
    const profiles = context.database.listGroupModerationProfiles(botId);
  });
  app.get('/api/bots/:botId/ai/export', {
    preHandler: requireSession(sessions)
  }, async (request, reply) => {
  });
  app.post('/api/bots/:botId/restart', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    const botId = parseBotId(request.params);
    await context.multiBotManager.restart(botId);
    return {
      restarted: true
    };
  });
  app.post('/api/bots/:botId/unlink', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    if (context.multiBotManager === undefined || context.sessionManager === undefined) {
      return reply.code(503).send({
        error: 'La administración de sesiones no está disponible.'
      });
    }
    const botId = parseBotId(request.params);
    const bot = context.database.getBot(botId);
    if (bot === null) return reply.code(404).send({
      error: 'Asistente no encontrado.'
    });
    const backupPath = await context.sessionManager.archive(bot);
  });
  app.get('/api/bots/:botId/menus', {
    preHandler: requireSession(sessions)
  }, async request => {
    const botId = parseBotId(request.params);
  });
  app.get('/api/bots/:botId/catalog', {
    preHandler: requireSession(sessions)
  }, async request => {
  });
  app.patch('/api/bots/:botId/requests/:id', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async request => {
    audit(context, 'human_request_update', String(id), 'ok', botId);
  });
  app.get('/api/status', {
    preHandler: requireSession(sessions)
  }, async () => {
    const profile = context.database.getActiveAssistantProfile();
  });
  app.patch('/api/profiles/:id', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    const profile = context.database.saveAssistantProfile({
      ...existing,
      ...fixedIdentity
    });
    audit(context, 'profile_update', String(id), 'ok');
  });
  app.post('/api/branding/logo', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (reply) => {
    await writeFile(join(brandingDirectory, fileName), content, {
      flag: 'wx'
    });
  });
  app.get('/api/knowledge', {
    preHandler: requireSession(sessions)
  }, async () => {
  });
  app.post('/api/knowledge/entries', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request) => {
    const input = knowledgeEntrySchema.parse(request.body);
    const profile = context.database.getActiveAssistantProfile();
    return reply.code(input.id === undefined ? 201 : 200).send({
      entry
    });
  });
  app.get('/api/ai', {
    preHandler: requireSession(sessions)
  }, async () => {
    const model = context.aiProvider?.getModelInformation().model ?? 'disabled';
  });
  app.post('/api/ai/reset-development-counters', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    const session = getSession(request, sessions) as PanelSession;
    const profile = context.database.getActiveAssistantProfile();
    context.database.resetAIUsageForDevelopment(profile.id);
    audit(context, 'TEST_COUNTERS_RESET', String(profile.id), 'ok', 'neurobot');
  });
  app.delete('/api/groups/:key/local-record', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request) => {
    if (group === undefined) {
    }
    if (group.status !== 'ARCHIVED') {
    }
    audit(context, 'group_local_record_delete', key, 'ok');
    return {
      deleted: true
    };
  });
  app.get('/api/groups/cleanup-preview', {
    preHandler: requireSession(sessions)
  }, async () => {
  });
  app.post('/api/groups/cleanup', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async request => {
    for (const group of preview.archiveCandidates) {
    }
    audit(context, 'group_cleanup', 'groups', 'ok');
    return result;
  });
  app.delete('/api/commands/:id', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    const deleted = context.database.deleteCommand(id);
    if (!deleted) return reply.code(404).send({
      error: 'Comando no encontrado.'
    });
    return {
      deleted: true
    };
  });
  app.patch('/api/settings', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async request => {
    for (const [key, value] of Object.entries(input)) {
    }
    context.groupDiscovery.reconfigurePeriodic();
  });
  app.get('/api/polls', {
    preHandler: requireSession(sessions)
  }, async (request) => {
    const botId = parseBotIdQuery(request.query, context);
    const services = pollServicesFor(context, botId);
    const groups = context.database.listBotGroups(botId, identifier => context.anonymizer.identifier(identifier));
    const templates = repository.templates();
  });
  app.post('/api/polls/templates', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    if (services === null) return pollServiceUnavailable(reply);
    const repository = services.repository;
    const existed = input.id === undefined ? null : repository.template(input.id);
    const eventType = !template.enabled ? 'POLL_TEMPLATE_DISABLED' : existed === null ? 'POLL_TEMPLATE_CREATED' : 'POLL_TEMPLATE_UPDATED';
  });
  app.post('/api/polls/templates/:id/restore', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    const botId = parseBotIdQuery(request.query, context);
    if (services === null) return pollServiceUnavailable(reply);
    const restored = services.repository.restoreDefaultTemplate(id, context.anonymizer.identifier(session.username));
    if (!restored) return reply.code(409).send({
      error: 'Esta encuesta ya se encuentra disponible.',
      code: 'POLL_TEMPLATE_ALREADY_ACTIVE'
    });
    return {
      restored: true
    };
  });
  app.put('/api/polls/overrides', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    if (services === null) return pollServiceUnavailable(reply);
    const repository = services.repository;
    audit(context, 'poll_override_save', input.localDate, 'ok', botId);
    return {
      override
    };
  });
  app.post('/api/connection/restart', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async () => {
    await context.connectionManager.restart();
    audit(context, 'connection_restart', 'whatsapp', 'ok');
  });
  app.post('/api/admin/maintenance/factory-reset', {
    preHandler: [requireSession(sessions), requireCsrf(sessions)]
  }, async (request, reply) => {
    if (!maintenanceGate.canAttempt(request.ip)) {
    }
    if (input.confirmation !== 'RESTABLECER BOT' || input.understood !== true) {
      maintenanceGate.failure(request.ip);
    }
    if (currentHash === null || !(await verifyPassword(input.currentPassword, currentHash))) {
      maintenanceGate.failure(request.ip);
    }
    maintenanceGate.success(request.ip);
  });
  return app;
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
  return z
    .object({ botId: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u) })
    .parse(params).botId;
}

function parseBotIdQuery(query: unknown, context: AdminServerContext): string {
  const botId = z
    .object({ botId: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{2,39}$/u).default('neurobot') })
    .passthrough()
    .parse(query ?? {}).botId;
  if (context.database.getBot(botId) === null) throw new Error('El asistente no existe.');
  return botId;
}

function moduleForProtectedRoute(route: string): AssistantModuleKey | null {
  if (route.startsWith('/api/automatic-messages')) return 'automatic-messages';
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
  if (route.startsWith('/api/automatic-messages')) {
    const value = (request.query as { botId?: unknown } | null)?.botId ?? 'neurobot';
    return typeof value === 'string' && /^[a-z][a-z0-9-]{2,39}$/u.test(value) ? value : null;
  }
  return null;
}

function automaticMessagesFor(context: AdminServerContext, botId: string) {
  return context.multiBotManager?.automaticMessages(botId) ??
    (botId === 'neurobot' ? context.automaticMessages ?? null : null);
}

function safeBotResponse(bot: NonNullable<ReturnType<AppDatabase['getBot']>>) {
  return {
    id: bot.id,
    internalIdentifier: bot.internalIdentifier,
    mode: bot.mode,
    connectorType: bot.connectorType,
    operatingMode: bot.operatingMode,
    lifecycleStatus: bot.lifecycleStatus,
    deletionLocked: bot.deletionLocked,
    deletedAt: bot.deletedAt,
    scheduledPermanentDeletionAt: bot.scheduledPermanentDeletionAt,
    groupChannelEnabled: bot.groupChannelEnabled,
    privateChannelEnabled: bot.privateChannelEnabled,
    privateBusinessModeEnabled: bot.privateBusinessModeEnabled,
    connectorMigrationLocked: bot.connectorMigrationLocked,
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
    groupsEnabled: bot.groupsEnabled,
    privateMessagesEnabled: bot.privateMessagesEnabled,
    realMentionRequired: bot.realMentionRequired,
    continuedConversationsEnabled: bot.continuedConversationsEnabled,
    menuType: bot.menuType,
    aiCredentialMode: bot.aiCredentialMode,
    aiKeyConfigured: bot.perBotAIKeyConfigured,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}

function adminPhoneNumberFor(context: AdminServerContext, botId: string): string | null {
  return context.multiBotManager?.adminPhoneNumber(botId) ?? null;
}

function adminBotResponse(context: AdminServerContext, bot: NonNullable<ReturnType<AppDatabase['getBot']>>) {
  return { ...safeBotResponse(bot), phoneNumber: adminPhoneNumberFor(context, bot.id) };
}

function isSecureCredentialRequest(request: FastifyRequest): boolean {
  const hostname = request.hostname.toLocaleLowerCase('en');
  return (
    request.protocol === 'https' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
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

function matchesImageSignature(content: Buffer, mimeType: 'image/png' | 'image/jpeg' | 'image/webp'): boolean {
  if (mimeType === 'image/png') {
    return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === 'image/jpeg') return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  return content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP';
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
    settings.groupHourlyLimit > 150 ||
    settings.groupDailyLimit > 500 ||
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

function maintenanceRejection(reply: FastifyReply, statusCode: number, code: string, error: string): FastifyReply {
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