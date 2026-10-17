# Evidence-Gated-84 Local Status

## Scope

This document preserves the chronological local evidence-gated milestones.
The completed v83 chain was deployed to Cloudflare D1 on 2026-08-02. Current
production uses cache `v83-production-chunk05-29087`, Worker version
`1d5dd96d-f524-4e54-8816-25237302af22`, and D1 `published_at`
`2026-08-02T11:10:10.971Z`. Online counts are `entries=29087`, `senses=34604`,
`sense_localizations=138416`, `examples=3030`, and
`example_localizations=11898`. Later statements that production remained v82
describe the historical state at those individual milestones.

## Candidate History

The source-gap attempt index now includes actual generation records,
checkpoint attempts, and valid remote-review rejections. It intentionally
excludes review approvals and manual-review-only rows because neither has
entered generation. This prevents previously rejected candidates from being
selected repeatedly without hiding candidates that still need a generation
attempt.

## Second Fresh OMW Batch

The second OMW-aligned review ran on 20 candidates. It produced 20 valid JSON
responses: 17 approvals and 3 rejections. Independent reviewer-term evidence
retained 16 approved candidates. The generation run accepted 15 of 16, and the
post-generation reverse-evidence gate retained 14 of 15.

There were no endpoint, model-load, or JSON parse failures. The 14 supported
rows replayed and promoted 14/14 in an isolated validation DB and then in the
local product DB.

Replays inherit `enforce_reviewed_preferred_terms` from the source generation
report unless explicitly overridden. Preserve this behavior: hard matching can
reject valid close synonyms that passed a soft-policy generation run.

## Local Evidence-Gated-84 Export

- backup before main replay:
  `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-fresh-omw1-second20-supported14-20260727-171818.db`
- export: `outputs/d1-v2-product-native-export-v83-evidence-gated-84`
- entries: `28370`
- senses: `33887`
- sense localizations: `135548`
- examples: `3030`
- example localizations: `11898`
- blockers: `0`
- `flagged_senses`: `0`
- non-blocking `duplicate_sense_localizations`: `98`

The following checks passed: TypeScript, source-gap large-batch checkpoint
fixture, product fast audit, full in-memory D1 export audit, and published-risk
audit.

## Next Gate

This is the second successful end-to-end sample after the preceding 13/16
promotion. The next step is a 50-row draft-only validation batch built with
the corrected attempt index. Do not jump to 500 rows or deploy to D1 until that
run meets the deterministic evidence and audit gates.

## 50-Row Draft-Only Validation

The corrected history index scanned 374 reports and ten checkpoints, with no
parse failures, and excluded 4,752 previously attempted or explicitly rejected
source entries. The next OMW-aligned pool contained 50 fresh pt-BR candidates.

Remote evidence review on gpu-node-a6000 and RTX4090-56 completed with 50 valid JSON
responses, 44 approvals, six rejections, and no endpoint or model failures.
Independent reviewer-term evidence retained 38 of the 44 approved candidates.

Generation accepted 34 of 38 candidates (89.5%). All 34 accepted candidates
then passed reverse evidence for all four languages. The four generation
rejections were quality-review decisions, not infrastructure failures:

- `traficar`: the source anchor `peddle` did not preserve the illegal-trafficking
  sense of the Portuguese headword.
- `batatinha`: the diminutive Portuguese sense was generalized to ordinary
  `potato`.
- `tromba`: the generated Japanese term and reading were incorrect.
- `felicitar`: the generated Japanese term was an unsuitable archaic sense.

The 34 independently supported rows were written only as
`draft_single_source`, with 136 review localizations. They were not promoted.
The product fast audit reports zero review-localization leakage, zero orphans,
zero duplicate sense orders, zero mojibake, and zero HTML artifacts.
Publishable senses remain `33887` and `flagged_senses` remains zero.

Because generation acceptance was 89.5%, just below the 90% expansion gate,
do not start the 500-row batch yet. Keep the four rejected candidates out of
automatic promotion, promote the 34 supported drafts only after an isolated
copy audit, and run one more focused 20-row sample before expanding.

## Evidence-Gated-85 Promotion

The 34 supported drafts promoted 34/34 in an isolated database. The validation
export passed fast audit, full in-memory D1 export audit, and published-risk
audit with no blockers. The same 34 rows were then promoted in the local main
product DB and audited again.

The local evidence-gated-85 export contains:

- entries: `28404`
- senses: `33921`
- sense localizations: `135684`
- examples: `3030`
- example localizations: `11898`
- `bad_sense_localization_counts`: `0`
- `duplicate_sense_orders`: `0`
- orphans, mojibake, and HTML artifacts: `0`
- `flagged_senses`: `0`
- non-blocking duplicate-localization warning: `98`

TypeScript and the source-gap large-batch checkpoint/circuit-breaker fixture
also pass. Production D1 remains v82. Run one more focused 20-row sample before
opening the 500-row generation stage.

## Focused 20-Row Follow-Up

The history index grew to 4,796 source-entry IDs. Candidate selection excluded
both that index and all 50 rows from the previous sample, so this follow-up did
not reuse prior reviewed candidates.

Remote review produced 20 valid JSON responses, 17 approvals, three rejections,
and no endpoint/model failures. Reviewer-term evidence accepted all 17
approved candidates. Full generation accepted 13 of 17 (76.5%): two rows
failed source-evidence alignment and two failed quality validation. Final
reverse evidence retained 12 rows and left one manual review.

The main failure examples show that the remaining OMW1 tail is lower quality:

- `harmônica` was incorrectly anchored to `accordion`.
- `plantio` was incorrectly anchored to `plantation`.
- `vassalo` received an imprecise Japanese feudal term.
- `astrólogo` failed the quality-review response stage.

The 12 fully supported rows were written as draft-only data with 48 review
localizations. Fast audit confirms no review-localization leakage and no
publishable-count change. Do not open the 500-row stage from this OMW1 tail.
The next candidate pool must use stricter source-sense alignment or a different
evidence bucket before another scale test.

## Two-Source Source-Sense Gate

The earlier OMW1 tail exposed circular single-source errors such as
`harmônica -> accordion`. The next experiment therefore required the
Portuguese source term and English anchor to agree in both FreeDict and WikDict.
The target-language evidence still had to cover at least two languages, but it
could come from any supported reverse dictionary rather than only one OMW
synset.

From 1,331 residual candidates:

- 88 had two-source source-sense support.
- 33 also had at least two target languages with deterministic evidence.
- Requiring one OMW target language as well would have left only one row, so
  that combination is too restrictive for production selection.

A fresh 20-row sample from the 33-row two-target pool produced 18 remote-review
approvals. Reviewer-term evidence retained 14. Full generation accepted 13 of
14 (92.9%), and final reverse evidence retained 12 with one manual-review row.
There were no endpoint, model-load, or JSON transport failures.

The 12 fully supported rows were written as draft-only data, with no
publishable-count change or review-localization leakage. This policy passed the
90% generation gate and the 80% deterministic-retention gate. It is the current
preferred candidate policy, but this exact two-target pool has only 13 untested
rows remaining. Broader scaling must draw from the 88-row one-target pool or
rebuild coverage from additional evidence sources; it cannot produce a
500-row batch by itself.

## One-Target-Only Diagnostic

The broader two-source pool had 88 candidates with at least one target-language
evidence path. After excluding all 33 two-target candidates, a fresh 20-row
one-target-only sample received 20/20 remote-review approval with no
infrastructure or JSON failures.

