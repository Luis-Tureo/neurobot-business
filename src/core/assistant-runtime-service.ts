import type { Logger } from 'pino';
import type { AssistantQueryService } from '../ai/assistant-query-service.js';
import type {
  ConversationResponse,
  EphemeralInteraction,
  SemanticResponse,
  ToolResultItem,
} from '../domain/types.js';
import type { AppDatabase } from '../persistence/database.js';
import { CatalogService } from './catalog-service.js';
import { ConversationRouter } from './conversation-router.js';
import { ResponseEngine } from './response-engine.js';
import { ToolRegistry, ToolRegistryError } from './tool-registry.js';

export type AssistantRuntimeDebug = {
  route: string;
  provider: string;
  model: string;
  knowledgeUsed: boolean;
  toolCalled: string | null;
  toolResultCount: number;
  presentation: ConversationResponse['presentation'];
  actionIds: string[];
  durationMs: number;
  status: 'success' | 'fallback' | 'error';
  error: string | null;
};

export type AssistantRuntimeResult = {
  response: ConversationResponse;
  debug: AssistantRuntimeDebug;
};

export class AssistantRuntimeService {
  private readonly router = new ConversationRouter();
  private readonly responseEngine = new ResponseEngine();
  private readonly tools: ToolRegistry;

  public constructor(
    private readonly database: AppDatabase,
    private readonly queryService: AssistantQueryService,
    private readonly logger: Logger,
    private readonly assistantId: string,
  ) {
    this.tools = new ToolRegistry(database);
  }

