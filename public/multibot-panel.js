import { api, normalizeOrganizationType, setOrganizationTypeAliases } from './js/api-client.js';
import {
  actionButton,
  bindAsyncForm,
  confirmAction,
  element,
  formatDate,
  hidePanel,
  lines,
  listRow,
  notify,
  numberOrNull,
  renderEmpty,
  renderHealthGrid,
  renderMetricGrid,
  setLoading,
  setStatus,
  setTestResult,
  showPanel,
  statusBadge,
  withBusy,
} from './js/ui.js';

const state = {
  selectedBotId: null,
  bot: null,
  profile: null,
  bots: [],
  visibleModules: [],
  knowledgeCategories: [],
  knowledgeEntries: [],
  cachedAnswers: [],
  menus: [],
  menuOptions: [],
  tools: [],
  behavior: null,
  catalogCategories: [],
  catalogItems: [],
  mediaAssets: [],
  requests: [],
  requestFilter: 'pending',
  ai: null,
  activityHistory: [],
  conversations: [],
  conversationPage: 1,
  conversationPagination: null,
  selectedConversationId: null,
  selectedConversation: null,
  conversationMessages: [],
  conversationMessagePage: 1,
  conversationMessagePagination: null,
  refreshTimer: null,
  aiProviders: [],
  defaultAIModel: '',
  wizardStep: 1,
  role: 'global_admin',
};

const dayLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const answerStatusLabels = {
  ADMIN_APPROVED: 'Aprobada',
  ADMIN_EDITED: 'Editada',
  DISABLED: 'Inactiva',
  INVALIDATED: 'Pendiente de revisión',
  AUTO_APPROVED: 'Automática',
};

const actionLabels = {
  text: 'Mostrar mensaje',
  catalog_item: 'Mostrar producto o servicio',
  catalog_category: 'Mostrar categoría',
  media: 'Enviar imagen',
  submenu: 'Abrir otro menú',
  knowledge: 'Buscar en conocimiento',
  ai: 'Responder con IA',
  hours: 'Mostrar horarios',
  address: 'Mostrar dirección',
  payments: 'Informar formas de pago',
  shipping: 'Informar despachos',
  human_assistance: 'Solicitar atención humana',
  reservation_request: 'Solicitar reserva',
  back: 'Volver',
  exit: 'Finalizar',
};

const eventLabels = {
  REAL_MENTION_RECEIVED: 'Consulta recibida',
  TEXT_ALIAS_RECEIVED: 'Consulta recibida',
  LOCAL_FAQ_RESPONSE: 'Respuesta frecuente',
  KNOWLEDGE_DIRECT_RESPONSE: 'Respuesta desde conocimiento',
  ANSWER_CACHE_EXACT_HIT: 'Respuesta guardada',
  ANSWER_CACHE_EQUIVALENT_HIT: 'Respuesta guardada',
  ANSWER_CACHE_MISS: 'Consulta nueva',
  AI_CALL_SUCCESS: 'Respuesta de inteligencia artificial',
  AI_CALL_FAILED: 'Error al responder con IA',
  AI_LIMIT_REACHED: 'Límite de IA alcanzado',
  OUT_OF_SCOPE_LOCAL_RESPONSE: 'Consulta fuera de alcance',
  KNOWLEDGE_NOT_FOUND: 'Información no encontrada',
  DUPLICATE_QUERY_SUPPRESSED: 'Consulta repetida',
  CONCURRENT_QUERY_COALESCED: 'Consulta agrupada',
  HUMAN_ASSISTANCE_REQUESTED: 'Solicitud de atención humana',
  MENU_OPTION_SELECTED: 'Opción de menú seleccionada',
  CATALOG_ITEM_SENT: 'Información de catálogo enviada',
  ASSISTANT_ADMIN_OPENED: 'Panel del asistente abierto',
  ASSISTANT_CONTEXT_CHANGED: 'Asistente seleccionado',
};

let navigation = null;
let configured = false;
let initializationPromise = null;
let moreMenuSequence = 0;

function providerLabel(value) {
  if (value === 'groq') return 'Groq';
  if (value === 'disabled') return 'Desactivada';
  return value || 'Sin proveedor';
}

const assistantStatusLabels = {
  DRAFT: 'Borrador',
  READY_TO_TEST: 'Listo para probar',
  OPERATIONAL: 'Operativo',
  PAUSED: 'Pausado',
  ERROR: 'Error',
};

const readinessTone = {
  DRAFT: 'warning',
  READY_TO_TEST: 'neutral',
  OPERATIONAL: 'success',
  PAUSED: 'warning',
  ERROR: 'error',
};

function modelLabel(modelId) {
  for (const provider of state.aiProviders) {
    const model = provider.models.find((candidate) => candidate.id === modelId);
    if (model) return model.label;
  }
  return modelId || 'Sin modelo';
}

async function loadAIProviders() {
  const result = await api('/api/ai/providers');
  state.aiProviders = result.providers || [];
  state.defaultAIModel = result.defaultModel || '';
  populateAIModelSelects();
}

function populateAIModelSelects(selectedModel = null) {
  const groq = state.aiProviders.find((provider) => provider.id === 'groq');
  const models = groq?.models || [];
  for (const select of document.querySelectorAll('[data-ai-model-select]')) {
    const current = selectedModel || select.value || state.defaultAIModel;
    select.replaceChildren();
    for (const model of models) {
      const suffix = model.recommended ? ' · Recomendado' : '';
      select.add(new window.Option(`${model.label}${suffix}`, model.id));
    }
    select.value = models.some((model) => model.id === current) ? current : state.defaultAIModel;
  }
}

function safeHash(value, label = 'Usuario') {
  return value ? `${label} · ${String(value).slice(0, 8)}` : 'Sin identificador';
}

function recordPanelEvent(eventType, assistantId) {
  void api('/api/panel-events', {
    method: 'POST',
    body: JSON.stringify({ eventType, ...(assistantId ? { assistantId } : {}) }),
  }).catch(() => {
    // La telemetría segura del panel no debe interrumpir la administración.
  });
}

function createMoreMenu(items, label = 'Más acciones') {
  const host = element('div', { className: 'more-menu' });
  const menuId = `more-menu-${(moreMenuSequence += 1)}`;
  const trigger = element('button', {
    className: 'icon-button secondary',
    attributes: {
      type: 'button',
      'aria-label': label,
      'aria-expanded': 'false',
      'aria-controls': menuId,
    },
  });
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-more');
  icon.append(use);
  trigger.append(icon);

  const menu = element('div', {
    className: 'more-menu__panel hidden',
    attributes: { id: menuId, role: 'menu' },
  });
  for (const item of items) {
    const button = actionButton(item.label, item.danger ? 'danger' : '', async () => {
      trigger.focus();
      menu.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      await item.action();
    });
    button.setAttribute('role', 'menuitem');
    menu.append(button);
  }
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const shouldOpen = menu.classList.contains('hidden');
    closeAllMoreMenus();
    if (!shouldOpen) return;
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    closeAllMoreMenus();
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  });
  menu.addEventListener('keydown', (event) => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAllMoreMenus();
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + direction + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
    }
  });
  host.append(trigger, menu);
  return host;
}

function closeAllMoreMenus() {
  document.querySelectorAll('.more-menu__panel').forEach((menu) => menu.classList.add('hidden'));
  document
    .querySelectorAll('.more-menu > button[aria-expanded="true"]')
    .forEach((button) => button.setAttribute('aria-expanded', 'false'));
}

async function loadBots({ background = false } = {}) {
  const target = document.querySelector('#bots-list');
  if (!background) setLoading(target, 'Cargando asistentes…');
  const result = await api('/api/bots');
  configureOrganizationTypeContract(result.organizationTypes, result.legacyOrganizationTypeAliases);
  state.bots = result.bots;
  if (result.bots.length === 0) {
    renderEmpty(
      target,
      'Todavía no hay asistentes',
      state.role === 'global_admin'
        ? 'Crea el primero para comenzar a atender con Don Gato Digital.'
        : 'Tu cuenta todavía no tiene un negocio asignado.',
      state.role === 'global_admin'
        ? actionButton('Crear asistente', '', () => openCreateBot())
        : undefined,
    );
    return;
  }

  target.replaceChildren();
  for (const bot of result.bots) {
    const card = element('article', { className: 'assistant-card' });
    const heading = element('div', { className: 'assistant-card__heading' });
    const copy = element('div');
    copy.append(
      element('h3', { text: bot.businessName || bot.organizationName || bot.botName }),
      element('p', {
        className: 'assistant-card__bot-name',
        text: `Asistente · ${bot.assistantName || bot.botName}`,
      }),
    );
    heading.append(
      copy,
      statusBadge(
        assistantStatusLabels[bot.assistantStatus] || 'Sin estado',
        readinessTone[bot.assistantStatus] || 'neutral',
      ),
    );

    const facts = element('div', { className: 'assistant-card__facts' });
    const factValues = [
      ['WhatsApp', readinessLabel(bot.readiness?.whatsapp)],
      ['Proveedor de IA', providerLabel(bot.aiProvider)],
      ['Modelo', modelLabel(bot.aiModel)],
      ['Conocimiento', bot.knowledgeStatus === 'CONFIGURED' ? 'Activo' : 'Vacío'],
    ];
    if (bot.lastUpdatedAt) factValues.push(['Actualizado', formatDate(bot.lastUpdatedAt)]);
    for (const [label, value] of factValues) {
      const row = element('div', { className: 'fact-row' });
      row.append(element('span', { text: label }), element('strong', { text: value }));
      facts.append(row);
    }

    const actions = element('div', { className: 'assistant-card__actions' });
    actions.append(
      actionButton('Administrar', '', () => selectBot(bot.id, 'status')),
      actionButton('Probar', 'secondary', () => selectBot(bot.id, 'test-center')),
      createMoreMenu([
        {
          label: bot.enabled ? 'Pausar asistente' : 'Activar asistente',
          action: () => toggleBot(bot),
        },
        {
          label: 'Enviar a la papelera',
          danger: true,
          action: () => sendBotToTrash(bot),
        },
      ]),
    );
    card.append(heading, facts, actions);
    target.append(card);
  }
}

function configureOrganizationTypeContract(options, aliases) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('No fue posible cargar los tipos de negocio. Actualiza la página.');
  }
  const normalizedOptions = options.map((option) => ({
    value: typeof option?.value === 'string' ? option.value : '',
    label: typeof option?.label === 'string' ? option.label : '',
  }));
  if (
    normalizedOptions.some((option) => option.value.length === 0 || option.label.length === 0) ||
    new Set(normalizedOptions.map((option) => option.value)).size !== normalizedOptions.length
  ) {
    throw new Error('No fue posible cargar los tipos de negocio. Actualiza la página.');
  }

  setOrganizationTypeAliases(aliases);
  for (const select of document.querySelectorAll('[data-organization-type-select]')) {
    const current = normalizeOrganizationType(select.value);
    select.replaceChildren();
    for (const option of normalizedOptions) {
      select.add(new window.Option(option.label, option.value));
    }
    select.value = normalizedOptions.some((option) => option.value === current)
      ? current
      : normalizedOptions[0].value;
    select.disabled = false;
  }
}

function readinessLabel(value) {
  if (value === 'CONNECTED') return 'Conectado';
  if (value === 'CONFIGURING') return 'Configurando';
  if (value === 'ERROR') return 'Error';
  return 'No configurado';
}

function openCreateBot() {
  const form = document.querySelector('#create-bot-form');
  showWizardStep(1);
  populateAIModelSelects();
  showPanel(form, { focus: true });
}

function closeCreateBot() {
  const form = document.querySelector('#create-bot-form');
  form.reset();
  form.elements.timezone.value = 'America/Santiago';
  form.elements.menuType.value = 'automatic';
  populateAIModelSelects();
  showWizardStep(1);
  hidePanel(form);
}

