const DEFAULT_PORT_BY_HOST = Object.freeze({
  'a6000-143': '11441',
  'a6000-144': '11442',
  'a6000-048': '11443',
  'a6000-147': '11444',
  'a6000-155': '11445',
  'rtx4090-224': '11446',
  'rtx4090-56': '11447',
  'rtx4090-47': '11448'
});

export async function discoverUnslothStagePool(options) {
  const {
    dashboardUrl = 'http://127.0.0.1:18080/api/status',
    configuredEndpoints = [],
    configuredVariants = new Map(),
    model,
    token,
    serviceUser = 'g24tka12',
    maxIdleGpuUtil = 10,
    maxTemperature = 84,
    requireInstalled = true,
    fetchImpl = fetch,
    dashboardTimeoutMs = 15_000,
    modelCheckTimeoutMs = 30_000
  } = options;

  const configuredByPort = new Map(configuredEndpoints.map((endpoint) => [endpointPort(endpoint), endpoint]));
  try {
    const response = await fetchWithHardTimeout(
      dashboardUrl,
      {},
      dashboardTimeoutMs,
      fetchImpl,
      'dashboard_timeout'
    );
    if (!response.ok) throw new Error(`dashboard_http_${response.status}`);
    const payload = await response.json();
    const selection = selectClusterEndpoints(payload, {
      configuredPorts: new Set(configuredByPort.keys()),
      serviceUser,
      maxIdleGpuUtil,
      maxTemperature
    });

    const baseUrl = configuredEndpoints[0] ? new URL(configuredEndpoints[0]) : new URL('http://127.0.0.1');
    const endpointRows = selection.selected.map((row) => ({
      ...row,
      endpoint: configuredByPort.get(row.port) || `${baseUrl.protocol}//${baseUrl.hostname}:${row.port}`
    }));
    const verified = await Promise.all(endpointRows.map(async (row) => {
      if (!requireInstalled) return { ...row, model_available: true };
      const available = await endpointHasModel(
        row.endpoint,
        model,
        token,
        fetchImpl,
        modelCheckTimeoutMs
      );
      return { ...row, model_available: available };
    }));
    const usable = verified.filter((row) => row.model_available);
    if (!usable.length) {
      return {
        ok: false,
        degraded: true,
        reason: 'dynamic_discovery_found_no_usable_endpoint',
        endpoints: configuredEndpoints,
        variants: configuredVariants,
        selected: verified,
        excluded: selection.excluded
      };
    }

    const variants = new Map();
    for (const row of usable) {
      variants.set(row.port, configuredVariants.get(row.port) || defaultVariant(model, row.group));
    }
    return {
      ok: true,
      degraded: false,
      endpoints: usable.map((row) => row.endpoint),
      variants,
      selected: usable,
      excluded: [
        ...selection.excluded,
        ...verified.filter((row) => !row.model_available).map((row) => ({
          host: row.host,
          port: row.port,
          reason: 'model_not_installed'
        }))
      ],
      dashboard_timestamp: payload.timestamp || null
    };
  } catch (error) {
    return {
      ok: false,
      degraded: true,
      reason: String(error?.message || error),
      endpoints: configuredEndpoints,
      variants: configuredVariants,
      selected: configuredEndpoints.map((endpoint) => ({ port: endpointPort(endpoint), endpoint, source: 'configured_fallback' })),
      excluded: []
    };
  }
}

export function selectClusterEndpoints(payload, options = {}) {
  const configuredPorts = options.configuredPorts || new Set();
  const serviceUser = options.serviceUser || 'g24tka12';
  const maxIdleGpuUtil = Number(options.maxIdleGpuUtil ?? 10);
  const maxTemperature = Number(options.maxTemperature ?? 84);
  const selected = [];
  const excluded = [];

  for (const host of Array.isArray(payload?.hosts) ? payload.hosts : []) {
    const port = DEFAULT_PORT_BY_HOST[host.name];
    if (!port) continue;
    const configured = configuredPorts.has(port);
    const gpuUtil = Number(host.gpu?.util_gpu ?? 100);
    const temperature = Number(host.gpu?.temp_c ?? 100);
    const gpuProcesses = (Array.isArray(host.processes) ? host.processes : [])
      .filter((process) => Number(process.gpu_mem_mb || 0) >= 256);
    const foreignGpuProcesses = gpuProcesses.filter((process) => process.user !== serviceUser);
    const serviceGpuProcesses = gpuProcesses.filter((process) => process.user === serviceUser);
    const idle = host.state === 'idle' && gpuUtil <= maxIdleGpuUtil;
    const ownedConfigured = configured && serviceGpuProcesses.length > 0 && foreignGpuProcesses.length === 0;

    let reason = null;
    if (!host.agent_reachable) reason = 'agent_unreachable';
    else if (foreignGpuProcesses.length) reason = 'foreign_gpu_process';
    else if (temperature > maxTemperature) reason = 'gpu_too_hot';
    else if (!idle && !ownedConfigured) reason = 'not_idle';

    if (reason) {
      excluded.push({ host: host.name, port, reason, gpu_util: gpuUtil, temperature });
      continue;
    }
    selected.push({
      host: host.name,
      port,
      group: host.group,
      source: ownedConfigured ? 'configured_owned' : configured ? 'configured_idle' : 'dynamic_idle',
      gpu_util: gpuUtil,
      temperature
    });
  }
  return { selected, excluded };
}

async function endpointHasModel(endpoint, model, token, fetchImpl, timeoutMs) {
  try {
    const response = await fetchWithHardTimeout(
      `${endpoint}/api/models/local`,
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
      timeoutMs,
      fetchImpl,
      'model_list_timeout'
    );
    if (!response.ok) return false;
    const payload = await response.json();
    const rows = Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload?.data?.models)
        ? payload.data.models
        : Array.isArray(payload?.data)
          ? payload.data
          : [];
    return rows.some((row) => String(row?.id || row?.model_id || '') === model);
  } catch {
    return false;
  }
}

async function fetchWithHardTimeout(url, init, timeoutMs, fetchImpl, timeoutReason) {
  const controller = new AbortController();
  const timeout = Math.max(1, Number(timeoutMs) || 1);
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutReason));
    }, timeout);
  });
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function defaultVariant(model, group) {
  if (/qwen/i.test(model) && /4090/i.test(group || '')) return 'UD-IQ4_NL';
  return 'UD-Q4_K_XL';
}

function endpointPort(endpoint) {
  try { return new URL(endpoint).port; } catch { return String(endpoint); }
}
