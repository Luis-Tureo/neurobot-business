import type { BotRecord } from '../domain/types.js';

export type AssistantModuleKey =
  | 'overview'
  | 'whatsapp'
  | 'profile'
  | 'menus'
  | 'catalog'
  | 'media'
  | 'hours'
  | 'knowledge'
  | 'cached-answers'
  | 'ai'
  | 'requests'
  | 'statistics';

const common: AssistantModuleKey[] = [
  'overview',
  'whatsapp',
  'profile',
  'knowledge',
  'cached-answers',
  'ai',
  'statistics',
];
const business: AssistantModuleKey[] = ['menus', 'catalog', 'media', 'hours', 'requests'];

export class AssistantModuleVisibilityService {
  public visibleModules(bot: BotRecord): AssistantModuleKey[] {
    if (['ARCHIVED', 'PENDING_DELETION', 'DELETED'].includes(bot.lifecycleStatus)) return [];
    const modules = new Set<AssistantModuleKey>(common);
    business.forEach((module) => modules.add(module));
    if (!bot.capabilities.catalogEnabled) {
      modules.delete('catalog');
      modules.delete('media');
      modules.delete('hours');
    }
    if (!bot.capabilities.interactiveMenusEnabled) modules.delete('menus');
    if (!bot.capabilities.humanAssistanceEnabled) modules.delete('requests');
    return [...modules];
  }

  public assertVisible(bot: BotRecord, module: AssistantModuleKey): void {
    if (!this.visibleModules(bot).includes(module))
      throw new Error('ASSISTANT_MODULE_NOT_AVAILABLE');
  }
}
