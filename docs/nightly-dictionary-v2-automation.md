# Nightly Dictionary V2 Automation

This workflow moves dictionary generation orchestration to the Tailscale Windows jump host (`100.64.0.1`) so local desktop data processing is no longer required during nightly runs.

## What Runs

The scheduled task runs:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/nightly-dictionary-v2-orchestrator.ps1
```

Default behavior:

- Active window: 23:00 to 08:00.
- Model: `qwen3.6:latest`.
- Database: `data/processed/linguago_v2_full.db`.
- A6000 nodes considered from the jump host:
  - `gpu-node-a6000` / `http://10.0.0.143:11433` / `en,zh`
  - `gpu-node-a6000` / `http://10.0.0.151:11433` / `ja`
  - `gpu-node-a6000` / `http://172.23.4.48:11433` / `pt-BR`
  - `gpu-node-a6000` / `http://172.23.4.53:11433` / `en,zh,ja,pt-BR`
- Excluded by default:
  - `gpu-node-a6000`, because it previously had NVML driver/library mismatch.
  - `rtx4090-224`, because it is reserved for training.
  - RTX 4090 nodes, because `qwen3.6:latest` is not the preferred production model there.

## Idle Check

A node is treated as idle only when all checks pass:

- Ollama endpoint is reachable.
- `qwen3.6:latest` is installed.
- `/api/ps` reports no running Ollama model.
- `nvidia-smi --query-compute-apps=pid` over SSH reports no active GPU compute process.
- The same idle state still holds after the recheck delay.

This is intentionally conservative: any active GPU compute process makes the node busy, even if GPU utilization is temporarily low.

## Install On The Jump Host

Run this once on `100.64.0.1` from the project directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-nightly-dictionary-v2-task.ps1
```

The scheduled task is installed as `Linguago Nightly Dictionary V2` and runs daily at 23:05.

Dry-run the orchestrator manually:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/nightly-dictionary-v2-orchestrator.ps1 -ForceNow -DryRun
```

Run manually without waiting for 23:00:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/nightly-dictionary-v2-orchestrator.ps1 -ForceNow
```

## Cloudflare D1 Push

After workers stop, the orchestrator calls:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/push-dictionary-v2-to-d1.ps1
```

That script:

1. Exports `linguago_v2_full.db` to D1-compatible SQL chunks using `scripts/export-dictionary-v2-d1-sql.mjs`.
2. Recreates the current Worker-compatible D1 tables:
   - `entries`
   - `senses`
   - `definitions`
   - `examples`
3. Runs `wrangler d1 execute linguago-dictionary --remote --file ...` for the schema and each chunk.

The jump host must have Wrangler credentials under the Windows user profile. Verify before relying on automatic publishing:

```powershell
node_modules\.bin\wrangler.cmd whoami
node_modules\.bin\wrangler.cmd d1 execute linguago-dictionary --remote --command "SELECT 1 AS ok"
```

Use `-SkipD1Push` on the orchestrator if you only want nightly generation without publishing:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/nightly-dictionary-v2-orchestrator.ps1 -ForceNow -SkipD1Push
```

## Logs

Logs are written under:

```text
logs/nightly-YYYYMMDD-HHMMSS/
```

Each run contains:

- `orchestrator.log`
- one stdout log per worker node
- one stderr log per worker node

The lock file is:

```text
state/nightly-dictionary-v2.lock
```

This prevents overlapping scheduled runs.

## Current Local-First Workflow

The jump-host scheduled task is no longer the active production workflow. Keep generation and publishing local unless explicitly moving work back to the GPU jump host.

Current production publishing path:

```powershell
npm run dict:v2:progress
npm run dict:v2:export:d1-native
npm run dict:v2:push:d1-native
npm run deploy
```

The native D1 export writes only complete, accepted four-language senses into `v2_*` tables:

- `v2_entries`
- `v2_entry_forms`
- `v2_senses`
- `v2_sense_localizations`
- `v2_examples`
- `v2_example_localizations`
- `v2_meta`

The Worker reads `v2_*` first and does not use legacy D1/Louis/Mock sources unless `DICTIONARY_ENABLE_LEGACY_SOURCES=true` is set.
