import { AIOrchestrator, parseSemanticResponse } from '../src/ai/ai-orchestrator.js';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { AIProviderError } from '../src/ai/ai-provider.js';
import type { AssistantQueryService } from '../src/ai/assistant-query-service.js';
import { AssistantRuntimeService } from '../src/core/assistant-runtime-service.js';
import { ConversationRouter } from '../src/core/conversation-router.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import { ResponseEngine } from '../src/core/response-engine.js';
import { TenantResolver } from '../src/core/tenant-resolver.js';
import { ToolRegistry, ToolRegistryError } from '../src/core/tool-registry.js';
import type {
  AssistantBehaviorSettings,
  SemanticResponse,
  ToolExecutionResult,
  ToolResultItem,
} from '../src/domain/types.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { SimulatedMessagingClient } from '../src/messaging/simulated-client.js';
import { WhatsAppRenderer } from '../src/messaging/whatsapp-renderer.js';
import { AppDatabase } from '../src/persistence/database.js';

describe('router central de conversaciones', () => {
  const router = new ConversationRouter();

  it.each([
    [{ body: 'ignored', messageType: 'interactive' }, 'INTERACTIVE_ACTION', null],
    [{ body: '2', hasManualSelection: true }, 'MANUAL_MENU', null],
    [{ body: '¡Hola!' }, 'GREETING', 'show_menu'],
    [{ body: '¿Cuáles son sus servicios?' }, 'AI_TOOL', 'get_services'],
    [{ body: '¿Qué productos venden?' }, 'AI_TOOL', 'get_products'],
    [{ body: '¿Tienen stock?' }, 'AI_TOOL', 'get_product_stock'],
    [{ body: '¿Dónde están ubicados?' }, 'AI_TOOL', 'get_locations'],
    [{ body: 'Quiero reservar una hora disponible' }, 'AI_TOOL', 'get_available_slots'],
    [{ body: 'Quiero hablar con una persona' }, 'HUMAN_FALLBACK', null],
    [{ body: 'Política de cambios', knowledgeMatchCount: 1 }, 'AI_KNOWLEDGE', null],
    [{ body: '¿Cuánto es 2 + 2?' }, 'AI_FREE_TEXT', null],
  ] as const)('clasifica %o como %s', (input, expectedRoute, expectedTool) => {
    expect(router.route(input)).toEqual({
      route: expectedRoute,
      suggestedToolId: expectedTool,
    });
  });
});

describe('motor de presentación determinista', () => {
  const engine = new ResponseEngine();
  const semantic: SemanticResponse = {
    message: 'Opciones encontradas',
    intent: 'show_results',
    presentationPreference: 'automatic',
    suggestedActions: [],
    toolRequest: null,
  };
  const behavior = behaviorSettings();

  it.each([
    [0, 'text'],
    [1, 'text'],
    [2, 'buttons'],
    [3, 'buttons'],
    [4, 'list'],
    [10, 'list'],
    [11, 'text'],
  ] as const)('elige %s resultados como %s', (count, expected) => {
    let sequence = 0;
    const response = engine.build({
      semantic,
      toolResult: toolResult(items(count)),
      behavior,
      createDynamicId: () => `dyn_${(++sequence).toString(16).padStart(32, '0')}`,
    });
    expect(response.presentation).toBe(expected);
    if (expected === 'buttons' || expected === 'list') {
      expect(response.options).toHaveLength(count);
      expect(response.options.every((option) => /^dyn_[a-f0-9]{32}$/u.test(option.id))).toBe(true);
    }
    if (count > 10) expect(response.message).toContain('Especifica un poco más');
  });

  it('respeta los controles del negocio como restricción superior a la preferencia de IA', () => {
    let sequence = 0;
    const response = engine.build({
      semantic: { ...semantic, presentationPreference: 'buttons' },
      toolResult: toolResult(items(3)),
      behavior: { ...behavior, allowDynamicButtons: false },
      createDynamicId: () => `dyn_${(++sequence).toString(16).padStart(32, '0')}`,
    });
    expect(response).toMatchObject({ presentation: 'text', options: [] });
  });

  it('no admite IDs dinámicos predecibles o fuera del contrato', () => {
    expect(() =>
      engine.build({
        semantic,
        toolResult: toolResult(items(2)),
        behavior,
        createDynamicId: () => 'catalog_item:1',
      }),
    ).toThrow('DYNAMIC_OPTION_ID_INVALID');
  });
});

