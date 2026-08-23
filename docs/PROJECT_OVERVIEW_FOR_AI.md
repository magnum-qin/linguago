# LinguaGo Project Overview For AI

## Current jump-host baseline and online release (2026-08-23)

The authoritative jump-host product database has advanced beyond the online
release through `v143-native-daily-production5000`. It has SHA-256
`0A04DD99E31E153EC62D8C52D50F160722D09F4ABA4B334A37D6F8E9E6833A1C`
and audited counts `entries=42163`, `senses=48475`,
`sense_localizations=193900`, `examples=3030`, and
`example_localizations=11898`. Its rollback copy is
`D:\linguago-runner\backups\v143-native-daily-production5000-main-before-commit-20260823-181640.db`.
Production D1 remains the v142 Worker release described below while additional
audited senses accumulate toward the next approximately 5,000-sense release.

## Current online baseline (v142 Worker / v141 data, 2026-08-23)

The jump-host run `v141-native-daily-production5000` is complete. From 5,000
fresh Chinese/Japanese native candidates, the strict funnel accepted 323
records (`zh=177`, `ja=146`). Controlled replay inserted 323 entries and 323
senses with 1,292 four-language localizations. A second replay wrote zero rows,
proving idempotence. Deterministic promotion accepted all 323 replayed drafts.

The authoritative jump-host product DB now has SHA-256
`226F90EA9A607598672E259828B8811A1924B36CBB88DAC6BFEE9847DCD11649`.
Its pre-commit rollback copy is
`D:\linguago-runner\backups\v141-native-daily-production5000-main-before-commit-20260823-152650.db`.
The full native export/import audit passed with `entries=41874`,
`senses=48186`, `sense_localizations=192744`, `examples=3030`, and
`example_localizations=11898`; count mismatches, publication risks, orphans,
mojibake, and HTML artifacts are all zero. The refreshed runner manifest
verifies with five healthy endpoints and zero file/hash mismatches.

This v141 product DB is now live in Cloudflare D1. D1 reports
`published_at=2026-08-23T06:38:11.747Z`, and all remote counts match the
25-chunk manifest. Worker cache `v142-native323-41874` is live in Worker version
`558b9e4f-3275-4397-a4a8-13851fa710b1`. General API, focused API, and focused
mobile/desktop render regressions passed with no horizontal overflow. The
release captured a D1 Time Travel bookmark before import and retained Worker
version `c4378e54-747d-4461-87ed-d199a78b8dd3` as its rollback target; no
rollback was required. The exact bookmark is
`0000022b-00000000-000050d0-8224f5a51847899fe008f9410bde7da1`, persisted at
`D:\linguago-runner\runs\v141-native-daily-production5000\cloudflare-d1-before-release-bookmark.json`.

## Previous online production release (v140 data / v141 Worker, 2026-08-23)

The v140 native production run has completed controlled replay and promoted
286 records into the authoritative jump-host product DB. Its SHA-256 is
`BD1C498E3CBD75C8FBB9A3B04DB83F10DD71D5CE0EE472E886E2C18BFC048BD0`.
One otherwise final record, `晦气`, was rejected by deterministic promotion for
semantic drift and was not published.

The full native D1 export/import audit passed with all blocking counters at
zero. D1 now contains `entries=41551`, `senses=47863`,
`sense_localizations=191452`, `examples=3030`, and
`example_localizations=11898`; all 25 SQL chunks were imported and remote
counts match the manifest. Worker cache `v141-native286-41551` is live in
Worker version `baa37f00-ec3d-4b8e-99a3-b65f87044867`. The immutable source
archive SHA-256 is
`2600D1FBEAC18EA96AB0AC7D0F13752ABA7CBB3F44D476766211409A10481BF0`.
Health, general/focused API, and mobile/desktop render regressions passed. The
deployment guard also proved its rollback path by reverting an initial deploy
whose focused-count fixture was stale; the corrected fixture was committed
before the successful release.

A 24-record stratified Chinese/Japanese sample passed the four-language field,
reading, and IPA checks. Keep pronunciation completeness as a separate quality
queue: `沸点` currently exposes `boiling point` with IPA covering only
`boiling`. This does not weaken the structural publication gates.

The completed follow-up run was
`v141-native-daily-production5000`, using a fresh 5,000-row native daily batch
(`zh=2883`, `ja=2117`). The expanded source scan found 91,369 uncovered native
candidates; selection excluded all previously completed run batches and
31,786 historical source entries. The run demonstrated checkpoint-safe resume
after a controlled process restart and subsequently passed controlled replay,
promotion, and all audits. Its main DB commit is complete, but it remains
separate from the live D1 release until the explicit Cloudflare release stage
runs.

Unattended liveness recovery is installed on the jump host as Windows scheduled
task `LinguaGo Dictionary Pipeline Watchdog`. It executes every two minutes and
writes `D:\linguago-runner\state\dictionary-watchdog.json`. A run is eligible
for recovery after ten minutes without stage-log or checkpoint movement; the
watchdog then probes the configured model endpoints and restarts the same run
from its existing checkpoints only if capacity remains reachable. Recovery is
rate-limited to three restarts per hour with a ten-minute cooldown. Completed
or failed manifests are never restarted. The watchdog does not perform product
DB replay, promotion, D1 upload, or Worker deployment.

Recovery must start the existing `Linguago Remote Dictionary Pipeline`
scheduled task; a watchdog task may not have permission to re-register it.
Startup is successful only after a matching runner process is visible. If a
restart fails after locks are removed, the next watchdog pass recovers the run
identity from the prior status/restart event while its manifest remains
`running`. The v141 checkpoint recovery was exercised through this path and
continued from semantic preview review into Qwen generation without replaying
completed stages.

## Current local production baseline and v139 qualification (2026-08-22)

The authoritative jump-host product DB is ahead of the currently released D1.
After v138 it contains `entries=41023`, `senses=47335`, and
`sense_localizations=189340`, with SHA-256
`ACA285F7F27071A2A5C46EB4EC3140AFA9486151CBEBB174B7BD121F7443DACE`.
Do not replace the remote manifest's DB entry with the older repository DB
hash. The manifest generator now preserves the existing remote DB fingerprint
by default.

v139 targets the historical zero-localization CC-CEDICT/JMdict alignment lane.
Its native fallback is opt-in and does not publish records directly. The first
model-first 200-row qualification produced 14 final accepts (7% raw-to-final),
15/15 structurally valid Qwen generations, 15/15 generated-record reverse-
evidence support, and 14/15 final Gemma no-correction accepts. The incorrect
pre-model reverse-evidence ordering produced 0/200 and must not be reused for
this lane.

The non-overlapping 500-row gate is now complete. Run
`v139d-native-fallback-write500-prefiltered` produced 42 final accepts (8.4%),
42/42 valid Qwen records, 42/42 generated-record reverse-evidence support, and
42/42 final Gemma accepts. Its isolated replay inserted 42 draft senses and 168
localizations, the second replay wrote zero rows, and promotion accepted 42/42.
Fast, published-risk, native export, and full in-memory import audits passed;
all blocking integrity counters were zero. Japanese single-character source
gaps are now rejected before generation. The next production cohort should use
the remaining 4,548 non-overlapping historical rows; do not weaken evidence
requirements merely to round the batch to 5,000.

The remaining-pool production run is active on the jump host as
`v139e-native-fallback-production-remaining4548` with 4,548 inputs
(`zh=2697`, `ja=1851`). Treat its manifest and stage reports as authoritative;
do not start a second copy. The model pipeline performs no automatic
main-product-DB writes. A detached
`complete-remote-dictionary-production-run.ps1` supervisor waits for successful
completion, applies the fixed production gates, and then uses the existing
hash-locked controlled replay path. It can atomically commit only after
idempotence, promotion, fast/published-risk/full export audits all pass. Monitor
`runs/v139e-native-fallback-production-remaining4548/production-supervisor.json`.
This supervisor never pushes D1 or deploys the Worker; those remain a separate
release step after reviewing the accumulated publishable count.

## Current production dictionary (v124, 2026-08-20)

The jump-host release plane is now live end to end. The guarded controller
committed the 11 accepted `v124-remote-generated-candidate100` senses to the
main product DB, the hash-locked D1 gate captured a Time Travel bookmark and
imported all 24 native SQL chunks, and the immutable Worker archive was
deployed only after its commit, archive SHA-256, cache version, Cloudflare
account, and D1 visibility were verified.

Production contains `entries=40793`, `senses=47105`,
`sense_localizations=188420`, `examples=3030`, and
`example_localizations=11898`. The live cache is
`v124-remote11-40793`, Worker Version ID is
`d2ad5c08-4ca8-4c85-8462-ce76d1faeea2`, and D1 `published_at` is
`2026-08-20T08:04:07.407Z`. General and focused online API regressions and the
mobile/desktop focused render suite all pass; every rendered case resolved
through D1 and reported no horizontal overflow.

The main DB SHA-256 is
`D97F300A4E17E70D0ED06916B15807CC472EE3B5D6C70BD4DD1D9886526D954C`.
The database rollback copy is
`D:\linguago-runner\backups\v124-remote-generated-candidate100-main-before-commit-20260820-154026.db`.
The D1 pre-release Time Travel bookmark is recorded in
`D:\linguago-runner\runs\v124-remote-generated-candidate100\cloudflare-d1-before-release-bookmark.json`.
The deployed immutable source commit is
`fcd314af03d950bf6555c067ac234b8dbcfb5e5e` with archive SHA-256
`FC1EDB31991B567F7511AF27DFB47BDFC3723E3C3E67DDF0CD729243ED79D6B3`.

### Previous production dictionary (v123, 2026-08-20)

The first frozen 5,000-candidate production run is live. The offline pipeline
reviewed 5,000 candidates, retained 832 with deterministic reverse evidence,
accepted 749 semantic previews, admitted 632 through the JMdict generation
preflight, produced 603 structurally valid Qwen records, and retained 584 after
reverse-evidence validation and independent Gemma no-correction review. All 584
were replayed as drafts, promoted deterministically, and verified first in an
isolated database and then in the main product database.

Production contains `entries=40782`, `senses=47094`,
`sense_localizations=188376`, `examples=3030`, and
`example_localizations=11898`. The live cache is
`v123-production584-40782`, Worker Version ID is
`76658a80-b529-4dd7-9c02-47b7841fb6ce`, and D1 `published_at` is
`2026-08-19T20:59:32.699Z`. Full export/import audit, published-risk,
remote-count verification, online API regression, and mobile/desktop rendering
all pass. The new source-gap records do not yet contain examples; example
enrichment remains a separate quality pass and must not be claimed as complete.

### Jump-host migration status (v124 qualification)

The production pipeline is now qualified on `100.99.99.99` through candidate
selection and an isolated release rehearsal. Frozen candidate/history inputs
are hash-pinned by `config/remote-candidate-sources.json`; local and remote
100-row selection had identical canonical SHA-256. The remotely generated
`v124-remote-generated-candidate100` cohort completed the full no-write funnel
with 11 final accepts. Those 11 were replayed only into an isolated database,
where exact replay was idempotent, deterministic promotion accepted 11/11,
published-risk stayed at zero, and native D1 export/full memory import passed
with all blocking integrity counts at zero.

The guarded controller subsequently committed the 11 accepted senses to the
jump-host main product DB. The committed DB now contains 40,793 entries, 47,105
senses, and 188,420 sense localizations and hashes to
`D97F300A4E17E70D0ED06916B15807CC472EE3B5D6C70BD4DD1D9886526D954C`.
The retained rollback DB is
`D:\linguago-runner\backups\v124-remote-generated-candidate100-main-before-commit-20260820-154026.db`.
Exact replay, promotion, published-risk, and full export/import audits passed.
The same counts and hash are now published as v124. Do not give `agy` authority
over writes or deployment; deterministic release artifacts remain authoritative.

