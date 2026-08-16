let csrfToken = null;

const LEGACY_ORGANIZATION_TYPE_ALIASES = {
  'Servicio profesional': 'Profesional independiente',
};

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' && value.length > 0 ? value : null;
}

export function clearCsrfToken() {
  csrfToken = null;
}

function normalizeOrganizationTypePayload(body) {
  if (typeof body !== 'string' || body.length === 0) return body;
  try {
    const payload = JSON.parse(body);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return body;
    const current = payload.organizationType;
    if (typeof current !== 'string' || !(current in LEGACY_ORGANIZATION_TYPE_ALIASES)) return body;
    return JSON.stringify({
      ...payload,
      organizationType: LEGACY_ORGANIZATION_TYPE_ALIASES[current],
    });
  } catch {
    return body;
  }
}

function friendlyApiError(payload, response) {
  const technicalMessage =
    typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : 'La solicitud no pudo completarse.';
  const isOrganizationTypeValidationError =
    [400, 422].includes(response.status) &&
    (/organizationType/iu.test(technicalMessage) ||
      (/Invalid option/iu.test(technicalMessage) && /Comercio|Restaurante|Servicios/iu.test(technicalMessage)));
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
      console.error('API validation error:', technicalMessage);
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
