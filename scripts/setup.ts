import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type EnvironmentEntry = {
  key: string;
  createValue: () => string;
  replaceWhenBlank?: boolean;
  replaceValues?: string[];
};

const destination = resolve(process.cwd(), '.env');
const deprecatedKeys = new Set(['WHATSAPP_SESSION_PATH', 'CHROME_EXECUTABLE_PATH']);

const entries: EnvironmentEntry[] = [
  { key: 'NODE_ENV', createValue: () => 'development' },
  { key: 'PANEL_HOST', createValue: () => '127.0.0.1' },
  { key: 'PANEL_PORT', createValue: () => '3001', replaceValues: ['3000'] },
  {
    key: 'DATABASE_PATH',
    createValue: () => './data/asistente-negocio.db',
    replaceValues: ['./data/asistente.db'],
  },
  { key: 'LOG_LEVEL', createValue: () => 'info' },
  {
    key: 'ANONYMIZATION_SECRET',
    createValue: () => randomBytes(48).toString('base64url'),
    replaceWhenBlank: true,
  },
  {
    key: 'PANEL_SESSION_SECRET',
    createValue: () => randomBytes(48).toString('base64url'),
    replaceWhenBlank: true,
  },
  { key: 'PANEL_INITIAL_PASSWORD', createValue: () => '' },
  { key: 'USER_RATE_LIMIT', createValue: () => '3' },
  { key: 'GROUP_RATE_LIMIT', createValue: () => '10' },
  { key: 'RATE_WINDOW_SECONDS', createValue: () => '60' },
  { key: 'USER_COOLDOWN_SECONDS', createValue: () => '5' },
  { key: 'REPEAT_WINDOW_SECONDS', createValue: () => '120' },
  { key: 'MAX_MESSAGE_LENGTH', createValue: () => '2000' },
  { key: 'MAX_RECONNECT_ATTEMPTS', createValue: () => '8' },
  { key: 'MAX_RECONNECT_DELAY_SECONDS', createValue: () => '300' },
  { key: 'DEVELOPMENT_MODE', createValue: () => 'false' },
  { key: 'META_ACCESS_TOKEN', createValue: () => '' },
  { key: 'META_PHONE_NUMBER_ID', createValue: () => '' },
  { key: 'META_WABA_ID', createValue: () => '' },
  { key: 'META_APP_SECRET', createValue: () => '' },
  { key: 'META_WEBHOOK_VERIFY_TOKEN', createValue: () => '' },
  { key: 'META_GRAPH_API_VERSION', createValue: () => 'v25.0' },
  { key: 'META_REQUEST_TIMEOUT_MS', createValue: () => '10000' },
  { key: 'META_WHATSAPP_ACCOUNTS_JSON', createValue: () => '' },
  { key: 'AI_PROVIDER', createValue: () => 'groq' },
  { key: 'GROQ_API_KEY', createValue: () => '' },
  { key: 'GROQ_MODEL', createValue: () => 'llama-3.1-8b-instant' },
  {
    key: 'APP_ENCRYPTION_KEY',
    createValue: () => randomBytes(32).toString('base64url'),
    replaceWhenBlank: true,
  },
];

function findEntryIndex(lines: string[], key: string): number {
  const prefix = `${key}=`;
  return lines.findIndex((line) => line.trimStart().startsWith(prefix));
}

function configuredValue(line: string): string {
  const separator = line.indexOf('=');
  return separator === -1 ? '' : line.slice(separator + 1).trim();
}

function needsSecureReplacement(value: string): boolean {
  return value.length === 0 || /^reemplace-/iu.test(value);
}

function shouldReplace(entry: EnvironmentEntry, value: string): boolean {
  if (entry.replaceWhenBlank === true && needsSecureReplacement(value)) return true;
  return entry.replaceValues?.includes(value) ?? false;
}

async function main(): Promise<void> {
  if (!existsSync(destination)) {
    const content = `${entries.map((entry) => `${entry.key}=${entry.createValue()}`).join('\n')}\n`;
    await writeFile(destination, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(
      'Configuración local creada en .env con secretos aleatorios y el panel en el puerto 3001.\n',
    );
    return;
  }

  const current = await readFile(destination, 'utf8');
  const originalLines = current.replace(/\r\n/gu, '\n').split('\n');
  const lines = originalLines.filter((line) => {
    const key = line.slice(0, line.indexOf('=')).trim();
    return !deprecatedKeys.has(key);
  });
  const changedKeys: string[] = [];
  const removedDeprecatedConfiguration = lines.length !== originalLines.length;

  for (const entry of entries) {
    const index = findEntryIndex(lines, entry.key);
    if (index === -1) {
      lines.push(`${entry.key}=${entry.createValue()}`);
      changedKeys.push(entry.key);
      continue;
    }

    if (shouldReplace(entry, configuredValue(lines[index] ?? ''))) {
      lines[index] = `${entry.key}=${entry.createValue()}`;
      changedKeys.push(entry.key);
    }
  }

  if (changedKeys.length === 0 && !removedDeprecatedConfiguration) {
    process.stdout.write('El archivo .env ya está completo; no se modificó.\n');
    return;
  }

  while (lines.at(-1) === '') lines.pop();
  await writeFile(destination, `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  process.stdout.write(
    `Se reparó el archivo .env. Variables agregadas o regeneradas: ${changedKeys.join(', ') || 'ninguna'}${
      removedDeprecatedConfiguration ? '; configuración obsoleta retirada' : ''
    }.\n`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`No fue posible preparar el archivo .env: ${message}\n`);
  process.exitCode = 1;
});