function showWizardStep(step) {
  state.wizardStep = Math.max(1, Math.min(8, step));
  document.querySelectorAll('[data-wizard-step]').forEach((panel) => {
    panel.classList.toggle('hidden', Number(panel.dataset.wizardStep) !== state.wizardStep);
  });
  document.querySelectorAll('[data-wizard-indicator]').forEach((indicator) => {
    const position = Number(indicator.dataset.wizardIndicator);
    indicator.classList.toggle('active', position === state.wizardStep);
    indicator.classList.toggle('complete', position < state.wizardStep);
    if (position === state.wizardStep) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
  });
  document.querySelector('#wizard-previous').classList.toggle('hidden', state.wizardStep === 1);
  document.querySelector('#wizard-next').classList.toggle('hidden', state.wizardStep === 8);
  document.querySelector('#wizard-submit').classList.toggle('hidden', state.wizardStep !== 8);
  document
    .querySelector(`[data-wizard-step="${state.wizardStep}"] legend`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function validateWizardStep() {
  const step = document.querySelector(`[data-wizard-step="${state.wizardStep}"]`);
  const inputs = [...step.querySelectorAll('input, select, textarea')].filter(
    (input) => !input.disabled,
  );
  for (const input of inputs) {
    if (!input.checkValidity()) {
      input.reportValidity();
      input.focus();
      return false;
    }
  }
  return true;
}

async function toggleBot(bot) {
  const detail = await api(`/api/bots/${encodeURIComponent(bot.id)}`);
  await api(`/api/bots/${encodeURIComponent(bot.id)}/configuration`, {
    method: 'PATCH',
    body: JSON.stringify({
      enabled: !detail.bot.enabled,
      continuedConversationsEnabled: detail.bot.continuedConversationsEnabled,
      menuType: detail.bot.menuType,
    }),
  });
  await loadBots();
  if (state.selectedBotId === bot.id) await loadBotSummary({ refreshForms: false });
  notify(detail.bot.enabled ? 'Asistente desactivado.' : 'Asistente activado.');
}

async function sendBotToTrash(bot) {
  const confirmation = await confirmAction({
    title: 'Enviar asistente a la papelera',
    description: `${bot.organizationName || bot.botName} quedará detenido y podrá restaurarse durante 30 días.`,
    expectedConfirmation: bot.botName,
    requirePassword: true,
    confirmLabel: 'Enviar a la papelera',
    danger: true,
  });
  if (!confirmation) return;
  await api(`/api/bots/${encodeURIComponent(bot.id)}/trash`, {
    method: 'POST',
    body: JSON.stringify({
      password: confirmation.password,
      confirmationName: confirmation.confirmation,
    }),
  });
  if (state.selectedBotId === bot.id) await setGlobalContext('bots');
  await Promise.all([loadBots(), loadTrash()]);
  notify('Asistente enviado a la papelera.');
}

async function loadTrash() {
  const target = document.querySelector('#trash-list');
  setLoading(target, 'Cargando papelera…');
  const result = await api('/api/assistants/trash');
  if (result.assistants.length === 0) {
    renderEmpty(target, 'La papelera está vacía', 'No hay asistentes pendientes de restauración.');
    return;
  }

  target.replaceChildren();
  for (const assistant of result.assistants) {
    const card = element('article', { className: 'assistant-card' });
    const heading = element('div', { className: 'assistant-card__heading' });
    const copy = element('div');
    copy.append(
      element('h3', { text: assistant.organizationName || assistant.botName }),
      element('p', { className: 'assistant-card__bot-name', text: assistant.botName }),
    );
    heading.append(copy, statusBadge('En papelera', 'warning'));
    const facts = element('div', { className: 'assistant-card__facts' });
    const scheduled = element('div', { className: 'fact-row' });
    scheduled.append(
      element('span', { text: 'Eliminación programada' }),
      element('strong', { text: formatDate(assistant.scheduledPermanentDeletionAt) }),
    );
    facts.append(scheduled);
    const actions = element('div', { className: 'assistant-card__actions' });
    actions.append(
      actionButton('Restaurar', '', async () => {
        await api(`/api/bots/${encodeURIComponent(assistant.id)}/restore`, {
          method: 'POST',
          body: JSON.stringify({ confirmed: true }),
        });
        await Promise.all([loadBots(), loadTrash()]);
        notify('Asistente restaurado en estado inactivo.');
      }),
      actionButton('Eliminar definitivamente', 'danger', async () => {
        const expected = `ELIMINAR PERMANENTEMENTE ${assistant.botName}`;
        const confirmation = await confirmAction({
          title: 'Eliminar definitivamente',
          description:
            'Esta acción no se puede deshacer y eliminará todos los datos del asistente.',
          expectedConfirmation: expected,
          requirePassword: true,
          confirmLabel: 'Eliminar definitivamente',
          danger: true,
        });
        if (!confirmation) return;
        await api(`/api/bots/${encodeURIComponent(assistant.id)}/permanent`, {
          method: 'DELETE',
          body: JSON.stringify({
            password: confirmation.password,
            confirmationPhrase: confirmation.confirmation,
          }),
        });
        await loadTrash();
        notify('Asistente eliminado definitivamente.');
      }),
    );
    card.append(heading, facts, actions);
    target.append(card);
  }
}

function updateAssistantContext(detail) {
  const bot = detail.bot;
  const profile = detail.profile;
  document.querySelector('#assistant-context-business').textContent =
    detail.business?.name || profile.organizationName;
  document.querySelector('#assistant-context-name').textContent = profile.botName;
  setStatus(
    '#assistant-context-status',
    assistantStatusLabels[detail.readiness?.assistant] || 'Sin estado',
    readinessTone[detail.readiness?.assistant] || 'neutral',
  );
  setStatus(
    '#assistant-context-whatsapp',
    readinessLabel(detail.readiness?.whatsapp),
    detail.readiness?.whatsapp === 'CONNECTED'
      ? 'success'
      : detail.readiness?.whatsapp === 'ERROR'
        ? 'error'
        : 'warning',
  );
  const details = [bot.organizationType, detail.whatsapp?.displayPhoneNumber].filter(Boolean);
  document.querySelector('#assistant-context-detail').textContent = details.join(' · ');
}

function fillProfile(profile, business) {
  const form = document.querySelector('#profile-form');
  for (const [field, value] of Object.entries(profile)) {
    const input = form.elements[field];
    if (!input) continue;
    input.value =
      field === 'organizationType'
        ? normalizeOrganizationType(value)
        : Array.isArray(value)
          ? value.join('\n')
          : (value ?? '');
  }
  form.elements.address.value = profile.address || '';
  form.elements.language.value = business?.language || 'es-CL';
}

function fillAssistantBehavior(behavior) {
  const form = document.querySelector('#assistant-behavior-form');
  if (!behavior) return;
  state.behavior = behavior;
  for (const [field, value] of Object.entries(behavior)) {
    const input = form.elements[field];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
  }
  const dynamicForm = document.querySelector('#dynamic-interactions-form');
  for (const field of [
    'allowDynamicButtons',
    'allowDynamicLists',
    'allowBusinessDataQueries',
    'showAISuggestedActions',
    'allowWriteTools',
  ]) {
    const input = dynamicForm.elements[field];
    if (input) input.checked = Boolean(behavior[field]);
  }
}

function dynamicBehaviorPayload() {
  const form = document.querySelector('#dynamic-interactions-form');
  return {
    allowDynamicButtons: form.elements.allowDynamicButtons.checked,
    allowDynamicLists: form.elements.allowDynamicLists.checked,
    allowBusinessDataQueries: form.elements.allowBusinessDataQueries.checked,
    showAISuggestedActions: form.elements.showAISuggestedActions.checked,
    allowWriteTools: false,
  };
}

function fillBotConfiguration(bot) {
  const form = document.querySelector('#bot-configuration-form');
  form.elements.enabled.checked = Boolean(bot.enabled);
  form.elements.continuedConversationsEnabled.checked = Boolean(bot.continuedConversationsEnabled);
  form.elements.continuedConversationsEnabled.disabled =
    !bot.capabilities.conversationContinuationEnabled;
  form.elements.menuType.value = bot.menuType;
  form.elements.menuType.disabled = !bot.capabilities.interactiveMenusEnabled;
}

function renderOverview(detail) {
  const readiness = detail.readiness || {};
  renderHealthGrid('#status-cards', [
    {
      label: 'Asistente',
      value: assistantStatusLabels[readiness.assistant] || 'Sin estado',
      tone: readinessTone[readiness.assistant] || 'neutral',
    },
    {
      label: 'WhatsApp',
      value: readinessLabel(readiness.whatsapp),
      tone: readiness.whatsapp === 'CONNECTED' ? 'success' : 'warning',
    },
    {
      label: 'Inteligencia artificial',
      value:
        readiness.ai === 'GROQ_CONNECTED'
          ? 'Groq conectado'
          : readiness.ai === 'ERROR'
            ? 'Error'
            : 'No configurada',
      tone:
        readiness.ai === 'GROQ_CONNECTED'
          ? 'success'
          : readiness.ai === 'ERROR'
            ? 'error'
            : 'warning',
    },
    {
      label: 'Conocimiento',
      value: readiness.knowledge === 'CONFIGURED' ? 'Configurado' : 'Vacío',
      tone: readiness.knowledge === 'CONFIGURED' ? 'success' : 'warning',
    },
  ]);

  const quickActions = document.querySelector('#status-quick-actions');
  const activationButton = actionButton(
    detail.bot.enabled ? 'Pausar asistente' : 'Activar asistente',
    detail.bot.enabled ? 'secondary' : '',
    () => toggleBot(detail.bot),
  );
  if (!detail.bot.enabled && readiness.canActivate === false) {
    activationButton.disabled = true;
    activationButton.title = (readiness.missingRequirements || []).join(' ');
  }
  quickActions.replaceChildren(
    activationButton,
    actionButton('Revisar WhatsApp', 'secondary', () =>
      navigation.navigate('whatsapp', { focus: true }),
    ),
    actionButton('Editar conocimiento', 'secondary', () =>
      navigation.navigate('knowledge', { focus: true }),
    ),
    actionButton('Abrir centro de pruebas', 'secondary', () =>
      navigation.navigate('test-center', { focus: true }),
    ),
  );

  const issues = (readiness.missingRequirements || []).map((description) => [
    'Configuración pendiente',
    description,
  ]);

  const attentionPanel = document.querySelector('#attention-panel');
  const attentionList = document.querySelector('#attention-list');
  attentionPanel.classList.toggle('hidden', issues.length === 0);
  attentionList.replaceChildren();
  for (const [title, description] of issues) attentionList.append(listRow(title, description));

  renderMetricGrid('#statistics-cards', [
    { label: 'Conversaciones activas', value: detail.activeConversations },
    { label: 'Preguntas hoy', value: detail.usage.requests },
    { label: 'Solicitudes pendientes', value: detail.pendingRequests },
    { label: 'Actividad registrada', value: state.activityHistory.length },
  ]);
}

async function loadBotSummary({ refreshForms = true } = {}) {
  if (!state.selectedBotId) return null;
  const detail = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}`);
  state.bot = detail.bot;
  state.profile = detail.profile;
  state.visibleModules = detail.visibleModules || [];
  navigation.setModuleVisibility(state.visibleModules);
  updateAssistantContext(detail);
  renderOverview(detail);
  if (refreshForms) {
    fillProfile(detail.profile, detail.business);
    fillBotConfiguration(detail.bot);
    fillAssistantBehavior(detail.behavior);
  }
  return detail;
}

async function selectBot(botId, section = 'status') {
  const previous = state.selectedBotId;
  if (previous !== botId) resetAssistantSimulator();
  state.selectedBotId = botId;
  navigation.setContext('assistant');
  await loadBotSummary();
  await loadActivityHistory({ background: true });
  const requested = document.querySelector(`button[data-section="${section}"]`);
  const resolved =
    requested && !requested.disabled && !requested.classList.contains('hidden')
      ? section
      : 'status';
  await navigation.navigate(resolved, { notify: false, focus: true });
  await enterSection(resolved, { history: false });
  recordPanelEvent(
    previous && previous !== botId ? 'ASSISTANT_CONTEXT_CHANGED' : 'ASSISTANT_ADMIN_OPENED',
    botId,
  );
}

async function setGlobalContext(section = 'bots') {
  state.selectedBotId = null;
  state.bot = null;
  state.profile = null;
  state.visibleModules = [];
  navigation.setContext('global');
  document.querySelector('#application-title').textContent = 'Digital';
  document.querySelector('#application-subtitle').textContent =
    'Atención inteligente para cada negocio.';
  document.title = 'Don Gato Digital';
  await navigation.navigate(section, { notify: false, focus: true });
  window.history.replaceState(null, '', section === 'bots' ? '#assistants' : `#${section}`);
  recordPanelEvent('GLOBAL_PANEL_OPENED');
}

async function loadWhatsApp() {
  if (!state.selectedBotId) return;
  const target = document.querySelector('#whatsapp-cards');
  setLoading(target, 'Comprobando WhatsApp…');
  const detail = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}`);
  const runtimeConnection = detail.runtime?.connection || { lastErrorCode: null };
  const connection = detail.whatsapp;
  const meta = detail.bot.meta || { configured: false, webhookAvailable: false };
  renderHealthGrid(target, [
    {
      label: 'Estado',
      value: readinessLabel(detail.readiness?.whatsapp),
      tone: detail.readiness?.whatsapp === 'CONNECTED' ? 'success' : 'warning',
    },
    {
      label: 'Número de WhatsApp',
      value: connection.displayPhoneNumber || 'Sin número asociado',
      tone: connection.displayPhoneNumber ? 'success' : 'warning',
    },
    { label: 'Integración', value: 'WhatsApp Cloud API', tone: 'success' },
    {
      label: 'Webhook',
      value: meta.webhookAvailable ? 'Disponible' : 'Requiere configuración',
      tone: meta.webhookAvailable ? 'success' : 'warning',
    },
  ]);

  const issues = document.querySelector('#whatsapp-issues');
  const messages = [];
  if (!meta.configured)
    messages.push('La integración requiere completar su configuración en el servidor.');
  if (meta.lastErrorCode)
    messages.push('Meta informó un problema que requiere revisión de la cuenta.');
  if (runtimeConnection.lastErrorCode)
    messages.push('La conexión registró un problema y puede necesitar revalidación.');
  issues.classList.toggle('hidden', messages.length === 0);
  issues.replaceChildren(...messages.map((message) => element('p', { text: message })));
  const setupForm = document.querySelector('#whatsapp-setup-form');
  const setupInput = setupForm.querySelector(`[name="setupMode"][value="${connection.setupMode}"]`);
  if (setupInput) setupInput.checked = true;
}

function knowledgePriorityLabel(value) {
  const priority = Number(value);
  if (priority <= -75) return 'Muy baja';
  if (priority < 0) return 'Baja';
  if (priority === 0) return 'Normal';
  if (priority < 75) return 'Alta';
  return 'Muy alta';
}

function updateKnowledgePriority(value) {
  const label = document.querySelector('#knowledge-priority-label');
  if (label) label.textContent = knowledgePriorityLabel(value);
}

function showKnowledgeCategories(visible) {
  const panel = document.querySelector('#knowledge-category-panel');
  const button = document.querySelector('#toggle-knowledge-categories');
  panel.classList.toggle('hidden', !visible);
  button.setAttribute('aria-expanded', String(visible));
  button.textContent = visible ? 'Cerrar categorías' : 'Categorías';
}

function resetKnowledgeCategoryForm() {
  const form = document.querySelector('#knowledge-category-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.enabled.checked = true;
  hidePanel(form);
}

function editKnowledgeCategory(category = null) {
  const form = document.querySelector('#knowledge-category-form');
  showKnowledgeCategories(true);
  form.reset();
  form.elements.id.value = category?.id || '';
  form.elements.name.value = category?.name || '';
  form.elements.enabled.checked = category?.enabled ?? true;
  showPanel(form, { focus: true });
}

function resetKnowledgeEntryForm() {
  const form = document.querySelector('#knowledge-entry-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.priority.value = 0;
  form.elements.internalSource.value = '';
  form.elements.enabled.checked = true;
  document.querySelector('#knowledge-entry-form-title').textContent = 'Agregar información';
  updateKnowledgePriority(0);
}

function openKnowledgeEntry(entry = null) {
  const form = document.querySelector('#knowledge-entry-form');
  resetKnowledgeEntryForm();
  if (entry) {
    for (const field of ['id', 'title', 'categoryId', 'content', 'priority']) {
      form.elements[field].value = entry[field];
    }
    form.elements.keywords.value = entry.keywords.join('\n');
    form.elements.synonyms.value = entry.synonyms.join('\n');
    form.elements.internalSource.value = entry.internalSource || '';
    form.elements.enabled.checked = entry.enabled;
    document.querySelector('#knowledge-entry-form-title').textContent = 'Editar información';
    updateKnowledgePriority(entry.priority);
  }
  showPanel(form, { focus: true });
}

async function loadKnowledge() {
  if (!state.selectedBotId) return;
  const entriesTarget = document.querySelector('#knowledge-entries');
  setLoading(entriesTarget, 'Cargando conocimiento…');
  const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/knowledge`);
  state.knowledgeCategories = result.categories;
  state.knowledgeEntries = result.entries;

  const categorySelect = document.querySelector('#knowledge-entry-form').elements.categoryId;
  replaceOptions(categorySelect, result.categories, 'id', 'name');
  document.querySelector('#new-knowledge-entry').disabled = result.categories.length === 0;

  const categoriesTarget = document.querySelector('#knowledge-categories');
  categoriesTarget.replaceChildren();
  if (result.categories.length === 0) {
    renderEmpty(
      categoriesTarget,
      'Todavía no hay categorías',
      'Crea una categoría para comenzar a organizar la información.',
      actionButton('Crear categoría', '', () => editKnowledgeCategory()),
    );
  } else {
    for (const category of result.categories) {
      const count = result.entries.filter(
        (entry) => Number(entry.categoryId) === Number(category.id),
      ).length;
      const row = listRow(
        category.name,
        `${count} elemento${count === 1 ? '' : 's'} · ${category.enabled ? 'Activa' : 'Inactiva'}`,
      );
      row.append(actionButton('Editar', 'secondary', () => editKnowledgeCategory(category)));
      categoriesTarget.append(row);
    }
  }

  if (result.entries.length === 0) {
    renderEmpty(
      entriesTarget,
      'Todavía no hay información',
      result.categories.length
        ? 'Agrega el primer dato oficial para que el asistente pueda usarlo.'
        : 'Crea primero una categoría.',
      result.categories.length
        ? actionButton('Agregar información', '', () => openKnowledgeEntry())
        : undefined,
    );
    return;
  }

  entriesTarget.replaceChildren();
  for (const entry of result.entries) {
    const row = listRow(
      entry.title,
      `${entry.categoryName} · Prioridad ${knowledgePriorityLabel(entry.priority)} · ${entry.enabled ? 'Activa' : 'Inactiva'}`,
    );
    const actions = element('div', { className: 'button-row' });
    actions.append(
      actionButton('Editar', 'secondary', () => openKnowledgeEntry(entry)),
      actionButton('Eliminar', 'danger', async () => {
        const confirmation = await confirmAction({
          title: 'Eliminar información',
          description: `“${entry.title}” dejará de estar disponible para las respuestas.`,
          confirmLabel: 'Eliminar',
          danger: true,
        });
        if (!confirmation) return;
        await api(
          `/api/bots/${encodeURIComponent(state.selectedBotId)}/knowledge/entries/${entry.id}`,
          { method: 'DELETE' },
        );
        await loadKnowledge();
        notify('Información eliminada.');
      }),
    );
    row.append(actions);
    entriesTarget.append(row);
  }
}