The remote D1 gate is implemented separately by
`release-remote-dictionary-d1.ps1`. Its `Execute=false` rehearsal regenerated
24 native SQL chunks and passed full import audit for 40,793 entries and 47,105
senses without contacting Cloudflare. A scoped non-interactive token was then
installed successfully, but the first token belonged to Cloudflare account
`1fe446be160662c15527a4f536e5901a`; the production D1 belongs to account
`3ebbb03df81b809142eec47c07ef6801`. In that failed state `wrangler whoami`
succeeded while `wrangler d1 list --json` returned `[]`. The corrected token
exposed D1 UUID `ee613260-5c1f-4bb5-8959-c54118174e0e`; with
`NODE_OPTIONS=--dns-result-order=ipv4first`, the bookmark, D1 import, Worker
deployment, and online checks completed successfully. Treat both account match
and D1 visibility as mandatory preflight checks; `whoami` alone is insufficient.

The v123 run used Gemma review dynamically across `11444-11448`; Qwen complete
record generation used `11447/11448`. A sandboxed first attempt reported
`fetch failed` for all endpoints, while the approved network run succeeded with
zero remote-stage failures. D1 chunk 24 received one transient Cloudflare 502
and succeeded on the built-in retry. `wrangler d1 export --remote` still fails
with OAuth error 10000; retain the existing v114 remote SQL backup and the
write-before-v123 local DB backup until Cloudflare fixes or replaces that path.

## Current production dictionary (v114, 2026-08-19)

The accumulated v107-v114 production run is now live. It added 5,012
publishable senses over v106 and reached the frozen deployment interval without
relaxing source review, reverse evidence, controlled replay, or deterministic
promotion. Production contains `entries=40105`, `senses=46416`,
`sense_localizations=185664`, `examples=3030`, and
`example_localizations=11898`.

The live cache is `v114-production5012-40105`, Worker Version ID is
`5e2abcf9-603f-4514-b5ed-e09feb35d458`, and D1 `published_at` is
`2026-08-19T03:26:57.444Z`. Remote D1, `/health`, and the native export manifest
match exactly. TypeScript, fast audit, published-risk, full native
export/import, complete online regression, focused API checks, and mobile plus
desktop render checks all pass.

The final v110-v114 cohorts promoted 830, 498, 281, 360, and 76 senses. Remote
model acceptance was always treated as a candidate signal: every accepted row
was reconstructed by controlled replay and passed local deterministic promotion
in an isolated DB before the same operation touched main. Keep this invariant
for the next production cycle.

## Active follow-up after v114

The latest local cycle is v120; production D1 is still v114. Node 143 is
reserved by another user and is excluded from
`config/dictionary-v2-production-v120.json`. Current remote roles are Gemma on
147/155/224 (`11444/11445/11446`) and Qwen on 56/47 (`11447/11448`). Do not add
143 back until its owner releases it.

v120 fixed a provenance defect in ECDICT acquisition. Validation-report rows
must use the exact `candidate:<source_entry_id>:<source_sense_id>` concept ID;
an `ecdict:<word>:<hash>` ID is not candidate-bound. Exact candidate-bound
evidence can fill a target lane only when the source DB metadata is
production-publishable, candidate-bound, exact, and its source key is explicitly
allowlisted. `test-ecdict-candidate-bound-evidence.mjs` covers this invariant.

The corrected evidence produced a 98-row gate. Gemma approved 66, Qwen generated
43 structurally valid entries, deterministic reverse evidence supported 17,
and final Gemma accepted 9. Zero requests failed. Manual inspection held back
`wacko` for a bad IPA that structural checks missed; controlled replay and
deterministic promotion added the other eight rows to main. Current local counts
are `entries=41422`, `senses=47951`, `localizations=191796`, and
`publishable_senses=46510`. All blocking fast-audit counters and
`flagged_senses` remain zero.

This run validates the five-node execution path but does not justify a 500-row
expansion of the same residual. The next optimization target is quality yield:
strengthen English/Portuguese IPA validation, classify the Qwen contract
rejects, and convert only defensible reverse-evidence manual reviews into exact
rules. Do not lower independent-evidence or final no-correction requirements.

The first follow-up fixed one deterministic false-negative class. JMdict does
not list every productive Japanese integer, so a narrow 1-99 compositional
reading contract now recognizes forms such as `三十五/さんじゅうご`. Revalidating
the immutable Qwen report improves structural validity from `43/65` to `61/65`.
These expressions are nevertheless poor standalone expansion targets, so the
production prefilter now excludes multi-character pure cardinal numbers while
retaining single digits; this removes 26 rows from the current 1,934-row pool.

After excluding the tested 98 candidates, a complete 1,834-row residual scan
found 42 source-supported rows but zero rows with two independently supported
target languages. It terminated as `capacity_exhausted` before model calls.
The current exact acquisition backlog is `pt-BR=42`, `ja=28`, `zh=16`, all
zero-family gaps. Another remote batch cannot unlock this pool; add independent
lexical evidence in that order and rebuild the deterministic prefilter first.

The follow-up v121 acquisition attempt did not change the product DB. A
dual-model-reviewed Dicionario Aberto export was tightened to reject any review
with nonempty risk flags; its three clean candidate-bound rows yielded no final
accepted entry. FreeDict English-Portuguese and Portuguese-English are both
Ergane/TravLang and count as one family. Exact probing covered none of the 42
pt-BR gaps, while inflectional probing covered 11 but exposed unsafe lemma/sense
drift, so it remains diagnostic only.

The production prefilter now excludes ordinary English `-ed/-ing` forms from
the general lane even when short source glosses omit an inflection label. A
fresh replay removes 21 inflected forms plus two productive numbers; only 27
source-supported residuals remain and none has two qualified target languages.
Only `ファミレス` is common-tier. Treat this as real evidence-capacity
exhaustion, not a model failure: rebuild the high-value candidate pool or add a
modern independent pt-BR source before another remote generation batch.

The v118 reviewed-acquisition cycle confirms that LinguaGo should begin
evidence-qualified production rather than continue model experimentation. Its
measured funnel was `9 -> 8 -> 6 -> 2 -> 1` across reverse prefilter, Gemma
source approval, Qwen generation, deterministic reverse evidence, and final
Gemma no-correction review. This is a lexical-coverage bottleneck, not a model
speed or JSON-format bottleneck.

The one accepted `matador` sense passed isolated controlled replay, exact
idempotency replay, restricted deterministic promotion, TypeScript, fast audit,
and published-risk before the same fixed artifacts were applied to main. Main
now contains `46,501` publishable senses and `186,004` publishable sense
localizations, with all blocking counters and `flagged_senses` at zero. The
post-write main DB SHA256 is
`158443604B6186F4872E01D81CECBF77D425E902017D119EA77D3DE141995093`.
D1 remains v114 until locally accumulated additions reach the normal
5,000-10,000-sense release interval.

Run two queues in parallel from this point. The production queue may process
only candidates that already satisfy independent source and target evidence;
the acquisition queue should add verified pt-BR, zh, and ja dictionary rows,
then rebuild the reverse prefilter. Do not use model agreement as evidence and
do not send the unqualified residual pool to a broad 5,000-row LLM run. Keep
Qwen as the complete four-language generator and Gemma as source/final review;
additional model benchmarking is lower value than increasing lexical evidence
coverage.

The v116 evidence-first cycle has now written its first controlled main-DB
batch without changing production D1. From 19,492 fresh candidates, source
sense alignment retained 2,563 and deterministic reverse prefiltering produced
555 candidates. The remote funnel ended with 94 independent no-correction
accepts and zero infrastructure failures. Exact controlled replay wrote 94
drafts, repeat replay wrote zero, and deterministic promotion accepted 84.
Ten promotion rejects remain unpublished. Main publishable counts are now
`senses=46500` and `sense_localizations=186000`; full export/import and all
blocking audits pass with `flagged_senses=0`. Continue accumulating locally and
do not deploy D1 until the next 5,000-10,000-sense release boundary.

Use `config/dictionary-v2-production-v116.json` for the next evidence-first
gate. It runs source-sense alignment before reverse-evidence selection and caps
the prefilter at 500 rows. Model experimentation is no longer the main work:
expand and rank independent lexical evidence, then repeat controlled replay,
isolated promotion, and audits. Never count Qwen/Gemma agreement as dictionary
evidence and never promote the ten retained v116 drafts by weakening the
validator.

The immediate v116 strict pool is exhausted after that batch. A second scan of
1,934 remaining aligned rows found 89 with source-side support but zero with
two qualifying target-language evidence lanes. The runner records this as
`capacity_exhausted` and exits before remote model work. The next scaling task
is new independent target-language lexical evidence or a separately reviewed
manual lane, not another model benchmark and not a lower publication gate.

The measured missing target lanes among those 89 rows are `pt-BR=75`, `zh=70`,
and `ja=47`. The residual has a frequency-rank median of 22,519 and only 10 rows
within rank 5,000, mostly names, so it is not the next daily-vocabulary
production pool. FreeDict `eng-zho` and `eng-jpn` do not solve this gap: their
TEI provenance says WikDict/Wiktionary/DBnary and they must remain in the
`wiktionary` family. Use `dict:v2:audit:freedict-provenance` for future TEI
packages; only a verified upstream such as Ergane/TravLang or TU Chemnitz Ding
may receive its own source-family credit. Do not infer independence from the
FreeDict distribution name.

Start the next cycle from the live v114 counts, rebuild the historical attempt
index, and regenerate the strict source-gap pool. The v113 ranked pool contained
many Latin proper names and low-value English inflections, so candidate hygiene
must run before remote source review. Do not compensate for a weak pool by
relaxing the independent-source or reverse-evidence requirements.

Production behavior remains frozen in
`config/dictionary-v2-production-v106.json` and is invoked by
`scripts/run-dictionary-v2-production-profile.mjs`. The runner now defaults to
the compatible `config/dictionary-v2-production-v115.json` optimization layer:
it deterministically defers low-yield proper-name/inflection/gloss-dump rows,
requires models to be installed before a production stage, records stage
timings, and filters quantization mappings to active endpoints. Model output
must remain a
no-write artifact until controlled replay, isolated deterministic promotion,
fast/published-risk/full audits, and an accumulated 5,000-10,000 publishable
sense interval justify the next D1 release. Keep large runs, checkpoints,
exports, and backups under `%TEMP%` where possible.

The first fresh v115 500-row no-write gate proved that the optimized runner is
operational but that the remaining daily candidate pool is not economical for
a 5,000-row expansion. The measured funnel was
`500 -> 430 prefiltered -> 267 source-approved -> 217 generated -> 30 reverse-supported -> 23 final-accepted`.
All remote stages had zero infrastructure failures, but final yield was only
`4.6%`; reverse lexical evidence, not model throughput, is now the limiting
factor. Rebuild and rank the next pool around independent target-language
reverse coverage before resuming large production. Preserve the 23 accepted
rows as no-write artifacts until a later controlled replay batch is large
enough to justify isolated validation.

The 2026-08-19 RTX 4090-224 speed experiment does not change the frozen model
roles. Gemma 4 E4B was roughly 8x faster than Gemma 4 31B on the small product
JSON contract and matched its 76/80 structural score, but it returned
`manual_review` for all 72 historical locked-evidence source-review rows. It is
not a safe semantic gate. Do not confuse fast JSON generation with source
adjudication quality. Optimize candidate filtering and chunk-level pipeline
overlap before adding another model stage; keep automatic model download out of
the live request path.

