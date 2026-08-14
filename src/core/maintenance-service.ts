import { randomBytes } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Logger } from 'pino';
import { serializeError } from '../infrastructure/safe-error.js';
import type { AppDatabase } from '../persistence/database.js';

export type MaintenanceOperation = 'factory_reset';
export type MaintenanceResult = 'running' | 'completed' | 'failed';
export type MaintenanceStage =
  | 'idle'
  | 'verifying_authorization'
  | 'stopping_messaging'
  | 'closing_database'
  | 'deleting_previous_state'
  | 'creating_database'
  | 'restoring_defaults'
  | 'restarting_services'
  | 'ready'
  | 'finished';

export type MaintenanceSnapshot = {
  operationId: string | null;
  operation: MaintenanceOperation | null;
  result: MaintenanceResult | 'idle';
  stage: MaintenanceStage;
  code: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  logoutRequired: boolean;
};

export type MaintenanceServiceOptions = {
  projectRoot: string;
  databasePath: string;
  now?: () => Date;
  beforeStage?: (stage: MaintenanceStage) => void | Promise<void>;
  resetTransientState?: () => void;
  stopMessaging: () => Promise<void>;
  startMessaging: () => Promise<void>;
};

type FactoryResetInput = {
  passwordHash: string;
  administratorHash: string;
};

const DATABASE_PATTERN = /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/iu;

export class MaintenanceAlreadyRunningError extends Error {
  public readonly code = 'RESET_ALREADY_RUNNING';

  public constructor() {
    super('Ya existe una operación de mantenimiento en curso.');
    this.name = 'MaintenanceAlreadyRunningError';
  }
}

export class UnsafeMaintenancePathError extends Error {
  public readonly code = 'RESET_PATH_OUTSIDE_PROJECT';

  public constructor() {
    super('La configuración contiene una ruta de mantenimiento no permitida.');
    this.name = 'UnsafeMaintenancePathError';
  }
}

export class MaintenanceService {
  private readonly projectRoot: string;
  private readonly dataRoot: string;
  private readonly databasePath: string;
  private readonly temporaryRoots: string[];
  private readonly now: () => Date;
  private current: MaintenanceSnapshot = emptySnapshot();
  private activeOperation: Promise<void> | null = null;

  public constructor(
    private readonly database: AppDatabase,
    private readonly logger: Logger,
    private readonly options: MaintenanceServiceOptions,
  ) {
    this.projectRoot = resolve(options.projectRoot);
    this.dataRoot = resolve(this.projectRoot, 'data');
    this.databasePath = resolve(options.databasePath);
    this.temporaryRoots = [
      resolve(this.projectRoot, 'logs'),
      resolve(this.projectRoot, 'tmp'),
      resolve(this.projectRoot, 'temp'),
    ];
    this.now = options.now ?? (() => new Date());
    this.validateConfiguredPaths();
  }

  public isRunning(): boolean {
    return this.activeOperation !== null;
  }

  public snapshot(): MaintenanceSnapshot {
    return { ...this.current };
  }

  public startFactoryReset(input: FactoryResetInput): string {
    this.assertAvailable();
    const operationId = randomBytes(12).toString('hex');
    this.current = {
      operationId,
      operation: 'factory_reset',
      result: 'running',
      stage: 'verifying_authorization',
      code: 'FACTORY_RESET_STARTED',
      startedAt: this.now().toISOString(),
      finishedAt: null,
      logoutRequired: true,
    };
    this.recordAudit('factory_reset', 'started', input.administratorHash, 0);
    this.activeOperation = this.runFactoryReset(input).finally(() => {
      this.activeOperation = null;
    });
    return operationId;
  }

  public async waitForCompletion(): Promise<MaintenanceSnapshot> {
    await this.activeOperation;
    return this.snapshot();
  }

  private async runFactoryReset(input: FactoryResetInput): Promise<void> {
    const startedAt = Date.now();
    let databaseClosed = false;
    try {
      await this.changeStage('stopping_messaging');
      await this.options.stopMessaging();

      await this.changeStage('closing_database');
      this.database.checkpoint();
      this.database.close();
      databaseClosed = true;

      await this.changeStage('deleting_previous_state');
      await this.deleteFactoryResetTargets();

      await this.changeStage('creating_database');
      this.database.reopen();
      databaseClosed = false;
      this.database.migrate();
      this.database.setPanelPasswordHash(input.passwordHash);

      await this.changeStage('restoring_defaults');
      this.assertFactoryDefaults();
      this.options.resetTransientState?.();

      await this.changeStage('restarting_services');
      await this.options.startMessaging();
      await this.changeStage('ready');
      this.finish('completed', 'FACTORY_RESET_COMPLETED');
      this.recordAudit(
        'factory_reset',
        'completed',
        input.administratorHash,
        Date.now() - startedAt,
      );
    } catch (error) {
      const failureCode = factoryFailureCode(this.current.stage, error);
      this.logFailure(error, failureCode);
      await this.recoverStoppedServices(databaseClosed);
      this.finish('failed', failureCode);
      this.recordAudit(
        'factory_reset',
        'failed',
        input.administratorHash,
        Date.now() - startedAt,
        failureCode,
      );
    }
  }

