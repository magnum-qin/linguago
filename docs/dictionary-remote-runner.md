# Dictionary Remote Runner

## Remote runner baseline (2026-08-22)

The jump host now has a validated v137 runner and product database. The
installed product database SHA-256 is
`57DDBED51CE8ED247DBCC090A87A09740D71248D8554435C14C570C4E25D50CC`.
The immediate pre-v137 remote database is backed up as
`D:\linguago-runner\backups\v137-native-daily-raw5000b-main-before-commit-20260822-105448.db`.
Use `config\remote-runner-files.json` and
`verify-remote-dictionary-runner.ps1` as the source of truth for deployed file
versions; do not infer readiness from file timestamps.

The jump-host product DB is authoritative. The repository copy may lag behind
remote controlled commits. When regenerating `remote-runner-files.json`, do
not replace the product-DB entry with the local hash unless the remote DB was
first downloaded and its hash verified. A script-only deployment must preserve
the current remote DB byte count and SHA-256 in the manifest.

The v134 expansion rebuilt coverage from the full source DB after the frozen
v123 pool was exhausted. The safe stage order is production authoritative
source check, source-sense alignment, model review, reverse evidence, semantic
review, generation, and final review. `SourceSenseAlignment` must be persisted
through the Scheduled Task `launch.json`; passing it only to the interactive
controller silently disables alignment in the background job. The corrected
run accepted 11 Portuguese entries, passed idempotent replay and full native
D1 import audit, and produced counts `entries=40926`, `senses=47238`, and
`sense_localizations=188952`. D1 was not published because this increment is
below the 5,000-entry release cadence.

The v135b expansion added a batch SQL native-dictionary coverage lane through
`find-dictionary-v2-native-daily-coverage-gaps.mjs`. It scans CC-CEDICT and
JMdict senses once, excludes product coverage in memory, and leaves specific
sense/localization loading to the downstream daily-primary selector. A
`zh=100,ja=100` scan completed in about 1.6 seconds; the previous generic N+1
scanner could run for minutes without producing an output file. The 1,000-row
v135 cohort produced 57 candidates with two independent reverse-evidence
families. Model gates reduced those to 21 generation-ready rows and accepted
20 final four-language entries. Isolated replay was idempotent, fast/full D1
export audits passed, and the guarded main commit produced counts
`entries=40946`, `senses=47258`, and `sense_localizations=189032`. D1 remains
unchanged because this increment is below the release cadence.

The v136 cohort expanded the native scan to `zh=1000,ja=1000`. Daily-sense,
production, alignment, and independent reverse-evidence gates reduced 2,000
raw entries to 97 model inputs. Gemma approved 92 source proposals, 43 passed
the source reverse-evidence gate, and 40 were generation-ready. The current
remote product DB already covered 19 of those rows, so Qwen generated 21 new
entries; 20 passed schema validation, reverse evidence, and final Gemma review.
Isolated replay inserted 20 drafts, wrote zero rows on the idempotent replay,
and promoted all 20. Full export/import audit passed with
`entries=40966`, `senses=47278`, and `sense_localizations=189112`, while
`flagged_senses` remained zero. D1 was not published.

The v137 cohort was the first 5,000-row raw native production scan. The exact
funnel was `5000 -> 4905 -> 4406 -> 868 -> 150 -> 145 -> 40 -> 38 -> 35 ->
32 -> 30 -> 30`, ending with 30 final Gemma accepts and no automatic database
writes. Controlled replay excluded one row carrying source-review risk flags
and two rows that did not match the final gate, then inserted 29 draft senses
and 116 localizations. Exact replay wrote zero rows, deterministic promotion
accepted 29/29, and fast, published-risk, native D1 export, and full in-memory
import audits passed. The guarded commit produced `entries=40995`,
`senses=47307`, and `sense_localizations=189228`; `flagged_senses` remained
zero. D1 was not published because the cumulative release threshold has not
been reached.

