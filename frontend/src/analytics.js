const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

export async function trackActivity(eventType, options = {}) {
  if (!eventType) return;

  const {
    userId = null,
    sessionId = null,
    songId = null,
    metadata = {}
  } = options;

  try {
    await fetch(`${API_BASE_URL}/api/activity`, {
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
    if (import.meta.env.DEV) {
      console.debug('Activity tracking skipped:', err);
    }
  }
}
