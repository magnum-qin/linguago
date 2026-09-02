# Localized Sense Review Pipeline

## Purpose

This read-only pipeline audits fused product entries where a localized lookup
form occurs on only a subset of the entry's published senses. It addresses the
class of error exposed by `春节`: a localized-form lookup must not inherit
unrelated senses from the same fused entry.

The pipeline never writes SQLite or D1. It produces review reports and proposed
actions only. A separate, manually approved repair plan is required before any
database mutation.

## Stages

1. `report-dictionary-v2-localized-sense-isolation-risk.mjs`
   - scans accepted, unblocked senses;
   - emits one candidate per entry/localized-form pair;
   - includes every effective sense, all four localizations, and the
     deterministic exact-term match matrix.
2. Qwen 3.6 35B primary review
   - uses dynamic idle-node discovery;
   - returns `keep`, `isolate`, `split`, `repair`, `block`, or `manual_review`;
   - checkpoints every 10 valid/invalid results and supports resume.
3. Gemma 4 31B independent review
   - receives every non-keep or low-confidence Qwen result;
   - uses the same structured contract but does not treat Qwen as evidence.
4. Deterministic consensus adjudication
   - requires identical decisions and matched sense IDs;
   - requires both confidence values to be at least 0.90;
   - sends every disagreement or invalid result to `manual_review`.

## Remote command

Run on `100.99.99.99`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File D:\linguago-runner\scripts\run-remote-localized-sense-review.ps1 `
  -Root D:\linguago-runner `
  -RunId localized-sense-review-<id> `
  -Limit 100 `
  -Concurrency 4