function resetCachedAnswerForm() {
  const form = document.querySelector('#cached-answer-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.category.value = 'General';
  form.elements.canonicalQuestion.readOnly = false;
  document.querySelector('#cached-answer-form-title').textContent = 'Crear respuesta';
}

function openCachedAnswer(answer = null) {
  const form = document.querySelector('#cached-answer-form');
  resetCachedAnswerForm();
  if (answer) {
    form.elements.id.value = answer.id;
    form.elements.canonicalQuestion.value = answer.canonicalQuestion;
    form.elements.canonicalQuestion.readOnly = true;
    form.elements.answer.value = answer.answer;
    form.elements.category.value = answer.category;
    form.elements.sourceType.value = answer.sourceType === 'MANUAL' ? 'MANUAL' : 'ADMIN_FAQ';
    form.elements.variants.value = answer.variants.join('\n');
    document.querySelector('#cached-answer-form-title').textContent = 'Editar respuesta';
  }
  showPanel(form, { focus: true });
}

async function cachedAnswerAction(answer, payload, successMessage = 'Respuesta actualizada.') {
  await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/cached-answers/${answer.id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  await loadCachedAnswers(document.querySelector('#cached-answer-search').elements.search.value);
  notify(successMessage);
}

async function loadCachedAnswers(search = '') {
  if (!state.selectedBotId) return;
  const target = document.querySelector('#cached-answers-list');
  setLoading(target, 'Cargando respuestas…');
  const suffix = search ? `?search=${encodeURIComponent(search)}` : '';
  const result = await api(
    `/api/bots/${encodeURIComponent(state.selectedBotId)}/cached-answers${suffix}`,
  );
  state.cachedAnswers = result.answers;
  if (result.answers.length === 0) {
    renderEmpty(
      target,
      search ? 'No encontramos resultados' : 'Todavía no hay respuestas',
      search
        ? 'Prueba con otra palabra o limpia la búsqueda.'
        : 'Crea una respuesta aprobada para comenzar.',
      search ? undefined : actionButton('Crear respuesta', '', () => openCachedAnswer()),
    );
    return;
  }

  target.replaceChildren();
  for (const answer of result.answers) {
    const row = listRow(
      answer.canonicalQuestion,
      `${answer.category} · ${answerStatusLabels[answer.status] || 'Guardada'} · ${answer.hitCount} uso${answer.hitCount === 1 ? '' : 's'}`,
    );
    row.querySelector('.list-row__content').append(element('p', { text: answer.answer }));
    const actions = element('div', { className: 'button-row' });
    actions.append(
      actionButton('Editar', 'secondary', () => openCachedAnswer(answer)),
      createMoreMenu([
        {
          label: 'Aprobar',
          action: () => cachedAnswerAction(answer, { action: 'approve' }, 'Respuesta aprobada.'),
        },
        {
          label: 'Desactivar',
          action: () => cachedAnswerAction(answer, { action: 'disable' }, 'Respuesta desactivada.'),
        },
        {
          label: 'Agregar variante',
          action: async () => {
            const input = await confirmAction({
              title: 'Agregar otra forma de preguntar',
              description: 'Escribe una pregunta equivalente que deba usar la misma respuesta.',
              valueLabel: 'Variante',
              valueRows: 2,
              confirmLabel: 'Agregar',
            });
            if (!input?.value) return;
            await cachedAnswerAction(answer, { action: 'add_variant', variant: input.value });
          },
        },
        {
          label: 'Revisar en la próxima consulta',
          action: () => cachedAnswerAction(answer, { action: 'regenerate' }),
        },
        {
          label: 'Ver fuentes',
          action: async () => {
            const details = await api(
              `/api/bots/${encodeURIComponent(state.selectedBotId)}/cached-answers/${answer.id}`,
              { method: 'PATCH', body: JSON.stringify({ action: 'view_sources' }) },
            );
            notify(
              details.sourceIds.length
                ? `${details.sourceIds.length} fuente${details.sourceIds.length === 1 ? '' : 's'} vinculada${details.sourceIds.length === 1 ? '' : 's'}.`
                : 'Esta respuesta no tiene fuentes vinculadas.',
              'info',
            );
          },
        },
        {
          label: 'Eliminar',
          danger: true,
          action: async () => {
            const confirmation = await confirmAction({
              title: 'Eliminar respuesta',
              description: 'La respuesta dejará de estar disponible inmediatamente.',
              confirmLabel: 'Eliminar',
              danger: true,
            });
            if (!confirmation) return;
            await api(
              `/api/bots/${encodeURIComponent(state.selectedBotId)}/cached-answers/${answer.id}`,
              { method: 'DELETE' },
            );
            await loadCachedAnswers();
            notify('Respuesta eliminada.');
          },
        },
      ]),
    );
    row.append(actions);
    target.append(row);
  }
}

function replaceOptions(select, items, valueField, labelField, emptyLabel, resolver) {
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  if (emptyLabel !== undefined) select.add(new window.Option(emptyLabel, ''));
  for (const item of items) {
    select.add(
      new window.Option(resolver ? resolver(item) : item[labelField], String(item[valueField])),
    );
  }
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function clearMenuForm() {
  const form = document.querySelector('#menu-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.expirationMinutes.value = 15;
  form.elements.presentation.value = 'AUTOMATIC';
  form.elements.listButtonLabel.value = 'Ver opciones';
  form.elements.enabled.checked = true;
  document.querySelector('#menu-form-title').textContent = 'Crear menú';
}

function openMenu(menu = null) {
  const form = document.querySelector('#menu-form');
  clearMenuForm();
  if (menu) {
    for (const field of [
      'id',
      'title',
      'message',
      'helpText',
      'expirationMinutes',
      'presentation',
      'listButtonLabel',
    ]) {
      form.elements[field].value = menu[field];
    }
    form.elements.parentMenuId.value = menu.parentMenuId || '';
    form.elements.enabled.checked = menu.enabled;
    form.elements.isInitial.checked = menu.isInitial;
    document.querySelector('#menu-form-title').textContent = 'Editar menú';
  }
  showPanel(form, { focus: true });
}

function createActionField(labelText, control) {
  const label = element('label', { text: labelText });
  label.append(control);
  return label;
}

function renderMenuActionFields(payload = {}) {
  const form = document.querySelector('#menu-option-form');
  const actionType = form.elements.actionType.value;
  const target = document.querySelector('#menu-action-fields');
  target.replaceChildren();

  if (actionType === 'text') {
    const textarea = element('textarea', { attributes: { rows: '4', maxlength: '600' } });
    textarea.dataset.actionField = 'text';
    textarea.required = true;
    textarea.value = typeof payload.text === 'string' ? payload.text : '';
    target.append(createActionField('Mensaje que verá la persona', textarea));
    return;
  }

  const references = {
    catalog_item: [state.catalogItems, 'name', 'Producto o servicio'],
    catalog_category: [state.catalogCategories, 'name', 'Categoría'],
    media: [state.mediaAssets, 'caption', 'Imagen'],
    submenu: [state.menus, 'title', 'Menú de destino'],
  };
  if (references[actionType]) {
    const [items, labelField, labelText] = references[actionType];
    const select = document.createElement('select');
    select.dataset.actionField = 'id';
    select.required = true;
    replaceOptions(
      select,
      items,
      'id',
      labelField,
      'Selecciona una opción',
      (item) => item[labelField] || `${labelText} ${item.id}`,
    );
    select.value = payload.id ? String(payload.id) : '';
    target.append(createActionField(labelText, select));
    return;
  }

  if (['knowledge', 'ai', 'payments', 'shipping'].includes(actionType)) {
    const input = document.createElement('input');
    input.dataset.actionField = 'query';
    input.maxLength = 300;
    input.value = typeof payload.query === 'string' ? payload.query : '';
    input.placeholder = 'Si lo dejas vacío, se usará el nombre de la opción.';
    target.append(createActionField('Tema que debe buscar', input));
    return;
  }

  if (['human_assistance', 'reservation_request'].includes(actionType)) {
    const input = document.createElement('input');
    input.dataset.actionField = 'interval';
    input.maxLength = 160;
    input.value = typeof payload.interval === 'string' ? payload.interval : '';
    input.placeholder = 'Ejemplo: durante la tarde';
    target.append(createActionField('Horario sugerido (opcional)', input));
    return;
  }

  target.append(
    element('p', {
      className: 'form-help',
      text: 'Esta acción no necesita información adicional.',
    }),
  );
}

function menuActionPayload() {
  const field = document.querySelector('#menu-action-fields [data-action-field]');
  if (!field || field.value.trim() === '') return {};
  return field.dataset.actionField === 'id'
    ? { id: Number(field.value) }
    : { [field.dataset.actionField]: field.value.trim() };
}

function resetMenuOptionForm() {
  const form = document.querySelector('#menu-option-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.order.value = 1;
  form.elements.description.value = '';
  form.elements.section.value = '';
  form.elements.enabled.checked = true;
  document.querySelector('#menu-option-form-title').textContent = 'Agregar opción';
  renderMenuActionFields();
}

function openMenuOption(option = null) {
  const form = document.querySelector('#menu-option-form');
  resetMenuOptionForm();
  if (option) {
    for (const field of [
      'id',
      'menuId',
      'label',
      'order',
      'actionType',
      'description',
      'section',
    ]) {
      form.elements[field].value = option[field];
    }
    form.elements.aliases.value = option.aliases.join('\n');
    form.elements.enabled.checked = option.enabled;
    document.querySelector('#menu-option-form-title').textContent = 'Editar opción';
    renderMenuActionFields(option.actionPayload);
  }
  showPanel(form, { focus: true });
}

async function loadMenus() {
  if (!state.selectedBotId) return;
  const menusTarget = document.querySelector('#menus-list');
  setLoading(menusTarget, 'Cargando menús…');
  const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/interactions`);
  state.menus = result.persistent.menus;
  state.menuOptions = result.persistent.options;
  state.tools = result.tools;
  state.behavior = result.dynamic;
  fillAssistantBehavior(result.dynamic);
  renderAssistantTools(result.tools);
  replaceOptions(
    document.querySelector('#menu-form').elements.parentMenuId,
    state.menus,
    'id',
    'title',
    'Ninguno',
  );
  replaceOptions(
    document.querySelector('#menu-option-form').elements.menuId,
    state.menus,
    'id',
    'title',
  );
  renderMenuActionFields();

  if (state.menus.length === 0) {
    renderEmpty(
      menusTarget,
      'Todavía no hay menús',
      'Crea un menú inicial para guiar a tus clientes.',
      actionButton('Crear menú', '', () => openMenu()),
    );
  } else {
    menusTarget.replaceChildren();
    for (const menu of state.menus) {
      const row = listRow(
        menu.title,
        `${menu.isInitial ? 'Menú inicial · ' : ''}${menu.enabled ? 'Activo' : 'Inactivo'} · ${menuPresentationLabel(menu.presentation)} · ${menu.expirationMinutes} min`,
      );
      const options = [
        { label: 'Editar', action: () => openMenu(menu) },
        ...(!menu.isInitial
          ? [
              {
                label: 'Eliminar',
                danger: true,
                action: async () => {
                  const confirmation = await confirmAction({
                    title: 'Eliminar menú',
                    description: `También se eliminarán las opciones de “${menu.title}”.`,
                    confirmLabel: 'Eliminar',
                    danger: true,
                  });
                  if (!confirmation) return;
                  await api(
                    `/api/bots/${encodeURIComponent(state.selectedBotId)}/menus/${menu.id}`,
                    { method: 'DELETE' },
                  );
                  await loadMenus();
                  notify('Menú eliminado.');
                },
              },
            ]
          : []),
      ];
      row.append(createMoreMenu(options));
      menusTarget.append(row);
    }
  }

  const optionsTarget = document.querySelector('#menu-options-list');
  if (state.menuOptions.length === 0) {
    renderEmpty(
      optionsTarget,
      'Todavía no hay opciones',
      state.menus.length ? 'Agrega una opción a uno de tus menús.' : 'Crea primero un menú.',
      state.menus.length ? actionButton('Agregar opción', '', () => openMenuOption()) : undefined,
    );
    return;
  }
  optionsTarget.replaceChildren();
  for (const option of state.menuOptions) {
    const menu = state.menus.find((candidate) => candidate.id === option.menuId);
    const row = listRow(
      `${option.order}. ${option.label}`,
      `${menu?.title || 'Menú no disponible'} · ${actionLabels[option.actionType] || option.actionType} · ${option.enabled ? 'Activa' : 'Inactiva'}`,
    );
    row.append(
      createMoreMenu([
        { label: 'Editar', action: () => openMenuOption(option) },
        {
          label: 'Eliminar',
          danger: true,
          action: async () => {
            const confirmation = await confirmAction({
              title: 'Eliminar opción',
              description: `“${option.label}” dejará de aparecer en el menú.`,
              confirmLabel: 'Eliminar',
              danger: true,
            });
            if (!confirmation) return;
            await api(
              `/api/bots/${encodeURIComponent(state.selectedBotId)}/menu-options/${option.id}`,
              { method: 'DELETE' },
            );
            await loadMenus();
            notify('Opción eliminada.');
          },
        },
      ]),
    );
    optionsTarget.append(row);
  }
}

function menuPresentationLabel(value) {
  if (value === 'BUTTONS') return 'Botones';
  if (value === 'LIST') return 'Lista';
  return 'Presentación automática';
}

function toolStateLabel(tool) {
  if (tool.state === 'FUTURE') return 'Próximamente · requiere fuente real';
  if (tool.state === 'ENABLED') return 'Disponible';
  return 'Desactivada';
}

function renderAssistantTools(tools) {
  const target = document.querySelector('#assistant-tools-list');
  state.tools = tools;
  if (tools.length === 0) {
    renderEmpty(target, 'Sin herramientas', 'No hay herramientas registradas para este asistente.');
    return;
  }
  target.replaceChildren();
  for (const tool of tools) {
    const row = listRow(
      tool.name,
      `${tool.description} · Permisos: ${tool.permissions.join(', ')} · ${toolStateLabel(tool)}`,
    );
    const toggle = actionButton(
      tool.state === 'ENABLED' ? 'Desactivar' : 'Activar',
      'secondary',
      async () => {
        const result = await api(
          `/api/bots/${encodeURIComponent(state.selectedBotId)}/tools/${encodeURIComponent(tool.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              enabled: tool.state !== 'ENABLED',
              permissions: tool.permissions,
            }),
          },
        );
        renderAssistantTools(result.tools);
        notify(tool.state === 'ENABLED' ? 'Herramienta desactivada.' : 'Herramienta activada.');
      },
    );
    if (tool.state === 'FUTURE') {
      toggle.disabled = true;
      toggle.textContent = 'Requiere fuente real';
    }
    row.append(toggle);
    target.append(row);
  }
}

