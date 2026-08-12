# Dictionary v83 Large-Batch Runbook

## v90 500-row qualification result (2026-08-10)

The isolated 500-row gate passed end to end. Generation produced 482 valid
drafts with zero endpoint failures. All 482 passed deterministic four-language
reverse evidence. Independent Gemma review plus one bounded structured
correction cycle yielded 407 safely promotable rows (`81.4%`). Fast audit,
published-risk audit, native export, and in-memory import all passed. Never use
the 407-row validation database or export as a production release; v90 remains
the deployed baseline.

Checkpoint audits must be scoped to the checkpoint's recorded
`product_sense_id` values. Historical draft totals and historical duplicate
source links are diagnostics, not failures of the current run. Use
`scripts/audit-dictionary-v2-product-scale-checkpoint.mjs` to verify candidate,
sense, localization, and source-link cardinality.

When a reviewed candidate report contains multilingual hint lists, do not let
that list replace a generated single-sense `gloss_key`. The promoter keeps the
narrow draft gloss when the report gloss is broad. This is not a broad-gloss
waiver: a broad draft gloss still fails promotion.

The remaining 2,000-row gate is evidence-supply limited. The strict aligned
pool contains 646 rows, and 502 were already consumed by the fixed 500 cohort.
OpenHowNet dual-model selection added useful MIT-backed Chinese target evidence
but did not increase the 646 source-qualified rows. Obtain another independent
source family for pt-BR/ja source senses, or improve exact source-sense
rebinding, before running another large generation batch. Do not lower source
family, reverse-evidence, or consensus thresholds to reach a target count.

## 2026-08-08 low-ambiguity selector follow-up

The follow-up selector bounded every target language to at most two hints and
all target hints to six. This improved Qwen generation validity to 17/18 and
deterministic support to 17/17, but final Gemma consensus plus safe retry
retained only 15/20 (`75%`). The 500-row stage remains blocked.

When strict source review is enabled, an `accept` is invalid unless all four
preferred terms can be copied exactly from evidence-bound hints. A model result
with null preferred terms must be retried or rejected; it must not inflate the
source-review acceptance rate.

Hint count alone does not detect:

- adjective/noun role changes such as `arábico`;
- procedure/disease scope changes such as `apendicectomia`;
- temporary suspension versus cancellation for `pendência`;
- colloquial or dialectal target terms such as `けったい`;
- definitions that are correct translations but too thin for publication.

The next selector should add deterministic part-of-speech compatibility and
concept-domain/scope checks before source review. Do not lower the 80% final
yield threshold and do not replay the 15 verified rows into the product DB as
proof that the lane is ready for scale.

## 2026-08-08 v90 OMW-priority qualification

The strict OMW-priority path reached 19/20 source-review acceptance and 19/19
generation validation after definition-contract sanitization. Do not pass a
source-review definition contract directly to another locale: English
placeholders in `zh`, `ja`, and `pt-BR` caused valid localized output to fail
the strict language validator. Preserve reviewed terms, but generate localized
definitions when the contract is not demonstrably in the target language.

Post-generation reverse validation must use all English labels from the same
aligned sense, stored as `source_meaning_anchors`. A single primary label causes
false conflicts for ordinary dictionary synonyms. These anchors must come from
the aligned source sense or reviewed generation hints; do not add model-invented
synonyms as publication evidence.

The resulting 19/19 deterministic-supported rows received independent Gemma 4
31B review. Nine passed without correction. Structured correction retry
recovered five more, for 14/19 final (`73.7%`). Because this is below the 80%
promotion-rate gate, the batch remains dry-run only. No product DB, D1, or
Worker write occurred. Keep `duplicação`, `agrário`, `legislar`, `olaria`, and
`ポインター` in manual residual review.

Structured retries must reject:

- replacement equal to the current value (`no_op_replacement`);
- semicolon, `or`, slash, or multi-option replacements (`ambiguous_replacement`);
- whole-sense or `all`-language corrections without a safe field replacement;
- a corrected term that still fails JMdict/CC-CEDICT/reverse evidence.

Observed infrastructure note: 11448 produced one upstream HTTP 500, while
11444 and 11447 completed the stable rerun with zero failures. Retry/reassign
the task; do not reinterpret that error as a data-quality rejection.

This is the operational handoff for the current four-language source-gap work.
Read it before running Unsloth generation, changing the product database, or
publishing Cloudflare D1.

## 1. Current State

Production and the final audited local database now match:

| State                    |        Version | Entries | Senses | Sense localizations | Published? |
| ------------------------ | -------------: | ------: | -----: | ------------------: | ---------- |
| Cloudflare D1            | v86 controlled consensus | 29,669 | 35,193 | 140,772 | Yes |
| Local audited product DB | v86 controlled consensus | 29,669 | 35,193 | 140,772 | Yes |

Production details:

- Worker cache: `v86d-sequential-form-lookup-29669`
- Worker version: `35880184-2258-44af-97e6-b00c08c7e2bf`
- D1 `published_at`: `2026-08-06T08:33:52.889Z`
- Pre-release DB backup: `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v86-controlled13-20260806-171547.db`
- Backup SHA256: `44E26C50A9470B265C24A0B8F0F80EB155F0CAE531E123E2339744D603F7A63A`
- Audited v84 rollback package: `backups/v84-rollback-native-before-v85-20260806-151653`

Latest local audit:

- Export: `outputs/d1-v2-product-native-export-v86-controlled13`
- `flagged_senses=0`
- `bad_sense_localization_counts=0`
- `duplicate_sense_orders=0`
- All orphan, mojibake, and HTML artifact counts are zero
- `duplicate_sense_localizations=108` remains a known non-blocking warning

The counts above are confirmed online through `/health`, full API regression,
focused API checks, and mobile/desktop render checks.

## 2. Important Files

Main product database:

```text
data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db
```

Latest pre-batch backup:

```text
data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-tier-b-100-20260713-205636.db
```

Current Tier B candidate report and 100-row checkpoint:

```text
logs/product-coverage-gaps-v83-tier-b-next-500.json
logs/product-source-gap-v83-tier-b-production-100.checkpoint.json
logs/product-source-gap-v83-tier-b-production-100.json
logs/product-source-gap-v83-tier-b-production-100-promote-applied.json
```

Core scripts:

```text
scripts/find-dictionary-v2-product-coverage-gaps.mjs
scripts/filter-dictionary-v2-product-coverage-gap-report.mjs
scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs
scripts/promote-dictionary-v2-product-source-gap-drafts.mjs
scripts/review-dictionary-v2-product-source-gap-rejections-unsloth.mjs
scripts/reconcile-dictionary-v2-product-source-gap-checkpoint.mjs
scripts/source-gap-large-batch-check.mjs
```

Reverse-evidence prefilter and validation automatically use
`.tmp/combined/openwn-word2word3-ja-apertium-wikidata-v3-evidence.db` when that
generated database exists. It adds Open WordNet, Word2Word, Apertium, and
Wikidata evidence without treating WikDict and Kaikki as independent families.
Pass `--supplemental-source-db none` only for a deliberate baseline comparison;
otherwise omitting the combined evidence can materially undercount Portuguese
and Chinese support.

Candidate-review resume treats both valid and exhausted invalid rows as
completed. Use `--retry-invalid-on-resume true` only for a bounded recovery run
after changing the endpoint, prompt, model, or response parser. This prevents a
normal interruption from repeatedly spending tokens on the same terminal
definition-contract failure.

`logs/`, `outputs/`, checkpoints, exports, and local databases are runtime
artifacts. Do not commit them. Commit scripts, package commands, and documents.

## 3. Validated Runtime Profile

Only these two nodes were available for the latest validation:

| Node       | Endpoint                    | Model variant | Role                                   |
| ---------- | --------------------------- | ------------- | -------------------------------------- |
| A6000-143  | `http://100.99.99.99:11441` | `UD-Q4_K_XL`  | quality/stable worker                  |
| RTX4090-56 | `http://100.99.99.99:11447` | `UD-IQ4_NL`   | faster worker with lower VRAM headroom |

Both run:

```text
unsloth/Qwen3.6-35B-A3B-MTP-GGUF
```

Both Unsloth-managed llama.cpp installations were updated through the official
`POST /api/llama/update` endpoint from b9940 to b9975. The latest test profile
is:

- one worker per endpoint
- `batch-size=1`
- `chunk-size=50` for real draft writes
- context length 1024
- speculative decoding off
- `temperature=0`
- micro prompt
- max output tokens 400
- one-second endpoint cooldown
- two attempts per candidate
- circuit opens after two consecutive infrastructure failures
- circuit reset interval 15 seconds in current validation commands

Load the API key from `.dev.vars` or the process environment. Never put the key
in commands stored in documents, logs, source code, or Git.

## 4. Correct Execution Sequence

### 4.1 Preflight

1. Verify no previous source-gap runner is still active.
2. Query `/v1/status` on both endpoints.
3. Confirm the expected llama.cpp build and model state.
4. Run `npm run check:source-gap-large-batch` before a real batch.
5. Back up the product DB.

If `/v1/status` responds but `active_model=null`, Studio is online but its
inference process is not loaded. This is not the same as a dead endpoint.

### 4.2 Build a clean candidate pool

Use strict Tier B evidence before Tier C:

- at least three clean entry-level languages
- at least two clean first-sense languages
- no known residual, mojibake, HTML artifact, acronym, proper name, or thin gloss
- exclude all prior checkpoint/report source IDs

The filter supports JSON exclusion files:

```powershell
node scripts/filter-dictionary-v2-product-coverage-gap-report.mjs `
  --in logs/product-coverage-gaps-v83-tier-b-5000.json `
  --out logs/product-coverage-gaps-v83-tier-b-next-500.json `
  --limit 500 `
  --balanced true `
  --fill-remaining true `
  --lang-targets pt-BR=350,ja=150 `
  --min-clean-langs 3 `
  --min-first-sense-langs 2 `
  --strict-zh true `
  --block-known-residuals true `
  --exclude-source-entry-id-files logs/product-source-gap-v83-production-500.checkpoint.json,logs/product-source-gap-v83-pressure-2000.checkpoint.json
```

The latest strict pool has 500 rows: 350 pt-BR and 150 ja. Strict evidence did
not produce enough zh/en rows, so the pipeline correctly did not fill those
quotas with weak candidates.

### 4.3 Dry-run before writing

Run 10-20 new rows with `--dry-run true --apply false`. Do not reuse exactly the
same rows when measuring general quality; exclude prior dry-run JSON with
`--exclude-source-entry-id-files`.

Dry-runs now retain complete generated rows by default so the independent
reverse-evidence validator can inspect the generated target terms. Passing
`--log-generated false` is only appropriate for performance-only tests and
makes the resulting report ineligible for reverse-evidence validation.

Required checks:

- infrastructure failure rate at most 2%
- no repeated `fetch failed`, `ECONNRESET`, or unloaded-model state
- no systematic JSON truncation
- evidence rejection reasons are factually sensible
- deterministic validation errors are understood before expanding

### 4.4 Write draft only

Real generation must use:

```text
--publishable false
--apply true
--checkpoint <unique checkpoint path>
--chunk-size 50
```

The LLM may only write `draft_single_source` / `needs_review`. It must never
write directly to the publishable product set.

The latest 100-row run produced:

- generated: 100
- accepted drafts: 81
- evidence rejects: 9
- validation rejects: 9
- infrastructure rejects: 1
- 143 request failures: 2
- 56 request failures: 5

Raw acceptance was 81%, below the planned 90% expansion gate. Do not start the
next 500-row run yet.

The 2026-07-14 follow-up filtered broad glosses before generation and tested a
fresh strict pool. The second 20-row dry-run accepted 18/20 with zero
infrastructure failures. The following real batch selected 99 new rows, wrote
85 drafts, and rejected 14 (`10` evidence, `4` validation). Deterministic
promotion accepted 78/85 and kept seven English-term semantic mismatches in
draft. Raw generation acceptance was still only 85.9%, so the 500-row gate
remains closed.

### 4.5 Promote through deterministic validation

Always run checkpoint-scoped dry-run first:

```powershell
node scripts/promote-dictionary-v2-product-source-gap-drafts.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --checkpoint logs/product-source-gap-v83-tier-b-production-100.checkpoint.json `
  --out logs/product-source-gap-v83-tier-b-production-100-promote-dry-run.json `
  --limit 200 `
  --apply false
```

The latest result accepted 78/81 drafts (96.3%). Three semantic-drift rows stayed
in draft. Applied promotion added 78 publishable senses and 312 localizations.

Semantic review overrides are intentionally narrow:

- only `accept_synonym`
- confidence at least 0.95 for the v83 semantic pass
- no risk flags
- candidate still belongs to the current report/checkpoint
- may override token-level English term/gloss mismatch only
- must never override a broad gloss requiring sense splitting

### 4.6 Audit and export

Run all of these after promotion:

```powershell
npm run check
npm run check:source-gap-large-batch
npm run dict:v2:audit:product-fast
npm run dict:v2:audit:product-published-risk
node scripts/export-dictionary-v2-product-native-d1-sql.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --out-dir outputs/d1-v2-product-native-export-v83-tier-b-100
node scripts/audit-dictionary-v2-product-export.mjs `
  --mode full `
  --import memory `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --out-dir outputs/d1-v2-product-native-export-v83-tier-b-100
```

The full audit requires `manifest.json`; export first. Running full audit against
an empty output directory fails with `Missing product D1 export manifest`.

## 5. Correct Lessons

### Candidate quality matters more than raw model speed

The Tier C 2,000-row pressure pool was dominated by weak pt-BR/ja evidence. It
generated 1,405 valid drafts (70.25%) and promoted 1,199. The model was correctly
rejecting many bad source mappings. Scaling a weak pool only creates more draft
review work.

Use Tier B first and treat evidence rejects as source-dictionary cleanup signals.
Do not remove the evidence gate merely to increase the acceptance percentage.

### Short prompts are required through the relay

Long schema prompts caused first-token delays and connection resets. The micro
prompt returns in roughly 1-3 seconds when healthy and is normalized into the
full product schema locally.

### Retry only known repairable failures

The runner retries micro-format validation failures. It also retries a false
evidence verdict when the model's own reason explicitly says the mapping is
valid, for example `objetiva -> lens`. The second prompt tells the model to set
`v=true` and populate all arrays.

For `en_term_copies_non_english_source`, the retry asks for the full English
meaning, not the copied source spelling. This fixed cases such as a source term
`cocktail` whose evidence meant `cocktail party`.

### Draft and publishable data must remain separate

Generation can be noisy while production stays clean. The current published-risk
audit remained zero throughout because draft rows never leaked into export.

## 6. Failed Approaches and Why

### Blind 5,000-row expansion

Do not proceed from a successful structural audit alone. The 2,000-row pressure
run had 70.25% generation acceptance and 5.5% infrastructure rejects. Full audit
only proved that promoted rows were safe; it did not prove the generation system
was efficient enough for 5,000 rows.

### Permanently open circuit breakers

The first circuit breaker never recovered after two failures. Once both circuits
opened, 105 later rows became `all_endpoints_unavailable` without a real request.
The scheduler now supports timed half-open recovery and one bounded task recovery
cycle. Keep the bound; unlimited recovery would loop forever on a dead node.

### Additive resume limits

The old `--resume --limit 2000` selected 2,000 additional rows rather than filling
the remaining portion of a 2,000-row target. Resume now uses:

```text
remaining = limit - checkpoint_completed
```

The integration fixture contains more candidates than the limit so this bug is
caught by regression tests.

### Assuming parent termination stops Node on Windows

Terminating the PowerShell/tool parent did not stop its child Node process. The
orphan continued writing drafts and produced 176 rows not represented by the
final checkpoint. Always inspect running Node command lines after an interrupted
batch.

Use `reconcile-dictionary-v2-product-source-gap-checkpoint.mjs` with the pre-run
baseline, report, and checkpoint before deleting anything. It is designed to
remove only newly created, single-sense draft entries absent from the final
checkpoint. Never delete rows using a broad timestamp or status query.

### Treating every connection reset as a server defect

Before the client network changed, both 143 and 56 repeatedly returned
`ECONNRESET`, their model processes disappeared, and short batches took several
minutes. SSH and the dashboard were also unreachable while direct forwarded HTTP
status still worked. After the user changed networks, consecutive short tests
had zero infrastructure failures.

The nodes were updated from b9940 to b9975 during diagnosis, but the evidence does
not prove the binary update alone fixed the resets. Record both facts and test
the current network before restarting or replacing server software.

### Trusting stale `active_model` state

Studio can remain reachable after its llama.cpp child exits. Query `/v1/status`:

- response plus `active_model=null`: Studio alive, model unloaded/exited
- no response: endpoint/relay/service connectivity problem
- active model present but requests fail: test one isolated request and inspect
  server logs before scaling

### Q4 XL on a 24 GB RTX 4090

`UD-Q4_K_XL` leaves too little VRAM headroom on 4090-56 and can trigger CPU
offload or instability. Use `UD-IQ4_NL` on 56. Keep Q4 XL on 48 GB A6000 nodes.

### Using 27B as the automatic 4090 fallback

The tested 27B MTP Q4 path was slower for this prompt and still had a socket
reset. It did not improve production reliability, so it is not the default
fallback.

### Allowing semantic review to bypass broad gloss checks

An early semantic override accidentally promoted broad glosses and raised
`flagged_senses` to 9. The DB was restored from the exact pre-promote backup and
the rule was narrowed. Broad glosses must be split, not synonym-approved.

### Treating PowerShell display corruption as source corruption

PowerShell `ConvertFrom-Json` and terminal output previously displayed UTF-8 data
as mojibake. Validate suspicious rows with Node reading UTF-8 and inspect code
points before changing source data. Some rows are genuinely corrupt; display
corruption and stored corruption require different fixes.

## 7. Interruption and Recovery

After any aborted or timed-out run:

1. Check for an active source-gap Node process.
2. Do not start another runner against the same DB/checkpoint while one exists.
3. Inspect checkpoint `summary.completed`, last successful commit time, and DB
   source links.
4. Resume with the same report, DB, model, endpoints, and checkpoint signature.
5. If concurrent/orphan writes are suspected, run checkpoint reconciliation in
   dry-run mode against the exact pre-run DB backup.
6. Apply reconciliation only after its candidate list is manually plausible.
7. Run fast and published-risk audits immediately afterward.

If `flagged_senses` rises above zero after promotion, stop. Restore the exact
pre-promote backup, narrow the promotion rule, and rerun audits. Do not repair a
large accidental promotion row by row.

## 8. Expansion Gates

Do not start the next 500-row draft run until a new 100-row strict-pool validation
meets all of these:

- raw generation accepted at least 90%
- deterministic promotion accepted at least 80% of generated drafts
- infrastructure failure rate at most 2%
- JSON parse failure rate at most 2%
- `flagged_senses=0`
- no review-localization leakage
- no orphan rows, duplicate sense order, mojibake, or HTML artifact

The 2026-07-15 validation passed every expansion gate: a fresh 20-row dry-run
accepted 20/20, the following real batch accepted 97/99 (98.0%), deterministic
promotion accepted 93/97 (95.9%), infrastructure and JSON failures were zero,
and `flagged_senses=0`. A 500-row draft pressure batch is now allowed. Do not
weaken source-evidence or publishable-data checks in later batches.

## 9. Publishing Rules

Do not publish v83 yet. After a future batch meets the gates:

1. Create a fresh remote D1 backup.
2. Export and full-audit the exact local DB to be published.
3. Push native SQL to D1.
4. Bump Worker cache version.
5. Deploy Worker.
6. Confirm `/health` counts exactly equal the manifest.
7. Run online dictionary, focused API, and focused render checks.
8. Spot-check `中`, `杆`, `你好`, `inside`, `秘密`, `何時`, `国際`, and
   `ビジター`, plus words from the new batch.

Never mix generation, promotion, D1 import, and Worker deployment into one
unobserved command.

## 10. 2026-07-14 Follow-up and New Recovery Rules

The 2026-07-14 local-only export was:

- entries: `26718`
- senses: `32235`
- sense localizations: `128940`
- examples: `3030`
- example localizations: `11898`
- `flagged_senses=0`

The full in-memory audit passed at
`outputs/d1-v2-product-native-export-v83-tier-b-fresh-100`. No part of this
local v83 export has been pushed to D1.

New verified behavior:

- Exhausted JSON parse/content errors are validation failures, not
  infrastructure failures. They must not increment endpoint failure counters or
  open a circuit.
- With multiple endpoints, a batch that still has malformed JSON after its
  same-node attempts is rerouted once to another endpoint. The reroute does not
  mark the original endpoint unhealthy.
- A transport-level `fetch failed` is not a model-load error. It must return to
  the scheduler for endpoint rerouting instead of calling the potentially
  300-second load API. Only explicit `No model loaded` / `Call POST ... load`
  responses trigger model loading.
- The integration test now covers malformed-JSON classification and
  cross-endpoint format recovery in addition to circuit recovery, checkpoint
  resume, and duplicate prevention.
- Japanese-reading retries explicitly require hiragana/katakana and reject
  romaji. Chinese-reading retries explicitly require pinyin.
- Candidate filtering removes glosses with five or more semicolon-separated
  meanings before LLM use. This removed 131 broad candidates from the latest
  scanned pool.
- Evidence verification now states that a genuine secondary/contextual sense is
  valid. A model must not reject a mapping merely because it is non-primary,
  ambiguous, or expressed by a close synonym.

Observed failure classes from the latest 99-row batch:

- true or plausible source mismatches: `toro/tree ring`, `pique/pike`,
  `sobrado/loft`, `めんどう/delicate`, and similar rows
- over-conservative evidence rejects: established secondary senses such as
  `brigadeiro/brigadier`, `prataria/silverware`, and `よこしま/evil`
- malformed JSON occurred only on 4090-56 in this batch; it is now eligible for
  one cross-node recovery on A6000-143
- seven promoted-draft candidates failed strict English term/gloss matching and
  correctly remained draft; do not globally relax that validator

The first attempted full audit against the new output directory failed with
`Missing product D1 export manifest`. This is expected when export has not run.
Always execute `export-dictionary-v2-product-native-d1-sql.mjs` before the full
audit.

A later real-network 20-row dry-run did not complete within the 15-minute tool
limit and left its child Node process running. The process was identified by its
start time and stopped; the run was dry-only and produced no DB writes. Review
showed that `fetch failed` was incorrectly routed through model loading, which
could combine the 180-second request timeout with a 300-second load timeout and
another request attempt. This classification was corrected. Do not rerun a
production batch until a short live smoke test confirms bounded failure time;
current execution quota prevented that final network recheck in this session.

## 11. 2026-07-15 Network Recheck and Passed Gate

After the user changed networks, a new smoke run completed normally in about 30
seconds with zero infrastructure and format failures. It initially accepted 7/9
because the model falsely rejected `charrete` and conservatively rejected the
questionable OMW row `afete`.

The micro prompt now includes compact first-sense source evidence such as
`lang:term@source`, rather than asking the model to judge a bare word/gloss from
memory. It also detects a rejection reason that calls the source word a
misspelling of exactly the same spelling. The repeated smoke run then accepted
9/9 in about 14 seconds. A separate fresh 20-row dry-run accepted 20/20.

The checkpointed 100-row production validation then produced:

- selected/generated: `99` (`1` existing source gap skipped)
- accepted drafts: `97` (`98.0%`)
- evidence rejects: `2`
- infrastructure rejects: `0`
- validation/JSON rejects: `0`
- 143 calls/failures: `45/0`
- 56 calls/failures: `54/0`
- deterministic promote: `93/97` (`95.9%`)
- semantic-drift drafts retained: `4`

The pre-run backup is
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence-fix-100-20260715-125428.db`.