Pre-generation term validation retained only three rows because 13 candidates
had no deterministic Chinese preferred term. A diagnostic dry-run nevertheless
generated all 20 rows so the model-selected target terms could be evaluated.
Generation accepted 17/20, but final reverse evidence retained only seven,
marked seven for manual review, and rejected three.

The seven fully supported rows were written as draft-only data. Fast audit
confirmed no review-localization leakage or publishable-count change.

Conclusion: two-source source-sense agreement is effective, but one
target-language evidence path is insufficient for automatic four-language
publication. Keep the two-target policy as the automatic path. Route one-target
rows to manual or an independent second-model consensus workflow; do not use
them to build a 500-row automatic batch.

## Two-Target Remainder on gpu-node-a6000

The original two-source/two-target pool contained 33 candidates. A reusable
report-subtraction script now removes previously sampled source entry IDs
without relying on PowerShell JSON parsing:

- script: `scripts/subtract-dictionary-v2-product-source-gap-report.mjs`
- input rows: 33
- previously sampled rows: 20
- fresh remainder: 13

The first attempt against the former 143/56 endpoints produced 13/13
`fetch failed` results. These were infrastructure failures only; no candidate
was rejected semantically and no database write occurred. After the available
node changed, the current Windows port-proxy table was verified directly:
`100.64.0.1:11442 -> 10.0.0.151:8888`. Direct LAN access from the local
workstation timed out, so the verified Tailscale jump-host mapping is required.

The gpu-node-a6000 Unsloth service was healthy on Studio `v0.1.501-beta`. Its local
model inventory included:

- `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`
- `unsloth/Qwen3.6-27B-MTP-GGUF`
- `unsloth/gemma-4-31B-it-qat-GGUF`

The 13-row pipeline used only gpu-node-a6000 and Qwen3.6 35B:

- source-sense review: 13 valid responses, 12 accepted, one rejected (`gonzo`)
- reviewed-term reverse evidence: 11 supported, one manual review
- full four-language generation: 10/11 accepted
- final reverse evidence: 10/10 supported in all four languages
- endpoint/model/JSON failures: 0

The ten supported records were written only as `draft_single_source`, adding
10 draft entries, 10 draft senses, and 40 review localizations. They did not
change the publishable count. The post-write fast audit reports:

- publishable senses: `33921`
- review-localization leakage: `0`
- duplicate sense orders: `0`
- orphans, mojibake, and HTML artifacts: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

The database backup before this write is
`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-two-source-target2-remaining13-draft10-20260728-135020.db`.
Production D1 remains v82.

Because gpu-node-a6000 also has Gemma 4 31B, it can provide a genuinely independent
model-family review for the one-target manual queue. Qwen 35B versus Qwen 27B
must still not be counted as independent consensus.

## One-Target Cross-Model Consensus

A read-only cross-model reviewer is now implemented in
`scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs`. It
rejects reviewer/generator pairs from the same model family and has no promote
or database-write interface. Consensus acceptance requires:

- reviewer decision `accept`
- confidence at least `0.90`
- an empty corrections list

The first test reviewed the ten non-supported results from the one-target
diagnostic. Qwen3.6 35B generated the records; Gemma 4 31B on gpu-node-a6000 acted
as the independent reviewer:

- targeted: 10
- valid JSON responses: 10
- consensus accepted: 8
- rejected: 2
- endpoint/model failures: 0

Gemma rejected `dorminhoco` because the Portuguese word primarily describes a
habitual sleepyhead rather than the temporary state expressed by `sleepy`.
It rejected `afinidade` because generated Chinese `亲和力` was narrower than
the general `affinity` source sense. The other eight rows passed the independent
semantic review, but remain non-publishable until they are written as drafts
and pass the usual deterministic promote audit in an isolated database.

The eight consensus-approved rows were subsequently converted into a standard
generation replay report and written to the main product database as drafts
only:

- draft entries: 8
- draft senses: 8
- review localizations: 32
- publishable-count change at draft write: 0

Two additional safety tools make this path reproducible:

- `scripts/build-dictionary-v2-product-source-gap-consensus-replay.mjs`
  converts only valid, correction-free, high-confidence consensus approvals
  into a standard generation replay.
- `scripts/convert-dictionary-v2-product-source-gap-consensus-to-semantic-review.mjs`
  requires a unique `source_entry_id -> product_sense_id` draft mapping and
  emits both a semantic-review report and a sense-ID checkpoint.

The eight drafts were promoted only in validation database
`linguago_v2_product_top5000_freedict_filtered_candidate.validation-one-target-consensus8-20260728-135854.db`.
Dry-run and apply both accepted 8/8. Fast audit, published-risk audit, native
D1 export, and full in-memory import audit all passed:

- export entries: `28412`
- export senses: `33929`
- sense localizations: `135716`
- examples: `3030`
- example localizations: `11898`
- bad localization counts, duplicate sense orders, orphans, mojibake, HTML,
  pronunciation-group mismatches, and published-risk flags: `0`
- non-blocking duplicate-localization warning: `98`

The main product database still keeps these eight rows as drafts. Production
D1 remains v82.

## Evidence-Gated-86 Promotion

After the isolated validation passed, the eight cross-model consensus drafts
were promoted in the main product database using the same fixed sense-ID
checkpoint and semantic-review report. A pre-promotion backup was created:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-one-target-consensus8-promote-20260728-140424.db`

The main promotion changed exactly:

- senses promoted: 8
- entries promoted: 8
- localizations promoted: 32

TypeScript, fast audit, published-risk audit, native D1 export, and full
in-memory import audit all passed. The local evidence-gated-86 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-86` and contains:

- entries: `28412`
- entry forms: `193678`
- pronunciation groups: `30237`
- senses: `33929`
- sense localizations: `135716`
- examples: `3030`
- example localizations: `11898`
- blocking audit findings and published-risk flags: `0`
- non-blocking duplicate-localization warning: `98`

Production D1 remains v82; evidence-gated-86 is local only.

## Evidence-Gated-87 Promotion

The ten remaining records from the two-source/two-target pool were promoted
after a second isolated validation. A new conservative checkpoint builder,
`scripts/build-dictionary-v2-product-source-gap-reverse-evidence-checkpoint.mjs`,
accepts only rows with `generation_valid=true` and `decision=supported`, then
requires each source sense to map to exactly one `draft_single_source` product
sense.

The checkpoint mapped 10/10 drafts. Validation dry-run and apply accepted
10/10, and validation fast, published-risk, native export, and full in-memory
import audits passed. The same fixed checkpoint then promoted exactly ten
senses and forty localizations in the main product database.

The pre-promotion backup is:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-two-source-target2-remaining10-promote-20260728-140658.db`

The local evidence-gated-87 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-87`:

- entries: `28422`
- entry forms: `193738`
- pronunciation groups: `30247`
- senses: `33939`
- sense localizations: `135756`
- examples: `3030`
- example localizations: `11898`
- blocking audit findings and published-risk flags: `0`
- non-blocking duplicate-localization warning: `98`

The exact two-source/two-target candidate pool is now exhausted. Production D1
remains v82; evidence-gated-87 is local only.

## Evidence-Gated-87 Coverage Refresh

The coverage pool was rebuilt after the evidence-gated-87 promotion so that
newly published entries and every recorded source-gap attempt are excluded
before another model call.