```

The runner checks the dashboard before model calls and excludes nodes with a
foreign GPU process, excessive temperature, or missing requested model. Model
auto-switch is allowed only on selected idle/owned nodes.

## Validation result

The `localized-sense-review-v2-smoke20` remote run completed without database
writes:

- risk forms in the current remote product DB: `26,117`;
- selected: `20` forms across `10` entries;
- Qwen valid JSON: `20/20`;
- Gemma valid JSON: `20/20`;
- strict dual-model consensus: `14/20` (`isolate`);
- manual review: `6/20`, all caused by `isolate` versus `keep` disagreement.

The earlier v1 smoke run failed because thinking output consumed the response
budget and left `message.content` empty. The production contract must keep both
`enable_thinking=false` and `reasoning_effort=none`.

The first 100-row gate (`localized-sense-review-v3-gate100`) was technically
stable (`100/100` valid for both models, `82` strict agreements), but failed the
semantic spot check. Both reviewers over-isolated synonyms and variants such as
`marrow/bone marrow`, `numeric/numerical`, and `alume/alúmen` because the prompt
over-emphasized exact string matching. That report must not be converted into a
repair plan.

The v4 contract removes the deterministic exact-match hint from the model
payload and explicitly treats synonyms, spelling variants, inflections,
register variants, and kana/kanji forms as semantically equivalent when their
definitions denote the same concept. It also treats `frequency_rank=0` as
unknown rather than highest priority. The 20-row v4 regression produced 14
strict isolate agreements and six no-action/manual rows; synonymous entries
such as `duplicata` began receiving `keep` decisions while truly fused meanings
under `我` remained isolated.

The fresh 100-row v5 gate (`localized-sense-review-v5-semantic100`) completed
with checkpoint recovery and no database writes. Five primary responses first
hit `finish_reason=length`; raising the JSON budget from 900 to 1,400 tokens,
limiting explanations, and replacing (rather than appending) invalid checkpoint
rows recovered all five. Final results were 100 valid primary reviews, 63
strict isolate agreements, and 37 manual/no-action rows. A distinct-entry spot
check found the consensus rows substantially better than v3, including correct
separation of `that`, `我`, `的`, `了`, `it`, and `不`. Borderline localization
quality such as `modalidade -> 模式` still needs manual inspection, so v5 does
not yet authorize a 500-row repair/apply run.

## Expansion gates

- Do not apply the reports directly to the product DB.
- Run a fresh 100-row gate with the v4 semantic contract and manually inspect
  at least 20; do not reuse the invalid v3 gate as quality evidence.
- Expand to 500 only if valid JSON remains at least 98% and human precision on
  consensus actions is at least 95%.
- Only build a repair plan from dual-model consensus rows.
- `split`, `repair`, and `block` always require a separate controlled replay,
  product fast audit, published-risk audit, and full export/import audit.

## Human calibration gate

Before a 500-row expansion, create a 25-row fixture containing strict consensus
and disagreement-boundary examples:

```powershell
npm run dict:v2:labels:localized-sense-risk
```

Fill `human_label`, `human_matched_sense_ids`, `human_note`, `reviewer`, and
`reviewed_at` in the generated JSON. Allowed labels are `correct_isolate`,
`should_keep`, `needs_repair`, and `uncertain`. Score the fixture with:

```powershell
npm run dict:v2:score:localized-sense-risk
```

The expansion gate requires at least 20 labels, isolate precision at least 95%,
and exact matched-sense precision at least 95%. A failed gate blocks both the
500-row expansion and every database repair plan; thresholds must not be lowered
to make a batch pass.

The first independent v5 calibration is stored in
`config/localized-sense-review-v5-calibration-labels.json`. Keep this compact
label overlay under version control; the larger source fixture remains a local
log artifact. `uncertain` rows count toward labeling coverage but are excluded
from precision denominators.

The original semantic contract scored 73.3% isolate precision. The v7 contract
added an explicit duplicate-sense decision before query isolation and improved
precision to 91.7%; its only false isolation was `选举人/选民`. The v8 contract
clarified paraphrased voter definitions and passed the fixed 25-row calibration:

- labeled: 25 (24 decisive, one uncertain);
- dual-model consensus: 12 (11 isolate, one repair);
- isolate precision: 11/11 (100%);
- exact matched-sense precision: 11/11 (100%);
- expansion gate: passed;
- database writes: zero.

The fixed fixture must be reused when changing prompts or validators. Do not
replace it with a newly generated top-N report during regression. On the jump
host, Windows PowerShell startup may stall before executing the script when the
host has accumulated many console processes. In that condition, invoke
`C:\nvm4w\nodejs\node.exe` directly over the `ts-win-jump` SSH alias for the
primary review, secondary review, and adjudication stages. Do not count a
pre-Node PowerShell stall as model latency.

## v9 500-row stability gate

The v9 gate expanded the fixed v8 contract to 500 query forms. Qwen reviewed
all 500 rows; 498 responses passed the deterministic contract and two remained
invalid. Gemma then reviewed all 500 rows with `--secondary-review-all true`.
Full secondary review is required for expansion gates: filtering only non-keep
primary decisions would have missed errors such as `小売り / retalho`, which
Qwen marked `keep` while Gemma correctly proposed `repair`.

Strict adjudication at confidence `0.9` produced:

- total: 500 query forms across 84 entries;
- strict dual-model consensus: 403 (80.6%);
- manual review: 97;
- consensus decisions: 364 isolate, 31 keep, 8 repair;
- disagreement reasons: 43 decision, 41 sense-ID, 11 low-confidence, and two
  invalid primary responses;
- database writes: zero.

This gate passes the technical expansion check but does not authorize direct
database mutation. The 403 consensus rows are inputs to a controlled dry-run
plan only. Repair, block, split, and every unresolved disagreement remain
non-automatic. The next replay must deduplicate query-form actions by entry and
sense, preserve the v8 human-label precision gate, and run product fast,
published-risk, and full export/import audits before any apply step.

`create-localized-sense-consensus-repair-plan.mjs` performs that first
deduplication without inferring replacement values. For v9, eight repair query
forms collapsed to seven entry/sense repairs across six entries. Every plan row
is emitted as `manual_value_required` with `apply_allowed=false`; source-backed
replacement values must be resolved before a separate deterministic replay is
implemented.

## v9 source-backed repair resolution

The seven deduplicated repair rows were checked against the raw JMdict,
CC-CEDICT, ECDICT, WikDict, and OMW files instead of trusting model consensus
alone. The resulting controlled replay is stored in:

- `config/dictionary-overrides/localized-sense-consensus-verified-v1.json`;
- `config/dictionary-overrides/localized-sense-consensus-merges-v1.json`.

The resolution is deliberately narrower than the model plan:

- repair the Chinese localization of Japanese `は` for emphasis and contrast;
- fix the adjacent topic-marker pinyin for `は`;
- merge the duplicate `ね` confirmation-particle senses;
- merge the OMW-aligned `sonolência` drowsiness/sleepiness senses, retaining
  the mainland-Chinese term `睡意`;
- repair the narrow `ajustamento` localization from `适应` to `微调`;
- keep `没有` unchanged because CC-CEDICT explicitly supports both `haven't`
  and `hasn't`;
