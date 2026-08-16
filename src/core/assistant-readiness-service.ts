import type { AssistantReadiness, BotRecord } from '../domain/types.js';
import type { AppDatabase } from '../persistence/database.js';

export type AssistantReadinessContext = {
  metaConfigured: boolean;
  webhookAvailable: boolean;
  phoneNumberIdConfigured: boolean;
  metaLastErrorCode: string | null;
  aiConfigured: boolean;
  aiSelectionValid: boolean;
  aiConnection: 'not_tested' | 'successful' | 'failed';
};

export function calculateAssistantReadiness(
  database: AppDatabase,
  bot: BotRecord,
  context: AssistantReadinessContext,
): AssistantReadiness {
  const business = database.getBusiness(bot.businessId);
  const ai = database.getAISettings(bot.profileId);
  const behavior = database.getAssistantBehavior(bot.id);
  const knowledgeEntries = database.countEnabledKnowledgeEntries(bot.id);
  const connectionError =
    bot.lifecycleStatus === 'DUPLICATE_CONFIGURATION' ||
    bot.whatsappStatus === 'auth_failure' ||
    context.metaLastErrorCode !== null;
  const whatsapp = connectionError
    ? 'ERROR'
    : bot.whatsappStatus === 'connected' && context.metaConfigured && context.webhookAvailable
      ? 'CONNECTED'
      : context.phoneNumberIdConfigured || bot.lifecycleStatus === 'LINKING'
        ? 'CONFIGURING'
        : 'NOT_CONFIGURED';

  const aiState =
    context.aiConnection === 'failed' || !context.aiSelectionValid
      ? 'ERROR'
      : ai.provider === 'groq' && ai.enabled && context.aiConfigured
        ? 'GROQ_CONNECTED'
        : 'NOT_CONFIGURED';
  const knowledge = knowledgeEntries > 0 ? 'CONFIGURED' : 'EMPTY';
  const missingRequirements: string[] = [];
  if (
    business === null ||
    business.name.trim() === '' ||
    business.description.trim() === '' ||
    business.language.trim() === '' ||
    business.timezone.trim() === ''
  ) {
    missingRequirements.push('Completa la identidad del negocio.');
  }
  if (whatsapp !== 'CONNECTED') {
    missingRequirements.push('Conecta y valida el canal de WhatsApp.');
  }
  if (ai.provider !== 'groq') missingRequirements.push('Selecciona Groq como proveedor de IA.');
  if (!context.aiSelectionValid) missingRequirements.push('Selecciona un modelo Groq permitido.');
  if (!ai.enabled) missingRequirements.push('Activa la inteligencia artificial.');
  if (!context.aiConfigured) {
    missingRequirements.push('Configura la credencial Groq administrada por la plataforma.');
  }
  if (behavior.useBusinessKnowledge && knowledge === 'EMPTY') {
    missingRequirements.push('Agrega al menos una entrada de conocimiento activa.');
  }
  if (behavior.fallbackMessage.trim() === '') {
    missingRequirements.push('Configura el mensaje alternativo del asistente.');
  }

  const canActivate = missingRequirements.length === 0;
  const assistant =
    whatsapp === 'ERROR' || aiState === 'ERROR'
      ? 'ERROR'
      : bot.enabled && canActivate
        ? 'OPERATIONAL'
        : bot.lifecycleStatus === 'DISABLED'
          ? 'PAUSED'
          : canActivate
            ? 'READY_TO_TEST'
            : 'DRAFT';
  return { whatsapp, ai: aiState, knowledge, assistant, canActivate, missingRequirements };
}
