import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { buildAdminServer } from '../src/admin/server.js';
import { AIProviderFactory } from '../src/ai/ai-provider-factory.js';
import { AIProviderRegistry, DEFAULT_GROQ_MODEL } from '../src/ai/ai-provider-registry.js';
import { MultiBotManager } from '../src/core/multi-bot-manager.js';
import { createProfileFromPreset } from '../src/core/profile-presets.js';
import {
  ORGANIZATION_TYPE_OPTIONS,
  ORGANIZATION_TYPES,
  type OrganizationType,
} from '../src/domain/organization-types.js';
import { createLogger } from '../src/infrastructure/logger.js';
import { AppDatabase } from '../src/persistence/database.js';
import { Anonymizer } from '../src/security/anonymizer.js';
import { hashPassword } from '../src/security/password.js';

type Authentication = { cookie: string; csrf: string };

describe('fundación SaaS de asistentes', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = new AppDatabase(':memory:');
    database.migrate();
  });

  afterEach(() => database.close());

  it('separa negocio, asistente, canal, IA y comportamiento sin perder el modelo principal', () => {
    const assistant = database.createBot({
      business: {
        name: 'Veterinaria Michi',
        description: 'Atención veterinaria y venta de productos para mascotas.',
        language: 'es-CL',
        timezone: 'America/Santiago',
      },
      profile: profile('Veterinaria Michi', 'Michi'),
      whatsappSetupMode: 'NEW_CUSTOMER',
      ai: { provider: 'groq', model: DEFAULT_GROQ_MODEL, enabled: true },
      behavior: {
        showInitialMenuOnGreeting: true,
        allowFreeQuestions: true,
        useAIForUnmatched: true,
        useBusinessKnowledge: true,
        fallbackMessage: 'No pude responder. Contacta a la veterinaria.',
      },
    });

    expect(assistant.businessId).not.toBe(assistant.id);
    expect(database.getBusinessByBotId(assistant.id)).toMatchObject({
      name: 'Veterinaria Michi',
      status: 'DRAFT',
      language: 'es-CL',
    });
    expect(database.getAISettings(assistant.profileId)).toMatchObject({
      provider: 'groq',
      model: DEFAULT_GROQ_MODEL,
      enabled: true,
    });
    expect(database.getWhatsAppConnection(assistant.id)).toMatchObject({
      businessId: assistant.businessId,
      setupMode: 'NEW_CUSTOMER',
      provider: 'META_CLOUD_API',
    });
    expect(database.getAssistantBehavior(assistant.id)).toMatchObject({
      allowFreeQuestions: true,
      useAIForUnmatched: true,
      useBusinessKnowledge: true,
      humanHandoffReady: false,
    });

    const futureChannel = database.createBot({
      businessId: assistant.businessId,
      id: 'michi-segundo-canal',
      profile: profile('Veterinaria Michi', 'Michi Web'),
    });
    expect(futureChannel.businessId).toBe(assistant.businessId);
    expect(database.listBusinesses()).toHaveLength(2); // incluye negocio-ejemplo heredado
  });

  it('aísla conocimiento y resuelve la conexión correcta por Phone Number ID', () => {
    const first = createBusiness(database, 'tenant-uno', 'Negocio Uno');
    const second = createBusiness(database, 'tenant-dos', 'Negocio Dos');
    database.configureMetaConnector(first.id, {
      phoneNumberId: '111111111111111',
      wabaId: '999999999999991',
      credentialReference: 'environment:meta/tenant-uno',
    });
    database.configureMetaConnector(second.id, {
      phoneNumberId: '222222222222222',
      wabaId: '999999999999992',
      credentialReference: 'environment:meta/tenant-dos',
    });

    expect(database.getBotIdByMetaPhoneNumberId('111111111111111')).toBe(first.id);
    expect(database.getBotIdByMetaPhoneNumberId('222222222222222')).toBe(second.id);
    expect(database.getWhatsAppConnection(first.id).businessId).toBe(first.businessId);
    expect(() => database.configureMetaConnector(second.id, '111111111111111')).toThrow(
      /otro asistente/u,
    );

    const firstCategory = database.listKnowledgeCategories(first.profileId)[0]!;
    const secondCategory = database.listKnowledgeCategories(second.profileId)[0]!;
    database.saveKnowledgeEntry({
      id: 0,
      profileId: first.profileId,
      categoryId: firstCategory.id,
      title: 'Horario privado del negocio uno',
      content: 'El negocio uno atiende exclusivamente los lunes.',
      keywords: ['lunes'],
      synonyms: [],
      enabled: true,
      priority: 100,
      internalSource: 'Configuración del negocio uno',
    });
    expect(database.searchKnowledge(second.profileId, 'lunes', 3, 500)).toEqual([]);
    expect(() =>
      database.saveKnowledgeEntry({
        id: 0,
        profileId: first.profileId,
        categoryId: secondCategory.id,
        title: 'Cruce no permitido',
        content: 'Este contenido no debe poder asociarse a otra base.',
        keywords: ['cruce'],
        synonyms: [],
        enabled: true,
        priority: 0,
        internalSource: null,
      }),
    ).toThrow(/no pertenece/u);
  });

  it('mantiene Meta Business Agent visible pero deshabilitado y valida modelos Groq', () => {
    const registry = new AIProviderRegistry();
    expect(registry.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'groq', enabled: true, comingSoon: false }),
        expect.objectContaining({
          id: 'meta_business_agent',
          enabled: false,
          comingSoon: true,
          models: [],
        }),
      ]),
    );
    expect(registry.isAllowedModel('groq', DEFAULT_GROQ_MODEL)).toBe(true);
    expect(registry.isAllowedModel('groq', 'modelo-inventado')).toBe(false);
  });

  it('usa exclusivamente la credencial Groq de plataforma', async () => {
    const assistant = createBusiness(database, 'credencial-plataforma', 'Credencial Plataforma');
    let authorization: string | null = null;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Respuesta segura.' } }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const factory = new AIProviderFactory(
      database,
      'clave-exclusiva-de-plataforma',
      DEFAULT_GROQ_MODEL,
      'groq',
      fetchImplementation,
    );

    await factory.forBot(assistant.id).generateGroundedResponse({
      systemInstruction: 'Responde solo con información verificada.',
      question: 'Consulta',
      context: 'Contexto',
      maximumOutputTokens: 100,
      temperature: 0,
      timeoutMs: 1_000,
    });

    expect(authorization).toBe('Bearer clave-exclusiva-de-plataforma');
  });
});

