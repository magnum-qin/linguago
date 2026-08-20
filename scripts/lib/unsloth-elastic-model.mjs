import { performance } from 'node:perf_hooks';

export async function ensureUnslothModel(options) {
  const {
    endpoint,
    token,
    model,
    variant = null,
    maxSeqLength,
    speculativeType = 'off',
    loadTimeoutMs = 300_000,
    forceReload = false,
    unloadBeforeLoad = false,
    requireInstalled = process.env.UNSLOTH_REQUIRE_INSTALLED_MODEL === '1',
    loadOptions = {}
  } = options;
  const started = performance.now();
  try {
    const statusBefore = await requestJson(endpoint, token, '/v1/status', { timeoutMs: 30_000 });
    const sameModel =
      statusBefore?.active_model === model &&
      (!variant || statusBefore?.gguf_variant === variant) &&
      (!statusBefore?.context_length || Number(statusBefore.context_length) === Number(maxSeqLength)) &&
      (!statusBefore?.speculative_type || statusBefore.speculative_type === speculativeType);
    if (sameModel && !forceReload) {
      return result(true, 'reuse', statusBefore, statusBefore);
    }

    if (requireInstalled) {
      const localModels = await requestJson(endpoint, token, '/api/models/local', { timeoutMs: 60_000 });
      if (!localModelIds(localModels).has(model)) {
        throw new Error(`production_model_not_installed:${model}`);
      }
    }

    let unloaded = false;
    if (unloadBeforeLoad && statusBefore?.active_model) {
      await requestJson(endpoint, token, '/v1/unload', {
        method: 'POST',
        body: { model_path: statusBefore.active_model },
        timeoutMs: 60_000
      });
      unloaded = true;
      await waitUntilUnloaded(endpoint, token, statusBefore.active_model, 90_000);
    }

    const body = {
      model_path: model,
      max_seq_length: maxSeqLength,
      load_in_4bit: false,
      speculative_type: speculativeType,
      ...loadOptions
    };
    if (variant) body.gguf_variant = variant;
    await requestJson(endpoint, token, '/v1/load', {
      method: 'POST',
      body,
      timeoutMs: loadTimeoutMs
    });
    const statusAfter = await waitUntilReady(endpoint, token, model, variant, maxSeqLength, loadTimeoutMs);
    return result(true, unloaded ? 'unload_load' : 'load', statusBefore, statusAfter);
  } catch (error) {
    return {
      endpoint,
      ok: false,
      action: 'failed',
      seconds: secondsSince(started),
      model,
      variant,
      error: String(error?.message || error)
    };
  }

  function result(ok, action, statusBefore, statusAfter) {
    return {
      endpoint,
      ok,
      action,
      skipped: action === 'reuse',
      seconds: secondsSince(started),
      model,
      variant,
      previous_model: statusBefore?.active_model || null,
      active_model: statusAfter?.active_model || null,
      context_length: statusAfter?.context_length || null,
      cpu_fallback_reason: statusAfter?.cpu_fallback_reason || null,
      n_cpu_moe: statusAfter?.n_cpu_moe ?? null
    };
  }
}

function localModelIds(payload) {
  const rows = Array.isArray(payload?.models)
    ? payload.models
    : Array.isArray(payload?.data?.models)
      ? payload.data.models
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return new Set(rows.map((row) => String(row?.id || row?.model_id || '')).filter(Boolean));
}

async function waitUntilUnloaded(endpoint, token, previousModel, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await requestJson(endpoint, token, '/v1/status', { timeoutMs: 15_000 });
    if (!status?.active_model || status.active_model !== previousModel) return;
    await delay(1_000);
  }
  throw new Error(`Model did not unload before timeout: ${previousModel}`);
}

async function waitUntilReady(endpoint, token, model, variant, maxSeqLength, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    lastStatus = await requestJson(endpoint, token, '/v1/status', { timeoutMs: 15_000 });
    if (
      lastStatus?.active_model === model &&
      (!variant || lastStatus.gguf_variant === variant) &&
      (!lastStatus.context_length || Number(lastStatus.context_length) === Number(maxSeqLength))
    ) return lastStatus;
    await delay(2_000);
  }
  throw new Error(`Model did not become ready: ${model}; last=${JSON.stringify(lastStatus)}`);
}

async function requestJson(endpoint, token, pathname, options = {}) {
  const response = await fetch(`${endpoint}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs || 30_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error(`non_json_response:${text.slice(0, 400)}`); }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function secondsSince(started) { return Math.round((performance.now() - started) / 10) / 100; }