describe('registro seguro de herramientas y aislamiento', () => {
  let database: AppDatabase;
  let assistantId: string;
  let otherAssistantId: string;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
    assistantId = createAssistant(database, 'herramientas-uno', 'Servicios Uno');
    otherAssistantId = createAssistant(database, 'herramientas-dos', 'Servicios Dos');
    addCatalogItems(database, assistantId, 2);
  });

  afterEach(() => database.close());

  it('expone fuentes reales y deja agenda, pedidos, reservas y handoff en futuro', () => {
    const tools = new ToolRegistry(database).list(assistantId);
    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'get_services', availability: 'AVAILABLE' }),
        expect.objectContaining({ id: 'get_product_stock', availability: 'AVAILABLE' }),
        expect.objectContaining({ id: 'get_available_slots', state: 'FUTURE' }),
        expect.objectContaining({ id: 'get_order_status', state: 'FUTURE' }),
        expect.objectContaining({ id: 'create_booking', state: 'FUTURE' }),
        expect.objectContaining({ id: 'cancel_booking', state: 'FUTURE' }),
        expect.objectContaining({ id: 'request_human', state: 'FUTURE' }),
      ]),
    );
  });

  it('ejecuta solo la fuente real del tenant y normaliza el resultado', async () => {
    const assistant = database.getBot(assistantId)!;
    const result = await new ToolRegistry(database).execute({
      assistantId,
      businessId: assistant.businessId,
      toolId: 'get_services',
      arguments: {},
      requiredPermissions: ['READ', 'SUGGEST'],
      userAuthorized: true,
    });
    expect(result).toMatchObject({
      toolId: 'get_services',
      source: 'BUSINESS_DATA',
      resultCount: 2,
    });
    expect(result.items.map((item) => item.label)).toEqual(['Servicio 1', 'Servicio 2']);
    expect(result.items.every((item) => item.resourceId.startsWith('catalog_item:'))).toBe(true);
  });

  it.each([
    ['TOOL_NOT_FOUND', { toolId: 'unknown_tool' }],
    ['TOOL_UNAUTHORIZED', { userAuthorized: false }],
    ['TOOL_TENANT_MISMATCH', { businessId: 'business_ajeno' }],
  ] as const)('rechaza %s', async (code, override) => {
    const assistant = database.getBot(assistantId)!;
    await expect(
      new ToolRegistry(database).execute({
        assistantId,
        businessId: assistant.businessId,
        toolId: 'get_services',
        arguments: {},
        requiredPermissions: ['READ'],
        userAuthorized: true,
        ...override,
      }),
    ).rejects.toMatchObject({ code });
  });

  it('rechaza herramientas futuras, deshabilitadas, sin permiso y con input inválido', async () => {
    const assistant = database.getBot(assistantId)!;
    const registry = new ToolRegistry(database);
    const base = {
      assistantId,
      businessId: assistant.businessId,
      arguments: {},
      requiredPermissions: ['READ'] as Array<'READ'>,
      userAuthorized: true,
    };
    await expect(
      registry.execute({
        ...base,
        toolId: 'get_available_slots',
        requiredPermissions: ['EXECUTE'],
      }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_AVAILABLE' });

    database.saveAssistantToolConfiguration({
      assistantId,
      toolId: 'get_services',
      enabled: false,
      permissions: ['READ', 'SUGGEST'],
    });
    await expect(registry.execute({ ...base, toolId: 'get_services' })).rejects.toMatchObject({
      code: 'TOOL_DISABLED',
    });

    database.saveAssistantToolConfiguration({
      assistantId,
      toolId: 'get_services',
      enabled: true,
      permissions: ['READ'],
    });
    await expect(
      registry.execute({
        ...base,
        toolId: 'get_services',
        requiredPermissions: ['READ', 'SUGGEST'],
      }),
    ).rejects.toMatchObject({ code: 'TOOL_PERMISSION_DENIED' });
    await expect(
      registry.execute({
        ...base,
        toolId: 'get_product_stock',
        arguments: {},
      }),
    ).rejects.toMatchObject({ code: 'TOOL_INVALID_INPUT' });
  });

  it('no permite revalidar un recurso desde otro asistente', () => {
    const firstItem = database.listCatalogItems(assistantId)[0]!;
    expect(() =>
      new ToolRegistry(database).revalidate(
        otherAssistantId,
        'get_services',
        `catalog_item:${firstItem.id}`,
      ),
    ).toThrowError(ToolRegistryError);
  });
});