The latest local-only full export passed at
`outputs/d1-v2-product-native-export-v83-evidence-fix-100`:

- entries: `26811`
- entry forms: `184055`
- pronunciation groups: `28636`
- senses: `32328`
- sense localizations: `129312`
- examples: `3030`
- example localizations: `11898`
- `flagged_senses=0`

All blocking audit fields remain zero. The existing
`duplicate_sense_localizations=98` remains a non-blocking warning. Nothing from
v83 has been pushed to D1.

## 12. 2026-07-15 Passed 500-Row Pressure Gate

The checkpointed pressure batch used the same evidence-aware prompt and the
143/56 endpoints. It selected 500 clean Tier B rows; two were already present,
so 498 required generation:

- accepted drafts: `472/498` (`94.8%`)
- evidence rejects: `13`
- validation rejects: `13`
- infrastructure rejects: `0`
- JSON parse rejects: `0`
- committed chunks: `10`
- 143 calls/failures: `222/0`
- 56 calls/failures: `277/0`
- deterministic promote: `449/472` (`95.1%`)
- semantic-drift drafts retained: `23`

The generation rejects were useful quality filtering rather than scheduler
failure. Evidence rejects were mostly questionable or polysemous source rows
such as `reorganizar/rally`, `bane/trivia`, `regata/muscle shirt`, and
`こて/hawk`. Validation rejects were mainly invalid zh/ja term scripts, missing
Japanese readings, thin definitions, or an English term copied from the
non-English source. The 23 promote rejects were conservative English
term/gloss mismatches; they remain drafts and must not be published by relaxing
the validator globally.

The pre-run backup is
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence-fix-500-20260715-130548.db`.

The exact local-only export passed a full in-memory import audit at
`outputs/d1-v2-product-native-export-v83-evidence-fix-500`:

- entries: `27260`
- entry forms: `186749`
- pronunciation groups: `29085`
- senses: `32777`
- sense localizations: `131108`
- examples: `3030`
- example localizations: `11898`
- `flagged_senses=0`

All blocking fields are zero: localization counts, duplicate sense orders,
orphans, invalid required values, script mismatches, mojibake, and HTML
artifacts. The existing `duplicate_sense_localizations=98` warning is unchanged
and non-blocking.

The 500-row pressure gate is passed. Do not immediately request 2,000 rows from
the old strict Tier B report: the report contained only about 1,039 eligible
rows before this batch, leaving roughly 539. Regenerate coverage gaps against
the latest product DB and all current WikDict/OMW/ECDICT/CC-CEDICT/JMdict/
FreeDict evidence, then measure the new strict pool. If the rebuilt pool has at
least 2,000 clean candidates, run the checkpointed 2,000-row gate. Otherwise,
finish the remaining strict pool as another approximately 500-row batch before
expanding candidate tiers. Nothing from v83 has been pushed to D1.

## 13. 2026-07-15 Rebuilt Pool and Second 500-Row Batch

After the first pressure gate, coverage gaps were regenerated against the latest
product DB with `max-rank=200000` and a 50,000-row raw limit. Strict Tier B
filtering, including all previous v83 checkpoint exclusions, produced only 819
eligible candidates:

- pt-BR: `747`
- ja: `67`
- zh: `5`
- en: `0`

This confirms that the strict pool is not large enough for a meaningful 2,000-
row run. A balanced 20-row smoke set was used first. The initial in-sandbox
attempt returned immediate `EACCES connect` for both endpoints; this was a local
execution-sandbox network restriction, not a relay or Studio failure. The same
command outside the sandbox connected successfully.

The live smoke initially accepted 17/19. One rejection, `他娘/deuce`, was a
correct evidence rejection. The other valid row returned Japanese term
`アンクレット` with romaji reading `ankuretto`. The runner now applies one
safe deterministic normalization: when the Japanese term consists entirely of
kana and the reading is missing or non-kana, the term itself becomes the kana
reading. It does not transliterate kanji or relax the normal reading validator.
The repeated smoke accepted 18/19 (`94.7%`) with zero infrastructure, JSON, or
validation failures.

The next checkpointed 500-row report contained 428 pt-BR, 67 ja, and 5 zh rows.
Four were already linked, so 496 required generation:

- accepted drafts: `460/496` (`92.7%`)
- evidence rejects: `31`
- validation rejects: `5`
- infrastructure rejects: `0`
- committed chunks: `10`
- 143 calls/failures: `145/2`
- 56 calls/failures: `354/0`
- deterministic promote: `443/460` (`96.3%`)
- retained drafts: `17`

The two 143 transport failures were transient socket close/reset events. The
scheduler rerouted work and no candidate ended as an infrastructure rejection.
Evidence rejections were mainly questionable WikDict/OMW mappings such as
`festim/blank`, `standard/broadsheet`, `estrelinha/cartwheel`, and
`efetuar/attain`. The five validation rejects were language-script, thin-
definition, or copied-English-term failures. Promote retained 16 conservative
English term/gloss mismatches and one row missing both English and Portuguese
pronunciations.

The pre-run backup is
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-post-500-production-500-20260715-133714.db`.

The exact local-only export passed full in-memory audit at
`outputs/d1-v2-product-native-export-v83-post-500-production-500`:

- entries: `27703`
- entry forms: `189410`
- pronunciation groups: `29528`
- senses: `33220`
- sense localizations: `132880`
- examples: `3030`
- example localizations: `11898`
- `flagged_senses=0`

All export blockers are zero and the non-blocking duplicate-localization warning
remains `98`. The rebuilt strict pool now has about 319 candidates that were not
in this 500-row selection. The next safe step is to process that remainder as a
final strict-pool batch, then regenerate coverage and design a reviewed Tier C
gate. Do not label the next stage as a 2,000-row Tier B test. Nothing from v83
has been pushed to D1.

## 14. 2026-07-15 Complete Tier B Inventory

The apparent 319-row remainder was processed first. Its report contained 323
rows, four of which were already linked, so 319 required generation:

- accepted drafts: `302/319` (`94.7%`)
- evidence rejects: `12`
- validation rejects: `5`
- infrastructure rejects: `0`
- deterministic promote: `294/302` (`97.4%`)

The pre-run backup is
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-tier-b-final-remainder-20260715-150601.db`.
The full export at `outputs/d1-v2-product-native-export-v83-tier-b-final`
passed with 27,997 entries, 33,514 senses, and 134,056 localizations.

A new coverage run exposed an inventory mistake: a raw report limited to 50,000
rows is a moving frequency window, not the complete gap pool. Once represented
rows disappear, lower-ranked candidates enter the next report. Raising the raw
limit to 100,000 covered all 73,436 current gaps through rank 200,000.

After historical checkpoint exclusions, 1,281 rows still passed the old rule of
three entry-level languages but only two first-sense languages: 993 pt-BR, 237
ja, 46 zh, and 5 en. A lower-rank smoke accepted only 13/16 (`81.3%`). All three
rejects were correct source-evidence rejections: `banimento/ablegation`,
`红梅/apricot`, and `良子/excellent`. Infrastructure, JSON, and field validation
failures were zero.

Raising `--min-first-sense-langs` from 2 to 3 produced a 192-row high-confidence
subpool: 109 ja, 69 pt-BR, and 14 zh. A fresh smoke accepted 16/16. The production
run generated 185 rows after seven existing links were skipped:

- accepted drafts: `173/185` (`93.5%`)
- evidence rejects: `6`
- validation rejects: `6`
- infrastructure rejects: `0`
- deterministic promote: `159/173` (`91.9%`)
- semantic-drift drafts retained: `14`

The pre-run backup is
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-first-sense-3lang-20260715-152424.db`.
The final local-only full export passed at
`outputs/d1-v2-product-native-export-v83-first-sense-3lang`:

- entries: `28156`
- entry forms: `192142`
- pronunciation groups: `29981`
- senses: `33673`
- sense localizations: `134692`
- examples: `3030`
- example localizations: `11898`
- `flagged_senses=0`

All blockers remain zero and `duplicate_sense_localizations=98` remains the
same non-blocking warning. Freeze the remaining approximately 1,089 two-language
first-sense candidates. They require a source-evidence review or cross-source
agreement stage before another production batch. Nothing from v83 has been
pushed to D1.

## 15. Two-Language Evidence Pre-Review

The post-three-language inventory was regenerated against the latest local DB
and filtered with both `--min-first-sense-langs 2` and
`--max-first-sense-langs 2`. This initially produced 1,087 candidates rather than
mixing already-tested three-language rows back into the pool: pt-BR `922`, ja
`128`, zh `32`, and en `5`.

`review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` is a read-only
pre-generation evidence gate. It writes a review report and a supplement-
compatible approved report, but never writes the product DB. The script checks
`/v1/status` and loads unloaded models through `/v1/load`. Default variants are
`UD-Q4_K_XL` on port 11441 and `UD-IQ4_NL` on port 11447; loading the A6000
quantization on the 24 GB 4090 can cause CPU offload.

The first control attempt failed all 20 rows with `No model loaded`. That was a
missing prewarm implementation, not a model-quality failure. After prewarm was
added, the first prompt incorrectly rejected `苹果树 -> macieira` because it
treated a Portuguese translation as if it had to be a Chinese definition. The
prompt now explicitly accepts translations and transliterations in any target
language. On the repeated control set it matched all 16 previously labelled
generation outcomes: 13 genuine rows accepted and the three known mismatches
(`banimento/ablegation`, `红梅/apricot`, and `良子/excellent`) rejected. All 20
responses were valid JSON with no endpoint failure.

The first balanced 20-row report was reviewed after explicit approval. It
returned 20/20 valid JSON responses, approved 16, and rejected four with no
endpoint failure. However, 14 rows overlapped the earlier control smoke because
dry-run reports were not part of the production-checkpoint exclusion list. Only
six rows were genuinely new; five were approved and `幽怪/appearance` was
correctly rejected. Do not report this as a fresh 16/20 acceptance result.

The replacement report
`logs/product-coverage-gaps-v83-two-lang-evidence-fresh-20.json` excludes both
earlier smoke reports and contains 20 previously unreviewed rows with the same
language balance. Its review completed with 20/20 valid responses, 14 approvals,
six rejects, and zero endpoint failures. By source language, pt-BR passed 7/7,
ja passed 6/7, zh passed 0/5, and the single English row was semantically valid
but was the proper name `Düsseldorf`.

The proper-name filter previously used ASCII-only case ranges, so accented
capitalized names escaped it. It now uses Unicode `Lu`/`Ll` classes. Rebuilding
the complete pool removes three additional names and leaves 1,084 candidates.
Re-filtering the 14 approvals removes `Düsseldorf`, leaving 13 pt-BR/ja rows at
`logs/product-source-gap-v83-two-lang-evidence-fresh-20-approved-clean.json`.
No DB write occurred. Run those 13 rows through the normal supplement in dry-run
mode next. Do not apply or promote the complete pool based only on evidence
review.

## 16. Reviewed Two-Language Generation Pilot

The 13 evidence-approved pt-BR/ja rows were run through the complete four-
language generator without DB writes. The first run reported 13/13 structurally
valid, but manual inspection found four Japanese-source failures that the old
validator did not detect: `ゆき` drifted to the snow homograph and copied its
Japanese reading into EN/PT; `おもう` and `はたして` copied Japanese reading into
EN/PT IPA; and `がつがつ` used the unrelated English term `that is to say`.

Generation validation now rejects a non-English source whose English term has
no content-token overlap with the source English gloss. For zh/ja sources, it
also rejects identical EN/PT pronunciations when the translated terms differ.
Micro retries receive explicit repair instructions. Pure-kana Japanese source
headwords now deterministically use the exact headword as their kana reading.

The corrected run accepted 12/13 (`92.3%`) with no endpoint failure. It repaired
`おもう`, `はたして`, and `がつがつ`; `ゆき` remained rejected because the model
returned empty EN/PT IPA after two attempts. `quinzena` was also removed from
the apply set because Portuguese `quinzena` is 15 days while English `fortnight`
is normally 14 days, making the localized definitions inconsistent.