describe('API SaaS y seguridad multi-tenant', () => {
  let database: AppDatabase;
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    database?.close();
  });

  it('crea y edita asistentes con todos los tipos canónicos y rechaza el alias legado', async () => {
    const setup = await createServer('platform-secret-never-expose');
    ({ database, app } = setup);
    const auth = await login(app, 'admin', 'contraseña-global-segura');

    const contract = await app.inject({
      method: 'GET',
      url: '/api/bots',
      headers: { cookie: auth.cookie },
    });
    expect(contract.statusCode).toBe(200);
    expect(contract.json().organizationTypes).toEqual(ORGANIZATION_TYPE_OPTIONS);

    const createdIds = new Map<OrganizationType, string>();
    for (const [index, organizationType] of ORGANIZATION_TYPES.entries()) {
      const created = await authenticated(app, auth, {
        method: 'POST',
        url: '/api/bots',
        payload: assistantCreatePayload(organizationType, index),
      });
      expect(created.statusCode, organizationType).toBe(201);
      const assistantId = created.json().bot.id as string;
      createdIds.set(organizationType, assistantId);
      expect(database.getBotProfile(assistantId).organizationType).toBe(organizationType);
    }

    const servicesId = createdIds.get('Servicios');
    if (servicesId === undefined) throw new Error('No se creó el asistente de servicios.');
    const currentProfile = database.getBotProfile(servicesId);
    const edited = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${servicesId}/profile`,
      payload: editableProfile(currentProfile, {
        organizationName: currentProfile.organizationName,
        description: currentProfile.description,
        language: 'es-CL',
        organizationType: 'Profesional independiente',
      }),
    });
    expect(edited.statusCode).toBe(200);
    expect(database.getBotProfile(servicesId).organizationType).toBe('Profesional independiente');

    const invalidEdit = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${servicesId}/profile`,
      payload: editableProfile(database.getBotProfile(servicesId), {
        organizationName: currentProfile.organizationName,
        description: currentProfile.description,
        language: 'es-CL',
        organizationType: 'Servicio profesional',
      }),
    });
    expect(invalidEdit.statusCode).toBe(400);
    expect(invalidEdit.json()).toEqual({
      error: 'No se pudo guardar porque el tipo de negocio seleccionado no es válido.',
      code: 'INVALID_ORGANIZATION_TYPE',
    });

    const invalidCreate = await authenticated(app, auth, {
      method: 'POST',
      url: '/api/bots',
      payload: assistantCreatePayload('Servicio profesional', 99),
    });
    expect(invalidCreate.statusCode).toBe(400);
    expect(invalidCreate.json()).toEqual({
      error: 'No se pudo guardar porque el tipo de negocio seleccionado no es válido.',
      code: 'INVALID_ORGANIZATION_TYPE',
    });
  });

  it('completa el wizard, edita el negocio, persiste el modelo y prueba la lógica central', async () => {
    const platformSecret = 'platform-secret-never-expose';
    const setup = await createServer(platformSecret);
    ({ database, app } = setup);
    const auth = await login(app, 'admin', 'contraseña-global-segura');

    const providers = await app.inject({
      method: 'GET',
      url: '/api/ai/providers',
      headers: { cookie: auth.cookie },
    });
    expect(providers.statusCode).toBe(200);
    expect(providers.json().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'meta_business_agent', enabled: false, comingSoon: true }),
      ]),
    );

    const created = await authenticated(app, auth, {
      method: 'POST',
      url: '/api/bots',
      payload: {
        organizationName: 'Veterinaria Michi',
        botName: 'Michi',
        description: 'Atención veterinaria para mascotas de la comuna.',
        language: 'es-CL',
        organizationType: 'Salud',
        timezone: 'America/Santiago',
        connectorType: 'WHATSAPP_CLOUD_API',
        whatsappSetupMode: 'EXISTING',
        provider: 'groq',
        model: DEFAULT_GROQ_MODEL,
        behavior: {
          showInitialMenuOnGreeting: true,
          allowFreeQuestions: true,
          useAIForUnmatched: true,
          useBusinessKnowledge: false,
          fallbackMessage: 'No pude responder. Contacta a Veterinaria Michi.',
        },
        preset: 'service',
        menuType: 'automatic',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(platformSecret);
    expect(created.body).not.toMatch(/accessToken|apiKey/iu);
    const assistantId = created.json().bot.id as string;
    const assistant = database.getBot(assistantId)!;
    expect(assistant.businessId).not.toBe(assistant.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/bots/${assistantId}`,
      headers: { cookie: auth.cookie },
    });
    expect(detail.json()).toMatchObject({
      business: { name: 'Veterinaria Michi', status: 'DRAFT' },
      behavior: { allowFreeQuestions: true, useBusinessKnowledge: false },
      whatsapp: { setupMode: 'EXISTING' },
    });
    expect(detail.body).not.toContain(platformSecret);

    const interactions = await app.inject({
      method: 'GET',
      url: `/api/bots/${assistantId}/interactions`,
      headers: { cookie: auth.cookie },
    });
    expect(interactions.statusCode).toBe(200);
    expect(interactions.json()).toMatchObject({
      persistent: { menus: expect.any(Array), options: expect.any(Array) },
      dynamic: {
        allowDynamicButtons: true,
        allowDynamicLists: true,
        allowBusinessDataQueries: true,
        allowWriteTools: false,
      },
      tools: expect.arrayContaining([
        expect.objectContaining({ id: 'get_services', availability: 'AVAILABLE' }),
        expect.objectContaining({ id: 'get_available_slots', state: 'FUTURE' }),
      ]),
      actions: expect.any(Array),
    });
    expect(interactions.body).not.toContain(platformSecret);

    const dynamicSettings = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${assistantId}/interactions/dynamic`,
      payload: {
        allowDynamicButtons: false,
        allowDynamicLists: true,
        allowBusinessDataQueries: true,
        showAISuggestedActions: false,
        allowWriteTools: false,
      },
    });
    expect(dynamicSettings.statusCode).toBe(200);
    expect(dynamicSettings.json().behavior).toMatchObject({
      allowDynamicButtons: false,
      showAISuggestedActions: false,
      allowWriteTools: false,
    });

    const futureTool = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${assistantId}/tools/get_available_slots`,
      payload: { enabled: true, permissions: ['EXECUTE'] },
    });
    expect(futureTool.statusCode).toBe(409);
    expect(futureTool.json()).toMatchObject({ code: 'TOOL_REAL_SOURCE_REQUIRED' });

    const actualTool = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${assistantId}/tools/get_services`,
      payload: { enabled: false, permissions: ['READ', 'SUGGEST'] },
    });
    expect(actualTool.statusCode).toBe(200);
    expect(actualTool.json().configuration).toMatchObject({
      assistantId,
      toolId: 'get_services',
      enabled: false,
    });

    const currentProfile = database.getBotProfile(assistantId);
    const edited = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${assistantId}/profile`,
      payload: editableProfile(currentProfile, {
        organizationName: 'Veterinaria Michi SpA',
        description: 'Atención veterinaria, vacunación y productos para mascotas.',
        language: 'en',
      }),
    });
    expect(edited.statusCode).toBe(200);
    expect(database.getBusinessByBotId(assistantId)).toMatchObject({
      name: 'Veterinaria Michi SpA',
      language: 'en',
    });

    const currentAI = database.getAISettings(assistant.profileId);
    const { profileId: _profileId, updatedAt: _updatedAt, ...editableAI } = currentAI;
    expect(_profileId).toBe(assistant.profileId);
    expect(_updatedAt).toBeTruthy();
    const modelUpdated = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${assistantId}/ai/settings`,
      payload: {
        ...editableAI,
        model: 'openai/gpt-oss-20b',
        confirmIncreasedLimits: false,
      },
    });
    expect(modelUpdated.statusCode).toBe(200);
    expect(database.getAISettings(assistant.profileId).model).toBe('openai/gpt-oss-20b');
    expect(database.getAISettings(assistant.profileId).providerConfig).toEqual({
      model: 'openai/gpt-oss-20b',
    });

    const simulation = await authenticated(app, auth, {
      method: 'POST',
      url: `/api/bots/${assistantId}/simulator`,
      payload: { message: '¿Cuánto es 2 + 2?' },
    });
    expect(simulation.statusCode).toBe(200);
    expect(simulation.json()).toMatchObject({
      response: 'La respuesta es 4.',
      debug: {
        route: 'AI_FALLBACK',
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        knowledgeUsed: false,
        status: 'success',
        error: null,
      },
    });
    expect(simulation.body).not.toContain(platformSecret);
    expect(
      database.getTechnicalEvents().find((event) => event.event_type === 'AI_QUERY_COMPLETED'),
    ).toMatchObject({
      business_id: assistant.businessId,
      bot_id: assistantId,
      channel: 'SIMULATOR',
      route: 'AI_FALLBACK',
      ai_provider: 'groq',
      ai_model: 'openai/gpt-oss-20b',
      knowledge_used: 0,
      status: 'success',
    });

    const category = database.listKnowledgeCategories(assistant.profileId)[0]!;
    database.saveKnowledgeEntry({
      id: 0,
      profileId: assistant.profileId,
      categoryId: category.id,
      title: 'Vacunación de mascotas',
      content: 'Las jornadas de vacunación se realizan los martes y jueves con reserva previa.',
      keywords: ['vacunación', 'mascotas'],
      synonyms: ['vacunas'],
      enabled: true,
      priority: 100,
      internalSource: 'Información verificada por el negocio',
    });
    database.saveAssistantBehavior({
      ...database.getAssistantBehavior(assistantId),
      assistantId,
      useBusinessKnowledge: true,
    });
    const groundedSimulation = await authenticated(app, auth, {
      method: 'POST',
      url: `/api/bots/${assistantId}/simulator`,
      payload: { message: '¿Qué días realizan jornadas de vacunación para mascotas?' },
    });
    expect(groundedSimulation.statusCode).toBe(200);
    expect(groundedSimulation.json().debug).toMatchObject({
      route: 'AI_KNOWLEDGE',
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      knowledgeUsed: true,
    });

    const activation = await authenticated(app, auth, {
      method: 'PATCH',
      url: `/api/bots/${assistantId}/configuration`,
      payload: {
        enabled: true,
        continuedConversationsEnabled: true,
        menuType: 'automatic',
      },
    });
    expect(activation.statusCode).toBe(409);
    expect(activation.json()).toMatchObject({
      code: 'ASSISTANT_NOT_READY',
      missingRequirements: expect.arrayContaining(['Conecta y valida el canal de WhatsApp.']),
    });

    database.configureMetaConnector(assistantId, {
      phoneNumberId: '123456789012345',
      wabaId: '987654321098765',
      credentialReference: 'environment:meta/referencia-interna-privada',
    });
    const safeDetail = await app.inject({
      method: 'GET',
      url: `/api/bots/${assistantId}`,
      headers: { cookie: auth.cookie },
    });
    const safeWhatsApp = await app.inject({
      method: 'GET',
      url: `/api/bots/${assistantId}/whatsapp`,
      headers: { cookie: auth.cookie },
    });
    for (const response of [safeDetail, safeWhatsApp]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('referencia-interna-privada');
      expect(response.body).not.toContain('credentialReference');
    }

    const byokPut = await authenticated(app, auth, {
      method: 'PUT',
      url: `/api/bots/${assistantId}/ai-key`,
      payload: { apiKey: 'clave-por-negocio-no-permitida' },
    });
    const byokDelete = await authenticated(app, auth, {
      method: 'DELETE',
      url: `/api/bots/${assistantId}/ai-key`,
    });
    expect(byokPut.statusCode).toBe(404);
    expect(byokDelete.statusCode).toBe(404);
  });

  it('impide que un administrador de negocio lea o modifique otro tenant', async () => {
    const setup = await createServer('platform-secret');
    ({ database, app } = setup);
    const first = createBusiness(database, 'cliente-uno', 'Cliente Uno');
    const second = createBusiness(database, 'cliente-dos', 'Cliente Dos');
    database.setPanelPasswordHash(await hashPassword('contraseña-cliente-segura'), 'cliente-admin');
    database.setPanelUserRole('cliente-admin', 'business_admin');
    database.grantPanelUserBusinessAccess('cliente-admin', first.businessId);

    const ownConversation = database.recordConversationMessage({
      assistantId: first.id,
      phoneNumberId: '111111111111111',
      waId: '56911111111',
      whatsappMessageId: 'wamid.tenant.one',
      direction: 'inbound',
      senderType: 'customer',
      messageType: 'text',
      text: 'Mensaje del tenant uno',
    }).conversation;
    const foreignConversation = database.recordConversationMessage({
      assistantId: second.id,
      phoneNumberId: '222222222222222',
      waId: '56922222222',
      whatsappMessageId: 'wamid.tenant.two',
      direction: 'inbound',
      senderType: 'customer',
      messageType: 'text',
      text: 'Mensaje privado del tenant dos',
    }).conversation;
    const auth = await login(app, 'cliente-admin', 'contraseña-cliente-segura');

    const list = await app.inject({
      method: 'GET',
      url: '/api/bots',
      headers: { cookie: auth.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().bots.map((bot: { id: string }) => bot.id)).toEqual([first.id]);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/bots/${second.id}`,
          headers: { cookie: auth.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await authenticated(app, auth, {
          method: 'PATCH',
          url: `/api/bots/${second.id}/whatsapp/setup`,
          payload: { setupMode: 'NEW_CUSTOMER' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/bots/${second.id}/interactions`,
          headers: { cookie: auth.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await authenticated(app, auth, {
          method: 'POST',
          url: '/api/bots',
          payload: {},
        })
      ).statusCode,
    ).toBe(403);

    const conversations = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: auth.cookie },
    });
    expect(conversations.json().items).toEqual([
      expect.objectContaining({ id: ownConversation.id, assistantId: first.id }),
    ]);
    expect(conversations.body).not.toContain('Mensaje privado del tenant dos');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/conversations/${foreignConversation.id}/messages`,
          headers: { cookie: auth.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
});

function profile(organizationName: string, botName: string) {
  return createProfileFromPreset({
    organizationName,
    botName,
    organizationType: 'Comercio',
    timezone: 'America/Santiago',
    preset: 'store',
  });
}

function createBusiness(database: AppDatabase, id: string, name: string) {
  return database.createBot({
    id,
    business: {
      name,
      description: `${name} entrega servicios a sus clientes.`,
      language: 'es-CL',
      timezone: 'America/Santiago',
    },
    profile: profile(name, `Asistente ${name}`),
  });
}

async function createServer(platformSecret: string) {
  const database = new AppDatabase(':memory:');
  database.migrate();
  database.setPanelPasswordHash(await hashPassword('contraseña-global-segura'));
  const logger = createLogger('silent');
  const anonymizer = new Anonymizer('x'.repeat(32));
  const fetchImplementation: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                message: 'La respuesta es 4.',
                intent: 'answer_question',
                presentation_preference: 'text',
                suggested_actions: [],
                tool_request: null,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const providerFactory = new AIProviderFactory(
    database,
    platformSecret,
    DEFAULT_GROQ_MODEL,
    'groq',
    fetchImplementation,
  );
  const manager = new MultiBotManager(
    database,
    providerFactory,
    anonymizer,
    logger,
    {
      maxMessageLength: 2000,
      maxReconnectAttempts: 1,
      maxReconnectDelayMs: 10,
      developmentMode: false,
      mediaRoot: 'data/media',
    },
    { apiVersion: 'v23.0', requestTimeoutMs: 1000, accounts: [] },
  );
  const app = await buildAdminServer({
    database,
    anonymizer,
    logger,
    sessionSecret: 's'.repeat(32),
    applicationVersion: '0.1.0-test',
    developmentMode: false,
    multiBotManager: manager,
    aiProviderFactory: providerFactory,
  });
  return { database, app };
}

async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<Authentication> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(';')[0];
  if (cookie === undefined) throw new Error('No se recibió cookie de sesión.');
  return { cookie, csrf: response.json().csrfToken as string };
}

async function authenticated(
  app: FastifyInstance,
  auth: Authentication,
  input: {
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    payload?: unknown;
  },
): Promise<InjectResponse> {
  return app.inject({
    method: input.method,
    url: input.url,
    headers: {
      cookie: auth.cookie,
      'x-csrf-token': auth.csrf,
      ...(input.payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(input.payload === undefined ? {} : { body: JSON.stringify(input.payload) }),
  });
}

function editableProfile(
  value: ReturnType<AppDatabase['getBotProfile']>,
  changes: {
    organizationName: string;
    description: string;
    language: string;
    organizationType?: unknown;
  },
) {
  return {
    internalName: value.internalName,
    organizationName: changes.organizationName,
    botName: value.botName,
    description: changes.description,
    organizationType: changes.organizationType ?? value.organizationType,
    industry: value.industry,
    objective: value.objective,
    allowedTopics: value.allowedTopics,
    excludedTopics: value.excludedTopics,
    tone: value.tone,
    outOfScopeMessage: value.outOfScopeMessage,
    noInformationMessage: value.noInformationMessage,
    limitMessage: value.limitMessage,
    aiErrorMessage: value.aiErrorMessage,
    medicalMessage: value.medicalMessage,
    contactInformation: value.contactInformation,
    businessHours: value.businessHours,
    address: value.address,
    logoPath: value.logoPath,
    primaryColor: value.primaryColor,
    secondaryColor: value.secondaryColor,
    timezone: value.timezone,
    language: changes.language,
    applicationName: value.applicationName,
    headerText: value.headerText,
    footerText: value.footerText,
    supportInformation: value.supportInformation,
  };
}

function assistantCreatePayload(organizationType: unknown, index: number) {
  return {
    organizationName: `Negocio contrato ${index}`,
    botName: `Asistente ${index}`,
    description: `Descripción del negocio de prueba ${index}.`,
    language: 'es-CL',
    organizationType,
    timezone: 'America/Santiago',
    connectorType: 'WHATSAPP_CLOUD_API',
    whatsappSetupMode: 'EXISTING',
    provider: 'groq',
    model: DEFAULT_GROQ_MODEL,
    behavior: {
      showInitialMenuOnGreeting: true,
      allowFreeQuestions: true,
      useAIForUnmatched: true,
      useBusinessKnowledge: false,
      fallbackMessage: 'No pude responder. Contacta al negocio.',
    },
    preset: 'empty',
    menuType: 'automatic',
  };
}
