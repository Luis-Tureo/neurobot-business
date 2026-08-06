import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AutomaticMessageConfiguration, AutomaticMessageType, AutomaticTaskType, GroupJoinEvent, ScheduledDeliveryStatus, WelcomeParticipant } from '../domain/types.js';
import { serializeError } from '../infrastructure/safe-error.js';
import { normalizeWhatsAppIdentity, isSupportedGroupId } from '../messaging/identifiers.js';
import type { MessagingClient } from '../messaging/messaging-client.js';
import type { AppDatabase } from '../persistence/database.js';
import type { Anonymizer } from '../security/anonymizer.js';
import { ExpiringSet } from './expiring-cache.js';
export type LocalDateTime = {
  date: string;
  time: string;
  minuteOfDay: number;
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
};
export type AutomaticSendResult = {
  status: ScheduledDeliveryStatus;
  attempts: number;
  errorCode: string | null;
};
export type AutomaticMessageServiceOptions = {
  botId?: string;
  tickIntervalMs?: number;
  retryDelayMs?: number;
  groupBackoffMs?: number;
  welcomeDeduplicationTtlMs?: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  isPaused?: () => boolean;
};
type WelcomeBatch = {
  id: string;
  participants: Map<string, WelcomeParticipant>;
  timer: ReturnType<typeof setTimeout>;
};
export class AutomaticMessageService {
  private readonly tickIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly groupBackoffMs: number;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly isPaused: () => boolean;
  private readonly botId: string;
  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private tickPromise: Promise<void> | null = null;
  private started = false;
  public constructor(private readonly database: AppDatabase, private readonly client: MessagingClient, private readonly logger: Logger, private readonly anonymizer: Anonymizer, options: AutomaticMessageServiceOptions = {}) {
    this.tickIntervalMs = options.tickIntervalMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.groupBackoffMs = options.groupBackoffMs ?? 30 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? wait;
    this.isPaused = options.isPaused ?? (() => false);
    this.botId = options.botId ?? 'neurobot';
  }
  public start(): void {
    if (this.started) return;
    this.started = true;
    this.record('AUTOMATIC_SCHEDULER_STARTED', null, null, 'started');
    this.scheduleNextTick(0);
  }
  public stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.schedulerTimer !== null) clearTimeout(this.schedulerTimer);
    this.schedulerTimer = null;
    this.record('AUTOMATIC_SCHEDULER_STOPPED', null, null, 'stopped');
  }
  public reconfigure(): void {
    if (!this.started) return;
    if (this.schedulerTimer !== null) clearTimeout(this.schedulerTimer);
    this.schedulerTimer = null;
    this.record('AUTOMATIC_SCHEDULER_RECONFIGURED', null, null, 'updated');
    this.scheduleNextTick(0);
  }
  public isStarted(): boolean {
    return this.started;
  }

  public async runDueTasks(now = this.now()): Promise<void> {
    if (this.isPaused()) return;
    await this.runTaskIfDue('DAILY_GREETING', configuration, local, now);
  }

  private scheduleNextTick(delay: number): void {
    this.schedulerTimer = setTimeout(() => {
      this.tickPromise ??= this.runDueTasks().catch((error: unknown) => {
        const details = serializeError(error, 'SCHEDULER_TICK_FAILED', false);
        this.record('SCHEDULED_MESSAGE_FAILED', null, null, 'failed', details.errorCode);
      }).finally(() => {
        this.tickPromise = null;
        this.scheduleNextTick(this.tickIntervalMs);
      });
    }, delay);
    this.schedulerTimer.unref?.();
  }
  private async runTaskIfDue(configuration: AutomaticMessageConfiguration, now: Date): Promise<void> {
    if (!task.enabled || !isInsideTolerance(local.minuteOfDay, task.sendTime, task.toleranceMinutes)) {
      return;
    }
    this.record(`${taskType}_SCHEDULED`, taskType, null, 'due', null, local);
    const text = this.selectTemplate(taskType, configuration, local.weekday);
  }
  private async sendAndRecord(deliveryId: number, taskType: AutomaticMessageType, groupId: string, text: string, local: LocalDateTime, now: Date): Promise<AutomaticSendResult> {
    let attempts = 0;
    let errorCode: string | null = null;
    while (attempts < 2) {
      attempts += 1;
      try {
        if (taskType === 'WELCOME') {
        }
          try {
            await this.client.sendMessage(groupId, text, mentionIds);
          } catch (mentionError) {
            this.record('WELCOME_REAL_MENTION_FAILED', taskType, this.hash(groupId), 'fallback', details.errorCode, local);
          }
        } else {
        }
      } catch (error) {
        const details = serializeError(error, 'AUTOMATIC_SEND_FAILED', false);
        errorCode = failure.errorCode;
        if (failure.permanent) {
          break;
        }
      }
    }
    this.database.updateScheduledDelivery(deliveryId, 'FAILED', attempts, errorCode);
    if (taskType === 'WELCOME') {
    }
  }

  private record(eventType: string, taskType: AutomaticMessageType | null, groupHash: string | null, result: string, errorCode: string | null = null, local = toLocalDateTime(this.now(), this.database.getBot(this.botId)?.timezone ?? 'America/Santiago'), attempt?: number): void {
    this.logger.info(fields, 'Evento de mensajes automáticos');
    try {
    } catch (error) {
    }
  }
  private hash(groupId: string): string {
    return this.anonymizer.identifier(groupId);
  }
}

export function toLocalDateTime(date: Date, timezone: string): LocalDateTime {
  const values = new Map(parts.map(part => [part.type, part.value]));
  const year = requirePart(values, 'year', timezone);
  const day = requirePart(values, 'day', timezone);
  const hour = Number(requirePart(values, 'hour', timezone));
  const minute = Number(requirePart(values, 'minute', timezone));
  const weekday = requirePart(values, 'weekday', timezone) as LocalDateTime['weekday'];
}
function isInsideTolerance(currentMinute: number, sendTime: string, toleranceMinutes: number): boolean {
  const match = /^(\d{2}):(\d{2})$/u.exec(sendTime);
  if (match === null) return false;
  const scheduledMinute = Number(match[1]) * 60 + Number(match[2]);
  return currentMinute >= scheduledMinute && currentMinute <= scheduledMinute + toleranceMinutes;
}
function classifySendFailure(error: unknown, fallbackCode: string): {
  errorCode: string;
  permanent: boolean;
} {
  const message = error instanceof Error ? error.message : '';
  const permanentByCode = /(?:INVALID|NOT_FOUND|NOT_REGISTERED|NOT_PARTICIPANT|UNKNOWN_GROUP|PRIVATE_CHAT)/u.test(fallbackCode);
  const permanentByMessage = /(?:invalid.+(?:chat|wid|group)|(?:chat|group).+not.+found|not.+(?:registered|participant))/iu.test(message);
  return {
    errorCode: permanentByMessage ? 'GROUP_DESTINATION_UNAVAILABLE' : fallbackCode,
    permanent: permanentByCode || permanentByMessage
  };
}
function requirePart(values: Map<string, string>, key: string, timezone = 'America/Santiago'): string {
  const value = values.get(key);
  if (value === undefined) throw new Error(`No fue posible determinar ${key} en ${timezone}.`);
  return value;
}
function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}