The remaining 11 rows were written as draft and passed checkpoint-scoped
deterministic promote 11/11. Backup:
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-two-lang-evidence-11-20260715-163351.db`.
Fast audit, published-risk audit, and full in-memory D1 export audit passed. The
local-only export at `outputs/d1-v2-product-native-export-v83-two-lang-evidence-11`
contains 28,167 entries, 33,684 senses, 134,736 sense localizations, and zero
blocking findings. Nothing from v83 has been pushed to D1.

## 17. Two-Language Quality Gate and Deterministic Replay

The next 100-row evidence review approved 78 rows on the first pass. A second
review recovered one more row, and six lexicographer-verified homograph or
figurative senses were added as `manual_evidence_override`, producing 85
generation candidates. The merge helper is
`scripts/merge-dictionary-v2-product-coverage-gap-reports.mjs`. When a merged
report is filtered again, it must preserve existing manual provenance.

A structural generation run accepted 75/85 but manual inspection found wrong
Japanese readings such as `湿布 -> しつぷ`, `色素 -> しょそく`, and
`際立つ -> きだつ`. Structural JSON completeness is therefore not a production
quality gate. The supplement runner now builds a 226,730-term reading index from
`data/raw/JMdict_e.gz` in under about one second and validates Japanese readings
before acceptance. Chinese lexical readings use `pinyin-pro` with
`toneSandhi:false`; the default sandhi mode incorrectly treated lexical
`不定 -> bù dìng` as `bú dìng`.

Generated records also pass an LLM quality review. The source meaning is anchored
to the first English source-dictionary term rather than a broad semicolon gloss,
which prevents mixing senses such as `つゆ: broth; moisture; dipping sauce`.
The English term or its English definition must retain a content token from that
anchor. This permits descriptive or transliterated terms such as `wounded
soldier`, `kamado`, and `karuta`, while rejecting a switch from `abyss` to
`edge`.

The final strict dry-run accepted 66/85 with zero endpoint failures. Because
77.6% is below the 90% expansion gate, these rows were not applied to the main
product DB. Manual overrides such as `ふち=abyss` and `ごろごろ=purr` remain
manual residuals when the model still disputes the exact kana sense.

Use `--replay-report <dry-run-report>` to revalidate and write exact accepted
outputs instead of regenerating them during `apply=true`. A replay test on an
independent DB copy reproduced 66/66 and inserted 66 draft entries, 66 draft
senses, 264 review localizations, and 66 source links. Fast audit and
published-risk audit passed; publishable senses remained 33,684 and
`flagged_senses=0`. Replay is not a publish operation. No v83 data has been
pushed to D1.

Operationally, load ports 11441 and 11447 one at a time after a Studio restart.
Then use 11441=`UD-Q4_K_XL`, 11447=`UD-IQ4_NL`, context 1024, and speculative
mode off. Simultaneous cold prewarm caused long load waits; once loaded, the
85-row run completed in about 227 seconds with no network failure.

## 18. Reverse Dictionary Evidence Gate

A fresh zero-overlap 20-row generation smoke exposed a second quality limit.
The stricter generator accepted 12/20, but model self-review still approved
translations that lacked independent dictionary support. Running the same
review prompt on ports 11441 and 11447 also produced identical 20/20 approvals,
including the same bad source mapping. Two nodes serving the same model at
temperature zero are not independent reviewers and must not be counted as
consensus.

`scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs` now
checks each generated target term against `linguago_v2_full.db`:

- Chinese terms: CC-CEDICT, Kaikki Chinese, and WikDict zh-en.
- Japanese terms: JMdict and WikDict ja-en.
- Portuguese terms: FreeDict por-eng and WikDict pt-en.
- Forward exact translation evidence: WikDict en-{zh,ja,pt} and FreeDict
  eng-por.
- OMW matches remain weak evidence and can only produce `manual_review`.

The gate classifies rows as `supported`, `unsupported`, or `manual_review`.
Polysemous terms with one matching gloss but many unrelated glosses remain
manual. The first 12 structurally/LLM-approved rows became 5 supported and 7
manual; no unsupported row remained after compound matching correctly treated
`antacid` and `anti-acid preparation` as equivalent. The supported rows were
`cronologia`, `secrecao`, `breast cancer` (source `乳癌`), `onion` (source
`たまねぎ`), and `electric guitar` (source `エレキ`).

The validator also writes a supported-only replay report. Replaying those five
rows into a fresh database copy, then running deterministic promote, accepted
exactly 5/5 while leaving 381 unrelated historical drafts rejected. Fast audit,
published-risk audit, and full in-memory D1 export audit passed. The validation
copy had 33,689 publishable senses, 134,756 localizations, zero blockers, and
the unchanged non-blocking duplicate-localization warning of 98. The main
product DB and D1 were not modified.

English generated pronunciation is now replaced from ECDICT when an exact term
exists. In the 12-row replay, 11 English pronunciations were replaced, including
the previously hallucinated pronunciation for `electric guitar`. Such rows use
`pronunciation_system=ecdict-phonetic` and are excluded from the LLM-only IPA
review. Portuguese pronunciation still lacks an equivalent deterministic local
source and remains under review.

Repeatable command:

```powershell
npm.cmd run dict:v2:coverage:validate-reverse-evidence -- `
  --report logs/generation-dry-run.json `
  --out logs/generation-reverse-evidence.json
```

Do not apply a two-language batch directly from the model QA result. First run
the reverse-evidence gate, replay only its supported report into a database
copy, promote there, and complete fast, published-risk, and full export audits.

The promote script now accepts `--reverse-evidence <report>`. When present, it
loads only `generation_valid=true`, `decision=supported` source sense IDs and
does not scan unrelated historical drafts. The first gated test scanned 5,
accepted 5, and rejected 0 instead of scanning 386 mixed drafts.

A second zero-overlap 20-row smoke (19 pt-BR, 1 ja) completed in 70 seconds on
ports 11441 and 11447 with no infrastructure failure. Generation QA accepted
11/20. Reverse evidence classified those 11 as 6 supported and 5 manual. The
six supported rows were `cominho`, `marxismo`, `desinfetar`, `pneumotorax`,
`cortisona`, and `padroeiro`. Japanese `-suru` base-form lookup and English
derivational matching were added after deterministic false negatives for
`消毒する/disinfect` and `physiological/physiology`; OMW-only evidence still
does not auto-pass.

After two independent database-copy validations, the 5+6 supported rows were
replayed and gated-promoted into the main local product DB. Backup:
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-reverse-evidence-11-20260716-163911.db`.
The full local-only export at
`outputs/d1-v2-product-native-export-v83-reverse-evidence-11` passed with:

- entries: `28178`
- entry forms: `192274`
- pronunciation groups: `30003`
- senses: `33695`
- sense localizations: `134780`
- examples: `3030`
- example localizations: `11898`
- `flagged_senses=0`

All blocking findings remain zero and `duplicate_sense_localizations=98` did
not increase. Nothing from v83 has been pushed to D1.

## 19. Reverse-Evidence Prefilter Follow-up

`scripts/prefilter-dictionary-v2-product-source-gap-reverse-evidence.mjs`
checks source headwords against strong reverse dictionary evidence before an
LLM call. Run it with `npm run dict:v2:coverage:prefilter-reverse-evidence`.
OMW-only evidence does not auto-pass, and polysemous low-match rows remain in
manual review. This is an input-cost filter, not a replacement for validating
the generated target terms afterward.

The first full prefilter scanned 1,073 two-language first-sense candidates:

- supported: 1,044
- manual review: 27
- unsupported: 2
- supported by source language: pt-BR 907, zh 29, ja 108

A fresh balanced 50-row sample excluded both earlier validation reports and
contained pt-BR 20, zh 15, and ja 15. The 143/56 dry-run had zero network
failures on both nodes, but accepted only 20/50 on the first run and 19/50 on
the repeat. Seven candidates changed pass/fail state between identical runs
(`43/50` stable), confirming that model-side evidence and quality decisions are
not deterministic enough to publish without the reverse dictionary gate.

The complete-output repeat produced 19 valid generations. Independent reverse
validation classified nine as supported, six as manual review, and four as
unsupported. The nine supported rows were four Portuguese entries (`sovina`,
`narina`, `nacionalismo`, `provocador`) and five Japanese entries (`たかり`,
`ユーティリティ`, `ヒヤシンス`, `にわとり`, `かお`). All nine replayed and
promoted cleanly in a temporary DB, then in the main local product DB after the
backup
`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-reverse-prefilter-9-20260716-210112.db`.

After this batch, the local-only product state is:

- product entries: 28,675
- product senses: 34,227
- publishable senses: 33,704
- full D1 export: 28,187 entries, 33,704 senses, 134,816 localizations
- published-risk flagged senses: 0
- full export blockers: 0
- duplicate localization warning: 98, unchanged and non-blocking

The audited export is
`outputs/d1-v2-product-native-export-v83-reverse-evidence-20`. It has not been
pushed to D1. The 38-40% model acceptance and 18% final supported yield are too
low for a 500-row expansion. Improve source candidate ranking, especially for
Chinese proper-like compounds and Japanese/Portuguese target-term coverage,
before increasing the batch size.

Dry-runs retain complete generated rows by default. The reverse validator now
fails explicitly if a report says generation occurred but only previews were
saved; this prevents a silent zero-row reverse audit.

## 20. Unambiguous OMW Synset Pilot

The prefilter now requires one unambiguous matching OMW synset and builds
target-language hints from that single synset. It must not merge target terms
from multiple synsets. This prevents source anchors such as `crawl`, `anvil`,
or `identity` from silently mixing unrelated senses.

The first fresh 20-row pilot used ports 11441 and 11447 with one request per
node. An initial invocation accidentally passed the obsolete
`--prompt-profile micro` option. The runner ignored it and reported
`prompt_mode=compact`; 15 otherwise complete rows lacked the evidence verdict
and five long outputs were truncated. Always verify the report configuration
and pass the supported option explicitly:

```powershell
--prompt-mode micro --max-tokens 600
```

The corrected run completed in 70.5 seconds with no endpoint or network
failure. Model QA accepted 15/20. Independent reverse validation accepted
14, held `engatinhar` for manual review because its Japanese term had OMW-only
support, and published none of the five model-QA rejections. The resulting
14/20 final yield was 70%, compared with 9/50 (18%) for the earlier broad
source-evidence prefilter.

The 14 supported rows were `sinergia`, `pigmento`, `bigorna`, `emboscar`,
`heparina`, `flúor`, `boda`, `pauzinho`, `fissão`, `小馬`, `はしけ`,
`しゃっくり`, `フルオキセチン`, and `働きバチ`. They replayed and promoted
14/14 in an isolated validation DB, then in the main local product DB after
backup:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-omw-unambiguous-14-20260716-224025.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-omw-unambiguous-14`:

- product entries: `28689`
- product senses: `34241`
- publishable senses: `33718`
- exported entries: `28201`
- exported sense localizations: `134872`
- `flagged_senses=0`
- all blocking export findings: `0`
- duplicate localization warning: `98`, unchanged

This pilot is evidence that the unambiguous-synset tier can be expanded to a
larger validation batch. It is not a D1 release; production remains on v82.

### Pronunciation-review follow-up

The lexical quality reviewer previously received EN/PT pronunciations without
their pronunciation systems. It therefore treated deterministic
`ecdict-phonetic` transcription as model-generated IPA and rejected valid
entries such as `sinusite` and `ibuprofeno`. Review responsibilities are now
separate:

- lexical QA checks meaning, terms, definitions, and ZH/JA readings;
- pronunciation QA checks only EN/PT fields whose system is `IPA`;
- deterministic ECDICT transcription is not presented as IPA.

The supplement runner also supports `--only-source-entry-ids <id,id,...>` for
targeted residual retries. A five-row retry accepted `mirra`, `sinusite`, and
`ibuprofeno`; all three passed independent reverse evidence and were promoted
after validation-copy audits. `néon` and `サツマイモ` remain manual
pronunciation residuals because the same-model reviewer made questionable
claims about valid Brazilian Portuguese vowel variants. Do not lower the IPA
gate or use same-model review as phonetic authority to force them through.

Backup before the three-row main-DB replay:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-pronunciation-retry-3-20260716-225041.db`

The latest audited local-only export is
`outputs/d1-v2-product-native-export-v83-omw-unambiguous-17` with 28,204
entries, 33,721 senses, and 134,884 sense localizations. All blockers and
`flagged_senses` remain zero. Production D1 is unchanged.

### Fresh 50-row unambiguous-synset validation

After excluding all previous generation reports and manual residual IDs, the
remaining high-confidence pool contained 65 rows. A fresh 50-row batch used 48
pt-BR and 2 ja candidates. Ports 11441 and 11447 completed the dry-run in
201.2 seconds with zero endpoint failures. Model QA accepted 39/50;
independent reverse evidence classified 37 as supported and two as manual.

The 37 supported rows replayed and promoted 37/37 in a validation DB and then
in the main local DB after backup:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-omw-next50-supported-37-20260716-232541.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-omw-unambiguous-54`:

- product entries: `28729`
- product senses: `34281`
- exported entries: `28241`
- publishable/exported senses: `33758`
- sense localizations: `135032`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

Six of the eleven generation rejections were `pronunciation_review_failed`,
caused by verbose reviewer responses exceeding the prior 180-token limit.
Pronunciation review now defaults to 260 tokens and explicitly requests a
reason under 20 words with short error codes. This is a JSON-stability fix, not
a relaxation of pronunciation quality. Retry only those residual source IDs
before expanding beyond the remaining high-confidence pool. Production D1 is
still unchanged.

### Residual pronunciation retry

The targeted retry of the 11 model-QA rejections completed in 81 seconds on
ports 11441 and 11447 with zero endpoint failures. Increasing the reviewer
budget and requiring concise JSON removed the earlier parser failure class:
`pronunciation_review_failed` fell from six rows to zero. Model QA accepted
three rows, and independent reverse evidence supported all three: `anil`,
`mandioca`, and `alfabetizacao`.

The three rows replayed and promoted 3/3 after validation-copy checks. A replay
CLI issue was found during the main-DB write: the normal `--limit` truncated
the source gap report before matching replay IDs. Replay selection now targets
the approved report IDs directly and is not truncated by the generation limit;
existing draft or accepted source links still provide idempotency.

Eight residuals remain manual. `ecra` is a pt-PT source-term mismatch for the
pt-BR dictionary. The other seven have disputed or invalid Portuguese IPA and
must not be forced through by weakening the pronunciation gate.

Backup before the main-DB replay:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-next50-residual-retry-3-20260718-151404.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-omw-unambiguous-57`:

- product entries: `28732`
- product senses: `34284`
- exported entries: `28244`
- publishable/exported senses: `33761`
- exported sense localizations: `135044`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

Production D1 remains v82 and unchanged.

### Fresh 50 target-evidence batch with Kaikki pt-BR IPA

A fresh deterministic prefilter scanned 773 remaining clean candidates. It
found 657 with source evidence, 161 with evidence in at least two target
languages, and selected 50 pt-BR candidates for remote review. The 143/56
evidence review approved 44/50 with no network or JSON failures.

Full generation accepted 36/44 on the first pass. Independent reverse
validation retained 28, put 3 into manual review, and rejected 5. A targeted
retry was allowed once for `quinino`, `trojan`, and `peroxido`: only `trojan`
became valid and was independently supported. `quinino` produced mutually
contradictory pronunciation-review explanations even after repair, while
`peroxido` returned non-JSON quality-review output twice. Both must remain
residuals; do not bypass the validator or retry them indefinitely.

The final 29 supported rows were replayed as drafts and promoted 29/29 in an
isolated validation copy before the main local DB was changed. The main backup
is:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-kaikki-pt-fresh50-supported29-20260718-204127.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-80`:

- exported entries: `28311`
- publishable/exported senses: `33828`
- exported sense localizations: `135312`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

The promoted words are `sadomasoquismo`, `colageno`, `cicuta`, `estratosfera`,
`timpano`, `metafisica`, `sidra`, `subestacao`, `tzar`, `difusao`, `calota`,
`escanteio`, `iglu`, `coala`, `caqui`, `focalizar`, `mucosa`, `referendo`,
`farelo`, `softbol`, `esfincter`, `miocardio`, `gargula`, `materialismo`,
`uretra`, `superpotencia`, `papear`, `coexistir`, and `trojan`. The ASCII forms
in this list are documentation shorthand; the database preserves accents.

This batch is not a large-scale green light. End-to-end safe yield was 29/50
(58%), and model-valid yield after one targeted retry was 37/44 (84.1%), below
the 90% expansion threshold. Infrastructure was stable, so the limiting factor
is candidate semantic alignment rather than node reliability or pronunciation
coverage. The next experiment must require evidence in all three target
languages before remote generation.

Always export before running the full export audit. The full audit consumes an
existing `manifest.json`; pointing it at a new empty directory correctly fails
with `Missing product D1 export manifest`.

Production D1 remains v82 and unchanged.

### Deterministic pre-generation gates and second fresh 50

Requiring evidence in all three target languages produced zero candidates from
the remaining 773-row pool. The available open-source graph can usually close
two target-language paths, not all three, so a three-target requirement is not
a usable production policy.

The reverse-evidence prefilter now has two optional, backward-compatible gates:

- `--require-pt-pronunciation true` requires a Portuguese generation hint to
  exist in the explicit Brazilian Kaikki IPA index.
- `--require-jmdict-hint true` requires at least one Japanese generation hint
  to be an exact JMdict headword in the source database.

After excluding the previous 50 candidates, 86 of 723 remaining candidates
passed the two-target plus deterministic pronunciation/JMdict policy. The next
50 were all new pt-BR rows. Remote evidence review approved 43/50 with 50 valid
JSON responses and zero endpoint failures. Full generation accepted 38/43
(88.4%), and independent reverse validation supported 28, marked 7 manual,
and rejected 3.

An implementation audit found that triage consumed the evidence decision but
did not normally attach `candidate_evidence_review` to its output. Triage now
supports explicit `--attach-candidate-review true`; the default remains false.
The hard-term experiment must not become the default: forcing reviewer
`preferred_terms` reduced generation acceptance to 33/43 and still produced
only 28 independently supported rows. It rejected valid synonyms and also
showed that a reviewer-approved term such as `イスラム帝国` can be broader than
the lexicographically precise `カリフ制`. Use evidence review to approve the
source sense, but rely on deterministic post-generation reverse validation for
the final target terms.

The 28 supported rows were replayed/promoted 28/28 in a validation copy and
then in the main local DB after this backup:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-deterministic-new50-supported28-20260718-205446.db`

The local-only export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-81`:

- exported entries: `28339`
- publishable/exported senses: `33856`
- exported sense localizations: `135424`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

The promoted words are `boson`, `topografia`, `homofobia`, `barbicha`,
`chuchu`, `hidroxido`, `hipotalamo`, `pedrinha`, `monotrilho`, `ficheiro`,
`escavador`, `umero`, `salmonela`, `nepotismo`, `premie`, `coccix`,
`luminosidade`, `elasticidade`, `esparadrapo`, `escaner`, `hidromel`,
`plebiscito`, `himen`, `competitividade`, `exoesqueleto`, `neutron`,
`exaustor`, and `paracetamol`. The database preserves the accented forms.

This still is not a 500-row green light. The model-valid rate missed 90%, and
the final safe yield remained 28/50 (56%). Infrastructure is ready, but the
remaining candidate pool needs a stronger deterministic target-term alignment
policy or a broader reverse dictionary before large-scale generation.

The documented `npm run check:source-gap-large-batch` alias had drifted out of
`package.json` even though the check script and documentation remained. The
alias is restored. Its synthetic fixture explicitly disables deterministic
JMdict/Kaikki validation because its fake Japanese and Portuguese terms are
intended to test chunking, resume, circuit recovery, malformed JSON routing,
and checkpoint promotion rather than lexical validity. Production defaults are
unchanged. The complete specialized regression passes.

Production D1 remains v82 and unchanged.

### Tier B target-evidence prefilter and compact reviewer

The remaining post-OMW72 zero-overlap pool contained 793 candidates after the
two earlier 20-row diagnostics were excluded. Requiring at least one strong
target-language evidence path retained 437 rows. The next pilot selected 20
pt-BR entries with evidence in two target languages, rather than selecting by
source-headword support alone.

The evidence reviewer now receives compact verified translation hints (at most
three terms per language plus provenance), uses a compact prompt, and allows
320 output tokens. Resume now reuses only `valid=true` records; truncated JSON,
context-limit, and network failures are retried instead of being permanently
cached. Reviewer-selected Chinese terms are normalized to simplified Chinese
with OpenCC before they are persisted. During this pilot, the original verbose
prompt produced 10/20 valid reviews, the first reduced payload reached 15/20,
and the compact prompt plus corrected resume behavior reached 20/20 valid and
approved reviews with no endpoint failure.

Production triage used the explicit diagnostic option
`--min-prefilter-target-langs 2` to allow a 0.95 short English anchor only when
the deterministic prefilter had two target-language evidence paths. The normal
strict default remains unchanged when this option is omitted.

Generation on ports 11441 and 11447 accepted 11/20 in about 98 seconds with no
infrastructure failure. Independent reverse validation reduced the result to
nine supported rows, one manual-review row, and one unsupported row. The nine
supported entries were:

- `caloria`
- `fragata`
- `miojo`
- `pandemia`
- `antidepressivo`
- `soldador`
- `formaldeido`
- `batuta`
- `eucalipto`

Seven of the nine generation rejections were pronunciation-review rejections;
the other two were a JMdict term failure and a preferred-Japanese-term
mismatch. Candidate ranking therefore improved end-to-end supported yield from
3/20 (15%) to 9/20 (45%), but authoritative pt-BR pronunciation remains the
dominant bottleneck. Do not expand this tier to 500 or 2,000 rows until that
gate has a deterministic pronunciation source or a better evidence-backed
adjudication path.

The nine rows replayed and promoted 9/9 in a validation copy, then in the main
local DB after this backup:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-tier-b-prefilter-next20-supported9-20260718-173547.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-78`:

- product entries: `28763`
- product senses: `34315`
- product localizations: `137252`
- exported entries: `28275`
- publishable/exported senses: `33792`
- exported sense localizations: `135168`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

Production D1 remains v82 and unchanged.

### Final unambiguous-OMW remainder

After excluding every prior generation report, 16 high-confidence candidates
remained: 15 pt-BR rows and one ja row. Ports 11441 and 11447 completed the
micro-prompt dry-run in 65.6 seconds. Model QA accepted 15/16, both endpoints
had zero infrastructure failures, and independent reverse evidence supported
all 15 accepted rows in all four target languages.

The supported report replayed and promoted 15/15 in a validation DB and then
in the main local DB. The exact-ID replay regression also passed: using
`--limit 1` still matched all 15 approved rows. `bolota` is the only residual;
its pt-BR IPA was rejected and it remains manual.

Backup before the main-DB replay:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-omw-final15-20260718-152220.db`

The final audited local-only export is
`outputs/d1-v2-product-native-export-v83-omw-unambiguous-72`:

- product entries: `28747`
- product senses: `34299`
- product localizations: `137188`
- exported entries: `28259`
- publishable/exported senses: `33776`
- exported sense localizations: `135104`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

The verified high-confidence unambiguous-OMW pool is now exhausted. Do not
expand by simply lowering evidence thresholds; regenerate/rerank a new source
pool first. Production D1 remains v82 and unchanged.

### Post-OMW72 rerank and aligned-first-sense Tier B

Coverage was rebuilt against the latest local product DB. The raw scan found
72,960 gaps from 126,439 ranked source entries. After excluding 4,547 source
IDs seen in checkpoints and generation reports, the strict two-language first
sense filter retained 833 rows. Re-running the unambiguous-OMW gate produced
zero automatic candidates, 20 manual rows, and 813 unsupported rows. This
confirms that the strict high-confidence pool is exhausted rather than hidden
by stale report exclusions.

The 20 manual rows received a source-sense-only evidence review on ports 11441
and 11447. Seventeen senses were judged real, deterministic triage retained 11
non-OMW-only rows, generation QA accepted four, and independent reverse
evidence supported only three: `apontador`, `おとな`, and `ふし`. `符牒` remained
manual because its generated Chinese target was too polysemous.

The three supported rows replayed and promoted 3/3 after validation-copy
audits. Backup before the main-DB replay:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-tier-b-aligned-3-20260718-154529.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-75`:

- product entries: `28750`
- product senses: `34302`
- product localizations: `137200`
- exported entries: `28262`
- publishable/exported senses: `33779`
- exported sense localizations: `135116`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

Tier B yielded only 3/11 after all gates, so it must not be expanded unchanged.
The next improvement should address deterministic Chinese reading mismatches
and improve English anchor selection before another small pilot. Production D1
remains v82 and unchanged.

### Tier B reading and multi-source evidence follow-up

The generator now replaces Chinese target readings with deterministic
`pinyin-pro` output before validation when the source language is not Chinese.
A four-row retry removed every prior `zh_reading_mismatch`; the remaining
rejections were one genuine target-sense mismatch and three independent
EN/PT pronunciation-review failures. This confirms the reading fix without
weakening the pronunciation gate.

Candidate evidence review now emits a concise `english_anchor` and
`preferred_terms`, and approved reports retain that structured review. The
reviewer also searches same-headword, same-source-language WikDict rows with
`is_good=1` and score at least 80. Generation treats reviewed preferred terms
as mandatory and deterministically preserves reviewed kana-only Japanese
terms. In the focused `yeehaw` test this recovered `pt-BR=irra` and
`ja=ヒーハー`; lexical QA passed, but the English IPA reviewer still rejected
the generated dialect variant, so the row remains a pronunciation residual.

Do not scale Tier B yet. The next gate is an authoritative EN/PT pronunciation
source or a conservative adjudication path for reviewer conflicts. No row from
this follow-up was written to the product DB. The audited local export remains
`outputs/d1-v2-product-native-export-v83-evidence-gated-75`, and production D1
remains v82.

### Cross-node pronunciation repair

The source-gap generator now supports one conservative pronunciation repair
after lexical QA passes and EN/PT pronunciation QA rejects. The original node
reviews the IPA, another configured endpoint repairs only localization fields
whose `pronunciation_system` is `IPA`, and the original node reviews the
repaired IPA again. Deterministic ECDICT transcriptions are never sent to the
repair step. Out-of-scope pronunciation reviews about loanword or lexical
status receive one scope-correction retry; a second rejection still blocks the
row.

New switches:

- `--pronunciation-repair true|false`, default `true`
- `--pronunciation-repair-max-tokens 180`

A three-row historical pronunciation pilot on ports 11447 and 11441 recovered
one row. `あさ` generated `morning`, `manhã`, `早晨`, and `あさ`; the repaired
Portuguese IPA `/ˈmɐ̃.ɲɐ̃/` passed a second pronunciation review and all four
terms passed independent reverse-dictionary evidence. `determinante` and
`かんな` remained blocked by disputed Portuguese IPA in this pilot. `yeehaw`
also remains manual because proposed English IPA repairs disagreed with the
dictionary pronunciation.

The supported `あさ` row replayed and promoted 1/1 in a validation copy and in
the main local DB. Backup before the main replay:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-pronunciation-repair-asa-20260718-163723.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-76`:

- product entries: `28751`
- product senses: `34303`
- product localizations: `137204`
- exported entries: `28263`
- publishable/exported senses: `33780`
- exported sense localizations: `135120`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

Production D1 remains v82 and unchanged. Use pronunciation repair as a recovery
gate, not as a substitute for reverse term evidence.

### Tier B next-20 diagnostic and nested IPA repair

A zero-overlap 20-row batch was selected from the remaining post-OMW72
two-language pool after excluding the prior manual-20 report. All 20 rows were
pt-BR source entries. Dual-node evidence review on ports 11441 and 11447
approved 15, rejected five source/gloss mismatches, and had zero network or
JSON failures.

The production triage correctly selected none of the 15 because every short
English anchor had confidence 0.95 rather than the required 1.0. A diagnostic
dry-run only, with `direct-confidence=0.95` and `min-primary-en-length=4`, was
used to measure the improved generator. It did not write the database. The
generator accepted 9/15, with zero infrastructure failures in about 46 seconds.
Independent reverse-dictionary validation classified those nine as three
supported, three manual-review, and three unsupported.

The pilot exposed a repair-response compatibility bug. Unsloth can return a
repair either as `"pt-BR":"/ipa/"` or as
`"pt-BR":{"ipa":"/ipa/","reason":"..."}`. Converting the latter with
`String()` produced `[object Object]`. The repair parser now explicitly accepts
string values or nested `ipa`/`pronunciation` string fields and rejects all
other shapes. A focused retry recovered the two affected rows at the IPA gate,
but reverse evidence still rejected both because their generated Chinese terms
conflicted with dictionary evidence.

Only `tcheca`, `leiloar`, and `fatiar` passed every gate. They replayed and
promoted 3/3 in a validation copy and then in the main local product DB. Backup
before the main replay:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-tier-b-next20-supported3-20260718-165314.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-77`:

- product entries: `28754`
- product senses: `34306`
- product localizations: `137216`
- exported entries: `28266`
- publishable/exported senses: `33783`
- exported sense localizations: `135132`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

The end-to-end yield was 3/20, so Tier B must not be expanded under this input
policy. Keep the production short-anchor threshold at confidence 1.0.
Production D1 remains v82 and unchanged.

### Deterministic Brazilian Portuguese pronunciation index

The Tier B pronunciation bottleneck is now covered by a deterministic
Kaikki/Wiktextract index. Build it with:

```powershell
npm.cmd run dict:v2:build:pt-pronunciations
```

The builder reads `data/raw/kaikki_Portuguese.jsonl` and writes the ignored
runtime database `data/processed/kaikki_portuguese_pronunciations.db`. It only
indexes IPA with an explicit Brazilian region tag. Generic `Brazil` is
preferred, followed by Sao Paulo, Rio de Janeiro, Caipira, and Southern Brazil;
Portugal-only pronunciations never enter the pt-BR index. Phonemic `/.../`
forms sort before narrow `[...]` variants within the same region.

The 2026-07-18 source file was downloaded from Kaikki through `a6000-143`
because direct local HTTPS timed out. It is 555,521,010 bytes with SHA-256
`6d92084f2123076078dc203c0126de9bb15a4e41e0cbed9e440fdeb3ffc241cf`.
The resulting index contains 61,976 normalized terms and 307,336 pronunciation
rows from 75,148 entries with explicit Brazilian IPA.

The source-gap supplement runner loads this index by default or through
`--pt-pronunciation-db`. A match receives
`pronunciation_source=deterministic:kaikki-pt-BR:<region>`. Deterministic IPA is
not sent to model pronunciation review or repair. Unmatched terms retain the
existing model review path. The index path is included in checkpoint identity.

On the previous next-20 output, the index covered 19/20 Portuguese terms and
all seven prior pronunciation-review rejections. A new live dry-run selected
the 11 candidates not already published and accepted 9/11; pronunciation
rejections fell from seven to zero. The remaining failures were Japanese
term/JMdict constraints, so the lexical gates remained active. Independent
reverse validation retained seven: `vinagrete`, `bacharel`, `cobarde`,
`quiabo`, `penteadeira`, `privatizacao`, and `puzzle`. `desovar` was rejected
for conflicting Chinese evidence and `acrobacia` stayed manual for a
polysemous Chinese term.

The seven supported rows replayed and promoted 7/7 in a validation copy and in
the main local DB after this backup:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-kaikki-pt-supported7-20260718-193200.db`

The audited local-only export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-79`:

- product entries: `28770`
- product senses: `34322`
- product localizations: `137280`
- exported entries: `28282`
- publishable/exported senses: `33799`
- exported sense localizations: `135196`
- all blockers and `flagged_senses`: `0`
- duplicate localization warning: `98`, unchanged

Operational pitfalls found in this run:

- Reverse evidence uses `--source-db` and `--report`, not `--db` and `--in`.
  Wrong names are ignored and make the validator process its default report.
- The legacy `audit-dictionary-v2-product-export-fast.mjs` can read a default
  export instead of the intended DB. For authoritative counts, export to a new
  directory and run `audit-dictionary-v2-product-export.mjs --mode full`.

Production D1 remains v82 and unchanged.

### Latest audited local state: evidence-gated-82

The reverse-evidence validator now accepts `--input-mode reviewed`, which
validates `candidate_evidence_review.preferred_terms` before generation and can
write a filtered candidate set with `--supported-report`. The second fresh-50
review produced 37/43 independently supported reviewer-term candidates.

For a controlled residual comparison, the supplement runner used
`--enforce-reviewed-preferred-terms false`: reviewed terms remained strong
semantic guidance, while a natural close synonym was allowed. Of the 37
pre-supported rows, 27 were already linked and complete. Generation accepted
6/10 remaining rows, and post-generation reverse evidence retained four.

- backup: `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-reviewed-soft-supported4-20260718-213746.db`
- export: `outputs/d1-v2-product-native-export-v83-evidence-gated-82`
- entries: `28343`
- senses: `33860`
- sense localizations: `135440`
- blockers and `flagged_senses`: `0`
- non-blocking duplicate-localization warning: `98`

The latest four promoted entries are `triturar`, `genealogia`,
`desatualizado`, and `linguística`. Production D1 remains v82; this export has
not been deployed. Large-scale generation remains closed because only 4/10
genuinely remaining rows passed the final independent evidence gate.

### Fresh-attempt index and evidence-gated-83

Do not treat rows missing from the product DB as fresh. A rejected generation
does not create a publishable entry, so it can reappear in every rebuilt gap
report. Build a history index first:

```powershell
npm.cmd run dict:v2:coverage:index-source-gap-attempts -- `
  --logs-dir logs `
  --prefix product-source-gap-v83 `
  --out logs/product-source-gap-v83-generation-attempts.json
```

The index includes only top-level generated rows and attempted generation
checkpoint items. It intentionally excludes review-only, triage-only, and
selected-but-never-generated rows. The 2026-07-18 index scanned 345 JSON files,
found 104 generation reports and ten checkpoints, and identified 4,679 unique
source entry IDs with no parse failures.

Rebuilding the current 200,000-rank, 50,000-row gap report produced 72,789
gaps. The old strict policy yielded 480 clean rows, but only three remained
after excluding actual historical attempts. A two-language relaxed pool left
1,440 genuinely fresh candidates. Requiring two target languages, deterministic
pt-BR IPA, an exact JMdict hint, and at least one unambiguous OMW target produced
107 fresh pt-BR candidates.

The first 20-row gate had 20/20 valid review JSON, 17 approvals, and no endpoint
failure. All 17 reviewer-term sets passed independent reverse evidence. Full
generation accepted 16/17 (94.1%); post-generation reverse evidence supported
13, left one manual, and rejected two. The resulting promote rate was 13/16
(81.25%), meeting the 80% deterministic promote threshold but not yet justifying
a 500-row expansion from one sample.

Replay exposed a configuration-drift bug: a dry-run created with
`--enforce-reviewed-preferred-terms false` was replayed under the default hard
matching policy and incorrectly rejected `colcha`. Replay now inherits
`enforce_reviewed_preferred_terms` from the source report unless the CLI
explicitly overrides it. After that fix, the 13 supported rows replayed and
promoted 13/13 in a validation copy and in the main local DB.

Backup before the main replay:

`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-fresh-omw1-supported13-20260718-215640.db`

Audited local-only export
`outputs/d1-v2-product-native-export-v83-evidence-gated-83`:

- entries: `28356`
- senses: `33873`
- sense localizations: `135492`
- blockers and `flagged_senses`: `0`
- non-blocking duplicate-localization warning: `98`

Promoted words: `domar`, `fuso`, `incesto`, `alameda`, `periscópio`,
`astrologia`, `aeronáutica`, `geologia`, `cabeleireira`, `colcha`, `variável`,
`autismo`, and `atletismo`. Production D1 remains v82 and unchanged.

### A6000-151 source-review request-size fallback

On 2026-07-30, A6000-151 accepted model-listing and short chat requests but
reset the connection for the real 1,262-character source-review prompt. Before
classifying this as a general endpoint failure, write the exact prompt without
sending it:

```powershell
node scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs `
  --report <candidate-report> `
  --debug-prompt-out logs/source-review-prompt-debug.json `
  --debug-prompt-only true
```

If the exact compact prompt resets while short requests work, use:

```powershell
--prompt-mode micro --max-tokens 320
```

The micro payload is about 430 characters for a typical candidate and omits the
redundant system message. `max_tokens=260` can truncate structured JSON; 320
recovered more rows in the chunk03 run. Keep retries bounded and leave remaining
failures as residual/manual work. Do not weaken source evidence, proper-name
exclusion, deterministic validation, or independent consensus review.

After model switches or an unload window, force-load the intended model before
production. Chunk03 generation was stable at an 8,192-token context and ended
with zero infrastructure failures, even though source review had shown
request-size resets.

### Wordfreq 500k evidence-gated validation (local only, 2026-08-03)

- The current 500k scan inspected 342,384 ranked entries and found 236,531
  entry-level gaps. Sense alignment retained 63,137 unique senses; the normal
  quality filter retained 36,457 candidates.
- `--min-target-langs 3` previously excluded English from target coverage. That
  made the gate impossible for non-English source entries, whose remaining
  non-English target count is at most two. The prefilter now counts the
  independently supported English anchor as a target for zh/ja/pt-BR sources.
  The strict all-target pool increased from 77 English-only rows to 395 rows:
  `ja=240`, `en=77`, `pt-BR=49`, `zh=29`.
- After historical-attempt subtraction, 245 strict rows remained. Source review
  approved 230/245 (93.9%). Qwen generated 213/230 valid records (92.6%) with
  zero endpoint failures. Deterministic reverse evidence supported 177/213
  (83.1%). Gemma accepted 159/177 on the first pass; one bounded correction pass
  added six safe rows, for 165/177 unique final consensus rows (93.2%).
- Writer replay exposed a CJK homophone collision: Japanese `祈とう` and `気筒`
  both had the romanized normalized key `kitou`. The source-gap writer now
  verifies the stored headword and language before reusing a group key. On a
  mismatch it appends the stable source entry ID, preventing a new sense from
  attaching to the wrong homophone entry.
- Checkpoint export now permits a draft sense under an existing accepted entry.
  The sense and all four localizations must still remain draft/review until
  promotion. Consensus conversion can consume a replay writes report to map a
  corrected generation to its exact product sense ID when both old and corrected
  drafts exist.
- Reusing prior generation was safe only after intersecting it with the repaired
  all-target prefilter and its existing deterministic-supported report. Gemma
  accepted 176/192 (91.7%) with zero failures. A fresh all-target-hint batch added
  82/91 Gemma-accepted rows; its reverse support was only 91/184, confirming that
  target hints alone do not replace two independent target evidence families.
- Across the completed gate100, strict, corrected, historical-reuse, and fresh
  batches there are 520 unique source entry IDs with deterministic support and
  no-correction independent Gemma acceptance. Pairwise overlap is zero.
- The strict validation DB promoted 165 senses and passed fast audit,
  published-risk (`flagged_senses=0`), native D1 export, and full in-memory import
  audit. All blocking counts are zero. Production D1 and the main product DB
  remain unchanged; main SHA-256 is
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.
- Gemma 4 31B reviewed 177 rows in 520.9 seconds and 192 rows in 564.6 seconds,
  about 2.9 seconds per row. A single reviewer node is therefore a predictable
  throughput bottleneck for the 2,000- and 5,000-row stages.

