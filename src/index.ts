import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AIProviderFactory } from './ai/ai-provider-factory.js';
import { buildAdminServer } from './admin/server.js';
import { loadEnvironment } from './config/environment.js';
import { MaintenanceService } from './core/maintenance-service.js';
import { MultiBotManager } from './core/multi-bot-manager.js';
import { createLogger } from './infrastructure/logger.js';
import { serializeError } from './infrastructure/safe-error.js';
import { AppDatabase } from './persistence/database.js';
import { Anonymizer } from './security/anonymizer.js';
import { hashPassword } from './security/password.js';

async function main(): Promise<void> {
  const environment = loadEnvironment();
  if (await isApplicationAlreadyRunning(environment.panelHost, environment.panelPort)) {
    process.stdout.write(
      `El panel ya está funcionando en http://${displayHost(environment.panelHost)}:${environment.panelPort}. No es necesario iniciar otra copia.\n`,
    );
    return;
  }
  const logger = createLogger(environment.logLevel);
  const database = new AppDatabase(environment.databasePath);
  database.migrate();
  await ensureInitialAdministrator(database, environment.panelInitialPassword);

  const anonymizer = new Anonymizer(environment.anonymizationSecret);
  const aiProviders = new AIProviderFactory(
    database,
    environment.groqApiKey,
    environment.groqModel,
    environment.aiProvider,
  );
  let maintenance: MaintenanceService | null = null;
  const multiBotManager = new MultiBotManager(
    database,
    aiProviders,
    anonymizer,
    logger,
    {
      maxMessageLength: environment.maxMessageLength,
      maxReconnectAttempts: environment.maxReconnectAttempts,
      maxReconnectDelayMs: environment.maxReconnectDelayMs,
      developmentMode: environment.developmentMode,
      mediaRoot: resolve(process.cwd(), 'data', 'media'),
      isPaused: () => maintenance?.isRunning() ?? false,
    },
    environment.metaWhatsApp,
  );
  await multiBotManager.prepareAll();
  maintenance = new MaintenanceService(database, logger, {
    projectRoot: process.cwd(),
    databasePath: environment.databasePath,
    resetTransientState: () => multiBotManager.resetTransientState(),
    stopMessaging: () => multiBotManager.stopAll(),
    startMessaging: () => multiBotManager.startAll(),
  });

  const packageData = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    version: string;
  };
  const server = await buildAdminServer({
    database,
    anonymizer,
    logger,
    sessionSecret: environment.panelSessionSecret,
    applicationVersion: packageData.version,
    developmentMode: environment.developmentMode,
    maintenance,
    multiBotManager,
    aiProviderFactory: aiProviders,
    metaWebhook: {
      ...(environment.metaWhatsApp.appSecret === undefined
        ? {}
        : { appSecret: environment.metaWhatsApp.appSecret }),
      ...(environment.metaWhatsApp.webhookVerifyToken === undefined
        ? {}
        : { verifyToken: environment.metaWhatsApp.webhookVerifyToken }),
    },
  });

  await server.listen({ host: environment.panelHost, port: environment.panelPort });
  logger.info(
    { host: environment.panelHost, port: environment.panelPort },
    'Panel administrativo local iniciado',
  );
  void multiBotManager.startAll().catch((error: unknown) => {
    logger.error(
      {
        operation: 'MULTIBOT_START_FAILED',
        ...serializeError(error, 'MULTIBOT_START_FAILED', false),
      },
      'No fue posible completar el inicio de todos los asistentes',
    );
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Cierre controlado iniciado');
    await server.close();
    await multiBotManager.stopAll();
    database.close();
    logger.info('Aplicación cerrada correctamente');
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  if (typeof process.send === 'function') {
    process.once('message', (message) => {
      if (message === 'shutdown') void shutdown('IPC');
    });
  }
}

async function isApplicationAlreadyRunning(host: string, port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`http://${displayHost(host)}:${port}/api/health`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { ok?: unknown };
    return payload.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

async function ensureInitialAdministrator(
  database: AppDatabase,
  configuredPassword: string | undefined,
): Promise<void> {
  if (database.getPanelPasswordHash() !== null) return;
  const password = configuredPassword ?? randomBytes(18).toString('base64url');
  database.setPanelPasswordHash(await hashPassword(password));
  if (configuredPassword === undefined) {
    process.stderr.write(
      `\nContraseña temporal del panel (se muestra una sola vez): ${password}\n` +
        'Guárdala de forma segura; no se volverá a mostrar.\n\n',
    );
  }
}

void main().catch((error: unknown) => {
  const details = serializeError(error, 'APPLICATION_START_FAILED', true);
  process.stderr.write(`No fue posible iniciar la aplicación: ${details.errorMessage}\n`);
  process.exitCode = 1;
});
