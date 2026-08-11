# Codex Handoff

## 2026-08-10 v90 isolated 500-row scale gate

- The fixed 500-candidate cohort completed real chunked draft writes in
  `.tmp/validation/linguago-v90-scale500.db`. Checkpoint resume finished with
  `482/500` valid drafts (`96.4%`), zero endpoint failures, ten committed
  50-row chunks, 482 unique product senses, 1,928 localizations, and 482 source
  links. The production DB, D1, and Worker were not changed.
- Deterministic reverse evidence supported all 482 valid generations in all
  four languages. Initial independent Gemma 4 31B consensus accepted 349,
  rejected 132, and failed to parse one response.
- Structured correction selected 116 safe field replacements. Qwen regenerated
  98 valid rows; 88 retained strict reverse evidence; Gemma accepted 64. Six of
  those still carried source-review risk flags, so controlled replay wrote only
  58 corrected drafts. The final strict promote cohort was therefore
  `349 + 58 = 407/500` (`81.4%`).
- `promote-dictionary-v2-product-source-gap-drafts.mjs` previously replaced a
  narrow draft `gloss_key` such as `excerpt` with a broad multilingual hint
  list from the source-review report. This caused 101 false
  `broad_gloss_key` rejects. It now retains the narrow draft gloss whenever the
  report gloss is broad; genuinely broad draft glosses remain blocked.
- Both promote dry-runs and applies accepted all 407 strict rows. The isolated
  publishable count rose from 35,476 to 35,883. Fast audit and published-risk
  passed with `flagged_senses=0`, no review localization leakage, no duplicate
  sense order, no orphan, no mojibake, and no HTML artifact.
- Native D1 export plus in-memory import passed at 30,317 entries, 35,883
  senses, and 143,532 sense localizations. Export output is
  `outputs/d1-v2-product-native-export-v90-scale500-validation`; it is a local
  validation artifact and must not be deployed.
- The 2,000-row pressure gate is now blocked by source-qualified candidate
  supply, not model or checkpoint reliability. Re-aligning all 4,930 clean
  rows produced 3,095 unique candidates, but the unchanged two-independent-
  source-family/all-target gate retained only 646.
- An unseen OpenHowNet probe found 655 exact POS-bound rows. Dual Qwen/Gemma
  review of the 291 single-term rows accepted 202 intersections and exported
  188 MIT-backed lexical evidence rows. Re-running strict prefilter still
  retained 646 rows: these additions strengthen Chinese target terms but do
  not provide a second independent source family for the pt-BR/ja source term.
  Do not count reviewer agreement as source evidence and do not relax the
  two-family source gate. The next useful work is additional source-language
  sense evidence or safer WikDict/FreeDict/JMdict source-sense rebinding.

## 2026-08-08 v90 full-rank expansion qualification

- Expanded the read-only coverage scan from the first 100,000 gaps to all
  267,263 ranked gaps at `max-rank=200000`. The unchanged quality filter
  produced 4,930 clean rows (`zh=1164`, `ja=1085`, `pt-BR=2662`, `en=19`).
- Unique-sense alignment retained 421 rows. The unchanged all-target,
  two-independent-family reverse-evidence gate retained 68 rows. After
  subtracting previously reviewed v90 batches, 64 rows remained.
- The first new semantic-risk batch completed source review at `15/20` (75%).
  Rejections exposed mandarin language/fruit, muffin/gem, object/occupation,
  Platonism/realism, and broad botanical-term scope collisions. These patterns
  are now scored by
  `triage-dictionary-v2-product-source-gap-semantic-risk.mjs`.
- The review runner initially produced 2 context-window errors and 13 truncated
  JSON responses with a 1,024-token context and `max_tokens=320`. Resuming only
  failed rows with a 2,048-token context and `max_tokens=500` completed all 20
  without replaying valid rows.
- A second reranked batch produced 12 accepts, 7 semantic rejects, and 1 invalid
  evidence-bound response (`12/20`; at most `13/20` if retried successfully).
  Misspellings, homographs, and overly broad OMW concepts dominate this lower
  frequency tail. The 90% source-review gate therefore failed twice.
- Stop before generation. No draft, product DB, D1, or Worker write occurred.
  The next useful work is stronger candidate/source normalization, not a lower
  acceptance threshold or a larger LLM batch.
- Independent Gemma 4 31B adjudication of the 12 valid Qwen rejects produced
  7 consensus rejects and 5 reviewer disagreements. Disagreements remain
  manual review; model agreement is never counted as dictionary evidence.
  `adjudicate-dictionary-v2-product-source-gap-reviews.mjs` now records this
  boundary reproducibly.
- Retrospective risk scoring moved all 7 consensus rejects above the automatic
  ceiling (`score=8..10`). The final strict tail contained only 12 eligible
  rows and its exploratory Qwen review reached 6 accepts, 5 rejects, and 1
  invalid response. Even a successful retry could reach only `7/12`.
- The expanded strict pool is now exhausted for automatic generation. Improve
  source normalization and sense-level evidence ingestion before another LLM
  qualification run.
- Added
  `audit-dictionary-v2-product-source-gap-parallel-agreement.mjs` as a read-only
  diagnostic between exact WikDict bilingual senses and generated target-term
  hints. Across 64 strict rows it found 22 rows with mismatches. In the 40
  reviewed rows, all 7 Qwen/Gemma consensus rejects had a mismatch, while only
  1 Qwen accept did. A single mismatch is therefore a ranking penalty, not a
  hard block; multiple mismatches are high risk. Near CJK matches remain
  visible and never count as publication evidence.
- Harmonized the prefilter English lexical matcher with the final reverse
  validator: both now support inflection, conservative derivational stems, and
  one-character edit distance for compact terms of at least six characters.
  This recovered only `certificação` and `cambojano` (`68 -> 70` strict
  rows). Parallel agreement found two target-language mismatches in each:
  credential/authentication scope for the former and language/nationality
  scope for the latter. Both stayed above the risk ceiling; no LLM or DB write
  followed.

## 2026-08-08 v90 low-ambiguity second gate

- Added `--max-hints-per-target` and `--max-total-target-hints` to
  `subtract-dictionary-v2-product-source-gap-report.mjs`. The second gate used
  at most two hints per target language and six target hints in total, leaving
  19 candidates from the 77 unreviewed OMW-priority rows.
- Source review correctly rejected `arábico` (part-of-speech mismatch) and
  `apendicectomia` (Japanese scope mismatch). It initially marked `insólito`
  accepted while returning null preferred terms. The reviewer validator now
  requires every accepted row to bind all four preferred terms to supplied
  evidence when `--require-hint-semantic-alignment true`; a strict retry fixed
  `insólito`. Adding `encefalite` produced exactly 18/20 source-qualified rows.
- Qwen generation validated 17/18 (`94.4%`); `incolor` was rejected for the thin
  Portuguese definition `sem cor`. All 17 valid rows passed four-language
  multi-family reverse evidence.
- Gemma no-correction consensus accepted 14/17 initially. Structured retry
  proposed `pendência` and `dezanove`; only `dezanove` retained independent
  reverse support and then passed Gemma. `pendência` became Wiktionary-only in
  Japanese and remained manual. Final verified yield is 15/20 (`75%`) in
  `logs/product-source-gap-v90-omw-priority-low-ambiguity-verified-15.json`.
- The second gate therefore also fails the required 80% final promote-rate
  threshold. Do not write these rows to the product DB or start the 500-row
  stage. The next candidate selector must account for grammatical role and
  concept scope, not only hint count.

## 2026-08-08 v90 OMW-priority gate result

- No product DB, D1, or Worker write was performed in this experiment. The
  product DB remains at 29,909 entries, 35,473 senses, and 141,892 sense
  localizations.
- The strict OMW-priority prefilter produced 97 candidates. A balanced 20-row
  source review accepted 19/20; `luso` was correctly rejected for a
  noun/adjective mismatch.
- Generation originally accepted only 9/19 because source-review
  `definition_contract` values in several target languages were English
  placeholders. The supplement runner now keeps English contracts, keeps
  Chinese/Japanese contracts only when their script and thickness are valid,
  omits ambiguous Portuguese contracts, and permits only explicit structured
  Gemma definition replacements to override that filter. The corrected dry-run
  accepted 19/19.
- Reverse validation now carries all English terms from the same aligned source
  sense in `source_meaning_anchors`. This fixed false negatives such as
  `foment` versus `provoke/stir up`, `deformed` versus `distorted`, and
  `pointer` versus `cursor`, without adding a free-form synonym dictionary.
  All 19 rows then had four-language, multi-family reverse support.
- Independent Gemma 4 31B no-correction consensus accepted only 9/19 initially.
  Structured correction retry safely selected eight rows and recovered five,
  producing a final 14/19 (`73.7%`) no-correction intersection. This is below
  the 80% scale gate, so do not write or promote this batch.
- `build-dictionary-v2-product-source-gap-structured-correction-retry.mjs`
  now rejects no-op replacements. Ambiguous replacements and corrections that
  apply to `all` languages remain manual. Current residuals are `duplicação`,
  `agrário`, `legislar`, `olaria`, and `ポインター`; do not force them through
  deterministic promotion.
- Node 11448 returned one upstream HTTP 500 in the first rerun. Nodes 11444 and
  11447 completed the stable rerun with zero failures. This was an endpoint
  reliability issue, not a JSON or validator failure.

## 2026-08-06 v86d controlled-consensus release

- Production is v86d: Worker `35880184-2258-44af-97e6-b00c08c7e2bf`, cache
  `v86d-sequential-form-lookup-29669`, and D1
  `published_at=2026-08-06T08:33:52.889Z`.
- Online counts are `entries=29669`, `senses=35193`,
  `sense_localizations=140772`, `examples=3030`, and
  `example_localizations=11898`. The audited export is
  `outputs/d1-v2-product-native-export-v86-controlled13`.
- The batch promoted 13/13 controlled rows after strict four-language reverse
  evidence and independent Gemma no-correction review: `biosphere`, `calcite`,
  `osteoporosis`, `catamaran`, `crustacean`, `octane`, `prion`, `monotheism`,
  `ionosphere`, `分度器`, `phenolphthalein`, `nonagon`, and `peritoneu`.
- Product DB SHA256 is
  `4A033CA5A860D906723D60DCC47A5F8C7401635DA9EE4CA1D1A9AD2C87BE1456`.
  The pre-v86 DB backup SHA256 is
  `44E26C50A9470B265C24A0B8F0F80EB155F0CAE531E123E2339744D603F7A63A`.
- One release process was interrupted after schema reset and the first data
  chunk, temporarily leaving D1 with entries but no senses. Replaying the
  audited 18-chunk export restored the database. The push script now retries
  each file and verifies all seven remote table counts against the manifest;
  never report a release complete without this verification.
- Do not use Windows PowerShell 5 `Invoke-RestMethod` with a raw non-ASCII JSON
  string as a Unicode dictionary smoke test: it sent `分度器` as `???` and
  created a false D1-miss diagnosis. Use Node `fetch`, an explicit UTF-8 byte
  body, or Unicode escapes. The final focused check includes
  `ja-protractor-form-lookup` to cover a display form whose canonical key is
  romanized.
- TypeScript, fast/published-risk/full import audits, complete online API,
  focused API, and isolated mobile/desktop render checks pass. All blocking
  audit counts and `flagged_senses` are zero. The duplicate-localization
  warning is 108 and remains non-blocking.

## 2026-08-05 Definition-contract residual gate

- Source-supply diagnostics confirmed that the source DB is already ranked to
  about 200,000 for all four languages; frequency depth is not the blocker.
  Among 3,455 aligned candidates, 2,071 fail with a strong-dictionary gloss
  conflict, but 1,906 of those have only one available strong family. Only 73
  expose two families with incomplete matching.
- A default-off `--strong-supplemental-families` diagnostic was added to the
  reverse-evidence prefilter. Treating the Spanish-pivot Apertium rows as
  strong increased the strict pool only from 18 to 19 (`sombrear`) and is not
  approved for production. Conservative space/hyphen normalization produced
  no final-pool increase. The default policy remains unchanged.
- PanLex Batch 1/8 OntoLex (Zenodo record `6757353`) has now been inventoried.
  `scripts/inventory-panlex-ontolex-zenodo.mjs` inspected 96/101 files by HTTP
  Range and selected six files (about 224 MB) containing English plus at least
  one project language. Five files remain network blind spots. The inventory
  canonicalizes PanLex/BCP tags (`cmn|zho -> zh`, `jpn -> ja`, `por -> pt`);
  the first pass incorrectly reported zero Chinese files because it matched
  only the literal `zh` tag.
- Source-tail audit found no eligible new independent family in the six files:
  sources `11`, `13`, and `15` are Russian/Vietnamese/Finnish Wiktionary and
  collapse into `wiktionary`; `5` (Geonames language codes), `54` (IMF
  Terminology), and `116` (Freelang Brazilian Portuguese-English) carry the
  PanLex `co` license marker and are conservatively excluded. Use
  `scripts/audit-panlex-ontolex-source-metadata.mjs` to reproduce this audit.
  Do not download or import these six files into production evidence merely
  because PanLex aligns their terms.
- The five former network blind spots were subsequently closed by suffix-range
  metadata reads (and a full 628 KB download for source `112`). Sources `106`,
  `107`, and `115` are Freelang; `114` is the Austronesian Basic Vocabulary
  Database; `112` is an Indonesian-English translator. All five carry `co`.
  The final 11-source audit therefore contains three duplicate Wiktionary
  sources and eight conservatively excluded `co` sources, with zero eligible
  new independent families. The final local report is
  `logs/panlex-ontolex-batch1-final-source-family-audit.json` (logs remain
  uncommitted).
- Two exact searches through the official Zenodo records API returned only
  record `6757353`, Batch 1/8. Batch 2-8 are not currently publicly searchable,
  so do not block the dictionary pipeline waiting for them. PanLex Batch 1 is
  exhausted as a practical source-expansion path under current license and
  independence gates.
- The next independent-source feasibility pass also closed two tempting but
  low-yield routes. OmegaWiki has the right concept-based multilingual model
  and historical CC-BY/GFDL licensing, but its old site and dump page are no
  longer reproducibly reachable (untrusted TLS on HTTPS and no HTTP
  connection). Do not add it as a production dependency without a verified,
  checksummed dump from an authoritative archive.
- Concepticon 3.4.0 was downloaded from official Zenodo record `14923561` and
  probed with `scripts/probe-concepticon-source-gap-residuals.mjs`. Excluding
  the unlinked sentinel `Parameter_ID=0` is mandatory; including it creates
  false multilingual alignments between unrelated forms. The clean dataset
  has 210 four-language concepts and 3,001 unique terms in those concepts.
  Against the current 3,455-row residual pool it matched only eight source
  words and zero exact target hints, so it adds no strict candidates. Keep it
  as non-publication concept metadata only.
- Unihan is suitable for independently checking single-character Han readings
  and definitions, not for broad source-gap generation. Only three Chinese
  generation hints in the current residual report are single characters, and
  one is already supported, so its theoretical strict-pool gain is at most two
  rows. KANJIDIC2 belongs to the same EDRDG organizational source as JMdict and
  cannot be counted as a fully independent dictionary family. Tatoeba can
  supply licensed examples but cannot prove a word sense or translation.
- `scripts/export-panlex-evidence.py` now implements that offline boundary. It
  streams CSV/TSV or gzip snapshots, recognizes long and abbreviated PanLex
  table/column names, stages only en/pt-BR/zh/ja expressions, and exports the
  existing supplemental-evidence SQLite schema. Required snapshot tables are
  `langvar|lv`, `expr|ex`, `denotation|dn`, `meaning|mn`, and `source|ap`.
- A reviewed `--family-map` maps each original PanLex source ID to its actual
  evidence family. Unmapped IDs are forced to `panlex-unmapped`, carry
  `production_publishable=false`, and are ignored by both prefilter and final
  reverse validation. The mini fixture regression merged four unmapped rows
  into v3 evidence and retained exactly the same 18 strict candidate keys.
- The v3 Japanese Word2Word evidence refresh increased the final strict pool
  from 17 to 18 rows. The only new sense was pt-BR `ubíquo` (`2368070`).
  Gemma accepted its definition contract at `0.95`, but the hard preferred-term
  gate rejected it because `preferred_terms.en` was null (the model supplied
  `omnipresent` only as a suggestion). Qwen was not called and no draft was
  written. The strict residual pool is therefore exhausted under the current
  independent-evidence and exact-term rules.
- A fresh residual sample confirmed that broad manual-review candidates are
  not a production pool: the bounded run reached 11 approvals among 121 valid
  Gemma reviews, while most rows were semantic rejects or lacked complete
  pt-BR/zh definition contracts. Do not scale this lane by lowering the gate.
- The combined supplemental evidence database already existed at
  `.tmp/combined/openwn-word2word3-apertium-wikidata-v2-evidence.db` but was not
  passed to the first reverse-evidence command. Reverse validation and
  prefilter now auto-detect it; pass `--supplemental-source-db none` only for a
  deliberate baseline comparison.
- The current default is the v3 combined database,
  `.tmp/combined/openwn-word2word3-ja-apertium-wikidata-v3-evidence.db`. It adds
  553,029 top-3 Japanese-English corpus rows. A source-gate experiment raised
  nominal candidates from 17 to 251 but Gemma accepted only 5/20, so it was
  reverted. Japanese Word2Word is target-term/diagnostic evidence only and
  cannot satisfy the source-sense family minimum.
- On the strict 20-row lane, Gemma approved 17, exact preferred-term filtering
  retained 12, and expanded independent evidence retained nine. Qwen wrote
  seven valid drafts across the base and expanded passes; final Gemma consensus
  accepted six. All six were promoted only in
  `data/processed/linguago_v2_product.definition-contract-gate20-20260805.db`.
  The main product DB and production D1 remain unchanged.
- Candidate-review resume now preserves exhausted invalid rows as completed.
  Use `--retry-invalid-on-resume true` only after a meaningful endpoint,
  prompt, model, or parser change; the old behavior repeatedly spent calls on
  the same terminal definition-contract failures.

## 2026-08-03 Final-gate reverse-evidence correction

- Product DB was not written and production D1 v83 was not changed.
- `source_meaning_anchor` is now persisted independently from generated
  `gloss_key`; reverse validation must use the former when available.
- Source-family policy is consistent across prefilter and reverse validation:
  Kaikki plus WikDict is one `wiktionary` family; OMW alone is manual review;
  exact OMW plus another family may satisfy the two-family gate.
- Corrected 34-row diagnostic: source review `34/34`, generation `30/34`, reverse
  support `29/30`, manual `1/30`, unsupported `0/30`. Because generation is
  below 90%, rebuild/rerun the formal 100-row gate before any draft write.
- Four rejected rows were `confessional` (JMdict term failure), `hopscotch` and
  `bunion` (quality-review sense mismatch), and `腹膜` (required pt-BR term
  mismatch). Do not bypass these validators to improve the rate.

### Formal 100-row gate result

- Source review: 94/100 accepted; bounded strict-pool replacements: 8/9.
- Qwen generation after replacement: 88/94 slots (`93.6%`), zero network
  failures. Reverse evidence: 75/88 supported (`85.2%`).
- Independent Gemma consensus: 69/75 accepted (`92%`), zero failed calls.
- End-to-end promotable: 69/100, below the mandatory 80/100 threshold. Do not
  run draft apply, 500-row write validation, or D1 deployment from this batch.
- The ranked source DB currently ends at frequency rank 49,999. The 109-row
  strict all-target independent-family pool is exhausted. The next productive
  step is to extend frequency rankings/candidates or add genuinely independent
  lexical evidence, then rebuild the gate. Lowering validation thresholds is
  not an acceptable workaround.

Read this before making changes.

## Current Production Release

Cloudflare production is dictionary v86, deployed on 2026-08-06 JST:

- Worker version: `35880184-2258-44af-97e6-b00c08c7e2bf`
- Worker cache: `v86d-sequential-form-lookup-29669`
- D1 `published_at`: `2026-08-06T08:33:52.889Z`
- Counts: `entries=29669`, `senses=35193`, `sense_localizations=140772`,
  `examples=3030`, `example_localizations=11898`
- Audited export: `outputs/d1-v2-product-native-export-v86-controlled13`
- Pre-release product DB backup: `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v85-locale-fixed-20260806-151653.db`
- Backup SHA256: `EEC7D7E9BA43D882526D14B9AC4F17CDEE40FAB805BAB9CF88F192578D7AD781`
- Audited v84 rollback SQL package: `backups/v84-rollback-native-before-v85-20260806-151653`

Post-release health, full API regression, focused API checks, and mobile/desktop
render checks passed. Mobile and desktop use separate browser processes because
sharing one Edge process made the first desktop lookup intermittently return to
the empty input state after all mobile cases had run.

## Project Goal

Maintain an iPhone-installable translation/dictionary PWA with:

- Fast word lookup.
- Four-language results.
- Smooth mobile interactions.
- Stable result and control dimensions.
- Backend-controlled provider/model settings.
- Observable provider/dictionary health without exposing secrets.

## Current Product Behavior

The current UI is Vue/Vuetify:

- Text input and translate/clear controls.
- Theme handling with system/light/dark support.
- Settings overlay for provider/model selection.
- Editable provider-specific model lists from `/api/models`.
- Dictionary stats in settings.
- Provider badge for dictionary/cache/model state.
- Result tabs ordered as EN, PT, Chinese, Japanese.
- Bookmarks/history stored locally.
- PWA shell caching with `/api/*` network-only.

## Core Files

Read these first:

```text
README.md
docs/ARCHITECTURE.md
docs/dictionary-v83-large-batch-runbook.md
src/App.vue
src/components/TranslatorCard.vue
src/components/ResultCard.vue
src/components/SettingsOverlay.vue
src/composables/useTranslation.ts
src/composables/useSettings.ts
src/utils/api.js
worker/index.ts
worker/dictionary.ts
worker/config.ts
public/sw.js
```

Historical docs may mention `public/app.js`, `public/styles.css`, `src/index.ts`, or `npm run style:build`; those are old plain-frontend paths.

## Backend Flow

`worker/index.ts` handles API routes:

- `/api/translate`
- `/api/translate-stream`
- `/api/report-error`
- `/api/models`
- `/api/settings`
- `/api/dictionary/stats`
- `/api/health`
- `/health`

Translation order:

1. Normalize input, target language, provider, and model.
2. Rate-limit by client IP hash.
3. Select provider/model or load backend settings from KV.
4. Check KV translation cache.
5. If word-like, try dictionary lookup through `CompositeDictionaryManager`.
6. If dictionary misses, call the selected provider.
7. Parse and validate structured provider JSON.
8. Normalize the response and cache it.

Provider JSON is validated in the Worker before normalization. Invalid complete responses retry once with a repair prompt.

Supported providers are `auto`, `cloudflare`, `dashscope`, `gemini`, and `deepseek`.

## Dictionary Notes

For current v83 generation commands, failure history, interruption recovery,
and expansion gates, read `docs/dictionary-v83-large-batch-runbook.md`. The
runbook is authoritative for the local-only v83 work; this file keeps the shorter
project-wide status.

Current production dictionary source of truth is Cloudflare D1 v2. The v82
WikDict/OMW source-gap baseline was published with:

- `TRANSLATION_CACHE_VERSION = "v82-source-gap-r2-213"`
- Worker version `0bdb4ca1-cc55-48a3-b555-c15f0d7e38dd`
- `/health` counts: `entries=25060`, `senses=30577`,
  `sense_localizations=122308`, `examples=3030`,
  `example_localizations=11898`
