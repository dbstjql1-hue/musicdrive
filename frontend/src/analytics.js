import { apiFetch, isApiUnavailableError } from './apiClient';

export async function trackActivity(eventType, options = {}) {
  if (!eventType) return;

  const {
    userId = null,
    sessionId = null,
    songId = null,
    metadata = {}
  } = options;

  try {
    await apiFetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType,
        userId,
        sessionId,
        songId,
        metadata
      })
    });
  } catch (err) {
    if (import.meta.env.DEV && !isApiUnavailableError(err)) {
      console.debug('Activity tracking skipped:', err);
    }
  }
}
