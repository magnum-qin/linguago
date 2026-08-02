# LinguaGo Project Overview For AI

This is the high-signal briefing for AI coding agents working in this repository.

## One-Sentence Summary

LinguaGo is a Cloudflare-hosted Vue PWA for multilingual translation and dictionary lookup, with dictionary-first word lookup, provider/model switching, KV caching, and structured streaming translation.

## Current Architecture

- Frontend: Vue 3 + Vuetify + Tailwind CSS built by Vite.
- Frontend entry: `index.html` -> `src/main.ts` -> `src/App.vue`.
- Backend: Cloudflare Worker in `worker/index.ts`.
- Static hosting: Workers Assets from `dist/`.
- Cache/settings/rate limits: Cloudflare KV binding `CACHE`.
- Dictionary: Cloudflare D1 binding `DB` is the production source of truth; optional Louis SQLite API support remains behind `DICTIONARY_API_URL` and `DICTIONARY_API_TOKEN`.
- Dictionary-generation LLM runtime: Unsloth Studio OpenAI-compatible API on the GPU cluster, replacing the older Ollama workflow.
- Deployment: Wrangler via `npm run deploy`.

Current production dictionary baseline is v83 D1 v2, deployed on 2026-08-02
with Worker version `1d5dd96d-f524-4e54-8816-25237302af22`, cache version
`v83-production-chunk05-29087`, and export counts
`entries=29087`, `senses=34604`, `sense_localizations=138416`,
`examples=3030`, and `example_localizations=11898`.

The release came from
`outputs/d1-v2-product-native-export-v83-production-chunk05-complete-validation`.
Its D1 `published_at` value is `2026-08-02T11:10:10.971Z`. The rollback SQL is
`backups/linguago-dictionary-before-v83-production-chunk05-20260802-201814.sql`
with SHA256
`CC16C61817B06218105190FF91A585B44066C553D04F0CC9AED13D643A9D03E4`.

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
  provider: 'dictionary' | 'deepseek' | 'gemini' | 'dashscope' | 'openrouter';
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
