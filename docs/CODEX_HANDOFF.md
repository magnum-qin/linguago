# Codex Handoff

Read this before making changes.

## Current Production Release

Cloudflare production is dictionary v83, deployed on 2026-08-02:

- Worker version: `1d5dd96d-f524-4e54-8816-25237302af22`
- Worker cache: `v83-production-chunk05-29087`
- D1 `published_at`: `2026-08-02T11:10:10.971Z`
- Counts: `entries=29087`, `senses=34604`, `sense_localizations=138416`,
  `examples=3030`, `example_localizations=11898`
- Audited export: `outputs/d1-v2-product-native-export-v83-production-chunk05-complete-validation`
- Pre-release D1 backup: `backups/linguago-dictionary-before-v83-production-chunk05-20260802-201814.sql`
- Backup SHA256: `CC16C61817B06218105190FF91A585B44066C553D04F0CC9AED13D643A9D03E4`

Post-release health, full API regression, focused API checks, and mobile/desktop
render checks passed. The render check retries the first submission once because
the initial Service Worker/Vue activation can consume the first automated click.

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

Supported providers are `auto`, `openrouter`, `dashscope`, `gemini`, and `deepseek`.

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
