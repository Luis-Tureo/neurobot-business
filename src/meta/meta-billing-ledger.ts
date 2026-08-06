import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MetaTemplateCategory } from './template-library.js';

export type MetaMessageDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';

type TemplateSubmittedEvent = {
  type: 'template_submitted';
  botId: string;
  messageId: string;
  templateName: string;
  category: MetaTemplateCategory;
  customerReference: string;
  occurredAt: string;
};

type MessageStatusEvent = {
  type: 'message_status';
  botId: string;
  messageId: string;
  status: MetaMessageDeliveryStatus;
  occurredAt: string;
  errorCode: string | null;
};

export type MetaBillingEvent = TemplateSubmittedEvent | MessageStatusEvent;

export type MetaMonthlyUsageSummary = {
  month: string;
  submitted: number;
  deliveredOrRead: number;
  failed: number;
  byCategory: Record<MetaTemplateCategory, number>;
};

export class MetaBillingLedger {
  public constructor(private readonly path: string) {}

  public async recordTemplateSubmitted(input: Omit<TemplateSubmittedEvent, 'type'>): Promise<void> {
    await this.append({ type: 'template_submitted', ...input });
  }

  public async recordStatus(input: Omit<MessageStatusEvent, 'type'>): Promise<void> {
    await this.append({ type: 'message_status', ...input });
  }

  public async summarizeMonth(month: string): Promise<MetaMonthlyUsageSummary> {
    if (!/^\d{4}-\d{2}$/u.test(month)) throw new Error('El mes debe tener el formato AAAA-MM.');
    const events = await this.readEvents();
    const submitted = new Map<string, TemplateSubmittedEvent>();
    const finalStatus = new Map<string, MessageStatusEvent>();

    for (const event of events) {
      if (!event.occurredAt.startsWith(month)) continue;
      if (event.type === 'template_submitted') submitted.set(event.messageId, event);
      else finalStatus.set(event.messageId, event);
    }

    const byCategory: Record<MetaTemplateCategory, number> = {
      UTILITY: 0,
      MARKETING: 0,
      AUTHENTICATION: 0,
    };
    let deliveredOrRead = 0;
    let failed = 0;

    for (const [messageId, submission] of submitted) {
      const status = finalStatus.get(messageId)?.status;
      if (status === 'delivered' || status === 'read') {
        deliveredOrRead += 1;
        byCategory[submission.category] += 1;
      } else if (status === 'failed') {
        failed += 1;
      }
    }

    return {
      month,
      submitted: submitted.size,
      deliveredOrRead,
      failed,
      byCategory,
    };
  }

  private async append(event: MetaBillingEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, 'utf8');
  }

  private async readEvents(): Promise<MetaBillingEvent[]> {
    try {
      const content = await readFile(this.path, 'utf8');
      return content
        .split(/\r?\n/u)
        .filter((line) => line.trim() !== '')
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as MetaBillingEvent];
          } catch {
            return [];
          }
        });
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