- leave broad `good` for a separate split/manual decision rather than replacing
  one field inside an over-merged noun/adjective sense.

Replay on `logs/validation-localized-sense-consensus-v1.db` updated five
localizations and merged two senses. Product fast audit, published-risk, and
full native export/in-memory import all passed with zero blocking findings and
`flagged_senses=0`. This was a validation-copy run only; it did not mutate the
authoritative product database or D1.

`product_sense_source_links.source_entry_id/source_sense_id` refer to the
canonical `entries/senses` tables in `linguago_v2_full.db`, not the raw import
tables `source_entries/source_senses`. An early version of the drift audit used
the raw tables and therefore reported tens of thousands of false mismatches.
The corrected audit joins `senses.id`, verifies `senses.entry_id`, and compares
the canonical entry word/language to the denormalized snapshots.

The corrected audit found five real historical defects, all written by the
one-off `source_gap_manual_residual` finalizer: `regular`, `cereal`, `组长`,
`ダイナー`, and `genro`. `source-link-drift-repairs-v1.json` maps them to exact
current canonical senses whose word, language, and gloss match. The guarded
repair changed only those five links. On the jump-host authoritative DB the
post-repair audit reports `54041` links, zero missing senses/entries, zero entry
ID mismatches, and zero snapshot mismatches. Product fast audit,
published-risk, and full native export/in-memory import all pass; no D1 deploy
was performed for this provenance-only repair.

Use these commands for future checks:

```powershell
npm.cmd run dict:v2:audit:product-source-link-drift
npm.cmd run dict:v2:triage:product-source-link-drift
npm.cmd run dict:v2:repair:product-source-link-drift
```

The repair command is dry-run by default. Use `--apply true` only after the
configured old link identity and the replacement canonical word, language, and
gloss all validate against the same full DB.

## Exact localization repair gate (2026-08-25)

The fresh100 replay proved that Qwen/Gemma agreement is not sufficient to
change a published localization. Three agreed repair candidates were
`くれる`, `カワセミ`, and `とぐろ`; manual inspection rejected all three
initial values because the models either added unsupported semantic nuance or
selected a regional/lexically weak translation.

The repair path now has four independent deterministic gates before any model
patch can be applied:

1. source links must resolve to unchanged canonical source snapshots;
2. the candidate must have at least two genuinely independent source families
   (`Kaikki`, `WikDict`, and Wiktionary count as one family);
3. every patch must cite links from at least two independent families;
4. the replacement term itself must occur exactly in at least two cited source
   families for the target language.

`discover-localized-sense-repair-evidence.mjs` is read-only. Its suggestions
must pass the strict exact-headword/multilingual-term plan before a source link
can be added. `くれる` and `カワセミ` passed source-link discovery on an
isolated validation copy; `とぐろ` did not. Fast audit and published-risk
passed after adding the two links to that copy. Rebuilding the evidence under
the final replacement-term gate produced zero model-eligible repairs, so no
localization from this fresh100 cohort was written to the authoritative DB.