The refreshed attempt index scanned 443 JSON run artifacts without parse
failures and found 4,864 unique source entry IDs that had actually reached
generation, an attempted checkpoint state, or a valid remote-review rejection.
Review-only selections that never reached generation remain eligible.

The latest raw coverage scan used the current product database, source ranks up
to 200,000, and a 50,000-row output limit:

- ranked source entries scanned: `126439`
- already represented: `51465`
- source gaps: `72565`
- raw rows selected: `50000`

The strict coverage filter then removed prior attempts, abbreviations, proper
names, mojibake, HTML artifacts, weak source evidence, broad glosses, and other
known low-value categories. It retained 1,304 clean rows:

- pt-BR: `1177`
- ja: `114`
- zh: `12`
- en: `1`

The language imbalance is an evidence limitation, not a scheduling target:
almost all remaining Chinese, Japanese, and English rows fail the current
open-source evidence gates. They must not be sent to a large undifferentiated
LLM batch merely to satisfy a language quota.

The reverse-evidence prefilter found:

- two matching source dictionaries and at least two target-language evidence
  matches: `11` rows
- two matching source dictionaries and at least one target-language evidence
  match: `47` rows
- one-target-only remainder after subtracting the first pool: `36` rows

All 47 evidence-supported rows are pt-BR. The 11 stronger candidates are:
`torrente`, `racha`, `galope`, `brejo`, `filtrar`, `assassínio`,
`semanalmente`, `videira`, `sintonizar`, `perdiz`, and `pistão`.

The next execution order is fixed:

1. Run the 11 two-target rows through the normal small-batch generation and
   reverse-evidence validation path.
2. Route the 36 one-target-only rows through independent Qwen generation and
   Gemma consensus review.
3. Write accepted results as drafts only, validate and promote in an isolated
   database, then repeat the exact checkpoint against the main database.

No LLM was called during this refresh. Production D1 remains v82, and the
evidence-gated-87 product database remains the current local baseline.

## Evidence-87 Two-Target Follow-up

The 11 refreshed two-source/two-target candidates were reviewed on gpu-node-a6000
through `100.64.0.1:11442` using
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF`. Source-sense review returned 11 valid
responses and accepted all 11 at confidence 0.95, with no endpoint, model, or
JSON failures.

The reviewed preferred terms were then checked independently against the
source database before full generation:

- supported: `1`
- manual review: `5`
- unsupported: `5`

The only row supported across all four languages was `pistão`. This large
reduction is intentional: a candidate passing the initial two-target prefilter
does not guarantee that the model's final preferred Chinese and Japanese terms
match independent dictionary evidence.

`pistão` generated successfully in 2.36 seconds. Its final terms were
`piston`, `pistão`, `活塞`, and `ピストン`; the post-generation reverse-evidence
validator supported all four languages. The accepted record was replayed into
the main product database as draft only:

- draft entries inserted: `1`
- draft senses inserted: `1`
- review localizations inserted: `4`
- publishable-sense change: `0`

The pre-write backup is:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence87-pistao-draft-20260728-141505.db`

Post-write fast and published-risk audits passed:

- publishable senses: `33939`
- bad publishable localization counts: `0`
- review-localization leakage: `0`
- duplicate sense orders, orphans, mojibake, and HTML artifacts: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

The next safe operation is an isolated-database promote dry-run and apply for
the single `pistão` draft. The other ten reviewed candidates must remain out of
the automatic promote path and be routed to independent-model consensus or
manual review. Production D1 remains v82.

## Evidence-Gated-88 Promotion

The single `pistão` draft was promoted first in validation database
`linguago_v2_product_top5000_freedict_filtered_candidate.validation-pistao-20260728-141650.db`.
The reverse-evidence checkpoint mapped exactly one source sense to exactly one
draft product sense. Promote dry-run and apply both accepted 1/1.

Validation fast audit, published-risk audit, native D1 export, and full
in-memory import audit all passed. The same fixed checkpoint was then applied
to the main product database after creating this backup:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence88-pistao-promote-20260728-141737.db`

The main promotion changed exactly:

- senses promoted: `1`
- entries promoted: `1`
- localizations promoted: `4`
- examples promoted: `0`

The local evidence-gated-88 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-88`:

- entries: `28423`
- entry forms: `193744`
- pronunciation groups: `30248`
- senses: `33940`
- sense localizations: `135760`
- examples: `3030`
- example localizations: `11898`
- count mismatches and all blocking audit findings: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

The remaining five manual and five unsupported rows from this 11-row follow-up
were not written or promoted. They require independent-model consensus or
manual review. Production D1 remains v82; evidence-gated-88 is local only.

## Evidence-87 Independent Consensus Follow-up

The ten rows that did not pass the reviewed-term reverse-evidence gate were
kept out of the automatic path and processed with two independent model
families on gpu-node-a6000:

- generator: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`
- reviewer: `unsloth/gemma-4-31B-it-qat-GGUF`
- endpoint: `100.64.0.1:11442`

Qwen generated ten responses. Seven passed the generator's deterministic
schema and content validation; three were rejected after two attempts. There
were no endpoint or infrastructure failures.

Gemma independently reviewed the seven valid generations:

- valid reviews: `7`
- consensus accepted: `6`
- rejected: `1`
- manual review: `0`
- model, network, and JSON failures: `0`

The accepted rows were `torrente`, `galope`, `brejo`, `filtrar`, `assassínio`,
and `perdiz`. Gemma rejected `sintonizar` because generated Japanese
`同調する` is too technical or abstract for the ordinary receiver-tuning sense;
the usual term should be `合わせる` or `チューニングする`.

The six correction-free, confidence-1.0 consensus approvals were converted to
a standard replay and inserted into the main product database as drafts only:

- draft entries inserted: `6`
- draft senses inserted: `6`
- review localizations inserted: `24`
- publishable-sense change: `0`

The pre-write backup is:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence88-consensus6-draft-20260728-143538.db`

Post-write fast and published-risk audits passed. Publishable senses remain
`33940`, review-localization leakage is zero, and published-risk remains zero.
The next safe step is isolated-database promote validation for these six fixed
draft IDs. Production D1 remains v82.

## Evidence-Gated-89 Promotion

The six independent-model consensus drafts were promoted first in validation
database
`linguago_v2_product_top5000_freedict_filtered_candidate.validation-consensus6-20260728-143701.db`.
The consensus converter mapped all six source rows to unique draft sense IDs.
Promote dry-run and apply both accepted 6/6.

Validation fast audit, published-risk audit, native export, and full in-memory
import audit passed. The same fixed checkpoint and semantic-review report were
then applied to the main product database after creating this backup:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence89-consensus6-promote-20260728-143741.db`

The main promotion changed exactly:

- senses promoted: `6`
- entries promoted: `6`
- localizations promoted: `24`
- examples promoted: `0`

The local evidence-gated-89 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-89`:

- entries: `28429`
- entry forms: `193780`
- pronunciation groups: `30254`
- senses: `33946`
- sense localizations: `135784`
- examples: `3030`
- example localizations: `11898`
- count mismatches and all blocking audit findings: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

Production D1 remains v82; evidence-gated-89 is local only. The remaining
failed or rejected candidates stay excluded from publication.

## Evidence-Gated-89 Coverage Refresh

The source-gap attempt index and coverage pool were rebuilt after the
evidence-gated-89 promotion:

- JSON run artifacts scanned: `476`
- unique source entries with real attempts: `4875`
- parse failures: `0`
- ranked source entries scanned: `126439`
- represented source entries: `51480`
- remaining source gaps: `72550`
- raw rows retained for filtering: `50000`

Strict filtering retained 1,293 clean candidates:

- pt-BR: `1166`
- ja: `114`
- zh: `12`
- en: `1`

The two-source reverse-evidence prefilter found 36 source-supported rows, but
none had at least two independently supported target languages. Therefore the
automatic reverse-evidence path is currently exhausted:

- two-source plus two-target candidates: `0`
- two-source plus one-target candidates: `36`

All 36 rows are pt-BR. They must use the independent-family consensus path:
Qwen generation followed by Gemma review, draft-only write, isolated promote,
and full audit. They must not be promoted by relaxing the two-target gate.

The next batch should use the first 20 rows as a bounded consensus dry-run.
Production D1 remains v82.

## Evidence-89 One-Target Focused-20

The first 20 rows from the 36-row one-target queue were processed on gpu-node-a6000
without writing publishable data.

Qwen source-sense review:

- reviewed: `20`
- approved: `19`
- rejected: `1` (`salmo`)
- endpoint, model, and JSON failures: `0`

Qwen full four-language generation:

- targeted: `19`
- deterministic-valid generations: `13`
- validation rejects after at most two attempts: `6`
- infrastructure failures: `0`

Post-generation reverse evidence directly supported 3/13 rows across all four
languages. The remaining ten rows were reviewed by the independent Gemma 4
31B model:

- valid reviews: `10`
- consensus accepted: `7`
- rejected: `3`
- manual review and failures: `0`

The batch therefore produced ten draft-eligible records through two separate
evidence routes:

- full reverse-evidence support: `3`
- Qwen/Gemma independent consensus: `7`

All ten were written to the main product database as drafts only:

- draft entries inserted: `10`
- draft senses inserted: `10`
- review localizations inserted: `40`
- publishable-sense change: `0`

The pre-write backup is:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence89-focused20-draft10-20260729-095812.db`

Fast and published-risk audits passed. Publishable senses remain `33946`,
review-localization leakage is zero, and published-risk remains zero. The next
step is isolated promotion using separate fixed checkpoints for the three
reverse-evidence rows and seven consensus rows. Production D1 remains v82.

## Evidence-Gated-90 Promotion

The focused-20 batch used two independent fixed checkpoints:

- three rows supported by final four-language reverse evidence
- seven rows approved by correction-free Qwen/Gemma consensus

Both checkpoints mapped every source row to exactly one draft sense. In
validation database
`linguago_v2_product_top5000_freedict_filtered_candidate.validation-focused20-draft10-20260729-101853.db`,
dry-run and apply accepted 3/3 and 7/7 respectively.

Validation fast audit, published-risk audit, native D1 export, and full
in-memory import audit all passed. The exact checkpoints were then applied to
the main product database after creating this backup:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence90-focused20-promote10-20260729-101943.db`

The main promotion changed exactly:

- senses promoted: `10`
- entries promoted: `10`
- localizations promoted: `40`
- examples promoted: `0`

The local evidence-gated-90 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-90`:

- entries: `28439`
- entry forms: `193840`
- pronunciation groups: `30264`
- senses: `33956`
- sense localizations: `135824`
- examples: `3030`
- example localizations: `11898`
- count mismatches and all blocking audit findings: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

Production D1 remains v82; evidence-gated-90 is local only.

## Evidence-Gated-91 Remaining-16 Batch

The remaining 16 one-target candidates from the evidence-89 coverage report
were processed through the same evidence-gated path:

- Qwen source review approved `13/16`
- source review rejected `entediar`, `pires`, and `chilique`
- Qwen generated `13` records, of which `12` passed deterministic validation
- reverse evidence classified the valid generations as `5 supported`,
  `5 manual`, and `2 unsupported`
- Gemma independently reviewed the seven rows without reverse support and
  accepted `5`; `agridoce` and `rosnar` were rejected

This produced ten draft-eligible records:

- full four-language reverse evidence: `5`
- correction-free Qwen/Gemma consensus: `5`

The ten records were first written as `draft_single_source` with
`needs_review=1`. Fast and published-risk audits confirmed that publishable
counts did not change and no review localization leaked into the exportable
set.

Separate fixed checkpoints were then generated for the reverse-evidence and
consensus paths. Both checkpoints mapped every source row to exactly one draft
sense. Dry-run and apply accepted `5/5` for each path in
`linguago_v2_product_top5000_freedict_filtered_candidate.validation-v83-evidence91.db`.
The validation fast audit, published-risk audit, native D1 export, and full
in-memory import audit all passed.

The same checkpoints were applied to the main product database after creating:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence91-remaining16-promote10-20260729.db`

The main promotion changed exactly:

- senses promoted: `10`
- entries promoted: `10`
- localizations promoted: `40`
- examples promoted: `0`

The local evidence-gated-91 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-91`:

- entries: `28449`
- entry forms: `193900`
- pronunciation groups: `30274`
- senses: `33966`
- sense localizations: `135864`
- examples: `3030`
- example localizations: `11898`
- count mismatches and all blocking audit findings: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

Production D1 remains v82; evidence-gated-91 is local only.

## Evidence-91 Coverage Refresh and Polysemous Draft-16

Coverage was rebuilt against the evidence-gated-91 product database and a new
attempt index:

- run artifacts scanned: `526`
- unique genuinely attempted source entries: `4911`
- attempt-index parse failures: `0`
- ranked source entries scanned: `126439`
- represented source entries: `51521`
- remaining source gaps: `72509`
- raw rows retained for strict filtering: `50000`

Strict filtering retained `1259` fresh candidates:

- pt-BR: `1131`
- ja: `115`
- zh: `12`
- en: `1`

The unchanged two-source reverse-evidence gate found no automatic candidates:

- two-source plus one target: `0`
- two-source plus two targets: `0`
- manual review: `93`
- unsupported: `1166`

Of the 93 manual rows, 25 had two source dictionaries but a low match ratio
caused by polysemy. The deterministic selector
`select-dictionary-v2-product-source-gap-manual-review.mjs` selected the 20
highest-frequency rows and preserved the evidence reason and matching sources
in candidate provenance.

gpu-node-a6000 source review with Qwen 35B returned:

- reviewed: `20`
- approved: `17`
- rejected: `3` (`basear`, `ascender`, `frear`)
- manual or failed: `0`

Full four-language dry-run generation produced 16 deterministic-valid records
and one validation reject, with no infrastructure failure. Post-generation
reverse evidence classified the 16 valid records as:

- supported: `6`
- manual review: `6`
- unsupported: `4`

The ten records without full reverse support were independently reviewed by
Gemma 4 31B. All ten received correction-free confidence-1.0 consensus
approval. The six reverse-supported rows and ten consensus rows were replayed
separately into the main database as drafts only:

- draft entries inserted: `16`
- draft senses inserted: `16`
- review localizations inserted: `64`
- publishable-sense change: `0`

The pre-write backup is:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence91-polysemous-draft16-20260729.db`

Fast and published-risk audits passed. Publishable senses remain `33966`,
review-localization leakage is zero, and all blocking findings and risk flags
remain zero. The next operation is isolated promotion using separate fixed
checkpoints for the six reverse-supported and ten consensus rows. Production
D1 remains v82.

## Evidence-Gated-92 Promotion

The polysemous draft-16 batch was promoted through two fixed checkpoints:

- six rows supported by final four-language reverse evidence
- ten rows approved by correction-free Qwen/Gemma consensus

Both checkpoint builders mapped every source row to exactly one draft sense.
In validation database
`linguago_v2_product_top5000_freedict_filtered_candidate.validation-v83-evidence92-polysemous16.db`,
dry-run and apply accepted `6/6` and `10/10`.

Validation fast audit, published-risk audit, native D1 export, and full
in-memory import audit all passed. The same checkpoints were applied to the
main product database after creating:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence92-polysemous16-promote-20260729.db`

The main promotion changed exactly:

- senses promoted: `16`
- entries promoted: `16`
- localizations promoted: `64`
- examples promoted: `0`

The local evidence-gated-92 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-92`:

- entries: `28465`
- entry forms: `193996`
- pronunciation groups: `30290`
- senses: `33982`
- sense localizations: `135928`
- examples: `3030`
- example localizations: `11898`
- count mismatches and all blocking audit findings: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

Production D1 remains v82; evidence-gated-92 is local only.

## Evidence-92 Coverage Refresh and Polysemous Draft-2

Coverage was rebuilt after evidence-gated-92:

- attempt artifacts scanned: `552`
- unique genuinely attempted source entries: `4931`
- attempt-index parse failures: `0`
- ranked source entries scanned: `126439`
- represented source entries: `51545`
- remaining source gaps: `72485`
- strict clean candidates: `1241`

The strict reverse-evidence path remained exhausted:

- source-supported automatic candidates: `0`
- manual-review candidates: `73`
- unsupported candidates: `1168`

The 20 previously processed polysemous rows disappeared from the fresh pool.
Only five two-source, low-match-ratio rows remained: `quite`, `cerne`,
`destinatário`, `detestar`, and `audaz`.

Qwen source review approved four and rejected `quite`. Four-language generation
then produced three deterministic-valid records; `cerne` was rejected by the
quality review. None of the three valid generations passed full reverse
evidence:

- manual review: `1`
- unsupported: `2`

Gemma independently accepted `detestar` and `audaz` at confidence 1.0 and
rejected `destinatário`. The two correction-free consensus rows were replayed
into the main database as drafts only:

- draft entries inserted: `2`
- draft senses inserted: `2`
- review localizations inserted: `8`
- publishable-sense change: `0`

The pre-write backup is:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence92-polysemous-remaining2-draft-20260729.db`

Fast audit, TypeScript check, and published-risk audit passed. Publishable
senses remain `33982`, review-localization leakage is zero, and all blocking
findings and risk flags remain zero. The next operation is isolated promotion
for the two fixed consensus drafts. Production D1 remains v82.

## Evidence-Gated-93 Promotion

The `detestar` and `audaz` drafts were converted from the correction-free
Qwen/Gemma consensus report into a fixed sense-ID checkpoint. The converter
mapped both source rows to exactly one draft sense.

In validation database
`linguago_v2_product_top5000_freedict_filtered_candidate.validation-v83-evidence93-consensus2.db`,
promote dry-run and apply accepted `2/2`. TypeScript check, validation fast
audit, published-risk audit, native D1 export, and full in-memory import audit
all passed.

The same checkpoint was applied to the main product database after creating:

`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-evidence93-consensus2-promote-20260729.db`

The main promotion changed exactly:

- senses promoted: `2`
- entries promoted: `2`
- localizations promoted: `8`
- examples promoted: `0`

The local evidence-gated-93 export is
`outputs/d1-v2-product-native-export-v83-evidence-gated-93`:

- entries: `28467`
- entry forms: `194008`
- pronunciation groups: `30292`
- senses: `33984`
- sense localizations: `135936`
- examples: `3030`
- example localizations: `11898`
- count mismatches and all blocking audit findings: `0`
- published-risk flagged senses: `0`
- non-blocking duplicate-localization warning: `98`

Production D1 remains v82; evidence-gated-93 is local only.

## Evidence-93 Thin-Evidence Source Review

Coverage was rebuilt after evidence-gated-93:

- generation artifacts scanned: `573`
- generation reports: `136`
- checkpoints: `10`
- unique genuinely attempted source entries: `4936`
- attempt-index parse failures: `0`
- ranked source entries scanned: `126439`
- represented source entries: `51548`
- remaining source gaps: `72482`
- strict clean candidates: `1236`

The strict reverse-evidence prefilter found no automatically supported rows:

- source-supported automatic candidates: `0`
- manual-review candidates: `68`
- unsupported candidates: `1168`

All 68 manual rows had `no_strong_reverse_dictionary_evidence`. The manual
selector now supports language quotas, excluded languages, explicit residual
words, and conservative proper-name/encyclopedic-gloss filtering. A balanced
20-row pool was built with `zh=2`, `ja=10`, and `pt-BR=8`. Known noisy rows
`两个`, `ミロ`, `pepperoni`, `thorn`, and `drift` were excluded explicitly.

Qwen source review ran only on gpu-node-a6000 through
`http://100.64.0.1:11442`, using
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF / UD-Q4_K_XL`:

- prewarm: passed in `6.43s`
- valid structured reviews: `20/20`
- accepted for possible four-language generation: `17`
- rejected: `3`
- manual review: `0`
- transport or parse failures: `0`
- typical per-row review time: approximately `1s`

The three conservative rejections were useful:

- `就坐`: source row treated the verb as the noun `sitting`
- `風変り`: source gloss `quaint` did not match the normal `strange/odd` sense
- `inundações`: source evidence mixed flooding with an unrelated therapy sense

The 17 accepted rows are source-screened candidates only. They have not been
generated, inserted as drafts, promoted, exported, or deployed. Because this
path lacks strong independent reverse-dictionary evidence, any later promotion
still requires four-language deterministic validation plus an independent
review/checkpoint. Production D1 remains v82.

## Evidence-94/95 Thin-Evidence Generation and Pressure Gate

The first 17 source-screened rows exposed a prompt/validator contract bug:

- compact generation did not request `source_evidence_valid`
- the validator required that field
- compact generation did not receive reviewed preferred terms
- exact preferred-term enforcement nevertheless rejected target-language synonyms

The compact prompt now declares the evidence fields and passes preferred terms
only when exact enforcement is enabled. With exact target-term enforcement
disabled, source headword equality remains strict while valid target synonyms
are allowed through deterministic and independent semantic review.

The shorter `micro` JSON prompt performed better:

- compact after contract repair: `9/17` deterministic-valid
- micro with two attempts: `12/17` deterministic-valid
- per-call generation time was usually `1.5-1.9s`
- transport and JSON failures: `0`

Qwen/Gemma independent consensus plus residual repair promoted:

- evidence-94 direct consensus: `6`
- evidence-95 residual consensus: `4`
- total new publishable senses from the thin-evidence pilot: `10`

The main database reached `33994` publishable senses after evidence-95. All
blocking fast-audit findings and published-risk flags remained zero.

### Unsupported-Conflict 100-Row Pressure Test

The strict reverse-evidence path was exhausted, so a guarded pressure pool was
built from `strong_dictionary_gloss_conflict` rows. These rows never bypass
model review or deterministic validation.

Pool composition:

- `pt-BR=80`
- `ja=18`
- `zh=2`

Qwen source review:

- reviewed: `100`
- valid structured responses: `100`
- accepted for generation: `69`
- rejected before generation: `31`
- infrastructure or parse failures: `0`

Qwen micro generation:

- generated: `69`
- deterministic-valid after two attempts: `55`
- rejected: `14`
- infrastructure failures: `0`
- JSON failures: `0`
- chunks completed: `3`

Gemma independent review:

- targeted drafts: `55`
- valid reviews: `54`
- consensus accepted: `43`
- semantic rejects: `11`
- one repeated JSON truncation residual: `inalador`

The Gemma reviewer now supports `--resume true`, so valid prior reviews are
reused and only failed rows are retried. Increasing the token limit did not fix
the repeated self-correcting `inalador` response; it remains unpromoted.

The consensus converter also had a scale-only ID bug: it assumed
`source_entry_id == source_sense_id`. This failed for `参事`, whose entry ID is
`875490` and source sense ID is `1697000`. The converter now resolves the real
source sense ID from the linked generation report and retains the old ID as a
backward-compatible fallback.

The 43-row fixed checkpoint passed isolated promote, TypeScript check, fast
audit, and published-risk audit:

- publishable senses after validation: `34037`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`