describe('orquestador semántico y renderer WhatsApp', () => {
  it('normaliza la salida de Groq sin permitir payloads Meta y filtra herramientas futuras', async () => {
    const generate = vi.fn(
      async (_request: Parameters<AIProvider['generateGroundedResponse']>[0]) => ({
        text: `\`\`\`json
        {"message":"Revisaré los servicios reales.","intent":"service_search","presentation_preference":"automatic","suggested_actions":["show_services","show_services"],"tool_request":{"name":"get_services","arguments":{}}}
      \`\`\``,
        usage: { inputTokens: 10, outputTokens: 12, totalTokens: 22 },
      }),
    );
    const provider = fakeProvider(generate);
    const database = new AppDatabase(':memory:');
    database.migrate();
    const assistantId = createAssistant(database, 'orquestador', 'Orquestador');
    const tools = new ToolRegistry(database).list(assistantId);
    const result = await new AIOrchestrator(provider).orchestrate({
      question: '¿Qué servicios tienen?',
      stableKnowledge: 'Información estable del negocio.',
      availableTools: tools,
      maximumOutputTokens: 800,
      timeoutMs: 5000,
    });

    expect(result.semantic).toEqual({
      message: 'Revisaré los servicios reales.',
      intent: 'service_search',
      presentationPreference: 'automatic',
      suggestedActions: ['show_services'],
      toolRequest: { name: 'get_services', arguments: {} },
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInstruction: expect.stringContaining('Nunca construyas payloads de WhatsApp'),
        maximumOutputTokens: 600,
      }),
    );
    const instruction = generate.mock.calls[0]?.[0].systemInstruction as string;
    expect(instruction).toContain('get_services');
    expect(instruction).not.toContain('get_available_slots');
    database.close();
  });

  it('rechaza una respuesta del proveedor fuera del contrato semántico', () => {
    expect(() => parseSemanticResponse('{"type":"interactive","buttons":[]}')).toThrowError(
      AIProviderError,
    );
  });

  it('renderiza botones y listas Meta válidos sin exponer el contrato del proveedor de IA', async () => {
    const renderer = new WhatsAppRenderer();
    const buttonResponse = {
      presentation: 'buttons' as const,
      message: 'Elige',
      options: [
        { id: `dyn_${'a'.repeat(32)}`, label: 'Uno', source: 'TOOL' as const },
        { id: `dyn_${'b'.repeat(32)}`, label: 'Dos', source: 'TOOL' as const },
      ],
    };
    expect(renderer.render(buttonResponse)).toMatchObject({
      type: 'interactive',
      interactive: { kind: 'buttons', options: [{ label: 'Uno' }, { label: 'Dos' }] },
    });

    const client = new SimulatedMessagingClient();
    client.interactiveSupported = true;
    await expect(renderer.send(client, '56911111111', buttonResponse)).resolves.toBe('buttons');
    expect(client.sentInteractiveMenus).toHaveLength(1);

    const listResponse = {
      presentation: 'list' as const,
      title: 'Servicios',
      message: 'Elige',
      buttonLabel: 'Ver opciones',
      options: items(4).map((item, index) => ({
        id: `dyn_${(index + 1).toString(16).padStart(32, '0')}`,
        label: item.label,
        ...(item.description === undefined ? {} : { description: item.description }),
        source: 'TOOL' as const,
      })),
    };
    expect(renderer.render(listResponse)).toMatchObject({
      type: 'interactive',
      interactive: { kind: 'list', listButtonLabel: 'Ver opciones' },
    });
  });

  it('usa una alternativa numerada si el canal no admite interactividad', async () => {
    const renderer = new WhatsAppRenderer();
    const client = new SimulatedMessagingClient();
    await expect(
      renderer.send(client, '56911111111', {
        presentation: 'buttons',
        message: 'Elige',
        options: [
          { id: `dyn_${'a'.repeat(32)}`, label: 'Uno', source: 'TOOL' },
          { id: `dyn_${'b'.repeat(32)}`, label: 'Dos', source: 'TOOL' },
        ],
      }),
    ).resolves.toBe('numbered');
    expect(client.sentMessages[0]?.text).toContain('1. Uno');
  });
});

