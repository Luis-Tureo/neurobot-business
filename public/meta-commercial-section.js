import { commercialApi, commercialState, element, notice, renderCards } from './meta-commercial-api.js';

const planLabels = { BASIC: 'Plan básico', ADVANCED: 'Comercio avanzado' };
const requestLabels = {
  NONE: 'Sin solicitud pendiente',
  QUOTE_REQUIRED: 'Cotización pendiente',
  ACTIVE: 'Plan contratado y activo',
};
const useCaseLabels = {
  DELIVERY: 'Reparto y entregas',
  APPOINTMENTS: 'Agenda de horas',
  GENERAL: 'Otro proceso comercial',
};

export function installCommercialSection() {
  if (document.querySelector('#section-commercial')) return;
  const statusSection = document.querySelector('#section-status');
  if (!statusSection?.parentElement) return;
  const section = element('section', 'panel-section bot-only hidden');
  section.id = 'section-commercial';
  section.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Servicio contratado</p>
        <h2>Plan y plantillas comerciales</h2>
        <p class="muted">Consulta el plan actual, solicita una cotización y revisa las plantillas sugeridas para el negocio.</p>
      </div>
    </div>
    <div id="commercial-plan-cards" class="status-grid"></div>
    <article class="card">
      <div id="commercial-plan-message"></div>
      <form id="commercial-plan-request-form" class="stack hidden">
        <label>
          Tipo de automatización
          <select name="useCase">
            <option value="DELIVERY">Reparto y entregas</option>
            <option value="APPOINTMENTS">Agenda de horas</option>
            <option value="GENERAL">Otro proceso comercial</option>
          </select>
        </label>
        <div class="actions"><button type="submit" class="primary">Solicitar cotización</button></div>
      </form>
      <div id="commercial-request-actions" class="actions"></div>
    </article>
    <article class="card">
      <p class="eyebrow">Mensajes reutilizables</p>
      <h3>Plantillas sugeridas</h3>
      <p class="muted">Neurobot genera estos borradores según el negocio. Meta debe aprobarlos antes de utilizarlos fuera de la ventana de 24 horas.</p>
      <div id="commercial-template-list" class="commercial-template-grid"></div>
    </article>
    <article class="card">
      <p class="eyebrow">Control de facturación</p>
      <h3>Uso mensual registrado</h3>
      <p class="muted">El panel muestra actividad para revisión. El cliente no puede configurar topes ni alterar las condiciones comerciales.</p>
      <div id="commercial-usage-cards" class="status-grid"></div>
    </article>
  `;
  statusSection.parentElement.append(section);
  section.querySelector('#commercial-plan-request-form').addEventListener('submit', requestQuote);
}

export function installCommercialNavigation() {
  if (document.querySelector('[data-section="commercial"]')) return;
  const button = element('button', 'bot-only hidden');
  button.type = 'button';
  button.dataset.section = 'commercial';
  button.dataset.friendlySearch = 'plan plantillas comercio avanzado cotización entregas agenda';
  button.innerHTML = `
    <span class="friendly-nav-icon" aria-hidden="true">◇</span>
    <span class="friendly-nav-copy"><strong>Plan y plantillas</strong><small>Plan básico o comercio avanzado</small></span>
  `;
  button.addEventListener('click', () => showCommercialSection(button));
  const managementBody = document.querySelector(
    'details[data-friendly-nav-group="management"] .friendly-nav-group-body',
  );
  const fallback = document.querySelector('.sidebar-more') || document.querySelector('.tabs');
  (managementBody || fallback)?.append(button);

  const select = document.querySelector('#section-select');
  if (select && !select.querySelector('option[value="commercial"]')) {
    const option = new window.Option('Plan y plantillas', 'commercial');
    option.dataset.botOnly = '';
    const groups = [...select.querySelectorAll('optgroup[data-bot-only]')];
    (groups.at(-1) || select).append(option);
  }
}

export async function loadCommercialPlan(botId) {
  const state = commercialState();
  state.selectedBotId = botId;
  const result = await commercialApi(`/api/bots/${encodeURIComponent(botId)}/commercial-plan`);
  const configuration = result.configuration;
  const monthlyPrice = result.pricing.advancedMonthlyPriceUsd;

  renderCards('#commercial-plan-cards', [
    ['Plan actual', planLabels[configuration.plan] || configuration.plan],
    ['Estado', requestLabels[configuration.requestStatus] || configuration.requestStatus],
    [
      'Precio Neurobot',
      configuration.plan === 'ADVANCED' ? `US$${monthlyPrice} / mes` : 'Plan básico',
    ],
    ['Cobros de Meta', result.pricing.metaChargesIncluded ? 'Incluidos' : 'Separados'],
  ]);
  renderCards('#commercial-usage-cards', [
    ['Mes', result.usage.month],
    ['Plantillas enviadas', result.usage.submitted],
    ['Entregadas o leídas', result.usage.deliveredOrRead],
    ['Fallidas', result.usage.failed],
  ]);

  renderPlanMessage(botId, configuration, monthlyPrice);
  renderTemplates(result.templates);
  hideLegacyQrInterface();
}

function renderPlanMessage(botId, configuration, monthlyPrice) {
  const message = document.querySelector('#commercial-plan-message');
  const requestForm = document.querySelector('#commercial-plan-request-form');
  const actions = document.querySelector('#commercial-request-actions');
  if (!message || !requestForm || !actions) return;
  actions.replaceChildren();
  requestForm.classList.add('hidden');
  message.className = '';

  if (configuration.plan === 'ADVANCED') {
    message.className = 'commercial-success';
    message.textContent =
      `El plan avanzado está activo por US$${monthlyPrice} mensuales. Los cargos variables de WhatsApp se pagan directamente a Meta y no están incluidos.`;
    return;
  }
  if (configuration.requestStatus === 'QUOTE_REQUIRED') {
    message.className = 'commercial-warning';
    message.textContent = `Cotización solicitada para: ${useCaseLabels[configuration.requestedUseCase] || 'proceso personalizado'}. El plan básico continúa activo hasta que el proveedor confirme la contratación.`;
    const cancel = element('button', 'secondary', 'Cancelar solicitud');
    cancel.type = 'button';
    cancel.addEventListener('click', () => void cancelRequest(botId));
    actions.append(cancel);
    return;
  }
  message.className = 'commercial-price-note';
  message.textContent =
    `El plan básico responde dentro de la ventana de 24 horas y bloquea envíos fuera de ella. Para entregas o agenda puedes solicitar el plan avanzado por US$${monthlyPrice} mensuales.`;
  requestForm.classList.remove('hidden');
}

function renderTemplates(templates) {
  const target = document.querySelector('#commercial-template-list');
  if (!target) return;
  target.replaceChildren();
  if (templates.length === 0) {
    target.append(element('p', 'muted', 'Selecciona un caso de uso avanzado para generar plantillas recomendadas.'));
    return;
  }
  for (const template of templates) {
    const card = element('article', 'commercial-template-card');
    const badge = element(
      'span',
      'commercial-badge',
      template.status === 'DRAFT' ? 'Borrador automático' : 'Vista previa',
    );
    card.append(
      badge,
      element('strong', '', template.title),
      element('div', 'commercial-template-body', template.body),
      element('small', 'muted', `Envío sugerido: ${template.suggestedTrigger}`),
    );
    target.append(card);
  }
}

async function requestQuote(event) {
  event.preventDefault();
  const state = commercialState();
  if (!state.selectedBotId) return;
  const useCase = event.currentTarget.elements.useCase.value;
  try {
    await commercialApi(
      `/api/bots/${encodeURIComponent(state.selectedBotId)}/commercial-plan/request`,
      { method: 'POST', body: JSON.stringify({ useCase }) },
    );
    notice('Solicitud registrada. Ahora corresponde preparar la cotización.');
    await loadCommercialPlan(state.selectedBotId);
  } catch (error) {
    notice(error instanceof Error ? error.message : 'No se pudo registrar la solicitud.', true);
  }
}

async function cancelRequest(botId) {
  if (!window.confirm('¿Cancelar la solicitud de cotización avanzada?')) return;
  try {
    await commercialApi(`/api/bots/${encodeURIComponent(botId)}/commercial-plan/request`, {
      method: 'DELETE',
    });
    notice('Solicitud cancelada.');
    await loadCommercialPlan(botId);
  } catch (error) {
    notice(error instanceof Error ? error.message : 'No se pudo cancelar la solicitud.', true);
  }
}

function showCommercialSection(button) {
  document.querySelectorAll('.panel-section').forEach((section) => {
    section.classList.toggle('hidden', section.id !== 'section-commercial');
  });
  document.querySelectorAll('button[data-section]').forEach((candidate) => {
    candidate.classList.toggle('active', candidate === button);
  });
  const state = commercialState();
  if (state.selectedBotId) {
    window.history.replaceState(
      null,
      '',
      `#assistants/${encodeURIComponent(state.selectedBotId)}/commercial`,
    );
    void loadCommercialPlan(state.selectedBotId);
  }
}

export function hideLegacyQrInterface() {
  document.querySelector('#qr-card')?.classList.add('hidden');
  document.querySelectorAll('[data-community-channel]').forEach((node) => node.classList.add('hidden'));
}