function formatMoney(amount, currency = 'CLP') {
  if (amount === null || amount === undefined) return 'Precio no informado';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(amount / 100);
}

function resetCatalogItemForm() {
  const form = document.querySelector('#catalog-item-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.currency.value = 'CLP';
  form.elements.enabled.checked = true;
  document.querySelector('#catalog-item-title').textContent = 'Agregar producto o servicio';
}

function openCatalogItem(item = null) {
  const form = document.querySelector('#catalog-item-form');
  resetCatalogItemForm();
  if (item) {
    for (const field of [
      'id',
      'name',
      'code',
      'description',
      'currency',
      'presentation',
      'size',
      'availability',
    ]) {
      form.elements[field].value = item[field] ?? '';
    }
    form.elements.price.value = item.priceAmount === null ? '' : item.priceAmount / 100;
    form.elements.offerPrice.value =
      item.offerPriceAmount === null ? '' : item.offerPriceAmount / 100;
    form.elements.informedStock.value = item.informedStock ?? '';
    form.elements.categoryId.value = item.categoryId || '';
    form.elements.primaryMediaId.value = item.primaryMediaId || '';
    form.elements.variants.value = item.variants.join('\n');
    form.elements.authorizedLink.value = item.authorizedLink || '';
    form.elements.enabled.checked = item.enabled;
    document.querySelector('#catalog-item-title').textContent = 'Editar producto o servicio';
  }
  showPanel(form, { focus: true });
}

function fillCatalogCategory(category) {
  const form = document.querySelector('#catalog-category-form');
  form.elements.id.value = category.id;
  form.elements.name.value = category.name;
  form.elements.description.value = category.description;
  form.elements.enabled.checked = category.enabled;
  form.elements.name.focus();
}

async function loadCatalog() {
  if (!state.selectedBotId) return;
  const target = document.querySelector('#catalog-items');
  setLoading(target, 'Cargando catálogo…');
  const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/catalog`);
  state.catalogCategories = result.categories;
  state.catalogItems = result.items;
  replaceOptions(
    document.querySelector('#catalog-item-form').elements.categoryId,
    result.categories,
    'id',
    'name',
    'Sin categoría',
  );

  const categoriesTarget = document.querySelector('#catalog-categories');
  categoriesTarget.replaceChildren();
  if (result.categories.length === 0) {
    renderEmpty(
      categoriesTarget,
      'Todavía no hay categorías',
      'Puedes crear productos sin categoría o agregar una aquí.',
    );
  } else {
    for (const category of result.categories) {
      const count = result.items.filter((item) => item.categoryId === category.id).length;
      const row = listRow(
        category.name,
        `${count} producto${count === 1 ? '' : 's'} · ${category.enabled ? 'Activa' : 'Inactiva'}`,
      );
      row.append(actionButton('Editar', 'secondary', () => fillCatalogCategory(category)));
      categoriesTarget.append(row);
    }
  }

  if (result.items.length === 0) {
    renderEmpty(
      target,
      'Todavía no hay productos ni servicios',
      'Agrega el primer elemento del catálogo.',
      actionButton('Agregar producto o servicio', '', () => openCatalogItem()),
    );
    return;
  }

  target.replaceChildren();
  for (const item of result.items) {
    const card = element('article', { className: 'catalog-card' });
    if (item.primaryMediaId) {
      const image = document.createElement('img');
      image.className = 'catalog-card__image';
      image.src = `/api/bots/${encodeURIComponent(state.selectedBotId)}/media/${item.primaryMediaId}/file`;
      image.alt = item.name;
      image.loading = 'lazy';
      card.append(image);
    }
    card.append(
      statusBadge(item.enabled ? 'Disponible' : 'Inactivo', item.enabled ? 'success' : 'neutral'),
      element('h3', { text: item.name }),
      element('p', { className: 'muted', text: item.description || 'Sin descripción.' }),
      element('p', {
        className: 'catalog-card__price',
        text: formatMoney(item.offerPriceAmount ?? item.priceAmount, item.currency),
      }),
    );
    const actions = element('div', { className: 'button-row' });
    actions.append(
      actionButton('Editar', 'secondary', () => openCatalogItem(item)),
      actionButton('Eliminar', 'danger', async () => {
        const confirmation = await confirmAction({
          title: 'Eliminar del catálogo',
          description: `“${item.name}” dejará de estar disponible.`,
          confirmLabel: 'Eliminar',
          danger: true,
        });
        if (!confirmation) return;
        await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/catalog/items/${item.id}`, {
          method: 'DELETE',
        });
        await loadCatalog();
        notify('Elemento eliminado del catálogo.');
      }),
    );
    card.append(actions);
    target.append(card);
  }
}

