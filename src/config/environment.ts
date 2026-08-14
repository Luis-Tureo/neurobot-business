import { resolve } from 'node:path';
import { z } from 'zod';

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);
const optionalMetaSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(16).optional(),
);
const optionalMetaAccessToken = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(20).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PANEL_HOST: z.string().trim().default('127.0.0.1'),
  PANEL_PORT: z.coerce.number().int().min(1024).max(65_535).default(3001),
  DATABASE_PATH: z.string().trim().default('./data/asistente-negocio.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ANONYMIZATION_SECRET: z.string().min(32),
  PANEL_SESSION_SECRET: z.string().min(32),
  PANEL_INITIAL_PASSWORD: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(12).max(128).optional(),
  ),
  MAX_MESSAGE_LENGTH: z.coerce.number().int().min(100).max(10_000).default(2000),
  MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  MAX_RECONNECT_DELAY_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),
  DEVELOPMENT_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  META_ACCESS_TOKEN: optionalMetaAccessToken,
  META_PHONE_NUMBER_ID: optionalTrimmedString,
  META_WABA_ID: optionalTrimmedString,
  META_APP_SECRET: optionalMetaSecret,
  META_WEBHOOK_VERIFY_TOKEN: optionalMetaSecret,
  META_GRAPH_API_VERSION: z
    .string()
    .trim()
    .regex(/^v\d+\.\d+$/u)
    .default('v25.0'),
  META_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  META_WHATSAPP_ACCOUNTS_JSON: optionalTrimmedString,
  AI_PROVIDER: z.enum(['groq', 'disabled']).default('groq'),
  GROQ_API_KEY: optionalTrimmedString,
  GROQ_MODEL: z.string().trim().min(1).max(120).default('llama-3.1-8b-instant'),
  APP_ENCRYPTION_KEY: optionalTrimmedString,
});

export type Environment = {
  nodeEnvironment: 'development' | 'test' | 'production';
  panelHost: string;
  panelPort: number;
  databasePath: string;
  logLevel: string;
  anonymizationSecret: string;
  panelSessionSecret: string;
  panelInitialPassword?: string;
  maxMessageLength: number;
  maxReconnectAttempts: number;
  maxReconnectDelayMs: number;
  developmentMode: boolean;
  metaWhatsApp: MetaWhatsAppConfiguration;
  aiProvider: 'groq' | 'disabled';
  groqApiKey?: string;
  groqModel: string;
  appEncryptionKey?: string;
};

export type MetaWhatsAppAccountConfiguration = {
  botId: string;
  accessToken?: string;
  phoneNumberId?: string;
  wabaId?: string;
};

export type MetaWhatsAppConfiguration = {
  apiVersion: string;
  requestTimeoutMs: number;
  appSecret?: string;
  webhookVerifyToken?: string;
  accounts: MetaWhatsAppAccountConfiguration[];
};

const metaAccountSchema = z
  .object({
    botId: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u),
    accessToken: z.string().trim().min(20),
    phoneNumberId: z.string().regex(/^\d{6,30}$/u),
    wabaId: z.string().regex(/^\d{6,30}$/u),
  })
  .strict();

