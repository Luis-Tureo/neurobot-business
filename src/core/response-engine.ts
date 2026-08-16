import type {
  AssistantBehaviorSettings,
  ConversationResponse,
  ResponseOption,
  SemanticResponse,
  ToolExecutionResult,
  ToolResultItem,
} from '../domain/types.js';

export type ResponseEngineInput = {
  semantic: SemanticResponse;
  toolResult?: ToolExecutionResult;
  behavior: AssistantBehaviorSettings;
  title?: string;
  createDynamicId?: (item: ToolResultItem) => string;
};

export class ResponseEngine {
  public build(input: ResponseEngineInput): ConversationResponse {
    if (input.toolResult === undefined) {
      return { presentation: 'text', message: safeMessage(input.semantic.message), options: [] };
    }
    if (input.toolResult.source !== 'BUSINESS_DATA') {
      throw new Error('DYNAMIC_OPTIONS_REQUIRE_BUSINESS_DATA');
    }
    const items = input.toolResult.items;
    const message = safeMessage(input.toolResult.message || input.semantic.message);
    if (items.length === 0) return { presentation: 'text', message, options: [] };
    if (items.length === 1) {
      const item = items[0] as ToolResultItem;
      return {
        presentation: 'text',
        message:
          `${message}\n${item.label}${item.description ? ` — ${item.description}` : ''}`.slice(
            0,
            4096,
          ),
        options: [],
      };
    }
    if (items.length > 10) {
      return {
        presentation: 'text',
        message:
          `${message}\nEncontré ${items.length} resultados. Especifica un poco más para mostrar opciones precisas.`.slice(
            0,
            4096,
          ),
        options: [],
      };
    }
    const options = this.dynamicOptions(items, input.createDynamicId);
    if (items.length <= 3 && input.behavior.allowDynamicButtons) {
      return { presentation: 'buttons', message, options };
    }
    if (items.length >= 4 && input.behavior.allowDynamicLists) {
      return {
        presentation: 'list',
        title: (input.title ?? 'Opciones disponibles').slice(0, 60),
        message,
        buttonLabel: 'Ver opciones',
        options,
      };
    }
    return {
      presentation: 'text',
      message: [message, ...items.map((item, index) => `${index + 1}. ${item.label}`)]
        .join('\n')
        .slice(0, 4096),
      options: [],
    };
  }

  private dynamicOptions(
    items: ToolResultItem[],
    createDynamicId: ResponseEngineInput['createDynamicId'],
  ): ResponseOption[] {
    if (createDynamicId === undefined) throw new Error('DYNAMIC_OPTION_ID_FACTORY_REQUIRED');
    return items.map((item) => {
      const id = createDynamicId(item);
      if (!/^dyn_[a-f0-9]{32}$/u.test(id)) throw new Error('DYNAMIC_OPTION_ID_INVALID');
      return {
        id,
        label: item.label.slice(0, 24),
        ...(item.description === undefined ? {} : { description: item.description.slice(0, 72) }),
        ...(item.section === undefined ? {} : { section: item.section.slice(0, 24) }),
        source: 'TOOL',
      };
    });
  }
}

function safeMessage(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  return (normalized || 'No pude preparar una respuesta en este momento.').slice(0, 4096);
}
