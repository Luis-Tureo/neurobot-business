let csrfToken = null;
let legacyOrganizationTypeAliases = {};

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' && value.length > 0 ? value : null;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export function setOrganizationTypeAliases(aliases) {
  legacyOrganizationTypeAliases = {};
  if (typeof aliases !== 'object' || aliases === null || Array.isArray(aliases)) return;
  for (const [legacy, canonical] of Object.entries(aliases)) {
    if (typeof canonical === 'string' && legacy.length > 0 && canonical.length > 0) {
      legacyOrganizationTypeAliases[legacy] = canonical;
    }
  }
}

export function normalizeOrganizationType(value) {
  if (typeof value !== 'string') return value;
  return legacyOrganizationTypeAliases[value] ?? value;
}

export function normalizeOrganizationTypePayload(body) {
  if (typeof body !== 'string' || body.length === 0) return body;
  try {
    const payload = JSON.parse(body);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return body;
    const current = payload.organizationType;
    const normalized = normalizeOrganizationType(current);
    if (typeof current !== 'string' || normalized === current) return body;
    return JSON.stringify({
      ...payload,
      organizationType: normalized,
    });
  } catch {
    return body;
  }
}

export function friendlyApiError(payload, response) {
  const technicalMessage =
    typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : 'La solicitud no pudo completarse.';
  const errorCode =
    typeof payload === 'object' && payload !== null && 'code' in payload
      ? String(payload.code)
      : null;
  const isOrganizationTypeValidationError =
    [400, 422].includes(response.status) &&
    (errorCode === 'INVALID_ORGANIZATION_TYPE' ||
      /organizationType/iu.test(technicalMessage) ||
      (/Invalid option/iu.test(technicalMessage) &&
        /Comercio|Restaurante|Servicios/iu.test(technicalMessage)));
  return {
    technicalMessage,
    message: isOrganizationTypeValidationError
      ? 'No se pudo guardar porque el tipo de negocio seleccionado no es válido.'
      : technicalMessage,
  };
}

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const body = normalizeOrganizationTypePayload(options.body);
  const headers = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    ...(body && !(body instanceof window.FormData) ? { 'content-type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(path, {
    ...options,
    body,
    method,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!response.ok) {
    const { message, technicalMessage } = friendlyApiError(payload, response);
    if (technicalMessage !== message) {
      window.console.error('API validation error:', technicalMessage);
    }
    const error = new Error(message);
    error.code =
      typeof payload === 'object' && payload !== null && 'code' in payload
        ? String(payload.code)
        : null;
    error.status = response.status;
    error.technicalMessage = technicalMessage;
    if (response.status === 401) {
      window.dispatchEvent(new window.CustomEvent('panel:session-expired'));
    }
    throw error;
  }

  return payload;
}