## Previous production dictionary (v106, 2026-08-17)

The historical v106 baseline used cache
`v106-production732-35094`, Worker Version ID
`c4378e54-747d-4461-87ed-d199a78b8dd3`, and D1
`published_at=2026-08-17T06:20:05.490Z`. Production contains `35,094` entries,
`41,404` publishable senses, `165,616` four-language sense localizations,
`3,030` examples, and `11,898` example localizations. Remote D1, `/health`, and
the export manifest agree; all blocking audits and online API/render checks pass.

The scale pipeline is now qualified. A v105 2,000-candidate pressure run ended
with 254 deterministic promotions. The v106 5,000-candidate production run
ended with 827 final model accepts; deterministic proper-name filtering,
replay validation, and semantic promotion reduced this to 732 published senses.
This reduction is expected and is evidence that generation acceptance is not
treated as publication permission.

Current residuals are unpublished: 35 semantic-drift promotion rejects, 28
replay validation rejects, 9 unmatched/current-state skips, plus reverse-manual
and reverse-unsupported candidates. Review or improve their evidence rather
than bypassing validators. Final Gemma review must use `--only-supported true`.
For large artifacts use `%TEMP%` on C, not the nearly full D drive.

## Previous production dictionary (v100, 2026-08-17)

The historical v100 baseline used cache
`v100-semantic29-33606`, Worker Version ID
`42f73122-6acb-4657-b8d8-45bbcd99955f`, `33,606` entries, `39,916`
publishable senses, `159,664` four-language sense localizations, `3,030`
examples, and `11,898` example localizations. D1 `published_at` is
`2026-08-16T21:34:23.805Z`; all blocking audits and online API/render checks
pass.

The complete local ECDICT and EJDict datasets were rebound to the 6,409 daily
candidates rather than relying on old candidate subsets. Strict fresh capacity
was still only 56. A bounded semantic-adjudication lane, which retained
independent source families and deterministic reverse evidence, produced 85
fresh review candidates and 29 final no-correction accepts. Those 29 were
validated in an isolated DB, replayed idempotently, promoted, fully audited,
and published.

This result proves the semantic lane is safe but also confirms the capacity
limit: existing local source rebinding cannot supply a 500-row high-confidence
cohort. The next work is ingesting genuinely independent Mainland Chinese,
Japanese, and Portuguese lexical sources, rebuilding candidate-bound evidence,
and rerunning the strict/semantic selectors. Do not count Kaikki and WikDict
separately, treat model agreement as dictionary evidence, or lower publication
gates to reach a nominal batch size.

## Current production dictionary (2026-08-17)

The live baseline is v99 strict daily-gap: cache
`v99-daily-strict84-33577`, Worker Version ID
`37af4314-ba32-44a7-93f3-5a26e278a1b3`, `33,577` entries, `39,887`
publishable senses, and `159,548` four-language sense localizations. It adds
84 strictly supported senses to v98; all blocking audits and published-risk
remain zero.

The fresh daily candidate pool was large (`6,409`) but independent lexical
evidence was not: only `137` passed the strict prefilter, `562` require manual
evidence work, and `5,710` remain unsupported. The executable fresh cohort was
`131`, of which the six-node Qwen/Gemma pipeline accepted and published `84`.
Do not launch another nominal 5,000-row publish run from the unsupported pool.
The next scale-enabling work is new or better-bound independent zh/ja/pt-BR
lexical evidence, followed by the same strict prefilter and review pipeline.

## Current production dictionary (2026-08-16)

The live baseline is v98 daily-first: cache `v98-daily5000-33493`, Worker
Version ID `fe4ab5e8-2c3b-4dd1-aef4-ff584caa440c`, `33,493` entries, `39,803`
publishable senses, and `159,212` four-language sense localizations. The latest
5,000-candidate Qwen run produced 4,737 valid structures; independent lexical
reverse evidence and Gemma no-correction review allowed 1,206 records to be
published. All blocking audits and published-risk are zero. Treat 5,000 as the
generation cohort size, not the publication count: evidence gates intentionally
discard unsupported or semantically uncertain output.

## Current dictionary scale status (2026-08-15)

The Qwen generation -> deterministic reverse evidence -> Gemma no-correction
review workflow has passed a real 502-entry isolated write and promotion gate.
The full native D1 export/import audit passed with 38,266 publishable senses and
153,064 sense localizations; every blocking integrity metric and published-risk
flag is zero. This proves the pipeline can proceed in 500+ controlled chunks,
but the audited database is intentionally isolated and has not replaced the
production product DB or D1 baseline.

Count scale batches by distinct source entries. Distinct source-sense keys can
still map several reviewed senses to one product entry and overstate actual
entry growth. Fresh cohorts should use `--one-per-source-entry true` together
with `--exclude-source-entries true` for all prior candidate reports.

## Current six-node LLM role split (2026-08-14)

The configured pipeline is `Qwen source review -> targeted Nemotron review ->
Qwen generation -> deterministic reverse evidence -> Gemma final consensus`.
Use 155/Nemotron only for routed risk/retry rows. An exact 20-candidate
replay retained 4/4 Qwen-approved and 3/3 final accepted candidates, but saved
only 2/20 downstream calls and had one invalid response. It must not become a
hard rejection gate until a larger representative replay has zero final false
negatives. The node/model details and safety flags live in
`config/dictionary-v2-llm-topology.json`.

A subsequent mixed 100-candidate replay confirmed zero false negatives against
79 Qwen accepts and 65 final Gemma accepts, but Nemotron explicitly filtered
only one candidate (`dezassete`, correctly rejected as pt-PT rather than
pt-BR). Invalid responses are fail-open. Because the measured downstream call
savings were only 1%, broad mandatory prefiltering is not cost-effective;
reserve Nemotron for targeted risk lanes and retry/completion work. A 59-row
targeted test measured 88.1% Nemotron/Gemma decision agreement and showed
Nemotron was about 2.2 times faster, but seven semantic or regional
disagreements mean every recovered acceptance still requires Gemma agreement
and deterministic evidence.

The first subsequent real-new run found only 27 genuinely unreviewed rows in
the current strict Mainland-first pool, not the requested 200-500. Qwen source
review approved 25/27, targeted Nemotron routing correctly selected zero,
Gemma source review approved 25/25, Qwen generated 25/25, deterministic reverse
evidence retained 17, and final Gemma accepted 15. The 55.6% end-to-end yield
does not meet the 80% scale gate. No database write occurred; expand and improve
the independent Chinese evidence pool before another large production test.

Deterministic target-term repair subsequently recovered `じょうろ`,
`substrato`, and `monociclo`; final Gemma accepted the repaired 18/18 evidence-
supported rows. Effective yield improved to 18/27 (66.7%) but remains below
the scale gate. `matriarcado` remains manual because corrected Japanese
`母権制` has only one acceptable source family. Never count the repair model or
reviewer as the missing evidence family.

The completed v5 repair pass supersedes the earlier 18/27 interim result. It
has `23` deterministic-supported rows, `2` manual rows, and `0` unsupported
rows. Dual-A6000 Gemma consensus accepted all `23/23` supported rows at
confidence `1.0`, giving an end-to-end eligible yield of `23/27` (`85.2%`).
This clears the `>=80%` quality gate for this bounded cohort. `ergonomico`
still lacks a second Chinese source family and `matriarcado` still lacks a
second Japanese source family, so both remain manual. No database, D1, cache,
or Worker write occurred. The next blocker is candidate capacity: rebuild a
genuinely new independent-evidence pool before the 100/500-row scale checks.

The post-validation history rebuild scanned `4,629` product-prefixed reports
with zero parse failures and indexed `39,716` source-entry/sense attempts.
Subtracting that index from the 1,482-row strict Mainland-first pool leaves only
two genuinely fresh rows, both pt-BR. A manual-evidence analysis found 921
OMW-based near-unlock rows, but every fresh zh/ja acquisition target is now a
zero-family target (`zh=2,505`, `ja=2,640`). Therefore the next scale-enabling
step is ingestion of a new Mainland Chinese lexical source, followed by an
independent Japanese source; more LLM calls cannot create publication evidence.
Use `dict:v2:coverage:select-evidence-acquisition` to rebuild the acquisition
manifest after refreshing the all-history attempt index.

This is the high-signal briefing for AI coding agents working in this repository.

## One-Sentence Summary

LinguaGo is a Cloudflare-hosted Vue PWA for multilingual translation and dictionary lookup, with dictionary-first word lookup, provider/model switching, KV caching, and structured streaming translation.

## Latest Dictionary Work Boundary (2026-08-12)

- Production is v94. D1 and the local audited export agree at 31,106 entries,
  37,331 senses, 149,324 sense localizations, 3,030 examples, and 11,898 example
  localizations. Cache version is `v94-evidence-final58-31106`; Worker Version
  ID is `03b6efac-2fc0-4b25-b5e6-8fa3a18b6fc9`.
- The v94 release includes all audited local increments accumulated after the
  prior v93 deployment: net `+50` entries and `+58` publishable senses. Eight
  additional generated rows remain unpublished drafts/manual review.
- The current expansion blocker is semantic evidence capacity, not Unsloth
  connectivity. Exact shared WikDict lexentry alignment is one Wiktionary
  family and never counts as multiple independent sources.
- Candidate hints can now be narrowed with
  `--lock-hints-to-unique-wikidata-concept true`, but only for one unique QID
  with one exact intersecting term in every language.
- Always run
  `dict:v2:coverage:select-evidence-upgrade-revalidation` with the current
  `--product-db` before remote review. It excludes accepted/draft product links
  and historical quality rejects.
- The latest real-gap alias/QID pilot reached Qwen 18/19 but Gemma only 15/18,
  below the 90% gate. No product DB write occurred. Fix pt-PT versus pt-BR source
  labels and noun/process target mismatches before the next production pilot.

## Current Architecture

- Frontend: Vue 3 + Vuetify + Tailwind CSS built by Vite.
- Frontend entry: `index.html` -> `src/main.ts` -> `src/App.vue`.
- Backend: Cloudflare Worker in `worker/index.ts`.
- Static hosting: Workers Assets from `dist/`.
- Cache/settings/rate limits: Cloudflare KV binding `CACHE`.
- Dictionary: Cloudflare D1 binding `DB` is the production source of truth; optional Louis SQLite API support remains behind `DICTIONARY_API_URL` and `DICTIONARY_API_TOKEN`.
- Dictionary-generation LLM runtime: Unsloth Studio OpenAI-compatible API on the GPU cluster, replacing the older Ollama workflow.
- Deployment: Wrangler via `npm run deploy`.

Current production dictionary baseline is v86d D1 v2, deployed on 2026-08-06
JST with cache version `v86d-sequential-form-lookup-29669` and export counts
`entries=29669`, `senses=35193`, `sense_localizations=140772`,
`examples=3030`, and `example_localizations=11898`.

The release came from
`outputs/d1-v2-product-native-export-v86-controlled13`. Its D1 `published_at`
value is `2026-08-06T08:33:52.889Z`. The exact pre-v86 local database backup
is `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v86-controlled13-20260806-171547.db`.

The local product DB and production D1 currently match after the quality-gated
controlled-consensus release. Historical batch details below remain useful for
pipeline diagnostics, but no longer describe an undeployed local delta.
The current local main DB SHA256 is
`4A033CA5A860D906723D60DCC47A5F8C7401635DA9EE4CA1D1A9AD2C87BE1456`.
Full native export/import, online API, focused API, and mobile/desktop render
checks all pass. The known `duplicate_sense_localizations=108` warning remains
non-blocking.