- D1 `published_at`: `2026-07-10T18:28:23.903Z`
- Pre-release backup:
  `backups/linguago-dictionary-before-v82-20260711-032736.sql`
- `wrangler` was upgraded to `4.107.0` because `4.103.0` returned Cloudflare
  D1 import `Authentication error [code: 10000]` on `d1 execute --file`, while
  D1 `--command` and `whoami` were healthy.

`worker/dictionary.ts` still contains multiple adapters:

- Cloudflare D1 dictionary lookup through `env.DB`.
- Louis SQLite API lookup through `DICTIONARY_API_URL` and `DICTIONARY_API_TOKEN`.
- A narrow mock JMDict adapter.

D1 should be treated as the production path unless a task explicitly asks to
revive Louis. Dictionary lookup failures are isolated by
`safeLookupDictionaryFirst` in `worker/index.ts`; D1/Louis errors should fall
through to model translation instead of failing the whole request.

Current source-gap generation uses Unsloth Studio, not Ollama. LLM output must
stay in draft/needs-review rows until deterministic promotion passes. The
latest pt-BR source-gap run completed `270/271` candidates; the remaining
manual item is `ouvintes` linked to singular entry `ouvinte`. The first zh-only
pilot promoted `19/19` generated draft senses after adding stricter prompt rules
that prevent Chinese source terms from being copied into English/Portuguese
terms.

The v83 large-batch preparation is implemented but GPU validation is not yet
complete:

- The current raw report is `logs/product-coverage-gaps-v83-large-raw.json`:
  126,439 ranked source entries scanned, 79,239 gaps found, 50,000 retained.
- Strict Tier B contains 2,970 candidates; Tier C contains 5,000 candidates.
  Tier C is mostly pt-BR because the available source evidence cannot satisfy
  the requested zh/ja/en quotas.
- `supplement-dictionary-v2-product-source-gaps-unsloth.mjs` now supports
  `--chunk-size`, `--checkpoint`, `--resume`, `--max-attempts`, endpoint circuit
  breaking, task rerouting, `--force-reload`, and post-load readiness waiting.
  Draft writes commit once per chunk and checkpoint only after the DB commit.
- Run `npm run check:source-gap-large-batch` to test chunk commits, circuit
  breaking, resume, and duplicate prevention with local fake endpoints.
- A model-side evidence verdict is required for v83 batches so a candidate can
  reject a source gloss that is unrelated to its headword.
- A6000 143/144/147 and RTX 4090-56 were upgraded through Studio's official
  `/api/llama/update` endpoint from llama.cpp prebuilt `b9739` to `b9940`.
- Initial smoke runs failed because Studio kept stale `active_model` state after
  the inference process exited. The next run must start with a single
  `--force-reload true` smoke request; do not start the 500-row batch until the
  four-node total reaches at least 18/20 accepted.
- The long prompt failure was isolated to first-token latency through the relay.
  The new `micro` prompt returns in about 1-3 seconds and is normalized back to
  the full product schema before deterministic validation. Use context 1024,
  speculative mode `off`, A6000 `UD-Q4_K_XL`, and endpoint override
  `11447=UD-IQ4_NL`. Prewarm RTX 4090-56 separately for 60 seconds; its Q4 XL
  profile is too close to the 24 GB VRAM limit. IQ4 passed five isolated requests
  but continued to reset its first request in combined four-node runs, including
  with a one-second endpoint cooldown. The three A6000 nodes were stable. The
  500-row write has not started because the combined run still fails the <=2%
  network failure gate.
- The cached 27B Q4 model on RTX 4090-56 was tested as a fallback and also
  failed the gate: 13/20 accepted, one validation rejection, five evidence
  rejections, one socket reset, and slower successful calls than the 35B micro
  path. Repair/restart the node service, replace 56, or explicitly approve a
  three-A6000 batch before any 500-row draft write.
- After a full Studio restart, 56 became stable with 35B `UD-IQ4_NL` when the
  runner fixed `temperature=0`. The current two-node profile (143 Q4 XL + 56
  IQ4) passed 19/20 with no network or validation failures. The 500-row Tier C
  validation then generated 497 rows, wrote 377 drafts, and deterministically
  promoted 297. Eighty semantic/broad-gloss rejects remain draft. Full export
  audit passed at `outputs/d1-v2-product-native-export-v83-500`; nothing from
  this v83 batch has been pushed to Cloudflare D1. Do not start 2,000 rows until
  the 78.8% promote rate is raised above the 80% gate through candidate cleanup
  or separate semantic review.
- Source-gap semantic review raised the 500-row checkpoint to `303/377`
  promoted (`80.37%`) without allowing broad glosses to bypass splitting.
  The subsequent 2,000-row pressure checkpoint completed with 1,405 accepted
  drafts and 595 rejects; deterministic promote accepted 1,199 (`85.34%`).
  The local product DB now has 32,079 publishable senses and published-risk is
  zero. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-pressure-2000` with 26,562 entries
  and 128,316 localizations. Nothing from v83 has been pushed to D1.
- Do not start 5,000 rows yet. Pressure generation acceptance was only 70.25%
  and 110/2,000 rows were infrastructure rejects. Both endpoint circuits ended
  open; 56 had 32 request failures and materially lower accepted output than 143. Fix endpoint recovery/rerouting and rebuild the candidate pool before
  scaling. Resume now treats `--limit` as a total checkpoint target. If a
  Windows parent process is terminated, verify no child supplement Node process
  remains; use the checkpoint reconcile script against the pre-run baseline if
  concurrent output is suspected.
- The circuit breaker now supports timed half-open recovery and one bounded
  task recovery cycle. `npm run check:source-gap-large-batch` verifies this in
  addition to permanent endpoint rerouting and resume duplicate prevention.
- 143 and 56 were updated from llama.cpp b9940 to b9975 through Studio's official
  API. After the user changed networks, consecutive 10/15-row runs had zero
  infrastructure failures; a corrected retry prompt raised the repeated 15-row
  set to 15/15 accepted.
- A strict Tier B 100-row local draft run then accepted 81 rows. Checkpoint-only
  deterministic promote accepted 78/81 (`96.3%`) and left three semantic-drift
  rows in draft. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-tier-b-100` with `entries=26640`,
  `senses=32157`, and `sense_localizations=128628`; `flagged_senses=0`. Nothing
  from v83 has been pushed to D1. Do not start the next 500 until the 81% raw
  generation acceptance reaches the 90% plan gate.
- A 2026-07-14 follow-up filters broad glosses before LLM use, distinguishes
  malformed model JSON from infrastructure failure, and reroutes exhausted
  format failures once to another endpoint. The latest real run generated 99
  rows, wrote 85 drafts, and promoted 78. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-tier-b-fresh-100` with
  `entries=26718`, `senses=32235`, and `sense_localizations=128940`;
  `flagged_senses=0`. Raw acceptance was 85.9%, so 500-row expansion remains
  blocked. No v83 data has been pushed to D1.
- A post-fix live dry-run later exceeded the 15-minute tool timeout. Its orphan
  Node child was stopped and no DB rows were written. Root cause in the client:
  `fetch failed` incorrectly triggered the 300-second model-load path. It now
  reroutes as an infrastructure failure; only explicit unloaded-model responses
  call the load API. Run a short live smoke test before any further production.
- The required recheck passed on 2026-07-15 after the network changed. Adding
  compact WikDict/OMW source evidence to the micro prompt raised a repeated
  smoke batch from 7/9 to 9/9; a separate fresh dry-run accepted 20/20. The next
  real batch accepted 97/99 drafts and deterministically promoted 93/97, with
  zero infrastructure, JSON, or validator failures. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-evidence-fix-100` with
  `entries=26811`, `senses=32328`, `sense_localizations=129312`, and
  `flagged_senses=0`. The 500-row draft gate is now open, but no v83 data has
  been deployed.
- The following checkpointed 500-row pressure batch also passed. Of 498 rows
  requiring generation, 472 became drafts (`94.8%`) and 449 passed deterministic
  promotion (`95.1%`). Both endpoints completed with zero infrastructure or JSON
  failures. Full in-memory audit passed at
  `outputs/d1-v2-product-native-export-v83-evidence-fix-500` with
  `entries=27260`, `senses=32777`, `sense_localizations=131108`, and
  `flagged_senses=0`. The 500-row gate is complete, but the old strict pool has
  only about 539 unused rows; regenerate coverage gaps before deciding between
  another approximately 500-row batch and the 2,000-row gate. No v83 data has
  been deployed.
- Regeneration against the latest DB yielded 819 strict Tier B candidates, not
  enough for 2,000. A second 500-row report generated 496 rows, accepted 460
  drafts (`92.7%`), and promoted 443 (`96.3%`). Two transient 143 socket errors
  were recovered by rerouting, leaving zero infrastructure rejects. Full audit
  passed at `outputs/d1-v2-product-native-export-v83-post-500-production-500`
  with `entries=27703`, `senses=33220`, `sense_localizations=132880`, and
  `flagged_senses=0`. About 319 strict candidates remain. Finish that pool before
  defining a reviewed Tier C expansion; no v83 data has been deployed.
- The apparent 319-row remainder accepted 302/319 drafts and promoted 294. A
  complete 73,436-gap scan then proved the old 50,000-row report was a moving
  window. Of 1,281 lower-rank two-language first-sense candidates, a smoke passed
  only 13/16 because of three correct source mismatch rejections. Requiring
  three first-sense languages produced 192 rows; smoke passed 16/16, production
  accepted 173/185 drafts, and promote accepted 159/173. Final audit passed at
  `outputs/d1-v2-product-native-export-v83-first-sense-3lang` with
  `entries=28156`, `senses=33673`, `sense_localizations=134692`, and
  `flagged_senses=0`. Freeze the remaining approximately 1,089 two-language
  candidates pending source-evidence review. No v83 data has been deployed.

The v69 A6000 source-gap follow-up used `a6000-143` and `a6000-147`
(`100.99.99.99:11441` and `100.99.99.99:11444`) with Unsloth
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF` / `UD-Q4_K_XL`. The 20-row dry-run accepted
`20/20`; the 100-row draft apply accepted `99/100`; deterministic promote
accepted `94` senses and left `7` source-term mismatches in draft review
(`罷/霸`, `臺/苔`, `赴/敷`, `濟/積`, `扬/洋`, `ouvinte/ouvintes`,
`bisavô/bisavó`).

The v70 source-gap follow-up fixed an over-broad pre-generation skip rule so
Chinese source gaps with English glosses containing `one's` are not treated as
English possessive/demonstrative entries. A 20-row A6000 dry-run accepted all
`17/17` generated rows after three already-complete pt-BR rows were skipped.
The 100-row draft apply accepted `99/100`; deterministic promote accepted all
`99` draft senses.

The v71 source-gap follow-up tightened candidate filtering again: English
capitalized proper-like headwords and zh candidates whose gloss is only a
Latin proper name are filtered out, and the repeated `audible` football-play
residual is blocked for generic batches. The strict v71 filter found no clean
zh candidates; the batch was mostly English high-value gaps. A 20-row A6000
dry-run accepted `19/20` with only `audible` rejected, then the 100-row draft
apply accepted `98/100` after skipping three already-complete rows.
Deterministic promote accepted the `98` new draft senses. Product fast/full
audits and online API/render checks passed after publishing.

The v72 source-gap batch used all four active Unsloth nodes together:
`a6000-143` / `a6000-147` with
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF` `UD-Q4_K_XL`, and `rtx4090-47` /
`rtx4090-56` with the lower-memory 35B MTP variant. The A6000 half accepted
`60/60`; the 4090 half selected `60`, skipped `3` already-linked complete
source gaps, accepted `56`, and rejected `1` transient JSON parse failure
(`touchy`). Deterministic promote accepted `116` new draft senses and `464`
localizations. Product fast audit, published-risk audit, and full D1 native
export audit passed. The export directory is
`outputs/d1-v2-product-native-export-v72-four-node-source-gap-116`, with
`entries=23957`, `senses=29474`, and `sense_localizations=117896`.

The v73 source-gap batch repeated the same four-node split after regenerating
coverage gaps from v72. The strict clean filter produced `137` candidates:
`134` English and `3` pt-BR. A 20-row dry-run accepted `20/20`; the 100-row
apply selected `100`, skipped `3` already-linked complete rows, generated `97`,
accepted `97`, and rejected `0`. Deterministic promote accepted all `97` new
draft senses and `388` localizations, while the seven older source-term
mismatch residual drafts remain in review. Product fast audit, published-risk
audit, and full D1 native export audit passed. The export directory is
`outputs/d1-v2-product-native-export-v73-four-node-source-gap-97`, with
`entries=24054`, `senses=29571`, and `sense_localizations=118284`.

The post-v73 source evidence DB has been expanded with WikDict and Open
Multilingual Wordnet:

- WikDict SQLite pairs are stored in `data/raw/wikdict/` for all 12 directions
  among EN, ZH, JA, and PT.
- OMW tab files are stored in `data/raw/omw/` for `eng`, `cmn`, `jpn`, and
  `por`.
- `scripts/import-dictionary-sources-v2.mjs` supports `wikdict-*` sources and
  `omw-30`.
- `scripts/build-dictionary-v2-canonical.mjs` emits multiple
  `sense_localizations` for translation-evidence sources, so coverage gap can
  see WikDict target translations and OMW synset-aligned lemmas.
- The refreshed coverage reports are
  `logs/product-coverage-gaps-v74-wikdict-omw.json` and
  `logs/product-coverage-gaps-clean-high-value-balanced-v74-wikdict-omw-500.json`.

Treat WikDict and OMW as source evidence, not publishable dictionary content.
They improve gap selection, but LLM generation must still write draft rows and
pass deterministic promote before D1 publication.

The first v74 WikDict/OMW source-gap pass has been published to D1. Important
results:

- Initial broad candidate generation showed that WikDict/OMW improve coverage
  but add noisy homograph evidence, especially pt-BR inflected forms, Japanese
  single-character/stem rows, offensive slang, and Traditional Chinese residuals.
- The filter and Unsloth validator now block known residuals such as
  `seja/are`, `ama/lady`, `acha/battle axe`, `minutos/proceedings`,
  `possa/whitethorn`, `for/for loop`, `pega/magpie`, `听听`, `总会`,
  `出身`, `いま/today`, `思`, `ピーター`, and noisy Japanese single
  character source gaps.
- The successful local v74 batches used all four Unsloth endpoints. The first
  batch wrote `100` generated rows to draft, manually blocked `30` noisy draft
  senses, and promoted `69` clean draft senses. The follow-up promoted another
  `43` clean draft senses after moving `ouvintes`, `bisavó`, Chinese
  source-mismatch residuals, and `parado/stale` to review.
- Current local product fast audit after v74 has `publishable.senses=29750`;
  published-risk remains `flagged_senses=0`.
- A refreshed native product D1 export was pushed and full export audit passed
  with `entries=24233`, `senses=29750`, and
  `sense_localizations=119000`.
- The v75 follow-up used all four Unsloth endpoints on the post-v74 gap report,
  promoted `91` clean source-gap draft senses, and kept `8` source-mismatch or
  low-confidence rows in `needs_review` (`sai/saí`, `mínima`, `tento`,
  `aceite`, `acorda`, `cole`, `promotoria`, `observando`). Product fast audit,
  published-risk audit, full D1 native export audit, online focused API check,
  online dictionary regression, and render focused check passed. The published
  D1 export counts are `entries=24324`, `senses=29841`, and
  `sense_localizations=119364`.
- The v76 follow-up used all four Unsloth endpoints again on the post-v75 gap
  report, accepted `97/100` generated rows, conservatively moved `14`
  semantically risky rows to `needs_review`, and promoted `83` clean source-gap
  draft senses. Product fast audit, published-risk audit, full D1 native export
  audit, online dictionary regression, focused API check, and render focused
  check passed. The published D1 export counts are `entries=24407`,
  `senses=29924`, and `sense_localizations=119696`.
- The v77 follow-up repeated the strict post-v76 filter with all four Unsloth
  endpoints, added `blá`, `coca`, and `colegial` to the residual blocklist,
  accepted `97/100` generated rows, rejected `fax`, `cuzão`, and `quites`,
  conservatively moved `17` risky draft senses to `needs_review`, and promoted
  `78` clean source-gap draft senses. Product fast audit, published-risk audit,
  full D1 native export audit, online dictionary regression, focused API check,
  and render focused check passed. The published D1 export counts are
  `entries=24485`, `senses=30002`, and `sense_localizations=120008`.
- The v78 follow-up continued the strict post-v77 filter with all four Unsloth
  endpoints, added the new rejected/review residuals to the filter, accepted
  `98/100` generated rows in the 100-row apply batch, rejected `rancor` and
  `center`, moved `15` risky or source-term mismatch drafts to `needs_review`,
  and promoted `81` clean source-gap draft senses. Product fast audit,
  published-risk audit, full D1 native export audit, online dictionary
  regression, focused API check, and render focused check passed. The published
  D1 export counts are `entries=24566`, `senses=30083`, and
  `sense_localizations=120332`.
- The v79 follow-up used the strict r7 report, confirmed pt-BR and ja dry-runs
  at `30/30` accepted each, applied `50` pt-BR and `50` ja drafts, and
  deterministically promoted `97` clean source-gap senses. The rejected draft
  was the ja row `しろ` with `gloss_key=Shiloh`, where the model drifted into
  `Battle of Shiloh`; keep it in review. Product fast audit, published-risk
  audit, full D1 native export audit, online dictionary regression, focused API
  check, and render focused check passed. The published D1 export counts are
  `entries=24663`, `senses=30180`, and `sense_localizations=120720`.
- Direct access to `100.99.99.99:11441`, `11444`, `11447`, and `11448` still
  fails from this machine with `Bad access`/timeout, but the lab-win portproxy
  and backend Unsloth services are healthy when tested from lab-win. This points
  to Windows Firewall or Tailscale inbound policy blocking external TCP to those
  ports. A local SSH tunnel through lab-win worked for v79 generation; do not
  add persistent firewall rules without explicit user approval.
- The v80 batch was pushed and deployed. The strict r3 filter produced `423`
  clean candidates. A 30-row dry-run accepted `30/30`, the 100-row draft apply
  accepted `96/100`, and deterministic promote accepted `89` senses while
  leaving `8` source-term mismatch drafts in review. Product fast audit,
  published-risk audit, full native export audit, online dictionary regression,
  focused API check, and render focused check passed. The published export is
  `outputs/d1-v2-product-native-export-v80-r3-89`, with `entries=24752`,
  `senses=30269`, and `sense_localizations=121076`. Wrangler `d1 execute
