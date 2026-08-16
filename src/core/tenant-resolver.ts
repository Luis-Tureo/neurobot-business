import type { AppDatabase } from '../persistence/database.js';

export type ResolvedTenant = {
  businessId: string;
  assistantId: string;
  phoneNumberId: string;
};

export class TenantResolver {
  public constructor(private readonly database: AppDatabase) {}

  public byPhoneNumberId(phoneNumberId: string): ResolvedTenant | null {
    const assistantId = this.database.getBotIdByMetaPhoneNumberId(phoneNumberId);
    if (assistantId === null) return null;
    const assistant = this.database.getBot(assistantId);
    if (assistant === null) return null;
    return { businessId: assistant.businessId, assistantId, phoneNumberId };
  }

  public requireByPhoneNumberId(phoneNumberId: string): ResolvedTenant {
    const tenant = this.byPhoneNumberId(phoneNumberId);
    if (tenant === null) throw new Error('META_PHONE_NUMBER_NOT_CONFIGURED');
    return tenant;
  }
}
