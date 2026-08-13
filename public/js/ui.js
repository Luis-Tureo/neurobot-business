const toastTimers = new WeakMap();

export function element(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      if (value !== null && value !== undefined) node.setAttribute(name, String(value));
    }
  }
  return node;
}

export function notify(message, tone = 'success') {
  const region = document.querySelector('#toast-region');
  if (!region) return;

  const toast = element('div', {
    className: `toast ${tone}`,
    attributes: { role: tone === 'error' ? 'alert' : 'status' },
  });
  toast.append(element('span', { text: message }));

  const close = element('button', {
    text: '×',
    attributes: { type: 'button', 'aria-label': 'Cerrar notificación' },
  });
  const remove = () => {
    const timer = toastTimers.get(toast);
    if (timer) window.clearTimeout(timer);
    toast.remove();
  };
  close.addEventListener('click', remove, { once: true });
  toast.append(close);
  region.append(toast);
  const timer = window.setTimeout(remove, tone === 'error' ? 8000 : 5000);
  toastTimers.set(toast, timer);
}

export function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/Cannot read properties|replaceChildren|is not a function|undefined|null/iu.test(message)) {
    return 'No fue posible abrir esta sección. Actualiza la página y vuelve a intentarlo.';
  }
  return message || 'La operación no pudo completarse.';
}

export async function withBusy(button, task, busyLabel) {
  if (!button || button.disabled || button.getAttribute('aria-busy') === 'true') return undefined;
  const originalChildren = [...button.childNodes].map((node) => node.cloneNode(true));
  const label = busyLabel || button.dataset.busyLabel || 'Procesando…';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  try {
    return await task();
  } catch (error) {
    notify(friendlyError(error), 'error');
    return undefined;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.replaceChildren(...originalChildren);
  }
}

export function bindAsyncForm(formOrSelector, handler) {
  const form =
    typeof formOrSelector === 'string' ? document.querySelector(formOrSelector) : formOrSelector;
  if (!form || form.dataset.asyncBound === 'true') return;
  form.dataset.asyncBound = 'true';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submitter = event.submitter || form.querySelector('button[type="submit"]');
    void withBusy(submitter, async () => {
      form.setAttribute('aria-busy', 'true');
      try {
        await handler(event, form);
      } catch (error) {
        notify(friendlyError(error), 'error');
      } finally {
        form.removeAttribute('aria-busy');
      }
    });
  });
}

export function actionButton(label, className, handler, options = {}) {
  const button = element('button', {
    className,
    text: label,
    attributes: { type: 'button' },
  });
  button.addEventListener('click', () => {
    void withBusy(
      button,
      async () => {
        try {
          await handler(button);
        } catch (error) {
          notify(friendlyError(error), 'error');
        }
      },
      options.busyLabel,
    );
  });
  return button;
}

export function setLoading(target, message = 'Cargando…') {
  if (!target) return;
  target.replaceChildren(element('div', { className: 'loading-state', text: message }));
}

export function renderEmpty(target, title, description, action) {
  if (!target) return;
  const empty = element('div', { className: 'empty-state' });
  empty.append(element('h3', { text: title }), element('p', { text: description }));
  if (action) empty.append(action);
  target.replaceChildren(empty);
}