--file` still failed through Cloudflare's `/import` endpoint with auth code
  `10000`; the D1 data was restored through `scripts/restore-d1-native-via-query.mjs`,
  which batches the same SQL through D1's `/query` endpoint.
- The v81 batch regenerated the post-v80 gap report, which found `595` gaps
  after the first-sense completeness gate. The strict r1 filter left `333`
  clean candidates (`pt-BR=76`, `zh=33`, `ja=224`). The source-gap validator
  was fixed so pt-BR/English same-spelling loanwords are allowed when the word
  appears in English source evidence, rather than being rejected as copied
  source terms. After that fix, the 30-row dry-run accepted `30/30`, the 100-row
  draft apply accepted `99/100`, and deterministic promote accepted `96`
  senses while leaving `10` source-term mismatch drafts in review. The stale
  accepted `aquecedor` draft with reviewed localizations was moved back to
  `needs_review`. Product fast audit, published-risk audit, full native export
  audit, online dictionary regression, focused API check, and render focused
  check passed. The published export is
  `outputs/d1-v2-product-native-export-v81-r1-96`, with `entries=24847`,
  `senses=30364`, and `sense_localizations=121456`. D1 was restored through
  `scripts/restore-d1-native-via-query.mjs`, then Worker cache was bumped to
  `v81-source-gap-r1-96`.
- Next coverage-gap runs should prefer `--strict-zh true` for Chinese source
  gaps and continue small-batch draft/promote review before any D1 publish.

## Frontend Constraints

Preserve these unless explicitly asked to redesign:

- Mobile input focus should not create sudden card jumps.
- Loading-to-result transition should keep result cards stable.
- Buttons should not resize between idle/loading states.
- Do not use `transform: scale()` for button feedback.
- Result tab switching should not make card height jump.
- Provider badge should stay compact and stable.
- Settings overlay must cover the viewport and sit above app content.
- Theme changes should update document theme data and status-bar color promptly.

## Service Worker Rules

- `public/sw.js` owns app-shell behavior.
- `/api/*` must stay network-only.
- Navigations should be network-first with cached index fallback.
- Vite hashed `/assets/*` can be cache-first.
- Bump `CACHE_NAME` when app-shell behavior changes.

## Verification Checklist

```bash
npm run build
npm run check
npm run check:all
npm run check:dictionary-fixture
npm run check:worker-dictionary-fallback
```

Use targeted Playwright scripts after layout or interaction changes:

```bash
node scripts/result-tabs-check.mjs
node scripts/system-theme-check.mjs
node scripts/mobile-translate-height-check.mjs
```

Some scripts were written for the old plain frontend. Confirm a script targets current Vue DOM before treating it as authoritative.

## Common Commands

```bash
npm install
npm run dev
npm run dev:worker
npm run build
npm run check
npm run deploy
```

In PowerShell, `npm` may be blocked by execution policy; use `npm.cmd run <script>`.

## Current Production URL

```text
https://translation-pwa.qhzggzh-linguago.workers.dev
```

## Common Pitfalls

- Do not edit deleted/plain-frontend files mentioned in stale docs.
- Do not expose `DICTIONARY_API_TOKEN` or provider API keys.
- Do not expose secret values through `/api/health`.
- Keep frontend model defaults aligned with backend `/api/models`.
- Do not bypass provider JSON validation.
- Do not let `/api/*` responses be cached by the service worker.
- Review untracked SQL/log/archive/scratch files before committing.

## Latest Local Dictionary Gate (2026-07-15)

- The post-v83 three-language run leaves exactly `1,084` candidates whose first
  sense has exactly two clean languages (`pt-BR=922`, `ja=128`, `zh=32`,
  `en=5`). The filter supports `--max-first-sense-langs` so this pool does not
  include three-language rows.
- A read-only candidate evidence gate exists at
  `scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs`.
  It prewarms unloaded Studio nodes and uses `11441=UD-Q4_K_XL` and
  `11447=UD-IQ4_NL`.
- Its revised prompt matched all 16 previously labelled control outcomes,
  including rejection of `banimento`, `红梅`, and `良子`. A subsequent 20-row
  review was technically healthy but contained 14 old smoke rows; among its six
  new rows, five were approved and `幽怪/appearance` was rejected. Use the
  replacement `product-coverage-gaps-v83-two-lang-evidence-fresh-20.json`
  excluded both prior smoke reports and returned 14/20 evidence approvals with
  no endpoint failure. Chinese passed 0/5, so evidence review remains mandatory.
  Unicode proper-name filtering then removed `Düsseldorf`, leaving 13 approved
  pt-BR/ja rows in `product-source-gap-v83-two-lang-evidence-fresh-20-approved-clean.json`.
  Run a generation dry-run on those 13 before any draft apply. No v83 data is
  deployed.
- The following 13-row generation pilot initially appeared 13/13 but manual
  review exposed copied Japanese pronunciation in EN/PT and one unrelated
  English term. The generator now rejects shared EN/PT pronunciation for
  different translated terms and English term/gloss token drift, with explicit
  retry instructions. Pure-kana source readings are normalized to the headword.
- The corrected pilot accepted 12/13. `ゆき` remained rejected for missing IPA,
  and `quinzena` was held because 15 days is not exactly a 14-day fortnight.
  The other 11 were drafted and deterministically promoted 11/11. Full local
  export audit passes at `outputs/d1-v2-product-native-export-v83-two-lang-evidence-11`
  with `entries=28167`, `senses=33684`, and
  `sense_localizations=134736`. v83 remains local only.
- The latest two-language quality experiment reviewed 100 candidates and
  assembled 85 reviewed/manual-evidence rows. Strict generation accepted 66/85
  with zero endpoint failures, below the 90% production gate, so the main DB was
  not changed. Do not use the earlier 75/85 structural result as quality
  evidence; it contained wrong Japanese readings.
- Chinese dictionary readings now use `pinyin-pro` with `toneSandhi:false`.
  Japanese readings are checked against a 226,730-term JMdict index. Generation
  and QA use the primary English source term as a single-sense anchor.
- `supplement-dictionary-v2-product-source-gaps-unsloth.mjs --replay-report`
  reuses exact accepted dry-run outputs. A separate validation DB replayed 66/66
  into review drafts; audits passed, publishable senses stayed 33,684, and
  `flagged_senses=0`. The production DB and D1 were not changed.
- The next independent 20-row smoke proved that same-model review on two nodes
  is correlated, not consensus. Use
  `scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs`
  after generation. It reverse-checks generated terms against CC-CEDICT,
  Kaikki, JMdict, FreeDict, and WikDict; OMW-only evidence remains manual.
- The reverse gate reduced 12 model-approved rows to 5 independently supported
  rows and 7 manual rows. A database-copy replay and deterministic promote
  accepted those 5/5. Fast, published-risk, and full export audits passed at
  33,689 publishable senses. The main DB and D1 remain unchanged.
- The supplement runner now replaces exact English-term pronunciations from
  ECDICT (`pronunciation_system=ecdict-phonetic`). It replaced 11/12 English
  pronunciations in the replay and fixed the bad model pronunciation for
  `electric guitar`. Portuguese pronunciation is not yet deterministic.
- `promote-dictionary-v2-product-source-gap-drafts.mjs` supports
  `--reverse-evidence`; use it for every weak two-language batch so unrelated
  historical drafts cannot enter the promote scan.
- A second zero-overlap smoke accepted 11/20 at generation and only 6/11 after
  reverse evidence. The two independently validated supported subsets (5+6)
  were replayed into the main local DB after backup. Full local export now has
  `entries=28178`, `senses=33695`, and `sense_localizations=134780`; blockers
  and `flagged_senses` are zero. v83 is still not deployed.
- A reverse-evidence prefilter then selected a fresh balanced 50-row batch.
  Identical 143/56 runs accepted 20 and 19 rows, with seven pass/fail changes;
  network failures remained zero. Post-generation reverse validation supported
  only nine rows. Those nine were promoted locally after all audits passed.
  Current local export counts are `entries=28187`, `senses=33704`, and
  `sense_localizations=134816`. Production D1 remains unchanged; do not expand
  to 500 rows until candidate ranking improves.
- Candidate ranking now uses exactly one unambiguous OMW synset and derives
  target hints from that synset only. A fresh 20-row run on 143/56 accepted
  15/20 at model QA and 14/20 after independent reverse evidence, with no
  endpoint failure. Use `--prompt-mode micro`, not the obsolete
  `--prompt-profile micro`; the obsolete option silently falls back to compact
  mode and omits the required evidence verdict. The 14 supported rows were
  replayed and promoted locally after validation-copy and full-export audits.
  Current local export counts are `entries=28201`, `senses=33718`, and
  `sense_localizations=134872`; blockers and `flagged_senses` are zero. The
  backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-omw-unambiguous-14-20260716-224025.db`.
  Production D1 is still v82 and unchanged.
- Lexical QA and EN/PT pronunciation QA are now separate. The former no longer
  mislabels deterministic `ecdict-phonetic` strings as invalid IPA. Targeted
  retries use `--only-source-entry-ids`. A five-row residual retry produced
  three additional reverse-supported entries (`mirra`, `sinusite`, and
  `ibuprofeno`), promoted locally after validation-copy audits. `néon` and
  `サツマイモ` remain manual Brazilian-Portuguese pronunciation residuals.
  Current local export counts are `entries=28204`, `senses=33721`, and
  `sense_localizations=134884`; blockers and `flagged_senses` remain zero.
  Production D1 remains unchanged.
- The next zero-overlap unambiguous-OMW batch contained 48 pt-BR and 2 ja
  candidates. Generation accepted 39/50 in 201.2 seconds with zero endpoint
  failures; reverse evidence supported 37 and held two for manual review. The
  37 supported rows replayed and promoted locally after validation-copy and
  full-export audits. Current local export counts are `entries=28241`,
  `senses=33758`, and `sense_localizations=135032`, with all blockers and
  `flagged_senses` at zero. Six rejected rows were pronunciation-review JSON
  failures, so that reviewer now defaults to 260 tokens and requests concise
  output. Production D1 remains v82 and unchanged.
- Retrying the 11 model-QA residuals with the 260-token concise pronunciation
  reviewer removed all six prior pronunciation JSON parse failures. Three rows
  (`anil`, `mandioca`, `alfabetizacao`) passed both model QA and independent
  reverse evidence and were promoted locally. Eight rows remain manual; do not
  weaken the pt-BR IPA gate to force them through. Replay now selects exact IDs
  from its approved report, so `--limit` cannot truncate later matching rows.
  The latest local export is
  `outputs/d1-v2-product-native-export-v83-omw-unambiguous-57` with
  `entries=28244`, `senses=33761`, and `sense_localizations=135044`; blockers
  and `flagged_senses` are zero. Production D1 is still v82.
- The final zero-overlap unambiguous-OMW remainder contained 16 rows. The
  143/56 dry-run accepted 15/16 in 65.6 seconds with zero endpoint failures;
  independent reverse evidence supported all 15 accepted rows. They replayed
  and promoted 15/15 after validation-copy audits. `bolota` remains a manual
  pt-BR IPA residual. The high-confidence pool is now exhausted. The latest
  local export is `outputs/d1-v2-product-native-export-v83-omw-unambiguous-72`
  with `entries=28259`, `senses=33776`, and
  `sense_localizations=135104`; all blockers and `flagged_senses` are zero.
  Production D1 remains v82.
- A fresh coverage rebuild proved the strict unambiguous-OMW pool is exhausted:
  833 unseen two-language-first-sense candidates produced zero automatic rows,
  20 manual rows, and 813 unsupported rows. A conservative aligned-first-sense
  Tier B review retained 11 candidates, but generation plus independent reverse
  evidence supported only `apontador`, `おとな`, and `ふし`. All three were
  validation-copy audited and promoted locally. The latest export is
  `outputs/d1-v2-product-native-export-v83-evidence-gated-75` with
  `entries=28262`, `senses=33779`, and `sense_localizations=135116`; blockers
  and `flagged_senses` are zero. Do not expand Tier B unchanged; first fix the
  recurring Chinese reading mismatch and weak anchor issues. Production D1 is
  still v82.
- Tier B follow-up fixes are implemented but have not changed the DB. For
  non-Chinese source rows, Chinese target pinyin is now generated
  deterministically with `pinyin-pro`; a four-row retry removed all
  `zh_reading_mismatch` errors. Candidate evidence review now aggregates
  high-quality same-headword WikDict rows and emits `english_anchor` plus
  mandatory `preferred_terms`. A `yeehaw` pilot correctly produced
  `pt-BR=irra` and `ja=ヒーハー`, then stopped at the English IPA review gate.
  Keep that row and the other pronunciation disputes in manual residuals. Do
  not scale Tier B until EN/PT pronunciation has an authoritative source or a
  conservative conflict-adjudication path. Production D1 remains v82.
- Cross-node IPA repair is now implemented. After lexical QA passes, a rejected
  EN/PT IPA can be repaired once on another endpoint and reviewed again by the
  original endpoint. Only fields already marked `IPA` may change; ECDICT
  deterministic English pronunciation is preserved. A three-row pilot
  recovered `あさ`, and reverse dictionaries supported all four terms. It was
  validation-copy audited, replayed, and promoted locally after backup. The
  latest local export is
  `outputs/d1-v2-product-native-export-v83-evidence-gated-76` with
  `entries=28263`, `senses=33780`, and `sense_localizations=135120`; blockers
  and `flagged_senses` are zero. `determinante`, `かんな`, and `yeehaw` remain
  pronunciation/manual residuals. Production D1 remains v82.
- A zero-overlap Tier B 20-row diagnostic approved 15 source senses, generated
  nine structurally valid rows, and found only three with full reverse
  dictionary support: `tcheca`, `leiloar`, and `fatiar`. Those three were
  promoted locally after validation-copy audits. The main DB now has `28754`
  product entries, `34306` product senses, and `33783` publishable senses.
  Local export `d1-v2-product-native-export-v83-evidence-gated-77` contains
  `28266` entries and `135132` sense localizations. All blockers and risk flags
  remain zero. Production D1 remains v82.
- Pronunciation repair responses may be plain IPA strings or nested objects
  containing `ipa`/`pronunciation`. The supplement script now normalizes both
  forms and no longer permits `[object Object]` to enter review. This fixes the
  response-shape bug, but independent term evidence still controls publish.
- The next Tier B experiment added a target-language evidence prefilter before
  the LLM review. Of 793 unseen zero-overlap candidates, 437 had at least one
  target-language evidence path; the selected 20 pt-BR rows each covered two
  target languages. Compact verified hints, a compact 320-token reviewer
  prompt, valid-only resume, and OpenCC normalization produced 20/20 valid
  evidence reviews after earlier verbose attempts reached only 10/20 and
  15/20. Generation accepted 11/20 and independent reverse evidence supported
  nine. Those nine (`caloria`, `fragata`, `miojo`, `pandemia`,
  `antidepressivo`, `soldador`, `formaldeido`, `batuta`, `eucalipto`) were
  replayed and promoted locally after validation-copy audits. The current main
  DB has 28,763 product entries, 34,315 product senses, and 33,792 publishable
  senses. Full export `d1-v2-product-native-export-v83-evidence-gated-78` has
  28,275 entries and 135,168 sense localizations with zero blockers and zero
  risk flags. Final yield improved from 15% to 45%, but seven generation
  rejects were still pronunciation-review failures. Keep large-scale Tier B
  closed until pt-BR pronunciation has a deterministic source or stronger
  adjudication. Production D1 remains v82.
- The pt-BR pronunciation blocker now has a deterministic Kaikki/Wiktextract
  path. `npm.cmd run dict:v2:build:pt-pronunciations` builds an ignored SQLite
  index from `data/raw/kaikki_Portuguese.jsonl`; it contains 61,976 terms and
  307,336 explicitly Brazilian IPA rows. The generator prefers generic Brazil,
  then named Brazilian regions, skips Portugal-only data, records
  `deterministic:kaikki-pt-BR:<region>`, and does not ask the LLM to re-review a
  deterministic IPA. The source file is 555,521,010 bytes with SHA-256
  `6d92084f2123076078dc203c0126de9bb15a4e41e0cbed9e440fdeb3ffc241cf`.
- A live A/B run on the 11 unpublished next-20 residuals accepted 9/11 and had
  zero pronunciation rejection; the previous policy rejected seven for
  pronunciation. Reverse dictionaries supported seven (`vinagrete`,
  `bacharel`, `cobarde`, `quiabo`, `penteadeira`, `privatizacao`, `puzzle`).
  They were validation-copy audited and promoted locally. Current local export
  `d1-v2-product-native-export-v83-evidence-gated-79` has 28,282 entries,
  33,799 senses, and 135,196 localizations with zero blockers and risk flags.
  Production D1 remains v82.
- CLI warning: reverse validation requires `--source-db/--report`; `--db/--in`
  silently fall back to the default report. Do not trust the legacy fast audit
  for an arbitrary DB; use an isolated export directory plus the unified full
  export audit.
- The next fresh-50 pt-BR experiment approved 44/50 in remote evidence review,
  accepted 36/44 on first generation, and independently supported 28. One
  targeted retry added only `trojan`, for a final safe 29/50. The other retry
  rows exposed repeatable reviewer problems: `quinino` received contradictory
  IPA decisions after repair and `peroxido` returned non-JSON quality review
  twice. Keep both as residuals instead of weakening validation.
- Those 29 rows were replayed/promoted 29/29 in a validation copy and then the
  main local DB. Backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-kaikki-pt-fresh50-supported29-20260718-204127.db`.
  The local-only evidence-gated-80 export has 28,311 entries, 33,828 senses,
  and 135,312 localizations; all blockers and risk flags are zero and the
  duplicate-localization warning remains 98. Production D1 is still v82.
- Do not start a 500/2,000/5,000 run from the current two-target-evidence pool.
  Its end-to-end safe yield was 58%, despite zero endpoint failures. Build the
  next pool with evidence in all three target languages, then rerun a 20-50
  row gate. Also remember that full export audit requires an export-created
  manifest; run the export script first.
- The three-target experiment returned zero candidates, so that suggested gate
  is not viable with the current open-source evidence graph. The prefilter now
  offers `--require-pt-pronunciation true` and `--require-jmdict-hint true`.
  After excluding the preceding 50 rows, these gates retained 86/723 and the
  next evidence review approved 43/50 with no endpoint or JSON failures.
- Full generation on those 43 accepted 38 (88.4%); reverse validation supported
  28, left 7 manual, and rejected 3. Hard-enforcing review `preferred_terms`
  was worse: 33/43 model-valid and the same 28 independently supported. Triage
  can attach those terms only with `--attach-candidate-review true`; keep it
  off for production because reviewer terms may be broad and exact-string
  enforcement rejects valid synonyms.
- The 28 supported rows were validation-copy audited and promoted locally.
  Backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-deterministic-new50-supported28-20260718-205446.db`.
  Local export `d1-v2-product-native-export-v83-evidence-gated-81` has 28,339
  entries, 33,856 senses, and 135,424 localizations with zero blockers/risk;
  warning count remains 98. Production D1 is still v82.
- Large-scale generation remains closed. Nodes and JSON transport are stable,
  but safe end-to-end yield is 56%. The next improvement must target
  deterministic zh/ja term alignment or add reverse dictionary coverage; do
  not lower the final evidence validator.
- The reverse-evidence validator now supports `--input-mode reviewed` and a
  `--supported-report` output. On the latest approved 43-row review it
  prevalidated 37 candidate rows from reviewer preferred terms. Triage can
  preserve compact review data with `--attach-candidate-review true`.
- A soft preferred-term comparison used
  `--enforce-reviewed-preferred-terms false`. Of 37 pre-supported candidates,
  27 were already complete; generation accepted 6/10 remaining rows and final
  reverse evidence supported four: `triturar`, `genealogia`, `desatualizado`,
  and `linguística`. They promoted 4/4 after an
  isolated validation-copy full audit.
- Current local-only export
  `outputs/d1-v2-product-native-export-v83-evidence-gated-82` contains 28,343
  entries, 33,860 senses, and 135,440 localizations. All blockers and
  `flagged_senses` are zero; warning 98 is unchanged. Backup before replay:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-reviewed-soft-supported4-20260718-213746.db`.
- Production D1 is still v82. Do not deploy evidence-gated-82 implicitly and
  do not start 500/2,000/5,000 generation from this pool: final safe yield on
  the truly remaining rows was 4/10.
- `npm run check:source-gap-large-batch` is restored in `package.json` and
  passes chunk commit, resume, circuit open/recovery, malformed JSON reroute,
  and checkpoint promote tests. The fixture disables deterministic lexical
  checks only because it uses fake terms; production validation remains on.
- Freshness is now based on actual generation history, not merely absence from
  the product DB. `dict:v2:coverage:index-source-gap-attempts` scanned 345 v83
  log JSON files and indexed 4,679 unique generated/checkpoint-attempted source
  IDs. Pass its output to `--exclude-source-entry-id-files` when rebuilding a
  pool; review-only and never-generated selections are not excluded.
- Current gap rebuild: 72,789 gaps; strict pool 480 but only three truly fresh;
  relaxed fresh pool 1,440. The strongest relaxed policy (two target languages,
  pt-BR IPA, JMdict hint, and one unambiguous OMW target) produced 107 fresh
  pt-BR candidates.
- First fresh gate: evidence review 17/20 approved with 20 valid JSON and zero
  endpoint failure; reviewed-term evidence 17/17; generation 16/17; final
  reverse evidence 13 supported, one manual, two unsupported. Deterministic
  promote was 13/16 (81.25%).
- Replay now inherits `enforce_reviewed_preferred_terms` from its dry-run report
  unless explicitly overridden. This fixed a false `preferred_term_mismatch_ja`
  rejection for `colcha` and prevents dry-run/replay policy drift.
- Latest local-only evidence-gated-83 export has 28,356 entries, 33,873 senses,
  and 135,492 localizations. Backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-fresh-omw1-supported13-20260718-215640.db`.
  All blockers/risk flags are zero; warning 98 is unchanged. Production D1 is
  still v82 and was not deployed.

## 2026-08-02 Formal Production Cycle Handoff

- Chunk05 is the latest fully audited local publishable baseline. Its native
  D1 export contains `29,087` entries, `34,604` senses, and `138,416` sense
  localizations. Full in-memory import audit, published-risk audit, and
  TypeScript checks pass. Production Cloudflare D1 remains v82 and was not
  changed.
- Across chunk01-chunk04, 2,000 candidates produced 374 safely promoted
  senses. Candidate selection must exclude both the source-gap attempt index
  and every prior formal chunk report; otherwise rejected rows reappear.
- The current attempt index has 6,135 source entry IDs. With chunk01-chunk04
  reports excluded, the strict chunk05 pool contains only 85 fresh rows:
  83 pt-BR and 2 ja. There are no remaining strict zh or en rows in this pool.
- Chunk05 used only A6000-143 (`11441`), A6000-147 (`11444`), RTX4090-47
  (`11448`), and RTX4090-56 (`11447`). Use `UD-Q4_K_XL` on the A6000 nodes and
  `UD-IQ4_NL` on the 4090 nodes, one request per endpoint.
- Source review approved 69/85, rejected 14, and retained two bounded failures.
  Four-node generation accepted 44/69 with zero infrastructure failures. All
  44 were initially written as `draft_single_source/needs_review`; independent
  Gemma review later accepted 30 for promotion and rejected 14.
- A6000-155 supplied an independent Gemma 4 31B QAT reviewer. GPU contention
  with a separate DiffusionGemma vLLM process initially reduced it to about
  `2.3 tok/s`; Studio `parallel=1` made status calls appear hung while chat was
  active. That vLLM service was later explicitly stopped, allowing Gemma to
  complete all 44 reviews: 30 accepted and 14 rejected, with zero failures.
- The first 12 and remaining 18 accepts each passed fixed-checkpoint conversion,
  isolated promotion, full export audit, and main promotion. No chunk05 draft
  remains pending review; the 14 rejected rows remain unpublished
  `draft_single_source` audit records. The complete audited export is
  `outputs/d1-v2-product-native-export-v83-production-chunk05-complete-validation`.
- Main and complete validation DB SHA-256 is
  `F653307024E87528CFD59D3CD756ACCC2DAFF7AB438BFCE990F26ACF648417B2`.
  The pre-remaining18 backup is SHA-256 verified and must be retained.
- The pre-main backup copy failed due local disk exhaustion, but no partial
  backup remained and the already audited validation DB is identical to the
  main DB. Future automation must fail closed when backup creation fails and
  check free space before copying the product DB.
- Storage cleanup was explicitly approved after chunk05. It removed 128 old
  product DB copies and 115 rebuildable D1 export directories, freeing about
  56.06 GB. The obsolete initial chunk05 validation DB/export were removed
  after the complete validation replaced them, freeing another 457 MB. Keep
  the current DB, complete chunk05 validation copy, verified remaining18
  backup, chunk01-chunk04 milestone backups, source DBs, v82 export, and the
  chunk04/complete-chunk05 exports.
- The post-chunk05 attempt index has 6,218 source IDs. A fresh strict pool from
  50,000 gaps contains zero rows. Relaxing only first-sense evidence still
  yields zero; reducing total evidence to two languages yields only four
  low-priority rows (`fudge`, `conduíte`, `lambreta`, `話中`). Do not start a
  large run by lowering the gate further. Add independent two-language
  validation or another reliable source first.

### 2026-08-02 Kaikki Japanese/Portuguese evidence expansion

- Official Kaikki English-Wiktionary extracts were downloaded and validated:
  `data/raw/kaikki_Japanese.jsonl` (375,732,478 bytes; 197,819 JSONL rows) and
  `data/raw/kaikki_Portuguese.jsonl` (555,521,023 bytes; 434,036 rows). Both
  scans had zero invalid JSON and zero language mismatches.
- `linguago_v2_full.db` now contains `kaikki-ja` (144,096 entries / 181,707
  senses) and `kaikki-pt` (433,990 / 514,189). Integrity, duplicate-order, and
  bad-row checks passed. The product DB and production D1 were not modified.
- Keep `linguago_v2_full.before-kaikki-ja-pt-20260802.db`; its SHA-256 is
  `B763C27658F3D91057934476728DF97989E1264783615C9B920D46EE8E18A82F`.
- Do not run the canonical builder with its default reset behavior. Kaikki JA/PT
  headwords are Japanese/Portuguese but their glosses are English; treating
  those glosses as source-language localizations would corrupt language labels.
- Coverage-gap discovery has an opt-in `--include-kaikki-raw-evidence true`
  channel. Filtering must separately opt in with
  `--allow-supplemental-two-lang-evidence true`; use
  `--required-evidence-gate kaikki_raw_two_lang` for an isolated pool. Exact
  normalized headword, source language, trusted source key, usable English
  gloss, and a shared meaning token are all required.
- After excluding 6,219 historical source IDs, the new gate found 3,553 eligible
  rows: 3,548 Japanese and 5 Portuguese. A controlled 20-row reviewer input is
  `logs/product-coverage-gaps-v83-kaikki-raw-two-lang-dryrun-20.json` (15 JA / 5
  PT). It has not been sent to an LLM yet.
- The 20-row review was subsequently run across ports 11441/11444/11448/11447.
  All four nodes loaded successfully and returned 20/20 valid accepts with no
  transport or parse failures. A short local command timeout interrupted after
  three rows; `--resume true` correctly reused those rows and completed 20/20.
- The first generation comparison exposed two validator problems. The evidence
  reviewer had invented target-language preferred terms unsupported by Kaikki,
  and the English gloss parser reduced `one's post` to `one`. Kaikki-approved
  reports now bind only the exact source term; English remains a semantic anchor,
  and leading possessive gloss wrappers are removed before token comparison.
- The model-based IPA reviewer produced demonstrably false rejects, including
  treating Portuguese `nh=/ɲ/`, `ç=/s/`, and English `initials /ɪˈnɪʃəlz/` as
  errors. Do not use that reviewer as an authoritative gate for this path;
  deterministic ECDICT/Kaikki pronunciation evidence remains valid.
- After these fixes, the no-write generation dry-run skipped three already-linked
  rows and accepted 12/17 new generations (70.6%). Five rejects remained: two
  Japanese reading/JMdict gates, two quality-review rejects, and one source
  evidence rejection. This is below the expansion threshold, so no draft or
  product rows were written and the batch must not be enlarged yet.
- The five remaining generation rejects were confirmed valid rejections, not
  validator bugs: wrong `最期` reading (`さいき` instead of `さいご`), a Japanese
  phrase absent from JMdict, an `embutido` sense drift from `embedded` to
  `sausage`, a Japanese-to-Chinese same-character false friend for `部署`, and
  the ambiguous physical-pocket treatment of `懐中`.
- Reverse dictionaries fully supported only three of the 12 generated rows.
  Independent Gemma 4 31B review accepted `持ち場` and `訛り`, and correctly
  rejected `主催`: English `sponsorship`/Portuguese `patrocínio` imply funding,
  while Japanese `主催` means hosting or organizing.
- The two final rows passed validation-copy replay, semantic-checkpoint mapping,
  dry-run/apply promotion, fast audit, published-risk audit, native D1 export,
  and full in-memory import audit. They were then promoted to the main local DB
  after a SHA-256-verified backup. Current publishable counts are 29,089 entries,
  34,606 senses, and 138,424 localizations; all blockers and risk flags are zero.
  Production D1 was not changed.
- Backup retained:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki2-20260802.db`,
  SHA-256 `F653307024E87528CFD59D3CD756ACCC2DAFF7AB438BFCE990F26ACF648417B2`.

### Second Kaikki evidence batch (local only, 2026-08-02)

- Rebuilt the attempt index with 6,235 prior source-entry IDs, regenerated the
  gap report against the current main DB, and selected a non-overlapping 20-row
  Japanese batch from the `kaikki_raw_two_lang` gate.
- Four-node Qwen evidence review accepted 20/20. Generation skipped three
  already-linked rows and accepted 14/17, with zero network or JSON failures.
  Reverse evidence reduced those 14 to 5 supported, 8 manual, and 1 unsupported.
- `--include-supported true` means include supported rows in the normal review
  set; it does not mean supported-only. The consensus script now has mutually
  exclusive `--only-supported true`. Do not promote from the earlier mixed
  five-row report.
- Correct supported-only Gemma review accepted `強調`, `感度`, `特性`, `母校`, and
  `童貞`. All five passed isolated replay, promotion, fast and published-risk
  audits, native export, and full in-memory import before exact main-DB replay.
- Current local publishable counts are 29,094 entries, 34,611 senses, and
  138,444 localizations. `flagged_senses=0`; all export blockers are zero. The
  existing 98 duplicate-localization warnings remain non-blocking. Production
  D1 is still v83 and was not changed.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki5-20260802-223852.db`,
  SHA-256 `8A4B75241F3BD7375A75476866B76868F17714EB976A85A33E9AD9C243CBB35A`.
  Current main DB SHA-256 is
  `D0CE78FAF2D752B23A8FF0F153B6F369D5F87018BFD307781E111EFA53D7D004`.

### Third Kaikki evidence batch (local only, 2026-08-02)

- The attempt index previously omitted `skipped_preview` rows. This caused
  source entries already marked `already_linked_complete_source_gap` to occupy
  slots in later batches. The indexer now excludes exactly that skip reason;
  it still does not exclude selected rows that were never attempted.
- The corrected third batch contained 20 new Japanese source entries. Qwen
  evidence review accepted 20/20 and generation accepted 17/20 with zero
  transport or JSON failures. Reverse evidence classified the valid rows as
  8 supported, 5 manual, and 4 unsupported.
- Supported-only Gemma review accepted seven rows: `平方`, `アクセル`, `気圧`,
  `空白`, `痙攣`, `実質`, and `食卓`. It correctly rejected `気球` because the
  Japanese definition called a balloon a fixed-wing `飛行機`.
- All seven passed isolated replay and promotion, fast and published-risk
  audits, native export, and full in-memory import before exact main-DB replay.
  Current local publishable counts are 29,101 entries, 34,618 senses, and
  138,472 localizations. All blockers remain zero; production D1 is unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki7-20260802-225336.db`,
  SHA-256 `D0CE78FAF2D752B23A8FF0F153B6F369D5F87018BFD307781E111EFA53D7D004`.
  Current main DB SHA-256 is
  `4829D1EBF497F312C78A5E4E79E056B0BFCC28E6991AB20DA902A7FEE2B11EAA`.

### Kaikki 100-row pressure batch (local only, 2026-08-02)

- Evidence review produced 96 accepts, 3 justified rejects, and one repeated
  malformed-JSON failure routed to manual review. Generation then accepted
  68/96 (70.8%) with zero infrastructure failures. This is below the 90%
  large-scale generation gate, so do not expand this pool directly to 500.
- Generation rejection leaders were `ja_reading_mismatch=13`, quality-review
  reject/failure=11, and English term/gloss mismatch=4. The next optimization
  should improve candidate/readings alignment rather than weaken validators.
- Reverse evidence classified 31 supported, 25 manual, and 12 unsupported.
  Independent Gemma review accepted 25/31, yielding 25 publishable candidates
  from the original 100-row pool.
- All 25 passed isolated replay/promotion, fast audit, published-risk audit,
  native export, and full in-memory import before exact main-DB replay. Current
  local counts are 29,126 entries, 34,643 senses, and 138,572 localizations;
  all blockers are zero. Production D1 remains unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki25-20260802-230653.db`,
  SHA-256 `4829D1EBF497F312C78A5E4E79E056B0BFCC28E6991AB20DA902A7FEE2B11EAA`.
  Current main DB SHA-256 is
  `89D30D033633155AF409006E9B9DA92549108A0B81437BBF2F8C927276CC3ACD`.

### Deterministic JMdict reading repair (local only, 2026-08-02)

- The supplement pipeline now replaces a generated Japanese reading only when
  an exact JMdict headword lookup has exactly one reading. The localization is
  tagged `reading_source=deterministic:jmdict-unique`. Entries with multiple
  JMdict readings remain under the existing validator; the pipeline must not
  guess among them.
- Replaying the 13 reading-related failures from the 100-row pressure batch
  raised generation validity to 9/13 and reduced `ja_reading_mismatch` from 13
  rows to one (`年月`, which has multiple valid readings). This is a targeted
  repair result, not evidence that the full candidate class has reached the
  90% expansion gate.
- Reverse evidence supported only `近辺` and `登山`; independent Gemma 4 31B
  review accepted both. They passed isolated replay, dry-run/apply promotion,
  fast audit, published-risk audit, native D1 export, and full in-memory import
  before exact main-DB replay.
- Current local publishable counts are 29,128 entries, 34,645 senses, and
  138,580 localizations. All release blockers and `flagged_senses` remain zero;
  the 98 duplicate-localization warnings remain non-blocking. Production D1
  remains v83 and was not changed.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-reading2-20260802-231412.db`,
  SHA-256 `89D30D033633155AF409006E9B9DA92549108A0B81437BBF2F8C927276CC3ACD`.

### Pressure-batch quality and English-anchor retry (local only, 2026-08-02)

- Added `build-dictionary-v2-product-source-gap-retry-report.mjs` so a retry
  report keeps the previous validation errors, QA reason, and generated ZH/JA
  terms/readings. Do not retry from the original candidate report because that
  silently drops the context used by the specialized retry prompt.
- The 15 quality/English-anchor failures regenerated to 9 valid rows with zero
  infrastructure failures. A targeted second pass recovered `書面` and `増大`,
  for 11 structurally valid rows in total. Three remaining rows were confirmed
  semantic/POS mismatches; `私有` returned malformed QA JSON even after a
  cross-node format retry and remains manual review.
- English anchor validation now includes comma/semicolon alternatives from the
  same exact Kaikki evidence gloss. This correctly recognizes `increase` and
  `enlargement` for `増大`; it does not accept model-invented synonyms or the
  separate `nail polish` sense for a `manicure` anchor.
- Quality-review JSON format errors retry once through another endpoint. A
  semantic reject is never retried or overridden. If the alternate endpoint is
  also malformed, the row remains `quality_review_failed`/manual.
- The reverse-evidence CLI uses `--report`, not `--generation`. Unknown options
  are currently ignored, so using `--generation` reads the default report and
  can produce plausible but unrelated counts. Always verify `generation_rows`
  and `generation_report` in the output before continuing.
- Reverse evidence supported only `不平`, `クリプトン`, and `今宵`; Gemma 4 31B
  independently accepted all three. They passed isolated and main-DB replay,
  promotion, fast/risk audits, native export, and full in-memory import.
- Current local publishable counts are 29,131 entries, 34,648 senses, and
  138,592 localizations. All release blockers and `flagged_senses` are zero;
  production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-quality3-20260802-232356.db`,
  SHA-256 `4336D207033508CB9613B540D35752D297592A5BFCC897DFBC0D70B99FBA1139`.

### Kaikki batch 5 quality-gated expansion (local only, 2026-08-02)

- The historical-attempt index now also excludes candidates whose source
  evidence review exhausted retries with `valid=false`. This prevents malformed
  rows such as `飢餓` from reappearing in every regenerated pool.
- The coverage filter now rejects capitalized `Name (Location)` glosses for
  Katakana headwords. This removes obvious proper-place rows such as Kabul
  without weakening normal Japanese common-noun coverage.
- The clean 100-row Japanese batch had no historical overlap, mojibake, or HTML
  artifacts. Source evidence review approved 94/100 with zero model failures.
  Four-language generation accepted 86/94 (91.5%) with zero infrastructure
  failures across the four Qwen endpoints. This is the first large candidate
  batch to pass the 90% generation-validity gate.
- Passing generation validation is not sufficient for publication. Reverse
  dictionary evidence supported 22/86 generated rows, and independent Gemma 4
  31B review accepted 21/22. The rejected `引き渡し` remains unpublished.
- The 21 consensus rows passed isolated replay, semantic review, deterministic
  promotion, fast audit, published-risk audit, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,152 entries, 34,669 senses, and 138,676 localizations. All release
  blockers and `flagged_senses` are zero; the existing 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch5-20260802-234007.db`,
  SHA-256 `45F531B2748D0438772F1FB8D74559BA94F05FA785F70450D20EEBDA403BE9BC`.
  Current main DB SHA-256 is
  `0F854E838DA1E644B9FEC35DF367AD8AACA1221D5F7F7B221065A8E8D71046E7`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch5-main`. This is a local
  validation artifact only and must not be pushed to D1 without a separate
  release decision.

### Kaikki batch 6 500-row validation (local only, 2026-08-03)

- A fresh attempt index scanned 830 log files with zero parse failures and
  excluded 6,494 historical source entries. The clean pool contained 500
  non-overlapping Japanese Kaikki candidates.
- Source evidence review approved 469/500 and rejected 31, with zero format or
  infrastructure failures. Initial four-language generation accepted 420/469
  (89.55%). A single context-preserving retry of the 49 rejects recovered 26;
  the merged unique result was 446/469 (95.1%). The remaining 23 were not
  retried again.
- Added `merge-dictionary-v2-product-source-gap-generation-reports.mjs`. It
  merges generation attempts by `source_entry_id`, lets a later valid result
  replace a failure, and never lets a failed retry replace an earlier valid
  result. Use this before reverse-evidence validation when a batch has a
  specialized retry report.
- Reverse dictionaries supported 111/446, sent 185 to manual review, and
  rejected 150. Independent Gemma 4 31B accepted 100/111 and rejected 11 with
  zero failures. Only those 100 consensus rows were eligible for replay.
- The 100 rows passed byte-identical isolated DB replay, semantic mapping,
  promote dry-run/apply, published-risk audit, native export, fast audit, and
  full in-memory import before exact main-DB replay. Current local publishable
  counts are 29,252 entries, 34,769 senses, and 139,076 localizations. All
  blockers and `flagged_senses` are zero; the 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch6-20260803-001532.db`,
  SHA-256 `0F854E838DA1E644B9FEC35DF367AD8AACA1221D5F7F7B221065A8E8D71046E7`.
  Current main DB SHA-256 is
  `0C41825E58ECA62625B98E12E8E45248309E2C5CDC2A5C0AA7C700C0CDA6C429`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch6-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 7 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 850 files with zero parse failures and
  excluded 6,995 historical source entries. The clean pool contained 500 new
  Japanese Kaikki candidates in frequency ranks 16,410-19,861.
- Source evidence review approved 476/500 and rejected 24. Four-language Qwen
  generation accepted 428/476 on the first pass (89.9%). One contextual retry
  on the 48 rejects recovered 22, producing 450/476 unique valid generations
  (94.5%). The remaining 26 stay rejected/manual and were not retried again.
- Endpoint `100.99.99.99:11448` timed out twice and correctly opened its circuit
  breaker. The scheduler reassigned pending work, so no candidate was lost.
  Retry work used only `11441`, `11444`, and `11447`. Do not restore a tripped
  endpoint inside the same batch without a fresh smoke test.
- Reverse dictionaries supported 93/450, routed 212 to manual review, and
  rejected 145. Independent Gemma 4 31B accepted 77/93 and rejected 16 with
  zero model or infrastructure failures. Only the 77 consensus rows were
  eligible for replay.
- The 77 rows passed byte-identical isolated replay, semantic review, promote
  dry-run/apply, published-risk audit, fast audit, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,329 entries, 34,846 senses, and 139,384 sense localizations. The main
  DB also contains non-publishable historical draft/review rows, so fast-audit
  raw table counts (30,102/35,654/142,608) must not be reported as release
  counts. All blockers and `flagged_senses` are zero; the 98 duplicate-
  localization warnings remain non-blocking. Production D1 remains v83 and
  unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch7-20260803-004639.db`,
  SHA-256 `0C41825E58ECA62625B98E12E8E45248309E2C5CDC2A5C0AA7C700C0CDA6C429`.
  Current main DB SHA-256 is
  `5593F541B94D5186B3AD0F0473F4C0BA166A3B8B86C84C8525081FEED0EF2F81`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch7-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 8 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 870 files, found 186 generation reports
  and ten checkpoints, and excluded 7,494 historical source IDs with zero parse
  failures. The clean pool contains 500 new Japanese Kaikki candidates in
  frequency ranks 20,265-23,040; another 2,292 Japanese rows remain eligible
  under the same evidence gate.
- Endpoint `11448` still returned model status/listing but timed out on a short
  inference after 120 seconds. It was excluded before the batch. Source review
  and generation used `11441`, `11444`, and `11447`; all three completed with
  zero infrastructure failures.
- Source review initially produced 432 approvals, 49 semantic rejects, and 19
  malformed/truncated JSON results. One bounded retry with a 420-token output
  limit recovered 16 valid decisions. Final review totals were 434 approved,
  63 rejected, and three failed/manual.
- Four-language generation accepted 396/434 (91.24%), meeting the 90% gate
  without a relaxed retry. Reverse dictionaries supported 88, routed 188 to
  manual review, and rejected 120. Independent Gemma 4 31B accepted 82/88 and
  rejected six with zero failures.
- Only the 82 independent-consensus rows were replayed. They passed a byte-
  identical isolated DB copy, semantic mapping, promote dry-run/apply,
  published-risk audit, fast audit, native export, and full in-memory import,
  followed by exact main-DB replay and the same final audits.
- Current local publishable counts are 29,411 entries, 34,928 senses, and
  139,712 sense localizations. All release blockers and `flagged_senses` are
  zero; the 98 duplicate-localization warnings remain non-blocking. Production
  D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch8-20260803-011625.db`,
  SHA-256 `5593F541B94D5186B3AD0F0473F4C0BA166A3B8B86C84C8525081FEED0EF2F81`.
  Current main DB SHA-256 is
  `5BFDF170A84F27058E54EE97219164872C12F56752F48AC0E035F94660C7BF20`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch8-main`. It is local
  only. Do not push it to D1 without a separate release decision.
- CLI notes: `--lang-targets` uses `lang=count` pairs, not `lang:count`; omit
  `--source-langs` to mean all languages because the literal value `all` is
  invalid. PowerShell 5.1 does not support `Set-Content -Encoding utf8NoBOM`;
  use `UTF8` for ignored runtime logs or a Node writer when exact UTF-8 without
  BOM is required.

### Kaikki batch 9 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 887 files, found 189 generation reports
  and ten checkpoints, and excluded 7,994 historical source IDs with zero parse
  failures. The clean pool contained 500 new Japanese candidates in frequency
  ranks 23,651-27,519; 1,798 Japanese rows were eligible before selecting this
  batch.
- Source review initially approved 400, rejected 86, and returned 14 invalid
  results. One bounded retry recovered six decisions, leaving final totals of
  402 approved, 90 rejected, and eight failed/manual. Four-language generation
  accepted 370/402 (92.04%) with zero infrastructure failures.
- Qwen generation used only `11441`, `11444`, and `11447`; each endpoint had
  zero failed calls. Endpoint `11448` remains excluded after the earlier
  inference timeout and must pass a fresh smoke test before rejoining a batch.
- Reverse dictionaries supported 85/370, routed 178 to manual review, and
  rejected 107. Independent Gemma 4 31B accepted 71/85 and rejected 14 with
  zero failures. Only those 71 independent-consensus rows were replayed.
- The 71 rows passed byte-identical isolated replay, semantic mapping, promote
  dry-run/apply, published-risk audit, fast audit, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,482 entries, 34,999 senses, and 139,996 sense localizations. All
  release blockers and `flagged_senses` are zero; the 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch9-20260803-014019.db`,
  SHA-256 `5BFDF170A84F27058E54EE97219164872C12F56752F48AC0E035F94660C7BF20`.
  Current main DB SHA-256 is
  `F958BA9F5101F2571FF358C1D1CD5471888211BA82A9232E1E652C6B80E926C7`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch9-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 10 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 904 files, found 192 generation reports
  and ten checkpoints, and excluded 8,494 historical source IDs with zero parse
  failures. The clean pool contained 492 Japanese and eight Portuguese
  candidates; 1,313 rows remained eligible before selecting this batch.
- Source evidence review was fully structured: 500/500 valid, 479 approved, 21
  rejected, and zero failures. The first four-language generation pass accepted
  425/479 (88.73%), below the 90% gate, so the pipeline correctly stopped before
  reverse evidence or database writes.
- Failure analysis found the quality-review LLM incorrectly rejecting readings
  already validated by deterministic JMdict/pinyin evidence, including
  `突風=とっぷう`. The supplement script now labels locked reading evidence and
  ignores a reviewer rejection only when every cited error concerns a reading
  with `deterministic:*` provenance. Term, definition, sense, and unknown-reading
  errors remain blocking. An eight-row mixed regression retained real semantic
  rejects such as `paraquedismo`, `privativo`, and `比べ物`.
- Only the 54 failed rows were retried after the fix; 31 recovered. Merging by
  source ID produced 456/479 unique valid generations (95.20%), 23 rejects, and
  zero infrastructure rejects. Reverse dictionaries supported 97, routed 239
  to manual review, and rejected 120. Independent Gemma 4 31B accepted 84/97
  and rejected 13 with zero failures.
- Only those 84 consensus rows were replayed. They passed byte-identical
  isolated replay, semantic mapping, promote dry-run/apply, published-risk,
  fast audit, native export, and full in-memory import before exact main-DB
  replay. Current local publishable counts are 29,566 entries, 35,083 senses,
  and 140,332 sense localizations. All release blockers and `flagged_senses`
  are zero; the 98 duplicate-localization warnings remain non-blocking.
  Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch10-20260803-022012.db`,
  SHA-256 `F958BA9F5101F2571FF358C1D1CD5471888211BA82A9232E1E652C6B80E926C7`.
  Current main DB SHA-256 is
  `8BE56BAE972A5A3F17B33FF1651E3437F905D18810488F165D5B4009F9FBC83A`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch10-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 11 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 925 files, found 199 generation reports
  and ten checkpoints, and indexed 8,994 historical source IDs with zero parse
  failures. The clean pool selected 499 Japanese and one Portuguese candidate;
  826 rows were eligible before selecting this batch.
- Source evidence review returned 500/500 structured results: 471 approved and
  29 rejected. Four-language generation accepted 433/471 (91.93%), above the
  90% gate, with zero infrastructure failures across `11441`, `11444`, and
  `11447`.
- Eighteen generation rows used the narrow deterministic-reading review
  override. This did not make them publishable: all accepted rows still passed
  the same reverse-dictionary and independent-model gates. Reverse evidence
  supported 87/433, routed 228 to manual review, and rejected 118. Independent
  Gemma 4 31B accepted 72/87 and rejected 15 with zero failures.
- Only those 72 consensus rows were replayed. They passed isolated semantic
  mapping, promote dry-run/apply, published-risk, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,638 entries, 35,155 senses, and 140,620 sense localizations. All
  release blockers and `flagged_senses` are zero; the 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch11-20260803-032044.db`,
  SHA-256 `8BE56BAE972A5A3F17B33FF1651E3437F905D18810488F165D5B4009F9FBC83A`.
  Current main DB SHA-256 is
  `62DE39B7F15CBFF2D6345E17722A9994E75D8646FF24ADF127379666541DF146`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch11-main`. It is local
  only. Do not push it to D1 without a separate release decision. Before the
  next rebuild, approximately 326 rows remained outside this batch under the
  current strict eligibility gate, so batch 12 will likely be smaller than 500.

### Kaikki batch 12 strict-pool closeout (local only, 2026-08-03)

- Refreshing the attempt index scanned 942 files, found 202 generation reports
  and ten checkpoints, and excluded 9,494 historical source IDs with zero parse
  failures. The rebuilt strict pool contained 334 rows: 333 Japanese and one
  Portuguese candidate.
- Source review was fully structured: 334/334 valid, 311 approved, 23 rejected,
  and zero failures. Four-language generation accepted 282/311 (90.68%), above
  the 90% gate, with zero infrastructure failures on `11441`, `11444`, and
  `11447`.
- Reverse dictionaries supported 40/282, routed 151 to manual review, and
  rejected 91. Independent Gemma 4 31B accepted 36/40 and rejected four with
  zero failures. Only the 36 consensus rows were replayed.
- The 36 rows passed byte-identical isolated replay, semantic mapping,
  deterministic promotion, published-risk, native export, and full in-memory
  import before exact main-DB replay. Current local publishable counts are
  29,674 entries, 35,191 senses, and 140,764 sense localizations. All release
  blockers and `flagged_senses` are zero; the 98 duplicate-localization groups
  remain a non-blocking warning. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch12-20260803-113928.db`,
  SHA-256 `62DE39B7F15CBFF2D6345E17722A9994E75D8646FF24ADF127379666541DF146`.
  Current main DB SHA-256 is
  `D03805370FA848EF72A94C8AB694046E370D5FE3F93E77550A6F98A94B7FEA36`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch12-main`. It remains
  local only and must not be pushed without a separate release decision.
- A post-batch rebuild found only `帰省` and `異音`. Both passed source review
  and generation, but reverse evidence classified one as unsupported and one
  as manual review. Neither was written to the DB. Treat the current Kaikki raw
  two-language strict pool as exhausted; the next batch needs a new evidence
  tier or additional source data, not relaxed promotion gates.

### Canonical Tier C pilot after Kaikki closeout (local only, 2026-08-03)

- A complete rank-200,000 coverage scan found 440 canonical candidates with at
  least three entry-level languages but exactly two first-sense languages: 399
  pt-BR, 31 ja, and ten zh. A balanced pilot selected `zh=8`, `ja=6`, and
  `pt-BR=6`.
- Source review returned 20/20 structured decisions but approved only nine and
  rejected eleven. The candidate class is therefore much noisier than the
  exhausted Kaikki strict pool.
- Hard-enforcing reviewer preferred terms accepted only 1/9 generations. Seven
  of eight rejects were brittle `preferred_term_mismatch` checks involving
  synonyms, Traditional Chinese forms, or source variants. Re-running without
  that string constraint, while retaining quality review, deterministic
  readings/pronunciations, reverse evidence, and independent consensus,
  accepted 6/9.
- Reverse evidence supported three of the six. Independent Gemma accepted
  `neurocirurgia` and `やみ` and rejected `しごと`. Only the two consensus rows
  were replayed. They passed isolated and main semantic mapping, deterministic
  promotion, published-risk, and full in-memory export audits.
- Current local publishable counts are 29,676 entries, 35,193 senses, and
  140,772 sense localizations. `flagged_senses=0` and all release blockers are
  zero. The pre-pilot backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-canonical-tier-c-pilot-20260803-120855.db`
  with SHA-256
  `D03805370FA848EF72A94C8AB694046E370D5FE3F93E77550A6F98A94B7FEA36`.
  Current main DB SHA-256 is
  `BEF68E7DE37CDE8197153F39CBEE08CCE68310001717D2A4F0382ECB82B0CC7A`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-pilot-main`.
  Production remains v83 and unchanged. Do not scale the remaining 440-row
  class: its end-to-end pilot yield was only 2/20. First improve deterministic
  sense alignment and preferred-term normalization, then repeat a new 20-row
  pilot.

### Canonical Tier C preferred-term contract fix (local only, 2026-08-03)

- `review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` now writes
  `preferred_term_policy=source_only_exact`. Only the source-language headword
  is a hard `preferred_terms` constraint. Target-language reviewer proposals
  are preserved as `suggested_terms`; reverse evidence and independent Gemma,
  rather than string equality, decide whether they are publishable.
- Replaying the same nine source-approved candidates against the pre-pilot DB
  improved generation validity from 1/9 to 8/9. There were no target-language
  `preferred_term_mismatch` false rejects.
- Reverse evidence supported four rows. Gemma accepted `neurocirurgia`, `やみ`,
  and `しごと`, and rejected `くるま`. Because the first two accepted rows were
  already published by the prior pilot, the exclusion-aware consensus replay
  wrote only `しごと`.
- `しごと` passed isolated semantic conversion, deterministic promotion,
  published-risk, and full in-memory export audits before exact main-DB replay.
  Final local counts are 29,677 entries, 35,194 senses, and 140,776 sense
  localizations. All release blockers and `flagged_senses` are zero; the 98
  duplicate-localization groups remain a non-blocking warning.
- The immediate pre-replay backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-source-only-contract-20260803-121733.db`
  with SHA-256
  `BEF68E7DE37CDE8197153F39CBEE08CCE68310001717D2A4F0382ECB82B0CC7A`.
  Current main DB SHA-256 is
  `DBAD5079655725902B65118D7ED1CF516BDEB19FE5EA5C79E3EAB3423592EB9F`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-source-only-main`.
  Production D1 remains v83 and unchanged. Do not scale Tier C yet: source
  review still approved only 9/20. Implement deterministic candidate-sense
  alignment and run a new balanced 20-row pilot first.

### Deterministic candidate-sense alignment (local only, 2026-08-03)

- Added `scripts/align-dictionary-v2-product-source-gap-candidate-senses.mjs`
  and npm command `dict:v2:coverage:align-source-gap-senses`.
- The aligner inspects all clean senses for each candidate. A publishable
  candidate must have an exact source-language term and a unique best sense by
  clean language count, then confidence. Parallel bilingual senses are never
  merged merely because their entry covers several languages.
- Regression on the previous 20 rows selected only three. Two rows had an
  already complete aligned sense, and fifteen were ambiguous parallel-sense
  entries. On the full 440-row pool, 184 aligned, 119 were already complete,
  and 137 were ambiguous. The aligned set contains 182 pt-BR and two ja rows.
- Re-filtering for exactly three clean languages, while excluding the earlier
  review report, produced
  `logs/product-coverage-gaps-v83-post-kaikki-canonical-tier-c-sense-aligned-pilot20.json`:
  19 pt-BR rows and one ja row. There are no safe zh rows under this policy;
  do not force language balance by relaxing sense identity.
- `review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` now accepts
  `--require-sense-alignment true`. With the flag, the new pilot passes prompt
  construction and the old 20-row first-sense report is rejected. The filter's
  exclusion reader also now recognizes `approved` and `reviews` arrays, so a
  source-review report excludes every reviewed ID rather than only top-level
  IDs.
- The Unsloth key is persisted locally in ignored `.env.local` as
  `UNSLOTH_API_KEY`. Load it into the process at runtime. `.gitignore` covers
  the file, `git check-ignore` confirms the rule, and reports do not contain
  the key.
- Remote source review on `11441` and `11447` completed 20/20 without network or
  JSON failures: 13 accepted and seven rejected. Generation accepted 9/13;
  reverse dictionaries supported three; independent Gemma 4 31B on `11445`
  accepted all three. The final rows were `exploradora`, `eletrodomésticos`,
  and `preventivo`.
- Isolated replay exposed a selection-order bug in
  `promote-dictionary-v2-product-source-gap-drafts.mjs`: SQL applied `LIMIT`
  before filtering by semantic-review sense IDs, so unrelated historical drafts
  were inspected. The script now expands the query when semantic review is
  present, filters to approved sense IDs, and only then applies the requested
  limit. The corrected isolated dry-run accepted exactly 3/3.
- All three passed isolated and main replay, deterministic promotion,
  published-risk, native export, and full in-memory audit. The pre-main backup
  is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-sense-aligned-pilot-20260803-132119.db`
  with SHA-256
  `DBAD5079655725902B65118D7ED1CF516BDEB19FE5EA5C79E3EAB3423592EB9F`.
  The current main DB has 29,680 entries, 35,197 senses, and 140,788 sense
  localizations; SHA-256 is
  `39D4E3D543B677D0E9087C6BBF68B5981C704DFAE62C152DE4B56F8ABF6F3B99`.
  `flagged_senses=0` and all release blockers are zero.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-sense-aligned-main`.
  Production remains v83 and unchanged. End-to-end yield was only 3/20, so do
  not scale this Tier C pool yet.
- A follow-up prefiltered pilot used the aligned report directly with
  `validate-dictionary-v2-product-source-gap-reverse-evidence.mjs --input-mode
  aligned`. The 184-row aligned pool produced 44 supported, 125 manual, and 15
  unsupported rows before any LLM generation. From the first 20 supported
  rows, source review accepted 18; one previously reviewed row was subtracted,
  leaving 17 new generation inputs. Generation validated 12/17, reverse
  evidence retained eight, and independent Gemma 4 31B accepted all eight.
- The promoted rows are `valquíria`, `legalização`, `cantonês`, `troglodita`,
  `hipnotismo`, `coalhada`, `cesárea`, and `darwinismo`. They passed exact
  isolated replay and the same main-DB replay with 8/8 deterministic promotion.
  The pre-main backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-prefiltered-tier-c-pilot-20260803-133320.db`;
  its SHA-256 is
  `39D4E3D543B677D0E9087C6BBF68B5981C704DFAE62C152DE4B56F8ABF6F3B99`.
- Current local main counts are 29,688 entries, 35,205 senses, and 140,820
  sense localizations. SHA-256 is
  `170691083350484ED7C589C3306BF52859F20AD478528191DD29EA7DC82902C8`.
  `flagged_senses=0`; all release blockers are zero; the existing 98 duplicate
  localization warning groups remain non-blocking. The audited export is
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-prefiltered-main`.
  Production D1 remains v83 and was not changed.
- This prefilter improved source approval from 13/20 to 18/20 and final yield
  from 3/20 to 8/20. Do not jump directly to an unbounded run: first classify
  the five generation validation rejects, rebuild product-aware exclusions,
  and run a bounded 100-row test.
- Reject classification is complete. `tesouraria`, `dissuadir`, and
  `prussiano` were rejected by semantic quality review for Japanese sense or
  term errors. `centésima` and `escoliose` produced plausible rows but failed
  `ja_term_not_in_jmdict`; handle these through canonical-form/variant lookup,
  not by globally disabling JMdict validation.
- The JMdict fix is intentionally exact. `側弯症` and `脊柱側弯症` map to the
  canonical JMdict `彎` forms for reading lookup; `百分の一` has one verified
  compositional reading. A two-row remote retest proved `escoliose` now passes.
  `centésima` reached semantic review and was correctly rejected for ordinal vs
  fractional sense mismatch, demonstrating that the semantic gate remains
  active.
- Only 24 unused rows remained in the 44-row strong prefilter pool. Historical
  review subtraction removed four, leaving 20 genuinely new rows. Source review
  approved all 24 before deduplication; generation validated 15/20; reverse
  evidence supported seven; Gemma consensus accepted six and rejected `siso`.
  The promoted rows are `subsidiária`, `vidraça`, `fotogênico`, `estribo`,
  `taquigrafia`, and `escarlatina`.
- The byte-identical pre-main backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-prefiltered-tier-c-remaining20-20260803-162243.db`
  with SHA-256
  `170691083350484ED7C589C3306BF52859F20AD478528191DD29EA7DC82902C8`.
  Current local counts are 29,694 entries, 35,211 senses, and 140,844
  localizations; SHA-256 is
  `90A25DE7E8E0F3875936740C4419F1A82728111D3C53EC2A26F59B65943AC1E9`.
  The full audited export is
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-prefiltered-remaining20-main`.
  All blockers and risk flags are zero; production D1 remains v83.
- The strong prefiltered Tier C pool is now exhausted. Do not fabricate a
  100-row batch from the 125 manual rows. Rebuild a larger sense-aligned pool
  with product-aware source-link exclusions, then apply the same reverse
  evidence threshold before another bounded run.
- The larger rebuild scanned ranked entries through 500,000 and produced
  70,175 raw gaps. Strict canonical filtering retained 758; product-aware
  alignment retained 503. `align-dictionary-v2-product-source-gap-candidate-senses.mjs`
  now removes accepted-product-linked source senses before choosing a unique
  best sense. This is sense-level exclusion, not whole-entry exclusion.
- The first expanded reverse pass selected 377 rows. A balanced 100-row review
  (`en=4, pt-BR=46, zh=20, ja=30`) accepted only 66; generation validated
  42/66, and final reverse evidence supported only four. There were no network
  or JSON failures. The problem is source semantics, especially WikDict
  homographs and weak Chinese/Japanese headwords. Nothing was written.
- `validate-dictionary-v2-product-source-gap-reverse-evidence.mjs` now supports
  `--require-source-reverse-evidence true`. It also groups both directions of
  WikDict into one evidence family, so `wikdict-zh-en + wikdict-en-zh` no longer
  counts as two independent sources. The strict pool contained 13 rows, with
  11 new after excluding the reviewed 100.
- The strict 11-row experiment had source review 11/11 and merged generation
  10/11, but final four-language reverse evidence supported only
  `desenvolvedor`; five were unsupported and four manual. Gemma 4 31B reviewed
  all ten and accepted eight, but only `desenvolvedor` was in the safe
  intersection of deterministic support and independent-model acceptance.
  That singleton was replayed to `draft_single_source`, passed promote dry-run,
  and was promoted. Never use the broader eight-row model-consensus report for
  automatic promotion.
- The JMdict reading validator now accepts productive suffixes `化`, `患者`,
  and `可能な` only when the exact base exists in JMdict. Remote retest proved
  `瘢痕化` and `心気症患者` valid; independent semantic review still rejected
  `認識可能な`, so the rule does not bypass semantic quality checks.
- Current publishable export is 29,696 entries, 35,213 senses, and 140,852
  localizations. The current product DB SHA-256 is
  `14B895D68FBA1F1F2E98E7245F0452B97C34A77B6A758A4EC302BBAA4D201462`.
  The pre-promotion backup is
  `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-desenvolvedor-20260803.db`.
  Production remains v83; this one-row local update was not deployed. The next
  viable scale improvement is better
  independent Chinese/Japanese lexical evidence or model-assisted candidate
  repair before generation, not a wider frequency window.
- A bounded derivational matcher now recognizes English morphological pairs
  such as authenticate/authentication, deactivate/deactivation,
  menstruate/menstruation, and mitochondrial/mitochondrion. Revalidation moved
  `autenticar`, `menstruar`, and `mitocondrial` from false `unsupported` results
  to `manual_review`, but no additional row became fully supported. Keep those
  rows in residual review until the missing target-language evidence exists.
- Treat Kaikki and WikDict as one `wiktionary` evidence family. `kaikki-ja` is
  now usable as strong reverse evidence, but cannot independently corroborate
  WikDict. With JMdict plus this family, CC-CEDICT Chinese evidence, and Gemma
  acceptance, `autenticar` passed the strict intersection and was promoted.
  Its pre-promotion backup is
  `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-autenticar-20260803.db`.

## 2026-08-03 final large-scale gate

- The historical retrospective inspected all 9,087 accepted
  `source_gap_unsloth` senses under legacy and current evidence-family rules.
  Collapsing Kaikki and WikDict into one `wiktionary` family identified exactly
  111 formerly supported senses that now require manual review. All 111 were
  resolved by the generic publication-block tool and removed from publishing.
- The byte-identical backup is
  `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-evidence-family-regression-blocks-20260803.db`
  with SHA-256
  `14B895D68FBA1F1F2E98E7245F0452B97C34A77B6A758A4EC302BBAA4D201462`.
  The current DB SHA-256 is
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.
- Full isolated export/import audit passes with 29,586 entries, 35,102 senses,
  and 140,408 localizations. All blockers and `flagged_senses` are zero; the 98
  duplicate-localization groups remain a non-blocking warning. Production D1
  remains v83 and was not changed.
- The first 100-row rebuild exposed two discovery bugs rather than true source
  exhaustion. The prefilter did not count a unique aligned OMW synset as an
  independent family, and filtering before sense alignment discarded useful
  later senses. The corrected sense-first flow aligned 20,103 raw gaps,
  retained 9,285 clean rows, and found 2,280 rows supported by at least two
  independent families.
- A balanced `zh=30, ja=30, pt-BR=25, en=15` gate produced 91/100 valid source
  approvals with no transport or JSON failures. Qwen generation accepted 78/91
  initially; one bounded retry of the eight non-semantic rejects recovered two,
  for 80/91 (87.9%). Five semantic quality rejects were correctly preserved.
  Because generation remained below the required 90%, deterministic reverse
  validation, Gemma consensus, and the 500/2,000/5,000 stages were not run.
- A second fresh 100-row test required deterministic JMdict target terms and
  Portuguese pronunciation before review. Source review passed 92/100 and
  generation passed 84/92 (91.3%) with zero infrastructure failures. The next
  deterministic reverse gate failed at 22/84 (26.2%): Portuguese generated
  targets were usually supported only by the Wiktionary family. No Gemma call
  or database write followed.
- Requiring at least two same-synset OMW target languages plus JMdict and
  Portuguese pronunciation leaves 183 candidates, all English-source; 163 are
  fresh after subtracting both reviewed 100-row batches. This is useful for an
  English-lane test but cannot qualify balanced four-language production.
  Scaling remains blocked on independent reverse evidence for non-English
  source lanes, not on network stability or JSON formatting.

### Wordfreq-expanded final 100-row gate (local only, 2026-08-03)

- `scripts/export-wordfreq-lists.py` exported wordfreq 3.1.1 ranked lists from
  an isolated environment on a6000-143. `rank-dictionary-v2-frequency.mjs`
  then filled only NULL ranks, preserving the existing FrequencyWords ranks.
  The pre-update rank backup is
  `logs/linguago-v2-frequency-ranks-before-wordfreq-expansion-20260803.json`.
- The expanded source DB contains 134,584 ranked English entries, 102,173
  Chinese, 69,452 Japanese, and 36,175 Portuguese. The sense-first pipeline
  produced 268,101 raw gaps, 56,515 aligned rows, 30,543 clean rows, 238 strict
  cross-family candidates, and 144 candidates fresh against prior reviews.
- The first 100 source reviews passed at 91/100. Blindly binding the first term
  from any two-family hint reduced generation from 79/91 to 70/91 and exposed
  homograph errors such as `疾步=fasting` and `口香糖=gingiva`. Do not restore
  that policy. A target term is now binding only when independent lexical
  evidence and the source reviewer select the same normalized form; the exact
  source-language term remains binding.
- A third source review approved 90/100. Merging two earlier valid runs and one
  bounded ten-row retry produced 81/90 valid generations (90.0%). The merge
  tool now accepts `--allowed-report`, so stale valid rows cannot bypass the
  latest source-review whitelist.
- Deterministic reverse evidence supported 76/81, routed three to manual
  review, and rejected two. The remaining 44 fresh rows were used only as a
  bounded replacement pool: 41 source-approved, 34 generation-valid, and 32
  reverse-supported.
- Independent Gemma 4 31B consensus accepted 70/75 valid original reviews and
  27/32 replacement reviews, for 97/107 (90.7%) no-correction acceptance and
  97 final safe candidates per the original 100-row gate. One repeatedly
  malformed `polygyny` review remains failed/manual and was not accepted.
- The final 100-row gate therefore passes. No draft or product row was written,
  and production D1 remains v83. Before the 500-row write/resume gate, rebuild
  a new strict candidate pool; all 144 rows in this fresh pool have now been
  reviewed, so they must not be recycled as a nominal 500-row batch.

### Wordfreq 500-row checkpoint gate, part 1 (local only, 2026-08-03)

- Rebuilding the v83 attempt index scanned 1,152 reports, found 257 generation
  reports and ten checkpoints, and excluded 10,896 genuinely attempted source
  IDs with zero parse failures. A target-two-language prefilter retained 1,468
  candidates; historical subtraction left 1,057 fresh rows.
- The 500-row review input is intentionally evidence-limited rather than
  nominally balanced: `en=231`, `ja=150`, `pt-BR=106`, `zh=13`. It contains no
  duplicate source IDs, ends at frequency rank 50,035, and preserves the source
  two-family, Portuguese pronunciation, and JMdict requirements. Do not claim
  the planned 30/30/25/15 mix when the strict Chinese lane has only 13 rows.
- Source review passed: 474/500 approved, 26 rejected, zero manual/failed rows,
  and zero endpoint failures. A byte-identical validation DB was created from
  main SHA-256 `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.
- The first 100 approved rows were written in two 50-row transactions using
  `product-source-gap-v83-wordfreq200k-scale500-generation.checkpoint.json`.
  Checkpoint and DB reconciliation is exact: 83 accepted source IDs map to 83
  draft entries/senses and 332 four-language localizations, all with
  `needs_review=1`; untracked rows are zero and SQLite integrity is `ok`.
- Generation was only 83/100, below the 90% gate, so the remaining 374 rows were
  not resumed. There were no transport failures. Of 17 rejects, 15 came from
  the same-family Qwen quality reviewer, one was malformed review JSON, and one
  failed JMdict lookup.
- Several Qwen review rejects are demonstrably unreliable (`はちどり` was
  called a dragonfly, `臭化物` was called a nonstandard bromide term, and
  `消印` was denied as a postmark). Do not globally auto-accept them. The next
  change should route disputes about independently bound target terms past the
  same-model veto into deterministic reverse evidence plus independent Gemma
  consensus. Unbound semantic mismatches remain blocking.
- Validation published-risk remains `flagged_senses=0`; the main product DB is
  unchanged and production D1 remains v83.

### Wordfreq 500-row checkpoint gate, bounded retry result (local only, 2026-08-03)

- The supplement CLI now has an opt-in
  `--defer-evidence-bound-quality-rejects true` mode. It defers only same-model
  objections to a non-source term or reading that was already bound by
  reviewed independent lexical evidence. Structural errors, source-term drift,
  missing fields, definitions, IPA, and unbound terms remain blocking. The
  default is `false`.
- Retrying only the original 17 failures recovered nine rows. The merged first
  100 report therefore contains 92 generation-valid rows and eight rejects,
  with no endpoint failures. The isolated validation DB contains 92 draft
  entries/senses and 368 review localizations; none are publishable.
- Deterministic four-language reverse validation supported only 51/92 rows,
  routed 37 to manual review, and rejected four. Relative to the original batch,
  the maximum safe yield before Gemma is therefore 51/100, far below the 80/100
  promote gate.
- The 41 non-supported rows are primarily a source-coverage problem: 14
  Portuguese and 14 Chinese terms have Wiktionary-family-only evidence; seven
  Chinese terms have no reverse evidence; four rows have strong-gloss conflicts;
  four terms have OMW-only evidence; and the remaining cases are no-evidence or
  low-match/polysemy cases. Japanese and English are not the bottleneck.
- Do not send this batch to Gemma and do not resume the remaining 374 reviewed
  candidates. Gemma consensus is not an independent dictionary source and
  cannot repair the missing Portuguese/Chinese lexical evidence. Rebuild the
  pool only after adding independent pt-BR/zh reverse coverage or deterministic
  candidate-specific target-term evidence that passes the unchanged reverse
  gate.
- Main product DB SHA-256 remains
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`;
  production D1 remains v83.

### New Open WordNet coverage probe (local only, 2026-08-03)

- `kaikki-pt` is already supported by the source importer, but it must not be
  counted as an independent family: Kaikki and WikDict are both Wiktionary
  derivatives. Adding it to reverse validation would not fix the 14 Portuguese
  `wiktionary_only_evidence` residuals.
- The historical PanLex API hostname currently fails DNS resolution. Do not
  add it as a runtime or batch dependency. PanLex remains a possible offline
  source only if individual source-group provenance is retained; treating the
  whole aggregation as one independent dictionary is unsafe.
- An isolated `wn` 1.1.0 probe downloaded `own-pt:1.0.0`, `omw-cmn:2.0`, and
  their `omw-en:2.0` dependency under `.tmp/wn-data`. The reproducible probe is
  `scripts/probe-open-wordnet-source-gap-residuals.py`; it is diagnostic only.
- Of 45 non-supported pt-BR/zh localizations, the newer wordnets contained ten
  exact target terms and only seven had a directly matching English lemma:
  pt-BR 3/18 and zh 4/27. Examples include `hidratação -> hydration`,
  `interdisciplinar -> interdisciplinary`, and `摄食过度 -> bulimia`.
  Conflicting rows such as `ligadura` remain blocked.
- This coverage gain is too small to rescue the target-two-language 100-row
  gate. Do not resume generation. A viable next pool still needs substantially
  broader independent pt-BR/English and zh/English lexical evidence with
  source-level provenance.

### Final 500-row validation status (local only, 2026-08-03)

- The 500k frequency scan and repaired target-language counter produced 395
  strict all-target/two-family candidates. The old counter excluded English and
  accidentally made `min-target-langs=3` impossible for zh/ja/pt-BR sources.
- A fresh strict batch yielded 230 source-approved, 213 generation-valid, 177
  deterministic-supported, and 165 final Gemma-accepted unique rows after one
  bounded correction pass. Qwen endpoint failures were zero.
- Prior deterministic-supported generation was intersected with the repaired
  all-target pool before reuse. It added 176 unique Gemma-accepted rows. A fresh
  all-target-hint batch added another 82. Together with the earlier 97-row gate,
  the verified union is 520 unique source entry IDs with no overlap.
- A romanized group-key collision attached `気筒` to the existing `祈とう`
  entry because both normalized to `kitou`. The writer now verifies the actual
  headword/language and uses a source-ID-suffixed key on collision. Keep this
  check enabled for all CJK production writes.
- The isolated strict DB promoted 165 rows and passed fast audit, published-risk,
  native export, and full in-memory import audit with every blocker at zero.
  The main DB hash remains
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`;
  production D1 remains v83.
- The composite 500 quality/checkpoint gate is complete. The 2,000-row pressure
  gate is not ready because the remaining broad all-target-hint pool achieved
  only 91/184 (49.5%) deterministic support. Add independent pt-BR and zh
  reverse evidence before spending more Qwen/Gemma compute on that lane.

### Current 2,000-row readiness after evidence expansion (2026-08-03)

Production-safe supplemental families have now been tested and kept separate:
Open WordNet (`omw`), word2word top-3 (`corpus_word2word`), Apertium Spanish
pivots (`apertium`), and exact Wikidata labels (`wikidata`). MUSE is
non-commercial research data and is excluded. PanLex is not a live dependency.

The combined strict pool contains 1,324 fresh candidates. Adding the completed
520 unique safe rows gives 1,844 strict rows. The remaining 156 rows needed for
a 2,000-row sustained infrastructure test must come from a separate
target-two-language tier and carry `no-promote`; they cannot be included in the
publishable quality denominator. Production D1 and the main product DB remain
unchanged. Main DB SHA-256 remains
`9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.

Use `scripts/export-wikidata-generation-evidence.mjs` with
`--search-mode sparql --import-all-labels true --sparql-aliases false`.
Action API alias lookup and SPARQL aliases are too slow for bulk prefiltering.
Merge evidence with `scripts/merge-supplemental-evidence-dbs.mjs`, then rerun
the unchanged family-aware prefilter. Never count the three Apertium pair repos
as separate evidence families.

### Latest large-scale gate status (2026-08-03)

The pipeline is still before the 500-row write gate. Sense-exact subtraction
leaves 1,576 fresh all-target-independent candidates, but two formal 100-row
attempts failed Gemma's >=90% no-correction gate: 66/80 and 64/90. Qwen source
review, generation, deterministic reverse evidence, and all four Qwen endpoints
passed their respective thresholds. Do not write these rows to the main DB.
Use exact `entry:sense` keys, `--require-hint-semantic-alignment true`,
`--enforce-generation-hint-terms true`, and entry-unique selection. Main DB and
production D1 remain unchanged.

### Bounded correction diagnostic (local only, 2026-08-03)

- Consensus retry/replay/draft-conversion scripts now use exact
  `source_entry_id:source_sense_id` keys. The original report replayed 64
  accepted reviews to exactly 64 generated senses.
- Retrying the 26 Gemma rejects produced 25 valid Qwen records with zero
  endpoint failures and 25/25 deterministic reverse support. Gemma accepted
  only 11/25 on re-review; residuals were seven scope mismatches, three wrong
  term/sense mappings, three definition errors, and one POS mismatch.
- The locked generation hint can itself be wrong, so enforcing it while asking
  Qwen to apply Gemma's correction is contradictory. Treat this lane as
  diagnostic only and do not write its rows.
- Next: Gemma pre-review exact proposed terms, part of speech, and definition
  scope before Qwen generation, then run a fresh unseen 100-sense gate. Keep
  the final Gemma no-correction threshold at >=90%; do not start the 500-row
  write gate until it passes.

### Current large-scale validation continuation (2026-08-04)

- The new unseen gate100 passed: Qwen valid `92/100`, deterministic supported
  `92/100`, final Gemma no-correction `83/92` (`90.22%`), and promote eligible
  `83/100`. The old failed gate100 status above is historical, not current.
- `align-dictionary-v2-product-source-gap-candidate-senses.mjs` now deduplicates
  after alignment by exact `source_entry_id:first_sense_id`. This removed 563
  duplicate aligned rows from a 1,239-row expansion.
- Use Gemma context length 2,048 for strict pre-review. The 676-unique-sense run
  finished `676/676` valid, `545` approved, and zero system failures, but only
  195 survived the independent all-target reverse-evidence gate.
- The next resumable input has 853 aligned-new-only senses. Report:
  `logs/product-source-gap-v83-gemma-precheck-expanded853.json`; progress is
  52 complete unique rows. Resume with the same report and `--resume true`.
- Do not run two writers against the same report. A terminated tool session can
  leave its child `node` process alive; inspect process and report first.
- Main product DB and production D1 remain unchanged.

### 2026-08-05 large-scale readiness decision

- The 2,000-row checkpoint pressure run is complete. It used 1,368 exact strict
  candidates plus 632 `promote_allowed=false` infrastructure rows. All 2,000
  completed; endpoint network failures were zero and no-promote rows wrote no
  drafts.
- The earlier 1,844 strict count was an entry-level sum with 476 overlaps. Do
  not reuse it; the exact strict union is 1,368.
- Broad strict and generation-hint-only pools failed semantic review even when
  their deterministic rate was repaired. They are not production inputs.
- Production may proceed in 5,000-row batches only from candidates that pass:
  Gemma exact-sense preferred-term pre-review, all-target independent reverse
  evidence before generation, Qwen generation, deterministic revalidation, and
  final independent Gemma no-correction review.
- Quality evidence: unseen gate100 passed 92/100 generation-valid, 92/100
  deterministic-supported, 83/92 final no-correction consensus, and 83/100
  promote eligibility. The composite 500 quality/checkpoint gate and isolated
  full export/import audit also passed.
- Node allocation is currently 155 for Gemma review and 147/47/56 for Qwen.
  Do not use 143; its project model was unloaded and VRAM was confirmed at 0 MB.
- `scripts/lock-dictionary-v2-product-source-gap-evidence-terms.mjs` is a
  diagnostic/replay utility. Its output requires locked-term enrichment and is
  not directly promotable.

### Definition-contract regression and current network blocker (2026-08-05)

- Evidence pre-review can now require a four-language `definition_contract`.
  The compact Qwen prompt carries that contract and forbids broadening,
  narrowing, or changing the sense, domain, participant, or grammatical role.
- On the 14 exact rows rejected by the preceding fresh gate, Gemma returned 14
  valid reviews, 13 pre-approvals, and 13 complete contracts. Preferred-term
  filtering retained 10 rows; all-target independent reverse evidence retained
  7. This improves candidate selection, but final quality is not yet measured.
- Qwen generation is currently blocked by the active network/runtime path.
  Requests to 147/47/56 through both local SSH forwards and fixed
  `100.99.99.99:11444/11447/11448` proxies reset after about 19 seconds. Direct
  `/v1/models`, `/api/health`, and `/v1/status` calls succeed. Single-node,
  single-concurrency, MTP-off, 3,072-context, and streaming variants still
  reproduce the reset. Only one of seven rows completed and was written as a
  draft in an isolated regression DB; nothing was promoted.
- All three Qwen status responses report `llama_cpp_prebuilt_stale=true` while
  the 35B Vision GGUF is loaded. This may contribute, but the matching SSH
  banner timeout means the network path must also be treated as a blocker. Do
  not classify these rows as model rejects or include this run in a quality
  denominator.
- Resume only after a structured request remains connected for more than 20
  seconds. Use a fresh checkpoint and an isolated DB. Production D1 and the
  main product DB remain unchanged.

#### Resolution and audited result

- The blocker above was resolved with Studio's official `POST
  /api/llama/update`. Nodes 147, 47, and 56 now use llama.cpp prebuilt `b10265`
  and report `stale=false` after reload.
- Use `UD-Q4_K_XL` on A6000-147 and `UD-IQ4_NL` on RTX4090-47/56. Keep context
  3,072, speculative mode off, and one request per endpoint for this compact
  definition-contract profile. Post-update structured smoke requests passed in
  3.15 seconds on 147, 2.38 seconds on 47, and 2.32 seconds on 56 with no
  infrastructure failures.
- The seven independently supported regression candidates generated 7/7 valid
  drafts and passed deterministic reverse evidence 7/7. Independent Gemma
  accepted five with no corrections and rejected `黄土色` and `microeconomia`.
  Only those five were promoted in the isolated DB.
- The isolated full native export/import audit passed with 29,591 entries,
  35,107 senses, and 140,428 sense localizations. All blockers and
  `flagged_senses` are zero; the non-blocking duplicate-localization warning
  remains 98. The main DB and production D1 are still unchanged.
- `export-dictionary-v2-product-source-gap-checkpoint-drafts.mjs` reconstructs
  the exact written generation rows from one or more checkpoints so final
  evidence and consensus review never depend on a second model generation.

### 2026-08-05 controlled-consensus regression

- Added `build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs`.
  The lane keeps independent preferred terms separate from nonbinding model
  suggestions and requires Qwen generation plus independent Gemma consensus.
- Funnel: 17 preselected -> 16 source-approved -> 8 hint-exact -> 7 valid Qwen
  -> 3 deterministic-supported -> 3 Gemma no-correction accepts. Final rows:
  `binómio`, `supersimetria`, and `南回帰線`.
- Fixed replay so it honors `promote_allowed=false`. Controlled draft writing
  now requires an explicit flag and validated consensus provenance; direct
  publishing is forbidden.
- The isolated three-row draft/promote regression passed fast audit and
  published-risk with zero blockers.
- Subsequent human review excluded `binómio` because the `pt-BR` field used a
  European Portuguese spelling/pronunciation, and excluded `南回帰線` because
  the Portuguese proper name needs capitalization repair. This demonstrates
  that no-correction model consensus does not replace locale/style review.
- Only `supersimetria` is now present in the main DB as one
  accepted sense with four complete `needs_review=0` localizations. The main
  promote accepted 1/1 after its dry-run. Fast audit, published-risk, native
  export, and full in-memory import audit pass. Export counts are 29,587
  entries, 35,103 senses, and 140,412 localizations. Main DB SHA256 is
  `EEC7D7E9BA43D882526D14B9AC4F17CDEE40FAB805BAB9CF88F192578D7AD781`.
  This audited set is now deployed as production v84. Online API, focused API,
  and mobile/desktop render checks pass.
## 2026-08-07 v87 formal gate and scale-500 continuation

- The fresh formal 100-candidate gate now passes without lowering any release
  threshold. The merged results are `90/100` generation-valid, `88/100`
  deterministic-supported, and `82/100` final Gemma-accepted. Gemma accepted
  `82/88` evidence-supported rows (`93.2%`), above the required 90% consensus
  rate. The final replay is
  `logs/product-source-gap-v87-formal100-final-gated-replay.json`.
- A fresh isolated copy at
  `.tmp/v87-formal100-controlled-validation-20260807.db` received 81 draft
  rows. One row (`cranium`) was rejected before writing because its Japanese
  term and reading disagreed. Promote dry-run then found one real mojibake
  draft: `映写機` had reading `えいしゃ���`. It was excluded from promote and
  repaired to `えいしゃき` while remaining `needs_review=1`. The other 80
  rows promoted cleanly in the isolated DB.
- The isolated DB passes product fast audit, published-risk
  (`flagged_senses=0`), native export, and full in-memory import audit. Export
  counts are `entries=29741`, `senses=35273`, and
  `sense_localizations=141092`; every blocking integrity count is zero. The
  duplicate-localization count is a non-blocking warning (`116`).
- The production DB was not changed. Its SHA-256 remained
  `4A033CA5A860D906723D60DCC47A5F8C7401635DA9EE4CA1D1A9AD2C87BE1456`.

Scale-500 candidate preparation:

- The remaining independent round-trip pool contains only 323 candidates with
  one exact hint per target language after excluding formal100. A separate
  multi-hint pool was therefore routed through Gemma exact-sense/preferred-term
  review rather than weakening the deterministic gate.
- Gemma completed 280 multi-hint reviews: 182 approved, 98 rejected, and zero
  failed calls. The strict pool reached 212 valid reviews with 178 approvals
  before the remote path began failing. Merging the 360 approvals and applying
  exact preferred-term binding retained 298 generation inputs in
  `logs/product-source-gap-v87-scale500-generation-input.json`; 62 model
  suggestions absent from the original independent hints were blocked.
- The scale-500 isolated DB is
  `.tmp/v87-scale500-checkpoint-validation-20260807.db`. It is a byte-identical
  copy of the production DB and has not received a successful draft chunk yet.
  Resume generation only with a fresh/verified checkpoint and never point the
  command at the production DB.

Current infrastructure blocker:

- After the first 250 successful Gemma calls, every long inference request
  through `100.99.99.99:1144x` began resetting at `18.98-19.00s` with
  `ECONNRESET`. This reproduces on Gemma (143 and 155) and Qwen (56), with
  compact, micro, ultra, minimal, streaming, and non-streaming requests.
  Short `/api/health`, `/v1/models`, and `/v1/status` calls continue to pass.
- Tailscale is direct to `lab-win` at about 16 ms, not DERP. SSH to the jump
  host and ProxyJump both time out. Rebuilding only the 11447 mapping through
  dashboard `/api/portproxy/delete` and `/api/portproxy/add` did not remove the
  19-second reset. Treat these as infrastructure failures, not model rejects.
- Unsloth 155 llama.cpp was updated through official `POST /api/llama/update`
  from `b10194` to `b10297`; it reports `stale=false`, so an outdated runtime is
  no longer the cause. The remaining fix must be made in the Windows jump-host
  forwarding/firewall path or by restoring an SSH/direct tunnel.
- `review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` now supports
  opt-in `--stream true` and reconstructs OpenAI SSE deltas before applying the
  unchanged JSON validator. Default behavior remains non-streaming. Streaming
  cannot fix the present incident because the reset occurs before the first
  response byte.

## 2026-08-07 v87 scale-298 readiness result

The earlier 19-second reset was request-size dependent, not a model OOM. Short
native Studio requests to `/api/inference/chat/completions` worked while larger
request bodies through the Windows forwarding path reset. The production-safe
workaround is `--prompt-mode nano-per-language`, native SSE streaming, and one
language per request. Do not return to the older compact whole-record prompt on
the current forwarding path.

The final 20-row gate passed without relaxing validators: 20/20 generation
valid, 20/20 deterministic reverse-evidence supported, and 18/20 independent
Gemma no-correction accepts. Important fixes were:

- definitions must not equal the translated term and have language-specific
  minimum information content;
- all-katakana Japanese terms use the term itself as deterministic reading;
- the candidate `definition_contract` is included when informative;
- Gemma receives up to 220 definition characters, not a 96-character fragment;
- the per-language reviewer must not label the source language as `L`, because
  Gemma confused it with the localization language;
- `--recheck-rejected true` preserves accepted reviews and reruns only rejected
  or failed rows after a reviewer-prompt fix.

The scale run used 298 candidates. Generation produced 294 structurally valid
rows (98.7%); deterministic reverse evidence supported 292. The corrected
Gemma pass accepted 267/292 (91.4%) with zero failed calls. The final controlled
replay is `logs/product-source-gap-v87-scale500-final-gated267-replay.json`.

Checkpoint behavior is now suitable for dry generation as well as writes. It
stores complete generated items after each chunk, keys candidates by
`source_entry_id:source_sense_id`, supports endpoint migration on resume, and
reconstructs the complete report. During the real run, 56 and then 47 failed;
their circuit breakers opened, 147 continued, and an intentional interruption
resumed from 200/298 without duplicate senses. Streaming body reads now have an
explicit total timeout.

The isolated DB received all 267 controlled drafts. Deterministic promote
accepted 240/242 unique draft senses; two broad glosses remained draft. Fast
audit and published-risk passed (`flagged_senses=0`). Native export and full
memory import passed at 29,869 entries, 35,433 senses, and 141,732 sense
localizations, with all blocking integrity counts zero. Production DB and D1
were not modified.

This proves the pipeline is ready for 5,000-candidate production chunks. Keep
the same frozen prompt, validators, independent evidence policy, Qwen/Gemma
family separation, chunk checkpoints, and isolated-first promotion. Do not
publish every generation chunk; publish only after the configured 5,000-10,000
accepted-sense release boundary and a full audit.
## 2026-08-08 v87 scale-298 main merge and fresh-pool rebuild

- The previously isolated v87 scale-298 result was replayed into the local main
  product DB only after creating
  `backups/linguago-v86-before-v87-scale298-promote-20260808.db`. The backup and
  pre-write DB SHA-256 were both
  `4A033CA5A860D906723D60DCC47A5F8C7401635DA9EE4CA1D1A9AD2C87BE1456`.
- Replay inserted 242 draft senses and reused 25 existing senses. Deterministic
  promote accepted 240 and left two `broad_gloss_key` rows as review drafts.
  The audited publishable export now contains 29,869 entries, 35,433 senses,
  and 141,732 localizations. TypeScript, fast audit, published-risk, native
  export, and full in-memory import all pass; `flagged_senses=0`.
- A v83-v87 attempt index now records 18,930 unique source-entry/sense attempts.
  Rebuilding rank-200,000 coverage produced 267,369 gaps. Quality filtering and
  history subtraction retained 471 rows; independent two-family/two-target
  reverse evidence retained only 104 (`ja=19`, `pt-BR=85`). Do not pad this
  pool to claim a nominal 5,000-row production batch.
- Real source-review prompts through the Windows forwarding path reset the
  socket around 800-1,000 prompt characters, while 400-600 characters and tiny
  multilingual requests succeed. Node now records the nested fetch cause; the
  observed failure is `read ECONNRESET`. `prompt-mode=nano` keeps the first
  sample at 543 characters/560 UTF-8 bytes while preserving exact-sense, POS,
  preferred-term, and definition-contract fields.
- The 147/56 nano review smoke completed 20/20 valid calls with zero network or
  JSON failures, but accepted only 7/20. Most rejects were genuine POS,
  broad/narrow, homograph, or pt-PT/pt-BR mismatches. This fresh pool therefore
  fails the candidate-quality expansion gate. No new generation, draft write,
  D1 export, or deployment followed this review.

## 2026-08-08 v87 post-promote gated-27 main merge

- The fresh pool was rebuilt with conservative pt-BR filtering. Explicit
  pt-PT forms such as `utilizador`, `multimédia`, `óptimo`, `acção`, and
  `facto` are excluded before model review. The independent-source pool fell
  from 104 to 98 candidates (`ja=19`, `pt-BR=79`).
- Per-language Qwen source review produced 38 approvals from 98 candidates.
  Qwen generation returned 36 structurally valid rows; source-required reverse
  evidence retained 30; independent Gemma 4 31B review accepted 27. Model
  agreement was never counted as a dictionary source.
- The 27-row replay was first written and promoted in
  `.tmp/v87-postpromote-gated27-validation-20260808.db`. TypeScript, fast
  audit, published-risk, native export, and full in-memory import all passed.
- Before the main write, the product DB was backed up as
  `backups/linguago-v87-before-postpromote-gated27-20260808.db`; backup and
  pre-write SHA-256 were both
  `C5E1D93CEBAA722422CCADC94D6DD79AF96FE5ED8FD954B13441682B78CB07C8`.
  Main replay and deterministic promote accepted 27/27.
- The current local publishable export contains 29,896 entries, 35,460 senses,
  and 141,840 sense localizations. All blocking integrity checks are zero and
  `flagged_senses=0`. `duplicate_sense_localizations=116` remains a
  non-blocking warning. D1 and the Worker were not changed in this stage.

## 2026-08-08 v88 rank-100k candidate expansion

- Expanding the raw coverage window from 50,000 to 100,000 proved that the
  previous strict-pool shortage was partly a truncation effect. The clean pool
  grew from 464 to 1,123 rows before sense alignment. The all-history attempt
  index now contains 25,355 unique source-entry/sense attempts with zero JSON
  parse failures.
- Six deterministic pt-BR exclusions were added before model review:
  `eletrónica`, `champô`, `polémico`, `falhanço`, `assembly`, and `escale`.
  These are pt-PT forms or unsuitable pt-BR headword candidates; ambiguous
  genuine lexemes still go to semantic review rather than a blanket suffix
  rule.
- Unique sense alignment retained 617 rows and rejected 500 ambiguous best
  senses. The unchanged two-independent-family/two-target prefilter retained
  66 (`ja=9`, `pt-BR=57`). Qwen source review was infrastructure-clean at
  66/66 valid and retained 23. Qwen generation accepted 22/23; source-required
  reverse evidence retained 18; Gemma 4 31B no-correction consensus retained
  15.
- The controlled 15-row replay was written only to the reused isolated
  validation DB. Promote dry-run accepted 14 and blocked `demandar` as a broad
  over-merged gloss. No promote apply or main-DB write followed.
- Human inspection remains mandatory even after Qwen plus Gemma agreement.
  Hold `causalidade`, `contagiar`, `boicotar`, `はし`, and `ワイシャツ` for
  term/POS/register correction: examples include verb-to-noun drift, a less
  natural Japanese equivalent, and non-mainland Chinese preferred terms.
  Model consensus is a review layer, not proof that all four preferred terms
  are suitable for production.

## 2026-08-08 v88 inspected gated-9 main merge

- Manual term-matrix inspection reduced the 15-row consensus set to nine
  production candidates. The six held for manual correction are `demandar`,
  `causalidade`, `contagiar`, `boicotar`, `はし`, and `ワイシャツ`; their
  issues include source POS drift, broad noun-like translations for verbs,
  non-mainland Chinese preferred terms, and overly broad Japanese/English
  equivalents.
- The controlled-input builder now accepts
  `--exclude-source-entry-ids`, records those exclusions in its selection
  policy, and classifies them as `manual_exclusion`. This makes the inspected
  subset reproducible instead of relying on an edited report.
- The final nine rows were replayed into the isolated validation DB first.
  Draft write, deterministic promote dry-run, and promote apply all accepted
  9/9. Fast audit, published-risk, native export, and full in-memory import
  audit passed with all blocking counts at zero.
- Before the main write, the product DB was backed up as
  `backups/linguago-v88-before-gated9-promote-20260808.db`. The backup and
  pre-write SHA-256 were
  `3DD64E28221E91F856E2CD188B7EB8252FA50762E49643401997622CF808D3D4`.
  Main replay and deterministic promote then accepted 9/9.
- The current local publishable export contains 29,905 entries, 35,469 senses,
  and 141,876 sense localizations. Full memory-import audit, sample lookups,
  fast audit, and published-risk pass; `flagged_senses=0`, and all blocking
  integrity counts are zero. The current main DB SHA-256 is
  `5A43338B81941415B52EA21D7C07A45120E5B38E780190C3063C55DAAC7AD4D9`.
- D1 and the Worker were not changed. The six manual exclusions remain
  unpublished and should be repaired or replaced with stronger source
  evidence before reconsideration.

## 2026-08-08 v89 target-evidence recovery and gated-2 main merge

- The all-history attempt index must use the broad filename prefix
  `product-source-gap`, not only versioned `product-source-gap-vNN` prefixes.
  The corrected v89 index scanned 2,271 reports and contains 25,421 unique
  source entry/sense attempts with zero parse failures.
- Rebuilding the rank-200,000/100,000 window produced 1,051 clean rows; unique
  sense alignment retained 551. The first independent-source prefilter
  selected zero rows because 23 source-supported candidates did not have two
  target languages with strong reverse evidence.
- Prefilter diagnostics exposed an over-strict boundary: a target such as
  Japanese `基質` had an exact JMdict `substrate` match and the same OMW lexical
  match, but unrelated JMdict senses made its ratio 1/3, just below 0.34. The
  validator now accepts an exact strong-dictionary match plus an OMW lexical
  match as two independent source families; the global 0.34 threshold was not
  lowered. This recovered 11 pt-BR candidates.
- Qwen source review was valid for 11/11 and accepted four. Qwen generation was
  valid for 4/4 with zero endpoint failures; deterministic four-language
  reverse evidence supported 4/4; independent Gemma 4 31B no-correction review
  accepted 4/4 at confidence 1.0.
- Promote dry-run rejected `incorrer` and `emular` as `broad_gloss_key`; they
  remain manual split work. The inspected final subset contains `veemente` and
  `coeficiente`. Both passed clean isolated write, promote dry-run/apply, fast
  audit, published-risk, native export, and full in-memory import before main
  merge.
- The pre-write backup is
  `backups/linguago-v89-before-gated2-promote-20260808.db`, SHA-256
  `5A43338B81941415B52EA21D7C07A45120E5B38E780190C3063C55DAAC7AD4D9`.
  The post-write main DB SHA-256 is
  `2D968DAB2C5F3C758C78AFC052248C766B4B878A5B27E35146D13DE098E0103C`.
- The current local publishable package contains 29,907 entries, 35,471 senses,
  and 141,884 sense localizations. All release blockers and
  `flagged_senses` are zero. D1 and the Worker were not changed.

### v89 follow-up: controlled gloss precedence

- The `broad_gloss_key` rejection for `incorrer` and `emular` exposed a
  promotion-field bug rather than proving that each row required a sense
  split. Their controlled generations had concise anchors (`incur`,
  `emulate`), but the promoter replaced them with multilingual source
  summaries from the report's `selected` rows.
- `loadReportGlosses` now prefers `generated[].output.gloss_key` for valid
  controlled replay rows and falls back to the source report gloss for
  ordinary reports. The evidence threshold and broad-gloss validator remain
  unchanged. Repeating the isolated promote dry-run accepts all four rows.
- `incorrer` and `emular` are still not in the main DB. Human inspection found
  a contradictory Japanese definition for `incorrer` (it included benefits
  despite the negative `incur` sense) and unnatural Japanese grammar for
  `emular`. Because the earlier Gemma review accepted both, require a new
  targeted definition review and new no-correction consensus; do not fabricate
  corrections from the old report.

### v89 follow-up: corrected `incorrer` promotion

- A fresh full-definition Gemma review rejected the old `incorrer` row and
  required Japanese `受ける` to become `招く`, with a definition limited to
  an unwelcome consequence. The correction was used only as a constraint for
  a new Qwen generation; the old accepted output was not edited in place.
- The regenerated row passed deterministic four-language reverse evidence and
  a new Gemma full-definition review with `decision=accept`, confidence `1.0`,
  and no correction. An isolated draft/write/promote cycle then passed fast,
  published-risk, native export, and full in-memory import audits.
- The same controlled replay was written to the main DB as draft and promoted
  `1/1`. The local publishable package now contains 29,908 entries, 35,472
  senses, and 141,888 sense localizations. All release blockers remain zero,
  including `flagged_senses=0`.
- The pre-write backup is
  `backups/linguago-v89-before-incorrer-corrected-promote-20260808.db`, SHA-256
  `2D968DAB2C5F3C758C78AFC052248C766B4B878A5B27E35146D13DE098E0103C`.
  The resulting main DB SHA-256 is
  `C62D9D738406E0948251D08F4F9C10B6C976B8FB0BD4334E198C4C54CF655F55`.
- At this checkpoint `emular` remained unpublished for targeted
  Japanese-definition cleanup. The follow-up below resolves it. D1 and the
  Worker were not changed.

### v89 follow-up: corrected `emular` promotion and language-focused review

- The general full consensus prompt checked semantic agreement but twice
  missed malformed Japanese grammar. The consensus tool now accepts
  `--language-focus <en|pt-BR|zh|ja>` and explicitly proofreads the selected
  localization for grammar, particles, syntax, and native dictionary style.
- With `--language-focus ja`, Gemma rejected the original definition because
  it lacked a valid predicate/particle structure. A first structured retry
  fixed the grammar but introduced a circular definition using `倣う` to
  define `倣う`; the same focused gate rejected it again.
- A second structured retry generated the Japanese definition
  `他の人や物の行動や性質などを模倣し、それに合わせようとすること。`.
  It passed deterministic four-language reverse evidence and a fresh Gemma
  review with `decision=accept`, confidence `1.0`, and no corrections.
- Isolated and main draft/promote runs both accepted `1/1`. Fast,
  published-risk, native export, and full in-memory import audits passed. The
  local publishable package now contains 29,909 entries, 35,473 senses, and
  141,892 sense localizations; all release blockers and `flagged_senses` are
  zero.
- The pre-write backup is
  `backups/linguago-v89-before-emular-corrected-v2-promote-20260808.db`, SHA-256
  `C62D9D738406E0948251D08F4F9C10B6C976B8FB0BD4334E198C4C54CF655F55`.
  The resulting main DB SHA-256 is
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
  D1 and the Worker remain unchanged.

### v89 residual source-review audit

- The seven remaining source-review rejects all lacked a bindable Chinese
  target term. Five had only OMW support. `metástase` added only one-direction
  Word2Word evidence, which is still insufficient.
- `oclusão` had OMW plus reciprocal Word2Word evidence for Chinese `梗塞`, but
  enabling `corpus_word2word` globally polluted the Portuguese source evidence
  with unrelated corpus pairs and reduced its lexical match ratio to `0.2`.
  The prefilter now supports
  `--strong-supplemental-families-by-lang zh:corpus_word2word`, so a weak family
  can be promoted only for one explicitly named language.
- Even with that scoped option, `梗塞` was not emitted as a generation hint:
  CC-CEDICT/Kaikki expose competing obstruction and infarction senses, so the
  target-term ambiguity gate rejected automatic binding. This is expected and
  must not be bypassed. All seven rows remain residual/manual; rebuild the next
  coverage-gap pool instead of lowering the term evidence threshold.

### 2026-08-08 v90 strict-pool exhaustion

- Rebuilt the historical attempt index with prefix `product-source-gap` after
  the v89 corrections: 2,353 files, 516 generation reports, 52 checkpoints,
  19,370 unique source entries, and zero JSON parse failures.
- The current main DB produced 267,263 ranked gaps. The 100,000-row scan became
  1,040 clean candidates and 540 uniquely aligned senses. Strict reverse
  evidence found 12 source-supported rows but **zero** rows with at least two
  target-language hints, so no v90 LLM batch was started.
- The 12 residuals expose only source-language plus English terms. Ten are
  Portuguese forms; the other two are Japanese `過伸展` and Chinese `平方英里`.
  They need new independent target-language dictionary evidence before
  generation. The dominant rejection reasons were 374 strong-dictionary gloss
  conflicts and 133 rows with no strong reverse evidence.
- This is evidence-pool exhaustion, not an Unsloth capacity failure. Do not
  send these rows to Qwen with invented target terms. The next expansion must
  import or validate additional licensed multilingual evidence, then rerun the
  same v90 filter/alignment/prefilter sequence.

### 2026-08-08 supplemental-license enforcement

- MUSE is not a production evidence source. Its four local source records are
  licensed `CC BY-NC 4.0` and explicitly carry
  `production_publishable=false`; they may be used only for internal research.
- The reverse-evidence prefilter and final validator now read
  `evidence_sources.metadata_json` and license metadata. They automatically
  exclude source keys marked
  non-publishable, families whose members are all non-publishable, and
  non-commercial `BY-NC` data. `panlex-unmapped` remains blocked explicitly.
- A regression run against
  `.tmp/muse/openwn-muse-research-evidence.db` blocked all four MUSE source
  keys and retained `selected_rows=0`. Do not merge MUSE into the production
  combined evidence DB or promote it through `--strong-supplemental-families`.
- MUSE exposed research-only lexical matches for some v90 anchors, but this
  does not resolve the licensed independent-dictionary evidence shortage.
  Continue source acquisition rather than lowering the v90 gate.

### 2026-08-08 Wikidata Lexeme sense feasibility probe

- `scripts/probe-wikidata-lexeme-sense-evidence.mjs` queries the official
  Wikidata Query Service without writing SQLite. It requires an English Lexeme
  sense and a target Lexeme sense to share the exact `P5137` concept item, and
  requires the same Wikidata lexical-category item before counting a target.
- The probe uses the existing `wikidata` family and CC0 structured data; it is
  not a new independent family. It is a higher-precision extension of the
  existing item-label evidence experiment.
- On the 12 v90 source-supported residuals, 11 had no shared target Lexeme
  sense. `rectangular` shared `Q209` with Portuguese/Japanese noun lexemes, but
  the English lexeme is an adjective (`Q34698`) and the targets are nouns
  (`Q1084`). The category gate rejected this concept-level false alignment.
- Final result: zero rows with any compatible non-source target, zero with two
  targets, and no evidence DB import. Wikidata Lexeme does not reopen v90.

### 2026-08-08 v90 high-frequency manual residual queue

- The 134 manual-review rows were dominated by 133 cases with no strong
  reverse-dictionary evidence. A frequency-balanced 20-row queue was selected
  at `zh=7`, `ja=7`, `pt-BR=6`; all 20 are genuinely absent from the product
  DB by exact source-sense link, headword, and localization-term checks.
- `select-dictionary-v2-product-source-gap-manual-review.mjs` now joins rows by
  exact `source_entry_id:source_sense_id` rather than entry ID alone and emits
  both the evidence record and an empty human-review template.
- `annotate-dictionary-v2-product-source-gap-manual-review.mjs` performs the
  read-only product lookup and classifies existing links before any manual
  repair is planned.
- The unresolved 20 senses are persisted in
  `config/dictionary-overrides/source-gap-manual-residuals-v90.json`. The
  coverage filter accepts `--exclude-source-sense-key-files` so future pools
  skip only those exact senses, not every sense under the same source entry.
- The exclusion regression reports `excluded_source_entry_ids=0`,
  `excluded_source_sense_keys=20`, and exactly 20
  `excluded_source_sense_key` rejects. No LLM, draft write, product mutation,
  D1 export, or deployment occurred.

### 2026-08-08 first locale form alias

- Product tables do not store entry forms. `v2_entry_forms` is synthesized by
  `export-dictionary-v2-product-native-d1-sql.mjs`, so spelling variants must
  be added at export time rather than inserted as unsupported product senses.
- The exporter now loads
  `config/dictionary-overrides/product-entry-form-aliases.json` and fails if a
  configured target is absent from the publishable export or its entry ID,
  headword, or primary language no longer matches.
- The first approved alias is European Portuguese `electrónica` to the
  existing pt-BR `eletrônica` entry `23336` (`electronics`). Full native export
  and in-memory import passed; both spellings returned the same entry and all
  blocking audit counts remained zero.
- A later semantic audit found that `activos` can safely map to the existing
  pt-BR `bens` entry `30466` (`assets`), so it is now a reviewed
  `locale_inflected_form` alias. `ativos` already resolves through an accepted
  localization and was not duplicated. `poluentes` remains an exact
  sense-level manual residual because its Kaikki form record is adjectival but
  the OMW four-language concept is nominal.
- The temporary alias export was deleted after verification, releasing
  123,529,464 bytes. Product DB, D1, and Worker were not changed.

### 2026-08-08 targeted source-sense probe

- Added `scripts/build-dictionary-v2-product-targeted-source-sense-candidates.mjs`
  and `config/dictionary-overrides/source-gap-targeted-canonical-senses-v90.json`
  for exact merged entry/sense candidates omitted by ranked coverage scans.
- The builder is read-only and rejects identity drift, missing source links,
  and terms already represented in product data. Reviewed form evidence is
  metadata only and cannot bypass the reverse-evidence gate.
- The first target, noun `poluente`, built successfully as source candidate
  `2080404:2080404` but the normal prefilter rejected it as
  `strong_dictionary_gloss_conflict`. WikDict supplies the noun anchor
  `pollutant`; Kaikki's `poluentes` source record is explicitly adjectival,
  while the OMW four-language concept is nominal. Do not bridge this mismatch
  and do not send it to an LLM.
- The controlled `activos` alias passed native export plus full in-memory lookup
  audit. Product DB, remote D1, and Worker remain unchanged.

### 2026-08-08 exact WikDict lexentry alignment

`build-dictionary-v2-product-wikdict-lexentry-candidates.mjs` resolves a merged
v2 sense through `sense_source_links` before reading WikDict metadata. Never
query `source_senses.id` with a coverage-report sense ID directly: reports
store merged `senses.id`, not raw source-sense IDs.

The builder accepts only WikDict rows with `is_good=1`, `score>=20`, and an
exact shared `lexentry`. Multiple language pairs under that lexentry remain a
single `wiktionary` evidence family. Output metadata therefore sets
`one_source_family_only=true`, `independent_validation_required=true`, and
`publication_evidence=false`; every row must still pass the normal strict
reverse-evidence prefilter.

The latest v90 funnels were:

- 421 uniquely aligned rows -> 90 exact groups covering all target languages
  -> 4 strict independent-evidence rows;
- allowing two lexentry target languages produced 151 rows -> 8 strict rows ->
  7 rows at semantic risk <=4;
- 1,434 formerly `ambiguous_best_sense` rows -> 283 all-target exact groups ->
  2 strict rows;
- allowing two lexentry targets in the ambiguous pool produced 481 rows -> 6
  strict rows -> 6 rows at semantic risk <=4.

This fixes sense-selection ambiguity but does not solve the independent-source
shortage. The low-risk tail remains below the 20-row source-review gate, so no
LLM generation followed. High-quality parallel mismatches remain important:
`pictograma`, `trema`, and `rúcula` show scope conflicts, while `arquétipo` has
the narrower Japanese `元型` versus `原型` distinction. Product DB, D1, and
Worker were not changed.
## 2026-08-08 v90 exact-WikDict and Wikidata validation

- Added `build-dictionary-v2-product-wikdict-lexentry-candidates.mjs`. It aligns
  merged product senses to raw WikDict rows by the exact shared `lexentry` and
  keeps Kaikki plus WikDict in one `wiktionary` family. Exact agreement across
  several WikDict language pairs is useful alignment evidence, but never counts
  as several independent publication sources.
- Candidate-specific exact Wikidata labels (CC0, labels only, no aliases) raised
  the strict two-target funnel to 50 rows. Risk triage retained 47 fresh rows.
  Source review ran two 20-row samples: the first accepted 17/20; the second
  accepted 19/20 with `cérvix` rejected because the model requested a Japanese
  term outside the evidence-bound allow-list. Combined source-review acceptance
  was exactly 36/40 (90%).
- The first 20 approved rows generated 19/20 structurally valid outputs. The
  only structural failure was `hipertexto` with `ja_reading_mismatch`.
  Deterministic reverse evidence retained 17/20; the two remaining rows lacked
  sufficient independent Chinese evidence.
- Gemma 4 31B `nano` review initially accepted only 12/17 and incorrectly called
  several concise definitions truncated. Rechecking only the five failed rows
  with the full prompt accepted four. The final independent no-correction result
  was 16/17. `polidez` remained correctly rejected because Japanese `丁寧` is an
  adjectival term while the source noun requires `丁寧さ`.
- The controlled 16-row replay wrote only to
  `.tmp/v90-wikdict-lexentry-wikidata-controlled16-validation.db`. Promote first
  flagged `neurônio` because generated gloss `nerve cell` did not token-overlap
  English term `neuron`; converting the already independent Gemma consensus to
  the supported semantic-review format resolved this synonym case without
  weakening the deterministic rule. Promote then passed 16/16.
- Isolated fast audit, published-risk, native export, and full memory import all
  pass. Export counts are 29,925 entries, 35,489 senses, and 141,956 sense
  localizations; all release blockers and `flagged_senses` are zero. Native full
  audit requires an existing export manifest: run
  `export-dictionary-v2-product-native-d1-sql.mjs` before
  `audit-dictionary-v2-product-export.mjs --mode full`.
- The main product DB was not modified. Its SHA-256 remains
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
  D1 and the Worker were not changed.

### v90 remaining reviewed pool and combined isolation

- The remaining 16 source-approved candidates generated 16/16 valid outputs on
  147/56 at one request per endpoint. Deterministic reverse evidence retained
  15; `tanatologia` remained manual because Chinese `死亡学` had only the
  Wiktionary family. Full-prompt Gemma review accepted 13/15.
- Gemma correctly rejected `monismo` for a missing Portuguese preposition and
  `mesoderma` for unnatural Portuguese/Japanese definitions. These rows were
  not corrected or promoted. The accepted spelling variant `mesoderme` remained
  a separate evidence-aligned candidate.
- Across both reviewed batches the measured funnel is 36 source-approved -> 35
  structurally valid -> 32 deterministic-supported -> 29 independent Gemma
  no-correction accepts. Rates are 97.2%, 88.9%, 90.6% of supported rows, and
  80.6% end-to-end respectively.
- The two controlled replays were merged by exact
  `source_entry_id:source_sense_id` and tested together in
  `.tmp/v90-wikdict-lexentry-wikidata-controlled29-validation.db`. Draft write,
  checkpoint construction, promote dry-run/apply, fast audit, published-risk,
  native export, and full memory import all pass for 29/29.
- The combined isolated export has 29,938 entries, 35,502 senses, and 142,008
  sense localizations. All release blockers and `flagged_senses` are zero. The
  seven remaining rows in the original 47-row pool were excluded by the
  semantic-risk selector, not accidentally skipped.

### v90 min-one-target expansion failure boundary

- Lowering only the WikDict lexentry intake from two known target languages to
  one increased the exact candidate pool from 632 to 932. Candidate-scoped
  exact Wikidata labels expanded the strict all-target evidence result to 70;
  semantic-risk triage retained 55. A refreshed attempt index covering 2,481
  reports and 25,537 entry/sense attempts removed 40 historical rows, leaving
  15 genuinely fresh candidates.
- Qwen source review accepted 12/15. It correctly rejected `moleiro` for
  Chinese/Japanese sense mismatch, misspelled `halibute`, and `impugnar` for a
  Chinese sports-sense mismatch. Generation produced 10/12 structurally valid
  rows; `ortiga` failed Japanese reading alignment and `incolor` had a thin
  Portuguese definition. All ten valid rows passed deterministic evidence.
- Independent full-prompt Gemma accepted only 3/10. Rejections exposed a
  systemic quality loss: POS drift (`isento`), wrong Chinese term (`manjerona`),
  malformed or calqued Japanese/Chinese definitions, and a factual geological
  class error for `pleistoceno`. Therefore the whole min-one-target experiment
  is blocked from draft/promote, including its three nominal accepts. Do not use
  this route to pad the formal 100-row gate.
- Reaching 100 formal rows now requires additional independent lexical evidence
  or a separately validated correction lane. It must not be achieved by
  weakening target-language coverage, source-family independence, or Gemma
  no-correction consensus.

### v90 evidence-acquisition priority after min-one failure

- Run `dict:v2:coverage:report-evidence-deficits` against the two underlying
  reverse-evidence reports, not their wrapper prefilter reports. The wrapper
  contains `selected/rejected`; the diagnostic consumes `validations`.
- The combined 932-row diagnostic contains 70 supported and 862 rejected rows.
  The dominant blocker is still semantic conflict (`633`), not model capacity.
  For actionable target evidence, there are 99 missing target checks: `zh=69`,
  `ja=27`, and `pt-BR=3`. Of these, 72 have zero observed evidence families and
  27 have one.
- The report now emits `evidence_acquisition_priority`, including zero-family,
  one-family, and round-trip deficits. This run ranks `zh=245`, `ja=98`, and
  `pt-BR=6`. Acquire a traceable commercial-compatible Chinese-English family
  first, then Japanese-English. More Portuguese aggregation is low priority.
- PanLex publishes its snapshots under CC0, but PanLex is an aggregator with
  source-level provenance. The project must continue mapping each PanLex source
  back to its underlying family; PanLex itself is not an independent vote.
  `panlex-unmapped` remains blocked even when the aggregate snapshot is usable.
- The official PanLex source registry distinguishes explicit open permissions
  from copyright-only or unknown source records. Do not infer an independent
  production family solely from the aggregate license. Preserve original
  source ID, provenance, and a reviewed family map.
- OMW is already represented in the evidence database. Updating its English
  release can improve gloss quality, but cannot create a second independent
  Chinese or Japanese family. OmegaWiki remains blocked until an authoritative,
  checksummed dump and license record are reproducibly available.
- The product DB was not modified by this diagnostic. No draft, promote, D1,
  Worker, or deployment action followed.

### v90 OpenHowNet licensed reviewed evidence

- The official THUNLP archive remains available at
  `https://thunlp.oss-cn-qingdao.aliyuncs.com/OpenHowNet/resources.zip`.
  The checked artifact is 74,698,239 bytes, last modified 2021-09-20, with
  SHA-256 `DAAA31E2627E099E03CE15371F472C6F9EC5B3AAC71A4E5E2AB5C4F4F38C44D4`.
- The archive contains 237,974 pickle-serialized senses. The research exporter
  retained 216,329 useful Chinese-English sense pairs, representing 117,264
  normalized Chinese terms and 118,423 English anchors. SQLite integrity passed.
- `export-openhownet-research-evidence.py` requires the pinned archive hash
  before deserializing the pickle. Publication status is controlled by
  `config/dictionary-sources/openhownet-license.json`; missing or incomplete
  provenance fails closed to research-only.
- The official download page places the core data and API in the same OpenHowNet
  download area and states that OpenHowNet uses MIT. The official repository
  identifies itself as containing both core data and API and asks users of data
  or API to cite the project papers. Preserve those citations and the official
  URLs recorded in the license provenance file.
- The exact-anchor research probe matched 42/69 current Chinese target deficits
  (60.9%). Twenty-seven matches expose one Chinese term; 15 expose multiple
  terms and require POS/sememe/sense disambiguation. This is strong feasibility
  evidence, not a publication gate or permission to call Qwen.
- The exporter now preserves English POS, Chinese POS, and the sememe definition
  in `openhownet_sense_metadata`. The probe infers expected POS from the source
  sense when available and otherwise from an unambiguous OMW synset suffix.
  Both OpenHowNet language sides must match that POS for an exact binding.
- POS binding retained 32/42 matches and rejected ten conflicts. Twenty-one
  retained rows have one exact-POS Chinese term; eleven still have several.
  The 21-row queue is emitted as `research_candidates` with status
  `license_blocked_semantic_review`. It is not a generation input.
- A unique POS-bound term is still not automatically correct. For example,
  `categorize -> 分类` and `corolla -> 花冠` are specific, while
  `circumflex -> 符号` is too broad. Sememe/manual semantic review remains
  mandatory even after the license boundary is cleared.
- Reproduce the probe with
  `dict:v2:coverage:probe-openhownet-research`. It is hard-coded to report
  `publication_evidence=false` and `generation_allowed=false` while source
  metadata remains non-publishable.
- The 2026-08-08 independent semantic review used Qwen 3.6 35B MTP on 11444
  and Gemma 4 31B QAT on 11445. Both produced valid JSON for all 21 rows.
  Qwen had 13 high-confidence accepts; Gemma had 15. Dual adjudication retained
  13 high-confidence agreements, found one disagreement (`cureta -> 刮器`),
  and blocked seven other rows. These agreements remain
  `license_blocked_dual_model_accept` because that immutable report predates
  the verified license record. Reuse the decisions only through the reviewed
  evidence exporter; do not edit the historical report in place.
- Reproduce each independent review with
  `dict:v2:coverage:review-openhownet-research` and combine them with
  `dict:v2:coverage:adjudicate-openhownet-research`. Load
  `UNSLOTH_API_KEY` from `.env.local` into the process environment; never pass
  or persist the token in reports. The reviewer supports `--resume true` and
  fingerprints its 21-row input.
- Re-exporting with the verified license record created
  `.tmp/openhownet/openhownet-mit-evidence.db` with 216,329 paired senses and
  SQLite integrity `ok`. Never merge this full database into production because
  exact English anchors alone can still choose broad or mismatched lemmas.
- `dict:v2:coverage:export-openhownet-reviewed` intersects the immutable probe,
  Qwen/Gemma consensus, and MIT evidence DB. It produced an isolated
  13-candidate/13-concept database at
  `.tmp/openhownet/openhownet-reviewed-evidence.db`. Count it as one independent
  `openhownet` family in the next coverage rebuild; it does not bypass the
  normal multi-family, deterministic, or Gemma gates.
- To avoid another 595 MB combined-DB copy,
  `dict:v2:coverage:append-supplemental-evidence` transactionally appended the
  13-row reviewed subset to the current v90 combined evidence DB. Integrity
  remained `ok`; a metadata conflict would have aborted the append.
- Re-running both strict min-one candidate pools increased supported rows from
  70 to 73. The three genuinely new rows are Portuguese `maremoto`, `isômero`,
  and `eucarionte`; all three were absent from the refreshed attempt index.
- Formal Qwen source review accepted 3/3, structured generation produced 3/3
  valid rows with no DB writes, deterministic reverse evidence supported all
  four languages for 3/3, and independent Gemma 4 31B consensus accepted 3/3
  at confidence 1.0 without correction. The next action is isolated-copy
  draft/promote and full audit, not a write to the main product DB.
- The 2026-08-10 isolated-copy human gate promoted only `maremoto` (sense
  37668) and `isomero` (stored as `is\u00f4mero`, sense 37666). `eucarionte`
  (sense 37667) stayed `draft_single_source`; all four localizations retain
  `needs_review=1` because the generated English and Portuguese definitions
  were too broad and omitted the defining membrane-bound nucleus. Qwen,
  deterministic reverse evidence, and Gemma consensus had all passed, so this
  is the reference case for why semantic specificity still needs a human gate.
- The human-gated native export and full in-memory import audit passed with
  29,911 entries, 35,475 senses, and 141,900 sense localizations. Localization
  counts, duplicate sense orders, orphans, mojibake, HTML artifacts, and
  published risk were all zero. Treat `eucarionte` as an expected absence from
  publishable lookup samples until a targeted repair passes the same gates.
- The main product DB SHA-256 remained
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
  No main-DB write, D1 update, Worker change, or deployment followed.
- A targeted 2026-08-10 repair then replaced the four-language definition
  contract for `eucarionte` without patching SQLite directly. The reproducible
  constraint is in
  `config/dictionary-quality-repairs/eucarionte-definition.json`; build its
  generation input with `dict:v2:coverage:build-definition-repair`.
- Fresh Qwen generation preserved the required membrane-bound nucleus and
  membrane-bound organelles in all four definitions. Deterministic reverse
  evidence supported 4/4 languages with source-language reverse evidence
  required, and independent Gemma accepted 1/1 at confidence 1.0 with no
  corrections.
- Isolated replay reused entry 37064 and sense 37667 rather than inserting a
  duplicate. Promote accepted 1/1, cleared four review flags, and raised the
  isolated publishable count to 35,476 senses. The full native export/import
  audit passed with 29,912 entries and 141,904 sense localizations; all
  blocking counters and sample failures were zero.
- The promoter now accepts successful `writes[]` from a draft-apply report as
  checkpoint items. Previously it recognized only `items{}`, so a reused draft
  produced `checkpoint_sense_ids=0` and was silently skipped during promote.
  Keep this compatibility path for controlled replay and resume workflows.
- This repaired row still exists only in the isolated validation database.
  The main DB hash is unchanged, and no D1 or Worker release has occurred.
- Main product DB, D1, and Worker remained unchanged.

### v90 OpenHowNet three-row main-DB promotion

- The later 2026-08-10 controlled main-DB replay supersedes the final two
  isolation-only statements above. Before writing, the exact previous database
  was copied to
  `backups/linguago-v90-before-openhownet-3-promote-20260810.db`; its SHA-256 is
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
- `maremoto`, `isomero` (stored as `is\u00f4mero`), and `eucarionte` were replayed
  as drafts. The repaired `eucarionte` replay reused sense 37667 and replaced
  its four draft localizations before any promotion.
- Promotion was intentionally split by review provenance. The original batch
  promoted senses 37666 and 37668 while explicitly excluding 37667. The
  repaired checkpoint, reverse-evidence report, and new Gemma review then
  promoted 37667 separately. Results were 2/2 and 1/1, with 12 localizations
  promoted and no rejected rows.
- Main product DB fast audit, published-risk audit, native export, and full
  in-memory import audit all passed. The current local package contains 29,912
  entries, 35,476 senses, and 141,904 sense localizations. All blocking
  counters are zero, `flagged_senses=0`, and lookup samples for `maremoto`,
  `is\u00f4mero`, and `eucarionte` pass.
- The new main DB SHA-256 is
  `6C40303FAEA55A3CBE00CD45430A314B3EADB813093149B1C28593F099EEAA77`.
  Export artifacts are under
  `outputs/d1-v2-product-native-export-v90-openhownet-main`. This has not been
  pushed to Cloudflare D1, and no Worker deployment or cache bump has occurred.

### v90 OpenHowNet production release

- The later 2026-08-10 release supersedes the final local-only sentence above.
  Production D1 now contains 29,912 entries, 35,476 senses, 141,904 sense
  localizations, 3,030 examples, and 11,898 example localizations. Health reports
  `published_at=2026-08-10T08:06:06.996Z`.
- The pre-release remote D1 backup is
  `backups/linguago-dictionary-before-v90-openhownet-20260810.sql`, size
  124,007,767 bytes, SHA-256
  `3B92328B5EA067D6C3C2B6D108AF81FC204EEE0608254E32F068DB0FE4379CE1`.
- Worker cache version is `v90-openhownet-3-29912`. Deployed Worker Version ID:
  `dc83a972-1a3b-4402-ba43-87fc9f97f80c`.
- Remote D1 verification matched the export manifest after upload. The complete
  online dictionary regression, focused API check, and focused Playwright
  render check passed. Mobile and desktop renders for `maremoto`, `is\u00f4mero`,
  and `eucarionte` used the dictionary provider and had no horizontal overflow.
- The focused online check now pins the v90 counts and includes the three new
  Portuguese entries so a later release cannot silently lose them.

### v90 large-scale gate: reviewed OpenHowNet expansion

- Two aligned coverage reports contained 540 and 421 rows but only 75 overlaps,
  for 886 unique candidate senses. The OpenHowNet probe now accepts multiple
  reports, deduplicates by `source_entry_id:first_sense_id`, and can exclude an
  earlier probe so model review is not repeated.
- A new isolated OpenHowNet review pass found 86 exact POS-bound rows. Qwen and
  Gemma independently agreed on 38/57 unique-term rows and 20/29 finite-choice
  rows. The 58 accepted candidates exported to 59 MIT-provenance evidence rows;
  the combined evidence DB now has 131 OpenHowNet rows and passes SQLite
  integrity checking. All subsets still use one `openhownet` source family.
- Strict reverse prefiltering of the 886-row union selected 180 rows using two
  independent source families, three target languages, and two-family existing
  localization round trips. Source review accepted 64/100 in the older slice
  and 61/80 in the unseen slice. Network failures were zero. The low raw rate is
  caused by real homograph, POS, and broad/narrow mismatches, so source review is
  now an explicit candidate-selection stage rather than a reason to weaken the
  evidence gate.
- The merged 125 source-reviewed candidates supplied a fixed 100-row generation
  gate. Qwen produced 98 structurally valid entries, with zero endpoint failures;
  deterministic reverse evidence supported all 98 valid rows in all four
  languages. Initial Gemma no-correction consensus accepted 57. Safe structured
  correction cycles added 19, then 3, then 2 unique accepts, reaching 81/100.
  This passes the required 80% final promote-quality gate without writing drafts.
- Two validator lessons are now encoded in scripts. Retry prompts must never
  include raw parser errors because models may judge that text as lexical input.
  Also, semicolons are ambiguous in a term/reading replacement but valid inside
  a complete definition; the structured-correction validator now distinguishes
  those fields.
- The generation and publication mechanics are therefore validated for scale,
  but the current strict candidate pool is not large enough for the planned
  500-row write/resume gate. Do not claim 5,000-row production readiness until
  at least 500 source-reviewed candidates exist and that real draft checkpoint,
  resume, promote, and audit run is completed. Production remains v90 and no
  database writes or deployments were made by this gate.
## 2026-08-10 all-eligible scale-pool checkpoint

- The source-sense aligner now supports `--expand-all-eligible true`. It
  produced 24,898 unique senses and 3,527 rows after the current strict reverse
  evidence gate.
- A fresh entry-unique 100-row source review reached Qwen 55/100, Gemma 56/100,
  and dual acceptance 44/100. This is not ready for generation. Semantic/POS
  drift, not endpoint capacity, is the blocker; no product DB, D1, or Worker
  write occurred.
- The Dicionario Aberto definition probe can restrict work with
  `--validation-report` and `--validation-decisions`. A manual-review-only
  100-row dual-model pilot yielded 75 reviewed definitions but zero net strict
  candidates because Dicionario Aberto alone did not provide the required
  second independent source family. Do not run the remaining 259 rows under
  the same evidence configuration.

## 2026-08-11 v90 isolated 2,000-row scale qualification

The final v3 pressure cohort passed the large-batch quality gate in an isolated
database. Production v90, remote D1, and the Worker were not modified.

- The manifest contains exactly 2,000 semantic groups. Candidate deduplication
  must use candidate/sense identity, not only `source_entry_id`; entry-only
  merging previously discarded distinct senses.
- Qwen generated all 2,000 checkpoint items across ports 11444, 11447, and
  11448: 1,898 were structurally accepted, 102 rejected, and infrastructure
  failures were zero. The checkpoint audit found 1,898 unique draft senses,
  7,592 localizations, zero duplicate senses, and zero bad localization counts.
- Deterministic reverse evidence supported 1,868 rows. Initial independent
  Gemma consensus accepted 1,376 unchanged. One bounded correction cycle added
  243 rows after fresh generation, reverse evidence, and no-correction Gemma
  acceptance.
- The final controlled cohort promoted 1,619/2,000 senses (80.95%). Promotion
  used an exact checkpoint assembled from 1,376 base writes and 243 correction
  replay writes; dry-run scanned and accepted all 1,619 before apply.
- Fast audit and published-risk passed. The isolated database has 37,095
  publishable senses, exactly 1,619 above v90, with `flagged_senses=0` and all
  structural/content blockers at zero.
- Native export produced 30,929 entries, 37,095 senses, 148,380 sense
  localizations, 3,030 examples, and 11,898 example localizations in 19 chunks.
  Full in-memory import matched the manifest exactly; duplicate orders,
  orphans, mojibake, HTML artifacts, and bad localization counts were all zero.

The frozen scale path is: source review, candidate-key deduplication,
checkpointed draft generation, deterministic reverse evidence, independent
no-correction consensus, bounded correction with fresh review, exact checkpoint
promotion, fast/published-risk audits, then native export and full import audit.
A risk flag may pass only when review explicitly resolves an alternative,
polysemy, or register distinction. Unresolved scope, POS, homograph, and
preferred-term conflicts remain blocked.

Operational lessons:

- Reconstruct the complete generation report from checkpoint writes after a
  resumed/chunked run; the final process report may cover only one segment.
- Merge reports by candidate identity so multiple senses under one entry remain.
- Draft apply reports store successful rows in `writes[]`, including reused
  drafts; promotion checkpoint builders must consume them.
- Inspect command lines before stopping stale Node clients. Never terminate all
  Node processes because unrelated work can share the executable.
- Preferred-term failures are normally evidence-contract failures, not token
  truncation; extra output tokens do not justify relaxing term alignment.

Authoritative artifacts are local under
`.tmp/validation/linguago-v90-pressure2000-v3.db` and
`.tmp/validation/v90-pressure2000-v3-export`. They remain untracked. This gate
proves that the pipeline mechanics can scale, but it is not a production
release and does not by itself prove that 5,000 fresh high-quality candidates
exist.

### 2026-08-11 5,000-row candidate-capacity check

- The strict prefilter contains only 3,527 candidates. Of these, 3,025 had
  already entered source review and the validated v3 manifest consumed 2,000
  approved semantic groups. There is not a fresh 5,000-row strict pool.
- Expanding to the broader 24,898-sense aligned report leaves 21,873 unreviewed
  senses and 9,998 unique entries, but those rows have not passed the strict
  independent-evidence prefilter.
- A first broad-pool run used an incompatible micro/evidence-bound prompt and
  was stopped after 271 reviews with zero approvals. A corrected compact-prompt,
  entry-balanced 20-row gate also produced zero approvals: nine valid semantic
  rejects and eleven evidence-bound preferred-term failures.
- Therefore do not launch a 5,000-row generation from the broad pool. The
  infrastructure is scale-qualified; candidate supply is not. Acquire or align
  more independent lexical evidence, rebuild the strict prefilter, and require a
  fresh source-review gate before attempting 5,000 drafts.

### 2026-08-11 ECDICT and Japanese WordNet evidence expansion

- Recomputing the old evidence pool with the current prefilter code produced
  `3,016` strict candidates. Use this number as the A/B baseline; the older
  `3,527` report came from earlier prefilter behavior and is not directly
  comparable.
- The official ECDICT repository is MIT licensed. The checked-in CSV is UTF-8,
  although Windows PowerShell `Get-Content` may display it as mojibake. Verify
  bytes with Node `TextDecoder('utf-8')` before treating the file as corrupt.
- `export-ecdict-chinese-evidence.mjs` binds exact, minimum-two-character
  Chinese terms from ECDICT's translation field to the English anchors in the
  OpenHowNet deficit probe. OpenHowNet is candidate discovery only; exported
  evidence is attributed solely to ECDICT.
- ECDICT added `239` lexical evidence rows and raised the same-code strict pool
  from `3,016` to `3,098`. Adding the candidate-bound, bidirectionally unique
  Japanese WordNet subset raised it to `3,105`, a total net gain of `89` with
  no relaxed quality gate.
- A fresh 20-row OpenHowNet dual-model diagnostic was structurally clean:
  Qwen approved `5/20`, Gemma approved `11/20`, and strict consensus accepted
  `5/20`. The downloaded OpenHowNet archive still lacks a separately verified
  data license, so these reviews remain diagnostic and must not be exported as
  production evidence.
- The reproducible expanded artifacts are
  `.tmp/combined/v90-production5000-ecdict-zh-japanese-wordnet-biunique-evidence.db`,
  `logs/product-coverage-gaps-v90-production5000-expanded-strict-prefilter.json`,
  and its matching `-evidence.json` report. The pool is still `1,895` short of
  5,000, so production generation remains blocked on evidence supply rather
  than GPU capacity.

### 2026-08-11 full ECDICT Chinese extraction gate

- `export-ecdict-chinese-evidence.mjs --validation-report` now extracts
  conservative 2-12 character Chinese segments for every English anchor in the
  current validation report. It removes POS and domain labels, but extracted
  terms still require the unchanged reverse-dictionary and independent-family
  checks before selection.
- The full scan covered `19,684` distinct anchors, matched `10,215` candidates,
  and exported `19,720` ECDICT evidence rows. Combining it with the safe
  Japanese WordNet subset raised the current-code strict pool from `3,016` to
  `3,420`, a net gain of `404` candidates (`215` entry-unique).
- An unfiltered entry-unique 20-row review reached only `14/20` dual consensus.
  Real ambiguous cases included `abstenção`, `harmônico`, and `rotatividade`.
  Do not review or generate from the unfiltered 404-row delta.
- The reusable low-risk filter requires the zh generation hint to include the
  `ecdict` family and requires exactly one bound English term and one bound
  Chinese term. It retains `165` entry-unique candidates.
- Compact whole-object prompts produced malformed or evidence-incomplete JSON.
  The optional OpenAI-compatible `response_format=json_object` did not fix the
  problem and caused one 120-second timeout on this Unsloth backend. Keep it
  disabled by default.
- `nano-per-language` produced valid JSON for `20/20` Qwen and `20/20` Gemma
  reviews. Qwen approved `20/20`, Gemma approved `19/20`, and strict dual-model
  consensus accepted `19/20` (95%). This clears the bounded source-review gate
  for the remaining low-risk ECDICT subset, not for the full 404-row delta.
- Key reports are
  `logs/product-coverage-gaps-v90-production5000-ecdict-extracted-low-risk-entry-unique.json`
  and `logs/product-source-gap-v90-production5000-ecdict-low-risk20-consensus.json`.
  No draft, product DB, D1, or Worker write occurred.

### 2026-08-11 ECDICT low-risk generation and isolated promotion

- Reviewing the remaining low-risk cohort produced `144/165` strict Qwen/Gemma
  source-review accepts. Qwen generation wrote `135/144` valid drafts to the
  isolated `.tmp/validation/linguago-v90-ecdict144.db`; production v90 was not
  modified.
- Deterministic reverse evidence supported `132/135` valid drafts. Independent
  Gemma no-correction review accepted `120/132`, rejected 5, and left 7 as
  manual residual because their responses omitted decision/confidence fields.
- Do not use `nano` with 20-character definition snippets: Gemma correctly
  rejects them as truncated. The reviewer now sends up to 220 characters plus
  term and pronunciation, and normalizes both compact and full A/R/M decision
  forms.
- On the 155 llama.cpp backend, concurrency 2 can leave requests queued after
  the client stops. Use concurrency 1. If this happens, POST `/v1/unload`, wait
  for an empty status, reload the exact model/variant, and resume the report.
- Promotion dry-run and apply selected exactly 120 rows. The isolated fast
  audit passed with `publishable_senses=35596`; published-risk remained
  `flagged_senses=0`, and localization counts, sense order, orphan, mojibake,
  and HTML checks were all zero.
- Primary reports end in `dual-approved144-generation-full.json`,
  `dual-approved144-reverse-evidence.json`, `final-gemma-v2.json`, and
  `dual-approved144-promote-apply.json`. This is an isolated qualification,
  not a D1 or Worker release.

### 2026-08-11 v91 ECDICT 120 production release

- The 135 validated generation outputs were deterministically replayed into the
  main product DB as drafts. Reverse evidence plus final Gemma consensus then
  promoted exactly 120; 15 remain non-publishable residuals.
- The pre-write DB backup is
  `backups/linguago-v90-before-ecdict120-promote-20260811-170001.db`, SHA-256
  `6C40303FAEA55A3CBE00CD45430A314B3EADB813093149B1C28593F099EEAA77`.
- The v91 native package is
  `outputs/d1-v2-product-native-export-v91-ecdict120`. Full memory import and
  remote count verification passed at `entries=30032`, `senses=35596`,
  `sense_localizations=142384`, `examples=3030`, and
  `example_localizations=11898`. D1 `published_at` is
  `2026-08-11T08:02:52.212Z`.
- Wrangler remote export failed with OAuth error 10000. The exact current v90
  rollback package `outputs/d1-v2-product-native-export-v90-openhownet-main`
  was therefore re-audited against the pre-release online counts and passed a
  full memory import. Its manifest SHA-256 is
  `A53DFF2018A962149076253F893DF4EB5F332CFFE63919EA934B89BFF0310FEA`.
- Worker cache is `v91-ecdict120-30032`; deployed Worker Version ID is
  `999818a7-cd16-464c-8b7a-e8048f439b28`.
- Complete online regression, focused API, and mobile/desktop Edge rendering
  passed. `comercialização` resolves through D1 with four-language data and
  IPA, and no tested viewport has horizontal overflow.

### 2026-08-11 v92 pressure cohort production release

- Replayed the previously isolated v90 pressure-2,000 qualification cohort on
  a fresh v91 clone. Current validators accepted 1,610/1,619 rows; nine rows
  were rejected for Japanese reading mismatches and were not written.
- Legacy controlled reports store consensus provenance in top-level
  `selection_policy`, while newer reports may store it per candidate. Replay
  accepts the legacy form only when the report requires independent
  no-correction consensus, disables automatic promotion, and every candidate
  still matches an accepted `source_entry_id + source_sense_id` in the named
  Gemma consensus report.
- Promotion dry-run accepted 1,610/1,610. Duplicate triage then found 48 exact
  same-reading four-language duplicate pairs entirely inside this checkpoint.
  Their source links were merged and duplicate senses removed. Eight otherwise
  exact pairs with reading differences were deliberately retained.
- Net production increase is 1,007 entries, 1,562 senses, and 6,248 sense
  localizations. Final D1 counts are `entries=31039`, `senses=37158`,
  `sense_localizations=148632`, `examples=3030`, and
  `example_localizations=11898`.
- Fast audit, published-risk, native export, full in-memory import, remote D1
  count verification, online API regression, focused API, and mobile/desktop
  render checks all passed. Blocking counters remain zero and
  `flagged_senses=0`. Duplicate localization warnings are 381; the retained
  cases are reading-distinct, manual-review, or likely-keep.
- Pre-release backup is
  `backups/linguago-v91-before-pressure1562-20260811-173518.db`, SHA-256
  `01E073923BF9E12E49E82449B72CD8A364CE662C62DE63D224D36FB86CEEC30C`.
  The post-release product DB SHA-256 is
  `34E57DA3CD2FC403DC1211BA694D99D958E9777074D739033D91D160AB0E1ABC`.
- Native package is `outputs/d1-v2-product-native-export-v92-pressure1562`;
  manifest SHA-256 is
  `152B176163DC1D008F19FB78D726DA0B0B69E2F22892BE195B152BC27C9059B9`.
  D1 `published_at=2026-08-11T08:35:33.797Z`.
- Worker cache is `v92-pressure1562-31039`; deployed Worker Version ID is
  `24626b8f-5f31-4a01-ab42-c3c9709b699a`.

### 2026-08-11 v93 strict fresh-candidate production release

- Rebuilt the v92 coverage-gap pool under the frozen independent-family policy.
  Of 1,692 strict rows, the historical-attempt index left 197 genuinely fresh
  rows and 158 unique-entry candidates after the 20-row gate.
- Qwen source review, independent Gemma review, deterministic four-language
  reverse evidence, and Gemma no-correction review produced 115 publishable
  senses. Three rows were deliberately excluded: `ampicilina` and `perfídia`
  failed semantic validation, while a second `liberalismo` sense overlapped an
  earlier accepted sense.
- Replay into the main DB promoted 14/14 gate rows and 101/101 remaining rows.
  The promote validator must receive the dual-approved source report as
  `--report`; passing the controlled generation report loses the original
  source gloss and causes false generic-gloss semantic-drift failures.
- The pre-write backup is
  `backups/linguago-v92-before-strict-fresh115-20260811-211837.db`; its SHA-256
  matches the pre-write product DB.
- The production native package is
  `outputs/d1-v2-product-native-export-v93-strict-fresh115`. Full memory import
  passed at `entries=31056`, `senses=37273`,
  `sense_localizations=149092`, `examples=3030`, and
  `example_localizations=11898`; all blocking counters and published-risk are
  zero. Duplicate-localization warnings are 384 and remain non-blocking.
- D1 `published_at=2026-08-11T12:22:19.638Z`. Worker cache is
  `v93-strict-fresh115-31056`; deployed Worker Version ID is
  `5161673d-b817-4b1e-82b1-484d676c2974`. Online focused API and mobile/desktop
  render checks passed with no horizontal overflow.
- Gemma `nano` final-review prompts can omit `decision` even with a larger token
  limit. Retry only those rows once with `prompt-mode=full`; do not interpret a
  truncated response as acceptance.

### 2026-08-11 post-v93 strict residual batch (local only)

- Re-aligning the v93 product DB reduced the strict pool from 1,692 to 1,579.
  After rebuilding the historical-attempt index, only 39 fresh unique-entry
  rows remained: 36 pt-BR and 3 ja.
- Four-node Qwen source review approved 30/39 at confidence 0.9. Independent
  Gemma review approved 14, and dual adjudication retained those 14.
- Generation skipped four rows already represented by complete source-gap
  drafts. Of the ten new generations, nine passed structure and all nine passed
  deterministic reverse evidence in every language. Final Gemma no-correction
  review accepted eight and rejected `internacionalismo`.
- The exact final8 replay and checkpoint-scoped promote passed 8/8 in an
  isolated v93 clone and again in the main local DB. Fast audit and
  published-risk pass at `publishable_senses=37281` and `flagged_senses=0`.
- Backup before the local write is
  `backups/linguago-v93-before-strict-fresh8-20260811-222229.db`. This batch is
  intentionally not deployed by itself; production remains v93 with 37,273
  senses until more audited rows are accumulated.