The fresh500 run is `localized-sense-review-v11-fresh500`. Its risk report has
500 forms across 82 entries. The first primary-review attempt checkpointed at
least 210 rows before the Tailscale data path to `100.99.99.99` stopped
responding. Resume the same output file; do not delete or replace it:

```powershell
node scripts\review-dictionary-v2-localized-sense-isolation-unsloth.mjs `
  --input runs\localized-sense-review-v11-fresh500-risk.json `
  --role primary --limit 500 --concurrency 5 --checkpoint-every 10 `
  --max-attempts 2 --timeout-ms 60000 --resume true `
  --out runs\localized-sense-review-v11-fresh500-qwen.json
```

The reviewer now writes checkpoints through a temporary file and atomic rename,
writes again on `SIGINT`/`SIGTERM`, selects an endpoint for each attempt rather
than binding a worker permanently, retries on a different endpoint, and cools
an endpoint for 30 seconds after two consecutive failures. A Tailscale control
plane `active` status is not enough: require a successful ping or SSH probe
before resuming remote model calls.

For long runs, use the Scheduled Task launcher instead of keeping an SSH
foreground process open. The task reads the user-scoped `UNSLOTH_API_KEY`,
reuses the existing risk and checkpoint paths, and writes stage state under the
run directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File D:\linguago-runner\scripts\start-remote-localized-sense-review.ps1 `
  -Action start -Root D:\linguago-runner `
  -RunId localized-sense-review-v11-fresh500-background `
  -Limit 500 -Concurrency 5 -TimeoutMs 60000 -CheckpointEvery 10 `
  -RiskInput runs\localized-sense-review-v11-fresh500-risk.json `
  -QwenOut runs\localized-sense-review-v11-fresh500-qwen.json `
  -GemmaOut runs\localized-sense-review-v11-fresh500-gemma.json `
  -ConsensusOut runs\localized-sense-review-v11-fresh500-consensus.json `
  -SecondaryReviewAll
```

Status and controlled stop commands are:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File D:\linguago-runner\scripts\start-remote-localized-sense-review.ps1 `
  -Action status -RunId localized-sense-review-v11-fresh500-background

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File D:\linguago-runner\scripts\start-remote-localized-sense-review.ps1 `
  -Action stop -RunId localized-sense-review-v11-fresh500-background
```

Only one localized-sense Scheduled Task may run at a time. Starting a different
run while one is active fails rather than replacing the active task.

## Fresh500 completion and fresh2000 pressure run (2026-08-25)

`localized-sense-review-v11-fresh500` completed after resuming its primary
checkpoint. Qwen and Gemma both ended with 500/500 contract-valid reviews.
Adjudication produced 409 model-consensus rows and 91 manual-review rows. The
consensus decisions were 375 isolate, 33 keep, and 1 repair.

Two orchestration defects were found and fixed during the resume:

- PowerShell parameter names are case-insensitive. The Scheduled Task launcher
  used `$Action` for its public `start/status/stop` parameter and `$action` for
  the `MSFT_TaskExecAction` object. Assigning the latter violated the former's
  `ValidateSet`. The internal variable is now `$taskAction`.
- Blindly repeating a contract-invalid model response can reproduce the same
  error. Retry attempts now include the prior deterministic validation errors
  in the prompt. This repaired the final Gemma failure (`keep_requires_all_senses`)
  without weakening the contract.

The Scheduled Task job wrapper appends a transcript to
`runs\<run-id>\localized-sense-job.log`. Stage state remains in
`localized-sense-status.json`; model checkpoints remain the source of truth for
within-stage progress because stage status changes only at stage boundaries.

The only fresh500 repair consensus was Chinese `交给` under Japanese `くれる`.
The existing source links had only one independent source family. Strict
discovery found one exact WikDict link, but that source supplied only English
and Japanese terms. It did not create exact Chinese replacement-term support
from two independent families, so the repair is not eligible for application.
The authoritative product DB remains unchanged.

