const state = {
  csrfToken: null,
  selectedBotId: null,
  options: null,
};

export function commercialState() {
  return state;
}

export async function commercialApi(path, options = {}) {
  if (state.csrfToken === null) {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Debes iniciar sesión para continuar.');
    const session = await response.json();
    state.csrfToken = session.csrfToken;
  }
  const headers = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  if (options.method && options.method !== 'GET') {
    headers['x-csrf-token'] = state.csrfToken;
  }
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'La operación no pudo completarse.');
  return payload;
}

export function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function notice(message, error = false) {
  const target = document.querySelector('#notice');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('error', error);
  target.classList.remove('hidden');
  window.setTimeout(() => target.classList.add('hidden'), 6000);
}

export function renderCards(selector, cards) {
  const target = document.querySelector(selector);
  if (!target) return;
  target.replaceChildren();
  for (const [label, value] of cards) {
    const card = element('div', 'status-card');
    card.append(element('span', '', label), element('strong', '', String(value)));
    target.append(card);
  }
}

export function normalizeBotIdentifier(value) {
  let normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
  if (normalized && !/^[a-z]/u.test(normalized)) normalized = `bot-${normalized}`;
  return normalized.slice(0, 40).replace(/-$/u, '');
}
