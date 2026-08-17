# Dictionary Remote Runner

## Active six-node topology (2026-08-17)

- Qwen generation: A6000-143 plus RTX 4090 nodes 47/56 on ports
  11441/11448/11447.
- Gemma review: A6000 nodes 144/155 plus RTX 4090-224 on ports
  11442/11445/11446.
- A6000-147 (11444) is excluded and its model must remain unloaded until the
  owner makes it available again.

The remote runner is installed on the Tailscale Windows jump host at
`D:\linguago-runner`. It keeps candidate data, dictionary evidence, model
calls, checkpoints, and reports on `100.99.99.99` instead of sending every
pipeline stage from the Codex workspace.

The 2026-08-15 scale gate validated this runner through an isolated 502-entry
write, controlled promotion, native export, and full in-memory import audit.
For follow-up cohorts, exclude prior entries with
`select-dictionary-v2-source-gap-fresh-cohort.mjs --exclude-source-entries true
--one-per-source-entry true`; excluding only source-sense keys can select a
second sense for an entry that already has a draft and overstate batch growth.

## Safety boundary

- The runner defaults to `dry-run=true` and `apply=false`.
- It never publishes to D1 or changes the Worker.
- The API key is read from the remote Windows user environment and is not
  stored in the repository, runner manifest, command arguments, or logs.
- Qwen has permanent workers on local jump-host relays `127.0.0.1:11447` and
  `11448`.
- Gemma has a permanent reviewer on `127.0.0.1:11444`.
- Large review queues use `11442`, `11444`, and `11445` in parallel. Nodes 144
  and 155 are elastic Unsloth Studio workers: requesting Gemma swaps out their
  currently loaded model. Do not start a second standalone llama/vLLM process.
- Elastic switching is explicit: if the active model differs, the runner calls
  `/v1/unload`, waits for the old model to leave `active_model`, then calls
  `/v1/load`. If the requested model is already resident, it is reused.
- Review workers share one queue. Only endpoints that pass prewarm enter the
  active pool; faster nodes naturally take more items. Transport or JSON errors
  retry across every healthy endpoint, while semantic rejections are not
  retried. Reports include `active_endpoints`, `endpoint_counts`, and per-node
  prewarm/load actions so a silent single-node fallback is visible.
- If every healthy reviewer returns a transport or invalid-JSON error for one
  item, that item becomes `manual_review` with the per-endpoint attempt trace.
  It never becomes accepted, but it also does not stop unrelated queue items.
- Keep an elastic model resident for at least five minutes and switch only for
  a queue of 20 or more items; otherwise model-load latency can exceed the work
  saved by parallelism.
- The runner enforces that threshold per stage with `--elastic-minimum-items`
  (default `20`). A large Qwen source-review or generation stage adds 11442 and
  11445 to its shared queue. A small repair stage stays on 11447/11448, so it
  does not unload Gemma for one or two retries.
- A `finally` cleanup restores 11442/11445 to Gemma even when the last repair
  review is skipped or the pipeline fails. Check
  `manifest.stages.restore_elastic_reviewers`; `degraded` means an operator must
  restore or repair the listed endpoint before the next review batch.
- Every stage records output hashes in `runs/<run-id>/manifest.json`.
- Resume refuses to continue when the input batch fingerprint changes.

## Pipeline

1. Qwen per-language source review with a required native four-language
   definition contract.
2. Evidence-bound preferred-term lock.
3. Gemma review of the exact same locked proposal.
4. Exact Qwen/Gemma source-review intersection.
5. Qwen full four-language generation, still without DB writes.
6. Deterministic independent reverse-dictionary evidence validation.
7. Gemma final no-correction review.

The stages are dependency ordered, but each model stage is data-parallel. Qwen
generation and Gemma review use separate node pools, so consecutive chunks can
be pipelined without changing the evidence gates.

## Elastic-pool validation

The `v97-handedict-elastic-pool-regression59` no-write regression validated the
dynamic role switch end to end:

- Qwen source review used four workers: 11447=`18`, 11448=`14`, 11442=`13`,
  11445=`14`; all `59` calls were valid.
- 144 and 155 explicitly unloaded Gemma and loaded Qwen `UD-Q4_K_XL`. Qwen
  load took about `38` seconds on 144 and `153` seconds on 155 in this run.
- The same elastic nodes then switched back to Gemma. Final review used all
  three reviewers: 11442=`6`, 11444=`7`, 11445=`7` for the 20 generated rows.
- Final no-correction acceptance was `19/20`; transport and JSON failures were
  zero, and automatic database writes were zero.

The dashboard is an instantaneous sample and may show only one busy reviewer
near a stage boundary. Use each report's `summary.endpoint_counts` and
`prewarm_results` to determine actual participation.

## Operations

Run these through the `ts-win-jump` SSH alias:

```powershell
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\manage-remote-dictionary-runner.ps1 -Action start -Batch batches\v97-20c.json -RunId v97-20c-fixed-contract"
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\manage-remote-dictionary-runner.ps1 -Action status -RunId v97-20c-fixed-contract"
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\manage-remote-dictionary-runner.ps1 -Action stop -RunId v97-20c-fixed-contract"
```

Windows OpenSSH may terminate a `Start-Process` descendant when the SSH job
closes. For an operator-attached run, use `-Action run`; this keeps the SSH
session open until the pipeline exits and is the verified execution mode:

```powershell
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\manage-remote-dictionary-runner.ps1 -Action run -Batch batches\v97-20c.json -RunId v97-20c-fixed-contract"
```

Do not treat a background manifest left at `status=running` with an empty log
as model progress. Check that the controller PID is alive, or resume with the
foreground `run` action.

`stop` is an explicit operator action. A failed stage remains resumable; fix
the endpoint or input issue and run `start` again with the same run ID.

The manager records foreground `run` sessions in `controller.json`. Starting a
second process with the same run ID is rejected, and `stop` terminates the full
process tree. If a foreground SSH connection is interrupted, check `status`
before restarting; do not assume the remote Node child exited with the client.
The controller PID is accepted only when its command line still identifies the
same runner and run ID; stale files and unrelated PID reuse are ignored.

## Verification

Run:

```powershell
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\verify-remote-dictionary-runner.ps1"
```

The result must show matching hashes, Node 24.16, a loadable
`better-sqlite3`, three healthy endpoints, and `UnslothKey=set` before a run.