The composite 500-row quality and checkpoint gate is complete. The next gate is
2,000 sustained rows. Do not start it from the broad target-hint pool: that pool
only achieved 49.5% deterministic support. First add enough independent pt-BR
and zh reverse-dictionary coverage, or construct a new strict pool with the same
family-aware standard.

### Independent evidence expansion result (local only, 2026-08-03)

- MUSE was evaluated only as research data. It is CC BY-NC 4.0 and added only
  five supported rows to the 184-valid replay, so it must not be used for the
  production evidence DB.
- word2word is Apache-2.0 and derives bilingual lexicons from
  OpenSubtitles2018. Treat it as the single weak family `corpus_word2word`.
  Top-3 raised the strict pool from 989 to 1,155 rows; top-5 reached only 1,168,
  so production uses top-3 to avoid low-rank subtitle noise.
- Apertium is imported through exact Spanish-lemma pivots across
  `zho-spa`, `eng-spa`, and `es-pt`. All three repositories count as one
  `apertium` family. The import added 24,254 rows but only 25 strict candidates
  and did not improve the 194-row replay, so it is supplementary rather than a
  primary expansion source.
- Wikidata structured data is CC0. The safe matching rule requires an exact
  English item label, then imports only that QID's exact target-language labels.
  Action API labels plus aliases improved replay support from 91 to 109, but
  was too slow for pool construction. Batched SPARQL labels processed 1,017
  low-coverage candidates in about one minute. SPARQL aliases added only two
  more strict rows per 100-row sample while taking about six times longer, so
  aliases are disabled in the production prefilter.
- The combined `omw + corpus_word2word + apertium + wikidata` evidence DB has
  1,984,076 lexical rows. Under unchanged strict gates it yields 1,324 fresh
  target-three-language candidates: `ja=659`, `en=440`, `pt-BR=187`, `zh=38`.
- Together with the already verified 520 unique rows, the strict pressure pool
  is 1,844 rows. It is not valid to call the remaining 156 rows publishable.
  A 2,000-row infrastructure pressure test may add 156 target-two-language rows
  only as an isolated `no-promote` tier. The release/promote denominator remains
  the 1,844 strict rows, and the 80% deterministic/Gemma gates are unchanged.

Reproducible evidence utilities:

```powershell
python scripts/export-apertium-pivot-evidence.py --help
python scripts/export-word2word-evidence.py --help
node scripts/export-wikidata-generation-evidence.mjs --help
node scripts/merge-supplemental-evidence-dbs.mjs --help
```

The exporter supports `--langs ja` for a Japanese-only incremental evidence
database. The expected official Word2Word files are `ja-en.pkl` and
`en-ja.pkl`; they remain the weak `corpus_word2word` family and can corroborate
another independent source but never pass the strict gate alone.

The v3 combined database adds 553,029 top-3 `ja<->en` Word2Word rows. An
experiment allowing one strong source plus this weak corpus family increased
nominal strict candidates from 17 to 251, but independent Gemma review accepted
only 5/20. The source-gate experiment was reverted. Japanese Word2Word remains
target-term corroboration and diagnostic evidence only; it cannot satisfy the
source-sense family minimum.

Do not use PanLex as a live dependency: its historical API hostname was not
resolvable during this validation. Do not count Kaikki and WikDict separately;
both remain in the `wiktionary` family.

### Sense-exact gate100 result (local only, 2026-08-03)

- The earlier 1,324/1,844 figures were entry-level planning estimates. A
  sense-exact expansion produced 64,583 candidate senses. After target-three
  prefiltering and exact historical subtraction, 2,613 fresh senses remained.
- Fixed four legacy entry-level leaks: prefilter result mapping, historical
  subtraction, reverse-evidence supported replay, and Gemma consensus resume
  now key rows by `source_entry_id:source_sense_id`.
- `gloss_repeats_word` no longer blocks an identical international term after
  a >=0.90 independent source review. The failed prompt experiment caused by a
  misspelled local helper made no remote requests and is not model evidence.
- Target-three candidates generated well (83/90 valid) but only 51/90 had full
  deterministic reverse support. Requiring independent evidence for every
  target language leaves 1,576 fresh senses after historical subtraction.
- Locking the first independently supported term raised deterministic support
  to 81/100, but Gemma exposed polysemous hint errors such as `catering -> 迎合`
  and accepted only 50/81 without correction. Target hints are therefore not
  safe unless their exact sense is reviewed before generation.
- Added `--require-hint-semantic-alignment true` to source review,
  `--enforce-generation-hint-terms true` to generation, and
  `--unique-entry true` / `--exclude-report` to balanced selection.
- Formal hint-aligned gate100 attempt 1 reached source review 92/100,
  generation 86/92, deterministic support 80/100, and Gemma 66/80 (82.5%).
  It failed the >=90% no-correction consensus gate.
- Formal entry-unique attempt 2 reached source review 97/100, generation
  94/97, deterministic support 90/100, and Gemma 64/90 (71.1%). It also failed
  the consensus gate. The remaining blocker is sense-specific definition and
  grammatical alignment, not network, JSON, or GPU throughput.

Do not start the 500-row write gate from this pool. Production D1 and the main
product DB remain unchanged. A next attempt must improve candidate semantic
alignment or use a bounded correction-and-revalidation lane while preserving
the explicit no-correction metric; do not lower the 90% Gemma threshold.

### Bounded correction diagnostic (local only, 2026-08-03)

- The consensus retry, replay, and semantic-review conversion utilities now
  key records by `source_entry_id:source_sense_id`. A replay regression mapped
  all 64 original consensus accepts to exactly 64 generated senses.
- The 26 original Gemma rejects were regenerated with the four Qwen endpoints.
  Generation produced 25 structurally valid rows with zero endpoint failures;
  all 25 regained four-language deterministic reverse support.
- Independent Gemma re-review accepted only 11/25 corrected rows. The remaining
  14 rejects were classified as seven scope errors, three wrong-term/sense
  errors, three definition errors, and one part-of-speech error.
- This correction result is diagnostic only and cannot improve the formal
  no-correction score. More importantly, `--enforce-generation-hint-terms true`
  can conflict with a Gemma correction when the locked evidence hint itself is
  wrong. Do not use the correction lane to write drafts from this pool.
- The next candidate gate must run an independent Gemma pre-review over the
  exact proposed terms, grammatical role, and definition scope before Qwen
  generation. Then select a new, previously unseen 100-sense sample and retain
  the existing >=90% final Gemma no-correction threshold.

### Sense-exact gate100 pass and aligned-candidate dedupe (2026-08-04)

- A new unseen gate100 passed all formal thresholds: source candidates
  `100/100`, Qwen generation `92/100`, deterministic reverse support `92/100`,
  final Gemma no-correction acceptance `83/92` (`90.22%`), and final promote
  eligibility `83/100`. All four Qwen endpoints had zero network failures.
- Pure ASCII ECDICT pronunciation strings are no longer allowed to overwrite
  model IPA. ECDICT replacement now requires actual IPA Unicode evidence.
- The compact source-review prompt now enforces exact sense, semantic scope,
  and grammatical-category alignment when
  `--require-hint-semantic-alignment true`; the flag previously affected only
  the micro prompt.
- Candidate uniqueness must be checked after sense alignment. Distinct raw
  rows can converge to the same aligned source sense. In one expansion,
  `1,239` raw rows became only `676` unique aligned senses; `563` duplicates
  were removed. The alignment script now keeps one row per
  `source_entry_id:first_sense_id` and reports `duplicate_aligned_candidates`.
- Gemma pre-review requires a 2,048-token context for this prompt. At 1,024,
  valid candidates can fail with `context_length_exceeded`; this is not a
  lexical rejection.
- Terminating a yielded local command may leave its child `node` process
  running. Before resuming, verify the process and JSON report. Never launch a
  second writer against the same report.
- The strict 676-sense pre-review completed with `676/676` valid responses,
  `545` approved, `131` rejected, and zero JSON/network failures. After the
  four-language preferred-term and independent reverse-evidence gates, only
  `195` rows remained. Solve candidate shortage with broader independent
  evidence, not lower thresholds.
- A further aligned-new-only pool contains `853` genuinely unseen senses. Its
  resumable Gemma report is
  `logs/product-source-gap-v83-gemma-precheck-expanded853.json`; the first
  `52` rows are complete and unique. Continuing it requires authorization to
  send the Unsloth API credential to `100.99.99.99:11445`.
- The 2,000-row infrastructure-only tail is prepared at
  `logs/product-coverage-gaps-v83-pressure-no-promote156.json`. It contains
  `ja=63`, `en=63`, and `pt-BR=30`; every row has
  `pressure_tier=target2_no_promote` and `promote_allowed=false`. There were no
  eligible zh rows in the target-two-only remainder. This file is excluded
  from the quality/promote denominator.
- `node scripts/source-gap-large-batch-check.mjs` passes chunk commits,
  interruption/resume with zero duplicate senses, circuit opening and
  recovery, malformed-JSON classification and rerouting, and checkpoint-bound
  promote isolation.

### Authoritative 2,000-row pressure conclusion (local only, 2026-08-05)

This section supersedes the earlier entry-level `1,844` planning count. Exact
union by source entry showed that 476 of the previously verified 520 entries
already occurred in the 1,324-row strict report. The real strict union is
therefore 1,368 unique entries, not 1,844. The 2,000-row pressure manifest adds
632 target-two rows marked `promote_allowed=false`; those rows are
infrastructure-only and never enter the quality or promotion denominator.

The pressure run completed all 2,000 checkpoint items:

- 1,811 structurally valid generations and 189 generation rejects;
- 1,259 valid strict-tier rows and 552 valid no-promote rows;
- zero network failures on the resumed 147/47/56 endpoint set;
- zero writes from the 632 no-promote candidates;
- 50-row transaction commits, checkpoint resume, endpoint migration, circuit
  breaking, malformed-JSON rerouting, and duplicate-write protection passed.

This proves sustained scheduling and draft-write behavior, not that the broad
strict pool is publishable. The broad pool's initial reverse pass supported
647/1,259. Allowing an English source headword as an additional lexical anchor
fixed real false negatives and raised support to 770/1,259. Replacing only
failed target terms with their first evidence hint raised deterministic support
to 1,042/1,259 (82.76%), but partial independent Gemma review accepted only
584/775. Re-generating rejected rows with locked hints also failed early Gemma
re-review. A hint can be lexically evidenced yet be wrong for the exact sense
or grammatical scope.

Production candidate policy is frozen as:

1. exact `source_entry_id:source_sense_id` identity and post-alignment dedupe;
2. Gemma pre-review accepts the exact sense, part of speech, definition scope,
   and four preferred terms at confidence >=0.90;
3. those exact preferred terms pass all-target independent reverse evidence
   before Qwen generation;
4. Qwen generates definitions, readings/IPA, and examples while preserving the
   prevalidated terms;
5. deterministic validation passes again after generation;
6. independent Gemma final review accepts with no corrections at confidence
   >=0.90;
7. deterministic promote targets an isolated DB until fast, published-risk,
   native export, and in-memory import audits pass.

The unseen gate100 is the authoritative quality proof: 92/100 generation-valid,
92/100 deterministic-supported, 83/92 (90.22%) final Gemma no-correction
acceptance, and 83/100 promote eligibility. The composite 500 checkpoint and
quality gate plus its isolated full audit remain valid. Together with the
completed 2,000 infrastructure test, this is sufficient to start 5,000-row
production batches only when inputs follow the frozen prechecked
reverse-supported policy. Broad strict, historical-union, and target-hint-only
reports remain diagnostic/no-promote inputs.

Current node policy:

- 143 is excluded while another user is using it; the project model was
  unloaded and dashboard VRAM reached 0 MB.
- 155 runs `unsloth/gemma-4-31B-it-qat-GGUF` for independent review.
- 147, 47, and 56 run `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` for generation.
- Stopping a yielded PowerShell command may leave its child Node process alive.
  Match the exact report path before terminating it; never kill unrelated Node
  processes.

The main product DB and production D1 remain unchanged. Main DB SHA-256 is
`9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.

Final baseline verification on 2026-08-05 exported to
`outputs/d1-v2-product-native-export-v83-large-scale-readiness` and passed a
full in-memory import audit. Manifest and imported counts matched exactly:
29,586 entries, 200,664 forms, 31,411 pronunciation groups, 35,102 senses,
140,408 sense localizations, 3,030 examples, and 11,898 example localizations.
All blocking integrity counts were zero. This export is verification output;
it was not pushed to D1.

### 2026-08-05 definition-contract regression

The source database already contains wordfreq ranks through approximately
200,000 in en, pt-BR, zh, and ja. Raising `max-rank` is therefore not a remedy
for the strict-pool shortage. A 3,455-row evidence triage found 2,071
`strong_dictionary_gloss_conflict` rows; 1,906 had only one available strong
family, while only 73 exposed two families with incomplete lexical matching.

The prefilter supports a default-off diagnostic option,
`--strong-supplemental-families`. Enabling `apertium` for the current
Spanish-pivot supplemental rows raised the strict result only from 18 to 19,
adding pt-BR `sombrear`. Do not enable this option for production. A separate
exact normalization for spaces and hyphens was also tested and did not increase
the final strict pool because later four-language evidence gates still failed.

PanLex evidence must use a streamed four-language subset while preserving each
meaning's original PanLex source identifier. Never count the aggregation as
one independent source family, and map known derivatives back to their actual
families. The online PanLex API hostname failed DNS resolution, so the pipeline
must not depend on it.

The accessible OntoLex snapshot is Zenodo record `6757353`, Batch 1/8. Build a
resumable prefix inventory with:

```powershell
node scripts\inventory-panlex-ontolex-zenodo.mjs `
  --metadata .tmp\panlex-zenodo-page-1.json `
  --record-id 6757353 `
  --out logs\panlex-ontolex-batch1-four-language-inventory.json `
  --prefix-bytes 524288 --target-langs pt,zh,ja
```

The scanner must canonicalize `cmn|zho` to `zh`, `jpn` to `ja`, and `por` to
`pt`; literal `zh` matching produces a false zero-Chinese result. The completed
run inspected 96/101 files and selected six files totaling 224,466,395 bytes.
Five files (`106`, `107`, `112`, `114`, `115`) remain uninspected network blind
spots in the prefix-language inventory and must not be interpreted as negative
language matches. Their source metadata was later recovered separately:
`106/107/115` are Freelang, `114` is the Austronesian Basic Vocabulary
Database, and `112` is an Indonesian-English translator. All carry `co`, so
none requires a full lexical download for production evaluation.

Run the source-tail classifier before any lexical import:

```powershell
node scripts\audit-panlex-ontolex-source-metadata.mjs `
  --input-dir .tmp --source-ids 5,54,15,13,11,116 `
  --out logs\panlex-ontolex-batch1-source-family-audit.json
```

For this batch, `11`, `13`, and `15` are Wiktionary derivatives and therefore
remain the existing `wiktionary` family. Sources `5`, `54`, and `116` are
marked `co` in PanLex metadata and are excluded pending explicit licensing and
redistribution review. The audit found zero eligible new source families, so
these six files do not justify a production lexical import or a new LLM batch.
The combined final audit covers all 11 selected or formerly blind sources:
three collapse to `wiktionary`, eight are excluded for `co`, and zero are
eligible new families. Exact official Zenodo API searches locate only Batch
1/8 (record `6757353`); no public Batch 2-8 record is currently searchable.
Treat this PanLex route as exhausted unless a new snapshot or explicit source
license review becomes available.

### Post-PanLex source feasibility results

Do not replace evidence quality with another aggregator. OmegaWiki is
conceptually useful and historically open, but its old website and SQL dump
workflow are not currently reproducible from this environment. Require an
authoritative archive, checksum, and license record before writing an importer.

Concepticon 3.4.0 (official Zenodo record `14923561`, CC BY 4.0) was tested as
concept-alignment evidence. Run the reproducible probe with:

```powershell
node scripts\probe-concepticon-source-gap-residuals.mjs `
  --glosses .tmp\concepticon-cldf\concepticon-concepticon-cldf-e354898\cldf\glosses.csv `
  --residual logs\product-coverage-gaps-v83-production5000-fifth-canonical-fresh-evidence-v3-final.json `
  --db data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --out logs\product-source-gap-v83-concepticon-3.4-probe.json
```

Always exclude `Parameter_ID=0`, which represents unlinked rows and otherwise
creates large false multilingual groups. The clean probe found 210 shared
four-language concepts, eight residual source-word matches, and zero exact
target-hint matches. Concepticon therefore adds no strict candidates and must
remain `publication_evidence=false`; individual underlying concept-list
licenses would also require review before lexical redistribution.

Use the remaining specialist datasets only in their proper layer:

- Unihan: Han single-character definition, variant, and reading validation.
- KANJIDIC2: Japanese kanji reading/meaning validation; organizationally the
  same EDRDG family as JMdict, not a new independent vote.
- Tatoeba: attributed or CC0 example sentences and translation links only;
  never use sentence co-occurrence as word-sense publication evidence.

Use the offline importer after obtaining a PanLex CSV snapshot:

```powershell
$py = 'C:\Users\qhz00\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py scripts\export-panlex-evidence.py `
  --snapshot-dir data\raw\panlex\snapshot `
  --out .tmp\panlex\panlex-four-language-evidence.db `
  --family-map data\config\panlex-source-family-map.json