After batch 12, rebuilding the same strict pool found only `帰省` and `異音`.
Both passed source review and generation but failed the reverse-evidence gate
(one unsupported, one manual), so neither reached Gemma review or the product
DB. The current Kaikki raw two-language strict pool is therefore exhausted for
automatic promotion. The next expansion must use a newly defined evidence tier
or new source data, not repeat this selector with looser publication checks.

A balanced 20-row canonical first-sense-two-language Tier C pilot was also
tested after the Kaikki closeout. Source review approved only 9/20. Enforcing
reviewer preferred terms yielded 1/9 generation-valid; disabling that brittle
string gate while retaining quality review yielded 6/9, but reverse evidence
supported only three and independent Gemma accepted two (`neurocirurgia` and
`やみ`). Those two passed isolated and main audits. The 2/20 end-to-end yield
keeps the 440-row Tier C pool closed to batch generation; improve source/sense
alignment before another pilot.

The Tier C preferred-term contract has since been corrected. Source review now
hard-binds only the exact source-language headword in `preferred_terms`; target
language model suggestions are retained separately in `suggested_terms` and
must be validated by reverse dictionaries and independent Gemma consensus.
With the same nine approved pilot candidates, the enforced-contract regression
improved from 1/9 to 8/9 generation-valid without weakening semantic gates.
Reverse evidence supported four, and Gemma accepted `neurocirurgia`, `やみ`,
and `しごと`; the first two were already present from the earlier replay, so
only `しごと` was newly promoted. `くるま` was rejected by consensus and was
not written. All isolated and main audits pass, but the low 9/20 source-review
yield still keeps Tier C closed to scale. The next step is deterministic
candidate sense alignment followed by a fresh 20-row pilot.

Deterministic candidate-sense alignment is now implemented by
`align-dictionary-v2-product-source-gap-candidate-senses.mjs`. It evaluates
every clean sense under an entry, requires an exact source-language term, and
selects only a unique best sense by clean language coverage and confidence. It
never merges parallel bilingual senses. On the old 440-row Tier C pool, 119
rows were actually backed by an already complete four-language sense, 137 had
ambiguous parallel senses, and only 184 remained alignable. Reapplying the
high-value filter produced a fresh 20-row pilot with 19 pt-BR rows and one ja
row, each backed by one exact three-language sense. Source review should now be
run with `--require-sense-alignment true`; old first-sense reports fail this
gate. The remote pilot then produced `20 source reviewed -> 13 approved -> 9
generation-valid -> 3 reverse-supported -> 3 Gemma consensus accepts`. Only
`exploradora`, `eletrodomésticos`, and `preventivo` were promoted after isolated
and main full audits. The local DB now contains 29,680 entries, 35,197 senses,
and 140,788 localizations with zero blockers and zero risk flags. Its SHA-256 is
`39D4E3D543B677D0E9087C6BBF68B5981C704DFAE62C152DE4B56F8ABF6F3B99`.
Production remains v83. The 3/20 end-to-end yield is still too low for scaling.

A second 20-row pilot added deterministic reverse-dictionary evidence before
generation. Of the 184 aligned candidates, 44 passed this prefilter. Source
review then accepted 18/20; after removing one row already covered by an older
review, generation produced 12 valid rows from 17 new candidates. Reverse
evidence retained eight, and independent Gemma 4 31B consensus accepted all
eight: `valquíria`, `legalização`, `cantonês`, `troglodita`, `hipnotismo`,
`coalhada`, `cesárea`, and `darwinismo`. Exact isolated and main replay passed
promotion, published-risk, native export, and full in-memory audit. The local
DB now contains 29,688 entries, 35,205 senses, and 140,820 localizations; its
SHA-256 is
`170691083350484ED7C589C3306BF52859F20AD478528191DD29EA7DC82902C8`.
Production remains v83. The improved 8/20 end-to-end yield is useful validation
but is not yet approval for an unbounded Tier C run; generation rejects should
be classified before a 100-row test.
The five rejected generation rows are now classified: `tesouraria`,
`dissuadir`, and `prussiano` failed semantic quality review because of Japanese
term or sense errors; `centésima` and `escoliose` failed the strict JMdict term
gate. Treat the first group as regeneration candidates and the second as
Japanese canonical-form/variant matching work; do not weaken the shared gate.

The Japanese gate now has two deliberately narrow deterministic exceptions:
modern `側弯症`/`脊柱側弯症` are resolved through the corresponding JMdict
canonical `彎` forms, and exact compositional `百分の一` has the verified reading
`ひゃくぶんのいち`. Remote integration retest accepted `escoliose`; `centésima`
still failed independent semantic review because an ordinal and the fraction
1/100 are not always the same sense. The remaining strong-evidence pool held
only 24 rows, not 100. After historical-review subtraction, 20 were new:
generation validated 15, reverse dictionaries supported seven, and independent
Gemma consensus accepted six. The promoted rows are `subsidiária`, `vidraça`,
`fotogênico`, `estribo`, `taquigrafia`, and `escarlatina`. Local counts are now
29,694 entries, 35,211 senses, and 140,844 localizations; SHA-256 is
`90A25DE7E8E0F3875936740C4419F1A82728111D3C53EC2A26F59B65943AC1E9`.
Production remains v83.

An expanded rank-500k experiment showed why Tier C cannot scale from WikDict
agreement alone. A 70,175-row raw gap report filtered to 758 canonical rows;
product-aware sense alignment retained 503. The aligner now excludes source
senses already linked to accepted product senses before ranking, while still
allowing another unlinked sense under the same source entry. The original
reverse prefilter selected 377 rows, but a balanced 100-row source review
accepted only 66. Generation validated 42/66 and reverse dictionaries supported
only four, so the batch was stopped without writes.

The reverse validator now has `--require-source-reverse-evidence true` and
collapses forward/reverse WikDict records into one `wikdict` evidence family.
WikDict may no longer certify itself as two independent sources. Kaikki and
WikDict are both Wiktionary-derived and now share the `wiktionary` evidence
family, so they also cannot certify each other. This reduced
the expanded pool to 13 cross-family candidates, 11 of them new. Source review
accepted 11/11 and generation eventually validated 10/11, but final four-
language reverse validation supported only `desenvolvedor`. Gemma 4 31B then
reviewed all ten valid Qwen generations and accepted eight, demonstrating that
model agreement alone is broader than independent dictionary evidence. A
strict intersection review targeted only the deterministic-supported row and
accepted `desenvolvedor` at confidence 1.0. It was replayed as a review draft,
passed promote dry-run, and was promoted after a database backup. The other
seven Gemma-accepted rows remain manual or unsupported and were not written.
The Japanese reading gate also supports a small productive suffix
whitelist (`化`, `患者`, `可能な`) only when the base reading is present in
JMdict. This fixed valid compounds while semantic review still rejected
`認識可能な` for the wrong sense. The local audited export now contains
29,696 entries, 35,213 senses, and
140,852 localizations. Product fast/full export audits and published-risk pass;
production D1 remains v83 and was not deployed.

After adding `kaikki-ja` as strong-but-Wiktionary-family reverse evidence,
`autenticar` gained independent Japanese agreement from JMdict plus the
Wiktionary family while retaining CC-CEDICT Chinese support. Gemma 4 31B
accepted it at confidence 1.0. It was replayed to draft, promoted after backup,
and passed the complete export audit. No other residual became publishable.

A follow-up derivational-equivalence pass added bounded English morphology for
pairs such as `authenticate/authentication`, `menstruate/menstruation`, and
`mitochondrial/mitochondrion`. This corrected false conflict classifications
for `autenticar`, `menstruar`, and `mitocondrial`, but moved them only to
`manual_review` because another target language still lacks independent reverse
evidence. It produced no additional publishable rows. Do not broaden the rule
into general synonym matching.

The source evidence DB used for coverage-gap selection now includes WikDict and
Open Multilingual Wordnet in addition to ECDICT, CC-CEDICT, JMdict, Kaikki
Chinese, and FreeDict. WikDict and OMW are evidence sources only: they help
select high-value missing entries and provide cross-language hints, but their
rows must still go through LLM draft generation, deterministic validation, and
promote before they can affect production D1.

## Read These First

```text
README.md
docs/PROJECT_OVERVIEW_FOR_AI.md
docs/ARCHITECTURE.md
docs/CODEX_HANDOFF.md
docs/dictionary-v83-large-batch-runbook.md
docs/DECISIONS.md
docs/TODO.md
package.json
wrangler.jsonc
src/App.vue
src/composables/useTranslation.ts
src/composables/useSettings.ts
worker/index.ts
worker/dictionary.ts
worker/config.ts
```

## Important Current Paths

- `src/components/TranslatorCard.vue`: input UI.
- `src/components/ResultCard.vue`: result tabs, dictionary/model badge, report action.
- `src/components/SettingsOverlay.vue`: provider/model settings and dictionary stats.
- `src/composables/useTranslation.ts`: streaming translation loop.
- `src/composables/useSettings.ts`: local settings, model defaults, language labels.
- `src/utils/api.js`: frontend API calls.
- `src/assets/tailwind.css`: app styling source.
- `public/sw.js`: PWA service worker.
- `worker/index.ts`: Worker route dispatch and translation orchestration.
- `worker/dictionary.ts`: D1/Louis/mock dictionary adapter stack.
- `worker/config.ts`: backend model catalog and cache version.

## Stale Historical Paths

The project used to be a plain frontend. These references are stale unless a migration task explicitly restores them:

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `src/index.ts`
- `src/styles.css`
- `npm run style:build`

If you see those in docs or scripts, update them to the Vue/Vite structure before relying on them.

## Runtime Flow

```text
Browser / installed PWA
  |
  | Vite assets + POST /api/*
  v
Cloudflare Worker
  |
  +-- KV cache/settings/rate-limit
  +-- D1 dictionary lookup
  +-- optional Louis dictionary API fallback
  +-- selected model provider
```

## API Routes

Implemented in `worker/index.ts`:

- `POST /api/translate`
- `POST /api/translate-stream`
- `POST /api/report-error`
- `GET /api/models`
- `GET/POST /api/settings`
- `GET /api/dictionary/stats`
- `GET /api/health`
- `GET /health`

Unknown routes are served through `env.ASSETS`.

## Translation Flow

```text
request
  |
  +-- normalize input and target language
  +-- rate-limit
  +-- select provider/model
  +-- check KV translation cache
  +-- if word-like: try dictionary adapters
  |     +-- D1
  |     +-- optional Louis SQLite API
  |     +-- mock JMDict test adapter
  +-- if dictionary miss: call model provider
  +-- parse and validate provider JSON
  +-- normalize frontend response
  +-- write KV cache
  +-- return final response
```

Streaming uses newline-delimited JSON events:

- `status`
- `partial_translation`
- `partial_explanation`
- `final`
- `done`
- `error`

Dictionary and cache hits can return only `status`, `final`, and `done`.

## Result Model

The normalized response includes:

```ts
{
  type: 'word' | 'sentence';
  detected_source_lang: string;
  target_lang: 'en' | 'zh' | 'pt-BR' | 'ja';
  original: string;
  translation: string;
  translations: Record<
    'en' | 'zh' | 'pt-BR' | 'ja',
    {
      text: string;
      phonetic: string;
      audio_text: string;
    }
  >;
  provider: 'dictionary' | 'deepseek' | 'gemini' | 'dashscope' | 'cloudflare';
  model: string;
  cached: boolean;
}
```

