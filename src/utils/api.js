/**
 * Unified API Client Layer with Global Error Interception & Dispatching
 */

// Helper to intercept HTTP errors and Network failures globally
async function request(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data.error || `请求失败 (HTTP ${response.status})`;
      // Dispatch custom global event for UI toast alerts
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: errorMessage } }));
      throw new Error(errorMessage);
    }
    return data;
  } catch (err) {
    if (!(err instanceof Error)) {
      err = new Error(String(err));
    }
    // Browser native connection failure error name
    if (err.message === 'Failed to fetch') {
      const offlineMsg = '网络连接失败，请检查您的网络连接 / Sem conexão com a internet';
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: offlineMsg } }));
      throw new Error(offlineMsg);
    }
    throw err;
  }
}

export async function fetchRemoteSettings() {
  return request('/api/settings');
}

export async function fetchRemoteModels() {
  return request('/api/models', { cache: 'no-store' });
}

export async function saveRemoteSettings(settings) {
  return request('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings)
  });
}

export async function verifyTranslation(payload) {
  return request('/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function reportTranslationError(payload) {
  return request('/api/report-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function fetchDictionaryStats() {
  return request('/api/dictionary/stats');
}

// Keep stream fetch separate but wrap network check
export async function openTranslationStream(payload) {
  try {
    const response = await fetch('/api/translate-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const errMsg = data.error || `流请求失败 (HTTP ${response.status})`;
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: errMsg } }));
      throw new Error(errMsg);
    }
    return response;
  } catch (err) {
    if (err instanceof Error && err.message === 'Failed to fetch') {
      const offlineMsg = '网络连接失败，请检查您的网络连接 / Sem conexão com a internet';
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: offlineMsg } }));
      throw new Error(offlineMsg);
    }
    throw err;
  }
}