The v137 attempt also exposed two orchestration defects. First, applying the
production prefilter before daily-primary sense selection rejects every raw
native row because the scan report intentionally contains entry IDs rather
than hydrated sense fields. Second, Scheduled Task launches must persist
`ReverseEvidenceMinTargetLangs`, `ReverseEvidencePrefilterLimit`, and
`StartTimeoutSeconds` in `launch.json`; otherwise resumed jobs silently use
defaults. The controller now fixes both issues and records startup state while
waiting for the manifest, terminating only the exact reserved launch if startup
times out.

The native scanner must use a correlated `EXISTS` sense check instead of
`JOIN senses + DISTINCT`. On the 8.7 GB source DB, the join form can create a
large temporary sort and saturate the jump-host disk; the `EXISTS` form avoids
the multiplied intermediate rows while preserving the eligibility rule. Do
not launch a second scanner while diagnosing a slow first scan.

Deep scans must also order by `(frequency_rank, normalized_key, id)`, matching
`idx_entries_frequency`. Adding `source_lang` to the sort key forces SQLite to
materialize another temporary sort and can make a 5,000-row scan run for
minutes even though the equivalent 2,000-row scan is fast.

Successive native production scans must pass prior raw batch reports through
`--exclude-reports`. Product coverage alone excludes accepted rows but would
reselect the thousands of unsupported or manual-review rows from the previous
batch. Exclusion is based on `source_entry_id`, supports comma-separated JSON
reports, and is applied before sense hydration or model calls.

For raw native candidates, the required order is native gap scan, daily-primary
sense selection, authoritative production filter, source-sense alignment, and
local reverse-evidence prefilter. The simplified controller now enforces this
order when all four gates are enabled. Do not run the production prefilter
directly on a raw native gap report: those rows contain entry identities but no
locked `first_sense_id`, so the authoritative source-sense gate will reject
every row. If a fully filtered report is uploaded instead, set all four gate
flags to `false`; repeating the gates can incorrectly discard valid rows.

The model topology below is the configured default, not a guarantee that every
node is available for a particular run. Prewarm determines the active pool.

- Qwen generation: A6000-143 plus RTX 4090 nodes 47/56 on ports
  11441/11448/11447.
- Gemma review: A6000 nodes 144/147/155 plus RTX 4090-224 on ports
  11442/11444/11445/11446, subject to prewarm availability.

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
- Before a model run starts, the controller refuses to proceed while either
  coverage scanner is still running. Two abandoned generic scanners once
  saturated random SQLite I/O and stretched a normally 0.25-second evidence
  stage to several minutes. Verify the command line before stopping a process;
  never terminate an unrelated Node process by name alone.

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

Windows OpenSSH terminates a detached `Start-Process` descendant when the SSH
job closes. `-Action start` therefore registers and starts the fixed Windows
Scheduled Task `Linguago Remote Dictionary Pipeline`; it no longer relies on a
detached child of the SSH session. A host-wide JSON lock rejects concurrent
starts. For an operator-attached run, `-Action run` remains available:

```powershell
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\manage-remote-dictionary-runner.ps1 -Action run -Batch batches\v97-20c.json -RunId v97-20c-fixed-contract"
```

If a scheduled run remains `manifest_status=not_started` for more than about
two minutes and the child Node process has not written `manifest.json`, stop
that run through the manager before retrying. Use attached `-Action run` and
keep the SSH session open to capture stage output directly. Do not start a
second scheduled copy with the same batch while the first child is alive.

The manager now waits up to `StartTimeoutSeconds` (45 seconds by default) for
the scheduled child to create `manifest.json`. It records the result in
`runs\<run-id>\startup.json`. A timeout terminates only the PowerShell launch
process whose command line contains the exact run ID, stops the scheduled task,
and releases the global lock. The watcher includes this startup state. This
turns a silent `not_started` reservation into an explicit recoverable failure.

Do not treat a manifest left at `status=running` as model progress by itself.
Use the watcher or manager status command and require either a live runner or a
terminal manifest state.

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
`better-sqlite3`, healthy required endpoints, and `UnslothKey=set` before a
run.

## Monitoring and Antigravity CLI