  public async handleFreeText(input: {
    message: string;
    conversationHash: string;
    customerHash: string;
    channel: 'WHATSAPP' | 'SIMULATOR';
    now?: Date;
    onWaitNotice?: () => Promise<void>;
  }): Promise<AssistantRuntimeResult> {
    const startedAt = Date.now();
    const now = input.now ?? new Date();
    const bot = this.database.getBot(this.assistantId);
    if (bot === null) throw new Error('El asistente no existe.');
    const behavior = this.database.getAssistantBehavior(this.assistantId);
    const decision = this.router.route({ body: input.message });
    if (decision.route === 'GREETING' && behavior.showInitialMenuOnGreeting) {
      const response = this.initialMenuResponse();
      if (response !== null) {
        return this.complete(
          response,
          {
            route: 'GREETING',
            provider: 'not_called',
            model: 'not_called',
            knowledgeUsed: false,
            toolCalled: null,
            toolResultCount: response.options.length,
            actionIds: response.options.map((option) => option.id),
            status: 'success',
            error: null,
          },
          input,
          startedAt,
        );
      }
    }
    if (decision.route === 'HUMAN_FALLBACK') {
      const contact = this.database.getBotProfile(this.assistantId).contactInformation.trim();
      return this.complete(
        {
          presentation: 'text',
          message:
            contact === ''
              ? 'La derivación automática a una persona todavía no está habilitada. Puedes dejar tu consulta para que el negocio la revise.'
              : `La derivación automática todavía no está habilitada. Puedes contactar al negocio mediante: ${contact}`,
          options: [],
        },
        {
          route: 'HUMAN_FALLBACK',
          provider: 'not_called',
          model: 'not_called',
          knowledgeUsed: false,
          toolCalled: null,
          toolResultCount: 0,
          actionIds: [],
          status: 'fallback',
          error: 'HUMAN_HANDOFF_NOT_ENABLED',
        },
        input,
        startedAt,
      );
    }
    if (
      decision.route === 'AI_TOOL' &&
      decision.suggestedToolId !== null &&
      behavior.allowBusinessDataQueries
    ) {
      try {
        const result = await this.tools.execute({
          assistantId: bot.id,
          businessId: bot.businessId,
          toolId: decision.suggestedToolId,
          arguments: toolArguments(decision.suggestedToolId, input.message),
          requiredPermissions: ['READ', 'SUGGEST'],
          userAuthorized: true,
        });
        const semantic: SemanticResponse = {
          message: result.message,
          intent: decision.suggestedToolId,
          presentationPreference: 'automatic',
          suggestedActions: [],
          toolRequest: { name: decision.suggestedToolId, arguments: {} },
        };
        const response = this.responseEngine.build({
          semantic,
          toolResult: result,
          behavior,
          createDynamicId: (item) =>
            this.createDynamicInteraction(
              bot.businessId,
              input.conversationHash,
              result.toolId,
              item,
              now,
            ),
        });
        return this.complete(
          response,
          {
            route: 'AI_TOOL',
            provider: 'not_called',
            model: 'not_called',
            knowledgeUsed: false,
            toolCalled: result.toolId,
            toolResultCount: result.resultCount,
            actionIds: response.options.map((option) => option.id),
            status: 'success',
            error: null,
          },
          input,
          startedAt,
        );
      } catch (error) {
        if (error instanceof ToolRegistryError) {
          const response: ConversationResponse = {
            presentation: 'text',
            message: toolUnavailableMessage(error, decision.suggestedToolId),
            options: [],
          };
          return this.complete(
            response,
            {
              route: 'AI_TOOL',
              provider: 'not_called',
              model: 'not_called',
              knowledgeUsed: false,
              toolCalled: decision.suggestedToolId,
              toolResultCount: 0,
              actionIds: [],
              status: 'fallback',
              error: error.code,
            },
            input,
            startedAt,
          );
        }
        throw error;
      }
    }

    const answer = await this.queryService.answerQuestion(
      input.message.trim(),
      input.conversationHash,
      input.customerHash,
      now,
      input.onWaitNotice,
      'assistant_runtime',
      {
        useBusinessKnowledge: behavior.useBusinessKnowledge,
        allowGeneralAnswer: behavior.allowFreeQuestions,
        channel: input.channel,
        semanticTools: behavior.allowBusinessDataQueries
          ? this.tools
              .list(this.assistantId)
              .filter((tool) => tool.availability === 'AVAILABLE' && tool.state === 'ENABLED')
          : [],
      },
    );
    const semantic: SemanticResponse = answer.semantic ?? {
      message: answer.text,
      intent: 'answer_question',
      presentationPreference: 'text',
      suggestedActions: [],
      toolRequest: null,
    };
    if (semantic.toolRequest !== null && behavior.allowBusinessDataQueries) {
      try {
        const result = await this.tools.execute({
          assistantId: bot.id,
          businessId: bot.businessId,
          toolId: semantic.toolRequest.name,
          arguments: semantic.toolRequest.arguments,
          requiredPermissions: ['READ', 'SUGGEST'],
          userAuthorized: true,
        });
        const response = this.responseEngine.build({
          semantic,
          toolResult: result,
          behavior,
          createDynamicId: (item) =>
            this.createDynamicInteraction(
              bot.businessId,
              input.conversationHash,
              result.toolId,
              item,
              now,
            ),
        });
        return this.complete(
          response,
          {
            route: 'AI_TOOL',
            provider: answer.provider ?? 'unknown',
            model: answer.model ?? 'unknown',
            knowledgeUsed: answer.knowledgeUsed ?? false,
            toolCalled: result.toolId,
            toolResultCount: result.resultCount,
            actionIds: response.options.map((option) => option.id),
            status: 'success',
            error: null,
          },
          input,
          startedAt,
        );
      } catch (error) {
        if (error instanceof ToolRegistryError) {
          return this.complete(
            {
              presentation: 'text',
              message: toolUnavailableMessage(error, semantic.toolRequest.name),
              options: [],
            },
            {
              route: 'AI_TOOL',
              provider: answer.provider ?? 'unknown',
              model: answer.model ?? 'unknown',
              knowledgeUsed: answer.knowledgeUsed ?? false,
              toolCalled: semantic.toolRequest.name,
              toolResultCount: 0,
              actionIds: [],
              status: 'fallback',
              error: error.code,
            },
            input,
            startedAt,
          );
        }
        throw error;
      }
    }
    const response = this.responseEngine.build({ semantic, behavior });
    return this.complete(
      response,
      {
        route: answer.route ?? 'AI_FREE_TEXT',
        provider: answer.provider ?? 'unknown',
        model: answer.model ?? 'unknown',
        knowledgeUsed: answer.knowledgeUsed ?? false,
        toolCalled: null,
        toolResultCount: 0,
        actionIds: [],
        status: answer.status ?? 'success',
        error: answer.errorCode ?? null,
      },
      input,
      startedAt,
    );
  }