export function formatDate(value) {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Sin registro'
    : new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

export function statusBadge(text, tone = 'neutral') {
  return element('span', { className: `status-badge ${tone}`, text });
}

export function listRow(title, description) {
  const row = element('article', { className: 'list-row' });
  const content = element('div', { className: 'list-row__content' });
  content.append(element('h3', { text: title }));
  if (description) content.append(element('p', { text: description }));
  row.append(content);
  return row;
}

export function healthCard(label, value, tone = 'neutral') {
  const card = element('div', { className: `health-card ${tone}` });
  card.append(element('span', { className: 'health-indicator' }));
  const copy = element('div');
  copy.append(element('span', { text: label }), element('strong', { text: value }));
  card.append(copy);
  return card;
}

export function metricCard(label, value) {
  const card = element('div', { className: 'metric-card' });
  card.append(element('span', { text: label }), element('strong', { text: value }));
  return card;
}

export function renderHealthGrid(targetOrSelector, cards) {
  const target =
    typeof targetOrSelector === 'string'
      ? document.querySelector(targetOrSelector)
      : targetOrSelector;
  if (!target) return;
  target.replaceChildren(...cards.map(({ label, value, tone }) => healthCard(label, value, tone)));
}

export function renderMetricGrid(targetOrSelector, cards) {
  const target =
    typeof targetOrSelector === 'string'
      ? document.querySelector(targetOrSelector)
      : targetOrSelector;
  if (!target) return;
  target.replaceChildren(...cards.map(({ label, value }) => metricCard(label, value)));
}

export function lines(value) {
  return String(value || '')
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function numberOrNull(value) {
  return value === '' || value === null || value === undefined ? null : Number(value);
}

export function showPanel(panel, options = {}) {
  if (!panel) return;
  panel.classList.remove('hidden');
  if (options.focus) {
    const focusable = panel.querySelector('input:not([type="hidden"]), select, textarea, button');
    window.setTimeout(() => focusable?.focus(), 0);
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function hidePanel(panel) {
  panel?.classList.add('hidden');
}

export function setStatus(elementOrSelector, text, tone) {
  const target =
    typeof elementOrSelector === 'string'
      ? document.querySelector(elementOrSelector)
      : elementOrSelector;
  if (!target) return;
  target.textContent = text;
  target.className = `status-badge ${tone}`;
}

export function setTestResult(selector, message, tone) {
  const target = document.querySelector(selector);
  if (!target) return;
  target.textContent = message;
  target.className = `test-result ${tone}`;
}

export function confirmAction(options) {
  const activeElement = document.activeElement;
  const returnFocus =
    activeElement && typeof activeElement.closest === 'function'
      ? activeElement.closest('.more-menu')?.querySelector(':scope > button') || activeElement
      : null;
  const dialog = document.querySelector('#action-dialog');
  const form = document.querySelector('#action-dialog-form');
  const title = document.querySelector('#action-dialog-title');
  const eyebrow = document.querySelector('#action-dialog-eyebrow');
  const description = document.querySelector('#action-dialog-description');
  const valueField = document.querySelector('#action-dialog-value-field');
  const valueLabel = document.querySelector('#action-dialog-value-label');
  const valueInput = document.querySelector('#action-dialog-value');
  const confirmationField = document.querySelector('#action-dialog-confirmation-field');
  const confirmationLabel = document.querySelector('#action-dialog-confirmation-label');
  const confirmationInput = document.querySelector('#action-dialog-confirmation');
  const passwordField = document.querySelector('#action-dialog-password-field');
  const passwordInput = document.querySelector('#action-dialog-password');
  const error = document.querySelector('#action-dialog-error');
  const confirm = document.querySelector('#action-dialog-confirm');
  const cancel = document.querySelector('#action-dialog-cancel');
  const close = document.querySelector('#action-dialog-close');

  if (!dialog || !form) return Promise.resolve(null);
  if (dialog.open) dialog.close();
  form.reset();
  error.classList.add('hidden');
  error.textContent = '';
  title.textContent = options.title || 'Confirmar acción';
  eyebrow.textContent = options.eyebrow || (options.danger ? 'Acción destructiva' : 'Confirmación');
  description.textContent = options.description || '';
  confirm.textContent = options.confirmLabel || 'Confirmar';
  confirm.className = options.danger ? 'danger-primary' : '';

  const hasValue = Boolean(options.valueLabel);
  valueField.classList.toggle('hidden', !hasValue);
  valueInput.required = hasValue;
  valueInput.value = options.value ?? '';
  valueLabel.textContent = options.valueLabel || 'Valor';
  valueInput.rows = options.valueRows || 4;

  const hasConfirmation = Boolean(options.expectedConfirmation);
  confirmationField.classList.toggle('hidden', !hasConfirmation);
  confirmationInput.required = hasConfirmation;
  confirmationLabel.textContent = hasConfirmation
    ? `Escribe exactamente: ${options.expectedConfirmation}`
    : 'Confirmación';

  const needsPassword = Boolean(options.requirePassword);
  passwordField.classList.toggle('hidden', !needsPassword);
  passwordInput.required = needsPassword;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dialog.open) dialog.close();
      window.setTimeout(() => {
        if (returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus();
      }, 0);
      resolve(value);
    };
    const onCancel = () => finish(null);
    const onDialogCancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      if (hasConfirmation && confirmationInput.value.trim() !== options.expectedConfirmation) {
        error.textContent = 'La frase de confirmación no coincide.';
        error.classList.remove('hidden');
        confirmationInput.setAttribute('aria-invalid', 'true');
        confirmationInput.focus();
        return;
      }
      confirmationInput.removeAttribute('aria-invalid');
      finish({
        value: valueInput.value.trim(),
        confirmation: confirmationInput.value.trim(),
        password: passwordInput.value,
      });
    };
    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      close.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onDialogCancel);
    };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    close.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onDialogCancel);
    dialog.showModal();
    window.setTimeout(() => {
      if (hasValue) valueInput.focus();
      else if (hasConfirmation) confirmationInput.focus();
      else if (needsPassword) passwordInput.focus();
      else confirm.focus();
    }, 0);
  });
}