Deterministic monitoring:

```powershell
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\watch-remote-dictionary-runner.ps1 -RunId <run-id>"
```

After completing an interactive Google OAuth login for `agy` on the jump host,
the watcher can request a second, read-only diagnosis:

```powershell
ssh ts-win-jump "powershell -ExecutionPolicy Bypass -File D:\linguago-runner\scripts\watch-remote-dictionary-runner.ps1 -RunId <run-id> -UseAgy"
```

`agy` is advisory only. It receives a sanitized status snapshot and may classify
the run or recommend an operator action. It must not execute commands, switch
models, restart jobs, write SQLite, promote senses, export D1, or deploy the
Worker. The manifest, checkpoint, database audits, and release scripts remain
authoritative. Without the interactive OAuth login, `agy --print` waits for an
authorization code and is not suitable for unattended supervision.

## Migration test evidence

Two no-write runs validated the migrated host:

- `v123-migration-smoke20`: 20/20 source reviews were structurally valid, 17
  passed Gemma, and none passed the independent reverse-evidence gate. The
  initial empty generation funnel exposed a missing-checkpoint bug; the
  generator now writes an empty checkpoint and the resumed run completed.
- `v123-migration-smoke100`: completed through the Scheduled Task controller.
  Gemma reviewed 100/100, accepted 87, five passed reverse evidence, three
  passed semantic preview, and one reached Qwen generation. That item (`嗣`)
  was rejected by `known_semantic_mismatch_ja_single_character`; there were no
  model transport failures and no database writes.
- `v123-migration-known-good20`: reran a previously successful cohort and
  reproduced the complete funnel exactly: `20 -> 18 -> 3 -> 2 -> 2 -> 2 -> 2`.
  All three Gemma reviewers and both Qwen generators participated, two records
  passed final no-correction review, and automatic database writes remained 0.
- The two accepted rows were then replayed into an isolated database: two draft
  senses and eight localizations were inserted, exact replay wrote zero rows,
  deterministic promotion accepted 2/2, and fast, published-risk, native D1
  export, and full in-memory import audits passed. Use
  `validate-remote-dictionary-controlled-replay.ps1` to repeat this isolated
  write-path validation; it refuses to use the main product DB as its target.

The tests also verified exact database/evidence hashes, checkpoint resume,
host-wide concurrent-run rejection, Qwen model prewarm on 11447/11448, and
lock cleanup. Zero accepted rows in the 100-row sample is a candidate-yield
result, not a runner migration failure.

Boolean manager options accept `true/false`, `1/0`, `yes/no`, and `on/off` so
they can be passed reliably through SSH. Native PowerShell `[bool]` parameters
must not be restored because SSH supplies command-line values as strings.

OAuth completed in a desktop Antigravity session is not necessarily available
to an SSH or Scheduled Task logon session. Verify `agy --print` through the same
execution context that will supervise the runner. If it requests login there,
keep using deterministic monitoring until that context has persistent auth;
do not block production on `agy`.

## v124 candidate-pool migration and isolated release validation

The authoritative candidate inputs are now present on the jump host and pinned
by `config/remote-candidate-sources.json`:

- `data\candidates\v123-authoritative-pool.json`: `51,575,832` bytes, SHA-256
  `1DF4C0818AA8D56032A72E8C8DC5990E8CE4B9EE92E44D7F34ADB27885356B1A`.
- `data\candidates\v123-attempted-source-history.json`: `28,497,028` bytes,
  SHA-256
  `CFFACC2E20111DB3AA42EC06535F6D35520879FC63401DD32D0F777D4AA14595`.

`new-remote-dictionary-production-batch.ps1` verifies both files before it
selects a cohort. A local and remote 100-row selection produced the same
language split (`zh=57`, `ja=42`, `pt-BR=1`) and the same canonical selected-row
SHA-256:
`1d58f18c856b1c26d81dc20283e3e9041a85a513495f589c68ad6b66c75e4daf`.