```

On Linux/macOS, use `python3` in place of `$py`. The snapshot directory must
contain `langvar|lv`, `expr|ex`, `denotation|dn`, `meaning|mn`, and `source|ap`
as CSV, TSV, `.csv.gz`, or `.tsv.gz`. The family map has this shape:

```json
{
  "sources": {
    "123": "wiktionary",
    "456": "independent-dictionary-name"
  }
}
```

Do not guess mappings. Known derivative sources must map back to existing
families such as `wiktionary`, `jmdict`, or `freedict`. Any source omitted from
the reviewed map becomes `panlex-unmapped`, is marked non-publishable, and is
excluded from prefilter and final reverse-evidence family counts. Validate the
boundary with `scripts/fixtures/panlex-mini`; merging its unmapped output into
v3 must preserve the same 18 strict candidate keys.

After adding Japanese Word2Word target corroboration, the strict supported
pool rose from 17 to 18 rows. The sole delta was pt-BR `ubíquo` (source sense
`2368070`). Gemma accepted the semantic definition contract with confidence
`0.95`, but exact preferred-term filtering retained `0/1` because the English
term was present only under `suggested_terms`, not `preferred_terms`. Stop at
that gate: do not send the row to Qwen and do not treat a model suggestion as
independent lexical evidence. No draft or product write resulted.

The evidence-review schema optionally emits a required four-language
`definition_contract`, and the compact generation prompt binds each localized
definition to it. Use
`review-dictionary-v2-product-source-gap-candidates-unsloth.mjs
--require-definition-contract true`; the supplement script consumes the
attached contract automatically.

The first exact 14-row regression narrowed to seven independently supported
preferred-term candidates before generation. Unsupported terms must be removed
before Qwen rather than repaired after it. The generation comparison is
incomplete because 147/47/56 requests reset at about 19 seconds through both
SSH tunnels and fixed Tailscale portproxy ports. Health/status calls remain
available, and all three nodes report a stale `llama.cpp` prebuilt. MTP-off,
lower context, single concurrency, and streaming did not remove the reset. One
row reached isolated draft state; no row was promoted and the main DB was not
modified. Exclude infrastructure rejects from quality-rate calculations.

This incident is now resolved. Updating 147/47/56 through `POST
/api/llama/update` installed llama.cpp `b10265`; reloading A6000-147 with
`UD-Q4_K_XL` and RTX4090-47/56 with `UD-IQ4_NL` removed the resets. One-row
structured smoke tests completed in 3.15/2.38/2.32 seconds respectively with
zero infrastructure failures.

The completed regression generated and reverse-validated seven rows. Gemma
accepted five with no corrections; `黄土色` and `microeconomia` remain draft.
The five-row isolated promote passed fast, published-risk, native export, and
full in-memory import audits. Export counts are 29,591 entries, 35,107 senses,
and 140,428 localizations with all blockers at zero. Production remains
unchanged. Use
`export-dictionary-v2-product-source-gap-checkpoint-drafts.mjs` to reconstruct
the exact generation report from accepted checkpoint writes before final
evidence and consensus review.

### Controlled model-consensus lane (2026-08-05)

This lane is for residual senses that have a strong semantic anchor but do not
have four independently evidence-bound target terms. It is not a replacement
for the strict preferred-term lane, and model agreement is never counted as
dictionary evidence.

- Funnel: 17 fresh candidates -> 16 Gemma source-review accepts -> 8 exact
  hint-bound inputs -> 7 valid Qwen generations -> 3 strict reverse-evidence
  supports -> 3 independent Gemma no-correction accepts.
- `surveying` failed source-sense review. Eight rows failed because a suggested
  target term was absent from the original hints. `cardiovascular` failed the
  deterministic JMdict term gate. These failures must not be bypassed.
- The final rows are `binómio`, `supersimetria`, and `南回帰線`. Their isolated
  draft write and promote accepted 3/3; product fast audit and published-risk
  passed with all blockers and `flagged_senses` at zero.
- The main DB stayed unchanged at SHA256
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.

Build this lane with
`build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs`.
It preserves independently bound `preferred_terms`, treats `suggested_terms`
as nonbinding prompt constraints, and emits `promote_allowed=false`.

Replay must honor `promote_allowed=false`. The only exception is explicit
`--controlled-consensus-draft-write true`, which validates independent model
families, no automatic-promotion policy, no-correction consensus, and
`controlled_model_consensus` provenance. It writes only draft rows and cannot
be combined with `--publishable true`.

For a direct product-DB fast audit use:

```powershell
node scripts\audit-dictionary-v2-product-export.mjs --mode fast --db <db> --out <report>
```

`audit-dictionary-v2-product-export-fast.mjs` instead expects an existing D1
export manifest; invoking it directly on a DB produces `Missing manifest`.

Human review is still mandatory after model consensus. In this regression,
`binómio` was semantically correct but is the European Portuguese spelling;
the `pt-BR` localization requires `binômio` and a Brazilian pronunciation.
`Trópico de capricórnio` also requires proper-name capitalization as `Trópico
de Capricórnio`. Both rows remain excluded for correction. Only
`supersimetria` was written to the main DB as `draft_single_source`; its four
localizations remain `needs_review=1`. Main fast audit and published-risk pass,
and its main-DB promote dry-run accepts 1/1. It has not been promoted or
published to D1.

`filter-dictionary-v2-product-source-gap-reverse-report.mjs` accepts either a
normal `selected` candidate report or a consensus replay `generated` array.
Use the latter to create a reverse-evidence subset that exactly matches the
human-approved replay before building a promote checkpoint.

`supersimetria` was subsequently promoted in the main product DB after the
1/1 main-DB dry-run. Its entry and sense are `accepted`, all four localizations
are complete, and all `needs_review` values are zero. The post-promote native
D1 export and full in-memory import audit passed with 29,587 entries, 35,103
senses, and 140,412 sense localizations. Count mismatches, bad localization
counts, duplicate sense orders, orphans, mojibake, HTML artifacts, and
published-risk flags are all zero. The main DB SHA256 is now
`EEC7D7E9BA43D882526D14B9AC4F17CDEE40FAB805BAB9CF88F192578D7AD781`.
The export is local under `.tmp/controlled-consensus`; D1 and Worker v83 remain
unchanged until a later release batch.
## 2026-08-07 network-resume note

The v87 formal 100 gate passed (`90` generation-valid, `88`
deterministic-supported, `82` final accepted), and an isolated 80-row promote
passed fast, published-risk, native export, and full import audits. Do not rerun
that gate unless its reports are lost.

Before resuming scale-500, require a one-row structured request to remain
connected beyond 20 seconds. A healthy `/api/health` response is insufficient.
The current failure is a repeatable `ECONNRESET` at about 19 seconds on multiple
nodes and models. Do not include these rows in quality denominators and do not
write them to a checkpoint as semantic rejects.

Prepared scale-500 files:

- Input: `logs/product-source-gap-v87-scale500-generation-input.json` (298 rows)
- Isolated DB: `.tmp/v87-scale500-checkpoint-validation-20260807.db`
- Intended report: `logs/product-source-gap-v87-scale500-qwen-generation.json`
- Intended checkpoint:
  `logs/product-source-gap-v87-scale500-qwen-generation.checkpoint.json`

Use 147/47/56 with one request per endpoint, context 3072, speculative off,
chunk size 50, max attempts 2, and circuit breaker threshold 2. The main product
DB must remain unchanged until deterministic reverse evidence, independent
Gemma consensus, promote dry-run/apply, and full export/import audit all pass.

## 2026-08-07 scale-298 gate passed

The scale validation is complete and large-batch generation is now permitted.
Use these frozen settings for Qwen generation:

- model: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`;
- prompt: `nano-per-language`;
- chat path: `/api/inference/chat/completions`;
- streaming enabled, context 3072, speculative off;
- batch size 1 and endpoint concurrency 1;
- chunk size 50, max attempts 2, circuit breaker failures 2;
- checkpoint enabled for both dry generation and draft writes.

Measured funnel: 298 selected -> 294 generation-valid -> 292 independently
supported -> 267 Gemma no-correction accepts -> 242 unique draft senses -> 240
promoted senses. Gemma acceptance among supported rows was 91.4%. The isolated
full export/import audit passed with every blocker at zero.

Operational lessons:

- A healthy `/health` or `/v1/models` response does not prove inference health.
- The 19-second reset correlated with request body size. Native, small,
  per-language requests avoid it.
- A stream timeout must cover body consumption, not only `fetch()` setup.
- Checkpoints must use entry+sense identity; entry-only keys collapse multiple
  senses of the same word.
- Endpoint failures are infrastructure failures and must not lower semantic
  acceptance rates. Let the circuit breaker redistribute them.
- Gemma reviewer prompts must identify only `X` as the target language. A
  separate ambiguous source-language label caused false locale rejections.
- Do not truncate definitions mid-word before review.
- Model consensus is a quality review, never an independent dictionary source.

For the next production run, generate 5,000 candidates into an isolated DB,
promote in 1,000-sense checkpoints, run fast audit after each checkpoint, and
run native export/full memory import after each 5,000 accepted senses. Keep the
main product DB unchanged until the isolated release package passes.
## 2026-08-08 forwarded-request size limit and nano source review

The current Windows forwarding path can list/load models and answer tiny chat
requests, yet closes real source-review requests near 800-1,000 prompt
characters. The observable Node cause is `read ECONNRESET`; streaming and a
3,072-token context do not fix it. Before blaming the model or GPU, measure the
exact prompt with `--debug-prompt-only` and compare a tiny `/v1/chat/completions`
request.

`review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` now supports
`--prompt-mode nano`. It sends only the already-prefiltered headword, language,
gloss, and first verified term per language, while retaining the full decision,
preferred-term, and definition-contract response schema. Use `--max-tokens 512`:
320 tokens truncated valid structured output on the 4090. Nano is a transport
fallback, not weaker publication evidence. Continue to require deterministic
independent-source prefiltering and later reverse-evidence/Gemma consensus.

The first 20-row nano smoke on 147/56 was infrastructure-clean (20 valid, zero
failed) but semantically accepted only seven. Stop expansion when this occurs;
repair term/POS/locale candidate selection rather than lowering the 90% source
review quality gate.

## 2026-08-08 post-promote candidate-quality recovery

The recovery pass used `nano-per-language`, not the single-hint `nano` mode.
Each target language was reviewed independently against exact sense, POS,
form, perspective, number, register, and scope. Candidate terms are
case-insensitively deduplicated. Portuguese enclitic non-lemma forms such as
`Dê-me` are deterministic rejects, and known pt-PT lexical/spelling variants
are removed before source review.

The measured funnel was:

- 98 candidates after independent-source and pt-BR gates;
- 38 Qwen source-review approvals;
- 36 Qwen generation-valid records;
- 30 records with source-required reverse evidence;
- 27 Gemma 4 31B no-correction accepts;
- 27/27 deterministic promotes in both isolated validation and local main DB.

The final main native export/full memory import passed at 29,896 entries,
35,460 senses, and 141,840 localizations. This result validates the recovery
path but does not justify padding a weak candidate pool. For the next batch,
improve independent-source candidate coverage first, then reuse the frozen
review, generation, reverse-evidence, and Gemma gates. No D1 deployment was
performed for this 27-row increment.

## 2026-08-08 rank-100k expansion caution

The raw coverage report may be expanded to 100,000 rows while keeping
`max-rank=200000`; this raised the clean post-history pool from 464 to 1,123.
Do not interpret the larger pool as 1,123 production-ready candidates. Unique
sense alignment retained 617, independent-source prefiltering retained 66,
Qwen source review retained 23, deterministic reverse evidence retained 18,
and Gemma no-correction consensus retained 15.

The final checkpoint-scoped promote validator still blocked `demandar`, whose
source verb had inherited noun-like Chinese and Japanese terms from a broad
gloss. Manual inspection found additional term-naturalness concerns among
otherwise consensus-accepted rows. Therefore, for lower-frequency windows:

- preserve POS in every target term, not only in definitions;
- prefer mainland simplified Chinese terms for the `zh` localization;
- treat Japanese naturalness and lexical category as separate checks;
- do not promote a whole consensus batch without inspecting its term matrix;
- keep all writes isolated until the inspected subset passes promote dry-run.

The v88 15-row set remains isolated draft data. The main product DB, D1, and
Worker were not modified by this expansion.

## 2026-08-08 v88 final inspected subset

The statement above describes the pre-inspection checkpoint. The completed v88
result is a manually inspected nine-row subset, not the full 15-row consensus
set. `demandar`, `causalidade`, `contagiar`, `boicotar`, `はし`, and
`ワイシャツ` were explicitly excluded and remain manual work.

Use
`build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs
--exclude-source-entry-ids ...` to reproduce this boundary. Do not hand-edit a
controlled replay after provenance validation.

The nine retained rows passed isolated draft write, promote dry-run/apply,
fast audit, published-risk, native export, and full memory-import audit before
the same controlled replay was applied to the main product DB. The current
local publishable package is:

- entries: 29,905;
- senses: 35,469;
- sense localizations: 141,876;
- examples: 3,030;
- example localizations: 11,898.

All release-blocking integrity counts and `flagged_senses` are zero. The
pre-write backup is
`backups/linguago-v88-before-gated9-promote-20260808.db` with SHA-256
`3DD64E28221E91F856E2CD188B7EB8252FA50762E49643401997622CF808D3D4`;
the post-write main DB SHA-256 is
`5A43338B81941415B52EA21D7C07A45120E5B38E780190C3063C55DAAC7AD4D9`.
D1 and the Worker remain unchanged.

## 2026-08-08 v89 independent-target evidence boundary

When rebuilding the historical-attempt index, use `--prefix
product-source-gap`. Restricting the scan to versioned names omits older files
such as `product-source-gap-unsloth-apply-5000-20260623.json` and can put
already attempted entries back into the candidate pool.

The target-term gate keeps the global ambiguous-sense ratio at 0.34. It now
also recognizes one exact strong-dictionary match plus an OMW lexical match as
two independent families. This is not an OMW-only pass: a target with only OMW
support, or with no matching strong dictionary gloss, remains rejected. The
evidence report includes `aligned_omw_terms` and `aligned_omw_term_checks` so
this boundary is auditable.

Measured v89 funnel:

- 100,000 raw gaps -> 1,051 clean -> 551 uniquely aligned;
- 11 independently target-qualified after the corrected evidence boundary;
- 4 Qwen source-review accepts -> 4 valid generations;
- 4 deterministic reverse-evidence supports -> 4 Gemma no-correction accepts;
- 2 deterministic promotes: `veemente`, `coeficiente`;
- 2 held definition-quality rows: `incorrer`, `emular`.

The final main export/full memory import passed at 29,907 entries, 35,471
senses, and 141,884 localizations. The pre-write backup SHA-256 is
`5A43338B81941415B52EA21D7C07A45120E5B38E780190C3063C55DAAC7AD4D9`;
the current main DB SHA-256 is
`2D968DAB2C5F3C758C78AFC052248C766B4B878A5B27E35146D13DE098E0103C`.
No D1 or Worker deployment followed this local increment.

The first `broad_gloss_key` result for `incorrer` and `emular` came from the
promoter preferring the multilingual source summary over the valid controlled
generation's concise gloss. Controlled reports must prefer
`generated[].output.gloss_key`; ordinary reports retain the source-gloss
fallback. After this correction, the same isolated batch passes 4/4 without
lowering the broad-gloss rule. The two rows remain unpublished for a different
reason: their Japanese definitions need a new targeted review. Never convert
an earlier Gemma accept into a synthetic correction record.

For `incorrer`, the safe recovery sequence was: fresh full-definition Gemma
rejection -> structured correction constraint -> new Qwen generation ->
deterministic four-language reverse evidence -> new no-correction Gemma accept
-> isolated draft/promote/audits -> main draft/promote/audits. Do not directly
patch a previously accepted generated localization. The final local package is
29,908 entries, 35,472 senses, and 141,888 localizations, with all blockers and
`flagged_senses` at zero. At this checkpoint `emular` remained a manual
definition-quality row; the focused-review recovery below resolves it.

When a multilingual consensus model repeatedly accepts a semantically correct
but grammatically malformed localization, rerun the full review with
`--language-focus <lang>`. This is a stricter proofreading pass, not permission
to lower evidence thresholds. For `emular`, `--language-focus ja` first caught
a missing Japanese predicate/particle structure, then caught a circular
definition introduced by the first retry. Only the second structured retry,
followed by fresh reverse evidence and a no-correction Gemma accept, entered
the isolated and main promote paths. The final local package is 29,909 entries,
35,473 senses, and 141,892 localizations, with all blockers at zero. Never
directly patch a localization from a model correction; regenerate and re-run
the complete evidence and consensus gates.

`--strong-supplemental-families` applies to every language and can accidentally
promote noisy source-language corpus pairs. Prefer the narrower
`--strong-supplemental-families-by-lang <lang>:<family>` for a targeted
diagnostic. This option still does not override target-term ambiguity checks.
In the v89 `oclusão` probe, scoped Chinese Word2Word evidence preserved the
Portuguese source match, but `梗塞` remained unbound because authoritative
sources expose competing obstruction and infarction senses. Leave such rows
in manual residual rather than forcing an LLM translation.

After every completed correction batch, rebuild the attempt index before
measuring the next pool. The v90 run used the current main DB and the full
`product-source-gap` history: 100,000 raw rows became 1,040 clean and 540
uniquely aligned rows, but the strict prefilter selected zero. Twelve rows had
valid source-to-English evidence and only one target-coverage slot; none had
enough independently bound target terms for generation. Treat a zero strict
pool as a source-ingestion task, not a reason to weaken validators or consume
LLM capacity.

## Non-publishable supplemental evidence guard

Supplemental SQLite files must provide `evidence_sources` metadata. The
prefilter and final reverse-evidence validator reject any source with
`metadata_json.production_publishable=false` or a non-commercial `BY-NC`
license, and reject a family when every registered source in that family is
non-publishable. This is enforced even if the caller passes that database
explicitly.

MUSE is a concrete regression case: its bilingual research dictionaries are
`CC BY-NC 4.0`, so all `muse-en-pt`, `muse-pt-en`, `muse-en-zh`, and
`muse-zh-en` rows must remain unavailable to production candidate selection.
The v90 license regression selected zero rows and reported both the blocked
source keys and blocked `muse` family. Never merge MUSE into the production
combined evidence DB and never mark it strong for a production run.

## Wikidata Lexeme sense probe

Use the read-only probe before building a new Wikidata Lexeme importer:

```powershell
node scripts/probe-wikidata-lexeme-sense-evidence.mjs `
  --report logs/product-coverage-gaps-v90-independent-prefilter-evidence.json `
  --out logs/product-source-gap-v90-wikidata-lexeme-sense-probe.json
```

The match requires the English and target Lexeme senses to share exact `P5137`
and their Lexemes to share the same lexical-category item. Never accept a
shared concept alone: the v90 probe mapped adjective `rectangular` to
Portuguese/Japanese nouns for rectangle. With the category gate, all 12 v90
residuals had zero compatible target coverage. Do not build or merge a Lexeme
evidence DB for this pool unless a later probe demonstrates real coverage.

## Sense-exact manual residual queue

Select and annotate unresolved high-frequency rows without calling an LLM:

```powershell
node scripts/select-dictionary-v2-product-source-gap-manual-review.mjs `
  --report logs/product-coverage-gaps-v90-clean-fresh-gated-aligned.json `
  --evidence logs/product-coverage-gaps-v90-independent-prefilter-evidence.json `
  --out logs/product-source-gap-v90-high-frequency-manual-review-20.json `
  --limit 20 --decisions manual_review `
  --reasons no_strong_reverse_dictionary_evidence,polysemous_source_term_low_match_ratio `
  --lang-targets zh=7,ja=7,pt-BR=6 --exclude-proper-glosses true

node scripts/annotate-dictionary-v2-product-source-gap-manual-review.mjs `
  --report logs/product-source-gap-v90-high-frequency-manual-review-20.json `
  --out logs/product-source-gap-v90-high-frequency-manual-review-20-annotated.json
```