  private async deleteFactoryResetTargets(): Promise<void> {
    for (const path of await listFiles(this.dataRoot, (candidate) =>
      DATABASE_PATTERN.test(candidate),
    )) {
      assertAllowedMaintenancePath(this.projectRoot, path, this.dataRoot);
      await rm(path, { force: true });
    }
    for (const root of this.temporaryRoots) {
      assertAllowedMaintenancePath(this.projectRoot, root, root);
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });
    }
    await mkdir(dirname(this.databasePath), { recursive: true });
  }

  private async recoverStoppedServices(databaseClosed: boolean): Promise<void> {
    try {
      await this.options.stopMessaging();
      if (databaseClosed && !this.database.isOpen()) {
        this.database.reopen();
        this.database.migrate();
      }
      await this.options.startMessaging();
    } catch (error) {
      this.logFailure(error, 'RESET_RECOVERY_FAILED');
    }
  }

  private assertFactoryDefaults(): void {
    const assistants = this.database.listBots();
    if (assistants.length !== 1 || assistants[0]?.enabled !== false) {
      throw new Error('No se restauró el asistente empresarial de ejemplo desactivado.');
    }
    if (this.database.getAdministratorCount() !== 0) {
      throw new Error('La base de datos nueva contiene administradores anteriores.');
    }
  }

  private validateConfiguredPaths(): void {
    if (
      !DATABASE_PATTERN.test(this.databasePath) ||
      this.database.getPath() !== this.databasePath
    ) {
      throw new UnsafeMaintenancePathError();
    }
    assertAllowedMaintenancePath(this.projectRoot, this.dataRoot, this.projectRoot);
    assertAllowedMaintenancePath(this.projectRoot, this.databasePath, this.dataRoot);
    assertNoSymbolicLinks(this.projectRoot, this.databasePath);
    for (const root of this.temporaryRoots) {
      assertAllowedMaintenancePath(this.projectRoot, root, this.projectRoot);
    }
  }

  private assertAvailable(): void {
    if (this.activeOperation !== null) throw new MaintenanceAlreadyRunningError();
  }

  private async changeStage(stage: MaintenanceStage): Promise<void> {
    this.current = { ...this.current, stage, code: 'FACTORY_RESET_STARTED' };
    await this.options.beforeStage?.(stage);
    this.logger.info(
      {
        operation: 'maintenanceStage',
        maintenanceOperation: this.current.operation,
        operationId: this.current.operationId,
        stage,
        code: this.current.code,
      },
      'Etapa de mantenimiento actualizada',
    );
  }

  private finish(result: Exclude<MaintenanceResult, 'running'>, code: string): void {
    this.current = {
      ...this.current,
      result,
      stage: 'finished',
      code,
      finishedAt: this.now().toISOString(),
    };
  }

  private recordAudit(
    actionType: string,
    result: string,
    administratorHash: string,
    durationMs: number,
    errorCode?: string,
  ): void {
    try {
      if (!this.database.isOpen()) return;
      this.database.recordAudit({
        actionType,
        resource: 'maintenance',
        result,
        administratorHash,
        durationMs,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
    } catch (error) {
      this.logFailure(error, 'MAINTENANCE_AUDIT_FAILED');
    }
  }

  private logFailure(error: unknown, code: string): void {
    this.logger.error(
      {
        ...serializeError(error, code, false),
        operation: 'maintenanceFailure',
        maintenanceOperation: this.current.operation,
        operationId: this.current.operationId,
        stage: this.current.stage,
      },
      'Falló una operación de mantenimiento',
    );
  }
}

export function assertAllowedMaintenancePath(
  projectRoot: string,
  candidatePath: string,
  allowedRoot: string,
): void {
  const project = resolve(projectRoot);
  const candidate = resolve(candidatePath);
  const allowed = resolve(allowedRoot);
  if (
    !isInside(project, allowed) ||
    !isInside(project, candidate) ||
    !isInside(allowed, candidate)
  ) {
    throw new UnsafeMaintenancePathError();
  }
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function assertNoSymbolicLinks(projectRoot: string, candidatePath: string): void {
  const project = resolve(projectRoot);
  const candidate = resolve(candidatePath);
  let current = project;
  for (const part of relative(project, candidate)
    .split(/[\\/]+/u)
    .filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new UnsafeMaintenancePathError();
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }
}

async function listFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && predicate(path)) files.push(path);
    }
  }
  return files.sort();
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    Reflect.get(error, 'code') === 'ENOENT'
  );
}

function factoryFailureCode(stage: MaintenanceStage, error: unknown): string {
  if (error instanceof UnsafeMaintenancePathError) return error.code;
  const byStage: Partial<Record<MaintenanceStage, string>> = {
    stopping_messaging: 'RESET_MESSAGING_STOP_FAILED',
    closing_database: 'RESET_DATABASE_CLOSE_FAILED',
    deleting_previous_state: 'RESET_DATABASE_DELETE_FAILED',
    creating_database: 'RESET_DATABASE_CREATE_FAILED',
    restoring_defaults: 'RESET_DATABASE_CREATE_FAILED',
    restarting_services: 'RESET_MESSAGING_RESTART_FAILED',
    ready: 'RESET_MESSAGING_RESTART_FAILED',
  };
  return byStage[stage] ?? 'FACTORY_RESET_FAILED';
}

function emptySnapshot(): MaintenanceSnapshot {
  return {
    operationId: null,
    operation: null,
    result: 'idle',
    stage: 'idle',
    code: null,
    startedAt: null,
    finishedAt: null,
    logoutRequired: false,
  };
}