Sentence responses also include `explanation` and language-keyed `explanations`.

Word responses also include `phonetic`, `audio_text`, `word_details`, `senses`, and `examples`.

## Current New/Old Mix Risks

- Documentation had many plain-frontend references after the Vue/Vite migration.
- `scripts/sw-cache-check.mjs` was still checking for removed `public/index.html`, `/app.js`, and `/styles.css`.
- `npm run check` needed Vue and JS API declaration files after the migration.
- `worker/dictionary.ts` still contains D1, Louis SQLite API, and mock JMDict adapters, but D1 v2 is the production source of truth. Dictionary adapter failures should fall back to model translation through `safeLookupDictionaryFirst`.
- Many untracked root files are SQL dumps, logs, transfer archives, and scratch scripts. Review before staging anything.

## Cache Rules

- Worker translation cache version is `TRANSLATION_CACHE_VERSION` in `worker/config.ts`.
- Service worker shell cache name is `CACHE_NAME` in `public/sw.js`.
- `/api/*` must stay network-only in the service worker.
- Vite hashed `/assets/*` can be cache-first.
- Navigations should stay network-first with cached `index.html` fallback.

## Commands

```bash
npm install
npm run dev
npm run dev:worker
npm run build
npm run check
npm run check:all
npm run deploy
```

PowerShell may block `npm.ps1`; use `npm.cmd run <script>` if needed.

## GPU Cluster Notes

The active local LLM API is Unsloth Studio, not Ollama. Use OpenAI-compatible endpoints with a bearer token:

The current recommended dictionary topology is defined in
`config/dictionary-v2-llm-topology.json`: use Qwen 3.6 35B MTP `UD-IQ4_NL` on
RTX4090 ports 11446/11448/11447 for generation and Gemma 4 31B QAT
`UD-Q4_K_XL` on A6000 ports 11442/11444 for independent review. Use context
2,048, q8_0 KV cache, and one parallel slot per node. A 40-row contract test
measured 119.54 accepted entries/minute with 40/40 valid outputs. The reverse
placement measured 81.34/minute. See
`scripts/benchmark-unsloth-cluster-topologies.mjs` for the repeatable test.

- `GET /v1/status`
- `GET /v1/models`
- `POST /v1/load`
- `POST /v1/chat/completions`

Project-approved test nodes and jump-host forwarding:

| Node         | Base URL                    | Target               |
| ------------ | --------------------------- | -------------------- |
| `a6000-143`  | `http://100.99.99.99:11441` | `192.168.2.143:8888` |
| `a6000-147`  | `http://100.99.99.99:11444` | `172.23.4.53:8888`   |
| `rtx4090-47` | `http://100.99.99.99:11448` | `172.23.4.47:8888`   |
| `rtx4090-56` | `http://100.99.99.99:11447` | `172.23.4.56:8888`   |

Run the cluster smoke test with `UNSLOTH_API_KEY` set:

```bash
npm run dict:v2:test:unsloth -- --out logs/unsloth-studio-cluster-test.json
```

The smoke test currently targets `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`, uses `/v1/load` before `/v1/chat/completions`, and disables MTP automatically for nodes whose `/v1/status` reports no MTP support. On 2026-06-22 all four listed nodes passed the structured dictionary test with `10/10`; see `logs/unsloth-studio-cluster-test-20260622.json`.

Current production-generation guidance from the 2026-06-23 source-gap benchmarks:

- Use `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` with `gguf_variant=UD-IQ4_NL`.
- Use `max_seq_length=8192`, `speculative_type=mtp`, `batch-size=1`, and one worker per GPU endpoint.
- `rtx4090-56` (`11447`) and `rtx4090-47` (`11448`) both run `UD-IQ4_NL` with `-ngl -1` full layer GPU offload, `--flash-attn on`, `--spec-type draft-mtp`, and about 19.8 GB VRAM used. This avoids the previous `UD-Q4_K_XL` 4090 VRAM pressure and CPU offload problem.
- Measured source-gap dry-run throughput: `rtx4090-56` 47/50 accepted at 51.66 accepted/min, `rtx4090-47` 47/50 accepted at 46.64 accepted/min, dual 4090 96/100 accepted at about 90-100 accepted/min wall-clock. `a6000-155` with the same variant produced 48/50 accepted at 38.96 accepted/min.
- Unsloth Studio detects the Qwen3.6 MTP repo as a vision model and auto-adds `mmproj-F16.gguf`. Local OpenAPI exposes `gguf_variant`, `max_seq_length`, `speculative_type`, `spec_draft_n_max`, `tensor_parallel`, and `llama_extra_args`, but no supported `vision=false` or `mmproj=false` load option. Do not assume mmproj can be disabled through `/v1/load`.

## Current Dictionary Baseline

Operational details for the local v83 batch, including verified commands,
failure modes, checkpoint recovery, and release gates, are in
`docs/dictionary-v83-large-batch-runbook.md`.

The current online D1 baseline is v82:

- Worker cache version: `v82-source-gap-r2-213`.
- Worker version: `0bdb4ca1-cc55-48a3-b555-c15f0d7e38dd`.
- Published counts: `entries=25060`, `senses=30577`,
  `sense_localizations=122308`, `examples=3030`,
  `example_localizations=11898`.
- D1 `published_at`: `2026-07-10T18:28:23.903Z`.
- The pt-BR source-gap pass is complete for `270/271` candidates. The remaining
  candidate is `ouvintes/ouvinte`, kept in `needs_review` because the plural
  source row was linked to a singular entry.
- The zh-only source-gap pilot has two published batches: first `19/19`, then
  `80/80` after excluding low-value/proper-name candidates and tightening
  `gloss_key` width validation.
- The first balanced v64 source-gap batch accepted `80/80` in dry-run and
  promoted `78/80`; the two rejected pt-BR plural/gender form rows remain in
  draft review because their source term does not match the reused entry.
- The v66 strict zh pass used `Qwen3.6-27B-MTP-GGUF` with `--prompt-mode ultra`,
  accepted `20/21` dry-run rows, promoted `20` new zh source-gap senses, and
  left `平安夜` for review because the model returned romaji instead of kana.
- The v67 follow-up manually repaired and promoted `平安夜` as `Christmas Eve`
  with four-language localizations after the model repeatedly returned romaji
  for Japanese reading.
- The v68 follow-up generated a strict zh-first source-gap batch on `rtx4090-56`:
  `25/25` generated rows passed dry-run, `25` draft senses were written, and
  deterministic promote accepted all `25`. The two known pt-BR residual drafts
  are still held in review.
- The v69 follow-up used `a6000-143` and `a6000-147` with Unsloth
  `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` / `UD-Q4_K_XL`: the 20-row dry-run
  accepted `20/20`, the 100-row draft apply accepted `99/100`, and
  deterministic promote accepted `94` senses. Seven source-term mismatches
  remain in draft review.
- The v70 follow-up fixed the source-gap supplement pre-generation skip rule so
  Chinese glosses containing `one's` are no longer misclassified as English
  possessive/demonstrative rows. A 20-row A6000 dry-run accepted all `17/17`
  generated rows after three already-complete pt-BR rows were skipped; the
  100-row draft apply accepted `99/100`, and deterministic promote accepted all
  `99` draft senses.
- The v71 follow-up tightened the source-gap filter to remove English
  capitalized proper-like headwords and zh rows whose gloss is only a Latin
  proper name. It also blocks the repeated `audible` football-play residual
  from generic batches. The strict v71 filter found no clean zh candidates, so
  the batch was mostly English high-value gaps. The A6000 20-row dry-run
  accepted `19/20`; the 100-row draft apply accepted `98/100` after three
  already-complete rows were skipped, and deterministic promote accepted all
  `98` new draft senses.
- v72 and v73 used all four active Unsloth nodes together and published clean
  D1 baselines. v73 promoted `97` new source-gap senses.
- v74 added WikDict and OMW as
  source evidence, exposed significant candidate noise, and tightened filters
  for pt-BR homographs/inflected forms, Japanese single-character or offensive
  residuals, and Traditional Chinese residuals. The current local work has
  promoted `112` v74 source-gap senses in total (`69` in the first batch and
  `43` in the follow-up), moved the remaining source mismatches and
  `parado/stale` to review, and left local `publishable.senses=29750` with
  `flagged_senses=0`. A refreshed native product D1 export passed full audit
  with `entries=24233`, `senses=29750`, and `sense_localizations=119000`, then
  was pushed to D1 and deployed as a clean production baseline.
- v75 continued the post-WikDict/OMW pass with all four Unsloth endpoints
  (`a6000-143`, `a6000-147`, `rtx4090-47`, `rtx4090-56`), generated a 100-row
  pt-BR/ja-heavy source-gap batch, promoted `91` clean draft senses, and kept
  `8` source-mismatch or low-confidence rows in `needs_review`. Product fast
  audit, published-risk audit, full D1 native export audit, online API check,
  online dictionary regression, and render focused check passed.
- v76 continued the post-WikDict/OMW pt-BR/ja-heavy pass with all four Unsloth
  endpoints, accepted `97/100` generated rows, conservatively moved `14`
  semantically risky rows to `needs_review`, promoted `83` clean draft senses,
  and deployed D1 counts `entries=24407`, `senses=29924`, and
  `sense_localizations=119696`. Product fast audit, published-risk audit, full
  D1 native export audit, online dictionary regression, focused API check, and
  render focused check passed.
- v77 repeated the strict post-v76 coverage-gap pass with all four Unsloth
  endpoints, blocked recurring pt-BR residuals (`blá`, `coca`, `colegial`),
  accepted `97/100` generated rows, rejected `fax`, `cuzão`, and `quites`,
  conservatively moved `17` risky draft senses to `needs_review`, and promoted
  `78` clean source-gap senses. Product fast audit, published-risk audit, full
  D1 native export audit, online dictionary regression, focused API check, and
  render focused check passed. The deployed D1 counts are `entries=24485`,
  `senses=30002`, and `sense_localizations=120008`.
- v78 continued the strict post-v77 pass with all four Unsloth endpoints. A
  20-row dry-run accepted `19/20`; the 100-row draft apply accepted `98/100`,
  rejected `rancor` and `center`, moved `15` risky or source-mismatch drafts to
  `needs_review`, and promoted `81` clean source-gap senses. Product fast
  audit, published-risk audit, full D1 native export audit, online dictionary
  regression, focused API check, and render focused check passed. The deployed
  D1 counts are `entries=24566`, `senses=30083`, and
  `sense_localizations=120332`.
- v79 used the strict r7 source-gap report after adding stronger pt-BR residual
  blocking, offensive gloss blocking, and Japanese Katakana proper-name
  filtering. The pt-BR and ja dry-runs accepted `30/30` each, the 100-row draft
  apply accepted all generated rows, and deterministic promote accepted `97`
  clean source-gap senses. The rejected draft is ja `しろ` with
  `gloss_key=Shiloh`, where the generated content drifted toward
  `Battle of Shiloh`; keep it in review. Product fast audit, published-risk
  audit, full D1 native export audit, online dictionary regression, focused API
  check, and render focused check passed. The deployed D1 counts are
  `entries=24663`, `senses=30180`, and `sense_localizations=120720`.
- Direct `100.99.99.99:11441`, `11444`, `11447`, and `11448` access from this
  workstation still fails with `Bad access`/timeout. Testing from lab-win shows
  the Windows portproxy mappings and Unsloth backends are healthy, so the
  likely blocker is Windows Firewall or Tailscale inbound policy. For v79,
  temporary local SSH tunnels through lab-win were used instead of changing
  persistent firewall rules.