async function loadMedia() {
  if (!state.selectedBotId) return;
  const target = document.querySelector('#media-list');
  setLoading(target, 'Cargando imágenes…');
  const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/media`);
  state.mediaAssets = result.assets;
  replaceOptions(
    document.querySelector('#catalog-item-form').elements.primaryMediaId,
    result.assets,
    'id',
    'caption',
    'Sin imagen',
    (asset) => asset.caption || `Imagen ${asset.id}`,
  );
  if (result.assets.length === 0) {
    renderEmpty(
      target,
      'Todavía no hay imágenes',
      'Sube una imagen oficial para utilizarla en el catálogo o los menús.',
    );
    return;
  }
  target.replaceChildren();
  for (const asset of result.assets) {
    const card = element('article', { className: 'media-card' });
    const image = document.createElement('img');
    image.src = `/api/bots/${encodeURIComponent(state.selectedBotId)}/media/${asset.id}/file`;
    image.alt = asset.caption || 'Imagen oficial';
    image.loading = 'lazy';
    card.append(
      image,
      element('h3', { text: asset.caption || 'Imagen sin descripción' }),
      element('p', { className: 'muted', text: `${Math.round(asset.byteSize / 1024)} KB` }),
      actionButton('Eliminar', 'danger', async () => {
        const confirmation = await confirmAction({
          title: 'Eliminar imagen',
          description: 'La imagen dejará de estar disponible para productos, menús y respuestas.',
          confirmLabel: 'Eliminar',
          danger: true,
        });
        if (!confirmation) return;
        await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/media/${asset.id}`, {
          method: 'DELETE',
        });
        await Promise.all([loadMedia(), loadCatalog()]);
        notify('Imagen eliminada.');
      }),
    );
    target.append(card);
  }
}

function addHourRow(
  hour = {
    weekday: 1,
    localDate: null,
    openingTime: '09:00',
    closingTime: '18:00',
    closed: false,
    label: '',
  },
) {
  const row = element('article', { className: 'hour-row' });
  const fields = element('div', { className: 'hour-fields' });
  const values = [
    ['Día', 'select', 'weekday'],
    ['Fecha especial', 'date', 'localDate'],
    ['Apertura', 'time', 'openingTime'],
    ['Cierre', 'time', 'closingTime'],
    ['Etiqueta', 'text', 'label'],
  ];
  for (const [labelText, type, field] of values) {
    const label = element('label', { text: labelText });
    let control;
    if (type === 'select') {
      control = document.createElement('select');
      dayLabels.forEach((day, index) => control.add(new window.Option(day, String(index))));
      control.value = hour.weekday === null ? '1' : String(hour.weekday);
    } else {
      control = document.createElement('input');
      control.type = type;
      control.value = hour[field] || '';
      if (field === 'label') control.placeholder = 'Ejemplo: Feriado';
    }
    control.dataset.field = field;
    label.append(control);
    fields.append(label);
  }
  const closedLabel = element('label', { className: 'check-row' });
  const closed = document.createElement('input');
  closed.type = 'checkbox';
  closed.dataset.field = 'closed';
  closed.checked = hour.closed;
  closedLabel.append(closed, element('span', { text: 'Cerrado' }));
  fields.append(closedLabel);
  row.append(
    fields,
    actionButton('Quitar', 'danger', () => row.remove()),
  );
  document.querySelector('#hours-editor').append(row);
}

async function loadHours() {
  if (!state.selectedBotId) return;
  const target = document.querySelector('#hours-editor');
  setLoading(target, 'Cargando horarios…');
  const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/hours`);
  target.replaceChildren();
  if (result.hours.length === 0) {
    for (let weekday = 1; weekday <= 5; weekday += 1)
      addHourRow({
        weekday,
        localDate: null,
        openingTime: '09:00',
        closingTime: '18:00',
        closed: false,
        label: '',
      });
    return;
  }
  result.hours.forEach((hour) => addHourRow(hour));
}

function renderRequests() {
  const target = document.querySelector('#requests-list');
  const pending = state.requests.filter((request) => request.status === 'pending').length;
  const attended = state.requests.filter((request) => request.status === 'attended').length;
  document.querySelector('#requests-pending-count').textContent = String(pending);
  document.querySelector('#requests-attended-count').textContent = String(attended);
  const filtered = state.requests.filter((request) => {
    if (state.requestFilter === 'all') return true;
    return request.status === state.requestFilter;
  });
  if (filtered.length === 0) {
    renderEmpty(
      target,
      state.requestFilter === 'pending'
        ? 'No hay solicitudes pendientes'
        : 'No hay solicitudes en esta vista',
      state.requestFilter === 'pending' ? 'La bandeja está al día.' : 'Prueba con otro filtro.',
    );
    return;
  }
  target.replaceChildren();
  for (const request of filtered) {
    const card = element('article', { className: 'request-card' });
    const content = element('div');
    content.append(
      element('h3', { text: safeHash(request.userHash) }),
      element('p', {
        text: `${formatDate(request.createdAt)} · ${request.requestedInterval || 'Horario no indicado'}`,
      }),
    );
    const controls = element('div', { className: 'request-card__controls' });
    const statusLabel = element('label', { text: 'Estado' });
    const status = document.createElement('select');
    [
      ['pending', 'Pendiente'],
      ['confirmed', 'Confirmada'],
      ['rejected', 'Rechazada'],
      ['attended', 'Atendida'],
      ['cancelled', 'Cancelada'],
    ].forEach(([value, label]) => status.add(new window.Option(label, value)));
    status.value = request.status;
    statusLabel.append(status);
    const noteLabel = element('label', { text: 'Nota' });
    const note = document.createElement('input');
    note.maxLength = 300;
    note.placeholder = 'Nota breve opcional';
    note.value = request.note;
    noteLabel.append(note);
    controls.append(
      statusLabel,
      noteLabel,
      actionButton('Guardar', '', async () => {
        await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/requests/${request.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: status.value, note: note.value.trim() }),
        });
        await loadRequests();
        notify('Solicitud actualizada.');
      }),
    );
    card.append(content, controls);
    target.append(card);
  }
}

async function loadRequests() {
  if (!state.selectedBotId) return;
  const target = document.querySelector('#requests-list');
  setLoading(target, 'Cargando solicitudes…');
  const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/requests`);
  state.requests = result.requests;
  renderRequests();
}