Persist unresolved decisions in a reviewed JSON file and pass it through
`--exclude-source-sense-key-files`. This exclusion is keyed by
`source_entry_id:source_sense_id`; do not replace it with entry-level exclusion,
which can hide unrelated valid senses. The v90 regression excludes exactly 20
senses and zero whole entries. These rows remain manual residuals, not draft or
publishable content.

## Controlled entry-form aliases

Product entry forms are generated during native D1 export. Add reviewed locale
or spelling aliases to
`config/dictionary-overrides/product-entry-form-aliases.json`; do not create a
new product sense solely for an inflected or regional spelling.

Every alias identifies the expected entry ID, headword, primary language,
form type, source, and confidence. Export fails when the target is not
publishable or identity fields drift. After a change, run a full native export
and in-memory import audit with both alias and canonical spelling in
`--samples`. The initial regression proves `electrónica` resolves to pt-BR
entry `23336` `eletrônica`. A later exact lookup audit proved `activos` is the
European Portuguese plural spelling of the already-published four-language
assets entry `30466` (`bens`), so it is a reviewed `locale_inflected_form`
alias. `ativos` already resolves through an accepted localization and does not
need a duplicate alias. Do not attach `poluentes`: its Kaikki form-of record is
adjectival while the OMW four-language concept is nominal, so the
part-of-speech bridge fails.

## Targeted source-sense candidates

Use `build-dictionary-v2-product-targeted-source-sense-candidates.mjs` only for
high-value source senses omitted by the ranked coverage scan. The config must
pin the merged source entry and sense IDs. The builder checks identity, source
links, and existing product coverage and emits an aligned, read-only report; it
does not make reviewed form evidence publishable by itself.

Always pass the output through the normal reverse-evidence prefilter. The v90
`poluente` regression is intentionally rejected as
`strong_dictionary_gloss_conflict`: WikDict supports the noun English anchor,
but the proposed plural bridge combines an adjectival Kaikki form with a
nominal OMW concept. Keep this case in manual review instead of weakening the
gate or asking an LLM to resolve incompatible source evidence.
## 2026-08-08 v90 full-rank expansion result

The 100,000-gap input was not the full ranked pool. A read-only rerun with
`max-rank=200000` and `limit=300000` emitted all 267,263 gaps. Reusing the same
filter, exact historical-attempt exclusions, sense alignment, and strict
reverse-evidence policy produced this funnel:

- 267,263 raw gaps -> 4,930 clean rows;
- 4,930 clean -> 421 uniquely aligned incomplete senses;
- 421 aligned -> 68 rows with all target languages independently supported;
- 64 rows remained after subtracting prior v90 review batches.

Do not interpret the larger strict pool as production-ready. Two new 20-row
source-review gates reached only `15/20` and `12/20` accepts. The failures were
semantic rather than infrastructure: homographs, spelling variants, source
headword/sense drift, and broad OMW target concepts. No generation or DB write
followed.

For this review payload, a 1,024-token model context plus `max_tokens=320` is
too small: it caused two input-context failures and thirteen truncated JSON
responses. Resume only invalid rows with `--max-seq-length 2048 --max-tokens
500 --resume true --retry-invalid-on-resume true`. This fixes transport/format
completion but does not improve the semantic acceptance rate.

Before selecting another batch, strengthen deterministic source normalization
and semantic-risk rules. Keep source review at 90%; do not send a low-quality
tail to generation merely because it passed lexical reverse evidence.

When Qwen rejects a source candidate, use an independent Gemma source review
before treating the rejection as ground truth. Run
`dict:v2:coverage:adjudicate-source-reviews` with `--primary`, `--secondary`,
and `--out`. Consensus rejects can train deterministic risk rules; reviewer
disagreements must remain manual. In the v90 expanded pool, Gemma disagreed
with 5 of 12 valid Qwen rejects, while both models rejected 7. Updated risk
rules retrospectively blocked all 7 consensus rejects at scores 8-10.

After two formal 20-row batches, only 12 rows remained below the risk ceiling.
Their exploratory review returned 6 accepts, 5 rejects, and 1 invalid response.
This tail is not a formal gate and must not proceed to generation. The current
strict pool is exhausted until source spelling normalization, homograph
separation, and narrower sense-level evidence improve the input distribution.

Before semantic-risk ranking, run
`dict:v2:coverage:audit-parallel-agreement -- --report <report> --out <out>`.
This compares exact WikDict bilingual senses with target generation hints after
Unicode, simplified-Chinese, and safe containment normalization. It is a
diagnostic/ranking signal only. One mismatch adds moderate risk, two or more
add high risk, and near CJK matches add a small uncertainty penalty. Do not
promote from this signal and do not treat near string similarity as dictionary
evidence.

The prefilter and final validator must use the same conservative English
lexical normalization. The v90 alignment added derivational stems and a
one-character compact-form tolerance to the prefilter, recovering two rows.
Neither was safe: parallel bilingual senses disagreed with OMW target scope for
both `certificação` and `cambojano`. Always run parallel-agreement auditing
after a matcher change; a recovered lexical match is not automatically a
recovered multilingual sense.

### Exact WikDict lexentry candidate path

Use `dict:v2:coverage:build-wikdict-lexentry-candidates` when parallel WikDict
senses under one entry must be rebound before source review. The input may be
an aligned `selected` report or an alignment `rejected` report. For the latter,
pass `--input-reasons ambiguous_best_sense` so complete and already-linked
entries are not reconsidered.

The builder follows `sense_source_links` to raw provenance and requires an
exact shared WikDict `lexentry`, `is_good=1`, and score at least 20. Three
WikDict target pairs still count as one Wiktionary family. Always follow this
builder with the standard strict reverse-evidence prefilter using at least two
independent source families, all-target independent evidence, and localization
round-trip validation.

The v90 experiment found 90 all-target exact groups among 421 uniquely aligned
rows, but only 4 survived the independent-evidence gate. Processing 1,434
`ambiguous_best_sense` rows found 283 all-target exact groups and only 2 strict
survivors. Two-target exploratory variants raised the strict totals to 8 and 6
respectively, still below the 20-row source-review gate. Treat this as a useful
deterministic sense-binding improvement, not permission to generate or publish.
No product DB write is part of this command.
## 2026-08-08 v90 exact lexentry validation notes

Use exact WikDict `lexentry` equality only as sense-alignment evidence. All
WikDict language pairs and Kaikki remain one Wiktionary family. Candidate-bound
Wikidata labels may add one independent CC0 family only when the English item
label exactly equals the sense anchor; aliases are excluded.

The v90 20-row gate reached 19 structural generations, 17 deterministic
supports, and 16 independent Gemma no-correction accepts. Keep these operational
lessons:

- do not use the Gemma `nano` prompt as the final definition-quality gate; it
  misclassified valid concise definitions as truncated;
- retry only failed reviews with the full prompt and preserve the original
  confidence and no-correction thresholds;
- reject POS drift such as Portuguese noun `polidez` mapped to Japanese
  adjectival `丁寧`; use noun `丁寧さ` only after a new evidence-bound correction;
- use the consensus-to-semantic-review converter for genuine synonym pairs such
  as `neuron` and `nerve cell`, rather than weakening token-overlap validation;
- build a reverse-evidence subset and checkpoint scoped to the final consensus
  replay before promote, otherwise a deterministic-supported but
  consensus-rejected row can enter the checkpoint;
- generate the native SQL export and `manifest.json` before running the full
  export/import audit.

The isolated 16-row run passed promote, fast audit, published-risk, native
export, and full memory import. It did not modify the main product DB, D1, or
the Worker.

The remainder of the same reviewed pool produced 16/16 valid Qwen outputs,
15/16 deterministic supports, and 13/15 full-prompt Gemma accepts. The two
sub-batches merge to 29 controlled rows with an 80.6% end-to-end yield. Always
merge generation, evidence, and consensus reports independently, then rebuild
the controlled input from the original approved source-review report; simply
merging generated arrays can leave `selected` metadata scoped to only the first
batch. The combined 29-row isolation passed all audits and showed no cross-batch
entry or sense-order collision.

Do not expand the formal pool by reducing exact WikDict intake to only one
target language. The v90 experiment yielded 15 fresh low-risk-looking rows, but
full-prompt Gemma accepted only 3/10 deterministic-supported generations.
Failures included wrong target terms, POS drift, unnatural definitions, and a
factual domain error. Treat the experiment as a candidate-recall diagnostic,
not a production lane; none of its outputs may enter draft or promote.

Quantify the missing-source problem before evaluating another dictionary:

```powershell
npm.cmd run dict:v2:coverage:report-evidence-deficits -- `
  --reports logs\product-coverage-gaps-v90-wikdict-lexentry-min1-wikidata-strict-evidence.json,logs\product-coverage-gaps-v90-ambiguous-wikdict-lexentry-min1-wikidata-strict-evidence.json `
  --supplemental-db .tmp\combined\openwn-word2word3-ja-apertium-wikidata-v90-lexentry-min1-evidence.db `
  --out logs\product-source-gap-v90-wikdict-lexentry-min1-evidence-deficits.json
```

The report ranks acquisition targets using missing independent families and
round-trip failures. The 2026-08-08 result is `zh=245`, `ja=98`, `pt-BR=6`.
Chinese has 51 zero-family target gaps and 18 one-family gaps; Japanese has 21
and 6. This is the evidence-backed order for future source acquisition.

Treat aggregate licensing and source independence separately. Current PanLex
snapshots are offered under CC0, but each lexical assertion still carries an
underlying PanLex source. Preserve and review that source ID, then map it to the
real dictionary family. Never count `panlex-unmapped` as a second vote against
Wiktionary, CC-CEDICT, JMdict, FreeDict, or another existing family.

### OpenHowNet licensed reviewed subset

OpenHowNet has useful independent Chinese-English sense coverage. The official
download page applies MIT to OpenHowNet alongside the core-data download, and
the official repository describes itself as containing both core data and API.
Record these sources and required citations in
`config/dictionary-sources/openhownet-license.json`. The archive has no embedded
license file, so the exporter fails closed when this provenance is incomplete.

Export only after verifying the official archive hash:

```powershell
$py = 'C:\Users\qhz00\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py scripts\export-openhownet-research-evidence.py `
  --input .tmp\openhownet\resources\HowNet_dict_complete `
  --archive .tmp\openhownet\resources.zip `
  --out .tmp\openhownet\openhownet-research-evidence.db
```

On systems with Python on `PATH`, replace `$py` with `python3`. The exporter
pins SHA-256
`DAAA31E2627E099E03CE15371F472C6F9EC5B3AAC71A4E5E2AB5C4F4F38C44D4`
before loading the pickle. With verified provenance it writes `license=MIT`,
`production_publishable=true`, and the provenance-file SHA-256.

Measure potential coverage without merging the research DB:

```powershell
npm.cmd run dict:v2:coverage:probe-openhownet-research -- `
  --reports logs\product-coverage-gaps-v90-wikdict-lexentry-min1-wikidata-strict-evidence.json,logs\product-coverage-gaps-v90-ambiguous-wikdict-lexentry-min1-wikidata-strict-evidence.json `
  --evidence-db .tmp\openhownet\openhownet-research-evidence.db `
  --out logs\product-source-gap-v90-openhownet-research-probe.json
```

The 2026-08-08 probe matched 42/69 Chinese deficits by exact English anchor:
27 had one Chinese term and 15 had several. Multi-term rows need POS and sememe
binding before they can become candidates. Do not generate, draft, promote, or
publish from this research report.

The current exporter also writes `openhownet_sense_metadata`, preserving both
language POS tags and the sememe definition. The probe uses source POS or an
unambiguous OMW synset suffix and requires both OpenHowNet POS tags to agree.
This narrows the result to 32 POS-bound rows: 21 single-term and 11 multi-term.
The single-term rows are emitted only as `license_blocked_semantic_review`.
They still require semantic review because unique mappings may be over-broad,
such as `circumflex -> 符号`.

Run independent research review without writing any dictionary database:

```powershell
$line = Get-Content .env.local | Where-Object { $_ -match '^UNSLOTH_API_KEY=' } | Select-Object -First 1
$env:UNSLOTH_API_KEY = $line.Substring($line.IndexOf('=') + 1).Trim('"')

npm.cmd run dict:v2:coverage:review-openhownet-research -- `
  --endpoint http://100.99.99.99:11444 `
  --model unsloth/Qwen3.6-35B-A3B-MTP-GGUF `
  --gguf-variant UD-Q4_K_XL `
  --reviewer qwen35b-mtp-11444 `
  --out logs/product-source-gap-v90-openhownet-qwen-review.json `
  --resume true

npm.cmd run dict:v2:coverage:review-openhownet-research -- `
  --endpoint http://100.99.99.99:11445 `
  --model unsloth/gemma-4-31B-it-qat-GGUF `
  --reviewer gemma4-31b-qat-11445 `
  --out logs/product-source-gap-v90-openhownet-gemma-review.json `
  --resume true

npm.cmd run dict:v2:coverage:adjudicate-openhownet-research -- `
  --qwen logs/product-source-gap-v90-openhownet-qwen-review.json `
  --gemma logs/product-source-gap-v90-openhownet-gemma-review.json `
  --out logs/product-source-gap-v90-openhownet-dual-model-consensus.json
```

The 2026-08-08 run returned 21/21 valid JSON responses from each model. Qwen
approved 13 at confidence at least 0.90; Gemma approved 15. Strict dual-model
adjudication retained 13 agreements, one disagreement, and seven other blocked
rows. The historical report remains immutable and retains its original
`license_blocked_` statuses.

Convert only those 13 agreements into a licensed evidence subset:

```powershell
npm.cmd run dict:v2:coverage:export-openhownet-reviewed -- `
  --source-db .tmp/openhownet/openhownet-mit-evidence.db `
  --probe logs/product-source-gap-v90-openhownet-research-probe.json `
  --consensus logs/product-source-gap-v90-openhownet-dual-model-consensus.json `
  --out .tmp/openhownet/openhownet-reviewed-evidence.db
```

The result contains 13 reviewed candidates, 13 lexical assertions, and 13
OpenHowNet concepts. Use this subset as one independent evidence family in the
next coverage rebuild. Never merge the full 216,329-row export without
equivalent semantic filtering.

The first strict rebuild with this subset raised combined support from 70 to
73. Only `maremoto`, `isômero`, and `eucarionte` became newly supported. This
small gain is expected because OpenHowNet supplies only the missing Chinese
family; other rows may still fail Japanese, Portuguese, semantic-conflict, or
round-trip gates. All three fresh rows passed formal Qwen source review,
structured generation, deterministic four-language reverse evidence, and
independent full-prompt Gemma consensus. Before any main-DB write, replay these
three into an isolated product DB and run promote, fast audit, published-risk,
native export, and full in-memory import audit.

The 2026-08-10 isolated replay demonstrated why the final human gate is
mandatory. `maremoto` and `isomero` (stored as `is\u00f4mero`) were accepted,
but `eucarionte` was excluded from promote because its English and Portuguese
definitions described only "complex cells" and omitted the membrane-bound
nucleus. Leave that row as `draft_single_source` with four review localizations
until a targeted repair is independently checked. Model agreement and reverse
evidence do not prove that a definition is sufficiently specific.

After excluding that row, the native export and full in-memory import audit
passed with 29,911 entries, 35,475 senses, and 141,900 sense localizations. All
blocking counters were zero. Assert a deliberately blocked draft directly in
the product database and omit it from publishable lookup samples; requiring it
as an export sample creates a false audit failure.

For a narrow definition repair, do not update product localizations directly.
Create a reviewed four-language definition contract under
`config/dictionary-quality-repairs/`, then build a one-row input:

```powershell
npm.cmd run dict:v2:coverage:build-definition-repair -- `
  --report <controlled-source-report> `
  --repair config/dictionary-quality-repairs/eucarionte-definition.json `
  --out <repair-input-report>
```

Run a fresh Qwen generation from that input, require source-language reverse
evidence, and obtain a new independent Gemma no-correction acceptance. Build a
new controlled-consensus input from those three fresh reports before replay.
The `eucarionte` repair passed this complete path and then passed isolated
promote, fast audit, published-risk, native export, full in-memory import, and a
direct lookup sample. The resulting isolated package has 29,912 entries,
35,476 senses, and 141,904 sense localizations.

Draft apply reports use `writes[]`, including when an existing draft sense is
reused. Promote checkpoint readers must accept these successful writes as
`status=accepted`; restricting checkpoint parsing to legacy `items{}` causes a
valid reused draft to scan zero candidates. The promoter supports both formats.

The three-row batch was subsequently replayed into the local main product DB
after creating
`backups/linguago-v90-before-openhownet-3-promote-20260810.db`. Keep review
provenance separate during promotion: use the original review only for
`maremoto` and `is\u00f4mero`, explicitly exclude the old `eucarionte` sense,
then promote `eucarionte` with its new generation, reverse-evidence, and Gemma
reports. Do not combine an updated localization with an older semantic review.

The main-DB result passed fast audit, published-risk, native export, and full
in-memory import audit with 29,912 entries, 35,476 senses, and 141,904 sense
localizations. The pre-write backup hash is
`12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`; the
post-promote main DB hash is
`6C40303FAEA55A3CBE00CD45430A314B3EADB813093149B1C28593F099EEAA77`.
This step is local only; do not infer that D1 or the Worker was updated.

The batch was released later on 2026-08-10. Before upload, Wrangler exported
the remote v86d D1 database to
`backups/linguago-dictionary-before-v90-openhownet-20260810.sql` with SHA-256
`3B92328B5EA067D6C3C2B6D108AF81FC204EEE0608254E32F068DB0FE4379CE1`.
The v90 native package was then uploaded and remotely count-verified before the
Worker deployment. Production cache is `v90-openhownet-3-29912`; Worker Version
ID is `dc83a972-1a3b-4402-ba43-87fc9f97f80c`.

Post-release health reports 29,912 entries, 35,476 senses, 141,904 sense
localizations, 3,030 examples, and 11,898 example localizations, with
`published_at=2026-08-10T08:06:06.996Z`. Full online API regression and focused
mobile/desktop rendering passed, including all three new Portuguese terms.

## v90 reviewed-candidate scale gate

For large batches, source review is a selection stage before generation. The
2026-08-10 union test expanded two aligned reports to 886 unique senses and 180
strict reverse-evidence candidates. Qwen source review retained 125 candidates
across the old and unseen slices. Do not use the raw 64%/76% retention rates as
generation failure rates: the rejected rows were mostly genuine homograph,
part-of-speech, and semantic-scope conflicts.

The fixed 100-row generation gate produced 98 valid structures with no endpoint
failures. All 98 passed deterministic four-language reverse evidence. Gemma
accepted 57 unchanged, and bounded structured-correction cycles raised the
unique no-correction consensus total to 81/100. Corrections never count as
publication evidence: every corrected generation must pass deterministic
evidence and a new independent Gemma review.