Windows PowerShell 5.1 must read generated JSON with explicit UTF-8, for example
`[IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)`. Plain `Get-Content`
uses the active legacy code page and made valid Chinese/Japanese JSON look
corrupt and fail `ConvertFrom-Json`. This was a reader bug, not source-file
mojibake. All remote-runner JSON readers now use explicit UTF-8.

The jump host generated and ran `v124-remote-generated-candidate100` without
local candidate preparation. Its no-write funnel was
`100 -> 84 -> 16 -> 14 -> 13 -> 12 -> 12 -> 11`: input, Gemma source approval,
independent reverse support, semantic preview, generation-ready, valid Qwen
generation, post-generation reverse support, and final Gemma acceptance.

The same 11 final accepts then passed the isolated release-path validator:

- controlled replay inserted 11 draft entries, 11 senses, and 44
  localizations;
- exact replay inserted and updated zero rows;
- deterministic promote dry-run and apply accepted 11/11;
- published-risk reported `flagged_senses=0`;
- native D1 export and full in-memory import audit passed with 40,793 entries,
  47,105 senses, and 188,420 sense localizations;
- all blocking integrity counts were zero. The 481 duplicate-localization
  warnings remain non-blocking historical observations.

This validation used
`runs\v124-remote-generated-candidate100\isolated-controlled-replay.db` only.
The main product database remained unchanged at SHA-256
`BBE5BBAC54A7D14113D9198783CCBCEA31978104804676EA39570F09D4D9F569`,
the global runner lock was clear, and no D1 or Worker deployment occurred.

For a guarded release rehearsal, run
`publish-remote-dictionary-controlled-run.ps1` with the expected main DB hash.
It always reruns the isolated replay and audit first. The default
`-Commit false` leaves the main DB unchanged; `-Commit true` is the only path
that atomically replaces it and retains a rollback database. This controller
does not publish D1 or deploy the Worker. The first controller rehearsal for
v124 completed with `commit=false`, 11 inserted/promoted senses, zero risk
flags, all full-audit blockers at zero, and `main_replaced=false`.

The jump host has Wrangler 4.107.0 and an OAuth profile, but the OAuth token is
expired and cannot be refreshed in the non-interactive SSH/Scheduled Task
context. `check-remote-cloudflare-auth.ps1 -TestWhoAmI` reports this explicitly.
Before enabling remote D1 publication, configure a scoped
`CLOUDFLARE_API_TOKEN` (and account ID if required) in the same Windows user
context as the Scheduled Task. Never copy an interactive OAuth file into the
runner or commit a token to Git.

The first scoped-token attempt exposed a second, distinct failure mode. The
token authenticated successfully but belonged to account
`1fe446be160662c15527a4f536e5901a`, whereas the configured production D1 belongs
to `3ebbb03df81b809142eec47c07ef6801`. In that state `wrangler whoami` succeeds
but `wrangler d1 list --json` returns `[]`. Treat a nonempty list containing
`linguago-dictionary` as part of authentication readiness; `whoami` alone is
not sufficient. The release gate stopped before bookmark capture or D1 writes.

`release-remote-dictionary-d1.ps1` is the separate D1 publication gate. It
requires an exact DB hash, refuses to run beside pipeline/database release
locks, regenerates native SQL, and runs the full in-memory import audit. Its
default `-Execute false` never contacts Cloudflare. The first v124 dry-run
produced 24 SQL chunks for 40,793 entries and 47,105 senses, with all blocking
audit counts at zero and `d1_pushed=false`. `-Execute true` additionally
requires a committed database-controller report, successful `wrangler whoami`,
and a captured D1 Time Travel bookmark before it can push SQL. Worker build,
cache bump, deployment, and online regression remain a later, separate gate.

## Local control plane and jump-host release plane

The supported ownership split is:

- Local workstation: edit the Vue/Worker source, review reports, choose a
  production cohort, and issue fixed-purpose control commands.
- Jump host: run the model pipeline, own the writable product DB, promote
  audited drafts, export/push D1, build/deploy the Worker, and run online
  regressions.