  public resolveDynamicInteraction(input: {
    id: string;
    conversationHash: string;
    customerHash: string;
    channel: 'WHATSAPP' | 'SIMULATOR';
    now?: Date;
  }): AssistantRuntimeResult {
    const startedAt = Date.now();
    const now = input.now ?? new Date();
    const interaction = this.database.getEphemeralInteraction(
      input.id,
      this.assistantId,
      input.conversationHash,
      now,
    );
    if (interaction === null || interaction.status !== 'ACTIVE') {
      return this.dynamicFallback(
        'La opción expiró. Consulta nuevamente para ver datos actuales.',
        input,
        startedAt,
      );
    }
    try {
      this.tools.revalidate(this.assistantId, interaction.toolId, interaction.resourceId);
    } catch (error) {
      if (error instanceof ToolRegistryError) {
        return this.dynamicFallback(
          'Esa opción ya no está disponible. Consulta nuevamente para ver las opciones actuales.',
          input,
          startedAt,
          error.code,
        );
      }
      throw error;
    }
    if (
      !this.database.markEphemeralInteractionConsumed(
        interaction.id,
        this.assistantId,
        input.conversationHash,
        now,
      )
    ) {
      return this.dynamicFallback(
        'La opción ya fue utilizada. Consulta nuevamente.',
        input,
        startedAt,
      );
    }
    const response: ConversationResponse = {
      presentation: 'text',
      message: this.resourceMessage(interaction),
      options: [],
    };
    return this.complete(
      response,
      {
        route: 'INTERACTIVE_ACTION',
        provider: 'not_called',
        model: 'not_called',
        knowledgeUsed: false,
        toolCalled: interaction.toolId,
        toolResultCount: 1,
        actionIds: [interaction.actionId],
        status: 'success',
        error: null,
      },
      input,
      startedAt,
    );
  }

  private initialMenuResponse(): ConversationResponse | null {
    const menu = this.database
      .listMenus(this.assistantId)
      .find((candidate) => candidate.isInitial && candidate.enabled);
    if (menu === undefined) return null;
    const options = this.database
      .listMenuOptions(this.assistantId, menu.id)
      .filter((option) => option.enabled)
      .map((option) => ({
        id: String(option.id),
        label: option.label.slice(0, 24),
        ...(option.description === '' ? {} : { description: option.description.slice(0, 72) }),
        ...(option.section === '' ? {} : { section: option.section.slice(0, 24) }),
        source: 'PERSISTENT' as const,
      }));
    if (options.length === 0) {
      return { presentation: 'text', message: menu.message, options: [] };
    }
    if (options.length === 1) {
      return {
        presentation: 'text',
        message: `${menu.message}\n${options[0]?.label ?? ''}`.trim(),
        options: [],
      };
    }
    if (options.length > 10) {
      return {
        presentation: 'text',
        message: `${menu.message}\nHay ${options.length} opciones. Escribe qué necesitas para acotar la búsqueda.`,
        options: [],
      };
    }
    const presentation = menu.presentation === 'LIST' || options.length > 3 ? 'list' : 'buttons';
    if (presentation === 'buttons') return { presentation, message: menu.message, options };
    return {
      presentation,
      title: menu.title,
      message: menu.message,
      buttonLabel: menu.listButtonLabel,
      options,
    };
  }

  private createDynamicInteraction(
    businessId: string,
    conversationHash: string,
    toolId: string,
    item: ToolResultItem,
    now: Date,
  ): string {
    return this.database.createEphemeralInteraction({
      businessId,
      assistantId: this.assistantId,
      conversationHash,
      toolId,
      actionId: 'select_tool_result',
      resourceId: item.resourceId,
      label: item.label,
      volatile: item.volatile,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    }).id;
  }