Keep two implementation safeguards:

- On retry, tell the model only that its previous output was invalid. Never put
  the raw parser or validation error into the semantic prompt.
- Treat separators as ambiguous for terms, readings, and pronunciations. A
  semicolon in a full definition is normal punctuation and must not block an
  otherwise exact structured replacement.

This clears the 100-row quality gate, not the 500-row draft/resume gate. The
current source-reviewed pool is 125 rows, so acquire and review more independent
evidence before writing a 500-row batch. Until that run passes, production stays
on v90 and the scale-gate artifacts remain local reports only.
## 2026-08-10 all-eligible sense expansion qualification

The alignment stage now supports `--expand-all-eligible true`. This emits each
eligible source sense as its own `entry:sense` candidate instead of retaining
only the sense with the highest localization count. It does not merge senses,
and accepted product-linked senses remain excluded. With `min-langs=2` and
`max-langs=4`, the v90 clean 3-language entry report expanded to 24,898 unique
sense candidates. Reapplying the current independent-source and target
round-trip gates retained 3,527 unique candidates (3,187 pt-BR, 337 ja, 3 zh).

Treat 3,527 as an evidence-qualified pool, not a production-ready pool. A fresh,
entry-unique 100-row sample excluding the already reviewed 502 rows produced
55 Qwen approvals and 56 Gemma approvals; only 44 rows were approved by both.
The main failures were genuine semantic/POS drift in broad OMW localizations.
Ten Qwen and thirteen Gemma responses also failed the evidence-bound preferred
term validator. No generation or database write followed.

Two negative source-expansion results are reusable:

- Marking Wikidata exact entity labels as strong evidence raised the expanded
  strict pool only from 1,784 to 1,812.
- Dicionario Aberto exact-definition review must target current manual-review
  candidates. A new `--validation-report` plus `--validation-decisions` probe
  filter found 359 matching Portuguese candidates, but a 100-row dual-model
  pilot moved rows from manual review to single-source conflict and added no
  strict candidates. Do not review the remaining rows unless a second
  independent lexical family is added.

Production v90 was not modified. Before large generation, improve source-sense
term selection so a fresh 100-row source review reaches 90%; do not substitute
the 3,527 deterministic count for that semantic gate.

## 2026-08-11 frozen 2,000-row qualification procedure

The later v3 isolated run supersedes the earlier statement that the scale gate
was waiting on a 500-row pool. It completed 2,000 candidates and promoted 1,619
(80.95%) after all evidence and consensus gates. Production v90 was unchanged.

Use this order for the next 5,000-row run:

1. Build a sense-level manifest and merge with
   `merge-dictionary-v2-product-coverage-gap-reports.mjs --dedupe-key candidate`.
2. Generate checkpointed draft chunks. Resume with the same identity and rebuild
   the complete report using
   `build-dictionary-v2-product-source-gap-checkpoint-generation-report.mjs`.
3. Run deterministic four-language reverse evidence.
4. Run independent Gemma no-correction consensus.
5. For safe structured corrections only, regenerate, rerun reverse evidence,
   and obtain fresh Gemma acceptance. Never reuse the original review.
6. Admit resolved-risk rows only for explicit alternative, polysemy, or register
   resolutions. Keep POS, scope, homograph, and preferred-term conflicts blocked.
7. Replay accepted correction writes into the isolated DB and build the exact
   checkpoint with
   `build-dictionary-v2-product-source-gap-controlled-promotion-checkpoint.mjs`.
8. Merge accepted review provenance with
   `merge-dictionary-v2-product-source-gap-consensus-reports.mjs`.
9. Promote dry-run first; apply only when all controlled checkpoint rows pass.
10. Run fast audit, published-risk, native export, and full in-memory import.

Reference metrics are 1,898/2,000 structurally valid generations (94.9%), zero
infrastructure failures, 1,868 reverse-supported rows, 1,376 base Gemma accepts,
243 correction accepts, and 1,619 final promotions (80.95%). Export contained
30,929 entries, 37,095 senses, and 148,380 localizations; all blocking counters
and manifest/import mismatches were zero.

`duplicate_sense_localizations` is observational, not a release blocker by
itself. The isolated working DB retains rejected drafts, whereas native export
contains publishable rows only. Structural, content, localization-count,
orphan, and published-risk gates remain mandatory.

Do not start the next production batch until a fresh 5,000-candidate strict pool
exists. The frozen pipeline can process that scale, but the 2026-08-11 capacity
check found only 3,527 strict-prefilter candidates in total, with 3,025 already
reviewed. A broader entry-balanced pool failed a corrected 20-row source-review
gate at 0/20, so it cannot be substituted for the strict pool. Acquire or align
additional independent evidence and rerun the bounded source-review gate first.
Any prompt, evidence-family, or policy change also resets qualification and
requires a new bounded gate before promotion.

Current-code capacity update: rerunning the unchanged source report with the
current prefilter establishes a comparable baseline of `3,016`, not the older
`3,527`. Candidate-bound MIT ECDICT Chinese evidence raises this to `3,098`;
combining it with bidirectionally unique Japanese WordNet evidence raises it to
`3,105`. Use
`.tmp/combined/v90-production5000-ecdict-zh-japanese-wordnet-biunique-evidence.db`
for the next capacity experiment. Do not count OpenHowNet model reviews as
publication evidence while its downloaded data archive license remains
unverified.

The later full ECDICT extraction experiment raises the same-code strict pool to
`3,420`. Do not use all `404` new candidates directly: an unfiltered 20-entry
sample achieved only `14/20` dual consensus. Restrict to entry-unique rows whose
zh hint includes `ecdict` and whose en/zh hints each contain exactly one term.
This leaves `165` low-risk entries and passed a fresh Qwen/Gemma gate at
`19/20` dual consensus. Use `nano-per-language`; compact JSON was unstable and
`response_format=json_object` timed out on the tested Unsloth backend.

The complete low-risk run later accepted 144 source-reviewed entries, generated
135 valid drafts, obtained 132 deterministic reverse-evidence supports, and
received 120 independent Gemma no-correction accepts. Promote only those 120
rows by passing both the reverse-evidence report and final Gemma report to
`promote-dictionary-v2-product-source-gap-drafts.mjs`; never promote the whole
generation checkpoint.

For final Gemma review on 155, use `prompt-mode=nano`, definitions up to 220
characters, `max-tokens=128` initially, and concurrency 1. Retry truncated JSON
with `max-tokens=256`. Treat responses that still omit decision/confidence as
manual residual. Concurrency 2 can wedge the llama.cpp request queue; recover
with authenticated POST `/v1/unload`, verify `/v1/status` is empty, reload the
same model and GGUF variant, then resume only valid checkpoint rows.

The accepted 120-row ECDICT cohort was released as v91 after deterministic
replay into the main DB, a 120/120 production promote dry-run, fast/risk audit,
native export, and full memory import. Production counts are 30,032 entries,
35,596 senses, and 142,384 localizations. Cache version is
`v91-ecdict120-30032`, and Worker Version ID is
`999818a7-cd16-464c-8b7a-e8048f439b28`.

Wrangler `d1 export --remote` can fail with OAuth error 10000 even when D1
execute and deploy work. Before overwriting D1, either obtain a remote export or
re-audit the exact previous native release package and verify its manifest
counts equal online `/api/health`. For this release the verified rollback is
`outputs/d1-v2-product-native-export-v90-openhownet-main`.

## 2026-08-11 v92 qualified-cohort production replay

The frozen 2,000-row qualification was replayed onto v91 without new model
calls. Current validation retained 1,610 of the previously accepted 1,619 rows;
nine failed the newer Japanese-reading check. Promotion dry-run accepted all
1,610 retained rows.

Before production, duplicate triage identified 48 exact four-language,
same-reading pairs within the new checkpoint. Merge source links and remove
only those exact duplicates. Do not merge the eight exact-term/definition pairs
whose readings differ. The resulting production increment is 1,562 senses and
1,007 entries.

For legacy controlled reports, top-level `selection_policy` may substitute for
missing per-row provenance only when it certifies controlled model consensus,
independent no-correction review, final evidence/consensus gating, and
`automatic_promotion=false`. Candidate IDs must still occur in the named Gemma
consensus as unchanged accepts.

Final v92 D1 counts are 31,039 entries, 37,158 senses, and 148,632
localizations. All blocking audits, remote count verification, online API, and
mobile/desktop rendering passed. Cache version is
`v92-pressure1562-31039`; Worker Version ID is
`24626b8f-5f31-4a01-ab42-c3c9709b699a`.

## 2026-08-11 v93 strict fresh-candidate replay

Rebuild the strict pool after refreshing the historical-attempt index; otherwise
most apparently new rows are repeats. The v92 rebuild contained 1,692 strict
rows but only 197 fresh rows and 158 unique-entry candidates after the gate.

The accepted path is Qwen source review, independent Gemma source review, Qwen
four-language generation, deterministic reverse evidence in all four languages,
then Gemma no-correction review. The final production set is 115 senses. Exclude
`ampicilina`, `perfídia`, and the second overlapping `liberalismo` sense rather
than weakening semantic or entry-level validators.

For replay, use the controlled report to write drafts, but use the corresponding
dual-approved source report as `--report` during promote. The latter preserves
the source gloss used by semantic validation. The v93 candidate export passes a
full in-memory import at 31,056 entries, 37,273 senses, and 149,092
localizations, with every blocking counter and published-risk at zero.
It was released with cache `v93-strict-fresh115-31056`, D1
`published_at=2026-08-11T12:22:19.638Z`, and Worker Version ID
`5161673d-b817-4b1e-82b1-484d676c2974`. Focused API and desktop/mobile render
checks passed after deployment.

## Post-v93 residual-pool behavior

After a successful release, rebuild both sense alignment and the historical
attempt index before selecting more rows. The first v93 rebuild left only 39
fresh unique-entry rows. Qwen/Gemma source consensus retained 14; generation
found four already-complete drafts, produced nine valid new rows, and final
Gemma consensus retained eight. These eight passed isolated and main-local
promotion with all blockers at zero but were not deployed as a standalone
release.

When reverse evidence contains more rows than the final consensus report,
filter it with `filter-dictionary-v2-product-source-gap-reverse-report.mjs`
before building the promotion checkpoint. The checkpoint builder should keep
failing if an evidence row has no corresponding unique draft; do not weaken
that invariant.

## Manual-evidence capacity after strict-pool exhaustion

Run `npm run dict:v2:coverage:report-manual-evidence-capacity -- --report
<strict-evidence-report>` after the entry-level fresh pool reaches zero. The
v93 report contains 3,956 manual rows; 3,129 have only the OMW family. A
diagnostic near-unlock bucket requiring unambiguous OMW support and at least two
aligned target languages contains 1,221 rows: 462 zh, 448 ja, 310 pt-BR, and 1
en.

This bucket is capacity planning, not publication evidence. Several apparently
complete OMW alignments are semantically too broad or attach the wrong sense;
for example, a Chinese `买得起` candidate aligned to an `afford` synset whose
Japanese and Portuguese lemmas express provide/give. The next expansion should
add sense-specific source-side overlap from CC-CEDICT/OpenHowNet for zh,
JMdict/EJDict for ja, and FreeDict/Dicionario Aberto for pt-BR. Do not promote
rows merely because OMW supplies all three target-language term lists.

## Chinese near-unlock source-side pilot

Use `npm run dict:v2:coverage:report-zh-source-overlap` for Chinese source
candidates. The report distinguishes exact headword coverage from actual
English-anchor overlap and, when raw OpenHowNet metadata is available, binds
both language POS tags to the OMW-derived expected POS. Headword coverage alone
is never publication evidence.

The v93 full run over 462 Chinese near-unlock senses found 198 OpenHowNet
headword matches, 124 anchor overlaps, and 104 unique POS-compatible research
candidates. The first dual-model 20-row gate reached only 14 strict consensus
accepts despite zero API/JSON failures. Do not generate from this pool yet.
Broad anchors such as `take`, `paper`, and `reflect` need stronger
sense-specificity checks; rerun a fresh 20-row gate and require at least 18
strict consensus accepts before expansion.

After a source-side pilot passes, rerun the complete research pool with the
same specificity prompt. The v93 Chinese run retained 92 of 104 candidates by
strict Qwen/Gemma consensus and exported 115 reviewed OpenHowNet concepts.
When an anchor contains semicolon-separated alternatives, export only the
POS-bound `matching_concepts`; do not require the complete anchor string to
equal one source gloss.

The strict prefilter option
`--allow-reviewed-supplemental-source-roundtrip true` is intentionally
default-off. It may satisfy source round-trip only from publishable evidence
rows whose source metadata records `reviewed_subset=true` and independent
dual-model semantic review. It now also requires an explicit
`--reviewed-supplemental-source-keys` allowlist. Enabling the boolean without a
source key fails closed. This matters because the first unrestricted diagnostic
selected 1,679 rows but also trusted older, broader reviewed subsets; that
result is superseded.

With only `openhownet-official-2021-reviewed-e633a6d65e32` allowed, the v93
strict pool selects 1,645 rows, including 66 Chinese rows above the 1,579-row
baseline. Historical-attempt and duplicate exclusion leaves 63 fresh Chinese
entries. Treat these as candidates, not publication evidence by themselves.

The first 20-row generation pilot produced 18 Qwen-valid rows, then current
content-integrity validation removed a Japanese U+FFFD reading and wrote 17
clean drafts. Reverse evidence supported all 17, but independent Gemma 4 31B
accepted only 9 without corrections. Promote only those 9. The local audited
result is 31,065 entries, 37,290 senses, and 149,160 localizations; D1 remains
unchanged. The 9/20 final-consensus yield is below a bulk-expansion gate, so run
the remaining fresh rows only in bounded cohorts and keep all deterministic and
independent-review checks enabled.

The second bounded cohort initially generated 15/20 valid rows. Five failures
were kana-only Japanese terms whose model-supplied readings expanded or changed
the visible term. Retrying the model fixed 0/5. A kana-only term is already a
phonetic spelling, so the supplement normalizer now always uses the term itself
as its reading before validation. Current-code replay then accepted 20/20.

Do not generalize this override to kanji terms. Kanji readings must continue to
match JMdict or a narrow verified compositional rule. The 20 normalized drafts
all passed reverse evidence, but Gemma accepted only 12 without corrections.
Those 12 were promoted, producing a clean local export of 31,077 entries,
37,302 senses, and 149,208 localizations. The remaining 23 untouched rows still
require bounded generation and independent review; no D1 update has occurred.

The final two bounded cohorts exhausted this 63-entry delta. Cohort 3 produced
16 clean drafts from 20 candidates and 9 Gemma agreements. The last three rows
produced three clean drafts and two Gemma agreements. Across the complete pool:

- candidates: 63
- clean drafts: 56
- independent no-correction promotions: 32
- Gemma-rejected unpublished drafts: 24
- generation-invalid rows never written: 7

The final local full audit reports 31,088 entries, 37,313 senses, and 149,252
localizations, with all blocking integrity fields at zero. Do not regenerate
these 63 entries under another source-sense key: rebuild the attempt index and
exclude at source-entry level. The pool is exhausted, and the 32/63 final yield
does not qualify this evidence path for an unattended bulk run. Acquire or
align another independent source family, rebuild strict coverage, and repeat a
fresh bounded gate before any further large batch. D1 remains unchanged.

## Post-v93 residual gate result

Do not infer semantic alignment from entry-level language coverage or from
`first_sense_clean_localization_lang_count`. A fresh residual experiment found
307 unattempted strict entries, but four independent 20-row Qwen source-review
cohorts approved only 12, 12, 10, and 8 rows. Even the cohort requiring four
clean first-sense localizations failed because the underlying fusion had joined
parallel bilingual senses with different meanings.

The subtraction helper accepts `--min-first-sense-langs <n>` for diagnostics.
It is not an evidence gate. Before resuming generation, require target terms to
share an exact independent lexentry or concept identifier with the source
sense. Then run a fresh, entry-disjoint 20-row source review and require at
least 18 approvals. If that gate fails, stop before Gemma, generation, or any
database write.

Exact lexentry alignment must not skip the independent-evidence stage. The
required order is:

1. build exact shared WikDict lexentry candidates;
2. run strict reverse-evidence prefilter with at least two independent source
   families for every non-source target;
3. require localization round trip and a JMdict-backed Japanese hint;
4. rebuild the all-history attempt index with prefix `product-source-gap`;
5. exclude at source-entry level and require one generation hint per target;
6. run a fresh 20-row Qwen/Gemma source-review gate;
7. only then run Qwen generation with `apply=false`.

The v93 diagnostic that reviewed exact lexentries before strict reverse
evidence achieved Qwen 19/20 and Gemma 19/19, but generation accepted only
16/19 and included two non-JMdict Japanese terms. It is not production input.
Applying the correct order left only three fresh rows after the refreshed
history index, so this lane cannot supply another 20-row gate.

## V93 exact-hint replacement cohort

The next bounded lane combined exact ECDICT and EJDict hint intersections with
previously reviewed definition evidence. Use this order:

1. require four single generation hints and exclude all historical review rejects;
2. run Qwen source review with `max_tokens=800` and `max_seq_length=1536`;
3. replace semantic rejects only with a deterministic aligned source sense;
4. run independent Gemma source review and require at least 18/20 consensus;
5. generate with `apply=false` and enforce reviewed preferred terms;
6. run post-generation reverse evidence before writing or promoting drafts;
7. replay accepted outputs into an isolated DB, then promote only the reverse-
   supported fixed checkpoint;
8. run fast, published-risk, native export, and full memory-import audits.

Measured funnel: 20 Qwen-approved candidates, 19 Qwen/Gemma consensus rows, 18
valid generated rows, and 10 post-generation reverse-supported promotions. The
model calls had zero network failures after the output budget was raised. Do
not use model consensus as a replacement for reverse dictionary evidence.

Two operational failures are now documented. First, `max_tokens=420` truncated
17 strict structured reviews; retry only invalid rows with 800 tokens. Second,
a PowerShell-generated temporary JSON changed `圆凿` to `??` inside
`generation_hints`, while the source localization remained valid. Inspect the
actual JSON/code points and repair the report before retrying the single row.

The isolated export is `outputs/d1-v93-final10-validation` with 31,106 entries,
37,331 senses, and 149,324 localizations. All blocking audit fields are zero.
After that validation, the fixed replay was written to the main product DB and
a new main-DB sense checkpoint was generated; never reuse product sense IDs
from the validation copy. The reverse-evidence gate again selected exactly 10
rows, and promote accepted 10/10. The main export is
`outputs/d1-v93-final10-main` with the same counts and zero blocking fields.
Eight generated rows remain draft/manual review. D1 and Worker remain unchanged.