The 2,000-row pressure run is
`localized-sense-review-v12-fresh2000-background`. Its risk report contains
2,000 forms across 318 entries. The first 500 candidate IDs exactly match v11,
so the final v11 Qwen and Gemma reports were copied as v12 checkpoints; only
the remaining 1,500 rows per model are called. The run is read-only and must
finish Qwen, Gemma, and adjudication before scale readiness is frozen.

## Fresh2000 completion and native-target repair validation (2026-08-25)

`localized-sense-review-v12-fresh2000-background` completed. Qwen produced
2,000/2,000 valid reviews. Gemma produced 1,998/2,000 valid reviews; the two
invalid rows were retained for manual review and were not converted into model
decisions. Adjudication produced 1,599 consensus rows (79.95%): 1,443 isolate,
149 keep, and seven repair query forms. The run demonstrated checkpoint resume,
scheduled background execution, dynamic endpoint selection, and sustained
2,000-row review without a product DB write.

The original repair contract was ambiguous because it did not identify which
localization language and fields were wrong. Repair actions now include
`target_lang` and `fields`. Re-reviewing the seven repair rows under this
contract produced seven valid Qwen reviews, seven valid Gemma reviews, and
seven exact decisions. Five repair query forms deduplicated to four product
senses.

Cross-language source discovery must not count an LLM-enriched localization as
independent dictionary evidence. The source-link compiler therefore requires
an unchanged source sense, at least two exact seed languages, a replacement
different from the current product term, and the same native target-language
source headword in at least two independent source families. It selects only
the minimum source senses needed to establish that support.

This rejected `talk`, `anyway`, and `嗎`, including the tempting but incorrect
`what/何` evidence for `嗎`. It accepted only Japanese `くれる`, whose Chinese
replacement `给` is a native headword in both Wiktionary-family data and
CC-CEDICT. Qwen proposed and Gemma independently accepted the exact patch:

- term: `交给` -> `给`;
- reading: `jiāo gěi` -> `gěi`;
- definition: `交付; 交给; 付出; 供给` -> `交付；送与。`.

The exact repair compiler independently rechecks that every cited family has
the replacement as its native target-language headword. The patch was applied
only to `runs\localized-sense-review-v12-fresh2000-validation.db`. Product fast
audit passed with zero bad localization counts, duplicate sense orders,
orphans, mojibake, or HTML artifacts; published-risk remained
`flagged_senses=0`. The authoritative product DB and D1 remain unchanged.

This is the first end-to-end validated scalable localization-repair path. Scale
it by repeating review -> structured repair consensus -> evidence discovery ->
native dual-family source-link plan -> Qwen patch -> byte-identical Gemma
review -> exact repair plan. Low evidence yield is expected; unsupported rows
remain manual instead of weakening the source gate.

## High-frequency Mainland-Chinese query audit v14 (2026-08-26)

The risk reporter now supports `--query-lang`, `--primary-lang`, `--max-rank`,
`--min-senses`, and `--exclude-artifacts`. The dedicated high-frequency Chinese
route uses `query_lang=zh`, `max_rank=50000`, at most two forms per entry, and a
deterministic risk priority score. Placeholder forms such as `其他含义（拆分）`
and composite lookup forms such as `打开/发/教会` are excluded before model
review and retained in `deterministic_exclusions` with reason codes.

The authoritative jump-host DB produced 26,033 raw subset-risk forms. The
Chinese high-frequency filter retained 3,742, deterministically excluded 21
(19 composite and two placeholder forms), and selected 100 forms across 59
entries. The read-only background run is
`localized-sense-review-v14-zh-high-frequency100`:

- Qwen: 100/100 contract-valid; 95 isolate, two split, one repair, two keep;
- Gemma: 100/100 contract-valid; 100 isolate;
- consensus: 86 isolate and 14 manual review;
- disagreements: five decision, eight matched-sense-ID, one confidence;
- database writes: zero.

