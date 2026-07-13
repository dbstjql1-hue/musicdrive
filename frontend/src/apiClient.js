const configuredApiBaseUrl = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL = (
  configuredApiBaseUrl || (import.meta.env.DEV ? 'http://127.0.0.1:5000' : '')
).replace(/\/+$/, '');

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;

let consecutiveFailures = 0;
let retryAt = 0;
let apiReady = false;
let healthCheckPromise = null;

export class ApiUnavailableError extends Error {
  constructor(message = 'API server is unavailable.', options = {}) {
    super(message, options);
    this.name = 'ApiUnavailableError';
  }
}

export function isApiUnavailableError(error) {
  return error?.name === 'ApiUnavailableError';
}

export function getApiRetryDelay() {
  return Math.max(INITIAL_RETRY_DELAY_MS, retryAt - Date.now());
}

function buildApiUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function markApiUnavailable(error) {
  if (!apiReady && Date.now() < retryAt) {
    return new ApiUnavailableError('API retry is waiting for backoff.', { cause: error });
  }

  consecutiveFailures += 1;
  const retryDelay = Math.min(
    INITIAL_RETRY_DELAY_MS * (2 ** (consecutiveFailures - 1)),
    MAX_RETRY_DELAY_MS
  );

  retryAt = Date.now() + retryDelay;
  apiReady = false;

  return new ApiUnavailableError('API server is temporarily unavailable.', { cause: error });
}

function markApiAvailable() {
  consecutiveFailures = 0;
  retryAt = 0;
  apiReady = true;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternalSignal();
    else externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  try {
    return await window.fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

async function ensureApiAvailable() {
  if (apiReady) return;

  if (Date.now() < retryAt) {
    throw new ApiUnavailableError('API retry is waiting for backoff.');
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw markApiUnavailable(new Error('Browser is offline.'));
  }

  if (!healthCheckPromise) {
    healthCheckPromise = fetchWithTimeout(
      buildApiUrl('/api/health'),
      { cache: 'no-store', headers: { Accept: 'application/json' } },
      HEALTH_TIMEOUT_MS
    )
      .then(async (healthResponse) => {
        const response = healthResponse.status === 404
          ? await fetchWithTimeout(
            buildApiUrl('/api/songs?query=__healthcheck__&category='),
            { cache: 'no-store', headers: { Accept: 'application/json' } },
            HEALTH_TIMEOUT_MS
          )
          : healthResponse;
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error(`API health check failed with status ${response.status}.`);
        }
        markApiAvailable();
      })
      .catch((error) => {
        throw markApiUnavailable(error);
      })
      .finally(() => {
        healthCheckPromise = null;
      });
  }

  await healthCheckPromise;
}

export async function apiFetch(pathOrUrl, init = {}, options = {}) {
  await ensureApiAvailable();

  try {
    const response = await fetchWithTimeout(
      buildApiUrl(pathOrUrl),
      init,
      options.timeoutMs || 15_000
    );
    markApiAvailable();
    return response;
  } catch (error) {
    if (isApiUnavailableError(error)) throw error;
    throw markApiUnavailable(error);
  }
}