The same checkpoint was then applied to the main product database. This proves
the complete 100-row path: noisy candidate selection, Qwen source review,
Qwen micro generation, draft-only write, Gemma independent review, fixed
checkpoint conversion, isolated promote, audit, and main-DB promote.

Operational lessons:

- use Node, not PowerShell `ConvertFrom-Json`, for large UTF-8 generation reports
- terminal mojibake is not evidence that the Node-written JSON file is corrupt
- do not force a guessed Gemma GGUF variant; let Unsloth select its cached file
- keep reviewer resume enabled for pressure and production batches
- do not promote repeated reviewer parse failures; route them to manual residual
- production D1 remains v82; all evidence-94/95 and pressure-gate changes are local only

## Evidence-96: 500-Row Large-Batch Gate

A second pressure pool excluded the previous 100 source entries and selected
`500` additional unsupported-conflict candidates:

- `pt-BR=452`
- `ja=48`

The pool is deliberately long-tail and noisy. It tests the rejection gates and
runtime stability; it is not representative of a frequency-first production
pool.

Qwen source-evidence review completed all `500` rows:

- approved for generation: `333`
- rejected before generation: `167`
- network failures: `0`
- JSON failures: `0`

Qwen micro generation with two attempts completed all `333` approved rows:

- deterministic-valid: `206`
- rejected: `127`
- evidence rejects: `12`
- other validation rejects: `115`
- infrastructure failures: `0`
- endpoint calls: `333`
- committed logical chunks: `7`

The `206` valid generations were replayed into
`draft_single_source/needs_review`; no publishable row was created at this
stage. Replaying the same report again matched zero rows, confirming that
existing drafts are skipped without duplicate senses.

Gemma 4 31B independently reviewed all `206` drafts:

- valid reviews: `206`
- consensus accepted: `163`
- semantic rejects: `43`
- network or parse failures: `0`

The fixed semantic checkpoint mapped `163/163` rows uniquely. Isolated promote,
main-DB promote, TypeScript check, fast audit, published-risk audit, native D1
export, and full in-memory import audit all passed. The local product state is:

- publishable entries: `28683`
- publishable senses: `34200`
- publishable sense localizations: `136800`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`
- existing non-blocking duplicate-localization warning: `98`

The full local export is
`outputs/d1-v2-product-native-export-v83-large163`. It has not been pushed to
D1; production remains v82.

Additional operational lessons:

- the supplement CLI uses `--endpoints`, not `--endpoint`
- the independent consensus reviewer needs the full conflict-evidence report,
  not the source-review approved-list file
- source review can be infrastructure-perfect while generation acceptance is
  low; candidate quality and runtime reliability are separate gates
- this long-tail pool achieved `61.9%` deterministic generation acceptance and
  therefore does not satisfy a `90%` end-to-end acceptance target
- large-scale execution is technically stable, but production pools should be
  frequency-first and evidence-richer to avoid spending most GPU time on
  candidates that deterministic or independent review will reject

## Large-Scale Readiness Conclusion

Large-scale translation is now operationally verified, rather than inferred
from a small smoke test:

- the earlier real `2000`-row pressure checkpoint completed all `40/40`
  transaction chunks
- that run wrote `1405` accepted drafts and deterministically promoted `1199`
  senses (`85.34%` promote rate among accepted drafts)
- checkpoint resume reports `completed=2000`, `pending=0`, and does not create
  duplicate senses
- the local large-batch harness passes chunk commit, resume, duplicate
  prevention, circuit breaker, circuit recovery, malformed-JSON
  classification, and task rerouting checks
- the current single-node 500-row source review completed with zero transport
  or parse failures
- the following 333-row Qwen generation completed with zero infrastructure
  failures
- all 206 valid drafts received an independent Gemma review; 163 consensus
  rows passed isolated and main-DB promotion
- the resulting full native D1 export and in-memory import audit passed with
  every blocking integrity count at zero

Therefore the runner, draft isolation, checkpoint/resume behavior, independent
review, deterministic promotion, and release audit path are ready for repeated
`2000`-row validation batches and `5000`-row production batches. The limiting
factor is now candidate yield, not execution reliability.

An additional evidence experiment confirmed why sparse candidates must remain
behind strict rejection gates:

- allowing one strong source plus two target-language hints produced 76
  candidates, 59 of which were not already linked
- only 30/59 passed generation validation
- false-friend English anchors such as `magazine`, `file`, and `shoulder`
  remained unsafe even when pairwise target terms existed
- requiring an OMW same-synset target removed most ambiguity but left only
  eight candidates with one OMW target and zero with two

Do not lower semantic gates to improve these numbers. For high-throughput GPU
use, prefer frequency-first candidates with richer same-sense evidence; route
sparse long-tail candidates through the existing source-review and independent
consensus path and accept a lower yield.

## Formal 5,000-Candidate Production Cycle: Chunk 01

The first formal 500-candidate chunk of the planned 5,000-candidate cycle was
completed locally on 2026-07-29. Production Cloudflare D1 was not modified.

The latest product database was used to rebuild the raw frequency-ranked gap
pool. Four-language and three-language source evidence remained too sparse to
fill a production batch, so the chunk used strict prefilters followed by Qwen
source-evidence review:

- candidates: `500`
- language mix: `en=2`, `pt-BR=308`, `zh=40`, `ja=150`
- source-review approved: `232`
- source-review rejected: `268`
- source-review infrastructure failures: `0`

One approved candidate already had a linked draft. Qwen generated the remaining
`231` candidates:

- deterministic-valid generations: `169`
- rejected generations: `62`
- evidence rejects: `15`
- other validation rejects: `47`
- final infrastructure rejects: `0`

The generation service had four transient connection resets or timeouts across
`235` endpoint calls. Retry recovered the affected work, leaving no final
infrastructure residual. This confirms that transport retries should remain
separate from semantic retries: a recovered network call must still pass the
same deterministic validator.

The `169` valid generations were replayed into
`draft_single_source/needs_review`. A second replay matched zero rows, confirming
that the current draft insertion path skips existing rows and does not create
duplicate senses.

Gemma 4 31B independently reviewed all `169` drafts:

- consensus accepted: `125`
- semantic rejects: `44`
- network or parse failures: `0`

The consensus reviewer now accepts both the older deterministic-evidence report
shape and the newer source-review report shape. For the latter it forwards only
valid `accept` decisions and preserves source-review reasons, evidence,
risk flags, preferred terms, and confidence for the independent reviewer.

The fixed semantic checkpoint mapped `125/125` rows uniquely. Isolated promote,
main-database promote, fast audit, published-risk audit, native D1 export, and
full in-memory import audit all passed. The resulting local product state is:

- publishable entries: `28808`
- publishable senses: `34325`
- publishable sense localizations: `137300`
- publishable examples: `3030`
- publishable example localizations: `11898`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`
- existing non-blocking duplicate-localization warning: `98`