async function loadAI({ renderStatistics = false } = {}) {
  if (!state.selectedBotId) return;
  const target = document.querySelector('#ai-status-cards');
  setLoading(target, 'Cargando inteligencia artificial…');
  const [result, global] = await Promise.all([
    api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/ai`),
    state.role === 'global_admin' ? api('/api/ai/global-limits') : Promise.resolve(null),
  ]);
  state.ai = result;

  const form = document.querySelector('#ai-settings-form');
  populateAIModelSelects(result.settings.model);
  for (const [field, value] of Object.entries(result.settings)) {
    const input = form.elements[field];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (field === 'provider' && value === 'disabled') input.value = 'groq';
    else input.value = value;
  }
  form.elements.confirmIncreasedLimits.checked = false;

  const queueForm = document.querySelector('#ai-queue-settings-form');
  for (const [field, value] of Object.entries(result.queue.settings)) {
    if (queueForm.elements[field]) queueForm.elements[field].value = value;
  }
  const globalForm = document.querySelector('#global-ai-limits-form');
  if (global) {
    for (const [field, value] of Object.entries(global.limits)) {
      if (globalForm.elements[field]) globalForm.elements[field].value = value;
    }
  }

  renderHealthGrid(target, [
    {
      label: 'IA',
      value: result.settings.enabled ? 'Activa' : 'Inactiva',
      tone: result.settings.enabled ? 'success' : 'warning',
    },
    { label: 'Proveedor', value: providerLabel(result.status.provider), tone: 'neutral' },
    { label: 'Modelo', value: result.status.model || 'Sin modelo', tone: 'neutral' },
    {
      label: 'Estado',
      value: result.credential.configured ? 'Configurada' : 'Requiere configuración',
      tone: result.credential.configured ? 'success' : 'warning',
    },
  ]);

  renderMetricGrid('#ai-queue-cards', [
    { label: 'Procesándose', value: result.queue.processing },
    { label: 'Esperando', value: result.queue.waiting },
    { label: 'Exitosas', value: result.queue.metrics.completedCount },
    { label: 'Fallidas', value: result.queue.metrics.failedCount },
  ]);
  document.querySelector('#ai-queue-simulator').classList.toggle('hidden', !result.developmentMode);
  document
    .querySelector('#ai-development-actions')
    .classList.toggle('hidden', !result.developmentMode);

  if (renderStatistics) renderStatisticsCards(result);
}

function renderStatisticsCards(ai = state.ai) {
  if (!state.bot || !ai) return;
  const pending = state.requests.filter((request) => request.status === 'pending').length;
  renderMetricGrid('#statistics-cards', [
    { label: 'Preguntas hoy', value: ai.usage.requests },
    { label: 'Respuestas locales', value: ai.operationalMetrics.localResponses },
    { label: 'Respuestas con IA', value: ai.operationalMetrics.aiSuccesses },
    { label: 'Respuestas guardadas', value: ai.operationalMetrics.cacheHits },
    { label: 'Solicitudes humanas', value: pending },
    { label: 'Actividad registrada', value: state.activityHistory.length },
  ]);
}

async function loadStatistics() {
  if (!state.selectedBotId) return;
  const loaders = [loadActivityHistory({ background: true })];
  if (state.visibleModules.includes('requests')) loaders.push(loadRequests());
  else state.requests = [];
  await Promise.all(loaders);
  await loadAI({ renderStatistics: true });
}

function historyTone(item) {
  const text = `${item.result || ''} ${item.errorCode || ''} ${item.eventType || ''}`.toLowerCase();
  if (/fail|error|reject|invalid|blocked|timeout/u.test(text)) return 'error';
  if (/limit|missing|not_found|warning|out_of_scope|duplicate/u.test(text)) return 'warning';
  return 'success';
}

function historyLabel(item) {
  return eventLabels[item.eventType] || 'Actividad del asistente';
}

function historySource(item) {
  if (item.source === 'manual-test') return 'Prueba manual';
  if (item.source) return 'Automatización';
  if (item.eventType?.includes('AI_')) return 'Inteligencia artificial';
  if (item.eventType?.includes('CACHE') || item.eventType?.includes('FAQ')) return 'Respuestas';
  if (item.eventType?.includes('KNOWLEDGE')) return 'Conocimiento';
  if (item.eventType?.includes('MENU') || item.eventType?.includes('CATALOG')) return 'Menú';
  return 'Asistente';
}

function renderOverviewActivity() {
  const target = document.querySelector('#overview-activity');
  const items = state.activityHistory.slice(0, 5);
  if (items.length === 0) {
    renderEmpty(
      target,
      'Todavía no hay actividad',
      'Los eventos seguros aparecerán aquí cuando el asistente comience a trabajar.',
    );
    return;
  }
  target.replaceChildren();
  for (const item of items) {
    const row = element('article', { className: 'activity-row' });
    const content = element('div', { className: 'activity-row__content' });
    content.append(
      element('strong', { text: historyLabel(item) }),
      element('p', { text: `${formatDate(item.occurredAt)} · ${historySource(item)}` }),
    );
    row.append(
      content,
      statusBadge(
        historyTone(item) === 'success'
          ? 'Correcto'
          : historyTone(item) === 'warning'
            ? 'Advertencia'
            : 'Error',
        historyTone(item),
      ),
    );
    target.append(row);
  }
}

async function loadActivityHistory({ background = false } = {}) {
  if (!state.selectedBotId) return;
  const result = await api(
    `/api/bots/${encodeURIComponent(state.selectedBotId)}/history?limit=200`,
  );
  state.activityHistory = result.items;
  renderOverviewActivity();
  if (!background) renderStatisticsCards();
}

function populateHistoryAssistantFilter() {
  const filter = document.querySelector('#history-assistant-filter');
  const previous = filter.dataset.initialized === 'true' ? filter.value : state.selectedBotId || '';
  filter.replaceChildren(
    element('option', { text: 'Todos los asistentes', attributes: { value: '' } }),
  );
  for (const bot of state.bots) {
    filter.append(
      element('option', {
        text: bot.organizationName || bot.botName,
        attributes: { value: bot.id },
      }),
    );
  }
  filter.value = state.bots.some((bot) => bot.id === previous) ? previous : '';
  filter.dataset.initialized = 'true';
}

function conversationCustomerLabel(conversation) {
  return conversation.customerName || formatWhatsAppId(conversation.waId);
}

function formatWhatsAppId(value) {
  return value ? `+${String(value).replace(/\D/gu, '')}` : 'Número no disponible';
}

function messageTypeLabel(type) {
  return (
    {
      text: 'Texto',
      image: 'Imagen',
      video: 'Video',
      document: 'Documento',
      audio: 'Audio',
      interactive: 'Interactivo',
      button: 'Botón',
      template: 'Plantilla',
    }[type] || 'Mensaje'
  );
}

function whatsappStatusLabel(status) {
  return (
    {
      received: 'Recibido',
      accepted: 'En proceso',
      sent: 'Enviado',
      delivered: 'Entregado',
      read: 'Leído',
      failed: 'Fallido',
      deleted: 'Eliminado',
      unknown: 'Sin confirmar',
    }[status] || 'Sin confirmar'
  );
}

function conversationPreview(conversation) {
  const last = conversation.lastMessage;
  if (!last) return 'Sin mensajes';
  const text = last.text || last.caption || `[${messageTypeLabel(last.messageType)}]`;
  return ['image', 'video', 'document', 'audio'].includes(last.messageType)
    ? `${messageTypeLabel(last.messageType)} · ${text}`
    : text;
}

function renderConversationList() {
  const target = document.querySelector('#conversation-list');
  const pagination = state.conversationPagination || {
    page: state.conversationPage,
    total: 0,
    totalPages: 1,
  };
  document.querySelector('#conversation-count').textContent =
    `${pagination.total} ${pagination.total === 1 ? 'conversación' : 'conversaciones'}`;
  document.querySelector('#history-page-status').textContent =
    `Página ${pagination.page} de ${pagination.totalPages}`;
  document.querySelector('#history-previous').disabled = pagination.page <= 1;
  document.querySelector('#history-next').disabled = pagination.page >= pagination.totalPages;
  if (state.conversations.length === 0) {
    renderEmpty(
      target,
      'No hay conversaciones',
      'Las conversaciones nuevas aparecerán aquí. También puedes cambiar los filtros.',
    );
    return;
  }
  target.replaceChildren();
  for (const conversation of state.conversations) {
    const button = element('button', {
      className: 'conversation-item',
      attributes: {
        type: 'button',
        'aria-pressed': String(state.selectedConversationId === conversation.id),
        'aria-label': `Abrir conversación con ${conversationCustomerLabel(conversation)}`,
      },
    });
    const top = element('span', { className: 'conversation-item__top' });
    top.append(
      element('strong', { text: conversationCustomerLabel(conversation) }),
      element('span', {
        className: 'conversation-item__time',
        text: formatDate(conversation.lastMessageAt),
      }),
    );
    const meta = element('span', { className: 'conversation-item__meta' });
    meta.append(
      element('span', {
        className: 'conversation-item__assistant',
        text: conversation.assistantName,
      }),
      element('span', {
        className: 'conversation-item__state',
        text:
          conversation.lastMessage?.direction === 'outbound'
            ? whatsappStatusLabel(conversation.lastMessage.status)
            : 'Cliente',
      }),
    );
    button.append(
      top,
      element('span', {
        className: 'conversation-item__preview',
        text: conversationPreview(conversation),
      }),
      meta,
    );
    button.addEventListener('click', () => void selectConversation(conversation, button));
    target.append(button);
  }
}

function renderConversationMessage(message) {
  const article = element('article', {
    className: `conversation-message conversation-message--${message.direction}`,
  });
  article.append(
    element('p', {
      className: 'conversation-message__sender',
      text: message.direction === 'inbound' ? 'Cliente' : 'Asistente',
    }),
    element('p', {
      className: 'conversation-message__text',
      text: message.text || message.caption || `[${messageTypeLabel(message.messageType)}]`,
    }),
  );
  const meta = element('div', { className: 'conversation-message__meta' });
  meta.append(
    element('span', { text: messageTypeLabel(message.messageType) }),
    element('span', { text: formatDate(message.timestamp) }),
  );
  if (message.direction === 'outbound') {
    meta.append(
      element('span', {
        className: 'conversation-message__status',
        text: whatsappStatusLabel(message.status),
        attributes: { 'aria-label': `Estado: ${whatsappStatusLabel(message.status)}` },
      }),
    );
  }
  article.append(meta);
  if (message.status === 'failed') {
    article.append(
      element('p', {
        className: 'conversation-message__error',
        text: message.error?.message || message.error?.code || 'Meta informó que el envío falló.',
      }),
    );
  }
  return article;
}

function renderConversationMessages({ prepend = false } = {}) {
  const target = document.querySelector('#conversation-messages');
  const nodes = state.conversationMessages.map(renderConversationMessage);
  if (prepend) target.prepend(...nodes);
  else target.replaceChildren(...nodes);
  const pagination = state.conversationMessagePagination;
  const older = document.querySelector('#history-load-older');
  older.classList.toggle('hidden', !pagination || pagination.page >= pagination.totalPages);
}

function showConversationDetail(conversation) {
  state.selectedConversation = conversation;
  document.querySelector('#conversation-placeholder').classList.add('hidden');
  document.querySelector('#conversation-content').classList.remove('hidden');
  document.querySelector('#conversation-customer-name').textContent =
    conversationCustomerLabel(conversation);
  document.querySelector('#conversation-customer-meta').textContent =
    `${formatWhatsAppId(conversation.waId)} · ${conversation.assistantName}`;
  document.querySelector('#conversation-explorer').classList.add('is-detail-open');
}

async function selectConversation(conversation, trigger) {
  state.selectedConversationId = conversation.id;
  state.conversationMessagePage = 1;
  state.conversationMessages = [];
  showConversationDetail(conversation);
  renderConversationList();
  setLoading(document.querySelector('#conversation-messages'), 'Cargando mensajes…');
  const selectedId = conversation.id;
  try {
    const result = await api(
      `/api/conversations/${encodeURIComponent(selectedId)}/messages?page=1&pageSize=50`,
    );
    if (state.selectedConversationId !== selectedId) return;
    state.selectedConversation = result.conversation;
    state.conversationMessages = result.items;
    state.conversationMessagePagination = result.pagination;
    showConversationDetail(result.conversation);
    renderConversationMessages();
    const messages = document.querySelector('#conversation-messages');
    messages.scrollTop = messages.scrollHeight;
    if (window.matchMedia('(max-width: 820px)').matches) {
      document.querySelector('#conversation-customer-name').focus();
    }
  } catch (error) {
    if (state.selectedConversationId !== selectedId) return;
    renderEmpty(
      document.querySelector('#conversation-messages'),
      'No se pudieron cargar los mensajes',
      error instanceof Error ? error.message : 'Intenta nuevamente.',
      actionButton('Reintentar', 'secondary', () => selectConversation(conversation, trigger)),
    );
  }
}

async function loadOlderConversationMessages() {
  if (!state.selectedConversationId || !state.conversationMessagePagination) return;
  if (state.conversationMessagePage >= state.conversationMessagePagination.totalPages) return;
  const nextPage = state.conversationMessagePage + 1;
  const target = document.querySelector('#conversation-messages');
  const previousHeight = target.scrollHeight;
  const result = await api(
    `/api/conversations/${encodeURIComponent(state.selectedConversationId)}/messages?page=${nextPage}&pageSize=50`,
  );
  state.conversationMessagePage = nextPage;
  state.conversationMessagePagination = result.pagination;
  state.conversationMessages = result.items;
  renderConversationMessages({ prepend: true });
  target.scrollTop += target.scrollHeight - previousHeight;
}

function conversationQuery() {
  const form = document.querySelector('#history-filters');
  const parameters = new window.URLSearchParams({
    page: String(state.conversationPage),
    pageSize: String(form.elements.pageSize.value),
  });
  for (const name of ['search', 'assistantId', 'from', 'to']) {
    const value = form.elements[name].value.trim();
    if (value) parameters.set(name, value);
  }
  return parameters.toString();
}

function resetConversationSelection() {
  state.selectedConversationId = null;
  state.selectedConversation = null;
  state.conversationMessages = [];
  state.conversationMessagePagination = null;
  document.querySelector('#conversation-explorer').classList.remove('is-detail-open');
  document.querySelector('#conversation-content').classList.add('hidden');
  document.querySelector('#conversation-placeholder').classList.remove('hidden');
}

async function loadConversationHistory({ preserveSelection = false } = {}) {
  populateHistoryAssistantFilter();
  const target = document.querySelector('#conversation-list');
  const errorRegion = document.querySelector('#history-error');
  errorRegion.classList.add('hidden');
  if (!preserveSelection) resetConversationSelection();
  setLoading(target, 'Cargando conversaciones…');
  try {
    const result = await api(`/api/conversations?${conversationQuery()}`);
    state.conversations = result.items;
    state.conversationPagination = result.pagination;
    state.conversationPage = result.pagination.page;
    renderConversationList();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'No fue posible consultar el historial.';
    errorRegion.textContent = message;
    errorRegion.classList.remove('hidden');
    renderEmpty(
      target,
      'No se pudo cargar el historial',
      message,
      actionButton('Reintentar', 'secondary', () => loadConversationHistory()),
    );
  }
}

async function testWhatsApp() {
  const detail = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}`);
  const connection = detail.runtime?.connection?.state || detail.bot.whatsappStatus;
  const configured = detail.bot.meta?.configured === true;
  if (connection === 'connected' && configured) {
    setStatus('#test-whatsapp-status', 'Correcto', 'success');
    setTestResult(
      '#test-whatsapp-result',
      'WhatsApp Cloud API, el número y el webhook están disponibles.',
      'success',
    );
  } else if (configured) {
    setStatus('#test-whatsapp-status', 'Advertencia', 'warning');
    setTestResult(
      '#test-whatsapp-result',
      'La configuración existe, pero la conexión no está activa en este momento.',
      'warning',
    );
  } else {
    setStatus('#test-whatsapp-status', 'Error', 'error');
    setTestResult(
      '#test-whatsapp-result',
      'La integración necesita completar su configuración en el servidor.',
      'error',
    );
  }
}

async function testAI() {
  let result;
  try {
    result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/ai/test-connection`, {
      method: 'POST',
      body: '{}',
    });
  } catch {
    setStatus('#test-ai-status', 'Error', 'error');
    setTestResult(
      '#test-ai-result',
      'No fue posible completar la prueba. Revisa la configuración del proveedor.',
      'error',
    );
    return;
  }
  const successful = result.connection === 'successful';
  setStatus('#test-ai-status', successful ? 'Correcto' : 'Error', successful ? 'success' : 'error');
  setTestResult(
    '#test-ai-result',
    successful
      ? 'El proveedor respondió correctamente.'
      : 'El proveedor no pudo completar la prueba. Revisa su configuración.',
    successful ? 'success' : 'error',
  );
  await loadAI();
}

async function testMenu() {
  await loadMenus();
  const initial = state.menus.find((menu) => menu.isInitial && menu.enabled);
  const options = initial
    ? state.menuOptions.filter((option) => option.menuId === initial.id && option.enabled)
    : [];
  if (!initial) {
    setStatus('#test-menu-status', 'Advertencia', 'warning');
    setTestResult('#test-menu-result', 'No hay un menú inicial activo.', 'warning');
    return;
  }
  if (options.length === 0) {
    setStatus('#test-menu-status', 'Advertencia', 'warning');
    setTestResult(
      '#test-menu-result',
      `El menú “${initial.title}” está activo, pero no tiene opciones disponibles.`,
      'warning',
    );
    return;
  }
  setStatus('#test-menu-status', 'Correcto', 'success');
  setTestResult(
    '#test-menu-result',
    `“${initial.title}” está listo con ${options.length} opción${options.length === 1 ? '' : 'es'} activa${options.length === 1 ? '' : 's'}.`,
    'success',
  );
}

async function restartBot() {
  if (!state.selectedBotId) return;
  await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/restart`, {
    method: 'POST',
    body: '{}',
  });
  await Promise.all([
    loadWhatsApp(),
    loadBotSummary({ refreshForms: false }),
    loadBots({ background: true }),
  ]);
  notify('Configuración de WhatsApp revalidada.');
}

function resetAssistantSimulator() {
  const messages = document.querySelector('#assistant-simulator-messages');
  messages.replaceChildren();
  const empty = element('div', { className: 'simulator-empty' });
  empty.append(
    element('strong', { text: 'Inicia una conversación de prueba' }),
    element('span', { text: 'Por ejemplo: ¿Cuánto es 2 + 2? o ¿Cuál es el horario?' }),
  );
  messages.append(empty);
  const debug = document.querySelector('#assistant-simulator-debug');
  debug.classList.add('hidden');
  debug.querySelector('dl').replaceChildren();
  document.querySelector('#assistant-simulator-form').reset();
}

function appendSimulatorMessage(kind, text, interaction = null) {
  const messages = document.querySelector('#assistant-simulator-messages');
  messages.querySelector('.simulator-empty')?.remove();
  const message = element('div', {
    className: `simulator-message ${kind}`,
    attributes: { role: kind === 'assistant' ? 'status' : undefined },
  });
  message.append(
    element('span', { text: kind === 'assistant' ? 'Asistente' : 'Tú' }),
    element('p', { text }),
  );
  if (kind === 'assistant' && interaction?.options?.length) {
    const options = element('div', {
      className: `simulator-options ${interaction.presentation?.toLowerCase() || 'text'}`,
      attributes: { 'aria-label': 'Opciones simuladas' },
    });
    for (const option of interaction.options) {
      const item = element('span', { text: option.label });
      if (option.description) item.title = option.description;
      options.append(item);
    }
    message.append(options);
  }
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function renderSimulatorDebug(debugData) {
  const debug = document.querySelector('#assistant-simulator-debug');
  const list = debug.querySelector('dl');
  list.replaceChildren();
  const values = [
    ['Ruta', debugData.route],
    ['Proveedor', providerLabel(debugData.provider)],
    ['Modelo', modelLabel(debugData.model)],
    ['Conocimiento utilizado', debugData.knowledgeUsed ? 'Sí' : 'No'],
    ['Herramienta', debugData.toolCalled || 'Ninguna'],
    ['Resultados reales', String(debugData.toolResultCount ?? 0)],
    ['Presentación', debugData.presentation || 'TEXT'],
    ['Acciones', (debugData.actions || []).join(', ') || 'Ninguna'],
    ['Tiempo de respuesta', `${debugData.durationMs} ms`],
    ['Estado', debugData.status],
    ['Error', debugData.error || 'Ninguno'],
  ];
  for (const [label, value] of values) {
    list.append(element('dt', { text: label }), element('dd', { text: value }));
  }
  debug.classList.remove('hidden');
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1] || ''));
    reader.addEventListener('error', () => reject(new Error('No fue posible leer el archivo.')));
    reader.readAsDataURL(file);
  });
}