- GPU nodes: provide OpenAI-compatible inference only. They do not receive the
  product DB and do not perform promotion or deployment.

Use the local whitelist controller instead of arbitrary SSH commands:

```powershell
npm.cmd run dict:v2:remote-control -- -Action verify
npm.cmd run dict:v2:remote-control -- -Action new-batch -Limit 100
npm.cmd run dict:v2:remote-control -- -Action start -RunId <run-id> -Batch <relative-batch-path>
npm.cmd run dict:v2:remote-control -- -Action status -RunId <run-id>
```

`new-batch` excludes the static attempt history plus the input batch of every
remote run whose manifest status is `complete`, `completed`, or `succeeded`.
This prevents candidates rejected by deterministic evidence or model review
from being selected again, while leaving candidates from interrupted runs
eligible for resume or later selection.

For production source-gap batches, enable the local reverse-evidence prefilter
before any Gemma review:

```powershell
npm.cmd run dict:v2:remote-control -- `
  -Action start `
  -RunId <run-id> `
  -Batch <relative-batch-path> `
  -GenerationTarget 100 `
  -ReverseEvidencePrefilter true `
  -ReverseEvidenceMinTargetLangs 2 `
  -ReverseEvidencePrefilterLimit 500 `
  -SupplementalSourceDb .tmp\combined\openwn-word2word3-ja-apertium-wikidata-v3-evidence.db `
  -EnforceGenerationHintTerms true
```

Measured on 2026-08-21:

- `v125-remote-production500`, without the prefilter: 500 Gemma source
  reviews and 15 final accepted entries.
- `v126-prefilter500`, with the prefilter: 500 local checks, 16 Gemma source
  reviews, and 5 final accepted entries.
- Initial Gemma calls per final accepted entry fell from about `33.3` to `3.2`,
  approximately a 10x efficiency improvement.
- The local prefilter took about 114 seconds for 500 candidates and did not
  write to the product database.
- `v127-prefilter2000` verified the same policy at stress scale. It reduced
  2,000 fresh candidates to 79 model-review candidates in 261 seconds. Gemma
  approved 74, locked reverse evidence supported 38, semantic review accepted
  31, and 20 of 20 generated entries passed final reverse evidence and Gemma
  review. Isolated apply/promotion, idempotent replay, published-risk, and full
  native D1 export/import audits all passed before the guarded main-DB commit.
- The guarded v127 commit added 20 entries and senses. The post-commit product
  counts are `entries=40833`, `senses=47145`, and
  `sense_localizations=188580`; the main DB SHA-256 is
  `F50788101B26F6F57E5220480ABA91A5D7D1FFCD54981902C8382AFCA40F0042`.
  The rollback DB is
  `backups\v127-prefilter2000-main-before-commit-20260821-212659.db`.
- `v128-prefilter5000` expanded the same frozen policy to 5,000 fresh
  candidates. The local prefilter selected 229 in 284 seconds; Gemma approved
  213, locked reverse evidence supported 111, semantic review accepted 85,
  and 82 reached generation. Qwen returned 64 contract-valid entries; all 64
  passed deterministic reverse evidence and 62 passed final no-correction
  Gemma review.
- Isolated apply and promotion inserted all 62 accepted entries and senses
  (`ja=54`, `zh=8`) with 248 localizations. Idempotent replay wrote zero rows,
  published-risk remained zero, and the full native D1 export/in-memory import
  audit passed before commit. The guarded commit then atomically replaced the
  main DB.
- The post-v128 product counts are `entries=40895`, `senses=47207`, and
  `sense_localizations=188828`; the main DB SHA-256 is
  `A60AAD5B7989DB09200CD9D53681CC0F75D2DA60CEE83787D1194AA2DAAC6F39`.
  The rollback DB is
  `backups\v128-prefilter5000-main-before-commit-20260821-214844.db`.
- After excluding all completed-run inputs, `v129-prefilter1884` consumed the
  remaining 1,884 candidates in the v123 authoritative pool (`zh=1022`,
  `ja=819`, `pt-BR=43`). The local prefilter selected 88 in 93 seconds; Gemma
  approved 83, locked reverse evidence supported 44, semantic review accepted
  36, and 20 generated entries passed both deterministic reverse evidence and
  final Gemma review.
- Isolated apply/promotion inserted all 20 entries and senses (`ja=17`,
  `zh=3`) with 80 localizations. Idempotent replay wrote zero rows,
  published-risk remained zero, and full native D1 export/import audit passed.
  The guarded commit produced `entries=40915`, `senses=47227`, and
  `sense_localizations=188908`; the main DB SHA-256 is
  `6DF13A32DF38EC4E6A8B7C67A7F301E6E734BEC12B155835279F8B9AA9EF5611`.
  The rollback DB is
  `backups\v129-prefilter1884-main-before-commit-20260821-215955.db`.
- v125 through v129 added 122 publishable entries in total. The current
  authoritative pool no longer contains 5,000 unattempted candidates, so the
  next production cycle must rebuild or expand the evidence-backed candidate
  pool instead of recycling completed-run inputs.

Keep the prefilter enabled for throughput-oriented production. Disable it only
for an explicit recall audit, because it intentionally rejects candidates that
do not yet have enough independent local dictionary evidence.

Database commit and D1 publication require explicit expected SHA-256 values.
Worker source staging accepts only a clean local Git worktree, creates a
`git archive` for a full 40-character commit, verifies the archive SHA-256 on
the jump host, and expands it into
`D:\linguago-deploy\releases\<commit>`. The jump host therefore deploys an
immutable committed source package rather than an untracked copy of local
files.

```powershell
npm.cmd run dict:v2:remote-control -- -Action stage-worker -Commit HEAD
npm.cmd run dict:v2:remote-control -- -Action worker-dry-run `
  -Commit <full-sha> -ExpectedArchiveSha256 <sha256> `
  -ExpectedCacheVersion <cache-version>