The audited local export is
`outputs/d1-v2-product-native-export-v83-production-chunk01`. Production remains
on v82. The remaining formal cycle budget is `4,500` source-gap candidates,
processed in independently auditable 500-candidate chunks.

## Formal 5,000-Candidate Production Cycle: Chunk 02

The second 500-candidate chunk was completed locally on 2026-07-29. The gap
report was rebuilt from the post-chunk01 database so accepted entries and
existing drafts were excluded before selection.

Candidate and source-review results:

- candidates: `500`
- language mix: `en=3`, `pt-BR=315`, `zh=32`, `ja=150`
- source-review approved: `147`
- source-review rejected: `353`
- source-review infrastructure or parse failures: `0`

Six approved rows already had linked drafts. Qwen generated the remaining
`141` rows with zero network failures:

- deterministic-valid generations: `54`
- rejected generations: `87`
- source-evidence mismatches: `21`
- other deterministic or quality-review rejects: `66`

The main rejection buckets were source-evidence mismatch, Japanese terms absent
from JMdict, independent quality-review rejection, and English target terms that
copied a non-English source term. The `38.3%` deterministic generation yield
confirms that this pool is substantially weaker than chunk01. Runtime stability
was not the limiting factor.

All 54 valid generations were inserted only as
`draft_single_source/needs_review`. Gemma 4 31B independently accepted `39` and
rejected `15`, with no network or parse failure.

Seven Gemma-accepted rows were still deterministic policy violations because
they were clear people, place, or brand names: Connecticut, Cezanne, Daejeon,
Panasonic, Fahd, Takahashi, and Ulsan. The consensus checkpoint converter now
supports `--exclude-source-entry-ids`, records the exclusion count, and omitted
these rows before promotion. The resulting fixed checkpoint contained `32`
ordinary-word drafts.

Isolated promote, main-database promote, fast audit, published-risk audit,
native D1 export, and full in-memory import audit all passed. The resulting
local product state is:

- publishable entries: `28840`
- publishable senses: `34357`
- publishable sense localizations: `137428`
- publishable examples: `3030`
- publishable example localizations: `11898`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`
- existing non-blocking duplicate-localization warning: `98`

The audited local export is
`outputs/d1-v2-product-native-export-v83-production-chunk02`. Production
Cloudflare D1 remains v82. Across the first 1,000 formal-cycle candidates,
`157` senses have been safely promoted (`125 + 32`), leaving a nominal
4,000-candidate cycle budget.

Chunk02 also exposed a release-process pitfall: the standalone
`audit-dictionary-v2-product-export-fast.mjs` audits an existing export
directory and does not accept a product database. Database-first fast auditing
must use `audit-dictionary-v2-product-export.mjs --mode fast --db <path>`.

## Formal 5,000-Candidate Production Cycle: Chunk 03

The third 500-candidate chunk was completed locally on 2026-07-30 using the
post-chunk02 database.

- candidates: `500`
- language mix: `en=3`, `pt-BR=316`, `zh=31`, `ja=150`
- source-review valid responses: `441`
- source-review approved: `165`
- source-review rejected: `276`
- bounded residual failures: `59`

gpu-node-a6000 accepted model-listing and short chat requests while repeatedly
resetting the connection for the real 1,262-character source-review prompt.
A 430-character `micro` prompt without a redundant system message restored
transport. At `max_tokens=260`, some responses were truncated JSON; one bounded
retry at `max_tokens=320` recovered additional rows. The remaining failures
were retained as residuals rather than retried indefinitely.

The source-review runner now supports `--prompt-mode compact|micro`,
`--debug-prompt-out`, and `--debug-prompt-only`. These options separate request
transport failures from output truncation. They do not weaken evidence or
promotion validation.

Three approved candidates already existed. Qwen generated the remaining `162`
after a force reload with an 8,192-token generation context:

- deterministic-valid generations: `60`
- rejected generations: `102`
- source-evidence rejects: `26`
- other deterministic or quality rejects: `76`
- final infrastructure failures: `0`

All 60 valid rows were inserted only as `draft_single_source/needs_review`.
Gemma 4 31B independently accepted `37` and rejected `23`. Eight accepted rows
were then excluded as clear proper names: Liston, Nihonbashi, Nasu, Nicholson,
Nakano, Heywood, Atami, and Medusa. The fixed checkpoint therefore promoted 29
ordinary-word drafts.

Isolated promotion, main-database promotion, fast audit, published-risk audit,
native D1 export, and full in-memory import audit all passed:

- publishable entries: `28869`
- publishable senses: `34386`
- publishable sense localizations: `137544`
- publishable examples: `3030`
- publishable example localizations: `11898`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`
- existing non-blocking duplicate-localization warning: `98`

The audited local export is
`outputs/d1-v2-product-native-export-v83-production-chunk03`. Production D1
remains v82. Across the first 1,500 formal-cycle candidates, `186` senses have
been safely promoted (`125 + 32 + 29`), leaving a nominal 3,500-candidate
cycle budget.

## Formal 5,000-Candidate Production Cycle: Chunk 04

Chunk04 was completed locally on 2026-07-30 using only gpu-node-a6000.

Before generation, the candidate builder exposed a major efficiency problem:
chunk02 and chunk03 had `446/500` overlapping candidates because unpublished
rejects were eligible again. Chunk04 now excludes both the 5,649-entry
generation-attempt index and every previous formal-cycle candidate report. Its
500 selected rows overlap chunk01, chunk02, and chunk03 by zero.

After historical exclusions, the remaining strict pool was heavily skewed:
`pt-BR=495`, `ja=5`, `zh=0`, `en=0`. This is evidence that the current strict
high-confidence Chinese, Japanese, and English source-gap pools are nearly
exhausted; it is not a reason to weaken their gates.

Qwen source review completed with one bounded resume:

- valid responses: `486`
- approved: `397`
- rejected: `89`
- residual failures: `14`

The first pass had a continuous service-failure window, then recovered. Resume
recovered 57 of 71 failed rows. Qwen generation processed all 397 approved rows
with zero infrastructure failures:

- deterministic-valid: `273`
- rejected: `124`
- evidence rejects: `16`
- other deterministic or quality rejects: `108`

All 273 valid generations were written only as
`draft_single_source/needs_review`. Gemma 4 31B independently accepted 188 and
rejected 85. Its only failed response was recovered by one resume call.

The fixed checkpoint mapped 188 drafts. Isolated promotion, main promotion,
fast audit, published-risk audit, native D1 export, full in-memory import audit,
and `npm run check` all passed:

- publishable entries: `29057`
- publishable senses: `34574`
- publishable sense localizations: `138296`
- publishable examples: `3030`
- publishable example localizations: `11898`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`
- existing non-blocking duplicate-localization warning: `98`

The audited local export is
`outputs/d1-v2-product-native-export-v83-production-chunk04`. Production D1
remains v82. Across 2,000 formal-cycle candidates, `374` senses have been
safely promoted (`125 + 32 + 29 + 188`), leaving a nominal 3,000-candidate
cycle budget.

The semantic-checkpoint converter also fixed an empty exclusion-list parsing
bug. An omitted `--exclude-source-entry-ids` value previously counted numeric
ID zero as one exclusion; it now correctly reports zero.

## Formal 5,000-Candidate Production Cycle: Chunk 05 Conservative Promotion

Chunk05 reached the draft-only safety boundary on 2026-08-02. The only
available nodes were gpu-node-a6000 (`11441`), gpu-node-a6000 (`11444`), RTX4090-47
(`11448`), and RTX4090-56 (`11447`). All four authenticate with the earlier
four-node token and have Qwen 3.6 35B MTP installed. None has Gemma 4 or another
independent model family installed.

The attempt index now contains `6,135` unique source entries. Rebuilding the
strict pool while excluding that index and all chunk01-chunk04 candidate
reports produced only `85` genuinely new candidates:

- `pt-BR=83`
- `ja=2`
- `zh=0`
- `en=0`
- overlap with each previous formal chunk: `0`

This confirms that the current strict, multi-source high-confidence pool is
nearly exhausted. The pipeline did not relax its evidence or proper-name
filters to fill an artificial 500-row batch.

Four-node Qwen source review produced:

- valid responses: `83/85`
- approved: `69`
- rejected: `14`
- bounded residual failures: `2`

The two residuals, `pestanejar` and `fluentemente`, failed again during the
single allowed resume and remain manual/residual work.

Four-node Qwen generation completed all 69 approved rows in about 76 seconds:

- deterministic-valid: `44`
- rejected: `25`
- evidence rejects: `2`
- other deterministic or quality rejects: `23`
- infrastructure failures: `0`

Natural work distribution reflected node speed: the two RTX 4090 nodes handled
`41/69` calls and the two A6000 nodes handled `28/69`, while retaining one
request per node.

The 44 valid generations were initially written only as
`draft_single_source/needs_review`, adding 44 draft entries, 44 draft senses,
and 176 review localizations. Fast audit, published-risk audit, and
`npm run check` passed before any promotion.

gpu-node-a6000 (`11445`) later supplied the independent reviewer family through
`unsloth/gemma-4-31B-it-qat-GGUF`, variant `UD-Q4_K_XL`. The node was not used
for generation. It was already sharing the GPU with a separate
DiffusionGemma vLLM process, so the Gemma reviewer ran at about `2.3 tok/s` and
roughly 89 seconds per request. Studio used `--parallel 1`; while a review was
running, even `/v1/status` and `/v1/models` waited behind it. This looked like
an API hang but was GPU contention plus request serialization. Do not restart
the node or stop the other process without explicit ownership approval.

Two terminated local command sessions left their Node child processes alive
and both continued writing the same checkpoint. They were identified by start
time and stopped before promotion. The first stable checkpoint contained 20
valid reviews, 12 independent consensus accepts, 8 rejects, and one failed
row. Those 12 were converted to the fixed semantic checkpoint.

All 12 promoted cleanly in an isolated database and then in the main local
database. The isolated and main databases have the same SHA-256 after
promotion. Full native export and in-memory import audit passed:

- publishable entries: `29069`
- publishable senses: `34586`
- publishable sense localizations: `138344`
- publishable examples: `3030`
- publishable example localizations: `11898`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`
- existing non-blocking duplicate-localization warning: `98`

The audited export for that conservative first promotion is
`outputs/d1-v2-product-native-export-v83-production-chunk05-validation`.

After the independent DiffusionGemma vLLM service was explicitly stopped,
Gemma 4 31B loaded fully on the A6000 and completed the remaining reviews in
about 85 seconds. The final review set was `44/44` valid: 30 consensus accepts,
14 rejects, zero manual reviews, and zero failures. The converter explicitly
excluded the 12 already promoted source IDs and uniquely mapped the remaining
18 drafts.

The remaining 18 passed dry-run promotion, isolated apply, published-risk
audit, full native export, in-memory import audit, and TypeScript checks. A
fail-closed backup was created and SHA-256 verified before main promotion:
`linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-production-chunk05-remaining18-20260802-201023.db`.

Chunk05 is now complete. Final local publishable counts are:

- publishable entries: `29087`
- publishable senses: `34604`
- publishable sense localizations: `138416`
- publishable examples: `3030`
- publishable example localizations: `11898`
- bad sense-localization counts: `0`
- duplicate sense orders: `0`
- orphans: `0`
- mojibake texts: `0`
- HTML artifacts: `0`
- published-risk flagged senses: `0`
- existing non-blocking duplicate-localization warning: `98`

The 14 independently rejected rows remain stored as
`draft_single_source` for audit history, but they are not pending review and
cannot enter the publishable export.

The complete audited export is
`outputs/d1-v2-product-native-export-v83-production-chunk05-complete-validation`.
The main DB and complete validation DB share SHA-256
`F653307024E87528CFD59D3CD756ACCC2DAFF7AB438BFCE990F26ACF648417B2`.
Production D1 remains v82 and was not changed.

The attempted pre-main backup copy failed because the local disk lacked space.
No partial backup file remained. This did not leave an unverified database:
the main DB was byte-identical to the already promoted and fully audited
validation DB. Future runs must check free space before copying a 300+ MB
database and must stop the command if backup creation fails instead of using a
PowerShell sequence that continues after `Copy-Item` errors.

## Post-Chunk05 Storage Cleanup and Pool Rebuild

The failed backup exposed 60.6 GB of accumulated files under `data/processed`
and 13.6 GB of mostly rebuildable historical D1 exports. With explicit user
approval, cleanup removed 128 obsolete product DB copies and 115 old native
export directories, releasing 56,058,918,656 bytes. The following were kept:

- the current product DB (the initial 12-row chunk05 validation copy was later
  replaced by the complete 30-row validation copy);
- chunk01 through chunk04 pre-promote milestone backups;
- `linguago_v2_full.db` and its pre-WikDict/OMW backup;
- production v82, chunk04, and chunk05 audited native exports.

After the first cleanup, drive D had about 56.1 GB free. At that historical
stage, the current product DB and initial chunk05 validation DB shared SHA-256
`AFA07A588B1E997E2F0488C132F549F0D09B8FAF9CBBD0DD78E250A353A0CF50`.
After chunk05 completion, that intermediate validation DB and its intermediate
export were deleted, releasing another 457,125,778 bytes. The retained complete
validation DB and current main DB instead share the final hash recorded above.

The post-chunk05 attempt index contains 6,218 unique source entry IDs. Coverage
was rebuilt from the promoted main DB at rank 200,000 (the source currently has
126,439 ranked entries). The strict filter found zero fresh candidates among
the first 50,000 gaps after excluding all five formal chunks and the attempt
index.

Three read-only threshold comparisons confirmed that this is evidence
exhaustion, not just an overly strict first-sense setting:

- three clean languages, one first-sense language: 0 candidates;
- two clean languages, two first-sense languages: 4 candidates;
- two clean languages, one first-sense language: the same 4 candidates.

The four remaining rows are `fudge`, `conduíte`, `lambreta`, and `話中`, all
around frequency rank 38,000 and supported only by EN/PT-BR or EN/JA evidence.
Do not open a large LLM run from this pool. The next pipeline improvement must
add an independent validation path for two-language evidence or ingest another
reliable multilingual source; simply lowering the filter would remove the
evidence gate that made chunk01-chunk05 safe.