function configureForms() {
  if (configured) return;
  configured = true;
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.more-menu')) closeAllMoreMenus();
  });

  document.querySelector('#back-to-assistants').addEventListener('click', () => {
    void setGlobalContext('bots');
  });
  document.querySelector('#open-create-bot').addEventListener('click', openCreateBot);
  document.querySelector('#cancel-create-bot').addEventListener('click', closeCreateBot);
  document.querySelector('[data-cancel-create]').addEventListener('click', closeCreateBot);

  const createForm = document.querySelector('#create-bot-form');
  document.querySelector('#wizard-previous').addEventListener('click', () => {
    showWizardStep(state.wizardStep - 1);
  });
  document.querySelector('#wizard-next').addEventListener('click', () => {
    if (validateWizardStep()) showWizardStep(state.wizardStep + 1);
  });
  bindAsyncForm(createForm, async (_event, form) => {
    const payload = {
      organizationName: form.elements.organizationName.value,
      botName: form.elements.botName.value,
      description: form.elements.description.value,
      language: form.elements.language.value,
      organizationType: form.elements.organizationType.value,
      timezone: form.elements.timezone.value,
      connectorType: 'WHATSAPP_CLOUD_API',
      whatsappSetupMode: form.elements.whatsappSetupMode.value,
      provider: form.elements.provider.value,
      model: form.elements.model.value,
      behavior: {
        showInitialMenuOnGreeting: form.elements.showInitialMenuOnGreeting.checked,
        allowFreeQuestions: form.elements.allowFreeQuestions.checked,
        useAIForUnmatched: form.elements.useAIForUnmatched.checked,
        useBusinessKnowledge: form.elements.useBusinessKnowledge.checked,
        allowDynamicButtons: form.elements.allowDynamicButtons.checked,
        allowDynamicLists: form.elements.allowDynamicLists.checked,
        allowBusinessDataQueries: form.elements.allowBusinessDataQueries.checked,
        showAISuggestedActions: form.elements.showAISuggestedActions.checked,
        allowWriteTools: false,
        fallbackMessage: form.elements.fallbackMessage.value,
      },
      preset: form.elements.preset.value,
      menuType: 'automatic',
    };
    const result = await api('/api/bots', { method: 'POST', body: JSON.stringify(payload) });
    closeCreateBot();
    await loadBots();
    await selectBot(result.bot.id, 'test-center');
    notify('Borrador guardado. Pruébalo y revisa los requisitos antes de activarlo.');
  });

  bindAsyncForm('#profile-form', async (_event, form) => {
    const payload = {
      internalName: form.elements.internalName.value,
      organizationName: form.elements.organizationName.value,
      botName: form.elements.botName.value,
      description: form.elements.description.value,
      organizationType: form.elements.organizationType.value,
      industry: form.elements.industry.value,
      objective: form.elements.objective.value,
      allowedTopics: lines(form.elements.allowedTopics.value),
      excludedTopics: lines(form.elements.excludedTopics.value),
      tone: form.elements.tone.value,
      outOfScopeMessage: form.elements.outOfScopeMessage.value,
      noInformationMessage: form.elements.noInformationMessage.value,
      limitMessage: form.elements.limitMessage.value,
      aiErrorMessage: form.elements.aiErrorMessage.value,
      medicalMessage: form.elements.medicalMessage.value,
      contactInformation: form.elements.contactInformation.value,
      businessHours: form.elements.businessHours.value,
      address: form.elements.address.value.trim() || null,
      logoPath: form.elements.logoPath.value.trim() || null,
      primaryColor: form.elements.primaryColor.value,
      secondaryColor: form.elements.secondaryColor.value,
      timezone: form.elements.timezone.value,
      language: form.elements.language.value,
      applicationName: form.elements.applicationName.value,
      headerText: form.elements.headerText.value,
      footerText: form.elements.footerText.value,
      supportInformation: form.elements.supportInformation.value,
    };
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/profile`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    await Promise.all([loadBotSummary(), loadBots({ background: true })]);
    notify('Perfil guardado.');
  });

  bindAsyncForm('#assistant-behavior-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/behavior`, {
      method: 'PATCH',
      body: JSON.stringify({
        showInitialMenuOnGreeting: form.elements.showInitialMenuOnGreeting.checked,
        allowFreeQuestions: form.elements.allowFreeQuestions.checked,
        useAIForUnmatched: form.elements.useAIForUnmatched.checked,
        useBusinessKnowledge: form.elements.useBusinessKnowledge.checked,
        ...dynamicBehaviorPayload(),
        fallbackMessage: form.elements.fallbackMessage.value,
        humanHandoffReady: false,
      }),
    });
    await Promise.all([loadBotSummary(), loadBots({ background: true })]);
    notify('Comportamiento guardado.');
  });

  bindAsyncForm('#dynamic-interactions-form', async () => {
    const result = await api(
      `/api/bots/${encodeURIComponent(state.selectedBotId)}/interactions/dynamic`,
      {
        method: 'PATCH',
        body: JSON.stringify(dynamicBehaviorPayload()),
      },
    );
    fillAssistantBehavior(result.behavior);
    await Promise.all([loadBotSummary({ refreshForms: false }), loadBots({ background: true })]);
    notify('Interacciones dinámicas guardadas.');
  });

  bindAsyncForm('#whatsapp-setup-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/whatsapp/setup`, {
      method: 'PATCH',
      body: JSON.stringify({ setupMode: form.elements.setupMode.value }),
    });
    await loadWhatsApp();
    notify('Opción de conexión guardada.');
  });

  bindAsyncForm('#bot-configuration-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/configuration`, {
      method: 'PATCH',
      body: JSON.stringify({
        enabled: form.elements.enabled.checked,
        continuedConversationsEnabled: form.elements.continuedConversationsEnabled.checked,
        menuType: form.elements.menuType.value,
      }),
    });
    await Promise.all([loadBotSummary(), loadBots({ background: true })]);
    notify('Funcionamiento guardado.');
  });

  document.querySelector('#toggle-knowledge-categories').addEventListener('click', () => {
    showKnowledgeCategories(
      document.querySelector('#knowledge-category-panel').classList.contains('hidden'),
    );
  });
  document
    .querySelector('#new-knowledge-category')
    .addEventListener('click', () => editKnowledgeCategory());
  document
    .querySelector('#cancel-knowledge-category')
    .addEventListener('click', resetKnowledgeCategoryForm);
  document
    .querySelector('#new-knowledge-entry')
    .addEventListener('click', () => openKnowledgeEntry());
  document.querySelector('#cancel-knowledge-entry').addEventListener('click', () => {
    resetKnowledgeEntryForm();
    hidePanel(document.querySelector('#knowledge-entry-form'));
  });
  document
    .querySelector('#knowledge-entry-form [name="priority"]')
    .addEventListener('input', (event) => {
      updateKnowledgePriority(event.currentTarget.value);
    });
  bindAsyncForm('#knowledge-category-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/knowledge/categories`, {
      method: 'POST',
      body: JSON.stringify({
        ...(form.elements.id.value ? { id: Number(form.elements.id.value) } : {}),
        name: form.elements.name.value,
        enabled: form.elements.enabled.checked,
      }),
    });
    resetKnowledgeCategoryForm();
    await loadKnowledge();
    notify('Categoría guardada.');
  });
  bindAsyncForm('#knowledge-entry-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/knowledge/entries`, {
      method: 'POST',
      body: JSON.stringify({
        ...(form.elements.id.value ? { id: Number(form.elements.id.value) } : {}),
        categoryId: Number(form.elements.categoryId.value),
        title: form.elements.title.value,
        content: form.elements.content.value,
        keywords: lines(form.elements.keywords.value),
        synonyms: lines(form.elements.synonyms.value),
        priority: Number(form.elements.priority.value),
        internalSource: form.elements.internalSource.value.trim() || null,
        enabled: form.elements.enabled.checked,
      }),
    });
    resetKnowledgeEntryForm();
    hidePanel(form);
    await loadKnowledge();
    notify('Información guardada.');
  });

  document.querySelector('#new-cached-answer').addEventListener('click', () => openCachedAnswer());
  document.querySelector('#cancel-cached-answer').addEventListener('click', () => {
    resetCachedAnswerForm();
    hidePanel(document.querySelector('#cached-answer-form'));
  });
  bindAsyncForm('#cached-answer-search', async (_event, form) => {
    await loadCachedAnswers(form.elements.search.value);
  });
  bindAsyncForm('#cached-answer-form', async (_event, form) => {
    const id = form.elements.id.value;
    if (id) {
      await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/cached-answers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'edit',
          answer: form.elements.answer.value,
          category: form.elements.category.value,
        }),
      });
    } else {
      await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/cached-answers`, {
        method: 'POST',
        body: JSON.stringify({
          canonicalQuestion: form.elements.canonicalQuestion.value,
          answer: form.elements.answer.value,
          category: form.elements.category.value,
          sourceType: form.elements.sourceType.value,
          variants: lines(form.elements.variants.value),
        }),
      });
    }
    resetCachedAnswerForm();
    hidePanel(form);
    await loadCachedAnswers();
    notify(id ? 'Respuesta actualizada.' : 'Respuesta creada.');
  });

  document.querySelector('#new-menu').addEventListener('click', () => openMenu());
  document
    .querySelector('#cancel-menu')
    .addEventListener('click', () => hidePanel(document.querySelector('#menu-form')));
  document.querySelector('#clear-menu').addEventListener('click', clearMenuForm);
  document.querySelector('#new-menu-option').addEventListener('click', () => openMenuOption());
  document
    .querySelector('#cancel-menu-option')
    .addEventListener('click', () => hidePanel(document.querySelector('#menu-option-form')));
  document
    .querySelector('#menu-option-form [name="actionType"]')
    .addEventListener('change', () => renderMenuActionFields());
  bindAsyncForm('#menu-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/menus`, {
      method: 'POST',
      body: JSON.stringify({
        ...(form.elements.id.value ? { id: Number(form.elements.id.value) } : {}),
        parentMenuId: numberOrNull(form.elements.parentMenuId.value),
        title: form.elements.title.value,
        message: form.elements.message.value,
        helpText: form.elements.helpText.value,
        presentation: form.elements.presentation.value,
        listButtonLabel: form.elements.listButtonLabel.value,
        enabled: form.elements.enabled.checked,
        isInitial: form.elements.isInitial.checked,
        expirationMinutes: Number(form.elements.expirationMinutes.value),
      }),
    });
    clearMenuForm();
    hidePanel(form);
    await loadMenus();
    notify('Menú guardado.');
  });
  bindAsyncForm('#menu-option-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/menu-options`, {
      method: 'POST',
      body: JSON.stringify({
        ...(form.elements.id.value ? { id: Number(form.elements.id.value) } : {}),
        menuId: Number(form.elements.menuId.value),
        label: form.elements.label.value,
        description: form.elements.description.value,
        section: form.elements.section.value,
        aliases: lines(form.elements.aliases.value),
        order: Number(form.elements.order.value),
        actionType: form.elements.actionType.value,
        actionPayload: menuActionPayload(),
        enabled: form.elements.enabled.checked,
      }),
    });
    resetMenuOptionForm();
    hidePanel(form);
    await loadMenus();
    notify('Opción guardada.');
  });

  document.querySelector('#new-catalog-item').addEventListener('click', () => openCatalogItem());
  document
    .querySelector('#cancel-catalog-item')
    .addEventListener('click', () => hidePanel(document.querySelector('#catalog-item-form')));
  document.querySelector('#clear-catalog-item').addEventListener('click', resetCatalogItemForm);
  bindAsyncForm('#catalog-category-form', async (_event, form) => {
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/catalog/categories`, {
      method: 'POST',
      body: JSON.stringify({
        ...(form.elements.id.value ? { id: Number(form.elements.id.value) } : {}),
        name: form.elements.name.value,
        description: form.elements.description.value,
        enabled: form.elements.enabled.checked,
      }),
    });
    form.reset();
    form.elements.id.value = '';
    form.elements.enabled.checked = true;
    await loadCatalog();
    notify('Categoría guardada.');
  });
  bindAsyncForm('#catalog-item-form', async (_event, form) => {
    const price = numberOrNull(form.elements.price.value);
    const offerPrice = numberOrNull(form.elements.offerPrice.value);
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/catalog/items`, {
      method: 'POST',
      body: JSON.stringify({
        id: Number(form.elements.id.value || 0),
        categoryId: numberOrNull(form.elements.categoryId.value),
        name: form.elements.name.value,
        code: form.elements.code.value,
        description: form.elements.description.value,
        priceAmount: price === null ? null : Math.round(price * 100),
        offerPriceAmount: offerPrice === null ? null : Math.round(offerPrice * 100),
        currency: form.elements.currency.value,
        presentation: form.elements.presentation.value,
        size: form.elements.size.value,
        variants: lines(form.elements.variants.value),
        availability: form.elements.availability.value,
        informedStock: numberOrNull(form.elements.informedStock.value),
        primaryMediaId: numberOrNull(form.elements.primaryMediaId.value),
        authorizedLink: form.elements.authorizedLink.value.trim() || null,
        enabled: form.elements.enabled.checked,
      }),
    });
    resetCatalogItemForm();
    hidePanel(form);
    await loadCatalog();
    notify('Catálogo actualizado.');
  });

  bindAsyncForm('#media-form', async (_event, form) => {
    const file = form.elements.file.files[0];
    if (!file) return;
    const data = await readFileAsBase64(file);
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/media`, {
      method: 'POST',
      body: JSON.stringify({ mimeType: file.type, data, caption: form.elements.caption.value }),
    });
    form.reset();
    await Promise.all([loadMedia(), loadCatalog()]);
    notify('Imagen guardada.');
  });

  document.querySelector('#add-hour').addEventListener('click', () => addHourRow());
  bindAsyncForm('#hours-form', async () => {
    const hours = [...document.querySelectorAll('.hour-row')].map((row) => ({
      weekday: row.querySelector('[data-field="localDate"]').value
        ? null
        : Number(row.querySelector('[data-field="weekday"]').value),
      localDate: row.querySelector('[data-field="localDate"]').value || null,
      openingTime: row.querySelector('[data-field="closed"]').checked
        ? null
        : row.querySelector('[data-field="openingTime"]').value || null,
      closingTime: row.querySelector('[data-field="closed"]').checked
        ? null
        : row.querySelector('[data-field="closingTime"]').value || null,
      closed: row.querySelector('[data-field="closed"]').checked,
      label: row.querySelector('[data-field="label"]').value.trim(),
    }));
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
    await loadHours();
    notify('Horarios guardados.');
  });

  document.querySelectorAll('[data-request-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.requestFilter = button.dataset.requestFilter;
      document.querySelectorAll('[data-request-filter]').forEach((candidate) => {
        candidate.classList.toggle('active', candidate === button);
      });
      renderRequests();
    });
  });

  bindAsyncForm('#ai-settings-form', async (_event, form) => {
    const payload = {};
    for (const input of form.elements) {
      if (!input.name) continue;
      payload[input.name] =
        input.type === 'checkbox'
          ? input.checked
          : input.type === 'number'
            ? Number(input.value)
            : input.value;
    }
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/ai/settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    await loadAI();
    notify('Configuración de IA guardada.');
  });
  bindAsyncForm('#ai-queue-settings-form', async (_event, form) => {
    const payload = Object.fromEntries(
      [...form.elements]
        .filter((input) => input.name)
        .map((input) => [input.name, Number(input.value)]),
    );
    await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/ai/queue-settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    await loadAI();
    notify('Capacidad de IA guardada.');
  });
  document.querySelector('#restore-ai-queue-recommended').addEventListener('click', () => {
    const button = document.querySelector('#restore-ai-queue-recommended');
    void withBusy(button, async () => {
      await api(
        `/api/bots/${encodeURIComponent(state.selectedBotId)}/ai/queue-settings/recommended`,
        { method: 'POST', body: '{}' },
      );
      await loadAI();
      notify('Valores recomendados restaurados.');
    });
  });
  bindAsyncForm('#ai-queue-simulator-form', async (_event, form) => {
    const result = await api(
      `/api/bots/${encodeURIComponent(state.selectedBotId)}/ai/simulate-queue`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: Number(form.elements.requests.value),
          scenario: form.elements.scenario.value,
        }),
      },
    );
    renderMetricGrid('#ai-queue-simulation-result', [
      { label: 'Procesándose', value: result.processing },
      { label: 'Esperando', value: result.waiting },
      { label: 'Rechazadas', value: result.rejected },
      { label: 'Agrupadas', value: result.coalesced },
    ]);
  });
  bindAsyncForm('#global-ai-limits-form', async (_event, form) => {
    const payload = Object.fromEntries(
      [...form.elements]
        .filter((input) => input.name)
        .map((input) => [input.name, Number(input.value)]),
    );
    await api('/api/ai/global-limits', { method: 'PATCH', body: JSON.stringify(payload) });
    await loadAI();
    notify('Presupuesto global guardado.');
  });
  document.querySelector('#reset-ai-counters').addEventListener('click', () => {
    const button = document.querySelector('#reset-ai-counters');
    void withBusy(button, async () => {
      const confirmation = await confirmAction({
        title: 'Restablecer contadores de prueba',
        description: 'No se eliminarán respuestas, conocimiento ni la configuración de WhatsApp.',
        expectedConfirmation: 'RESTABLECER CONTADORES',
        requirePassword: true,
        confirmLabel: 'Restablecer',
        danger: true,
      });
      if (!confirmation) return;
      await api(
        `/api/bots/${encodeURIComponent(state.selectedBotId)}/ai/reset-development-counters`,
        {
          method: 'POST',
          body: JSON.stringify({
            password: confirmation.password,
            confirmation: confirmation.confirmation,
          }),
        },
      );
      await loadAI();
      notify('Contadores de prueba restablecidos.');
    });
  });

  document.querySelector('#bot-restart').addEventListener('click', () => {
    void withBusy(document.querySelector('#bot-restart'), restartBot);
  });
  document.querySelector('#test-whatsapp').addEventListener('click', () => {
    void withBusy(document.querySelector('#test-whatsapp'), testWhatsApp);
  });
  document.querySelector('#test-ai-connection').addEventListener('click', () => {
    void withBusy(document.querySelector('#test-ai-connection'), testAI);
  });
  document.querySelector('#test-menu').addEventListener('click', () => {
    void withBusy(document.querySelector('#test-menu'), testMenu);
  });
  bindAsyncForm('#assistant-simulator-form', async (_event, form) => {
    const message = form.elements.message.value.trim();
    if (!message) return;
    appendSimulatorMessage('user', message);
    const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/simulator`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    appendSimulatorMessage('assistant', result.response, result);
    renderSimulatorDebug(result.debug);
    form.reset();
    form.elements.message.focus();
  });

  const historyFilters = document.querySelector('#history-filters');
  historyFilters.addEventListener('submit', (event) => {
    event.preventDefault();
    state.conversationPage = 1;
    const submitter = event.submitter || historyFilters.querySelector('button[type="submit"]');
    void withBusy(submitter, () => loadConversationHistory());
  });
  historyFilters.addEventListener('change', () => {
    state.conversationPage = 1;
    void loadConversationHistory();
  });
  document.querySelector('#history-previous').addEventListener('click', () => {
    state.conversationPage = Math.max(1, state.conversationPage - 1);
    void withBusy(document.querySelector('#history-previous'), () =>
      loadConversationHistory(),
    ).finally(() => renderConversationList());
  });
  document.querySelector('#history-next').addEventListener('click', () => {
    state.conversationPage += 1;
    void withBusy(document.querySelector('#history-next'), () => loadConversationHistory()).finally(
      () => renderConversationList(),
    );
  });
  document.querySelector('#history-clear-filters').addEventListener('click', () => {
    historyFilters.reset();
    populateHistoryAssistantFilter();
    document.querySelector('#history-assistant-filter').value = state.selectedBotId || '';
    state.conversationPage = 1;
    void withBusy(document.querySelector('#history-clear-filters'), () =>
      loadConversationHistory(),
    );
  });
  document.querySelector('#history-back').addEventListener('click', () => {
    document.querySelector('#conversation-explorer').classList.remove('is-detail-open');
    document.querySelector('.conversation-item[aria-pressed="true"]')?.focus();
  });
  document.querySelector('#history-load-older').addEventListener('click', () => {
    void withBusy(document.querySelector('#history-load-older'), loadOlderConversationMessages);
  });
  document.querySelector('#refresh-history').addEventListener('click', () => {
    void withBusy(document.querySelector('#refresh-history'), () => loadConversationHistory());
  });
}

