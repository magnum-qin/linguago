# Dictionary v83 Large-Batch Runbook

This is the operational handoff for the current four-language source-gap work.
Read it before running Unsloth generation, changing the product database, or
publishing Cloudflare D1.

## 1. Current State

Production and the final audited local database now match:

| State                    |        Version | Entries | Senses | Sense localizations | Published? |
| ------------------------ | -------------: | ------: | -----: | ------------------: | ---------- |
| Cloudflare D1            | v83 chunk05 complete | 29,087 | 34,604 | 138,416 | Yes |
| Local audited product DB | v83 chunk05 complete | 29,087 | 34,604 | 138,416 | Yes |

Production details:

- Worker cache: `v83-production-chunk05-29087`
- Worker version: `1d5dd96d-f524-4e54-8816-25237302af22`
- D1 `published_at`: `2026-08-02T11:10:10.971Z`
- Pre-release backup: `backups/linguago-dictionary-before-v83-production-chunk05-20260802-201814.sql`
- Backup SHA256: `CC16C61817B06218105190FF91A585B44066C553D04F0CC9AED13D643A9D03E4`

Latest local audit:

- Export: `outputs/d1-v2-product-native-export-v83-production-chunk05-complete-validation`
- `flagged_senses=0`
- `bad_sense_localization_counts=0`
- `duplicate_sense_orders=0`
- All orphan, mojibake, and HTML artifact counts are zero
- `duplicate_sense_localizations=98` remains a known non-blocking warning

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