This cohort proves the deterministic queue and dynamic multi-endpoint review
path, but it is not itself an apply plan. The 86 isolation rows require a
separate, guarded query-isolation mapping plus Worker lookup regression. The 14
manual rows must not be converted into database or lookup changes without
additional evidence. Localization repair remains subject to the exact native
dual-family evidence gate described above.

The follow-up deterministic triage compared model consensus with the Worker’s
existing exact `normalized_term` binding. Of the 86 isolation rows, 79 already
match current runtime behavior and need no mapping or database change. Seven
rows proposed eight additional synonym-like sense bindings. Exact linked-source
audit found zero target-term evidence for all eight, so none is eligible for
automatic apply. Fourteen model disagreements and 21 composite/placeholder
localizations remain separate manual/evidence-acquisition queues.

The next non-overlapping batch is
`localized-sense-review-v15-zh-high-frequency-next500`, generated with
`offset=100`, `limit=500`, and at most two forms per entry. It contains 500
forms across 308 entries and runs Qwen primary plus full Gemma secondary review
without database writes.

v15 completed with 500/500 contract-valid Qwen reviews and 500/500
contract-valid Gemma reviews. Deterministic triage confirmed 384 current Worker
bindings, sent 43 rows (47 proposed added senses) to source evidence audit, and
retained 73 rows for manual review. Only three of the 47 proposals had any
exact linked-source evidence; none had two independent families, so automatic
apply remained zero. Product fast audit passed and published-risk remained
`flagged_senses=0`.

The next scale batch is `localized-sense-review-v16-zh-high-frequency-next2000`
with `offset=600`, `limit=2000`, 2,000 forms across 1,043 entries, full Qwen
primary review, and full Gemma secondary review. It is read-only and uses the
same checkpointed Scheduled Task path.

v16 completed without database writes. Qwen produced 1,994/2,000 valid
reviews and Gemma produced 1,997/2,000 valid reviews. Adjudication yielded
1,698 consensus rows and 302 direct model-disagreement rows. Deterministic
runtime triage then classified 1,388 rows as already handled by the Worker's
exact normalized-term binding, 46 as proposed additional sense bindings, and
566 as manual review. The 46 proposals all had valid product-sense identity,
but none had exact target-term evidence on a linked source sense, so the
two-independent-family gate approved zero automatic changes.

The final non-overlapping batch is
`localized-sense-review-v17-zh-high-frequency-final758`, generated with
`offset=2600`. Although the unbounded filtered report contains 3,721 eligible
forms, applying the production cap of at most two forms per entry leaves 3,358
reviewable forms; therefore the final page contains 758 forms across 481
entries rather than the earlier arithmetic estimate of 1,121. It runs as a
read-only checkpointed Scheduled Task with full Qwen and Gemma review.

v17 completed read-only. Qwen and Gemma each produced 753/758 contract-valid
reviews. Adjudication yielded 603 consensus rows and 155 direct disagreement
rows. Runtime triage confirmed 444 existing exact bindings, retained 280 rows
for manual review, and identified 34 rows that mentioned an additional sense.
Only 17 concrete added-sense proposals remained after identity extraction;
none had exact linked-source evidence and none passed the two-family gate.

Across v14-v17, the bounded high-frequency Chinese pass reviewed all 3,358
forms selected by the two-forms-per-entry policy. Deterministic triage confirmed
2,295 current Worker bindings and retained 933 rows for manual review. The four
evidence audits evaluated 118 concrete added-sense proposals; three had any
exact linked-source evidence and zero had two independent source families.
Consequently this review pass made no automatic product-DB or D1 changes. The
21 composite/placeholder forms are one shared deterministic exclusion set, not
21 new failures per page. Post-run product fast audit passed with 51,736
publishable senses and every blocking integrity counter at zero;
published-risk remained `flagged_senses=0`.