export function loadEnvironment(
  values: Record<string, string | undefined> = process.env,
  baseDirectory = process.cwd(),
): Environment {
  const parsed = environmentSchema.safeParse(values);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'configuración'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración inválida: ${details}`);
  }

  const value = parsed.data;
  const accounts = parseMetaAccounts(value);
  validateProductionMetaConfiguration(value, accounts);
  return {
    nodeEnvironment: value.NODE_ENV,
    panelHost: value.PANEL_HOST,
    panelPort: value.PANEL_PORT,
    databasePath: resolve(baseDirectory, value.DATABASE_PATH),
    logLevel: value.LOG_LEVEL,
    anonymizationSecret: value.ANONYMIZATION_SECRET,
    panelSessionSecret: value.PANEL_SESSION_SECRET,
    ...(value.PANEL_INITIAL_PASSWORD === undefined
      ? {}
      : { panelInitialPassword: value.PANEL_INITIAL_PASSWORD }),
    maxMessageLength: value.MAX_MESSAGE_LENGTH,
    maxReconnectAttempts: value.MAX_RECONNECT_ATTEMPTS,
    maxReconnectDelayMs: value.MAX_RECONNECT_DELAY_SECONDS * 1000,
    developmentMode: value.DEVELOPMENT_MODE,
    metaWhatsApp: {
      apiVersion: value.META_GRAPH_API_VERSION,
      requestTimeoutMs: value.META_REQUEST_TIMEOUT_MS,
      ...(value.META_APP_SECRET === undefined ? {} : { appSecret: value.META_APP_SECRET }),
      ...(value.META_WEBHOOK_VERIFY_TOKEN === undefined
        ? {}
        : { webhookVerifyToken: value.META_WEBHOOK_VERIFY_TOKEN }),
      accounts,
    },
    aiProvider: value.AI_PROVIDER,
    ...(value.GROQ_API_KEY === undefined ? {} : { groqApiKey: value.GROQ_API_KEY }),
    groqModel: value.GROQ_MODEL,
    ...(value.APP_ENCRYPTION_KEY === undefined
      ? {}
      : { appEncryptionKey: value.APP_ENCRYPTION_KEY }),
  };
}

function parseMetaAccounts(
  value: z.infer<typeof environmentSchema>,
): MetaWhatsAppAccountConfiguration[] {
  const accounts: MetaWhatsAppAccountConfiguration[] = [];
  if (value.META_WHATSAPP_ACCOUNTS_JSON !== undefined) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(value.META_WHATSAPP_ACCOUNTS_JSON);
    } catch {
      throw new Error(
        'Configuración inválida: META_WHATSAPP_ACCOUNTS_JSON no contiene JSON válido.',
      );
    }
    const parsed = z.array(metaAccountSchema).max(100).safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        'Configuración inválida: META_WHATSAPP_ACCOUNTS_JSON contiene una cuenta inválida.',
      );
    }
    accounts.push(...parsed.data);
  }

  if (
    value.META_ACCESS_TOKEN !== undefined ||
    value.META_PHONE_NUMBER_ID !== undefined ||
    value.META_WABA_ID !== undefined
  ) {
    accounts.push({
      botId: 'neurobot',
      ...(value.META_ACCESS_TOKEN === undefined ? {} : { accessToken: value.META_ACCESS_TOKEN }),
      ...(value.META_PHONE_NUMBER_ID === undefined
        ? {}
        : {
            phoneNumberId: validateMetaIdentifier(
              value.META_PHONE_NUMBER_ID,
              'META_PHONE_NUMBER_ID',
            ),
          }),
      ...(value.META_WABA_ID === undefined
        ? {}
        : { wabaId: validateMetaIdentifier(value.META_WABA_ID, 'META_WABA_ID') }),
    });
  }

  const botIds = new Set<string>();
  const phoneNumberIds = new Set<string>();
  for (const account of accounts) {
    if (botIds.has(account.botId)) {
      throw new Error(`Configuración inválida: la cuenta Meta de ${account.botId} está duplicada.`);
    }
    botIds.add(account.botId);
    if (account.phoneNumberId !== undefined) {
      if (phoneNumberIds.has(account.phoneNumberId)) {
        throw new Error(
          'Configuración inválida: un META_PHONE_NUMBER_ID está asignado a dos asistentes.',
        );
      }
      phoneNumberIds.add(account.phoneNumberId);
    }
  }
  return accounts;
}

function validateProductionMetaConfiguration(
  value: z.infer<typeof environmentSchema>,
  accounts: MetaWhatsAppAccountConfiguration[],
): void {
  if (value.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (value.META_APP_SECRET === undefined) missing.push('META_APP_SECRET');
  if (value.META_WEBHOOK_VERIFY_TOKEN === undefined) missing.push('META_WEBHOOK_VERIFY_TOKEN');
  if (accounts.length === 0) missing.push('META_ACCESS_TOKEN/META_PHONE_NUMBER_ID/META_WABA_ID');
  for (const account of accounts) {
    if (account.accessToken === undefined) missing.push(`${account.botId}:accessToken`);
    if (account.phoneNumberId === undefined) missing.push(`${account.botId}:phoneNumberId`);
    if (account.wabaId === undefined) missing.push(`${account.botId}:wabaId`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Configuración inválida: faltan credenciales obligatorias de Meta (${missing.join(', ')}).`,
    );
  }
}

function validateMetaIdentifier(value: string, name: string): string {
  if (!/^\d{6,30}$/u.test(value)) {
    throw new Error(`Configuración inválida: ${name} debe contener solamente dígitos.`);
  }
  return value;
}