```

`deploy-remote-worker-release.ps1` verifies the staged commit, archive hash,
and `TRANSLATION_CACHE_VERSION`. With `-Execute false` it performs no network
or deployment action. With `-Execute true` it runs `npm ci`, TypeScript check,
build, verifies Cloudflare authentication, records the current production
Worker version, deploys, and runs the general, focused API, and focused render
regressions. A post-deploy regression failure triggers `wrangler rollback` to
the recorded version. It refuses to deploy if no rollback target can be
identified.

The 2026-08-20 rehearsal staged commit
`72194cd3f4fc454fc0fb6fcf9d533ebf2491370a` with archive SHA-256
`05954FDFAE710C8AAD3B4E4C8F398539946BC883E9B38886BE2E99DD4AEE7E08`.
Supplying the worktree cache version was correctly rejected because that
commit contains `v114-production5012-40105`; supplying the committed value
passed with `execute=false` and `deployed=false`. This negative test is
intentional evidence that uncommitted frontend/Worker changes cannot leak into
a remote release.

The v124 formal release used staged commit
`fcd314af03d950bf6555c067ac234b8dbcfb5e5e` and archive SHA-256
`FC1EDB31991B567F7511AF27DFB47BDFC3723E3C3E67DDF0CD729243ED79D6B3`.
The D1 gate captured a Time Travel bookmark, imported all 24 SQL chunks, and
verified the production counts. Worker deployment then published cache
`v124-remote11-40793` as Version ID
`d2ad5c08-4ca8-4c85-8462-ce76d1faeea2`; general API, focused API, and focused
mobile/desktop render checks passed. The final Worker report is
`D:\linguago-deploy\last-worker-release.json`.

Use a scoped `CLOUDFLARE_API_TOKEN` from production account
`3ebbb03df81b809142eec47c07ef6801a`, keep
`NODE_OPTIONS=--dns-result-order=ipv4first`, and require D1 UUID
`ee613260-5c1f-4bb5-8959-c54118174e0e` to be visible before any write. A token
for another account can make `wrangler whoami` succeed while `d1 list` is empty.
Do not store tokens in Git, runner manifests, command lines, or logs.
