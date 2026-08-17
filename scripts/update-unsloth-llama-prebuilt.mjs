import './lib/load-local-env.mjs';

const endpoint = process.argv[2] || 'http://100.99.99.99:11445';
const token = process.env.UNSLOTH_API_KEY;
if (!token) throw new Error('Missing UNSLOTH_API_KEY');
const headers = { authorization: `Bearer ${token}` };

const statusResponse = await fetch(`${endpoint}/api/llama/update-status?force_refresh=true`, { headers });
const before = await statusResponse.json();
if (!statusResponse.ok) throw new Error(`Status HTTP ${statusResponse.status}: ${JSON.stringify(before)}`);
console.log(JSON.stringify({ before }, null, 2));

if (before.update_available || before.source_build) {
  const updateResponse = await fetch(`${endpoint}/api/llama/update`, { method: 'POST', headers });
  const action = await updateResponse.json();
  if (!updateResponse.ok) throw new Error(`Update HTTP ${updateResponse.status}: ${JSON.stringify(action)}`);
  console.log(JSON.stringify({ action }, null, 2));
}

const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const response = await fetch(`${endpoint}/api/llama/update-status`, { headers });
  const status = await response.json();
  console.log(
    JSON.stringify({ state: status.job?.state, progress: status.job?.progress, message: status.job?.message })
  );
  if (status.job?.state === 'success') {
    console.log(JSON.stringify({ after: status }, null, 2));
    process.exit(0);
  }
  if (status.job?.state === 'error') throw new Error(status.job.error || status.job.message || 'Update failed');
  if (!status.update_available && status.job?.state !== 'running') {
    console.log(JSON.stringify({ after: status }, null, 2));
    process.exit(0);
  }
}

throw new Error('Timed out waiting for llama.cpp update');