- v80 was deployed after the post-v79 coverage gap report found only `685`
  candidate gaps after the first-sense completeness gate. The strict r3 filter
  left `423` clean candidates (`pt-BR=165`, `zh=33`, `ja=225`). Four-node
  Unsloth dry-run accepted `30/30`; the 100-row draft apply accepted `96/100`;
  deterministic promote accepted `89` senses and left `8` source-term mismatch
  drafts in review. Product fast audit, published-risk audit, full native export
  audit, online dictionary regression, focused API check, and render focused
  check passed. The deployed export is
  `outputs/d1-v2-product-native-export-v80-r3-89` with `entries=24752`,
  `senses=30269`, and `sense_localizations=121076`. Wrangler `d1 execute
--file` still fails through Cloudflare's `/import` endpoint with auth code
  `10000`; v80 was restored through `scripts/restore-d1-native-via-query.mjs`,
  which batches SQL through D1's `/query` endpoint.
- v81 regenerated the post-v80 coverage-gap report and found `595` gaps after
  the first-sense completeness gate. The strict r1 filter left `333` clean
  candidates (`pt-BR=76`, `zh=33`, `ja=224`). The source-gap validator was
  corrected to allow pt-BR/English same-spelling loanwords when the word appears
  in English source evidence, instead of treating every same-spelling output as
  copied source text. After that, the 30-row dry-run accepted `30/30`, the
  100-row draft apply accepted `99/100`, and deterministic promote accepted
  `96` senses. Ten source-term mismatch drafts remain in review, mostly
  singular/plural pt-BR source-link mismatches plus the older `しろ/Shiloh`
  residual. A stale accepted `aquecedor` sense with reviewed localizations was
  moved back to `needs_review`. Product fast audit, published-risk audit, full
  native export audit, online dictionary regression, focused API check, and
  render focused check passed. The deployed export is
  `outputs/d1-v2-product-native-export-v81-r1-96` with `entries=24847`,
  `senses=30364`, and `sense_localizations=121456`; D1 was restored through
  `scripts/restore-d1-native-via-query.mjs`.
- `wrangler` is now `4.107.0`; `4.103.0` failed on D1 `execute --file` imports
  with Cloudflare API auth code `10000`, while ordinary D1 commands still
  worked.
- v83 large-batch validation currently exists only in the local product DB.
  The 500-row checkpoint reached `303/377` promoted after a conservative
  semantic-synonym review. A subsequent 2,000-row pressure checkpoint generated
  1,405 valid drafts, rejected 595, and deterministically promoted 1,199. Local
  publishable counts are now `entries=26562`, `senses=32079`, and
  `sense_localizations=128316`; full in-memory D1 audit and published-risk audit
  pass, but this export has not been pushed to production.
- Do not expand v83 to 5,000 rows yet. The pressure batch had 110 infrastructure
  rejects and only 70.25% generation acceptance. Node 56 was less reliable and
  lower-yield than 143. Resume semantics were fixed so `--limit` is a total
  checkpoint target, not an additional resume count, and a reconciliation tool
  now removes only post-baseline draft entries that are absent from the final
  checkpoint.
- The scheduler now has timed half-open circuit recovery and bounded task retry.
  After changing the client network and updating 143/56 from llama.cpp b9940 to
  b9975, short dual-node tests had zero network failures. A strict Tier B
  100-row run wrote 81 drafts and deterministically promoted 78. The current
  local-only audited export has `entries=26640`, `senses=32157`, and
  `sense_localizations=128628`, with `flagged_senses=0`. It has not been pushed
  to D1. Raw generation acceptance was 81%, so the next 500-row expansion is
  still blocked by the 90% gate even though promote acceptance was 96.3%.
- The 2026-07-14 strict-pool follow-up removed 131 broad-gloss candidates before
  generation. A 20-row dry-run reached 18/20 with zero infrastructure failures;
  the subsequent real batch generated 99 rows, wrote 85 drafts, and promoted 78. The audited local export is now `entries=26718`, `senses=32235`, and
  `sense_localizations=128940`, with `flagged_senses=0`. The supplement runner
  now classifies exhausted malformed JSON as validation failure and reroutes it
  once across endpoints without opening a circuit. Raw acceptance remained
  85.9%, so the next 500-row expansion is still blocked.
- A subsequent live dry-run exposed an unbounded-feeling failure path:
  transport `fetch failed` errors were treated as unloaded-model errors and
  could enter the 300-second load flow after a 180-second request timeout. The
  orphan dry-run process was stopped with no DB writes. The classification is
  fixed locally, but a short live smoke test is still required before production.
- That smoke requirement was completed on 2026-07-15 after a network change.
  The prompt now includes compact source-dictionary evidence. A fresh 20-row
  dry-run accepted 20/20, and the following production validation accepted
  97/99 drafts and promoted 93/97 with zero infrastructure/JSON failures. The
  current local-only audited export has `entries=26811`, `senses=32328`, and
  `sense_localizations=129312`; `flagged_senses=0`. A 500-row draft pressure run
  is now permitted, but v83 remains undeployed.
- The 500-row pressure run is now complete: 472/498 generated rows were accepted
  as drafts and 449/472 passed deterministic promotion, with no infrastructure
  or JSON failures. The full local-only export has `entries=27260`,
  `senses=32777`, and `sense_localizations=131108`; all blocking audits and
  `flagged_senses` remain zero. Rebuild the coverage-gap pool before a 2,000-row
  run because the old strict report has only about 539 unused candidates.
- The refreshed strict pool contained 819 rows. Its next 500-row selection
  accepted 460/496 drafts and promoted 443/460, with zero final infrastructure
  rejects. The current local-only full export is `entries=27703`,
  `senses=33220`, and `sense_localizations=132880`; all blocking audits remain
  zero. About 319 strict candidates remain before a new Tier C policy is needed.
- The apparent remainder was completed, but a full 73,436-gap scan showed the
  50,000-row report was a moving window. A lower-rank two-language first-sense
  smoke fell to 13/16; a stricter three-language first-sense pool passed 16/16
  and promoted 159 new senses. The latest local-only export is
  `entries=28156`, `senses=33673`, and `sense_localizations=134692`, with all
  blockers zero. Keep the remaining approximately 1,089 two-language candidates
  frozen until source-evidence review is implemented.

Source-gap generation flow:

1. Filter clean coverage gaps.
2. Run Unsloth dry-run first.
3. Apply only to draft/needs-review rows.
4. Promote only through deterministic validation.
5. Run product fast/full audits and online focused checks before publishing.

For post-v74 WikDict/OMW batches, use stricter input gates:

- Treat WikDict/OMW as evidence only; never publish raw source rows.
- Prefer `--strict-zh true` for Chinese source-gap reports.
- Exclude Japanese single-character/stem candidates from automatic batches.
- Stop and add residual filters whenever dry-run reveals homograph drift.

## UI Constraints

Preserve these unless explicitly asked to redesign:

- Result tabs should keep stable layout.
- Loading and final results should not create avoidable card jumps.
- Settings overlay must stay above app content.
- Theme should apply before first paint via the head bootstrap script.
- Service worker must not cache API responses.
- Keep model defaults aligned between `worker/config.ts` and `src/composables/useSettings.ts`.

## Recommended AI Onboarding Prompt

```text
Read README.md, docs/PROJECT_OVERVIEW_FOR_AI.md, docs/ARCHITECTURE.md, and docs/CODEX_HANDOFF.md. Summarize the current Vue/Vite frontend, Worker API, dictionary adapter stack, cache rules, and known migration cleanup items before editing files.
```

## Latest Local Source-Gap Status (2026-07-15)

The exact post-run two-language pool is `1,084` rows after adding
`--max-first-sense-langs 2` to the coverage filter. A read-only Unsloth
candidate evidence reviewer is implemented and its revised prompt matched all
16 labelled control rows. It auto-loads unloaded models with the correct
per-node GGUF variants (`11441=UD-Q4_K_XL`, `11447=UD-IQ4_NL`). A new balanced
20-row live review completed without endpoint errors but accidentally reused 14
control rows. Its zero-overlap replacement completed with 14/20 evidence
approvals and no endpoint failure; pt-BR passed 7/7, ja 6/7, and zh 0/5.
Unicode-aware proper-name filtering removed the accepted `Düsseldorf`, leaving
13 rows for the next generation dry-run. This is not permission to write or
promote the full pool. The latest local audited counts remain 28,156 entries,
33,673 senses, and 134,692 localizations; v83 is not deployed.

The next 13-row generation pilot exposed a validator gap despite an initial
13/13 structural pass: Japanese readings were copied into EN/PT IPA and one
English term contradicted its gloss. Cross-language pronunciation duplication
and English term/gloss drift are now deterministic errors with one repair retry;
pure-kana source readings are normalized to the exact headword. The corrected
run accepted 12/13. `ゆき` and semantically inconsistent `quinzena/fortnight`
were held; 11 rows were promoted after deterministic review. Current local-only
audited counts are 28,167 entries, 33,684 senses, and 134,736 localizations.
The subsequent two-language experiment remains pre-production. Evidence review
produced 85 candidates, but strict post-generation QA accepted only 66/85. The
runner now validates Japanese readings from JMdict, validates Chinese lexical
pinyin with sandhi disabled, anchors each generated sense to the primary English
source term, and supports deterministic `--replay-report` writes. A replay into
a temporary DB inserted the 66 accepted records only as review drafts and left
the 33,684 publishable senses unchanged. Do not apply these rows to the main DB
or publish v83 until the candidate-class acceptance gate reaches 90% and drafts
pass deterministic promotion.

The next zero-overlap smoke showed that acceptance rate alone is not the right
gate for this weak-evidence tier. Same-model QA on ports 11441 and 11447 made
the same mistakes, so dual-node voting is not independent validation. Run
`validate-dictionary-v2-product-source-gap-reverse-evidence.mjs` after every
two-language generation batch. It requires strong reverse/forward agreement
from CC-CEDICT, Kaikki, JMdict, FreeDict, or WikDict; OMW-only agreement stays
manual. The latest smoke reduced 12 model-approved rows to 5 independently
supported rows. Those 5 passed replay, deterministic promote, fast audit,
published-risk audit, and full export audit in a temporary DB, producing 33,689
publishable senses. The main DB remains at 33,684 publishable senses and D1 is
unchanged. Exact English pronunciations are now replaced from ECDICT before
validation; Portuguese pronunciation still needs a deterministic source or
manual review.

The promote stage now requires `--reverse-evidence` for this weak-evidence
tier, which limits its scan to independently supported source sense IDs. A
second zero-overlap 20-row smoke produced 11 model-approved rows but only 6
reverse-supported rows. After two database-copy validations, the two supported
subsets (5+6) were replayed and promoted into the main local DB. The current
local-only full export has 28,178 entries, 33,695 senses, and 134,780
localizations with all blockers and `flagged_senses` at zero. v83 remains
undeployed.

The source-gap pipeline now also has a pre-generation source-headword evidence
filter. It reduces avoidable LLM calls, but the post-generation target-term
reverse validator remains mandatory. A fresh balanced 50-row sample produced
only nine independently supported rows; local export counts are now 28,187
entries, 33,704 senses, and 134,816 localizations. This state is local only and
has not been deployed.

