let csrfToken = null;

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' && value.length > 0 ? value : null;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    ...(options.body && !(options.body instanceof window.FormData)
      ? { 'content-type': 'application/json' }
      : {}),
    ...(options.headers || {}),
  };

  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(path, {
    ...options,
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
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : 'La solicitud no pudo completarse.';
    const error = new Error(message);
    error.code =
      typeof payload === 'object' && payload !== null && 'code' in payload
        ? String(payload.code)
        : null;
    error.status = response.status;
    if (response.status === 401) {
      window.dispatchEvent(new window.CustomEvent('panel:session-expired'));
    }
    throw error;
  }

  return payload;
}
