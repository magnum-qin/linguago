#!/usr/bin/env node

const dashboardUrl = process.env.CLUSTER_STATUS_URL || 'http://127.0.0.1:18080/api/status';

async function main() {
  try {
    const res = await fetch(dashboardUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log('=== CLUSTER STATUS REPORT ===');
    console.log(`Timestamp: ${data.timestamp || new Date().toISOString()}`);
    console.log(`Summary: Total=${data.summary?.total}, Online=${data.summary?.online}, Busy=${data.summary?.busy}, Down=${data.summary?.down}`);
    console.log('--------------------------------------------------------------------------------');
    console.log('Host'.padEnd(14) + 'Group'.padEnd(12) + 'GPU Util'.padEnd(10) + 'Memory'.padEnd(18) + 'Temp'.padEnd(8) + 'Available?'.padEnd(16) + 'Process User');
    console.log('------------------------------------------------------------------------------------------------------');
    let availableCount = 0;
    const serviceUser = process.env.CLUSTER_SERVICE_USER || 'g24tka12';
    for (const host of data.hosts || []) {
      const gpuUtil = host.gpu?.util_gpu ?? 0;
      const memUsed = host.gpu?.mem_used_mb ?? 0;
      const memTotal = host.gpu?.mem_total_mb ?? 0;
      const temp = host.gpu?.temp_c ?? 0;
      const state = host.state || 'unknown';
      const gpuProcs = (Array.isArray(host.processes) ? host.processes : [])
        .filter((p) => Number(p.gpu_mem_mb || 0) >= 256 || p.comm === 'llama-server' || p.comm === 'vllm' || p.comm === 'VLLM::EngineCor');
      const foreignProcs = gpuProcs.filter((p) => p.user !== serviceUser);
      const isAvailable = host.agent_reachable && foreignProcs.length === 0 && gpuUtil <= 15 && temp <= 84;
      if (isAvailable) availableCount += 1;
      const userTag = foreignProcs.length > 0 ? `FOREIGN (${foreignProcs.map(p=>p.user).join(',')})` : gpuProcs.length > 0 ? `${serviceUser} (owned)` : 'none';
      console.log(
        host.name.padEnd(14) +
        (host.group || '').padEnd(12) +
        `${gpuUtil}%`.padEnd(10) +
        `${memUsed}/${memTotal}MB`.padEnd(18) +
        `${temp}°C`.padEnd(8) +
        (isAvailable ? 'YES (USABLE)' : 'NO (OCCUPIED)').padEnd(16) +
        userTag
      );
    }
    console.log('------------------------------------------------------------------------------------------------------');
    console.log(`Total Usable Service Nodes: ${availableCount}`);
    const isReady = availableCount >= 4;
    console.log(`Inference Server Ready: ${isReady ? 'YES (IDLE / OWNED_USABLE)' : 'NO (BUSY)'}`);
    process.exit(isReady ? 0 : 1);
  } catch (err) {
    console.error('Failed to query cluster status:', err.message);
    process.exit(2);
  }
}

main();