The next ranking revision restricts OMW evidence to one unambiguous synset and
passes same-synset target terms to the micro generation prompt as verified
hints. On a fresh 20-row 143/56 pilot, model QA accepted 15 and independent
reverse evidence supported 14, raising final yield from the previous 18% to
70%. The correct CLI option is `--prompt-mode micro`; `--prompt-profile micro`
is ignored and falls back to compact mode. The 14 rows were validated in a DB
copy and promoted into the local product DB. The current local-only export has
28,201 entries, 33,718 senses, and 134,872 localizations, with zero blockers and
zero flagged senses. Production D1 remains on v82.

The generator now separates lexical QA from EN/PT pronunciation QA so
deterministic ECDICT transcription is not incorrectly judged as IPA. A targeted
five-row pronunciation retry added three independently supported entries. The
current local-only export has 28,204 entries, 33,721 senses, and 134,884
localizations. `néon` and `サツマイモ` remain manual pronunciation residuals;
production D1 is unchanged.

A subsequent zero-overlap 50-row unambiguous-OMW validation produced 39 model
QA passes and 37 independently reverse-supported entries, with zero endpoint
failures. All 37 were validation-copy audited and promoted locally. The current
local-only export has 28,241 entries, 33,758 senses, and 135,032 localizations,
with zero blockers and zero flagged senses. Pronunciation-review JSON now uses
a 260-token limit and concise output instructions after six verbose responses
were truncated. Production D1 remains v82.

The follow-up retry of 11 pronunciation/QA residuals eliminated the earlier
pronunciation-review JSON failure class and yielded three independently
supported additions: `anil`, `mandioca`, and `alfabetizacao`. They were
promoted only after validation-copy checks. The replay path now matches exact
approved source IDs before applying the normal candidate limit. Current
local-only export counts are 28,244 entries, 33,761 senses, and 135,044 sense
localizations; all blockers and `flagged_senses` remain zero. Production D1
remains v82.

The remaining zero-overlap unambiguous-OMW pool had 16 candidates. A 143/56
dry-run accepted 15, independent reverse validation supported all 15, and the
validation-copy plus main-DB promote stages accepted 15/15. `bolota` remains a
manual pt-BR pronunciation residual. The high-confidence pool is now
exhausted. Current local-only export counts are 28,259 entries, 33,776 senses,
and 135,104 sense localizations; all blockers and `flagged_senses` are zero.
Production D1 remains v82.

A new coverage scan against the post-OMW72 product DB found no unseen candidate
that still passed the strict unambiguous-OMW automatic gate. A conservative
aligned-first-sense Tier B experiment reviewed 20 manual candidates, generated
11, and independently supported only three: `apontador`, `おとな`, and `ふし`.
They were promoted after validation-copy audits. The current local-only export
has 28,262 entries, 33,779 senses, and 135,116 sense localizations with zero
blockers and zero flagged senses. Tier B should not be scaled until Chinese
reading validation and source anchor selection improve. Production remains on
v82.

The first Tier B follow-up removed the Chinese-reading false-rejection class:
non-Chinese source rows now receive deterministic Chinese pinyin before
validation. Evidence review also aggregates high-quality same-headword
WikDict translations and persists an English meaning anchor plus mandatory
preferred terms. This recovered the correct `irra` and `ヒーハー` target terms
for `yeehaw`, but pronunciation QA still rejected the English IPA variant.
Therefore no follow-up row was written, the current local export counts are
unchanged, and Tier B is still not ready for large-scale generation.

The pipeline now has a cross-node IPA repair step that runs only after lexical
QA succeeds. It repairs EN/PT fields marked as IPA, preserves deterministic
ECDICT pronunciation, and requires a second pronunciation review. The first
three-row pilot recovered one independently supported entry, `あさ`, which was
promoted locally after validation-copy and full-export audits. Current
local-only export counts are 28,263 entries, 33,780 senses, and 135,120 sense
localizations with zero blockers and zero flagged senses. Production remains
v82; pronunciation repair is not sufficient to reopen large-scale Tier B by
itself.

The next post-OMW72 Tier B diagnostic selected 20 fresh pt-BR rows. Evidence
review approved 15, generation accepted nine, and independent reverse evidence
supported only `tcheca`, `leiloar`, and `fatiar`. These three were promoted into
the local product DB after validation-copy fast, risk, and full-export audits.
The latest local export is `d1-v2-product-native-export-v83-evidence-gated-77`
with 28,266 entries, 33,783 senses, and 135,132 localizations. Production D1 is
still v82. The 3/20 end-to-end yield keeps large-scale Tier B closed.

The Unsloth pronunciation-repair parser now accepts both direct IPA strings and
nested `{ipa}`/`{pronunciation}` values. This prevents the former
`[object Object]` failure while retaining the final reverse-evidence gate.

The latest local-only Tier B pilot prefiltered candidates by target-language
dictionary evidence before calling the model. The remaining pool had 793 rows;
437 met the target-evidence filter, and the selected 20 pt-BR candidates each
had evidence in two target languages. The reviewer now uses compact verified
hints, a compact 320-token prompt, retries invalid cached reviews on resume, and
normalizes preferred Chinese terms to simplified Chinese. These changes moved
the evidence-review stage to 20/20 valid responses. Generation accepted 11/20,
and independent reverse dictionaries supported nine. Those nine passed
validation-copy replay, deterministic promote, fast/risk audit, and full
in-memory export audit before being applied locally. The current local export
is `outputs/d1-v2-product-native-export-v83-evidence-gated-78` with 28,275
entries, 33,792 senses, and 135,168 sense localizations; all blockers and
`flagged_senses` are zero. Seven of nine generation rejections were pt-BR
pronunciation-review failures, so the 45% end-to-end yield is still below the
large-scale gate. Production D1 remains v82 and unchanged.

Brazilian Portuguese pronunciation is now deterministic when Kaikki provides
an explicitly Brazilian IPA. The new
`build-kaikki-portuguese-pronunciation-index.mjs` script builds a 61,976-term
SQLite lookup from the ignored 555 MB Portuguese JSONL. The source-gap runner
records the selected region as pronunciation provenance and bypasses model IPA
review only for deterministic matches; all lexical, reading, preferred-term,
and reverse-dictionary gates remain unchanged. On the latest live residual
test, pronunciation rejection fell from seven cases to zero, nine of eleven
rows passed generation QA, and seven passed independent reverse evidence. The
seven were promoted locally after validation-copy and full export audits.
Current local export counts are 28,282 entries, 33,799 senses, and 135,196
sense localizations. Production D1 remains v82.

Kaikki Japanese and Portuguese raw sources are now imported into the evidence
DB, but intentionally not rebuilt into canonical localizations because their
gloss language is English. The coverage-gap finder/filter expose a default-off
raw bilingual evidence gate with exact-headword and gloss-overlap checks. The
current isolated pool has 3,553 eligible rows (3,548 JA, 5 PT) after historical
attempt exclusions; the next safe action is a 20-row independent evidence
review, not direct generation or product promotion.

## Final pre-scale evidence gate (2026-08-03)

Kaikki and WikDict are both Wiktionary-derived and always map to the same
`wiktionary` evidence family. A historical policy-regression audit found 111
source-gap senses that lost support under this rule; they are publication
blocked and retained for manual review. The current local export has 29,586
entries, 35,102 senses, and 140,408 localizations. Full import audit and
published-risk audit pass with all blockers at zero. Production remains v83.

The original 0/503 scale result was caused by two conservative implementation
gaps: unique aligned OMW evidence was not counted as an independent family,
and candidates were filtered before selecting their best sense. The corrected
sense-first flow found 2,280 strict candidates. A balanced 100-row source
review passed at 91/100, but generation reached only 80/91 (87.9%) after one
bounded retry, below the 90% gate. No database write, reverse-validation,
Gemma-consensus, 500-row, or 2,000-row stage followed. Improve candidate hints
or generation handling without lowering validators, then rerun a fresh 100.

A stricter fresh batch added deterministic JMdict and Portuguese-pronunciation
hints. It passed source review at 92/100 and generation at 84/92 (91.3%), but
only 22/84 rows passed four-language deterministic reverse evidence. The main
failure is Portuguese target evidence that remains Wiktionary-only. Requiring
two OMW target languages produces 183 candidates, all English-source, with 163
fresh. Do not use that English-only pool to claim the balanced four-language
gate has passed; non-English lanes need another independent reverse source or
better deterministic target alignment.

## Current production baseline (2026-08-11)

Production is v92 pressure replay: 31,039 entries, 37,158 senses, 148,632 sense
localizations, 3,030 examples, and 11,898 example localizations. Worker cache
is `v92-pressure1562-31039`; Worker Version ID is
`24626b8f-5f31-4a01-ab42-c3c9709b699a`. The release replayed the previously
qualified 2,000-row cohort onto v91, retained 1,610 rows under current
validation, and removed 48 exact same-reading duplicate senses for a net 1,562
sense increase. All local, export/import, online API, and mobile/desktop render
gates passed.

Production is now v93 strict-fresh115. It adds 115 senses
selected through independent Qwen/Gemma review, deterministic four-language
reverse evidence, and final no-correction consensus. Candidate counts are
31,056 entries, 37,273 senses, 149,092 sense localizations, 3,030 examples, and
11,898 example localizations. The native package is
`outputs/d1-v2-product-native-export-v93-strict-fresh115`; local fast,
published-risk, and full memory-import audits pass with all blockers at zero.
Cache version is `v93-strict-fresh115-31056`; D1 `published_at` is
`2026-08-11T12:22:19.638Z`, and Worker Version ID is
`5161673d-b817-4b1e-82b1-484d676c2974`.

## V94 evidence-final58 release (2026-08-12)

The production package is `outputs/d1-v93-final10-main`. Fast audit,
published-risk, native export, full memory import, remote count verification,
online dictionary regression, focused API checks, and mobile/desktop render
checks all pass. D1 `published_at` is `2026-08-12T14:29:23.239Z`.

Generation normalizes Chinese target terms and definitions to Simplified
Chinese before pinyin generation, and promotion rechecks that constraint.
Bounded promotions must pass the cohort report with `--restrict-to-report true`;
do not promote by source prefix and limit alone.

The subsequent independent-evidence capacity check did not open another
production batch. The exact WikDict/Wikidata lane has only four historical
revalidation rows left. A fresh 20-row OpenHowNet mapping gate reached strict
Qwen/Gemma consensus on 15/20, below the required 18/20, so it produced no
reviewed evidence, LLM translations, drafts, or database writes. The next pool
must improve sense-specific Chinese evidence selection; do not lower the
consensus threshold or reuse stale fresh snapshots.

The ECDICT second-tier residual now has an additional deterministic target-term
gate. It requires all exact English anchors for a candidate to intersect the
same single Chinese generation hint, using strict token boundaries. This leaves
9/24 exact intersections, but history filtering leaves only seven reviewable
rows: four fresh and three evidence-upgrade revalidations. Two historical
review rejects remain blocked. The cohort is below the 20-row model-review minimum, so it remains local and
unpublished. Combine it with at least 13 newly bound independent-evidence rows
before invoking Qwen/Gemma; do not relax the gate or write these rows directly.

A reading-aware JMdict probe recovered 58 exact source-side kana bindings, but
the strict end-to-end prefilter unlocked zero Japanese publication candidates:
their target-language evidence and round trips remain insufficient. Treat this
as source-index repair, not generation capacity. `climatologia` is the only
new strict-supported row and came from previously reviewed OpenHowNet/DA data.

## V95 government terminology capacity pilot (2026-08-13)

The zero-family lane now includes two independent government terminology
families: 141 Taiwan NAER bilingual terminology datasets and the Japan Ministry
of Justice Standard Legal Terms Dictionary. They are licensed for reuse but
are domain sources, so they do not bypass semantic review or reverse evidence.