  private resourceMessage(interaction: EphemeralInteraction): string {
    if (interaction.resourceId.startsWith('catalog_item:')) {
      const id = Number(interaction.resourceId.split(':')[1]);
      return new CatalogService(this.database, this.assistantId).itemText(id);
    }
    if (interaction.resourceId.startsWith('business_hour:')) {
      const hour = this.database
        .listBusinessHours(this.assistantId)
        .find((candidate) => candidate.id === Number(interaction.resourceId.split(':')[1]));
      return hour === undefined
        ? 'El horario cambió. Consulta nuevamente.'
        : `${interaction.label}${hour.label ? `\n${hour.label}` : ''}`;
    }
    if (interaction.resourceId === 'location:primary') {
      return this.database.getBotProfile(this.assistantId).address ?? 'La ubicación cambió.';
    }
    return `Seleccionaste: ${interaction.label}`;
  }

  private dynamicFallback(
    message: string,
    input: {
      conversationHash: string;
      customerHash: string;
      channel: 'WHATSAPP' | 'SIMULATOR';
    },
    startedAt: number,
    error = 'DYNAMIC_INTERACTION_EXPIRED',
  ): AssistantRuntimeResult {
    return this.complete(
      { presentation: 'text', message, options: [] },
      {
        route: 'INTERACTIVE_ACTION',
        provider: 'not_called',
        model: 'not_called',
        knowledgeUsed: false,
        toolCalled: null,
        toolResultCount: 0,
        actionIds: [],
        status: 'fallback',
        error,
      },
      input,
      startedAt,
    );
  }

  private complete(
    response: ConversationResponse,
    debug: Omit<AssistantRuntimeDebug, 'presentation' | 'durationMs'>,
    input: {
      conversationHash: string;
      customerHash: string;
      channel: 'WHATSAPP' | 'SIMULATOR';
    },
    startedAt: number,
  ): AssistantRuntimeResult {
    const durationMs = Date.now() - startedAt;
    const completeDebug: AssistantRuntimeDebug = {
      ...debug,
      presentation: response.presentation,
      durationMs,
    };
    const bot = this.database.getBot(this.assistantId);
    this.database.recordTechnicalEvent({
      botId: this.assistantId,
      ...(bot === null ? {} : { businessId: bot.businessId }),
      eventType: 'ASSISTANT_RUNTIME_COMPLETED',
      result: debug.status,
      status: debug.status,
      channel: input.channel,
      route: debug.route,
      aiProvider: debug.provider,
      aiModel: debug.model,
      knowledgeUsed: debug.knowledgeUsed,
      ...(debug.toolCalled === null ? {} : { toolRequested: debug.toolCalled }),
      ...(debug.status === 'success' && debug.toolCalled !== null
        ? { toolExecuted: debug.toolCalled }
        : {}),
      resultCount: debug.toolResultCount,
      presentation: response.presentation,
      actionIds: debug.actionIds,
      durationMs,
      ...(debug.error === null ? {} : { errorCode: debug.error }),
      conversationHash: input.conversationHash,
      customerHash: input.customerHash,
    });
    this.logger.info(
      {
        operation: 'ASSISTANT_RUNTIME_COMPLETED',
        business_id: bot?.businessId,
        assistant_id: this.assistantId,
        channel: input.channel,
        route: debug.route,
        provider: debug.provider,
        model: debug.model,
        knowledge_used: debug.knowledgeUsed,
        tool_requested: debug.toolCalled,
        tool_executed: debug.status === 'success' ? debug.toolCalled : null,
        result_count: debug.toolResultCount,
        presentation: response.presentation,
        action_ids: debug.actionIds,
        latency_ms: durationMs,
        status: debug.status,
        error: debug.error,
      },
      'Finalizó el enrutamiento central del asistente',
    );
    return { response, debug: completeDebug };
  }
}

function toolArguments(toolId: string, message: string) {
  if (toolId !== 'get_product_stock') return {};
  const name = message
    .replace(/\b(?:stock|inventario|unidades|disponibles?|tienen|hay|de|del)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return name === '' ? { name: message.trim().slice(0, 160) } : { name: name.slice(0, 160) };
}

function toolUnavailableMessage(error: ToolRegistryError, toolId: string): string {
  if (toolId === 'get_available_slots') {
    return 'Todavía no hay una agenda real conectada para consultar disponibilidad. No inventaré horarios.';
  }
  if (error.code === 'TOOL_DISABLED' || error.code === 'TOOL_PERMISSION_DENIED') {
    return 'Esa consulta no está habilitada para este asistente.';
  }
  return 'No hay una fuente real disponible para responder esa consulta en este momento.';
}
