import {
  commercialApi,
  commercialState,
  element,
  normalizeBotIdentifier,
  notice,
} from './meta-commercial-api.js';

export function installCreatePlanFields() {
  const form = document.querySelector('#create-bot-form');
  if (!form || form.querySelector('[data-commercial-create-fields]')) return;

  const host = element('fieldset', 'card inset');
  host.dataset.commercialCreateFields = 'true';
  host.innerHTML = `
    <legend>Plan de servicio</legend>
    <p class="muted">El plan avanzado se solicita aquí, pero solo se activa después de recibir y aceptar una cotización.</p>
    <div class="commercial-plan-choice">
      <label>
        <input type="radio" name="commercialPlanIntent" value="BASIC" checked />
        <span><strong>Plan básico</strong><small>Atención automática cuando el cliente escribe. Los mensajes fuera de la ventana de 24 horas quedan bloqueados.</small></span>
      </label>
      <label>
        <input type="radio" name="commercialPlanIntent" value="ADVANCED" />
        <span><strong>Comercio avanzado</strong><small>Para entregas, seguimiento de pedidos o agenda de horas. Requiere cotización y tiene un cobro mensual adicional.</small></span>
      </label>
    </div>
    <div class="hidden" data-commercial-advanced-fields>
      <label>
        ¿Qué automatización necesita?
        <select name="advancedUseCase">
          <option value="DELIVERY">Reparto y entregas</option>
          <option value="APPOINTMENTS">Agenda de horas</option>
          <option value="GENERAL">Otro proceso comercial</option>
        </select>
      </label>
      <p class="commercial-price-note" data-commercial-create-price>
        El valor final se confirma en la cotización. Los cargos de Meta se pagan por separado directamente en la cuenta del negocio.
      </p>
    </div>
  `;
  const actions = form.querySelector('.actions');
  if (actions) form.insertBefore(host, actions);
  else form.append(host);

  const advancedFields = host.querySelector('[data-commercial-advanced-fields]');
  form.addEventListener('change', (event) => {
    if (event.target.name !== 'commercialPlanIntent') return;
    advancedFields.classList.toggle('hidden', event.target.value !== 'ADVANCED');
  });
  form.addEventListener('submit', handleCommercialCreate, true);
  void loadOptionsAndPrice().catch(() => {});
}

async function loadOptionsAndPrice() {
  const state = commercialState();
  if (state.options === null) state.options = await commercialApi('/api/commercial-plan/options');
  const advanced = state.options.plans.find((plan) => plan.id === 'ADVANCED');
  const target = document.querySelector('[data-commercial-create-price]');
  if (!target || !advanced) return;
  target.textContent = `Precio base del plan avanzado: US$${advanced.monthlyPriceUsd} mensuales por negocio. Los cargos de Meta no están incluidos y se pagan directamente en la cuenta empresarial.`;
}

async function handleCommercialCreate(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const planIntent = data.commercialPlanIntent || 'BASIC';
  const useCase = data.advancedUseCase || 'GENERAL';
  delete data.commercialPlanIntent;
  delete data.advancedUseCase;
  delete data.exclusiveNumberConfirmed;
  data.id = normalizeBotIdentifier(data.id);
  data.mode = 'business';
  data.connectorType = 'WHATSAPP_CLOUD_API';
  if (data.preset === 'community') data.preset = 'empty';
  if (data.id.length < 3) {
    notice('El identificador interno debe tener al menos 3 caracteres.', true);
    form.elements.id.focus();
    return;
  }
  try {
    const result = await commercialApi('/api/bots', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (planIntent === 'ADVANCED') {
      await commercialApi(`/api/bots/${encodeURIComponent(result.bot.id)}/commercial-plan/request`, {
        method: 'POST',
        body: JSON.stringify({ useCase }),
      });
    }
    notice(
      planIntent === 'ADVANCED'
        ? 'Asistente creado. La solicitud de cotización avanzada quedó registrada.'
        : 'Asistente creado con el plan básico protegido.',
    );
    window.location.hash = `#assistants/${encodeURIComponent(result.bot.id)}/commercial`;
    window.location.reload();
  } catch (error) {
    notice(error instanceof Error ? error.message : 'No fue posible crear el asistente.', true);
  }
}