The source probe matched 1,369 of 2,877 zero-family candidate/target pairs. The
frozen strict prefilter grew from 1,281 to 1,682 rows and exact history
subtraction left 213 fresh candidates. An initial unfiltered source-review gate
reached only 11/20 strict Qwen/Gemma agreement. A second unseen 35-row pool
produced 25 strict agreements; the first 20 agreements then yielded 19 valid
Qwen structures, 14 deterministic reverse-supported rows, and 12 final Gemma
no-correction accepts. Effective yield remains 12/20, below bulk production.

No product database, D1, cache, or Worker state changed. The next run must use
the 213 rows as a source-review reservoir and generate only strict Qwen/Gemma
agreements. When changing Unsloth context length, force reload the model:
prewarm may skip an already loaded 1,024-token instance, which causes every
larger review prompt to fail with `context_length_exceeded`.

Chinese terminology policy was subsequently corrected to Mainland-first. If
an NAER anchor has any Mainland China translation, Taiwan terms are excluded;
only anchors with no Mainland translation may use a Simplified Chinese Taiwan
fallback. The corrected strict pool is 1,482 and the fresh pool is 86. Earlier
mixed-region 213-row reports and their model reviews are diagnostic only and
must not be replayed or promoted.

The first Mainland-only bounded cohort promoted 10 Portuguese-source senses.
The audited local export now contains 31,451 entries, 37,752 senses, and
151,008 sense localizations. `protoplasma` and `asparagina` remain review drafts
because their source glosses are broader than the generated English headwords.
Production D1 remains unchanged; the export is local at
`outputs/d1-v2-product-native-export-v95-mainland10`.

The subsequent no-Mainland-term fallback cohort promoted nine additional rows
only after Simplified-Chinese generation, deterministic reverse evidence, and
Gemma review focused on Chinese usage. The current local v95 export is
`outputs/d1-v2-product-native-export-v95-mainland19`, with 31,460 entries,
37,761 senses, and 151,044 sense localizations. Production D1 is still not
updated.
### AGROVOC supplemental evidence (v97)

- `scripts/export-agrovoc-evidence.mjs` converts the candidate-bound AGROVOC
  probe into the standard supplemental SQLite schema. It keeps AGROVOC as one
  independent source family, normalizes official Chinese labels to simplified
  Chinese, and rejects non-CJK target labels and conservative scientific-name
  cases.
- The top-3,000 acquisition probe produced 235 accepted candidates and 349
  lexical evidence rows (`zh=307`, `ja=42`); no Chinese label required OpenCC
  conversion and one Chinese label without Han characters was rejected.
- After merging AGROVOC with the v95 Mainland-first evidence DB and rerunning
  the unchanged strict two-independent-family gate, supported rows increased
  from 1,482 to 1,485. Only `削皮` was genuinely fresh after the complete
  source-gap attempt history was removed; the two `hipertireoidismo` senses
  had already been attempted.
- Conclusion: AGROVOC is useful domain evidence, not a general-purpose source
  for scaling the remaining Chinese/Japanese zero-family pool. Do not weaken
  the two-family gate to increase its yield.
- The exhaustive follow-up covered all 5,145 fresh acquisition targets
  (`zh=2505`, `ja=2640`) and 5,817 English anchors. It matched 324 candidates,
  yielding 581 filtered evidence rows (`zh=307`, `ja=274`). The strict count
  reached 1,486, but the expanded Japanese scan unlocked only one additional
  fresh sense, `木屑`. The complete fresh strict pool is now only four rows:
  `木屑`, `削皮`, `protrombina`, and `embutir`. AGROVOC acquisition is therefore
  exhausted for the current pool.

### PanLex source feasibility after AGROVOC

- `scripts/report-panlex-source-feasibility.mjs` audits the official PanLex
  source registry without treating PanLex itself as an independent family.
  Every accepted row must retain and review its original source provenance.
- The old `api.panlex.org` hostname did not resolve, the historical snapshot
  URL redirected to the PanLex home page, and the public source-list response
  was truncated after 4,877 source records. The report records this limitation
  and is discovery-only.
- Among 12 ingested Chinese-English/Japanese-English sources with at least
  1,000 denotations, seven had restricted or unresolved redistribution rights,
  one was the already-integrated Japan MOJ legal family, one was useful only
  for kanji validation, and three were specialist ocean/meteorology/
  computational-linguistics lists. No general modern lexical source passed the
  license-and-provenance shortlist.
- Do not import PanLex as one aggregate evidence vote. A future PanLex snapshot
  is useful only if its individual source IDs are mapped to reviewed original
  families; unknown IDs remain `panlex-unmapped` and non-publishable.

### AGROVOC fresh-candidate review state

- The current strict fresh pool was reduced from four to three by independent
  source review. Qwen rejected `削皮`; Qwen and Gemma both accepted `木屑`,
  `protrombina`, and `embutir` with confidence at or above `0.95`.
- The generation input is
  `logs/product-source-gap-v97-agrovoc-fresh3-source-consensus.json`. It is a
  local runtime report and is not committed.
- No database or production state changed. Resume from full four-language Qwen
  generation, then deterministic reverse evidence, then independent Gemma
  no-correction consensus. Do not skip directly from source-review agreement to
  product promotion.
- Always run generation selection against the current product DB immediately
  before a remote call. For this cohort it reduced the actual generation set to
  only `木屑`; `protrombina` and `embutir` are already complete. The apparent
  mojibake for `木屑` in PowerShell is display-only and the JSON code points are
  correct.

### Current scale lane: v122 AI-reviewed complete entries (2026-08-19)

The active large-batch lane now has two explicit publication trust levels:

- `verified`: deterministic independent dictionary evidence satisfies the
  publication contract.
- `ai_reviewed`: locked local evidence, Qwen generation, and independent Gemma
  no-correction review agree, but strict four-language reverse dictionary
  evidence is incomplete. Never describe this level as independently verified.

The v122 isolated pilot generated 90/90 valid complete entries, reached 84/90
Qwen/Gemma consensus after one bounded repair pass, and retained 83 after the
pre-write semantic duplicate filter removed `重返`. All 83 contain readings or
pronunciations, four language localizations, and one Simplified-Chinese source
example with four localized sentences. All database and full D1 audits pass;
the production DB, D1, and Worker remain unchanged.

Required pre-replay commands now include:

```powershell
npm.cmd run dict:v2:coverage:filter-existing-semantic-duplicates -- `
  --input <final-consensus-replay.json> `
  --output <deduplicated-replay.json> `
  --report <dedup-report.json>

npm.cmd run check:worker-dictionary-verification -- `
  --db <native-d1-export\audit-import.db>
```

Do not resume model benchmarking. Use Qwen for complete-entry generation and
Gemma for independent final review. The next gate is a fresh 500-candidate
isolated run, followed by a 2,000-candidate checkpoint/resume stress run. Only
after both pass may the frozen pipeline write 5,000-row production batches.
Keep large runtime artifacts on C: `%TEMP%` while D: remains full.

### Wikidata Lexeme and NorthEuraLex evidence result

Wikidata Lexeme and NorthEuraLex were evaluated as independent open lexical
sources. Wikidata's full official Lexeme dump yielded no aligned target evidence
for the current 5,145 long-tail residuals. NorthEuraLex yielded 3,140 reusable
concept-bound rows across English, Simplified Chinese, and Japanese, but a full
strict replay added and removed zero selected candidate keys. Generic Portuguese
is excluded from its default export because the product requires pt-BR. These
sources improve provenance coverage but do not currently provide enough new
candidate capacity for bulk LLM production.

The global Wikidata Lexeme feasibility scan also rules out a source-first bulk
lane. Only 280 shared `P5137` concepts had all four project languages, only four
had an explicit `pt-br` lemma, and 232 were already exactly covered in all four
product languages. The other 48 were partially covered; none was an entirely
new concept. Shared item IDs can also be broader than dictionary senses, so
these rows require semantic review and must not be promoted directly.

### Strict retry capacity

Do not exclude a source-gap sense merely because any historical log mentions
it. The repeatable retry-capacity report distinguishes explicit semantic rejects
and current product links from recoverable infrastructure failures, unresolved
checkpoints, and generated-but-unpublished work. The current strict pool has
280 production-eligible senses but only 203 unique source entries. Every target
term must have independent lexical evidence before source review. Chinese review
uses Mainland-first terminology; simplified Taiwan terminology is only a
fallback when no established Mainland equivalent exists. Remote source review
is still mandatory because independent sources can converge on the wrong sense
of a polysemous English anchor.

Historical attempt indexing distinguishes source-sense rejects from rejection
of one generated payload. Only `source_review_reject` is a permanent semantic
block; `generation_quality_reject` is retryable through the complete pipeline.
A separate review-only pool has 711 senses / 483 unique entries and permits
multiple candidate terms only for per-language model selection. Combining that
lane with 34 evidence-upgraded historical rejects produces a 500-entry scale
review cohort. Multi-hint and evidence-upgrade lanes cannot pass directly to
generation or promotion; they require exact term selection, deterministic
reverse validation, and independent Gemma consensus.
## Current v117 acquisition status (2026-08-19)

The production pipeline is stable, but independent target-language evidence is
the current throughput limit. A candidate-bound Dicionario Aberto pilot added
seven dual-model-reviewed Portuguese evidence rows and unlocked four candidates
at the prefilter. The complete no-write production run accepted none after the
final reverse-evidence gate because Chinese evidence was still insufficient.
This is expected conservative behavior and the product DB was not modified.

Use `config/dictionary-v2-production-v117.json` for reviewed target-acquisition
batches. Supplemental sources only become strong when their exact source key is
explicitly supplied and metadata proves a production-publishable,
candidate-bound, independent Qwen/Gemma-reviewed subset. Never promote a model
suggestion as lexical evidence. Keep expanding Mainland Chinese and Japanese
independent sources, then rerun the same controlled no-write pipeline before
replay and promotion.

## Remote production runner (2026-08-20)

The generation pipeline has a validated jump-host deployment at
`100.99.99.99`, rooted at `D:\linguago-runner`. It contains the hash-matched
v123 product DB and evidence DBs. Use
`scripts/verify-remote-dictionary-runner.ps1` before work and
`scripts/manage-remote-dictionary-runner.ps1` for start/run/status/stop.
Background runs are owned by the Scheduled Task
`Linguago Remote Dictionary Pipeline` and protected by a host-wide lock.

`scripts/watch-remote-dictionary-runner.ps1` is the read-only monitoring entry
point. Its optional `-UseAgy` analysis is advisory and requires prior Google
OAuth login on the jump host. Deterministic reports and audits, not an agent,
control database promotion and release. The 20- and 100-row migration smoke
tests made no DB writes and validated resume, model calls, empty funnels,
concurrent-run rejection, and cleanup.

The permanent deployment split is local control plane plus jump-host execution
plane. Frontend/Worker edits and fixed production commands originate locally;
the jump host owns model runs, product DB mutation, promotion, D1 publication,
Worker deployment, and online regression. GPU nodes are inference-only.
`scripts/invoke-dictionary-control.ps1` is the local whitelist entry point.
Worker deployments must use a clean, committed, SHA-256-pinned Git archive
staged under `D:\linguago-deploy\releases`, and the expected cache version must
match the archived `worker/config.ts`. The remote Worker gate captures a
rollback version before deployment and rolls back after failed online checks.
Remote D1/Worker execution is currently credential-blocked until a scoped
Cloudflare API token is installed in the Scheduled Task user environment; dry
runs are validated and do not require that token.