describe('runtime compartido, persistencia efímera y tenant resolver', () => {
  let database: AppDatabase;
  let assistantId: string;
  let answerQuestion: ReturnType<typeof vi.fn>;
  let runtime: AssistantRuntimeService;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
    assistantId = createAssistant(database, 'runtime-principal', 'Runtime');
    addCatalogItems(database, assistantId, 2);
    answerQuestion = vi.fn(async () => ({
      text: 'La respuesta libre viene de Groq.',
      code: 'AI_RESPONSE' as const,
      route: 'AI_FALLBACK',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      knowledgeUsed: false,
      durationMs: 7,
      status: 'success' as const,
      errorCode: null,
    }));
    runtime = new AssistantRuntimeService(
      database,
      { answerQuestion } as unknown as AssistantQueryService,
      createLogger('silent'),
      assistantId,
    );
  });

  afterEach(() => database.close());

  it('genera botones opacos desde datos reales y revalida antes de mostrar el recurso', async () => {
    const now = new Date();
    const first = await runtime.handleFreeText({
      message: '¿Qué servicios ofrecen?',
      conversationHash: 'conversation-one',
      customerHash: 'customer-one',
      channel: 'SIMULATOR',
      now,
    });
    expect(first.response.presentation).toBe('buttons');
    expect(first.response.options).toHaveLength(2);
    expect(first.debug).toMatchObject({
      route: 'AI_TOOL',
      provider: 'not_called',
      toolCalled: 'get_services',
      toolResultCount: 2,
      presentation: 'buttons',
    });
    expect(answerQuestion).not.toHaveBeenCalled();

    const selectedId = first.response.options[0]!.id;
    expect(selectedId).toMatch(/^dyn_[a-f0-9]{32}$/u);
    const selected = runtime.resolveDynamicInteraction({
      id: selectedId,
      conversationHash: 'conversation-one',
      customerHash: 'customer-one',
      channel: 'SIMULATOR',
      now: new Date(now.getTime() + 60_000),
    });
    expect(selected.response.message).toContain('Servicio 1');
    expect(selected.debug.route).toBe('INTERACTIVE_ACTION');
    expect(
      runtime.resolveDynamicInteraction({
        id: selectedId,
        conversationHash: 'conversation-one',
        customerHash: 'customer-one',
        channel: 'SIMULATOR',
        now: new Date(now.getTime() + 120_000),
      }).response.message,
    ).toContain('expiró');
  });

  it('invalida una opción si el dato real cambió y aísla conversación y asistente', async () => {
    const now = new Date();
    const result = await runtime.handleFreeText({
      message: 'Ver servicios',
      conversationHash: 'conversation-owner',
      customerHash: 'customer-owner',
      channel: 'SIMULATOR',
      now,
    });
    const id = result.response.options[0]!.id;
    const firstItem = database.listCatalogItems(assistantId)[0]!;
    database.deleteCatalogItem(assistantId, firstItem.id);
    expect(
      runtime.resolveDynamicInteraction({
        id,
        conversationHash: 'conversation-owner',
        customerHash: 'customer-owner',
        channel: 'SIMULATOR',
        now: new Date(now.getTime() + 60_000),
      }),
    ).toMatchObject({
      response: { presentation: 'text', message: expect.stringContaining('ya no está disponible') },
      debug: { error: 'TOOL_RESOURCE_STALE' },
    });
    expect(database.getEphemeralInteraction(id, assistantId, 'conversation-foreign')).toBeNull();
  });

  it('no inventa disponibilidad y no llama a Groq cuando falta una fuente real', async () => {
    const result = await runtime.handleFreeText({
      message: '¿Qué horas disponibles tienen para reservar?',
      conversationHash: 'conversation-slots',
      customerHash: 'customer-slots',
      channel: 'SIMULATOR',
    });
    expect(result).toMatchObject({
      response: { presentation: 'text', message: expect.stringContaining('agenda real') },
      debug: {
        route: 'AI_TOOL',
        toolCalled: 'get_available_slots',
        toolResultCount: 0,
        status: 'fallback',
        error: 'TOOL_NOT_AVAILABLE',
      },
    });
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('envía preguntas libres a la IA sin repetir el menú', async () => {
    const result = await runtime.handleFreeText({
      message: '¿Cuánto es 2 + 2?',
      conversationHash: 'conversation-free',
      customerHash: 'customer-free',
      channel: 'SIMULATOR',
    });
    expect(result.response).toEqual({
      presentation: 'text',
      message: 'La respuesta libre viene de Groq.',
      options: [],
    });
    expect(result.debug).toMatchObject({ route: 'AI_FALLBACK', provider: 'groq' });
    expect(answerQuestion).toHaveBeenCalledTimes(1);
  });

  it('ejecuta una herramienta solicitada por la respuesta semántica solo tras validarla', async () => {
    answerQuestion.mockResolvedValueOnce({
      text: 'Consultaré los servicios confirmados.',
      semantic: {
        message: 'Consultaré los servicios confirmados.',
        intent: 'service_search',
        presentationPreference: 'automatic',
        suggestedActions: ['show_services'],
        toolRequest: { name: 'get_services', arguments: {} },
      },
      code: 'AI_RESPONSE',
      route: 'AI_FALLBACK',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      knowledgeUsed: false,
      durationMs: 7,
      status: 'success',
      errorCode: null,
    });

    const result = await runtime.handleFreeText({
      message: 'Ayúdame con la oferta comercial',
      conversationHash: 'conversation-semantic-tool',
      customerHash: 'customer-semantic-tool',
      channel: 'SIMULATOR',
    });

    expect(result).toMatchObject({
      response: { presentation: 'buttons', options: [{ source: 'TOOL' }, { source: 'TOOL' }] },
      debug: {
        route: 'AI_TOOL',
        provider: 'groq',
        toolCalled: 'get_services',
        toolResultCount: 2,
        status: 'success',
      },
    });
    expect(answerQuestion).toHaveBeenCalledWith(
      'Ayúdame con la oferta comercial',
      'conversation-semantic-tool',
      'customer-semantic-tool',
      expect.any(Date),
      undefined,
      'assistant_runtime',
      expect.objectContaining({
        semanticTools: expect.arrayContaining([
          expect.objectContaining({ id: 'get_services', state: 'ENABLED' }),
        ]),
      }),
    );
    const semanticTools = answerQuestion.mock.calls[0]?.[6].semanticTools as Array<{
      availability: string;
      state: string;
    }>;
    expect(semanticTools.every((tool) => tool.availability === 'AVAILABLE')).toBe(true);
    expect(semanticTools.every((tool) => tool.state === 'ENABLED')).toBe(true);
  });

  it('simula saludo con el menú persistente y mantiene el handoff como función futura', async () => {
    const greeting = await runtime.handleFreeText({
      message: 'Hola',
      conversationHash: 'conversation-greeting',
      customerHash: 'customer-greeting',
      channel: 'SIMULATOR',
    });
    expect(greeting.debug.route).toBe('GREETING');
    expect(['buttons', 'list']).toContain(greeting.response.presentation);
    expect(greeting.response.options.every((option) => /^\d+$/u.test(option.id))).toBe(true);

    const human = await runtime.handleFreeText({
      message: 'Quiero hablar con una persona',
      conversationHash: 'conversation-human',
      customerHash: 'customer-human',
      channel: 'SIMULATOR',
    });
    expect(human).toMatchObject({
      response: {
        presentation: 'text',
        message: expect.stringContaining('todavía no está habilitada'),
      },
      debug: { route: 'HUMAN_FALLBACK', error: 'HUMAN_HANDOFF_NOT_ENABLED' },
    });
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('persiste proveedor_config, presentación manual y controles dinámicos', () => {
    const bot = database.getBot(assistantId)!;
    const currentAI = database.getAISettings(bot.profileId);
    database.saveAISettings({
      ...currentAI,
      providerConfig: { model: 'openai/gpt-oss-20b' },
      model: 'openai/gpt-oss-20b',
      updatedAt: new Date().toISOString(),
    });
    expect(database.getAISettings(bot.profileId)).toMatchObject({
      model: 'openai/gpt-oss-20b',
      providerConfig: { model: 'openai/gpt-oss-20b' },
    });

    const menu = database.listMenus(assistantId)[0]!;
    const savedMenu = database.saveMenu({
      ...menu,
      botId: assistantId,
      presentation: 'LIST',
      listButtonLabel: 'Abrir lista',
    });
    const option = database.listMenuOptions(assistantId, menu.id)[0]!;
    const savedOption = database.saveMenuOption({
      id: option.id,
      botId: assistantId,
      menuId: menu.id,
      label: option.label,
      description: 'Detalle breve',
      section: 'Servicios',
      aliases: option.aliases,
      order: option.order,
      actionType: 'text',
      actionPayload: { text: 'Respuesta persistente' },
      enabled: option.enabled,
    });
    expect(savedMenu).toMatchObject({ presentation: 'LIST', listButtonLabel: 'Abrir lista' });
    expect(savedOption).toMatchObject({ description: 'Detalle breve', section: 'Servicios' });

    const behavior = database.saveAssistantBehavior({
      ...database.getAssistantBehavior(assistantId),
      assistantId,
      allowDynamicButtons: false,
      allowDynamicLists: true,
      allowBusinessDataQueries: false,
      showAISuggestedActions: false,
      allowWriteTools: false,
    });
    expect(behavior).toMatchObject({
      allowDynamicButtons: false,
      allowDynamicLists: true,
      allowBusinessDataQueries: false,
      showAISuggestedActions: false,
      allowWriteTools: false,
    });
  });

  it('resuelve el tenant únicamente mediante Phone Number ID', () => {
    const assistant = database.getBot(assistantId)!;
    database.configureMetaConnector(assistantId, {
      phoneNumberId: '123456789012345',
      wabaId: '987654321098765',
      credentialReference: 'environment:meta/runtime-principal',
    });
    expect(new TenantResolver(database).byPhoneNumberId('123456789012345')).toEqual({
      businessId: assistant.businessId,
      assistantId,
      phoneNumberId: '123456789012345',
    });
    expect(new TenantResolver(database).byPhoneNumberId('000000000000000')).toBeNull();
  });
});

function behaviorSettings(): AssistantBehaviorSettings {
  return {
    assistantId: 'assistant',
    showInitialMenuOnGreeting: true,
    allowFreeQuestions: true,
    useAIForUnmatched: true,
    useBusinessKnowledge: true,
    allowDynamicButtons: true,
    allowDynamicLists: true,
    allowBusinessDataQueries: true,
    showAISuggestedActions: true,
    allowWriteTools: false,
    fallbackMessage: 'Intenta nuevamente.',
    humanHandoffReady: false,
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

function items(count: number): ToolResultItem[] {
  return Array.from({ length: count }, (_, index) => ({
    resourceId: `catalog_item:${index + 1}`,
    label: `Opción ${index + 1}`,
    description: `Descripción ${index + 1}`,
    volatile: true,
  }));
}

function toolResult(resultItems: ToolResultItem[]): ToolExecutionResult {
  return {
    toolId: 'get_services',
    executionId: 'tool_execution',
    message: 'Opciones encontradas',
    items: resultItems,
    resultCount: resultItems.length,
    source: 'BUSINESS_DATA',
  };
}

function createAssistant(database: AppDatabase, id: string, name: string): string {
  return database.createBot({
    id,
    business: {
      name,
      description: `Negocio ${name}`,
      language: 'es-CL',
      timezone: 'America/Santiago',
    },
    profile: createProfileFromPreset({
      organizationName: name,
      botName: `Asistente ${name}`,
      organizationType: 'Servicios',
      timezone: 'America/Santiago',
      preset: 'service',
    }),
  }).id;
}

function addCatalogItems(database: AppDatabase, assistantId: string, count: number): void {
  const category = database.saveCatalogCategory({
    botId: assistantId,
    name: 'Servicios',
    description: 'Servicios confirmados',
    enabled: true,
  });
  for (let index = 1; index <= count; index += 1) {
    database.saveCatalogItem({
      id: 0,
      botId: assistantId,
      categoryId: category.id,
      name: `Servicio ${index}`,
      code: `SERV-${index}`,
      description: `Descripción del servicio ${index}`,
      priceAmount: null,
      offerPriceAmount: null,
      currency: 'CLP',
      presentation: '',
      size: '',
      variants: [],
      availability: '',
      informedStock: null,
      primaryMediaId: null,
      authorizedLink: null,
      enabled: true,
    });
  }
}

function fakeProvider(generate: AIProvider['generateGroundedResponse']): AIProvider {
  return {
    isConfigured: () => true,
    testConnection: async () => ({ successful: true }),
    generateGroundedResponse: generate,
    getModelInformation: () => ({ provider: 'groq', model: 'openai/gpt-oss-120b' }),
    normalizeUsage: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    classifyProviderError: () => 'AI_TEMPORARY_ERROR',
  };
}