async function enterGlobal(section) {
  if (state.selectedBotId) {
    state.selectedBotId = null;
    state.bot = null;
    state.profile = null;
    navigation.setContext('global');
  }
  window.history.replaceState(null, '', section === 'bots' ? '#assistants' : `#${section}`);
  if (section === 'bots') await loadBots();
  if (section === 'trash') await loadTrash();
}

async function enterSection(section, options = {}) {
  if (!state.selectedBotId) return;
  if (options.history !== false) {
    window.history.replaceState(
      null,
      '',
      `#assistants/${encodeURIComponent(state.selectedBotId)}/${section}`,
    );
  }
  const loaders = {
    status: async () => {
      await Promise.all([
        loadBotSummary({ refreshForms: false }),
        loadActivityHistory({ background: true }),
      ]);
    },
    whatsapp: loadWhatsApp,
    profile: async () => loadBotSummary(),
    knowledge: loadKnowledge,
    'cached-answers': () => loadCachedAnswers(),
    menus: async () => {
      await Promise.all([loadCatalog(), loadMedia()]);
      await loadMenus();
    },
    catalog: async () => {
      await Promise.all([loadCatalog(), loadMedia()]);
    },
    media: loadMedia,
    hours: loadHours,
    requests: loadRequests,
    ai: () => loadAI(),
    'test-center': async () => {
      setStatus('#test-whatsapp-status', 'Sin probar', 'neutral');
      setStatus('#test-ai-status', 'Sin probar', 'neutral');
      setStatus('#test-menu-status', 'Sin probar', 'neutral');
    },
    history: () => loadConversationHistory(),
    statistics: loadStatistics,
  };
  const loader = loaders[section];
  if (loader) await loader();
}

function startRefresh() {
  if (state.refreshTimer !== null) return;
  state.refreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    void loadBots({ background: true }).catch(() => {});
    if (state.selectedBotId) void loadBotSummary({ refreshForms: false }).catch(() => {});
  }, 15_000);
}

function reset() {
  state.selectedBotId = null;
  state.bot = null;
  state.profile = null;
  state.bots = [];
  state.visibleModules = [];
  state.activityHistory = [];
  state.conversations = [];
  state.conversationPagination = null;
  state.selectedConversationId = null;
  state.selectedConversation = null;
  state.conversationMessages = [];
  state.conversationMessagePagination = null;
  initializationPromise = null;
  if (state.refreshTimer !== null) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

async function initialize({ force = false } = {}) {
  if (force) initializationPromise = null;
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    configureForms();
    applyRoleVisibility();
    await loadAIProviders();
    await loadBots();
    const route = window.location.hash.replace(/^#/u, '').split('/').filter(Boolean);
    if (
      route[0] === 'assistants' &&
      route.length >= 2 &&
      state.bots.some((bot) => bot.id === route[1])
    ) {
      await selectBot(route[1], route[2] || 'status');
    } else {
      const section =
        ['trash', 'administrators'].includes(route[0]) &&
        (route[0] !== 'administrators' || state.role === 'global_admin')
          ? route[0]
          : 'bots';
      navigation.setContext('global');
      await navigation.navigate(section, { focus: false });
    }
    startRefresh();
  })().finally(() => {
    initializationPromise = null;
  });
  return initializationPromise;
}

function applyRoleVisibility() {
  const isGlobal = state.role === 'global_admin';
  document.querySelector('#open-create-bot')?.classList.toggle('hidden', !isGlobal);
  document
    .querySelector('.nav-item[data-section="administrators"]')
    ?.classList.toggle('hidden', !isGlobal);
  document
    .querySelector('#global-ai-limits-form')
    ?.closest('details')
    ?.classList.toggle('hidden', !isGlobal);
  if (!isGlobal) closeCreateBot();
}

function setRole(role) {
  state.role = role === 'business_admin' ? 'business_admin' : 'global_admin';
  if (configured) applyRoleVisibility();
}

export function createAssistantPanel(options) {
  navigation = options.navigation;
  return { initialize, reset, enterGlobal, enterSection, setRole };
}
