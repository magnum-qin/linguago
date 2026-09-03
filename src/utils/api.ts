/**
 * Unified API Client Layer with Global Error Interception & Dispatching
 */
import type {
  TranslatePayload,
  TranslateResponse,
  AppSettings,
  ErrorReportPayload,
  RemoteModelsResponse
} from '../types/translation';

// Helper to intercept HTTP errors and Network failures globally
async function request<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(url, options);
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };

    if (!response.ok) {
      const errorMessage = (data as { error?: string })?.error || `请求失败 (HTTP ${response.status})`;
      // Dispatch custom global event for UI toast alerts
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: errorMessage } }));
      throw new Error(errorMessage);
    }
    return data;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // Browser native connection failure error name
    if (error.message === 'Failed to fetch') {
      const offlineMsg = '网络连接失败，请检查您的网络连接 | Sem conexão com a internet';
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: offlineMsg } }));
      throw new Error(offlineMsg);
    }
    throw error;
  }
}

export async function fetchRemoteSettings(): Promise<AppSettings> {
  return request<AppSettings>('/api/settings');
}

export async function fetchRemoteModels(): Promise<RemoteModelsResponse> {
  return request<RemoteModelsResponse>('/api/models', { cache: 'no-store' });
}

export async function saveRemoteSettings(settings: Partial<AppSettings>): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings)
  });
}

export async function verifyTranslation(payload: TranslatePayload): Promise<TranslateResponse> {
  return request<TranslateResponse>('/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function reportTranslationError(payload: ErrorReportPayload): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/api/report-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function fetchDictionaryStats(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/dictionary/stats');
}

// Keep stream fetch separate but wrap network check
export async function openTranslationStream(payload: TranslatePayload, signal?: AbortSignal): Promise<Response> {
  try {
    const response = await fetch('/api/translate-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      const errMsg = data.error || `流请求失败 (HTTP ${response.status})`;
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: errMsg } }));
      throw new Error(errMsg);
    }
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    if (err instanceof Error && err.message === 'Failed to fetch') {
      const offlineMsg = '网络连接失败，请检查您的网络连接 | Sem conexão com a internet';
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: offlineMsg } }));
      throw new Error(offlineMsg);
    }
    throw err;
  }
}
