# Dictionary Pipeline

This pipeline builds a fast four-language word dictionary for the translation PWA.

## v107 5,000-candidate production result (2026-08-17)

The frozen entrypoint completed a fresh 5,000-candidate no-write run: `5,000
input -> 3,790 source approvals -> 3,374 valid generations -> 1,131
reverse-supported -> 1,020 final Gemma accepts`. Controlled replay removed five
proper-like rows, promoted 968, and kept 43 term/gloss mismatches plus four
unmatched rows unpublished.

The 968 rows passed isolated replay, promotion, fast audit, published-risk,
native export, and full in-memory import before exact main-DB replay. The local
publishable package has 36,062 entries, 42,372 senses, and 169,488
localizations. Deployment waits until audited increments total at least 5,000
publishable senses.

## v106 post-release audit and frozen profile

The complete v106 increment audit found 13 deterministic repairs among 732
promoted senses: 12 Cyrillic-`є` IPA transcription errors and one Taiwan-form
Chinese localization. The replayable corrections are stored in
`config/dictionary-overrides/v106-quality-repairs.json`. Residual unpublished
rows are classified in `config/dictionary-overrides/v106-residual-dispositions.json`.

Run future scale batches through `config/dictionary-v2-production-v106.json`
and `scripts/run-dictionary-v2-production-profile.mjs`. The wrapper has a
`--print-command true` validation mode and otherwise delegates to the existing
checkpointed remote pipeline. The model run remains no-write; controlled
replay, isolated validation, promotion, export audit, D1 backup, and deployment
are separate mandatory stages.

## v106 5,000-candidate production result (2026-08-17)

The deployed v106 increment contains 732 newly promoted senses. Production
counts are `entries=35094`, `senses=41404`,
`sense_localizations=165616`, `examples=3030`, and
`example_localizations=11898`; cache is `v106-production732-35094`.

The final qualified sequence was:

1. v105 pressure qualification: `2,000` input, `1,555` source-approved,
   `1,415` valid generations, `296` reverse-supported, `257` final Gemma
   accepts, and `254` promoted.
2. v106 production: `5,000` input, `3,604` Gemma source approvals, `3,077`
   valid Qwen generations, `950` reverse-supported, and `827` final Gemma
   accepts, with no model/network infrastructure failures.
3. Controlled replay: exclude 23 deterministic Latin proper-name, brand,
   geography, or astronomical records; replay 804, insert 767 drafts, and
   promote 732. Rejected/skipped rows remain outside publication.
4. Export/import: full native D1 audit passed with 21 chunks and all blocking
   counters at zero. The duplicate-localization warning remains non-blocking.

Operational rules learned from this run:

- Final Gemma review uses `--only-supported true`. Do not substitute
  `--include-supported true`, which includes unsupported generated records.
- Proper-name filtering is deterministic and limited to Latin `en`/`pt-BR`
  source rows with direct definition/POS evidence; broad token heuristics cause
  false positives.
- Model acceptance is only an input to controlled replay. Replay and promotion
  validators remain mandatory publication gates.
- Store large reports, checkpoints, DB copies, backups, and exports under
  `%TEMP%` on C. D is space constrained.
- Absolute export directories are supported by
  `push-dictionary-v2-native-to-d1.ps1`; resolve them before joining filenames.

## v100 semantic-evidence result (2026-08-17)

The deployed v100 increment contains 29 new entries/senses. Production counts
are `entries=33606`, `senses=39916`, and
`sense_localizations=159664`; cache is `v100-semantic29-33606`.

For this release, ECDICT and EJDict were exported again against all 6,409 daily
candidates and merged into `.tmp/combined/v99-daily-evidence-v9.db`. The strict
selector found 152 supported rows, but only 56 were fresh after current-product
and attempt exclusions. The semantic selector retained the same independent
family and reverse-evidence requirements and exposed 85 fresh rows whose main
uncertainty was lexical alignment rather than missing evidence.

The full no-write funnel was `85 input -> 71 Qwen source approvals -> 56 dual
source consensus -> 47 source reverse-supported -> 35 semantic previews -> 33
generation-ready/valid/reverse-supported -> 29 final Gemma accepts`. The 29
records then passed isolated replay and idempotency, promote dry-run/apply,
fast and published-risk audits, main replay, native export, and full in-memory
import. Remote D1 counts and mobile/desktop rendering match the manifest.

Operational conclusion: the generation and review pipeline is healthy, but
the next 500/2,000/5,000 stages are evidence-capacity limited. Reclassifying
existing evidence families without new source rows does not solve this. Add
independent lexical coverage, bind it to exact candidate entry/sense IDs, audit
family provenance, then rebuild the fresh strict and semantic pools before
making more LLM calls.

## v99 strict daily-gap result (2026-08-17)

The deployed v99 increment contains 84 new entries/senses. Production counts
are `entries=33577`, `senses=39887`, and
`sense_localizations=159548`; cache is `v99-daily-strict84-33577`.

The latest daily pool had 6,409 apparently eligible rows, but only 137 had two
independent source families and complete target-language evidence. Fresh-entry
exclusion left 131; Qwen source review, Gemma source consensus, deterministic
reverse evidence, semantic preview, Qwen generation, and final Gemma review
accepted 84. All six endpoints participated without infrastructure failures.

Run strict evidence prefiltering before selecting a scale cohort. A raw
500-row attempt produced 20/20 immediate source-review rejections because the
rows lacked locked pt-BR and Japanese terms. Model throughput cannot repair
missing publication evidence. Keep the remaining 562 manual and 5,710
unsupported rows out of production until new independent evidence is ingested
or correctly bound.

Operational CLI details: language quotas use `lang=count`, not `lang:count`.
For a full D1 audit, generate the native export and its manifest before running
the import audit.

## v98 production result (2026-08-16)

The daily-first lane is deployed. Exactly 5,000 candidates were generated,
4,737 passed the structural contract, and 1,206 passed strict reverse evidence,
independent Gemma no-correction review, isolated replay, deterministic promote,
and all export audits. Production counts are `entries=33493`, `senses=39803`,
and `sense_localizations=159212`; cache is `v98-daily5000-33493`.

Keep the Chinese-script pre-promotion check enabled. It was added after `じゃが`
produced a Chinese definition containing Japanese kana. Online UI checks must
use `.custom-tab-btn` for the four language buttons and must fail, rather than
only report, missing expected text, provider mismatches, or horizontal overflow.

## Current Flow

1. Download public source dictionaries into `data/raw`.
2. Clean source dictionaries into `data/processed/candidate_terms.jsonl`.
3. Download public frequency lists into `data/raw/frequency`.
4. Intersect frequency lists with cleaned candidates and create `data/processed/generation_batch_frequency_400.txt`.
5. Generate structured entries with Ollama using `think:false`, JSON schema, strong prompts, validation, and retry.
6. Validate model output into accepted / needs-review JSONL before importing to the database.
7. Import accepted entries into a local SQLite database.

## Commands

```powershell
node scripts/download-dictionaries.mjs
node scripts/clean-dictionaries.mjs
node scripts/download-frequency-lists.mjs
node scripts/prepare-frequency-batch.mjs
node scripts/ollama-schema-test.mjs --terms-file data/processed/generation_batch_frequency_400.txt --limit 12 --word-only
node scripts/validate-generated-dictionary.mjs output/ollama-dictionary-test.jsonl
node scripts/import-generated-dictionary.mjs
node scripts/query-dictionary.mjs you
node scripts/run-dictionary-batch.mjs data/processed/generation_batch_frequency_400.txt first-400
$env:OLLAMA_HOST="http://100.93.53.98:11436"; node scripts/run-dictionary-batch.mjs data/processed/generation_batch_frequency_400.txt first-400
$env:DEEPSEEK_API_KEY="sk-..."; node scripts/deepseek-dictionary-test.mjs --terms-file data/processed/generation_batch_frequency_400.txt --limit 12 --word-only --out output/deepseek-v4-flash-test.jsonl --fail-out output/deepseek-v4-flash-test.failed.jsonl
```

## V2 Staging Commands

Create the v2 staging database:

```powershell
npm run dict:v2:init
```

Import open-source dictionary rows into the v2 source/staging tables:

```powershell
npm run dict:v2:import:sources -- --sources ecdict,kaikki-zh,cedict,jmdict,freedict-eng-por,freedict-por-eng
```

For a quick validation sample, use a small limit per source:

```powershell
npm run dict:v2:init -- --db data/processed/linguago_v2_sample.db --reset
npm run dict:v2:import:sources -- --db data/processed/linguago_v2_sample.db --sources ecdict,kaikki-zh,cedict,jmdict,freedict-eng-por,freedict-por-eng --limit 25
```

Build the independent Brazilian Portuguese pronunciation index after placing
the Kaikki Portuguese JSONL at `data/raw/kaikki_Portuguese.jsonl`:

```powershell
npm.cmd run dict:v2:build:pt-pronunciations
```

The index only admits IPA tagged for Brazil or a named Brazilian region. It is
used as deterministic pronunciation evidence by the source-gap supplement
runner and is not part of the committed repository.

These commands only populate `dictionary_sources`, `source_entries`, and `source_senses`. They do not create canonical `entries/senses/sense_localizations` yet.

Build a first-pass canonical dictionary from staging:

```powershell
npm run dict:v2:build:canonical -- --db data/processed/linguago_v2_sample.db
```

The first-pass builder is deliberately conservative: each source sense becomes one canonical sense with one `sense_localizations` row in the source language. It records missing-language `quality_issues` instead of trying to guess cross-language alignment. Later pipeline stages should merge equivalent senses across sources and use LLM jobs only for missing localizations.

The canonical builder also supports source-scoped incremental imports. Use this when adding new source dictionaries to an existing full database:

```powershell
npm run dict:v2:build:canonical -- --db data/processed/linguago_v2_full.db --sources freedict-eng-por,freedict-por-eng --reset-canonical false
```

For FreeDict bilingual sources, the source entry language remains the lookup language (`en` for `freedict-eng-por`, `pt-BR` for `freedict-por-eng`), while the TEI translation is imported as a target-language `sense_localization`. This adds Portuguese and English evidence without deleting the existing canonical build.

Merge exact duplicate senses within the same canonical entry:

```powershell
npm run dict:v2:merge:senses -- --db data/processed/linguago_v2_sample.db
```

This merge step is intentionally strict. It only merges senses under the same `entry_id` when normalized `gloss_key` text is exactly the same. It moves source links and examples to the kept sense, drops duplicate same-language localizations, and leaves near matches for a later semantic/LLM-assisted alignment stage.

Create queued LLM completion jobs for missing sense localizations:

```powershell
npm run dict:v2:create-llm-jobs -- --db data/processed/linguago_v2_sample.db --limit 20
```

This only writes rows to `llm_completion_jobs`; it does not call Ollama or any remote model. Each job targets one `sense_id + lang` and includes the known localizations and examples needed for a later model call.

Benchmark candidate Ollama models before choosing the bulk completion model:

```powershell
npm run dict:v2:benchmark:ollama -- --endpoint http://100.99.99.99:11436 --models translategemma:27b,gemma4:26b,qwen3.6:latest --fixture builtin --job-limit 3 --out data/processed/dictionary-v2-ollama-benchmark.json
```

The benchmark is read-only for the dictionary database. It prewarms each model by default, runs the same missing-localization tasks against each model, records warm latency, JSON validity, field completeness, and sample outputs. It can also read queued jobs from `llm_completion_jobs` by omitting `--fixture builtin` and passing `--db`.

Initial cold benchmark on the built-in 3-task sample ranked `gemma4:26b` first: 3/3 valid outputs, average 8.31 seconds, average score 10/10. `translategemma:27b` returned valid JSON but missed one Japanese reading and one Portuguese pronunciation. `qwen3.6:latest` timed out at 120 seconds on all three tasks because the first diagnostic showed a cold `load_duration` of about 109 seconds. This is a cold-start issue, not enough evidence that Qwen is lower quality. Use the prewarmed benchmark before choosing the bulk-completion model.

Run queued v2 localization jobs:

```powershell
npm run dict:v2:run-llm-jobs -- --db data/processed/linguago_v2_sample.db --endpoint http://100.99.99.99:11436 --model qwen3.6:latest --limit 50
```

The runner sends a target-language-specific JSON Schema to Ollama's `format` field and repeats the same strict schema in the prompt. The schema requires `reading` for `zh` and `ja`, and `pronunciation` for `en` and `pt-BR`; old queued jobs may contain a looser embedded schema, so the runner regenerates the strict schema at call time instead of trusting `input_json.expected_output_schema`.

For larger pilots, create balanced jobs per target language and run the ports independently:

```powershell
npm run dict:v2:create-llm-jobs -- --db data/processed/linguago_v2_pilot.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs en --limit 250
npm run dict:v2:create-llm-jobs -- --db data/processed/linguago_v2_pilot.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs zh --limit 250
npm run dict:v2:create-llm-jobs -- --db data/processed/linguago_v2_pilot.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs ja --limit 250
npm run dict:v2:create-llm-jobs -- --db data/processed/linguago_v2_pilot.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs pt-BR --limit 250

npm run dict:v2:run-llm-jobs -- --db data/processed/linguago_v2_pilot.db --endpoint http://100.99.99.99:11435 --model qwen3.6:latest --target-langs en --limit 250
npm run dict:v2:run-llm-jobs -- --db data/processed/linguago_v2_pilot.db --endpoint http://100.99.99.99:11436 --model qwen3.6:latest --target-langs zh --limit 250
npm run dict:v2:run-llm-jobs -- --db data/processed/linguago_v2_pilot.db --endpoint http://100.99.99.99:11437 --model qwen3.6:latest --target-langs ja --limit 250
npm run dict:v2:run-llm-jobs -- --db data/processed/linguago_v2_pilot.db --endpoint http://100.99.99.99:11438 --model qwen3.6:latest --target-langs pt-BR --limit 250
```

Audit generated rows:

```powershell
npm run dict:v2:audit -- --db data/processed/linguago_v2_pilot.db --limit 2000
```

Query the v2 structure for one term:

```powershell
npm run dict:v2:query -- 安心 data/processed/linguago_v2_pilot.db
```

The 1k pilot accepted 1100 Qwen-generated localizations with no syntax/schema audit issues. However, source-imported Chinese localizations from `kaikki-zh` can still contain English definitions because the importer currently uses English glosses as the source-language definition. Fix source-localization semantics before any unattended full-database completion.

Source-localization semantics have been tightened in the canonical builder: a source `sense_localization` is only created when the source gloss appears to be written in that same language. English glosses from `kaikki-zh`, `JMdict`, or CC-CEDICT remain as `gloss_key` evidence, but they are no longer written into `zh` or `ja` definitions. Those rows now produce `missing_<lang>_localization` plus `source_definition_not_localized` quality issues and should be completed by the LLM runner with the strict target-language schema.

## Current Full V2 Build

The current full database is:

```text
data/processed/linguago_v2_full.db
```

Full-source import counts:

- `ecdict`: 770,611 source entries / 770,611 source senses.
- `kaikki-zh`: 321,277 source entries / 383,856 source senses.
- `cc-cedict`: 122,496 source entries / 197,122 source senses.
- `jmdict`: 217,352 source entries / 251,486 source senses.
- `freedict-eng-por`: 15,773 source entries / 19,092 source senses.
- `freedict-por-eng`: 10,661 source entries / 12,792 source senses.

FreeDict is now available in the source/staging layer for English-Portuguese and Portuguese-English evidence. It is not automatically reflected in the product D1 export until the product fusion stage is rebuilt or extended to use these source links.

After the incremental canonical FreeDict import:

- `entries`: 1,339,417.
- `senses`: 1,617,729.
- `sense_localizations`: 374,777.
- `freedict-eng-por`: 19,092 canonical English-source senses with Portuguese localizations.
- `freedict-por-eng`: 12,792 canonical Portuguese-source senses with English localizations.

After canonical build and strict duplicate-sense merge plus the current accepted completion batches:

- `entries`: 1,328,115.
- `senses`: 1,585,845.
- `sense_localizations`: 316,490.

Frequency ranking is stored in `entries.frequency_rank` by:

```powershell
npm run dict:v2:rank:frequency -- --db data/processed/linguago_v2_full.db
```

Current frequency matches:

- `en`: 46,320 ranked entries.
- `zh`: 35,545 ranked entries.
- `ja`: 22,668 ranked entries.
- `pt-BR`: 6,619 ranked entries after importing `freedict-por-eng` and rerunning frequency ranking.

A top-1000 product rebuild smoke test with FreeDict evidence produced 881 Portuguese source links across 740 product senses, and 2,477 fully localized product senses. Treat this as fusion evidence, not as a release artifact: high-frequency function words still need review because bilingual FreeDict glosses can over-group broad words like `it`, `of`, `on`, and `por`.

For a read-only report on a product candidate database:

```powershell
npm run dict:v2:report:product-candidate -- --db data/processed/linguago_v2_product_top5000_freedict_candidate.db --out data/processed/product-candidate-freedict-report.json
```

Current top-5000 FreeDict candidate report:

- `product_entries`: 18,209.
- `product_senses`: 18,209.
- `fully_localized_senses`: 2,478.
- `freedict_localizations`: 4,535.
- `freedict_localization_senses`: 3,798.
- `pt_source_linked_senses`: 2,272.
- Risk counters: 263 high-source-count senses, 330 short-gloss senses, 71 FreeDict short-gloss senses.

Do not promote this candidate directly to D1 until high-risk short gloss/function-word groups have been reviewed or filtered.

The product pilot builder now filters risky FreeDict short gloss rows before grouping. The filtered top-5000 candidate keeps the same four-language coverage while removing the FreeDict short-gloss risk:

- `skipped_risky_freedict`: 224 source rows.
- `product_senses`: 18,181, down 28 from the unfiltered candidate.
- `fully_localized_senses`: 2,478, unchanged.
- `freedict_localizations`: 4,408, down 127.
- `freedict_localization_senses`: 3,703, down 95.
- `pt_source_linked_senses`: 2,120, down 152.
- Risk delta: high-source-count senses 263 -> 242, broad short-gloss senses 330 -> 263, FreeDict short-gloss senses 71 -> 0.

## Product-Layer Fusion Pilot

The full v2 database is a source/staging pool, not the final product dictionary. Do not run unattended LLM completion against all 1.3M source entries. Build a smaller product-layer pilot first, then use LLM only to judge/complete the fused product senses.

Create a top-5000 frequency pilot:

```powershell
npm run dict:v2:build:product-pilot -- --db data/processed/linguago_v2_full.db --out data/processed/linguago_v2_product_top5000_pilot.db --max-rank 5000 --max-senses-per-entry 3
```

This writes ignored local artifacts:

- `data/processed/linguago_v2_product_top5000_pilot.db`
- `data/processed/linguago_v2_product_top5000_pilot.summary.json`

The pilot schema creates product-facing tables:

- `product_entries`
- `product_senses`
- `product_sense_source_links`
- `product_localizations`
- `product_examples`
- `product_example_localizations`

The first pass is deliberately rule-based. It groups source senses by English headword, direct gloss-to-English-headword matches, normalized gloss text, and source-headword fallback. This is not the final semantic merge; it is a cheap compression layer that gives the LLM a smaller and better-scoped target.

Use the summary JSON to inspect compression before creating any new LLM jobs. The next stage should sample product groups with multiple source links, verify whether they represent the same sense, and only then generate missing four-language localizations.

Review product fusion candidates with the selected Ollama model:

```powershell
npm run dict:v2:review:product-fusion -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --endpoint http://100.99.99.99:11441 --model qwen3.6:latest --limit 100
```

This creates `product_fusion_reviews` in the pilot database and writes:

- `decision = keep`: the source links can remain under one product sense.
- `decision = split`: the group mixes distinct meanings and should be split before completion.
- `decision = needs_review`: evidence is too broad or ambiguous.

The review step does not mutate `product_entries`, `product_senses`, or source links. It only stores model judgments, confidence, rationale, and suggested source-link groups. Apply split/keep decisions in a later deterministic step after sampling the review output.

Before spending model time on a new candidate build, extract the high-risk review queue without calling Ollama:

```powershell
npm run dict:v2:review:product-fusion -- --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db --candidate-filter high-risk --risk-source-count 6 --max-short-gloss-length 3 --limit 40 --select-only true
```

This writes `*.fusion-review-candidates.json` next to the database. `candidate-filter=high-risk` selects groups with many source links or very short gloss keys, which catches the remaining broad/function-word fusion risks after the FreeDict short-gloss filter. Use `candidate-filter=short-gloss` to inspect only short-gloss groups, or the default `source-count` mode for the older source-count-only queue.

Apply accepted review decisions safely:

```powershell
npm run dict:v2:apply:product-fusion-reviews -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --model qwen3.6:latest --keep-threshold 0.8 --split-threshold 0.8
```

The apply step is intentionally conservative:

- `accepted + keep + confidence >= keep-threshold` sets `product_senses.status = ready_for_llm`.
- `accepted + split + confidence >= split-threshold` sets the sense/entry to `needs_review` and writes `product_fusion_split_plans`.
- `accepted + needs_review` marks the sense/entry as `needs_review`.
- It does not split senses or delete source links. Splits should be sampled and applied later with a deterministic splitter.

Inspect pending split plans before mutating the product tables. A valid split plan must contain structured `source_link_ids` groups that fully cover the current source links for that product sense. The deterministic splitter does not infer meaning from prose rationale; it only applies these checked source-link groups.

Dry run the splitter first:

```powershell
npm run dict:v2:apply:product-split-plans -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --confidence-threshold 0.8 --dry-run true
```

Then back up the pilot database and apply:

```powershell
npm run dict:v2:apply:product-split-plans -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --confidence-threshold 0.8
```

The splitter keeps the first group on the original `product_senses.id`, creates one new product sense for each additional group, moves `product_sense_source_links`, renumbers entry senses to `1..n`, and marks applied plans as `applied`. By default it also clears generated `product_localizations` and `product_examples` for the split senses, because those rows were selected from the pre-split fused group and may no longer belong to the correct meaning. The later LLM completion step should generate fresh four-language terms, readings/pronunciations, definitions, and examples for each split sense.

Create product-layer LLM completion jobs after split plans are applied:

```powershell
npm run dict:v2:create:product-llm-jobs -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --model qwen3.6:latest --limit 200
```

The product localization runner has deterministic quality gates beyond JSON schema validation. A split sense with a generic gloss such as `Group for ...` or `split group` stays `needs_review`, because that label is not enough evidence for automatic four-language localization. For single-source split senses, the sole `source_word` is the sense anchor; if the target language is the same as that source language, the generated `term` must exactly match it. Short Portuguese terms also get a basic pronunciation/term mismatch check so an obviously unrelated pronunciation is rejected before publication.

If a product sense already has all four localizations but one localization is still marked `needs_review = 1`, create repair jobs for those existing rows instead of missing-language jobs:

```powershell
npm run dict:v2:create:product-llm-jobs -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --model qwen3.6:latest --target-langs en --repair-needs-review true
```

This mode is useful for old source-imported rows such as English `ecdict` localizations that block publishing even though the sense is otherwise four-language complete. Accepted repair jobs update the existing localization row, clear `needs_review`, and allow the sense/entry to become `accepted`.

To repair only publishable complete `needs_review` senses, add explicit source-status and completeness filters:

```powershell
npm run dict:v2:create:product-llm-jobs -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --model qwen3.6:latest --target-langs en --repair-needs-review true --source-statuses needs_review --complete-only true
```

Use this before broader incomplete-sense repair, because it converts already-complete four-language entries into publishable entries without generating missing-language jobs.

For incomplete `needs_review` senses that do not have any localization row currently marked `needs_review`, create missing-language jobs with the review-localization exclusion filter:

```powershell
npm run dict:v2:create:product-llm-jobs -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --model qwen3.6:latest --source-statuses needs_review --exclude-review-localizations true
```

This is the safest next expansion batch after complete-sense repair: it avoids senses that still require fixing a bad localization, and only fills languages that are absent.

Run a small real batch before scaling:

```powershell
npm run dict:v2:run:product-llm-jobs -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --endpoint http://100.99.99.99:11441 --model qwen3.6:latest --limit 20
```

When running through the Tailscale jump-host portproxy, prefer streaming responses for longer product prompts:

```powershell
npm run dict:v2:run:product-llm-jobs -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --endpoint http://100.99.99.99:11448 --model qwen3.6:latest --limit 20 --stream true
```

The streaming mode reads Ollama's NDJSON chunks and avoids idle HTTP connections being reset before a long non-streaming response returns its first byte. This is especially useful for `qwen3.6:latest` product-localization jobs through `100.99.99.99`.

Product completion uses `product_llm_completion_jobs`, not the canonical `llm_completion_jobs` table. Accepted jobs write to `product_localizations` and `product_example_localizations`. When a product sense reaches four localizations, the runner marks it `accepted`; when every sense under an entry is accepted, the entry is marked `accepted`.

Merge duplicate product entries after split/application batches:

```powershell
npm run dict:v2:merge:product-entries -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --dry-run true
npm run dict:v2:merge:product-entries -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db
```

This deterministic merge only combines entries with the same `normalized_key` and the same `primary_lang`. It moves all product senses under the best-ranked keeper entry, renumbers `sense_order` to `1..n`, updates review/split-plan entry references, refreshes entry status/counts, and deletes the duplicate entry rows. It does not merge senses or cross language boundaries.

Run the conservative product sense deduper after entry merge:

```powershell
npm run dict:v2:merge:product-senses -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --dry-run true
npm run dict:v2:merge:product-senses -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db
```

This step only merges rule-obvious duplicates inside the same product entry: exact normalized `gloss_key` duplicates, or identical four-language term signatures with overlapping source words. It moves non-duplicate source links, localizations, examples, and product LLM jobs to the keeper sense, deletes conflicting duplicates, renumbers `sense_order`, and refreshes entry status. It deliberately does not attempt broad semantic dedupe; ambiguous near-duplicates should be reviewed by a model or by sampling.

Flag source/headword mismatches before export:

```powershell
npm run dict:v2:flag:product-source-mismatches -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --dry-run true
npm run dict:v2:flag:product-source-mismatches -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --apply true
```

This deterministic cleaner catches product senses where a one-character Chinese product entry was created from a different one-character Chinese source word, for example entry `單` with source word `簡`. These rows are too risky for automatic publishing because the UI would show a dictionary sense for a different character under the queried headword. The cleaner marks the affected product sense, localizations, examples, and accepted LLM jobs as `needs_review`; it does not delete data.

After sampling the mismatch report, relocate single-source-word mismatches into the correct product entry:

```powershell
npm run dict:v2:relocate:product-source-mismatches -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --dry-run true
npm run dict:v2:relocate:product-source-mismatches -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --apply true
```

The relocator moves each affected `product_senses` row from the incorrect one-character Chinese entry to the entry matching its Chinese `source_word`, creating that target entry when needed. By default it deletes old generated localizations and product LLM jobs for the moved sense, keeps source examples, clears old example translations, renumbers source and target entries, and leaves the moved sense as `ready_for_llm`. Run `dict:v2:create:product-llm-jobs` again afterwards so the prompt is regenerated with the corrected headword/source context.

For split-pilot cleanup, the relocator can also be scoped to multilingual single-source ready rows:

```powershell
npm run dict:v2:relocate:product-source-mismatches -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --dry-run true --langs zh,ja,en,pt-BR --max-headword-length 0 --max-source-word-length 0 --single-source-only true --source-statuses ready_for_llm
```

Use this only after split plans have been sampled: it moves one-source senses whose entry headword no longer matches their sole same-language source word. Keep `clear-generated-content` enabled for `ready_for_llm` rows so stale queued jobs are deleted and regenerated. For already accepted rows, use `--source-statuses accepted --clear-generated-content false` only after spot-checking, so accepted four-language localizations can move with the corrected product entry.

For the smaller set of one-character Chinese mismatch senses that contain multiple distinct Chinese `source_word` values, split the mixed sense first:

```powershell
npm run dict:v2:split:product-multi-source-mismatches -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --dry-run true
npm run dict:v2:split:product-multi-source-mismatches -- --db data/processed/linguago_v2_product_top5000_fused_only_pilot.db --apply true
```

This splitter groups the current source links by `source_word`, moves the original sense to the first target entry, creates a new product sense for each additional source-word group, clears old generated localizations/examples/jobs, renumbers touched entries, and leaves all split senses as `ready_for_llm`. Create and run product LLM jobs again after this step.

Clean duplicate product examples before export:

```powershell
npm run dict:v2:clean:product-examples -- --dry-run true
npm run dict:v2:clean:product-examples
```

This example cleaner is intentionally conservative. It only deduplicates Chinese-source examples under the same product sense when the accepted English example text and Chinese reading match, then keeps the row with fewer traditional-Chinese characters. This preserves the simplified Chinese example as the published version and removes the paired traditional duplicate.

Repair deterministic product quality warnings before export:

```powershell
npm run dict:v2:repair:product-quality-warnings -- --dry-run true
npm run dict:v2:repair:product-quality-warnings
```

This narrow repair step fixes known product-layer quality warnings that are better handled deterministically than by another LLM pass: Japanese particles copied into Chinese `term` fields, Japanese source terms left inside Chinese definitions, and English function-word terms left as plain Latin text in Japanese localizations. It updates only the explicitly mapped `product_sense_id + lang` rows and writes `source = manual:deterministic-quality-repair`.

Export the cleaned product pilot to the Worker-native `v2_*` D1 shape:

```powershell
npm run dict:v2:export:product-d1-native
npm run dict:v2:audit:product-export
```

This exporter reads `product_*` tables and writes `outputs/d1-v2-product-native-export`. It publishes `v2_entries`, `v2_entry_forms`, `v2_pronunciation_groups`, `v2_senses`, `v2_sense_localizations`, `v2_examples`, and `v2_example_localizations` for the Worker. It only includes product senses that are `accepted` and have complete four-language localizations with `needs_review = 0`.

`v2_pronunciation_groups` is the publish-time bridge for polyphonic headwords. Each accepted sense can point to one pronunciation group through `v2_senses.pronunciation_group_id`; the current product exporter derives the group from the accepted source-language localization reading or pronunciation, normalizes tone-marked pinyin into a searchable `reading_key`, and adds both the written form and source-language reading form to `v2_entry_forms`. Localized translated terms remain searchable, but non-source-language readings are not exported as lookup forms because they pollute reading search, for example Chinese pinyin matching a Japanese source entry. This lets one visible source entry group meanings by readings such as `zhong1` and `zhong4` instead of flattening all senses under the same character.

The export audit imports the generated SQL into `outputs/d1-v2-product-native-export/audit-import.db`, then writes `audit.json` and `audit-samples.json`. It is a publish gate for structural problems: manifest/count mismatches, missing four-language sense localizations, duplicate published sense order, empty required fields, orphan rows including broken pronunciation-group links, lookup pollution from non-source-language reading forms, invalid part-of-speech values, source-language/headword script mismatches, duplicate simplified/traditional Chinese examples, and failed key sample lookups. It also records non-blocking product quality warnings such as duplicate same-entry sense localizations, Chinese terms containing kana, or Japanese terms that are still pure Latin text; review those warnings before expanding the batch, but they do not block a structurally valid D1 push.

For a normal product D1 release, use the combined release command instead of running each publish step manually:

```powershell
npm run dict:v2:release:product-d1
```

This runs product example dedupe, deterministic quality-warning repair, product-native D1 export, product export audit, TypeScript check, Cloudflare D1 push, and online UI smoke in sequence. Use the script directly with `-SkipPush` when you want a local release rehearsal without touching remote D1:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release-dictionary-v2-product-d1.ps1 -SkipPush
```

After any D1 or Worker release, run the online dictionary regression separately:

```powershell
npm run check:online-dictionary
```

This checks `/health` D1 counts and policy, then queries a fixed set of
dictionary-sensitive terms including `中`, `另外`, `何時`, `国際`, `ビジター`,
`閉`, and Chinese/Japanese `秘密`. The gate verifies
`provider=dictionary`, `model=cloudflare-d1-v2`, stable `sense_order` display,
four-language localizations/definitions, pronunciation grouping, and key
override terms. It is intentionally not part of `npm run check:all` because it
depends on the deployed Worker and network access.

The first full-database completion batches used Ollama `qwen3.6:latest` with `profile core` and `--max-senses-per-entry 1`, then moved to the A6000 cluster behind `100.99.99.99`. That flow is historical and should not be the default for new product-dictionary source-gap work.

For current expansion work, first generate and filter a high-value coverage-gap
report. Then run Unsloth in `--select-only true` or dry-run mode before any
database write:

```powershell
node scripts/find-dictionary-v2-product-coverage-gaps.mjs `
  --out logs/product-coverage-gaps-current-10000.json `
  --limit 10000 `
  --include-details true

node scripts/filter-dictionary-v2-product-coverage-gap-report.mjs `
  --in logs/product-coverage-gaps-current-10000.json `
  --out logs/product-coverage-gaps-clean-high-value.json `
  --limit 500

node scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --report logs/product-coverage-gaps-clean-high-value.json `
  --limit 20 `
  --select-only true `
  --out logs/product-source-gap-unsloth-select-only-20.json
```

The active source-gap supplement flow uses Unsloth Studio's OpenAI-compatible API and writes whole four-language product records with `scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs`. Use the cleaned source-gap report, not the raw incomplete report, unless intentionally debugging rejects:

```powershell
$env:UNSLOTH_API_KEY = "sk-unsloth-..."
node scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --report logs/product-incomplete-gap-senses-clean-20260623.json `
  --model unsloth/Qwen3.6-35B-A3B-MTP-GGUF `
  --endpoints http://100.99.99.99:11447,http://100.99.99.99:11448 `
  --limit 100 `
  --concurrency 2 `
  --batch-size 1 `
  --dry-run true `
  --apply false `
  --quiet true `
  --prewarm true `
  --gguf-variant UD-IQ4_NL `
  --max-seq-length 8192 `
  --speculative-type mtp `
  --out logs/product-source-gap-unsloth-dry-run.json
```

For a real write, change `--dry-run true --apply false` to `--dry-run false --apply true`, then run the fast audit. New expansion batches are draft by default: `product_entries.status = draft_single_source`, `product_senses.status = draft_single_source`, and generated localizations keep `needs_review = 1`. Do not pass `--publishable true` for ordinary expansion batches.

```powershell
npm run dict:v2:audit:product-fast -- --out logs/product-fast-audit-after-source-gap.json
```

After large source-gap runs, do not keep rerunning the generic command against the same clean report. First generate a residual report that compares the clean report against the current product DB and the last generation log:

```powershell
node scripts/report-dictionary-v2-product-source-gap-residuals.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --report logs/product-incomplete-gap-senses-clean-20260623.json `
  --attempt-log logs/product-source-gap-unsloth-4090-iq4-source-link-backfill-20260624.json `
  --out logs/product-source-gap-residual-clean-20260624.json
```

As of 2026-06-24, the first residual report showed `7530` clean source-gap candidates, `7306` complete candidates, and `224` residuals. Those residuals were mostly validation edge cases, not capacity problems: rare Han variants, kana/orthography entries, abbreviation/proper-name entries, missing IPA, and a few transient fetch/timeouts. For those, use the residual prompt mode and the residual report as input:

```powershell
node scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --report logs/product-source-gap-residual-clean-20260624.json `
  --model unsloth/Qwen3.6-35B-A3B-MTP-GGUF `
  --endpoints http://100.99.99.99:11447,http://100.99.99.99:11448 `
  --limit 224 `
  --concurrency 2 `
  --batch-size 1 `
  --dry-run true `
  --apply false `
  --quiet true `
  --prewarm true `
  --gguf-variant UD-IQ4_NL `
  --max-seq-length 8192 `
  --speculative-type mtp `
  --residual-mode true `
  --include-risky true `
  --out logs/product-source-gap-unsloth-residual-dry-run-20260624.json
```

Only switch that residual command to `--dry-run false --apply true` after checking the dry-run pass rate. In the 2026-06-24 residual run, a 30-row dry run accepted `25/30`; the matching 30-row apply accepted `25/30`, and the remaining 199-row apply accepted `173/199`. Fast audit stayed green after both writes. The clean source-gap state after this pass was `7504/7530` complete, with `26` final residuals in `logs/product-source-gap-residual-final-20260624.json`.

Do not spend repeated full model passes on those final residuals. They are mostly plural/inflected English entries with very broad glosses, brands/acronyms (`facebook`, `dvd`, `bmw`), source-language terms whose gloss is too generic (`pt-BR regular -> normal`), or thin definition cases. The final 26 residuals were closed manually with `scripts/finalize-dictionary-v2-product-source-gap-residuals-20260624.mjs`. The corrected post-finalize report is `logs/product-source-gap-residual-after-manual-finalize-fixed-20260624.json`: `7530/7530` complete, `0` residuals. Fast audit after this manual closure is `logs/product-fast-audit-after-manual-source-gap-finalize-fixed-20260624.json` and is green.

The source-gap-complete product dictionary export was written to `outputs/d1-v2-product-native-export-source-gap-complete-20260624` and passed full import audit. It was pushed to Cloudflare D1 `linguago-dictionary` and deployed with Worker version `ac11f712-738a-4e17-b1d0-d94db4813457`. Remote D1 counts after push:

| Table                      |   Rows |
| -------------------------- | -----: |
| `v2_entries`               |  29144 |
| `v2_senses`                |  29675 |
| `v2_sense_localizations`   | 118700 |
| `v2_examples`              |   3057 |
| `v2_example_localizations` |  12006 |

Online checks after deployment passed for core samples and manual residual samples (`facebook`, `dvd`, `bmw`, `女婿`, `ダイナー`), all returning `provider=dictionary` and `model=cloudflare-d1-v2`.

Post-release quality cleanup on 2026-06-24 closed the deterministic Japanese Latin-only warning set and merged only the safest same-entry duplicate senses. The updated export is `outputs/d1-v2-product-native-export-quality-fixes-20260624`; it passed full import audit and was pushed to Cloudflare D1 `linguago-dictionary`.

Remote D1 counts after the quality-fix push:

| Table                      |   Rows |
| -------------------------- | -----: |
| `v2_entries`               |  29144 |
| `v2_senses`                |  29668 |
| `v2_sense_localizations`   | 118672 |
| `v2_examples`              |   3057 |
| `v2_example_localizations` |  12006 |

The post-fix audit has no `zh_terms_with_kana` or `ja_terms_with_latin_only` warnings. It still reports `80` duplicate same-entry localization warnings, but the conservative merge scanner finds no remaining rule-safe merge pairs; keep those for semantic review instead of automatic deletion. Online checks for `of`, `would`, `were`, `been`, `gonna`, and `could` return the repaired Japanese entries from `provider=dictionary`, `model=cloudflare-d1-v2`.

The first semantic duplicate review pass is recorded in `logs/product-semantic-duplicate-review-20260624.json` and `logs/product-semantic-duplicate-review-20260624.md`. The `80` duplicate localization groups collapsed to `63` unique sense pairs: `18` were appropriate for LLM semantic review and `45` were single-term collision/manual review cases. The LLM review used `scripts/review-dictionary-v2-product-semantic-duplicates-unsloth.mjs` against the 4090 Unsloth endpoints and produced `logs/product-semantic-duplicate-llm-review-20260624.json`: `17` merge decisions and `1` keep-separate decision (`aunty`).

The accepted LLM merge decisions were converted with `scripts/convert-dictionary-v2-product-llm-duplicate-review-to-merge-plan.mjs` into `logs/product-llm-approved-duplicate-merge-plan-20260624.json`, then applied through the existing duplicate merge applicator. This merged `17` senses, moved `4` source links, deleted `68` duplicate localizations, and preserved examples. The `aunty` keep-separate case was repaired manually with `scripts/repair-dictionary-v2-product-aunty-broad-sense-20260624.mjs` by broadening sense `22993` in Chinese, Japanese, and Portuguese instead of merging it.

Fast audit after this pass is `logs/product-fast-audit-after-aunty-repair-20260624.json` and is green. The remaining duplicate warning state is now:

| Metric                        | Count |
| ----------------------------- | ----: |
| duplicate localization groups |    45 |
| unique sense pairs            |    45 |
| LLM semantic-review pairs     |     0 |
| conservative auto-merge pairs |     0 |

Treat the remaining `45` as manual keep/merge review items. They are not currently blocking publication because every publishable sense still has four valid localizations, no duplicate sense order, and no script/Latin-only warnings.

The semantic-dedupe release export is `outputs/d1-v2-product-native-export-semantic-dedupe-20260624`. It passed full import audit with samples `hello`, `你好`, `中`, `tight`, `graduate`, `aunty`, `机长`, `of`, `would`, `facebook`, `dvd`, `bmw`, `女婿`, and `ダイナー`, then was pushed to Cloudflare D1 `linguago-dictionary`.

Remote D1 counts after the semantic-dedupe push:

| Table                      |   Rows |
| -------------------------- | -----: |
| `v2_entries`               |  29144 |
| `v2_senses`                |  29651 |
| `v2_sense_localizations`   | 118604 |
| `v2_examples`              |   3057 |
| `v2_example_localizations` |  12006 |

Online checks after the D1 push confirmed `tight` and `graduate` now each return one dictionary sense; `aunty` still returns two senses, with the broad second sense localized as `zh=阿姨`, `ja=おばさん`, and `pt-BR=tia`; `机长` returns one Chinese-source aviation-captain sense. No Worker redeploy was required because only D1 data changed.

The remaining manual-review duplicate queue was then reviewed with the same Unsloth semantic-review script using `--recommendations manual_keep_or_merge_review`. The report is `logs/product-manual-duplicate-llm-review-20260624.json`: `41` high-confidence merge decisions, `3` keep-separate decisions (`卿`, `ううん`, `frighten`), and `1` repair-before-merge decision (`murmuring`). The `41` merge decisions were applied from `logs/product-manual-llm-approved-duplicate-merge-plan-20260624.json`; `murmuring` was repaired with `scripts/repair-dictionary-v2-product-murmuring-20260624.mjs` and then merged with `logs/product-murmuring-repaired-duplicate-merge-plan-20260624.json`.

The final semantic-dedupe export is `outputs/d1-v2-product-native-export-semantic-dedupe-final-20260624`. It passed full import audit and was pushed to Cloudflare D1 `linguago-dictionary`.

Remote D1 counts after the final semantic-dedupe push:

| Table                      |   Rows |
| -------------------------- | -----: |
| `v2_entries`               |  29144 |
| `v2_senses`                |  29609 |
| `v2_sense_localizations`   | 118436 |
| `v2_examples`              |   3057 |
| `v2_example_localizations` |  12006 |

The only remaining duplicate-localization warnings are the three intentional keep-separate cases:

| Entry      | Reason to keep separate                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `卿`       | Distinct honorific/title vs suffix/pronoun usage.                                                                  |
| `ううん`   | General negative answer vs informal `nuh-uh` register.                                                             |
| `frighten` | General cause-fear sense vs scare-away/translation-direction nuance; needs later lexical cleanup before any merge. |

Online checks after the final D1 push confirmed `red` and `murmuring` now each return one sense, while `卿`, `ううん`, and `frighten` intentionally remain multi-sense. No Worker redeploy was required.

Current Unsloth production model guidance:

- Model: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`.
- Preferred quantization: `UD-IQ4_NL`.
- Runtime: `max_seq_length=8192`, `speculative_type=mtp`, `batch-size=1`.
- Use one worker per GPU endpoint. For the two RTX 4090 nodes, `--concurrency 2` across `11447,11448` is the tested setting.
- `UD-IQ4_NL` is smaller and faster than `UD-Q4_K_XL` for this task while keeping similar validation quality. It also fits the 24 GB RTX 4090 nodes without the previous CPU offload issue.

Relevant 2026-06-23 dry-run benchmarks:

| Node(s)                     | Endpoint(s)   | Variant     | Result          | Throughput                           |
| --------------------------- | ------------- | ----------- | --------------- | ------------------------------------ |
| `a6000-155`                 | `11445`       | `UD-IQ4_NL` | 48/50 accepted  | 38.96 accepted/min                   |
| `rtx4090-56`                | `11447`       | `UD-IQ4_NL` | 47/50 accepted  | 51.66 accepted/min                   |
| `rtx4090-47`                | `11448`       | `UD-IQ4_NL` | 47/50 accepted  | 46.64 accepted/min                   |
| `rtx4090-56` + `rtx4090-47` | `11447,11448` | `UD-IQ4_NL` | 96/100 accepted | about 90-100 accepted/min wall-clock |

Unsloth Studio currently auto-loads `mmproj-F16.gguf` for this repo because it is detected as a vision model. `/v1/load` has no documented `vision=false` or `mmproj=false` option in the local OpenAPI schema, so capacity planning should assume mmproj remains loaded. On the two 4090 nodes, `UD-IQ4_NL` still loads with `-ngl -1` and about 19.8 GB / 24.6 GB VRAM used, so it is acceptable.

Older Ollama queue commands, kept only for historical reference:

Current old-flow nodes were:

- `a6000-143`: `http://100.99.99.99:11441`
- `a6000-144`: `http://100.99.99.99:11442`
- `a6000-048`: `http://100.99.99.99:11443`

Use target-language sharding so concurrent runners never compete for the same queued jobs. A tested balanced batch is:

```powershell
node scripts/create-dictionary-v2-llm-jobs.mjs --db data/processed/linguago_v2_full.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs en --limit 400
node scripts/create-dictionary-v2-llm-jobs.mjs --db data/processed/linguago_v2_full.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs zh --limit 400
node scripts/create-dictionary-v2-llm-jobs.mjs --db data/processed/linguago_v2_full.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs ja --limit 200
node scripts/create-dictionary-v2-llm-jobs.mjs --db data/processed/linguago_v2_full.db --model qwen3.6:latest --profile core --max-senses-per-entry 1 --target-langs pt-BR --limit 200

node scripts/run-dictionary-v2-llm-jobs.mjs --db data/processed/linguago_v2_full.db --endpoint http://100.99.99.99:11441 --model qwen3.6:latest --target-langs en --limit 400
node scripts/run-dictionary-v2-llm-jobs.mjs --db data/processed/linguago_v2_full.db --endpoint http://100.99.99.99:11442 --model qwen3.6:latest --target-langs zh --limit 400
node scripts/run-dictionary-v2-llm-jobs.mjs --db data/processed/linguago_v2_full.db --endpoint http://100.99.99.99:11443 --model qwen3.6:latest --target-langs ja,pt-BR --limit 400
```

Current job status after the latest 3-node balanced batch:

- `accepted`: 9,586 qwen jobs.
- `needs_review`: 14 jobs.
- `queued`: 0 jobs.
- `failed`: 0 jobs.
- generated `sense_localizations`: 9,536 from `ollama:qwen3.6:latest`.
- manual grammar overrides: 1 localization for `the -> ja`.
- function-word overrides: 45 localizations from `config/dictionary-overrides/function-words-v2.json`.

Queue creation has been optimized with target-language SQL filtering and production indexes. A single-language dry run that previously took minutes now completes in about 1.6 seconds for `--limit 400`.

Audit command:

```powershell
node scripts/audit-dictionary-v2-quality.mjs --db data/processed/linguago_v2_full.db --source ollama:qwen3.6:latest --limit 14000
```

Latest audit result: 9,536 generated `sense_localizations` and 1,199 generated `example_localizations` checked, 0 issues found. The 45 function-word override localizations also audit cleanly.

Use the function-word override layer for high-frequency grammar words that the model cannot reliably lexicalize:

```powershell
npm run dict:v2:apply-overrides -- --db data/processed/linguago_v2_full.db
```

The override script upserts `sense_localizations`, marks matching `llm_completion_jobs` as `accepted`, and resolves the matching `missing_<lang>_localization` quality issue. Keep this layer small and explicit; it is for grammar/function words and source-sense cleanup cases, not a replacement for normal LLM completion.

## 2026-06-24 Entry/Sense Merge Release

After the pronunciation-group and semantic-dedupe pass, D1 still exposed duplicate-looking results for homographs such as `卿` and `ううん`. Direct D1 inspection showed the remaining problem was not duplicate `sense_order` inside one entry, but multiple product entries with the same `normalized_key + primary_lang`. The Worker lookup can surface those as one search result, so the product layer must keep one entry per lookup key and put the distinct meanings under that entry.

Actions applied to `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db`:

- Backed up the DB to `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-entry-merge-20260624.db`.
- Ran `scripts/merge-dictionary-v2-product-entries.mjs` across all remaining duplicate product entries.
- Result: `4595` duplicate entry groups merged, `6077` duplicate entries deleted, `6083` senses moved, and `10738` senses renumbered.
- Ran `scripts/merge-dictionary-v2-product-senses.mjs` after entry merge.
- Result: `811` deterministic duplicate senses merged; rule duplicates dropped to `0`.
- Ran Unsloth semantic review on the remaining `llm_semantic_review` pairs with `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`, `UD-IQ4_NL`, MTP, endpoints `11441,11444,11448,11447`.
- LLM result: `45/45` valid reviews, `38` merge, `7` keep separate, average `1.98s` per pair.
- Applied `37` LLM-approved merges from `logs/product-llm-approved-duplicate-merge-plan-after-entry-sense-merge-20260624.json`; one overlapping candidate was skipped because its remove sense had already been removed by an earlier merge.

Published export:

```text
outputs/d1-v2-product-native-export-entry-sense-llm-merged-20260624
```

Full import audit passed with no blocking structural errors:

- `bad_sense_localization_counts`: `0`
- `duplicate_sense_orders`: `0`
- empty required fields: `0`
- orphan rows: `0`
- `zh_terms_with_kana`: `0`
- `ja_terms_with_latin_only`: `0`

Remaining warning queue after this release:

- `duplicate_sense_localizations`: `327`
- These are not publish blockers. Most are `manual_keep_or_merge_review`, `likely_keep_separate`, or a small residual `llm_semantic_review` queue after the first post-entry-merge cleanup.

Remote Cloudflare D1 `linguago-dictionary` counts after the successful retry push:

| Table                      |   Rows |
| -------------------------- | -----: |
| `v2_entries`               |  23070 |
| `v2_senses`                |  28761 |
| `v2_sense_localizations`   | 115044 |
| `v2_examples`              |   3049 |
| `v2_example_localizations` |  11974 |

Worker cache was bumped to `TRANSLATION_CACHE_VERSION = "v53-product-entry-sense-merge"` and deployed as Worker version `c5554e4e-3369-470b-8204-769fa12b8580`. This invalidates the previous dictionary KV cache keys after the D1 data shape changed.

Online API checks after deploy:

- `卿`: returns one Japanese-source entry with three consecutive senses: `Lord`, `minister`, `minister`.
- `ううん`: returns one Japanese-source entry with three consecutive senses: `nuh-uh`, `no`, `no`.
- `frighten`: returns two senses with the repaired Portuguese/Japanese localizations: `afugentar` and `amedrontar`.
- `中`: defaults to the Chinese-source entry when auto-detected as Chinese, with five consecutive senses including `zhōng` and `zhòng` meanings.

Note: dictionary responses still include `cached: true` because dictionary hits are marked as cacheable/dictionary results in the response shape. After the v53 deploy, the returned field values confirm the old KV payload is no longer being used.

Next cleanup queue:

1. Review `logs/product-semantic-duplicate-review-after-entry-sense-llm-merge-20260624.json`.
2. Resolve the single `encoding_repair_first` item.
3. Run another targeted LLM/manual pass on the remaining `llm_semantic_review` and high-confidence `manual_keep_or_merge_review` pairs.
4. Re-export, full-audit, and push D1 only after the next batch passes.

## 2026-06-24 Step 6 Cleanup Checkpoint

This checkpoint continued the post-entry-merge cleanup on
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db`.

Semantic duplicate cleanup:

- Starting warning report:
  `logs/product-semantic-duplicate-review-step6-start-20260624.json`.
- Starting warnings: `327` duplicate localization groups, `319` unique sense pairs.
- Unsloth semantic review model:
  `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`, `UD-IQ4_NL`, MTP, endpoints
  `11441,11444,11448,11447`.
- LLM review result: `279` candidates, `277` valid, `180` merge,
  `85` keep separate, `12` repair before merge, average `2.14s`.
- Applied LLM-approved merge plan:
  `logs/product-llm-approved-duplicate-merge-plan-step6-20260624.json`.
- Applied result: `179` senses merged, `1` skipped overlapping candidate,
  `716` sense localizations deleted, `25` examples deleted.
- After-merge warning report:
  `logs/product-semantic-duplicate-review-step6-after-merge-20260624.json`.
- Remaining warnings: `151` duplicate localization groups, `143` unique pairs.

High-priority example supplement:

- Added `scripts/supplement-dictionary-v2-product-known-examples-20260624.mjs`.
- Inserted `6` hand-reviewed examples and `24` localized example rows for
  `of`, `would`, `は`, `に`, `ううん`, and `frighten`.
- The script only inserts when the selected sense has no accepted example, and
  uses fixed negative `source_example_id` values so repeated runs do not create
  duplicates.

Final local export:

```text
outputs/d1-v2-product-native-export-step6-final-20260624
```

Final export counts:

| Table                      |   Rows |
| -------------------------- | -----: |
| `v2_entries`               |  23070 |
| `v2_entry_forms`           | 161057 |
| `v2_pronunciation_groups`  |  24878 |
| `v2_senses`                |  28582 |
| `v2_sense_localizations`   | 114328 |
| `v2_examples`              |   3030 |
| `v2_example_localizations` |  11898 |

Full export audit passed:

- `bad_sense_localization_counts`: `0`
- `duplicate_sense_orders`: `0`
- empty required fields: `0`
- orphan rows: `0`
- `mojibake_texts`: `0`
- `html_artifacts`: `0`
- `duplicate_zh_examples_by_en_reading`: `0`
- remaining non-blocking `duplicate_sense_localizations`: `151`

Worker/API shape changes:

- `TranslateResponse` now supports optional `cache_hit`.
- Dictionary-origin responses are returned with `cached: false` and
  `cache_hit: false`; KV cache hits are explicitly returned with
  `cache_hit: true`.
- The frontend dictionary badge now treats `provider === "dictionary"` as
  "核心词典" and uses `cache_hit` only for actual KV/provider cache hits.
- Worker cache version bumped to
  `TRANSLATION_CACHE_VERSION = "v54-step6-warning-cleanup-cache-hit"`.

Deployment status:

- Local export and audit are complete.
- Remote D1 push succeeded with
  `scripts/push-dictionary-v2-native-to-d1.ps1 -SkipExport -OutDir outputs/d1-v2-product-native-export-step6-final-20260624 -DatabaseName linguago-dictionary`.
- Worker deploy succeeded as version
  `1b2f40d0-a3ad-4e4c-99fa-eb318cae2174`.
- `/health` confirmed remote D1 counts:
  `entries=23070`, `senses=28582`, `sense_localizations=114328`,
  `examples=3030`, `example_localizations=11898`.
- Online API regression passed for `中`, `inside`, `breaks`, `although`,
  and `cor`. `中` now exposes two pronunciation groups: `zhōng` for
  sense orders `1,2,3` and `zhòng` for `4,5`.
- Online render/UI smoke passed on mobile and desktop with no horizontal
  overflow. Stream abort warnings in the smoke log are expected when the test
  cancels a previous streaming request during navigation; all captured API
  responses were `200`.

## 2026-06-24 Residual POS Duplicate Repair

After the Step 6 checkpoint, the remaining duplicate-localization warning queue
still contained one deterministic encoding/semantic repair and seven POS-style
residual pairs that were previously marked for LLM semantic review. These were
handled without a remote model because they were clear keep-separate cases:

- `ペット`: kept `pet` and repaired the second sense to `trumpet` /
  `トランペット` / `小号` / `trompete`.
- `評価`: kept `appreciation` separate from monetary `valuation`.
- `耐心`: separated adjective `patient`, noun `patience`, and verb
  `be patient`.
- `发明`: separated verb `invent` from noun `invention`.
- `詩`: separated general `poem` from `Chinese poem`.
- `摄影`: separated noun `photography` from verb `take a photograph`.
- `相似`: separated adjective `similar` from verb `be similar`.
- `無礼`: separated adjective `rude` from noun `rudeness`.

Scripts added:

- `scripts/repair-dictionary-v2-product-pet-trumpet-20260624.mjs`
- `scripts/repair-dictionary-v2-product-residual-pos-duplicates-20260624.mjs`

Warning report after the repair:

```text
logs/product-semantic-duplicate-review-after-residual-pos-repair-20260624.json
```

Summary:

- `duplicate_sense_localizations`: `135`
- `llm_semantic_review`: `0`
- `encoding_repair_first`: `0`
- remaining warnings are `manual_keep_or_merge_review` (`95`) and
  `likely_keep_separate` (`40`), which are not publish blockers.

Published export:

```text
outputs/d1-v2-product-native-export-residual-repair-20260624
```

Final export counts:

| Table                      |   Rows |
| -------------------------- | -----: |
| `v2_entries`               |  23070 |
| `v2_entry_forms`           | 161074 |
| `v2_pronunciation_groups`  |  24881 |
| `v2_senses`                |  28582 |
| `v2_sense_localizations`   | 114328 |
| `v2_examples`              |   3030 |
| `v2_example_localizations` |  11898 |

Full export audit passed with no blocking structural errors:

- `bad_sense_localization_counts`: `0`
- `duplicate_sense_orders`: `0`
- empty required fields: `0`
- orphan rows: `0`
- `mojibake_texts`: `0`
- `html_artifacts`: `0`

Remote D1 push succeeded. `/health` reported `published_at` as
`2026-06-24T11:01:40.008Z`. Online API spot checks passed for `ペット`,
`评价`, `耐心`, `摄影`, `相似`, and `無礼`.

## 2026-06-24 Product Override Layer

The product database now has a replayable override layer for hand-reviewed
localization and POS repairs:

```text
config/dictionary-overrides/product-sense-localizations.json
scripts/apply-dictionary-v2-product-localization-overrides.mjs
```

The script locates a product sense by `headword + primary_lang + sense_order`
or `headword + primary_lang + gloss_key`, then updates `product_senses` and
`product_localizations`. This makes deterministic fixes reusable after future
database rebuilds instead of leaving them only in one-off dated repair scripts.

Current overrides include:

- the previously verified residual repairs for `ペット`, `評価`, `耐心`,
  `发明`, `詩`, `摄影`, `相似`, and `無礼`;
- a high-frequency correction for Chinese `的`, making sense 1 the common
  structural particle / possessive-attributive marker while retaining the rare
  character senses after it.

Apply command:

```powershell
node scripts/apply-dictionary-v2-product-localization-overrides.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --overrides config/dictionary-overrides/product-sense-localizations.json `
  --apply true
```

Published export after applying the override layer:

```text
outputs/d1-v2-product-native-export-product-overrides-20260624
```

Full export audit passed with no blocking errors and the duplicate warning
queue remained stable at `135`. Remote D1 push succeeded. `/health` reported
`published_at` as `2026-06-24T12:24:08.707Z`.

Online spot checks after the push:

- `的`: sense 1 is now `particle / possessive or attributive particle`.
- `ペット`: sense 1 `pet`, sense 2 `trumpet`.
- `发明`: sense 1 verb `to invent`, sense 2 noun `invention`.
- `摄影`: sense 1 noun `photography`, sense 2 verb `take a photograph`.

## 2026-06-24 High-Frequency Product Overrides

A second override batch was applied to reduce high-frequency duplicate
localization warnings without invoking LLM repair. The batch updates local
translations/definitions for entries such as `一緒`, `少し`, `明白`, `行`, `心`,
`下`, `先生`, `秘密`, `始`, `安定`, `公平`, and `退屈`.

Apply command:

```powershell
node scripts/apply-dictionary-v2-product-localization-overrides.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --overrides config/dictionary-overrides/product-sense-localizations.json `
  --apply true
```

Result:

- override config: `21` entries;
- local product database update: `21` senses and `36` localizations touched;
- semantic duplicate review: `135 -> 125` warnings;
- full export audit: no blocking errors, `mojibake_texts = 0`,
  `html_artifacts = 0`;
- published export:
  `outputs/d1-v2-product-native-export-highfreq-overrides-20260624`.

Remote D1 push succeeded. `/health` reported `published_at` as
`2026-06-24T12:37:00.788Z`.

Online spot checks after the push:

- `一緒`: first sense English term is `same`.
- `少し`: distance sense Japanese term is `少し先`.
- `公平`: noun sense Japanese term is `公平性`.
- `退屈`: verbal sense is `feel bored / 退屈する`.

## 2026-06-24 Batch 2 High-Frequency Overrides

A third deterministic override pass fixed additional high-frequency entries
where one localization had been copied from a neighboring sense. The batch
covered entries such as `没有`, `秘密`, `教`, `無し`, `全`, `離`, `気の毒`,
`惑星`, `尻`, `茶`, `道具`, `世紀`, `激动`, `妙`, `見かけ`, `教育`, and `留守`.

Result:

- override config: `40` entries;
- local product database update: `40` senses and `67` localizations touched;
- semantic duplicate review: `125 -> 108` warnings;
- full export audit: no blocking errors, `mojibake_texts = 0`,
  `html_artifacts = 0`;
- exported `entry_forms`: `161125`;
- exported `pronunciation_groups`: `24891`;
- published export:
  `outputs/d1-v2-product-native-export-batch2-overrides-20260624`.

Remote D1 push succeeded. `/health` reported `published_at` as
`2026-06-24T12:58:20.725Z`.

Online spot checks after the push:

- `気の毒`: second sense is now `unpardonable`.
- `惑星`: second sense is now `dark horse`.
- `尻`: second sense is now `last place`.
- `留守`: second and third senses are separated as `house-sitting` and
  `neglecting`.

Note: Chinese/Japanese homographs such as `秘密`, `教育`, and `茶` can still
default to the Chinese product entry depending on lookup ranking. The entry
data has been corrected, but default language disambiguation remains a separate
lookup/UI ranking task.

## 2026-06-24 Batch 3 High-Frequency Overrides

A fourth deterministic override pass fixed another set of high-frequency cases
where one translated localization had been copied from a neighboring sense. The
batch covered entries such as `另外`, `放手`, `連続`, `好み`, `国際`, `業`, `何時`,
`白色`, `篇`, `叔`, `ビジター`, `労働`, and `閉`.

Result:

- override config: `57` entries;
- local product database update: `57` senses and `101` localizations touched;
- semantic duplicate review: `108 -> 97` warnings;
- full export audit: no blocking errors, `mojibake_texts = 0`,
  `html_artifacts = 0`;
- exported `entry_forms`: `161161`;
- exported `pronunciation_groups`: `24898`;
- exported product counts: `23070` entries, `28582` senses,
  `114328` sense localizations, `3030` examples, and `11898` example
  localizations;
- local export:
  `outputs/d1-v2-product-native-export-batch3-overrides-20260624`.

Remote D1 push succeeded on 2026-06-25. `/health` reported `published_at` as
`2026-06-24T14:53:32.203Z` with `23070` entries, `28582` senses, `114328`
sense localizations, `3030` examples, and `11898` example localizations.

Worker cache was bumped to `TRANSLATION_CACHE_VERSION =
"v55-dictionary-sense-order"` and deployed as Worker version
`47b719f7-a824-4a33-b6b6-e8a46f28b746`. This invalidates old dictionary KV
results and ensures v2 senses are displayed in stable `sense_order` order even
when SQL matching temporarily prioritizes a matched sense.

Spot-checked audit samples confirmed the corrected distinctions for `另外`,
`放手`, `国際`, `何時`, `白色`, `篇`, `叔`, `ビジター`, `労働`, and `閉`.

On 2026-06-25, a follow-up spot fix corrected `白色` Japanese and Portuguese
localizations that were structurally valid but semantically weak:

- sense 1 now uses `ja=白色テロ` and `pt-BR=terror branco`;
- sense 2 now uses `ja=白色汚染` and `pt-BR=poluição branca`;
- local override replay touched `57` senses and `105` localizations;
- full export audit passed with no blocking errors, `mojibake_texts = 0`, and
  `html_artifacts = 0`;
- exported and pushed
  `outputs/d1-v2-product-native-export-spotfix-white-20260625`;
- `/health` reported `published_at` as `2026-06-24T22:32:42.731Z`;
- Worker cache was bumped to `TRANSLATION_CACHE_VERSION = "v56-white-spotfix"`
  and deployed as Worker version `8aee0b85-ffd8-4cd5-895f-01cb2bc91008`;
- `npm run check:online-dictionary` passed, including the new
  `zh-white-spotfix` regression case.

On 2026-06-25, a second follow-up spot fix corrected `杆`, which was returning
`sandalwood` because an upstream source/fusion sense for the Chinese headword
had been accepted with the wrong source gloss and reading (`sandalwood`,
`tan xiang`). This was a data-layer error, not a frontend rendering issue.

- sense 1 now separates `gan1` as `pole; post; staff`;
- sense 2 now separates `gan3` as `shaft; handle; classifier`;
- the override config now has `59` entries;
- local override replay touched `59` senses and `113` localizations;
- full export audit passed with no blocking errors, `mojibake_texts = 0`, and
  `html_artifacts = 0`; same-entry duplicate warnings remained at `97`;
- exported and pushed
  `outputs/d1-v2-product-native-export-spotfix-gan-20260625`;
- `/health` reported `published_at` as `2026-06-24T22:58:33.914Z`;
- Worker cache was bumped to `TRANSLATION_CACHE_VERSION = "v57-gan-spotfix"`
  and deployed as Worker version `bbc66794-7bb9-4551-95d3-6ef57539e092`;
- `npm run check:online-dictionary` passed, including the new
  `zh-gan-spotfix` regression case.

On 2026-06-25, the next product-quality pass removed the remaining
`primary_english_term_conflict` published-risk bucket from the local product
database:

- `come` sense 2 was rewritten as `come from; derive from`;
- `alone` sense 3 was rewritten as the single/unmarried sense;
- `people` was rewritten from the erroneous `someone` localization to the
  collective `people` sense;
- `experience` sense 3 was rewritten as `experience; taste`;
- `exchange` sense 3 (`central`) and `court` sense 3 (`backyard`) were marked
  with product publication blocks and excluded from export;
- the product localization override config now has `63` entries;
- the new publication block config is
  `config/dictionary-overrides/product-publication-blocks.json`;
- the new reusable block applicator is
  `scripts/apply-dictionary-v2-product-publication-blocks.mjs`;
- the product-native D1 exporter now respects
  `product_sense_publication_blocks` when that table exists;
- local published-risk audit changed `primary_english_term_conflict` from `6`
  to `0`, with `28580` accepted publishable senses;
- full export audit passed for
  `outputs/d1-v2-product-native-export-primary-conflict-fix-20260625`, with
  `23070` entries, `28580` senses, `114320` sense localizations, and no
  blocking errors, `mojibake_texts = 0`, `html_artifacts = 0`;
- a literal `??` export scan found `0` runs after repairing a PowerShell
  encoding issue in the newly added overrides.

Remote D1 push succeeded on 2026-06-25. `/health` reported `published_at` as
`2026-06-24T23:13:41.807Z` with `23070` entries, `28580` senses, `114320`
sense localizations, `3030` examples, and `11898` example localizations.

Worker cache was bumped to `TRANSLATION_CACHE_VERSION =
"v58-primary-conflict-fix"` and deployed as Worker version
`6e61da19-d684-4390-8813-c99798006ffe`.

`npm.cmd run check:online-dictionary` passed after deployment, including the
new `en-people-primary-conflict`, `en-exchange-blocked-mixed-sense`, and
`en-court-blocked-mixed-sense` regression cases. Online spot checks confirmed
`exchange` now publishes only exchange/currency-exchange senses and `court`
now publishes only court/romantic-court senses.

## 2026-06-25 Broad Published-Sense Risk Triage

After the `primary_english_term_conflict` bucket reached `0`, the next active
quality bucket is `broad_multi_definition_gloss`. This is not always an error:
many rows are only synonym-rich glosses, function words, inflected English
forms, or proper-name noise. The current workflow therefore triages first and
only sends the remaining compact queue to LLM review.

Read-only triage command:

```powershell
node scripts/report-dictionary-v2-product-broad-risk-triage.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --risk logs/product-published-risk-after-primary-conflict-fix-20260625.json `
  --out logs/product-broad-risk-triage-20260625.json `
  --limit 180
```

Current triage result:

- input `broad_multi_definition_gloss` senses: `340`;
- `llm_split_candidate`: `29`;
- `manual_repair_or_block`: `11`;
- `manual_review`: `1`;
- `inflected_form_repair_or_keep`: `112`;
- `function_word_keep`: `21`;
- `likely_keep`: `166`.

The small LLM review script is:

```powershell
$env:UNSLOTH_API_KEY = "sk-unsloth-..."
node scripts/review-dictionary-v2-product-broad-risk-unsloth.mjs `
  --report logs/product-broad-risk-triage-20260625.json `
  --out logs/product-broad-risk-llm-review-20-20260625.json `
  --limit 20 `
  --concurrency 1 `
  --endpoints http://100.99.99.99:11444 `
  --model unsloth/Qwen3.6-35B-A3B-MTP-GGUF `
  --gguf-variant UD-IQ4_NL
```

The first successful 20-row pass produced `14/20` valid model decisions:
`9 keep`, `5 split`, and `6 invalid` due to JSON parse failures or node
connection errors. Useful split candidates from that pass included `lihai`,
`shenfen`, `fangxin`, and `tichu`; synonym-only rows such as `fangzi`,
`fangshi`, `guai`, `suannle`, `juda`, `aiya`, and `meimiao` were correctly
classified as keep. The later wider retry showed that some Unsloth nodes can
return `/v1/load` success while `/v1/chat/completions` fails with
`TypeError: fetch failed` or `No model loaded`; do not expand this review until
the selected node can keep the model loaded through chat requests.

Do not apply split decisions directly from this report. The next implementation
step is to turn high-confidence `split` decisions into a reviewed repair plan,
then either add deterministic product overrides or create new product senses
with four-language localizations.

The first repair-plan extraction step is:

```powershell
node scripts/create-dictionary-v2-product-broad-risk-split-plan.mjs `
  --review logs/product-broad-risk-llm-review-20-20260625.json `
  --triage logs/product-broad-risk-triage-20260625.json `
  --out logs/product-broad-risk-split-plan-20260625.json `
  --confidence-threshold 0.85
```

This cross-checks the LLM review against the current triage report so stale
split decisions are excluded. In the first run it reviewed `20` rows and kept
`4` approved split candidates: `lihai`, `shenfen`, `fangxin`, and `tichu`.
The old `steven` split suggestion was excluded because the refreshed triage now
classifies it as proper-name/manual repair noise rather than an LLM split
candidate.

The approved candidates were applied locally with:

```powershell
node scripts/apply-dictionary-v2-product-broad-risk-split-plan.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --plan logs/product-broad-risk-split-plan-20260625.json `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-broad-risk-split-20260625.db`.
The apply step updated `4` existing senses, created `4` new senses, inserted
`32` localizations, copied `4` source links, and moved the `tichu` example
`提出问题` onto the new raise/put-forward sense. Follow-up repairs corrected
the new split readings and fixed the old `tichu` withdraw/take-out English
localization. Two old `fangxin` source-mismatch senses (`to indulge` and
`to scatter`) were added to the publication block list so only the valid
`fangxin` senses publish.

Post-apply fast export audit passed with `28582` publishable senses, `0`
duplicate sense-order errors, `0` orphan rows, `0` mojibake texts, and `0`
HTML artifacts. Published-risk broad gloss warnings dropped from `340` to
`336`; the remaining broad-risk queue still needs review before the next D1
export.

## 2026-06-28 Broad Published-Sense Risk Batch 2

The second broad-risk pass continued from the repaired local product DB, not
from the already deployed D1 export. The refreshed triage command was:

```powershell
node scripts/report-dictionary-v2-product-broad-risk-triage.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --risk logs/product-published-risk-after-broad-split-and-local-repairs-20260625.json `
  --out logs/product-broad-risk-triage-after-local-repairs-20260628.json `
  --limit 220
```

The refreshed queue contained `336` broad-gloss input senses:
`25` LLM split candidates, `11` manual repair/block rows, `1` manual-review
row, `112` inflected-form rows, `21` function-word rows, and `166`
likely-keep rows.

`scripts/review-dictionary-v2-product-broad-risk-unsloth.mjs` now accepts
`--retries` and retries once by default for transient `fetch failed`,
`No model loaded`, JSON parse, HTTP 5xx, `ECONNRESET`, and `ETIMEDOUT`
failures. Keep the broad-risk review single-concurrency until the selected
Unsloth node proves stable through actual chat completions, not only `/v1/load`.

The second small review used one loaded Unsloth endpoint:

```powershell
$env:UNSLOTH_API_KEY = "sk-unsloth-..."
node scripts/review-dictionary-v2-product-broad-risk-unsloth.mjs `
  --report logs/product-broad-risk-triage-after-local-repairs-20260628.json `
  --out logs/product-broad-risk-llm-review-batch2-20260628.json `
  --limit 25 `
  --concurrency 1 `
  --endpoints http://100.99.99.99:11444 `
  --model unsloth/Qwen3.6-35B-A3B-MTP-GGUF `
  --gguf-variant UD-IQ4_NL `
  --max-tokens 1400 `
  --timeout-ms 300000 `
  --prewarm false `
  --retries 1
```

It produced `23/25` valid decisions: `14` keep and `9` split. The two invalid
rows were `miles` (JSON parse) and `flown` (non-split response with stale
split suggestions). The repair-plan extraction approved `9` split candidates,
but only three were applied after review: `hot`, `嫌`, and `激烈`. The other
approved rows were intentionally skipped for this batch because they were
proper-name noise, obscure low-value senses, stale lemma/inflection proposals,
or needed manual example mapping (`liver`, `bacon`, `惡`, `gig`, `proven`,
`sweaty`).

`scripts/apply-dictionary-v2-product-broad-risk-split-plan.mjs` now supports
`--sense-ids` so a reviewed subset can be applied without editing the generated
plan:

```powershell
node scripts/apply-dictionary-v2-product-broad-risk-split-plan.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --plan logs/product-broad-risk-split-plan-batch2-20260628.json `
  --sense-ids 2449,17795,19005 `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-broad-risk-batch2-20260628.db`.
The selected apply step updated `3` existing senses, created `5` new senses,
inserted `32` localizations, deleted `12` old localizations, and inserted `7`
source links. Follow-up reading cleanup was applied with
`scripts/repair-dictionary-v2-product-broad-split-batch2-readings-20260628.mjs`,
which corrected English IPA for `hot`, Japanese readings/terms for `hot`, and
Japanese terms/readings for `激烈`.

Post-repair checks passed:

- `npm run check`
- `node --check` for the changed broad-risk scripts
- fast product export audit
- published-risk audit

The latest local product DB has `23078` product entries, `28604` product
senses, and `28587` publishable senses. Blocking export checks remain clean:
`duplicate_sense_orders = 0`, `orphans = 0`, `mojibake_texts = 0`,
`html_artifacts = 0`, and `bad_sense_localization_counts = 0`. The broad-gloss
risk count dropped from `336` to `333`. D1 export should wait until at least
one more reviewed broad-risk batch or a manual decision to freeze this stage.

## 2026-06-28 Broad Published-Sense Risk Batch 3

The next triage used the batch-2 published-risk report and produced `333`
remaining broad-gloss input senses. The split-candidate queue was down to `22`
rows:

```powershell
node scripts/report-dictionary-v2-product-broad-risk-triage.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --risk logs/product-published-risk-after-broad-split-batch2-final-20260628.json `
  --out logs/product-broad-risk-triage-batch3-20260628.json `
  --limit 260
```

The single-endpoint Unsloth review completed in about `82` seconds with
`20/22` valid decisions: `14` keep, `6` split, and `2` invalid. The remaining
split approvals were mostly low-value or noisy rows already seen in batch 2:
`liver`, `bacon`, `惡`, `gig`, `proven`, and `sweaty`. Do not apply the raw
batch-3 split plan as-is; it would publish proper-name encyclopedia senses and
rare archaic meanings.

Instead, batch 3 used a conservative deterministic repair script:

```powershell
node scripts/repair-dictionary-v2-product-broad-risk-batch3-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-broad-risk-batch3-20260628.db`.
The repair did three things:

- split `liver` into anatomical organ sense `13814` and food sense `29700`;
- narrowed `proven` sense `19406` to the published adjective meaning
  "established beyond doubt";
- blocked mixed `bacon` sense `16099` with `blocked_source_ambiguous` because
  the entry already has a clean food sense and the extra row mixes Roger Bacon
  and Francis Bacon proper-name content.

Post-repair checks passed: `npm run check`, script `node --check`, fast product
audit, published-risk audit, product-native D1 export, and full import audit.
The latest local product DB has `23078` product entries, `28605` product
senses, `114412` product localizations, and `28587` exportable/publishable D1
senses after publication blocks. Blocking export checks remain clean:
`duplicate_sense_orders = 0`, `orphans = 0`, `mojibake_texts = 0`,
`html_artifacts = 0`, and `bad_sense_localization_counts = 0`. Published-risk
`broad_multi_definition_gloss` is now `331`. The current release-candidate
export is:

```text
outputs/d1-v2-product-native-export-broad-risk-batch3-20260628
```

## 2026-06-28 Manual Broad-Risk Batch 4

After batch 3, the broad-risk queue still contained `331` rows. The refreshed
triage showed that the remaining `manual_repair_or_block` rows were mostly two
classes: high-frequency English mixed-source entries (`does`, `real`, `shall`)
and proper-name encyclopedia rows (`George`, `James`, `Elizabeth`, `Edward`,
`Steven`, `Lincoln`). These should not be handled by raw LLM split plans because
they tend to create non-dictionary encyclopedia senses.

The batch-4 repair script is:

```powershell
node scripts/repair-dictionary-v2-product-manual-risk-batch4-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-manual-risk-batch4-20260628.db`.
The script:

- repaired `does` to the third-person singular present form of `do`;
- repaired `real` to the adjective sense "actually existing; genuine";
- repaired `shall` to a compact auxiliary-verb sense;
- repaired `sis` to informal "sister";
- repaired `ay` to "yes/aye; expression of assent";
- blocked broad proper-name or source-noise senses for `George`, `James`,
  `Elizabeth`, `Edward`, `Steven`, and `Lincoln`.

Post-repair checks passed: `npm run check`, script `node --check`, fast product
audit, published-risk audit, product-native D1 export, and full import audit.
The release-candidate export is:

```text
outputs/d1-v2-product-native-export-manual-risk-batch4-20260628
```

This export has `23064` entries, `28581` senses, `114324` sense localizations,
`3030` examples, and `11898` example localizations. Blocking export checks
remain clean: `duplicate_sense_orders = 0`, `orphans = 0`,
`mojibake_texts = 0`, `html_artifacts = 0`, and
`bad_sense_localization_counts = 0`. Published-risk
`broad_multi_definition_gloss` is now `326`. The six blocked proper-name rows
are intentionally absent from the published lookup; do not include them as
required sample terms in export audits unless proper-name entries are rebuilt
intentionally.

## 2026-06-28 Published-Risk Audit Scope Fix

The published-risk audit now uses the same publishable-sense scope as product
export: `product_senses.status = 'accepted'` and no matching row in
`product_sense_publication_blocks`. This prevents intentionally blocked source
noise from re-entering the broad-risk queue after a repair batch.

With the corrected scope, the batch-4 DB has:

- raw accepted senses: `28588`;
- publishable senses: `28581`;
- flagged publishable senses: `413`;
- `broad_multi_definition_gloss`: `319`;
- clean batch-5 triage input: `319` broad senses.

The refreshed batch-5 triage has `19` LLM split candidates, `1` manual-review
row, `112` inflected-form rows, `21` likely function-word keeps, and `166`
likely keeps. The previously blocked `bacon`, `George`, `James`, `Elizabeth`,
`Edward`, `Steven`, and `Lincoln` rows are no longer included in published-risk
or broad-risk triage reports.

## 2026-06-28 Broad Published-Sense Risk Batch 5

Batch 5 used the corrected publishable-only triage report and reviewed all `19`
LLM split candidates through Unsloth Qwen3.6-35B-A3B-MTP on the non-155 nodes.
The first smoke run failed with `Invalid token payload` because the script
already prepends `Bearer`; pass the bare `sk-...` token to `--token`. With the
correct token, the full run completed with `18/19` valid reviews: `14` keep,
`4` split, and `1` invalid validation result.

The approved split suggestions were deliberately not applied verbatim. They
were mostly low-frequency or source-noisy rows (`miles`, `gig`, `sweaty`) plus
one traditional Chinese character row (`惡`). Batch 5 therefore used a
conservative deterministic repair script instead:

```powershell
node scripts/repair-dictionary-v2-product-broad-risk-batch5-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-broad-risk-batch5-20260628.db`.
The script repaired:

- `miles` as the plural of `mile`, instead of publishing eight measurement and
  race sub-senses from the old source gloss;
- `惡` sense `16161` as "fierce/cruel/over-strict", keeping it distinct from
  the existing `wù` hostile-against sense and the `è` evil/wicked sense;
- `gig` as the common modern "live performance or temporary job" sense, instead
  of the noisy rowing-boat/fishing-tool/carriage source gloss;
- `flown` as the past participle of `fly`, including the corrected Japanese
  reading `とんだ`;
- `sweaty` as "covered with sweat or causing sweat".

Post-repair checks passed: script `node --check`, `npm run check`, fast product
export audit, and published-risk audit. Blocking export checks remain clean:
`duplicate_sense_orders = 0`, `orphans = 0`, `mojibake_texts = 0`,
`html_artifacts = 0`, and `bad_sense_localization_counts = 0`. The corrected
published-risk count is now `408` flagged publishable senses, with
`broad_multi_definition_gloss = 314`. The refreshed batch-6 triage has `14` LLM
split candidates, `1` manual-review row, `112` inflected-form rows, `21`
function-word keeps, and `166` likely keeps.

## 2026-06-28 Broad Published-Sense Risk Batch 6

Batch 6 handled the remaining LLM/manual triage rows without another model
round. All `14` LLM candidates from batch 6 were already judged as `keep` in
the previous Unsloth review, and the remaining `manual_review` row
(`compromise`) had good localizations but an over-broad source gloss. The repair
therefore only compressed `gloss_key` and normalized `part_of_speech`; it did
not rewrite the four-language localization rows.

The repair script is:

```powershell
node scripts/repair-dictionary-v2-product-broad-risk-batch6-keep-glosses-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-broad-risk-batch6-20260628.db`.
The repaired rows were `房子`, `方式`, `管`, `怪`, `算了`, `巨大`, `哎呀`,
`美妙`, `符合`, `通道`, `炳`, `不足`, `compromise`, `修改`, and `快感`.

Post-repair checks passed: script `node --check`, `npm run check`, fast product
export audit, and published-risk audit. Blocking export checks remain clean:
`duplicate_sense_orders = 0`, `orphans = 0`, `mojibake_texts = 0`,
`html_artifacts = 0`, and `bad_sense_localization_counts = 0`. The corrected
published-risk count is now `393` flagged publishable senses, with
`broad_multi_definition_gloss = 299`.

The refreshed batch-8 triage has no LLM split candidates and no manual-review
rows. The remaining broad-risk queue is rule-classified only: `112`
inflected-form repair/keep rows, `21` function-word keeps, and `166` likely
keeps. The next cleanup step should focus on deterministic handling of those
three rule buckets rather than additional LLM review.

## 2026-06-28 Inflected-Form Broad-Risk Cleanup

The next cleanup pass handled the `inflected_form_repair_or_keep` bucket without
LLM review. The bucket contained `112` broad source glosses, mostly English
inflected forms whose source definitions had inherited every sense of the lemma.
Three deterministic scripts were used:

```powershell
node scripts/repair-dictionary-v2-product-inflected-batch9-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true

node scripts/repair-dictionary-v2-product-inflected-batch10-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true

node scripts/repair-dictionary-v2-product-inflected-batch11-final-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Backups were written before each batch:

- `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-inflected-batch9-20260628.db`
- `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-inflected-batch10-20260628.db`
- `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-inflected-batch11-final-20260628.db`

Batch 9 repaired `49` high-frequency forms such as `got`, `did`, `were`,
`had`, `been`, `has`, `doing`, `came`, `went`, `seen`, `called`, `took`,
`makes`, `comes`, `gets`, and `led`. Batch 10 repaired `57` mid/low-frequency
forms such as `answers`, `stood`, `checking`, `escaped`, `served`, `deeper`,
`cracked`, `decides`, `cancelled`, `lifted`, `freed`, `skipped`, `converted`,
and `destroys`. Batch 11 repaired the last five ambiguous-but-publishable forms
(`leads`, `fed`, `checks`, `cuts`, `noises`) and blocked `cass` with
`blocked_source_ambiguous` because its source gloss mixed calcium and California
abbreviation content that is not a supported lexical sense for the headword.

Post-repair checks passed after every batch: script `node --check`, `npm run
check`, fast product export audit, and published-risk audit. After the final
batch:

- publishable senses: `28580`;
- flagged publishable senses: `281`;
- `broad_multi_definition_gloss`: `187`;
- `inflected_form_repair_or_keep`: `0`;
- batch-12 triage has only `21` function-word keeps and `166` likely keeps.

Blocking export checks remain clean: `duplicate_sense_orders = 0`,
`orphans = 0`, `mojibake_texts = 0`, `html_artifacts = 0`, and
`bad_sense_localization_counts = 0`.

## 2026-06-28 Function-Word Broad-Risk Cleanup

The next deterministic pass handled the `function_word_keep` bucket. These rows
were high-frequency English grammatical words whose source glosses were broad by
nature, but several localized rows still exposed noisy source content. The repair
script is:

```powershell
node scripts/repair-dictionary-v2-product-function-words-batch12-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-function-words-batch12-20260628.db`.
The script repaired `21` function-word senses, including `the`, `to`, `of`,
`is`, `what`, `my`, `was`, `be`, `how`, `when`, `us`, `something`, `into`,
`else`, `against`, `himself`, `unless`, `herself`, `towards`, `per`, and
`toward`.

Most rows were repaired by compressing `gloss_key` and the English definition.
The script also corrected visible lookup quality problems:

- `what` now maps to `what / 什么 / 何 / o que`, not the Chinese question
  particle `吗`;
- `us` now maps to the objective pronoun sense, not the United States;
- `was` no longer exposes the Washington-state source collision;
- `per` no longer uses the bad Portuguese term `dentrode`.

Post-repair checks passed: script `node --check`, `npm run check`, fast product
export audit, and published-risk audit. The corrected published-risk count is
now `262` flagged publishable senses, with `broad_multi_definition_gloss = 166`.
The refreshed batch-13 triage has no LLM split candidates, no manual-review
rows, no inflected-form rows, and no function-word rows. The remaining broad
risk queue is only `166` `likely_keep` rows.

## 2026-06-28 Likely-Keep Broad-Risk Cleanup

The final deterministic broad-risk pass handled the remaining `likely_keep`
bucket. These rows were not good split candidates: the four-language published
localizations were already usable, but `product_senses.gloss_key` still carried
broad source text that kept triggering `broad_multi_definition_gloss`.

The repair script is:

```powershell
node scripts/repair-dictionary-v2-product-likely-keep-glosses-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --triage logs/product-broad-risk-triage-batch13-20260628.json `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-likely-keep-glosses-20260628.db`.
The script compressed `166` likely-keep glosses by rebuilding `gloss_key` from
the English localization definition, then the English term, then the existing
source gloss/headword as fallback. It does not rewrite localized terms,
definitions, readings, pronunciations, examples, or publication state.

Post-repair checks passed: script `node --check`, `npm run check`, fast product
export audit, and published-risk audit. After this pass:

- publishable senses: `28580`;
- flagged publishable senses: `96`;
- `broad_multi_definition_gloss`: `0`;
- final broad-risk triage input senses: `0`;
- remaining published-risk buckets are `short_japanese_particle_or_kana_sense =
37`, `high_source_count_broad_sense = 51`, and `short_gloss_needs_review = 8`.

Blocking export checks remain clean: `duplicate_sense_orders = 0`,
`orphans = 0`, `mojibake_texts = 0`, `html_artifacts = 0`, and
`bad_sense_localization_counts = 0`.

## 2026-06-28 Short-Gloss Risk Cleanup

After broad-risk reached zero, the next pass cleaned the remaining
`short_gloss_needs_review` bucket. The repair script is:

```powershell
node scripts/repair-dictionary-v2-product-short-gloss-batch14-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-short-gloss-batch14-20260628.db`.
The script repaired six short-gloss rows (`寸`, `lex`, `涴`, `Jun`, `mal`,
`hup`) by replacing terse `gloss_key` values with explicit lexical glosses and
rewriting the four-language localizations where needed. It also publication
blocked two unsafe rows:

- `nan`: mixed grandmother, Thai river, and bread senses while publishing bad
  zh/ja localizations as `南`;
- `sod`: mixed an informal British person sense with a turf-covering verb sense.

Post-repair checks passed: script `node --check`, `npm run check`, fast product
export audit, and published-risk audit. After this pass:

- publishable senses: `28578`;
- flagged publishable senses: `88`;
- `short_gloss_needs_review`: `0`;
- remaining published-risk buckets are `short_japanese_particle_or_kana_sense =
37` and `high_source_count_broad_sense = 51`.

Blocking export checks remain clean: `duplicate_sense_orders = 0`,
`orphans = 0`, `mojibake_texts = 0`, `html_artifacts = 0`, and
`bad_sense_localization_counts = 0`.

## 2026-06-28 Japanese Short-Gloss Risk Cleanup

The next pass cleaned the `short_japanese_particle_or_kana_sense` bucket. The
repair script is:

```powershell
node scripts/repair-dictionary-v2-product-japanese-short-batch15-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-japanese-short-batch15-20260628.db`.
The script handled all `37` Japanese short-gloss risk rows. Most rows were
legitimate high-frequency Japanese particles, pronouns, suffixes, loanwords, or
interjections whose `gloss_key` was simply too short. Those rows were repaired
by expanding `gloss_key` and normalizing part-of-speech labels. Five rows also
received full four-language localization repairs: `な`, `ん`, `だい`, `ヨ`,
and `シ`. One unsafe row, `せ`, was publication blocked because it was mapped to
English `so` with weak source evidence and an inconsistent Japanese definition.

Post-repair checks passed: script `node --check`, `npm run check`, fast product
export audit, and published-risk audit. After this pass:

- publishable senses: `28577`;
- flagged publishable senses: `51`;
- `short_japanese_particle_or_kana_sense`: `0`;
- remaining published-risk bucket: `high_source_count_broad_sense = 51`;
- warning counts `zh_terms_with_kana = 0` and `ja_terms_with_latin_only = 0`.

Blocking export checks remain clean: `duplicate_sense_orders = 0`,
`orphans = 0`, `mojibake_texts = 0`, `html_artifacts = 0`, and
`bad_sense_localization_counts = 0`.

## 2026-06-28 High-Source Risk Cleanup

The final published-risk pass cleaned the remaining
`high_source_count_broad_sense` bucket. This bucket was different from the
earlier broad-gloss issues: the published four-language rows were mostly usable,
but each sense still had too many `product_sense_source_links`, which made the
audit treat it as a possible over-merged fusion result. These source links are
not exported to D1; they are local provenance and repair evidence.

The repair script is:

```powershell
node scripts/repair-dictionary-v2-product-high-source-batch16-20260628.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --risk logs/product-published-risk-after-japanese-short-batch15-20260628.json `
  --apply true
```

Before applying, a local backup was written to
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-high-source-batch16-20260628.db`.
The script processed all `51` high-source risk rows. It rebuilt each
`gloss_key` from the current English definition, normalized empty POS labels
where possible, and pruned over-broad provenance links to at most five strongest
source links per sense. It reduced source links on these rows from `395` to
`255`, deleting `140` low-priority links while keeping enough provenance for
future review.

Post-repair checks passed: script `node --check`, `npm run check`, fast product
export audit, and published-risk audit. After this pass:

- publishable senses: `28577`;
- flagged publishable senses: `0`;
- remaining published-risk buckets: none;
- recommended next step from the audit: no published high-risk senses were
  flagged by deterministic checks.

Blocking export checks remain clean: `duplicate_sense_orders = 0`,
`orphans = 0`, `mojibake_texts = 0`, `html_artifacts = 0`, and
`bad_sense_localization_counts = 0`.

## 2026-06-28 Product D1 Native Export Audit

After published-risk reached zero, the product D1 native SQL export was rebuilt
from the current product candidate database:

```powershell
node scripts/export-dictionary-v2-product-native-d1-sql.mjs `
  --db data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db `
  --out-dir outputs/d1-v2-product-native-export `
  --chunk-bytes 7000000

node scripts/audit-dictionary-v2-product-export.mjs `
  --mode full `
  --import memory `
  --out-dir outputs/d1-v2-product-native-export
```

The npm alias `dict:v2:export:product-d1-native` and the exporter default DB
were updated to use
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db`
instead of the older `linguago_v2_product_top5000_fused_only_pilot.db`.

Export stats:

- `v2_entries`: `23060`;
- `v2_entry_forms`: `161114`;
- `v2_pronunciation_groups`: `24885`;
- `v2_senses`: `28577`;
- `v2_sense_localizations`: `114308`;
- `v2_examples`: `3030`;
- `v2_example_localizations`: `11898`;
- SQL data chunks: `15`.

Full import audit passed with `ok = true`. Blocking checks remain clean:
`count_mismatches = 0`, `bad_sense_localization_counts = 0`,
`duplicate_sense_orders = 0`, `orphans = 0`, `mojibake_texts = 0`,
`html_artifacts = 0`, `source_script_mismatches = 0`, and
`duplicate_zh_examples_by_en_reading = 0`.

## 2026-06-28 Product D1 Release Baseline

The clean product D1 release baseline uses:

```text
data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db
```

The native D1 export was pushed to Cloudflare D1 `linguago-dictionary`, the
Worker cache version was bumped, and the Worker was deployed. `/health`
reported:

- `published_at`: `2026-06-28T14:29:50.368Z`;
- `entries`: `23060`;
- `senses`: `28577`;
- `sense_localizations`: `114308`;
- `examples`: `3030`;
- `example_localizations`: `11898`;
- policy: `product_complete_4_lang_accepted_senses_only`.

The pre-release backup SQL to keep outside Git is:

```text
backups/linguago-dictionary-before-product-v2-20260628-233308.sql
```

`logs/`, `output/`, `outputs/`, local SQLite databases, and SQL backups are
run artifacts and should stay untracked.

## Product D1 Release Tooling

Use the combined release command for repeatable product D1 releases:

```powershell
npm run dict:v2:release:product-d1
```

The release script now defaults to the current product DB above. It does not
rewrite Chinese examples by default; use `-SimplifyZhExamples` only when an
explicit local DB mutation is intended. For a local rehearsal without touching
Cloudflare:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release-dictionary-v2-product-d1.ps1 -SkipPush -SkipDeploy -SkipOnlineChecks
```

Fixed release checks:

- `scripts/dictionary-v2-product-regression-check.mjs` validates the local
  product DB against `hello`, `你好`, `inside`, `中`, `杆`, `秘密`, `何時`,
  `国際`, and `ビジター`.
- `scripts/online-dictionary-focused-check.mjs` validates `/health` counts and
  the same online query set against Cloudflare D1.
- `scripts/online-dictionary-render-focused-check.mjs` uses Playwright with the
  installed Microsoft Edge fallback, verifies mobile and desktop rendering,
  checks pronunciation groups / four-language tabs / sense numbering, and
  fails on horizontal overflow or obvious Traditional Chinese examples in the
  Chinese tab.
- `scripts/audit-dictionary-v2-product-export-fast.mjs` uses the same focused
  sample terms by default.

The post-release gate should remain:

```powershell
npm run check
npm run dict:v2:audit:product-fast
node scripts/audit-dictionary-v2-product-published-risk.mjs
node scripts/audit-dictionary-v2-product-export.mjs --mode full --import memory --out-dir outputs/d1-v2-product-native-export
npm run check:online-dictionary
node scripts/online-dictionary-focused-check.mjs
node scripts/online-dictionary-render-focused-check.mjs
```

The blocking audit counters must remain zero: `flagged_senses`,
`bad_sense_localization_counts`, `duplicate_sense_orders`, `orphans`,
`mojibake_texts`, and `html_artifacts`.

## Next Product Quality and Expansion Pass

The current release baseline is stable enough to use as the online product
dictionary. The next local quality target is the full-audit warning
`duplicate_sense_localizations = 98`. Treat this as a warning queue, not as a
release blocker.

Start with a read-only report:

```powershell
npm run dict:v2:report:product-duplicate-senses
npm run dict:v2:triage:product-duplicate-localizations
```

Only merge obvious duplicates. Do not merge senses merely because one language
has the same term and definition if the pronunciations, part-of-speech labels,
source links, or other language localizations indicate distinct senses.
Priority spot checks for the next pass: `暗示`, `得知`, `不足`, `best`, `不用`,
`活`, `下`, `每`, `絶対`, and `上手`.

The 2026-06-29 triage of the current `98` duplicate-localization warning groups
found no safe automatic merge candidates. All `104` reviewed sense pairs were
classified as `likely_keep`: one language reused the same localized term and
definition, but the other language localizations, source evidence, or lexical
role showed distinct senses. Examples include adjective/noun pairs such as
`必要`, grammatical or semantic variants such as `best`, and homographic
Chinese/Japanese character senses such as `活`, `下`, `每`, `絶対`, and `上手`.
Keep this warning as a non-blocking audit signal unless a future LLM/manual
review identifies a concrete over-merge.

Expansion should continue from coverage-gap reports, not from a blind full-DB
completion run:

```powershell
npm run dict:v2:coverage:gaps -- --out logs/product-coverage-gaps-current.json --limit 1000 --include-details true
npm run dict:v2:coverage:filter-gaps -- --in logs/product-coverage-gaps-current.json --out logs/product-coverage-gaps-clean-high-value.json --limit 500
npm run dict:v2:coverage:source-gap-residuals
```

Use Unsloth/Qwen MTP only against the cleaned high-value report first. The
source-gap Unsloth writer now defaults to draft writes when `--apply true` is
used: new product entries and senses are `draft_single_source`, and generated
localizations are kept with `needs_review = 1`. Do not use `--publishable true`
for ordinary expansion batches. Promote into publishable product tables only
after deterministic audit, spot checks, and focused online regression pass.

## 2026-06-29 Coverage Gap Expansion Gate

The high-value coverage gap filter now supports balanced language targets:

```powershell
node scripts/filter-dictionary-v2-product-coverage-gap-report.mjs `
  --in logs/product-coverage-gaps-current-50000.json `
  --out logs/product-coverage-gaps-clean-high-value-balanced-20.json `
  --limit 20 `
  --balanced true `
  --lang-targets zh=8,pt-BR=6,ja=4,en=2
```

The filter reports `eligible_by_lang` and `unmet_lang_targets` so expansion
batches do not silently become single-language queues. With the current
`current-50000` report, strict clean filtering produced `1148` eligible rows:
`zh=569` and `pt-BR=579`. No English or Japanese candidates passed the current
clean gates, so the first 20-row balanced report is filled by `zh=10` and
`pt-BR=10`, with `ja=4` and `en=2` recorded as unmet targets. This means the
next LLM dry-run should test zh/pt source gaps first, while a separate filter
loosening pass is needed before adding ja/en source gaps.

Encoding was checked by reading the JSON with Node as UTF-8 and printing code
points for the first 20 selected headwords. The file contained no replacement
characters; the earlier mojibake seen in PowerShell was console rendering, not
stored JSON corruption.

Before a real Unsloth call, run select-only:

```powershell
node scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs `
  --report logs/product-coverage-gaps-clean-high-value-balanced-20.json `
  --out logs/product-source-gap-unsloth-select-only-balanced-20.json `
  --select-only true `
  --limit 20 `
  --endpoints http://100.99.99.99:11447,http://100.99.99.99:11448 `
  --concurrency 2 `
  --batch-size 1
```

The current select-only run selected `16` rows and skipped `4` rows as
`already_linked_complete_source_gap`. Real generation still requires
`UNSLOTH_API_KEY` in the environment; do not put the bearer token in committed
files or logs. The Unsloth source-gap writer retries one recoverable generation
format error once, including non-JSON content or missing batch `items`.

The first real Unsloth run exposed a model/API stability issue specific to
schema-heavy prompts on `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` `UD-IQ4_NL`: short
chat prompts worked, but prompts containing large empty JSON shape templates
caused `/v1/chat/completions` to close the socket after about 19-24 seconds.
The source-gap runner therefore defaults to `--prompt-mode compact`, which uses
a shorter text instruction and lets the local validator enforce the exact
record shape. Keep `--prompt-mode compact` for production batches unless the
Unsloth runtime/model is retested.

Mixed zh/pt dry-run on the balanced 20 report produced `7/16` accepted: all
accepted rows were `pt-BR`, while zh rows either triggered API disconnects or
copied the Chinese source term into English/Portuguese terms. Split expansion
by source language until the Chinese prompt/model path is fixed:

```powershell
node scripts/filter-dictionary-v2-product-coverage-gap-report.mjs `
  --in logs/product-coverage-gaps-current-50000.json `
  --out logs/product-coverage-gaps-clean-high-value-pt-20.json `
  --limit 20 `
  --balanced true `
  --lang-targets pt-BR=20,zh=0,ja=0,en=0 `
  --fill-remaining false

node scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs `
  --report logs/product-coverage-gaps-clean-high-value-pt-20.json `
  --source-langs pt-BR `
  --dry-run true `
  --apply false `
  --limit 20 `
  --endpoints http://100.99.99.99:11448 `
  --concurrency 1 `
  --batch-size 1 `
  --prewarm true `
  --gguf-variant UD-IQ4_NL `
  --max-seq-length 8192 `
  --speculative-type mtp `
  --prompt-mode compact
```

The first pt-BR-only batch selected `17` rows, skipped `3` already-complete
source gaps, and accepted `17/17` in dry-run at roughly 1.3-2.2 seconds per row.
Those 17 rows were then written as draft, deterministically promoted, and the
fast product audit plus published-risk audit stayed clean. Publishable senses
increased from `28577` to `28594`.

Generated rows must remain draft until promoted:

```powershell
npm run dict:v2:coverage:promote-source-gap-drafts -- --limit 50
```

This command is dry-run by default. It only promotes with `--apply true`, and
only when a draft source-gap sense has complete four-language localizations,
source-language term/source link alignment, Chinese and Japanese readings,
English and Portuguese pronunciations, no mojibake, no HTML artifacts, and no
Traditional Chinese smoke-test hits in Chinese examples. Promotion changes
`draft_single_source` rows to `accepted`, clears localization review flags, and
renumbers the entry's senses to `1..n`.

2026-06-30 pt-BR source-gap expansion release:

- Expanded the pt-BR-only clean source-gap report to `271` candidates from
  `logs/product-coverage-gaps-current-50000.json`.
- After previous coverage, select-only found `177` remaining model candidates
  and skipped `94` already-linked complete source gaps.
- Dry-run accepted `158/177`; apply accepted the same `158/177`, inserting
  `157` new entries, `158` draft senses, and `632` draft localizations.
- Deterministic promotion accepted `157/158`. The single rejected draft was
  `ouvinte` / `audience`, where the model shifted the source term to plural
  `ouvintes/listeners`; it remains unpublished for later manual cleanup.
- Post-promotion checks passed: `npm run check`, product fast audit, and
  published-risk audit with `flagged_senses = 0`.
- Full product D1 native export passed import audit at
  `outputs/d1-v2-product-native-export-pt-expansion-20260630`.
- Published D1 counts after push: `entries=23308`, `senses=28825`,
  `sense_localizations=115300`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v60-pt-source-gap-expansion"` and deployed as
  Worker version `bb0d265c-2386-40c6-b82c-3a6caccd2f04`.
- Post-release checks passed: `/health`, `online-dictionary-focused-check`,
  `online-dictionary-render-focused-check`, and `npm run check:online-dictionary`.

2026-06-30 pt-BR residual source-gap release:

- After the v60 release, the pt-BR 271 report had `20` clean residual source
  gaps plus the blocked `ouvinte/ouvintes` singular-plural mismatch.
- The first residual dry-run accepted only `1/20` because the compact prompt
  allowed the model to copy the English gloss into localized definitions or
  copy source spellings into target-language terms. The residual reporter now
  carries `gloss_key` and `gloss_preview`, and the Unsloth prompt explicitly
  requires natural localized definitions instead of copied gloss text.
- With the revised residual prompt, the residual dry-run accepted `20/20`;
  apply inserted `19` new entries, reused `1` existing entry, inserted `19`
  new senses, reused `1` existing sense, and upserted `80` localizations.
- Deterministic promotion accepted `19/19`. The remaining residual is still
  the `ouvintes` source row linked to singular entry `ouvinte`; keep it in
  `needs_review` until a singular/plural policy is implemented.
- Post-promotion checks passed: `npm run check`, product fast audit,
  published-risk audit, full product D1 native export audit, `/health`,
  `online-dictionary-focused-check`, `online-dictionary-render-focused-check`,
  and `npm run check:online-dictionary`.
- Full product D1 native export passed import audit at
  `outputs/d1-v2-product-native-export-pt-expansion-residual-20260630`.
- Published D1 counts after push: `entries=23327`, `senses=28844`,
  `sense_localizations=115376`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v61-pt-source-gap-residual"` and deployed as
  Worker version `d168423d-7dfc-43b6-94ea-7f9ad8eefb26`.

2026-06-30 zh-only source-gap pilot release:

- Built `logs/product-coverage-gaps-clean-high-value-zh-20.json` from the
  current 50k coverage gap report with `zh=20` and no fill from other languages.
  It selected `20` clean zh candidates; select-only skipped `1` already-covered
  row and left `19` model candidates.
- The first compact prompt dry-run accepted only `7/19`. All `12` rejected rows
  had the same issue: English and Portuguese `term` copied the Chinese source
  spelling, while the localized definitions were otherwise usable.
- The compact prompt now explicitly requires zh/ja source rows to translate
  `en.term` and `pt-BR.term` into English/Portuguese dictionary terms, and to
  make English/Portuguese IPA pronounce those translated terms rather than the
  source-language word.
- The second dry-run accepted `19/19`; apply wrote `19` draft entries/senses,
  `76` localizations, and `19` source links.
- Deterministic promotion accepted `19/19`, promoting `19` senses and `76`
  localizations. Product fast audit, published-risk audit, full product D1
  native export audit, online focused API check, and online render check passed.
- Full product D1 native export was published from
  `outputs/d1-v2-product-native-export-zh-source-gap-20260630`.
- Published D1 counts after push: `entries=23346`, `senses=28863`,
  `sense_localizations=115452`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v62-zh-source-gap-pilot"` and deployed as
  Worker version `b8cf39ec-6c73-4b49-b9a3-ac2f90f76630`.

## 2026-06-30 zh Source-Gap 100 Release

- Regenerated a zh-only clean high-value coverage-gap report with `limit=100`.
  Select-only skipped `20` already complete source-gap rows and selected `80`
  model candidates.
- Initial dry-run accepted `78/80`; two failures exposed reading-format and
  low-value proper-name filtering gaps. The filter now rejects romanized CJK
  administrative-name glosses, and the compact Unsloth prompt explicitly
  requires Chinese readings to be pinyin and Japanese readings to contain kana.
- The second dry-run accepted `80/80`; apply wrote `80` draft entries/senses,
  `320` localizations, and `80` source links.
- Deterministic promotion accepted `80/80`. A final published-risk pass found
  two overly broad `gloss_key` values (`意見`, `騙子`); those were narrowed to
  concise meaning labels, and the supplement/promote scripts now reject
  `gloss_key` values with five or more semicolon-separated parts.
- Product fast audit, published-risk audit, full product D1 native export audit,
  and fixed online focused API/render checks passed for the new package.
- Full product D1 native export was published from
  `outputs/d1-v2-product-native-export-v63-zh-source-gap-100`.
- Published D1 counts after push: `entries=23426`, `senses=28943`,
  `sense_localizations=115772`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v63-zh-source-gap-100"` and deployed as Worker
  version `67641b31-e6c3-4446-9abb-a40fc63a4f49`.

## 2026-06-30 Balanced Source-Gap 80 Release

- Regenerated the current 50k coverage-gap snapshot after v63. The raw report
  still contains many low-value letters, acronyms, proper names, and thin
  one-language rows, so the high-value filter remained mandatory.
- Built a balanced clean report targeting `zh=80`, `pt-BR=60`, `ja=40`,
  `en=20`; current filters yielded `140` clean candidates (`zh=80`,
  `pt-BR=60`) and no clean `ja/en` candidates under the current evidence
  thresholds.
- Select-only skipped `4` already linked rows and selected `136` candidates.
  The first 80-row dry-run accepted `80/80` using the dual 4090 Unsloth MTP
  endpoints.
- Apply wrote `80` draft senses and `320` localizations, creating `78` entries
  and reusing `2` existing entries.
- Deterministic promotion accepted `78/80`. The two rejected rows,
  `ouvintes -> ouvinte` and `bisavó -> bisavô`, remain draft/needs-review
  because their source terms do not match the reused product entries.
- Product fast audit, published-risk audit, full product D1 native export audit,
  online focused API check, online render check, and online dictionary
  regression passed.
- Full product D1 native export was published from
  `outputs/d1-v2-product-native-export-v64-balanced-80`.
- Published D1 counts after push: `entries=23504`, `senses=29021`,
  `sense_localizations=116084`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v64-balanced-source-gap-80"` and deployed as
  Worker version `e897a367-3da5-4e09-889c-1d836d87c116`.

## 2026-06-30 Post-v64 Source-Gap Follow-up

- Re-ran selection against the v64 balanced clean report. `pt-BR` had no
  remaining publishable source-gap candidates after excluding the known
  `ouvintes/ouvinte` and `bisavó/bisavô` form mismatches.
- The remaining candidates were all `zh`; a stricter local filter removed
  traditional variants, single characters, proper-name redirects, `see ...`
  rows, `short for ...` rows, and historical/variant forms. That left `18`
  simplified, multi-character zh candidates for a future retry.
- No database writes were applied in this follow-up. Product fast audit and
  published-risk audit still passed with v64 publishable counts.
- Current Unsloth Studio generation is unstable for the dictionary prompt on
  the 4090 endpoints: 27B/35B model load and minimal chat requests work, but
  real source-gap generation returns `TypeError: fetch failed` around the
  service timeout. `/v1/status` reported `llama_cpp_prebuilt_stale=true` on the
  loaded 27B endpoint during this test.
- Added `--prompt-mode ultra` to
  `scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs` as a
  shorter schema-preserving fallback prompt, and expanded fetch error messages
  to include the underlying cause when Node exposes one.
- Added `--strict-zh true` and `--block-known-residuals true` to
  `scripts/filter-dictionary-v2-product-coverage-gap-report.mjs`. The strict zh
  mode filters traditional variants, single-character rows, redirect/proper-name
  glosses, and source-term residuals before LLM generation. On the post-v64
  balanced report it reduced the remaining zh queue to `21` actual select-only
  candidates.

## 2026-06-30 Strict zh Ultra Source-Gap 20 Release

- Retried the strict zh queue after the Unsloth 4090 endpoint recovered.
  `Qwen3.6-27B-MTP-GGUF` with `--prompt-mode ultra`, `max_tokens=512`, and
  single-node concurrency completed quickly at roughly 3.5-4.8 seconds per row.
- Full strict zh dry-run accepted `20/21`; `平安夜` stayed out of the apply set
  because the model returned romaji (`kurisumasu ibu`) instead of kana for
  Japanese reading.
- Applied `20` draft source-gap senses and `80` localizations, then deterministic
  promotion accepted all 20 new zh senses. The two existing rejected pt-BR
  residuals (`ouvintes/ouvinte`, `bisavó/bisavô`) remain draft review rows.
- Product fast audit, published-risk audit, and full product D1 native export
  audit passed after promotion.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v66-zh-strict-ultra-20`.
- Export counts: `entries=23524`, `senses=29041`,
  `sense_localizations=116164`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v66-zh-strict-ultra-20"` and deployed as Worker
  version `47c6e6c2-e39d-4aff-ad3e-b4cc84392d5f`.

## 2026-06-30 Pingan Source-Gap Follow-up

- Retried the held-out `平安夜` row. The model still returned romaji for Japanese
  reading, so the row was manually repaired as the high-value `Christmas Eve`
  sense and inserted as a normal `draft_single_source` row.
- Deterministic promotion accepted the repaired row. The two older pt-BR
  residuals remain blocked in draft review.
- Product fast audit, published-risk audit, and full product D1 native export
  audit passed after promotion.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v67-pingan`.
- Export counts: `entries=23525`, `senses=29042`,
  `sense_localizations=116168`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to `TRANSLATION_CACHE_VERSION = "v67-pingan"`.
- D1 was pushed and the Worker was deployed as version
  `31b2b58e-006d-4bd9-b4ad-bf56a7bd409d`; `/health` reported
  `published_at=2026-06-30T14:08:00.788Z`.

## 2026-07-01 Strict zh-first Source-Gap 25 Release

- Regenerated coverage gaps with a larger candidate window:
  `logs/product-coverage-gaps-current-v68.json`.
- Built a strict zh-first clean queue in
  `logs/product-coverage-gaps-clean-high-value-balanced-v68-30-strictzh.json`;
  known pt-BR residuals were blocked, first-sense clean localization was relaxed
  to allow high-value source-gap rows, and traditional/single-character zh rows
  were filtered out.
- Initial dual-node dry-run failed because `11447/11448` had no loaded model and
  temporarily timed out. Portproxy remained configured; `rtx4090-56` recovered,
  auto-loaded `unsloth/Qwen3.6-27B-MTP-GGUF`, and was used as the stable node.
- Dry-run accepted `25/25` generated rows. Five selected candidates were skipped
  before generation because they were already complete or failed deterministic
  candidate eligibility.
- Applied the same batch as `draft_single_source`, then deterministic promote
  accepted `25` senses and `100` localizations. The two older pt-BR residuals
  remain blocked by `source_term_mismatch` / `source_link_word_mismatch`.
- Product fast audit, published-risk audit, and full product D1 native export
  audit passed after promotion.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v68-source-gap-25`.
- Export counts: `entries=23550`, `senses=29067`,
  `sense_localizations=116268`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v68-source-gap-25"`.
- D1 was pushed and the Worker was deployed as version
  `884c0937-2e60-4c6d-873b-0de5516328c6`; `/health` reported
  `published_at=2026-06-30T17:05:29.385Z`.

### v69 A6000 Source-Gap Batch

- A6000 quality-first nodes were added for the next source-gap pass:
  `a6000-143` at `100.99.99.99:11441` and `a6000-147` at
  `100.99.99.99:11444`.
- Both nodes used Unsloth `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` with
  `gguf_variant=UD-Q4_K_XL`, `speculative_type=mtp`, `max_seq_length=8192`,
  `batch-size=1`, and generation-only draft writes.
- The 20-row dry-run accepted `20/20` generated rows.
- The 100-row draft apply selected `100`, skipped `33` before generation,
  generated `100`, accepted `99`, and rejected `1`.
- Deterministic promote scanned `101` draft rows, promoted `94` senses and
  `376` localizations, and left `7` draft rows blocked by
  `source_term_mismatch` / `source_link_word_mismatch`: `罷/霸`, `臺/苔`,
  `赴/敷`, `濟/積`, `扬/洋`, `ouvinte/ouvintes`, and `bisavô/bisavó`.
- Product fast audit, published-risk audit, and full product D1 native export
  audit passed after promotion. `duplicate_sense_localizations=98` remains a
  non-blocking warning.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v69-a6000-source-gap`.
- Export counts: `entries=23644`, `senses=29161`,
  `sense_localizations=116644`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v69-a6000-source-gap-94"`.
- D1 was pushed and the Worker was deployed as version
  `e8314f3b-d20e-42b2-a4cc-4670006370fd`; `/health` reported
  `published_at=2026-07-01T05:20:42.529Z`.
- Online render focused check, online focused API check, and full online
  dictionary regression passed after deployment. The focused API check initially
  failed only because its fixed expected counts still pointed to v68; those
  expected counts were updated to v69.

### v70 Source-Gap Batch

- A fresh v69 coverage gap report was generated as
  `logs/product-coverage-gaps-current-v69.json`, then filtered to
  `logs/product-coverage-gaps-clean-high-value-balanced-v70-120-first0.json`.
  The clean report produced 120 candidates: 87 English, 30 Chinese, and 3
  pt-BR; no Japanese candidates passed the current clean filter.
- The source-gap supplement pre-generation skip rule was narrowed so
  `one's` / `possessive` / `demonstrative` only blocks English source rows. This
  fixed false skips for Chinese candidates such as `出手` and `心事`, whose
  English glosses contained `one's`.
- A mixed 20-row dry-run on `a6000-143` and `a6000-147` with Unsloth
  `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` / `UD-Q4_K_XL` accepted all `17/17`
  generated rows after three already-complete pt-BR rows were skipped.
- The 100-row draft apply selected `100`, skipped `3` already-complete pt-BR
  rows, generated `100`, accepted `99`, and rejected `1` (`audible`, blocked by
  `term_language_zh`). It inserted 99 draft entries/senses and 396
  localizations.
- Deterministic promote scanned 106 draft rows, promoted the 99 new v70 senses
  and 396 localizations, and left the seven older v69 source-term mismatch
  drafts in review.
- Product fast audit, published-risk audit, and full product D1 native export
  audit passed after promotion. `duplicate_sense_localizations=98` remains a
  non-blocking warning.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v70-source-gap-99`.
- Export counts: `entries=23743`, `senses=29260`,
  `sense_localizations=117040`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v70-source-gap-99"`.
- D1 was pushed and the Worker was deployed as version
  `c7d2d544-563a-4ae4-bea5-011fa767fccf`; `/health` reported
  `published_at=2026-07-02T00:38:14.774Z`.
- Online focused API check, full online dictionary regression, and online render
  focused check passed after deployment.

### v71 Source-Gap Batch

- A fresh v70 coverage gap report was generated as
  `logs/product-coverage-gaps-current-v70.json`, then filtered to
  `logs/product-coverage-gaps-clean-high-value-balanced-v71-120-first0-r4.json`.
  Candidate filtering was tightened to reject English capitalized proper-like
  headwords and zh rows whose gloss is only a Latin proper name. The repeated
  `audible` football-play residual was added to the known residual block list
  for generic source-gap batches.
- The strict v71 filter found no clean zh candidates under the current quality
  gates. The 120 clean candidates were mostly English high-value source gaps
  with three already-complete pt-BR rows still present in the report.
- A 20-row A6000 dry-run on `a6000-143` and `a6000-147` with Unsloth
  `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` / `UD-Q4_K_XL` accepted `19/20`. The
  only failure was the known `audible` `term_language_zh` residual.
- The 100-row draft apply selected `100`, skipped `3` already-complete rows,
  generated `100`, accepted `98`, and rejected `2` (`maneuver`,
  `allegedly`). It inserted 98 draft entries/senses and 392 localizations.
- Deterministic promote scanned 105 draft rows, promoted the 98 new v71 senses
  and 392 localizations, and left the seven older source-term mismatch drafts
  in review.
- Product fast audit, published-risk audit, and full product D1 native export
  audit passed after promotion. `duplicate_sense_localizations=98` remains a
  non-blocking warning.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v71-source-gap-98`.
- Export counts: `entries=23841`, `senses=29358`,
  `sense_localizations=117432`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v71-source-gap-98"`.
- D1 was pushed and the Worker was deployed as version
  `8474ca2e-6a2c-4347-a963-4c817ece67cb`; `/health` reported
  `published_at=2026-07-02T01:03:18.149Z`.
- Online focused API check, full online dictionary regression, and online render
  focused check passed after deployment.

### v72 Four-Node Source-Gap Batch

- A fresh v71 coverage gap report was generated as
  `logs/product-coverage-gaps-current-v71.json`, then filtered to
  `logs/product-coverage-gaps-clean-high-value-balanced-v72-160-first0-r4.json`.
  The final clean report selected 160 candidates after blocking repeated
  residuals such as `audible`, `maneuver`, `allegedly`, `tram`, and `minimal`.
- The 20-row verification pass split work across the four available Unsloth
  nodes. `a6000-143` and `a6000-147` used
  `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` / `UD-Q4_K_XL` and accepted `20/20`.
  `rtx4090-47` and `rtx4090-56` used the 4090-safe 35B MTP deployment and
  accepted `18/20`; the rejected `tram` and `minimal` rows were added to the
  residual block list before the apply pass.
- The formal apply batch inserted draft rows from both halves: A6000 accepted
  `60/60`, while 4090 selected `60`, skipped `3` already-complete source gaps,
  accepted `56`, and rejected one transient JSON parse failure (`touchy`).
- Deterministic promote accepted `116` new source-gap draft senses and `464`
  localizations. Product fast audit, published-risk audit, and full D1 native
  export audit passed; `duplicate_sense_localizations=98` remains a
  non-blocking warning.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v72-four-node-source-gap-116`.
- Export counts: `entries=23957`, `senses=29474`,
  `sense_localizations=117896`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v72-four-node-source-gap-116"`.
- D1 was pushed and the Worker was deployed as version
  `d205cbae-27c2-4bd3-be2b-bc6f2078b561`; `/health` reported
  `published_at=2026-07-02T11:20:40.928Z`.

### v73 Four-Node Source-Gap Batch

- A fresh v72 coverage gap report was generated as
  `logs/product-coverage-gaps-current-v72.json`. With strict filtering and
  `min-first-sense-langs=0`, the clean report
  `logs/product-coverage-gaps-clean-high-value-balanced-v73-200-first0-r1.json`
  selected `137` candidates: `134` English and `3` pt-BR. No zh or ja
  candidates passed the current strict quality gates.
- The 20-row dry-run split the work across A6000 143/147 and 4090 47/56 and
  accepted `20/20`.
- The 100-row draft apply selected `100`, skipped `3` already-linked complete
  source gaps, generated `97`, accepted `97`, and rejected `0`. A6000 handled
  `47` accepted rows after `3` skips; 4090 handled `50` accepted rows.
- Deterministic promote accepted all `97` new draft senses and `388`
  localizations. The seven older source-term mismatch drafts remained in
  review. Product fast audit, published-risk audit, and full product D1 native
  export audit passed; `duplicate_sense_localizations=98` remains a
  non-blocking warning.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v73-four-node-source-gap-97`.
- Export counts: `entries=24054`, `senses=29571`,
  `sense_localizations=118284`, `examples=3030`,
  `example_localizations=11898`.
- Worker cache version was bumped to
  `TRANSLATION_CACHE_VERSION = "v73-four-node-source-gap-97"`.
- D1 was pushed and the Worker was deployed as version
  `1ac2e9a2-b452-4ed9-b714-97a5eabb4014`; `/health` reported
  `published_at=2026-07-02T11:35:54.965Z`.

### v82 WikDict/OMW Source-Gap Batch

- The v81 strict high-value report contained 333 zh, pt-BR, and ja candidates.
  After generation and deterministic promotion, 309 source gaps are complete,
  17 remain linked to draft/review senses, and 7 remain generation residuals.
- Draft generation now skips source senses already linked to accepted or draft
  product senses. Draft writes no longer reuse accepted equivalent senses.
- Promotion adds semantic drift checks for English term/gloss disagreement and
  the recurring luck/fortune mistranslation pattern.
- Product fast audit, published-risk audit, and full in-memory D1 export audit
  passed. `flagged_senses=0`, localization count errors, orphan rows, mojibake,
  HTML artifacts, and duplicate sense orders are all zero.
- Full product D1 native export was written to
  `outputs/d1-v2-product-native-export-v82` with `entries=25060`,
  `senses=30577`, `sense_localizations=122308`, `examples=3030`, and
  `example_localizations=11898`.
- Worker cache version is `v82-source-gap-r2-213`. D1 was pushed and the Worker
  was deployed as version `0bdb4ca1-cc55-48a3-b555-c15f0d7e38dd`; `/health`
  reports `published_at=2026-07-10T18:28:23.903Z`.
- Focused API, full online dictionary, and mobile/desktop render checks passed.
  The remote D1 backup made before release is
  `backups/linguago-dictionary-before-v82-20260711-032736.sql`.

### v83 Large-Batch Preparation

The consolidated operational handoff for this section is
`docs/dictionary-v83-large-batch-runbook.md`. Use it for current commands,
failure recovery, expansion gates, and the distinction between online v82 and
local-only v83. The bullets below remain the chronological evidence log.

- The final-gate reverse-evidence diagnostic exposed two validator defects.
  Generated `gloss_key` can be a multilingual source summary, so it must not be
  used as the English reverse-lookup anchor. Generation now persists the
  reviewed `source_meaning_anchor` separately and reverse validation prefers it.
- OMW remains insufficient by itself, but an exact OMW match may count as an
  independent family when it agrees with Wiktionary or another lexical family.
  This matches the prefilter policy while still collapsing Kaikki and WikDict
  into the single `wiktionary` family.
- On the 34-row independent-family diagnostic, the corrected validator changed
  reverse evidence from `7/29` supported with 15 unsupported rows to `29/30`
  supported, one manual review, and zero unsupported rows. Generation was
  `30/34` valid (`88.2%`), so this diagnostic does not pass the `>=90%`
  generation gate and must not be written or promoted.
- The subsequent formal gate rebuilt 109 strict candidates without counting
  Kaikki and WikDict separately. The first 100 source reviews accepted 94; a
  bounded replacement pass reviewed the remaining nine and accepted eight.
  Qwen produced 81/94 valid initial rows and 7/8 valid replacements, yielding
  88 valid slots after replacement (`93.6%`). Network and JSON failures were
  zero on A6000-143 and RTX4090-56.
- Corrected reverse evidence supported 75/88 (`85.2%`), with nine manual and
  four unsupported rows excluded. Independent Gemma 4 31B on A6000-155 then
  accepted 69/75 (`92%`) with zero failed reviews. The end-to-end promotable
  count was therefore only 69/100, below the required 80/100 gate. No draft or
  product DB write was performed, and the 500-row write gate remains blocked.
- For Gemma `unsloth/gemma-4-31B-it-qat-GGUF`, do not request
  `UD-IQ4_NL`: that filename does not exist and Studio returns an HTTP 500
  wrapping a Hugging Face 404. Omitting `gguf_variant` correctly selects the
  locally downloaded default quantization on A6000-155.

- Coverage scanning was expanded to rank 200,000 and a 50,000-row raw gap
  report. Strict filtering produced 2,970 Tier B candidates with at least three
  entry-level languages and 5,000 Tier C candidates with at least two.
- Seven repeatedly failing source entries, including `gadget`, are routed to
  manual residual review by source entry ID. Offensive gloss filtering was
  extended for the large candidate pool.
- The source-gap runner now commits draft data every configurable chunk,
  persists a report/model fingerprinted checkpoint, resumes without duplicate
  senses, retries recoverable generation failures, and reroutes work after an
  endpoint circuit opens.
- `scripts/source-gap-large-batch-check.mjs` validates two chunk commits,
  failure-endpoint rerouting, checkpoint completion, and zero duplicate senses
  after resume. It is exposed as `npm run check:source-gap-large-batch`.
- Generation can require `source_evidence_valid=true`, allowing Qwen to reject
  source dictionary mappings that are unrelated to the source headword before
  any draft is written.
- The four requested nodes use ports 11441, 11442, 11444, and 11447. Their
  Unsloth-managed llama.cpp prebuilt was updated from b9739 to b9940. GPU smoke
  testing must resume with forced model reload because stale Studio loaded state
  was observed after inference crashes.
- Long schema prompts did not return a first token before the jump-host relay
  reset the connection. `--prompt-mode micro` now uses a compact array response
  and converts it back to the existing product localization shape before normal
  validation. This reduced warm inference to roughly 1-3 seconds per entry.
- The stable load profile is context 1024, speculative decoding off, and no
  redundant `load_in_4bit` flag. A6000 143/144/147 use `UD-Q4_K_XL`; RTX 4090-56
  must use its cached `UD-IQ4_NL` through `--endpoint-gguf-variants
11447=UD-IQ4_NL` because Q4 XL leaves only about 1 GB VRAM headroom.
- The balanced 20-row smoke reached 18/20 accepted after excluding four confirmed
  source-evidence mismatches. Network resets were still observed when all four
  models were force-loaded together. The 4090-56 IQ4 profile passed a separate
  five-request network smoke after isolated loading, but still reset its first
  request in repeated combined four-node runs after a 60-second prewarm. A
  one-second endpoint cooldown did not fix it. The three A6000 nodes had zero
  network failures in the final run. Do not start the 500-row write until 56 is
  repaired/replaced or a three-node production exception is explicitly accepted.
- RTX 4090-56 was also tested with its cached `Qwen3.6-27B-MTP-GGUF /
UD-Q4_K_XL` after a 60-second prewarm. The 20-row run accepted 13, rejected
  five source-evidence mappings, had one validation rejection and one socket
  reset (`5%` endpoint failure rate). It was slower than the 35B micro path at
  roughly 2.3-5.3 seconds for most successful calls, so 27B is not an acceptable
  production fallback on this node.
- With only A6000-143 and RTX 4090-56 available, Studio on 56 was fully restarted
  through the dashboard control API. The stable dual-node profile is 143
  `UD-Q4_K_XL`, 56 `UD-IQ4_NL`, context 1024, speculative mode off,
  `temperature=0`, micro prompt, and a one-second endpoint cooldown. The final
  dual-node smoke accepted 19/20 with one evidence rejection, zero validation
  rejections, and zero network failures on both nodes.
- The first v83 production validation selected 500 Tier C rows; 497 required
  generation. It wrote 377 draft senses in ten 50-row transactions, with 84
  evidence rejections and 36 validation rejections. Checkpoint-scoped promotion
  recovered the original source gloss from the coverage report and promoted 297
  deterministic passes; 80 remain draft for semantic review. Promote rate was
  78.8%, slightly below the 80% gate, so the 2,000-row expansion is paused.
- Post-promote fast audit and published-risk audit passed with
  `publishable_senses=30874` and `flagged_senses=0`. Full in-memory D1 export
  audit passed at `outputs/d1-v2-product-native-export-v83-500` with 25,357
  entries, 30,874 senses, 123,496 sense localizations, and all structural/content
  blockers at zero. This export has not been pushed to D1.
- The 80 deterministic rejects were then reviewed independently on 143/56.
  The promote override is intentionally narrow: only `accept_synonym` decisions
  at confidence `>=0.95`, with no risk flags, may override token-level semantic
  mismatch. Broad glosses still require splitting and cannot be approved by a
  synonym decision. Six additional senses were promoted, raising the 500-row
  checkpoint result to `303/377` (`80.37%`) while keeping
  `flagged_senses=0`. The audited local export
  `outputs/d1-v2-product-native-export-v83-500-semantic` contains 25,363
  entries, 30,880 senses, and 123,520 sense localizations.
- The next pressure run selected 2,000 new rows after excluding all 500 source
  IDs from the validation batch. Current high-confidence pool composition was
  highly imbalanced: 1,399 pt-BR, 598 ja, 3 zh, and no en rows completed.
  Generation accepted 1,405 and rejected 595; deterministic promote accepted
  1,199 of those drafts (`85.34%`) and kept 206 in review. The generation
  acceptance rate was only `70.25%`, so this does not satisfy the 5,000-row
  expansion gate.
- A real interruption exposed a resume bug: `--resume --limit 2000` selected
  2,000 additional rows instead of filling the remaining total. The runner now
  uses `limit - checkpoint_completed`, and the integration fixture includes
  more candidates than the limit so accidental expansion fails the test. On
  Windows, terminating the parent PowerShell did not stop its child Node
  process; the residual process briefly wrote outside the final checkpoint.
  `reconcile-dictionary-v2-product-source-gap-checkpoint.mjs` compared the
  pre-run baseline, report, and checkpoint and removed 176 newly created,
  untracked single-sense draft entries. A verification pass reports zero
  untracked rows.
- Pressure-run infrastructure did not pass the production gate. The final
  checkpoint recorded 110 infrastructure rejects (`5.5%`), including 105
  `all_endpoints_unavailable` results after circuit breakers opened. Node 143
  accepted 1,048/1,339 assigned rows; node 56 accepted 357/556. The 56 endpoint
  also recorded 32 request failures versus 9 on 143. Do not start 5,000 rows
  until circuit-breaker recovery/rerouting is fixed and the candidate pool is
  rebuilt with better source evidence.
- After promoting the 1,199 deterministic passes, fast audit and published-risk
  audit passed with `publishable_senses=32079` and `flagged_senses=0`. Full
  in-memory D1 audit passed at
  `outputs/d1-v2-product-native-export-v83-pressure-2000` with 26,562 entries,
  32,079 senses, 128,316 sense localizations, 3,030 examples, and all blockers
  at zero. This export has not been pushed to D1.
- The source-gap scheduler now resets an open circuit after a configurable
  `--circuit-breaker-reset-ms` interval and gives a task one bounded recovery
  cycle after all endpoints have experienced a transient failure. The local
  integration check covers permanent-failure rerouting, half-open recovery,
  checkpoint resume, and duplicate prevention.
- A stricter Tier B follow-up can exclude prior checkpoint/report source IDs
  through `--exclude-source-entry-id-files`. Excluding the v83 500 and 2,000
  checkpoints left 1,437 candidates with at least three entry languages and two
  first-sense languages; the next 500 pool contains 350 pt-BR and 150 ja rows.
- After the client network changed, both 143 and 56 had zero request failures in
  consecutive 10/15-row tests. Both nodes were also updated through Studio's
  official `/api/llama/update` endpoint from b9940 to b9975. A retry prompt for
  contradictory evidence verdicts and incomplete English gloss terms raised the
  same 15-row dry-run from 13/15 to 15/15.
- The first Tier B 100-row draft run accepted 81, with nine intentional source
  evidence rejects, nine validation rejects, and one infrastructure reject.
  Deterministic promote accepted 78/81 (`96.3%`) and kept three semantic-drift
  rows in draft. Full in-memory audit passed at
  `outputs/d1-v2-product-native-export-v83-tier-b-100` with 26,640 entries,
  32,157 senses, 128,628 sense localizations, and all blockers at zero. This
  export has not been pushed to D1. Do not expand to 500 until raw generation
  acceptance is raised from 81% to the 90% gate.
- On 2026-07-14, broad-gloss filtering removed 131 unsuitable candidates before
  model use. A fresh 20-row dry-run accepted 18 with no infrastructure failures.
  The next real batch generated 99 rows, wrote 85 drafts, and deterministically
  promoted 78; seven strict English term/gloss mismatches stayed in draft. The
  full in-memory export audit passed at
  `outputs/d1-v2-product-native-export-v83-tier-b-fresh-100` with 26,718
  entries, 32,235 senses, and 128,940 sense localizations. The runner now keeps
  malformed JSON out of infrastructure/circuit metrics and performs one
  cross-endpoint format recovery. Raw generation acceptance was 85.9%, so the
  500-row gate remains closed and nothing was deployed.
- A later live dry-run exceeded 15 minutes because transport `fetch failed` was
  incorrectly allowed to enter the model-load retry path. Its child Node process
  was stopped and the dry-run made no DB changes. The runner now reserves model
  loading for explicit unloaded-model responses and returns transport failures
  directly to cross-endpoint scheduling. Revalidate this with a short live smoke
  test before another write batch.
- After changing networks on 2026-07-15, the bounded smoke test completed with
  zero infrastructure failures. Supplying compact WikDict/OMW first-sense
  evidence in the micro prompt improved a repeated batch from 7/9 to 9/9; a
  separate fresh dry-run accepted 20/20. The next 99 generated rows yielded 97
  drafts and 93 deterministic promotions, with zero network, JSON, or validator
  failures. Full export audit passed at
  `outputs/d1-v2-product-native-export-v83-evidence-fix-100` with 26,811
  entries, 32,328 senses, and 129,312 localizations. The 500-row draft gate is
  open; nothing from v83 is deployed.
- The subsequent 500-row pressure batch generated 498 new rows, accepted 472
  drafts (`94.8%`), and promoted 449 (`95.1%`). There were no infrastructure or
  JSON failures. Full in-memory audit passed at
  `outputs/d1-v2-product-native-export-v83-evidence-fix-500` with 27,260
  entries, 32,777 senses, and 131,108 localizations; all blockers and
  `flagged_senses` are zero. Rebuild coverage gaps before the 2,000-row gate,
  because the old strict pool has only about 539 unused rows. Nothing from v83
  is deployed.
- Rebuilding coverage against the latest product DB produced 819 strict Tier B
  candidates. A new 500-row report generated 496 rows, accepted 460 drafts
  (`92.7%`), and promoted 443 (`96.3%`). Two 143 socket failures were recovered
  by scheduler rerouting; final infrastructure rejects were zero. Full audit
  passed at `outputs/d1-v2-product-native-export-v83-post-500-production-500`
  with 27,703 entries, 33,220 senses, and 132,880 localizations. Approximately
  319 strict candidates remain; finish them before introducing a reviewed Tier
  C pool. Nothing from v83 is deployed.

## Database

The new four-language, sense-aligned SQLite / Cloudflare D1-compatible schema is in:

```text
data/schema/dictionary-v2.sql
```

See `docs/dictionary-v2-schema.md` for the design notes and acceptance checks.

The older planned schema reference, `data/schema/dictionary.sql`, belongs to the pre-v2 pipeline and should not be used for the next rebuild.

The v2 schema keeps these layers separate:

- `dictionary_sources`, `source_entries`, `source_senses`: source/staging data from public dictionaries.
- `entries`, `entry_forms`, `senses`: canonical lookup entries and sense identity.
- `pronunciation_groups`: optional headword reading groups for polyphonic or homographic entries; published D1 uses `v2_pronunciation_groups` and `v2_senses.pronunciation_group_id`.
- `sense_localizations`: four-language term, reading, pronunciation, definition, and usage note rows keyed by `sense_id + lang`.
- `examples`, `example_localizations`: sense-attached examples with four-language text keyed by `example_id + lang`.
- `llm_completion_jobs`, `quality_issues`: generated-data tracking and validation results.

The final 2026-07-15 Tier B remainder accepted 302/319 drafts and promoted 294.
A complete scan then showed that the earlier 50,000-row raw report was only a
moving window over 73,436 gaps. The remaining 1,281 lower-rank candidates under
the two-language first-sense rule passed smoke at only 13/16. Requiring three
first-sense languages produced 192 rows, passed smoke at 16/16, accepted 173/185
production drafts, and promoted 159. Full audit passed at
`outputs/d1-v2-product-native-export-v83-first-sense-3lang` with 28,156 entries,
33,673 senses, and 134,692 localizations. Freeze the remaining approximately
1,089 two-language candidates until a source-evidence review stage exists.
Nothing from v83 is deployed.

The evidence stage now exists as
`scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs`, but it
is not approved for a full-pool run. Regenerating against the latest local DB
and filtering with `--min-first-sense-langs 2 --max-first-sense-langs 2` yields
exactly 1,084 rows after Unicode-aware capitalized proper-name filtering. The reviewer is read-only, produces a supplement-compatible
approved report, prewarms unloaded Studio models, and pins port 11441 to
`UD-Q4_K_XL` and port 11447 to `UD-IQ4_NL`.

The initial control run returned 20 `No model loaded` errors because the new
reviewer lacked prewarm. After that was fixed, a prompt-language bug incorrectly
rejected `苹果树 -> macieira`. Explicitly allowing translations and
transliterations in any target language produced a repeated control result that
matched all 16 previously labelled rows: 13 accepts and three source-mismatch
rejects. Run the fresh balanced 20-row evidence report and then a supplement
dry-run on only its approved output before any draft apply.

The first attempted fresh review returned 20 valid responses, 16 approvals, and
four rejects with no endpoint failure, but 14 rows overlapped the old control
smoke because dry-run reports were not included in checkpoint exclusions. Of
the six genuinely new rows, five were approved and `幽怪/appearance` was
correctly rejected. The replacement report
`logs/product-coverage-gaps-v83-two-lang-evidence-fresh-20.json` explicitly
excludes both old smoke reports. Its review produced 14/20 approvals with no
endpoint failure: pt-BR 7/7, ja 6/7, zh 0/5, and en 1/1. The English row was
`Düsseldorf`; Unicode proper-name filtering now removes it. The required next
input for generation dry-run is the resulting 13-row
`logs/product-source-gap-v83-two-lang-evidence-fresh-20-approved-clean.json`.

That 13-row generation dry-run initially passed the structural validator 13/13,
but manual inspection found source-Japanese pronunciation copied into EN/PT IPA
for `ゆき`, `おもう`, and `はたして`, plus an unrelated English term for
`がつがつ`. The supplement validator now rejects identical EN/PT pronunciation
when translated terms differ on zh/ja source rows, and rejects English terms
with no content-token overlap against the source English gloss. Retry prompts
name these errors. Pure-kana source entries deterministically use the source
headword as their kana reading.

The corrected run accepted 12/13 with no infrastructure failures. `ゆき`
remained rejected after returning empty IPA; `quinzena` was manually held due
to the 15-day versus 14-day definition mismatch. Eleven rows were applied as
draft and passed deterministic promotion 11/11. Full local-only audit passes at
`outputs/d1-v2-product-native-export-v83-two-lang-evidence-11` with 28,167
entries, 33,684 senses, and 134,736 localizations. No v83 data is deployed.

## Notes

Frequency order is currently based on `hermitdave/FrequencyWords` because the earlier `wordfrequency.info` mirror had machine-translated Chinese terms such as `一世` for a high-rank English-derived item. The older files are still downloaded for comparison, but the generation batch uses `FrequencyWords` by default.

### Two-language post-generation quality gate

Do not equate schema-valid JSON with dictionary-valid output. In the next
85-row evidence-approved run, structural validation accepted 75 rows but missed
multiple incorrect Japanese readings. The current supplement runner adds:

- a streamed JMdict reading index with 226,730 terms;
- Chinese lexical pinyin validation using `toneSandhi:false`;
- a primary English source-term anchor for one coherent sense;
- post-generation four-language QA;
- preservation of `manual_evidence_override` across report merges;
- deterministic `--replay-report` support so apply does not regenerate a
  previously reviewed record.

The strict result was 66/85 accepted with zero infrastructure failures. This is
below the 90% production gate. Keep rejects in residual/manual review and do not
lower reading, script, source-sense, or publication checks to raise the rate.

Example deterministic replay validation:

```powershell
node scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs `
  --db data/processed/validation-copy.db `
  --report logs/candidate-report.json `
  --limit 85 `
  --replay-report logs/strict-dry-run.json `
  --apply true `
  --dry-run false `
  --quality-review true `
  --deterministic-readings true `
  --out logs/replay-validation-apply.json
```

Replay accepts only items already marked valid in the dry-run report, reruns
current deterministic validation, and writes them as `draft_single_source` with
`needs_review=1`. It never promotes or publishes them. The validation-copy test
inserted 66 senses and passed fast and published-risk audits while publishable
counts remained unchanged.

### Independent reverse-evidence validation

For two-language first-sense candidates, model QA is necessary but not
sufficient. The same Qwen model on A6000 and RTX 4090 returned the same approvals
for a known bad mapping, so node-level voting is not independent evidence.

Run the read-only reverse validator after generation:

```powershell
npm.cmd run dict:v2:coverage:validate-reverse-evidence -- `
  --report logs/generation-dry-run.json `
  --out logs/generation-reverse-evidence.json
```

The validator queries the exact generated target term in the canonical source
database and compares its English dictionary gloss with the source meaning
anchor. Strong sources are CC-CEDICT/Kaikki/WikDict for Chinese, JMdict/WikDict
for Japanese, and FreeDict/WikDict for Portuguese. OMW-only agreement cannot
auto-pass. A low match ratio on a polysemous term produces manual review rather
than acceptance. The generated supported-only replay report is the only subset
eligible for database-copy replay and deterministic promote.

Before generation, `npm run dict:v2:coverage:prefilter-reverse-evidence` can
remove candidates whose source headword has no matching strong dictionary
evidence. This reduces avoidable calls, but it cannot validate target terms
that do not exist until after generation. Always run the post-generation
validator as the publication gate.

The supplement runner also performs deterministic English pronunciation
normalization from ECDICT by default. Disable only for controlled comparisons
with `--deterministic-pronunciations false`. ECDICT values are labelled
`ecdict-phonetic`, not strict IPA, and are not sent to the focused IPA reviewer.

For the remaining pt-BR source-gap pool, add deterministic pre-generation
gates to the reverse-evidence prefilter:

```powershell
npm.cmd run dict:v2:coverage:prefilter-reverse-evidence -- `
  --min-target-langs 2 `
  --require-pt-pronunciation true `
  --require-jmdict-hint true `
  --pt-pronunciation-db data/processed/kaikki_portuguese_pronunciations.db
```

Do not require three target languages: the 2026-07-18 remaining pool produced
zero such candidates. Do not hard-enforce evidence-review preferred terms by
default either. A 43-row A/B test reduced model acceptance from 38 to 33 and
did not improve the independently supported count (28 in both cases). Triage
only attaches those terms when `--attach-candidate-review true` is explicit.
The local evidence-gated-81 export has 28,339 entries, 33,856 senses, and
135,424 localizations; production D1 remains v82.

For residual recovery, validate reviewed terms before generation:

```powershell
npm.cmd run dict:v2:coverage:validate-reverse-evidence -- `
  --input-mode reviewed `
  --report logs/reviewed-candidates.json `
  --supported-report logs/reviewed-candidates-supported.json `
  --out logs/reviewed-term-evidence.json
```

Then attach the compact review record during triage and, only for a controlled
comparison, allow natural close synonyms with
`--enforce-reviewed-preferred-terms false`. This does not weaken the final
reverse-evidence gate. The latest comparison pre-supported 37/43 reviewed
candidates, skipped 27 already-complete rows, accepted 6/10 generated rows,
and finally supported four. Those four were validation-copy audited and
promoted locally. Evidence-gated-82 contains 28,343 entries, 33,860 senses,
and 135,440 localizations with zero blockers and zero risk flags. A 4/10 final
safe yield remains below the large-scale expansion threshold, so production
D1 remains v82.

### Excluding real generation history

Regenerating coverage gaps is insufficient to produce a fresh LLM batch:
rejected rows have no accepted product entry and therefore reappear. Build an
attempt index and feed it back into the filter:

```powershell
npm.cmd run dict:v2:coverage:index-source-gap-attempts

node scripts/filter-dictionary-v2-product-coverage-gap-report.mjs `
  --in logs/current-raw-gaps.json `
  --out logs/current-fresh-gaps.json `
  --exclude-source-entry-id-files logs/product-source-gap-v83-generation-attempts.json
```

The index deliberately counts actual `generated` rows and attempted checkpoint
items only. Pre-reviewing a candidate does not remove it from future generation
pools. The current index contains 4,679 source entry IDs.

The first new OMW-aligned fresh gate passed 17/20 evidence review, 16/17 full
generation, and 13/16 post-generation deterministic promotion. Replay must use
the same preferred-term policy as generation. The supplement runner now
inherits `enforce_reviewed_preferred_terms` from a replay report when the CLI
does not explicitly set it. Evidence-gated-83 contains 28,356 entries, 33,873
senses, and 135,492 localizations with zero blockers and risk flags. Production
D1 remains v82.

### Opt-in Kaikki raw bilingual evidence

Kaikki Japanese and Portuguese extracts use source-language headwords with
English Wiktionary glosses. They are independent bilingual evidence, not
canonical four-language localizations. Keep the default path unchanged and
enable this channel explicitly:

```powershell
node scripts/find-dictionary-v2-product-coverage-gaps.mjs `
  --max-rank 200000 --limit 50000 `
  --include-kaikki-raw-evidence true `
  --out logs/product-coverage-gaps-v83-kaikki-raw-evidence.json

node scripts/filter-dictionary-v2-product-coverage-gap-report.mjs `
  --in logs/product-coverage-gaps-v83-kaikki-raw-evidence.json `
  --out logs/product-coverage-gaps-v83-kaikki-raw-two-lang-dryrun-20.json `
  --limit 20 --balanced true --lang-targets "ja=15,pt-BR=5" `
  --fill-remaining false --min-clean-langs 3 --min-first-sense-langs 1 `
  --min-gloss-length 8 --block-known-residuals true `
  --allow-supplemental-two-lang-evidence true `
  --required-evidence-gate kaikki_raw_two_lang `
  --exclude-source-entry-id-files logs/product-source-gap-v83-generation-attempts.json
```

The raw evidence gate requires exact normalized spelling and language plus
lexical overlap between the candidate gloss and the Kaikki English gloss. This
blocks same-spelling/different-sense errors such as a noun gloss being justified
by an unrelated verb inflection. The reviewer payload now carries the source
key, source term, part of speech, and Kaikki gloss.

Importer and network lessons:

- Batch SQLite inserts (500 input rows per transaction). One transaction per
  JSONL row took more than ten minutes; batching completed the resumed full
  import in about 26 seconds without duplicate rows.
- Node 24 fetch failed on this network through automatic IPv4/IPv6 family
  selection while `curl` still worked. Use IPv4-first DNS and disable automatic
  family selection in the downloader; retain `.part` files and atomic rename.
- PowerShell may continue after a failed external command. Check
  `$LASTEXITCODE` between pipeline stages so stale reports are not filtered.

The first Kaikki-gated 20-row experiment completed source review at 20/20 with
zero infrastructure failures. Generation initially passed only 4/17 because
unsupported reviewer preferred terms and a possessive-gloss parser bug rejected
valid synonyms. Binding only the source-language term and treating English as a
semantic anchor raised the final no-write dry-run to 12/17. Three other rows
were already linked. This remains below the batch expansion gate; do not apply
or scale it until the Japanese JMdict phrase/reading failures and independent
quality-review rejects are resolved.

Do not trust the same-model IPA reviewer as a hard gate on this path. It falsely
rejected standard `nh=/ɲ/`, `ç=/s/`, and the normal pronunciation of `initials`.
Prefer deterministic ECDICT and region-tagged Kaikki pt-BR IPA; route unmatched
pronunciations to an independent model family or manual review.

The complete first-batch funnel was `20 source reviewed -> 17 newly generated
-> 12 generation-valid -> 3 reverse-dictionary supported -> 2 independent
Gemma consensus accepts`. The two accepted rows were `持ち場` and `訛り`.
`主催` was rejected because `sponsorship/patrocínio` is financial backing, not
the organizing/hosting sense of `主催`. This low final yield confirms that the
Kaikki raw-evidence pool must retain reverse-dictionary and independent-family
review; source-review acceptance alone is not a production signal.

The second non-overlapping Kaikki batch improved generation validity to 14/17
with no infrastructure failures, but reverse evidence still reduced it to five
supported rows. Independent Gemma review accepted the supported set: `強調`,
`感度`, `特性`, `母校`, and `童貞`. They passed isolated and main-DB promotion
audits. The local export now contains 29,094 entries, 34,611 senses, and 138,444
localizations; production D1 remains unchanged.

For independent consensus review, use `--only-supported true` when the input is
a reverse-evidence report and only deterministic supported rows should be sent
to the reviewer. `--include-supported true` intentionally reviews both supported
and non-supported rows and must not be used as a supported-only selector. The
two options are mutually exclusive.

The third Kaikki batch exposed an attempt-index edge case: generation reports
can contain `skipped_preview` rows with
`reason=already_linked_complete_source_gap`. These rows must be excluded from
future candidate batches even though no model generation was attempted. Other
selected-but-not-generated rows remain eligible.

After that fix, the third batch funnel was `20 reviewed -> 17 generation-valid
-> 8 reverse-supported -> 7 Gemma consensus accepts`. The accepted entries were
`平方`, `アクセル`, `気圧`, `空白`, `痙攣`, `実質`, and `食卓`. The local export now
contains 29,101 entries, 34,618 senses, and 138,472 localizations. Production D1
remains v83 and unchanged.

The first 100-row Kaikki pressure batch was operationally stable but did not
meet the quality expansion gate. Evidence review approved 96 rows; generation
accepted 68/96 with no infrastructure failures; reverse evidence supported 31;
and independent Gemma review accepted 25. The 25 rows passed isolated and main
promotion audits. Local export counts are now 29,126 entries, 34,643 senses,
and 138,572 localizations.

Do not increase this candidate class directly to 500. The 70.8% generation
acceptance is below the 90% target. Prioritize the 13 Japanese reading mismatch
rejects and candidate/sense alignment, while retaining quality review, reverse
evidence, and independent-family consensus unchanged.

For exact Japanese headwords with one and only one JMdict reading, the
supplement pipeline now treats that reading as deterministic source evidence
and replaces the model-proposed reading before validation. Never apply this
rule to a headword with multiple JMdict readings: pronunciation-group and sense
alignment must select the reading, or the candidate must remain rejected/manual.

On the 13 reading-related rejects from the first pressure batch, this rule
recovered nine structurally valid generations and reduced reading mismatches to
one. Reverse dictionaries and independent Gemma consensus still reduced the
publishable subset to `近辺` and `登山`. Both passed isolated and main-DB audits.
The local export now contains 29,128 entries, 34,645 senses, and 138,580
localizations; production D1 remains v83 and unchanged. This improvement does
not by itself satisfy the 90% full-batch expansion gate.

Build specialized retry input with
`build-dictionary-v2-product-source-gap-retry-report.mjs`. It joins the original
candidate rows to the latest generation report and preserves `latest_errors`,
the QA reason, and generated ZH/JA terms and readings. Passing the original
candidate report directly loses this context and weakens the retry prompt.

The English anchor validator may accept alternatives explicitly listed in the
same exact Kaikki gloss, such as `increase (increased amount), enlargement`.
It must not treat the model's own `gloss_key` as evidence. Quality-review output
format failures receive one retry on another endpoint; semantic rejects do not.

When running reverse evidence, the generation input option is `--report`. The
parser currently ignores unknown options, so `--generation` falls back to the
default report. Verify the output's `generation_report` and row count before
using it for consensus or promotion.

The quality/English retry funnel was `15 retried -> 11 generation-valid -> 3
reverse-supported -> 3 Gemma consensus accepts`. The promoted entries were
`不平`, `クリプトン`, and `今宵`. Current local export counts are 29,131 entries,
34,648 senses, and 138,592 localizations. Production D1 remains v83.

The next non-overlapping 100-row Kaikki batch reached the generation expansion
gate: evidence review approved 94 rows and four-language generation accepted
86/94 (91.5%), with zero endpoint failures. Two input-quality changes were
required before running it: the attempt index must exclude exhausted invalid
evidence-review rows, and the clean-report filter must reject Katakana proper
locations expressed as capitalized `Name (Location)` glosses.

Do not interpret the 91.5% generation result as a 91.5% publication yield.
Reverse dictionaries supported 22/86 generated rows and independent Gemma 4
31B accepted 21/22. Only those 21 consensus rows were replayed and promoted.
They passed isolated and main fast/risk audits plus native export and full
in-memory import. Current local counts are 29,152 entries, 34,669 senses, and
138,676 localizations; production D1 remains v83. The next batch may enlarge
generation validation, but must retain the reverse-evidence and independent
model gates unchanged.

The following 500-row validation confirmed that the retry-aware path scales.
The funnel was `500 candidates -> 469 source-approved -> 420 first-pass valid
-> 446 valid after one contextual retry -> 111 reverse-supported -> 100 Gemma
consensus accepts`. All four Qwen endpoints and the Gemma endpoint completed
without infrastructure failures. Never calculate the expansion gate from raw
attempt rows: merge retries by source ID first with
`merge-dictionary-v2-product-source-gap-generation-reports.mjs`.

Only the final 100 consensus rows were replayed. They passed an isolated copy
and then exact main-DB replay, with full export counts of 29,252 entries,
34,769 senses, and 139,076 localizations. Production D1 remains v83. Also note
that `audit-dictionary-v2-product-export-fast.mjs` audits an existing native
export manifest; run `export-dictionary-v2-product-native-d1-sql.mjs` first.
Passing `--db` to the fast audit before export does not audit the database and
fails with `Missing manifest`.

The next 500-row Kaikki batch confirmed the retry and circuit-breaker paths
under a real endpoint failure. Its funnel was `500 candidates -> 476 source-
approved -> 428 first-pass valid -> 450 valid after one contextual retry -> 93
reverse-supported -> 77 Gemma consensus accepts`. Endpoint `11448` timed out
twice and opened its circuit; the scheduler redistributed work without losing
candidates, and the retry excluded that endpoint. Never immediately re-enable
a tripped endpoint inside a production batch.

Only the final 77 consensus rows were replayed. Isolated and main-DB validation
both passed semantic review, promotion, published-risk, fast audit, native
export, and full in-memory import. The local publishable export now contains
29,329 entries, 34,846 senses, and 139,384 localizations; production D1 remains
v83. Fast-audit raw product-table counts include historical drafts and review
rows and are therefore not release counts. Use the native export manifest for
published counts.

The following batch excluded `11448` after its status and model-list endpoints
worked but a short inference timed out at 120 seconds. The stable three-node
funnel was `500 candidates -> 434 source-approved -> 396 generation-valid -> 88
reverse-supported -> 82 Gemma consensus accepts`. Generation validity was
91.24%, and `11441`, `11444`, and `11447` had zero infrastructure failures.
The 82 consensus rows passed isolated and main-DB replay plus every release
audit. The local publishable export now contains 29,411 entries, 34,928 senses,
and 139,712 localizations; production D1 remains v83.

CLI compatibility notes from this batch: `--lang-targets` requires equals
syntax such as `ja=500`, while omitting `--source-langs` means all languages;
the literal value `all` is rejected. PowerShell 5.1 does not recognize
`utf8NoBOM` as a `Set-Content -Encoding` value.

The next stable three-node batch used the same strict gates and produced the
funnel `500 candidates -> 402 source-approved -> 370 generation-valid -> 85
reverse-supported -> 71 Gemma consensus accepts`. Source review used one
bounded retry and left eight malformed results in manual review; generation
validity was 92.04%, and `11441`, `11444`, and `11447` again completed with
zero infrastructure failures. `11448` remains excluded pending a fresh
inference smoke test.

Only the 71 consensus rows were replayed. Both isolated and main-DB paths
passed semantic review, promotion, published-risk, fast audit, native export,
and full in-memory import. The local publishable export now contains 29,482
entries, 34,999 senses, and 139,996 localizations; production D1 remains v83.
The batch confirms that source approval and valid JSON are not publication
evidence: reverse-dictionary support plus an independent model decision remain
mandatory before promotion.

The following batch exposed a quality-review false-negative class. Its source
review was 500/500 valid with 479 approvals, but first-pass generation accepted
only 425/479 (88.73%), so processing stopped at the configured 90% gate. The
reviewer was incorrectly overruling deterministic readings such as
`突風=とっぷう`. Generated ZH/JA readings now carry review evidence metadata;
when every LLM objection concerns a reading with `deterministic:*` provenance,
the deterministic dictionary result wins. This override does not apply to
unknown readings or term, definition, and sense errors.

After an eight-row mixed regression preserved genuine semantic rejects, only
the 54 failed rows were retried. Source-ID merging yielded 456/479 valid rows
(95.20%), followed by 97 reverse-supported rows and 84 Gemma consensus accepts.
The 84 rows passed isolated and main replay plus all audits. The local
publishable export now contains 29,566 entries, 35,083 senses, and 140,332
localizations; production D1 remains v83.

The next strict Kaikki batch selected 500 candidates from 826 eligible rows:
499 Japanese and one Portuguese. Source review was fully structured and
approved 471. Four-language generation accepted 433/471 (91.93%) with no
infrastructure failures on `11441`, `11444`, or `11447`. Eighteen rows used the
narrow deterministic-reading override, but none bypassed publication evidence:
reverse dictionaries supported 87 rows and independent Gemma 4 31B accepted
72. Only those 72 consensus rows were replayed.

The 72 rows passed isolated replay, semantic mapping, deterministic promotion,
published-risk audit, native export, and full in-memory import before exact
main-DB replay. The local publishable export now contains 29,638 entries,
35,155 senses, and 140,620 localizations. All release blockers and
`flagged_senses` remain zero; the 98 duplicate-localization groups remain a
non-blocking warning. Production D1 remains v83. The pre-selection remainder
was approximately 326 strict candidates, so the next clean-pool rebuild should
expect a smaller final batch rather than forcing a 500-row target.

The strict-pool closeout batch contained 334 candidates (333 JA, one PT).
Source review approved 311/334, four-language generation accepted 282/311
(90.68%), reverse dictionaries supported 40, and independent Gemma 4 31B
accepted 36. All remote stages completed with zero infrastructure failures.
Only the 36 consensus rows were replayed; isolated and main-DB promotion paths
both passed published-risk and full in-memory export audits.

The local publishable export now contains 29,674 entries, 35,191 senses, and
140,764 localizations. All blocking checks and `flagged_senses` are zero;
production D1 remains v83. A post-batch rebuild exposed only two final strict
candidates, `帰省` and `異音`. Both passed generation but lacked sufficient
reverse evidence, so they remain outside the product DB. Do not repeatedly
rescan or lower gates for this candidate class. Future expansion must define a
new evidence tier, add source coverage, or route residuals to manual review.

The first post-Kaikki canonical Tier C inventory contains 440 candidates with
three entry-level languages and exactly two first-sense languages: 399 pt-BR,
31 ja, and ten zh. A balanced 20-row pilot approved only nine at source review.
Hard preferred-term matching accepted 1/9 generated rows because dictionary
synonyms and Traditional/source variants were treated as exact strings.
Disabling only that brittle constraint, while keeping every semantic and
independent evidence gate, recovered 6/9 valid generations.

Reverse dictionaries supported three rows and independent Gemma accepted two:
`neurocirurgia` and `やみ`. Those two passed isolated and main promotion audits.
The local export now contains 29,676 entries, 35,193 senses, and 140,772
localizations with zero blockers and zero risk flags. The overall Tier C yield
was only 2/20, so do not expand the 440-row pool. The next engineering task is
deterministic source-sense alignment and normalization of reviewed preferred
terms, followed by another independent 20-row pilot.

The preferred-term contract was subsequently narrowed to deterministic facts.
Candidate review now stores only the exact source-language headword as a hard
`preferred_terms` constraint (`preferred_term_policy=source_only_exact`). Target
language proposals remain available under `suggested_terms`, but they cannot
reject generation by string mismatch; reverse dictionaries and independent
Gemma consensus remain mandatory.

On the same nine approved rows, this change raised generation validity from
1/9 to 8/9 without changing the publication gates. Reverse evidence supported
four rows. Gemma accepted `neurocirurgia`, `やみ`, and `しごと`, while rejecting
`くるま`. An exclusion-aware replay omitted the first two rows because they
were already present and promoted only `しごと`. Isolated and main promotion,
published-risk, and full in-memory export audits passed. The resulting local
export contains 29,677 entries, 35,194 senses, and 140,776 localizations, with
zero blockers and zero risk flags. The audited export is
`outputs/d1-v2-product-native-export-v83-canonical-tier-c-source-only-main`.
This remains local only; production is still v83. Tier C remains closed to
batch generation until deterministic candidate-sense alignment is implemented
and a fresh balanced 20-row pilot passes.

Before any further Tier C source review, align candidate evidence to one
canonical sense:

```powershell
npm run dict:v2:coverage:align-source-gap-senses -- `
  --report logs/product-coverage-gaps-v83-post-kaikki-canonical-first-sense-2.json `
  --out logs/product-coverage-gaps-v83-post-kaikki-canonical-tier-c-sense-aligned.json `
  --rejected-out logs/product-coverage-gaps-v83-post-kaikki-canonical-tier-c-sense-alignment-rejected.json `
  --min-langs 2 --max-langs 3 --require-unique-best true
```

The aligner requires an exact source-language term, scores every clean sense by
language coverage and confidence, excludes senses that already have four
languages, and rejects ties. It deliberately does not merge independent
WikDict bilingual senses. On the 440-row canonical pool this retained 184,
classified 119 as already complete, and rejected 137 as ambiguous. A second
high-value filter requiring exactly three aligned languages produced a 20-row
pilot with 19 pt-BR rows and one ja row.

Run source review only with the alignment gate:

```powershell
node scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs `
  --report logs/product-coverage-gaps-v83-post-kaikki-canonical-tier-c-sense-aligned-pilot20.json `
  --require-sense-alignment true --limit 20
```

The reviewer rejects reports whose `sense_alignment.aligned_sense_id` does not
match `first_sense_id`. Persist the local token only in ignored `.env.local` as
`UNSLOTH_API_KEY`, then load it into the process before invoking Node. Never put
it in a report or tracked file.

The first aligned pilot completed with this funnel:

```text
20 source reviewed
13 source approved
9 generation-valid
3 reverse-dictionary supported
3 independent Gemma consensus accepted
```

The accepted rows were `exploradora`, `eletrodomésticos`, and `preventivo`.
They passed isolated replay before exact main-DB replay. During isolated
promotion, a pre-existing ordering bug was found: the promote query applied
SQL `LIMIT` before semantic-review filtering and therefore inspected unrelated
historical drafts. When `--semantic-review` is present, the script now loads
the candidate set, filters to approved product sense IDs, and only then applies
the limit.

The local publishable export now contains 29,680 entries, 35,197 senses, and
140,788 localizations. `flagged_senses` and all release blockers are zero. The
audited export is
`outputs/d1-v2-product-native-export-v83-canonical-tier-c-sense-aligned-main`.
Production remains v83. A 3/20 end-to-end yield is validation evidence, not an
authorization to scale the remaining Tier C pool.

The next pilot moved reverse-dictionary evidence ahead of generation. Running
the reverse validator with `--input-mode aligned` on the 184 aligned candidates
classified 44 as supported, 125 as manual review, and 15 as unsupported. A
20-row supported pilot then produced this funnel:

```text
20 source reviewed
18 source approved
17 new after historical-review subtraction
12 generation-valid
8 reverse-dictionary supported
8 independent Gemma consensus accepted
```

The accepted rows were `valquíria`, `legalização`, `cantonês`, `troglodita`,
`hipnotismo`, `coalhada`, `cesárea`, and `darwinismo`. All eight passed exact
isolated replay, deterministic promotion, published-risk, native D1 export,
and full in-memory audit before the same reports were replayed into the main
product DB. The byte-identical pre-main backup is
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-prefiltered-tier-c-pilot-20260803-133320.db`
with SHA-256
`39D4E3D543B677D0E9087C6BBF68B5981C704DFAE62C152DE4B56F8ABF6F3B99`.

The local publishable export now contains 29,688 entries, 35,205 senses, and
140,820 localizations. Main DB SHA-256 is
`170691083350484ED7C589C3306BF52859F20AD478528191DD29EA7DC82902C8`.
All release blockers and `flagged_senses` are zero; the existing 98 duplicate
localization groups remain a non-blocking warning. The audited export is
`outputs/d1-v2-product-native-export-v83-canonical-tier-c-prefiltered-main`.
Production remains v83. The prefilter materially improved the funnel, but an
8/20 final yield still requires generation-reject analysis and a bounded
100-row validation before broader scaling.

The five generation rejects are not infrastructure failures. `tesouraria`,
`dissuadir`, and `prussiano` failed semantic quality review because their
Japanese term or sense was wrong or non-standard. `centésima` and `escoliose`
failed `ja_term_not_in_jmdict`; retain them for canonical-form/variant matching
instead of weakening the JMdict gate for every candidate.

The JMdict follow-up added only exact verified exceptions: modern `側弯症` and
`脊柱側弯症` resolve through the bundled JMdict canonical `彎` forms, while
`百分の一` has the compositional reading `ひゃくぶんのいち`. A remote two-row
retest accepted the scoliosis row. The hundredth row no longer failed lookup;
independent quality review rejected it for ordinal/fractional sense mismatch.

After excluding the first 20 prefiltered candidates, the strong reverse-
evidence pool had only 24 rows. Historical review subtraction reduced this to
20 genuinely new generation inputs. The resulting funnel was:

```text
24 source reviewed and approved
20 new after product/history subtraction
15 generation-valid
7 reverse-dictionary supported
6 independent Gemma consensus accepted
```

The six promoted rows are `subsidiária`, `vidraça`, `fotogênico`, `estribo`,
`taquigrafia`, and `escarlatina`; Gemma rejected `siso`. Isolated and main
replay, deterministic promotion, published-risk, native export, and full audit
all passed. The pre-main backup is
`data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-prefiltered-tier-c-remaining20-20260803-162243.db`
with SHA-256
`170691083350484ED7C589C3306BF52859F20AD478528191DD29EA7DC82902C8`.
The local DB now contains 29,694 entries, 35,211 senses, and 140,844
localizations; SHA-256 is
`90A25DE7E8E0F3875936740C4419F1A82728111D3C53EC2A26F59B65943AC1E9`.
The audited export is
`outputs/d1-v2-product-native-export-v83-canonical-tier-c-prefiltered-remaining20-main`.
Production remains v83. The safe strong-evidence pool is exhausted; rebuild a
larger aligned pool with product-aware exclusions before targeting 100 rows.

The expanded rebuild used `max-rank=500000` and found 70,175 raw gaps. Strict
canonical filtering retained 758 and product-aware sense alignment retained
503. The aligner now excludes accepted-product-linked source senses before
ranking eligible senses, preventing repeated review without hiding another
unlinked sense under the same entry.

The initial reverse pass selected 377 candidates, but this was a false sense of
coverage: forward and reverse WikDict rows came from one Wiktionary family. A
balanced 100-row source review accepted 66; generation validated 42; final
reverse evidence supported only four. No infrastructure failures occurred and
nothing was written.

Use strict source-family validation for expanded Tier C work:

```powershell
node scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs `
  --input-mode aligned --require-source-reverse-evidence true `
  --report <sense-aligned-report> `
  --out <strict-evidence-report> `
  --supported-report <strict-supported-report>
```

Both directions of WikDict and all Kaikki extracts now map to the same
`wiktionary` evidence family and cannot self-corroborate. This left 13
cross-family rows and 11 new rows after excluding
the reviewed 100. Their source review was 11/11 and merged generation was 10/11,
but final four-language evidence supported only `desenvolvedor`. Gemma 4 31B
accepted eight of the ten valid generations, while the strict intersection of
Gemma acceptance and deterministic support contained only `desenvolvedor`.
This is the required promotion rule: independent-model acceptance cannot
override `manual_review` or `unsupported` reverse evidence. The safe singleton
was replayed to draft, promoted, and passed fast/full export plus published-risk
audits. Production D1 was not deployed.

JMdict composition validation also gained a bounded suffix mechanism. `化`,
`患者`, and `可能な` are accepted only when their base term has an exact JMdict
reading. This validates `瘢痕化` and `心気症患者`; semantic review still rejected
the contextually wrong `認識可能な`. Adding `kaikki-ja` as strong evidence within
the Wiktionary family gave `autenticar` independent agreement with JMdict. It
also had CC-CEDICT Chinese support and independent Gemma acceptance, so it was
promoted. The resulting local export contains 29,696 entries, 35,213 senses,
and 140,852 localizations. The current product DB
SHA-256 is
`14B895D68FBA1F1F2E98E7245F0452B97C34A77B6A758A4EC302BBAA4D201462`.
Production remains v83 and was not deployed.

The reverse validator also applies a bounded English derivational stem check.
It is intended for noun/verb/adjective pairs such as
`authenticate/authentication`, `menstruate/menstruation`, and
`mitochondrial/mitochondrion`; roots shorter than six characters are not
accepted. This can turn a false dictionary conflict into `manual_review`, but
cannot make a row publishable when another language has no independent reverse
evidence. Revalidating the ten-row experiment produced no new supported row.

For scale qualification, count source families rather than raw source keys.
Kaikki and every WikDict direction belong to one `wiktionary` family:

```powershell
node scripts/prefilter-dictionary-v2-product-source-gap-reverse-evidence.mjs `
  --report logs/product-coverage-gaps-v83-expanded-clean-canonical-sense-aligned.json `
  --out logs/product-coverage-gaps-v83-final-gate-independent-family-prefilter.json `
  --evidence-out logs/product-coverage-gaps-v83-final-gate-independent-family-prefilter-evidence.json `
  --limit 1000 `
  --min-sources 2 `
  --min-source-families 2 `
  --min-match-ratio 0.34
```

The first run returned zero supported candidates from 503 aligned rows because
OMW was only used for target hints and because filtering happened before sense
alignment. The corrected implementation counts only a unique, matching OMW
synset as the `omw` family and uses the order `raw gap -> unique sense alignment
-> quality filter -> family-aware prefilter`. This produced 2,280 strict rows.
Never compensate by counting Kaikki and WikDict twice or by treating agreement
between models as dictionary evidence.

The first balanced 100-row gate then passed source review at 91/100 but failed
generation quality: 78/91 initially and 80/91 after one retry of non-semantic
rejects. The required generation threshold is 90%, so the pipeline stopped
before reverse validation, Gemma consensus, or database writes.

The next fresh 100 required `--require-pt-pronunciation true` and
`--require-jmdict-hint true`. Source review reached 92/100 and generation
reached 84/92, but deterministic reverse support was only 22/84. Requiring
`--require-omw-target-langs 2` leaves an English-only pool, so it is not a valid
balanced production gate. Treat this as a source-coverage limitation; do not
lower reverse-evidence requirements or substitute model consensus for lexical
evidence.

### Wordfreq-expanded bounded gate

Use `scripts/export-wordfreq-lists.py` with wordfreq 3.1.1 to create the local
200k ranked inputs. Apply them with:

```powershell
node scripts/rank-dictionary-v2-frequency.mjs `
  --frequency-source wordfreq `
  --only-unranked true `
  --backup-out logs/linguago-v2-frequency-ranks-before-wordfreq-expansion-20260803.json
```

Never overwrite existing ranks when adding a secondary frequency source. The
2026-08-03 rebuild produced 144 fresh candidates after sense alignment,
quality filtering, independent-family filtering, and historical subtraction.

Generation target terms must not be locked merely because two source families
contain the same surface form. Homographs can repeat across sources. The
current rule binds a target term only when both conditions hold:

1. a unique OMW mapping or at least two independent lexical families support
   the term; and
2. the source-review model independently selects that exact normalized term.

The exact source-language headword remains binding. Multi-run generation
reports must be merged with the latest approved report as a whitelist:

```powershell
node scripts/merge-dictionary-v2-product-source-gap-generation-reports.mjs `
  --reports <run1>,<run2>,<bounded-retry> `
  --allowed-report <latest-source-review-approved> `
  --out <merged-generation-report>
```

The completed gate passed with 90/100 source approvals, 81/90 valid Qwen
generations, 76/81 deterministic reverse support, and a bounded replacement
pool adding 32 supported candidates. Gemma accepted 97 of 107 valid supported
reviews without corrections (90.7%), yielding 97 safe candidates against the
original 100-row target. A repeatedly malformed review remains manual; JSON
failure is never acceptance. Nothing was written to the product DB. Rebuild a
fresh strict pool before the 500-row checkpoint/write validation.

For the 500-row checkpoint gate, `min-target-langs=3` produced only 299
English-source rows and `min-target-langs=4` produced none. The usable bounded
pool keeps source-side two-family evidence but uses `min-target-langs=2`; final
four-language reverse evidence and Gemma consensus remain mandatory. After
historical attempt subtraction it contained 1,057 fresh rows. The selected 500
are `en=231`, `ja=150`, `pt-BR=106`, and `zh=13` because those are the available
strict-lane limits.

The first two 50-row draft transactions proved checkpoint and database
reconciliation, but generation stopped at 83/100. Do not resume the remaining
374 rows yet. Fifteen of 17 rejects came from same-model semantic review, with
clear false negatives such as Japanese `はちどり`, chemical `臭化物`, and postal
`消印`. A safe follow-up may treat a rejection concerning only a target term
that exactly matches independently bound lexical evidence as advisory at the
generation stage, but that row must still pass deterministic reverse evidence
and independent Gemma consensus. This exception must never apply to unbound
terms, structural failures, missing readings/IPA, or source-term drift.

The bounded exception was implemented behind
`--defer-evidence-bound-quality-rejects true` and tested only against the 17
failed rows. It recovered nine, raising merged generation validity to 92/100.
The exception did not weaken the downstream evidence gate: deterministic
reverse validation supported 51 rows, marked 37 manual, and rejected four.

The target-two-language pool is therefore not eligible for the 500-row gate.
Its dominant residuals are `wiktionary_only_evidence` for pt-BR and zh (14
each), followed by missing Chinese reverse evidence (seven). Strong gloss
conflicts, OMW-only evidence, and low-match polysemy account for the remainder.
Do not invoke Gemma for this batch or resume its remaining 374 candidates: the
best possible pre-consensus promote rate is only 51/100, and model agreement
cannot substitute for an independent lexical family. Expand independent pt-BR
and zh reverse coverage, regenerate the candidate pool, and rerun the 100-row
gate with the same thresholds.

The first source-expansion probe tested newer open wordnets without changing
the source or product databases. Install `wn` into an isolated Python path,
download `own-pt:1.0.0`, `omw-cmn:2.0`, and `omw-en:2.0`, then run:

```powershell
$env:PYTHONPATH = (Resolve-Path '.tmp\wnprobe')
python scripts\probe-open-wordnet-source-gap-residuals.py `
  --generation logs\product-source-gap-v83-wordfreq200k-scale500-generation-first100-merged.json `
  --reverse logs\product-source-gap-v83-wordfreq200k-scale500-first100-reverse.json `
  --wn-dir .tmp\wn-data `
  --out logs\product-source-gap-v83-wordfreq200k-scale500-open-wordnet-probe.json
```

The probe found ten of 45 residual target terms and only seven direct English
lemma matches (pt-BR 3/18, zh 4/27). This is useful incremental coverage but is
not enough for the 80% gate. The script deliberately labels its output
`publication_evidence=false`; importing a newer wordnet needs stable lexicon
provenance and must not silently turn all OMW matches into strong evidence.
Kaikki Portuguese is also not an independent addition because it shares the
Wiktionary family with WikDict. The unavailable historical PanLex API must not
become a network dependency; any future PanLex snapshot import must preserve
its underlying source groups.

Dicionário Aberto multi-anchor diagnostics remain research-only. An expanded
1,651-row structural pool yielded 124 target-supported rows, but only `corola`
could be reduced to one four-language Wikidata QID and it was already present
in the 15-row single-anchor pool. Multi-term hints are not publication evidence
and cannot fill a bounded gate. QID locking uses a one-time in-memory Wikidata
index; do not restore per-anchor scans of the full lexical-evidence table.

The next target-evidence expansion added six exact, POS-bound, dual-reviewed
OpenHowNet Chinese terms to the 15-row Dicionário Aberto pool. The resulting
21-row source-definition gate retained only 17 rows after requiring Qwen and
Gemma approval plus an identical supporting definition order. This is below
the 18/20 gate, so the reviewed evidence remains research-only and no draft is
generated. Exact Chinese hint intersection is available through
`probe-openhownet-source-gap-deficits.mjs --require-exact-zh-hint-intersection
true`; it must remain default-off and followed by dual-model review.

## v85b Controlled-Consensus Release (2026-08-06)

A fresh exact-sense batch used Qwen generation, deterministic four-language
reverse evidence, and independent Gemma 4 31B no-correction consensus. Of 83
generation targets, 80 were structurally valid and 77 passed the first Gemma
review. A locale audit found 13 pt-BR common nouns incorrectly capitalized.
Explicit source-entry/source-sense overrides corrected those terms, after
which deterministic evidence and a second full Gemma review accepted 77/77.

Controlled replay now writes checkpoint rows and controlled provenance uses
the exact `source_entry_id:source_sense_id` mapping. When
`--controlled-consensus-draft-write true` is set, replay no longer defaults to
`enforce-reviewed-preferred-terms`: the final evidence-and-consensus output is
authoritative. Otherwise an earlier review term can silently replace a later
locale correction. `apply-dictionary-v2-product-locale-overrides.mjs` provides
an exact old-value-checked transaction for narrowly scoped product DB repairs;
the v85 rules are tracked in
`config/dictionary-overrides/v85-pt-br-term-case.json`.

The final release contains 29,664 entries, 35,180 senses, and 140,720 sense
localizations. Fast audit, published-risk, full native export/import, complete
online API regression, and isolated mobile/desktop render checks pass. Worker
version is `7c8b4b59-c287-4584-9025-964d034035e8`, cache is
`v85b-locale-fixed-29664`, and D1 `published_at` is
`2026-08-06T06:29:09.247Z`.

Wrangler 4.107.0 `d1 export --remote` returned Cloudflare authentication error
10000 even though the same OAuth profile could execute D1 queries and deploy.
Do not treat that as a network failure. The exact pre-v85 local DB was instead
exported to `backups/v84-rollback-native-before-v85-20260806-151653` and the
rollback package passed full memory-import audit at the v84 counts.

For the current 2,000-row readiness work, independent supplemental evidence is
materialized with these source-family rules:

- Open WordNet: `omw`.
- word2word top-3: `corpus_word2word`; weak corpus evidence, never sufficient
  by itself.
- Apertium `zho-spa`, `eng-spa`, and `es-pt`: one `apertium` family.
- exact Wikidata item labels: one `wikidata` family, CC0.
- MUSE: research only and excluded from production because of CC BY-NC 4.0.

Wikidata pool construction uses batched SPARQL labels, not aliases. The English
item label must exactly match the sense anchor before any target label is
imported. Labels are capped per language, retain the QID as `concept_id`, and
remain only one family regardless of language count. The combined strict pool
currently has 1,324 fresh candidates; with 520 previously verified rows, 1,844
rows are eligible for the strict 2,000-row gate. Any 156-row pressure-only
remainder must be isolated and prohibited from promotion.

### Current final-gate correction (2026-08-03)

The entry-level 1,844 estimate is superseded for execution by a sense-exact
pool. Exact historical subtraction yields 1,576 fresh all-target-independent
senses. Two formal gate100 runs passed source review, generation, and
deterministic support but failed independent Gemma no-correction consensus
(66/80 and 64/90). The 500-row write gate remains blocked. All selection,
resume, reverse-evidence, and consensus joins must use
`source_entry_id:source_sense_id`; candidate batches must be entry-unique.
## v86 Controlled-Consensus Release (2026-08-06)

The next strict controlled lane selected 70 preferred-term-complete candidates;
52 were already complete in the product DB. Qwen generated 17/18 valid new
rows, strict four-language reverse evidence retained 17/17, and independent
Gemma no-correction review accepted 13. A locale audit corrected pt-BR common
noun `Catamarã` to `catamarã` through
`config/dictionary-overrides/v86-pt-br-term-case.json` before replay.

The 13 rows passed isolated and main-DB draft/promote runs, fast audit,
published-risk audit, native export, and full in-memory import. Production v86
contains 29,669 entries, 35,193 senses, 140,772 sense localizations, 3,030
examples, and 11,898 example localizations. Worker version is
`35880184-2258-44af-97e6-b00c08c7e2bf`, cache is
`v86d-sequential-form-lookup-29669`, and D1 `published_at` is
`2026-08-06T08:33:52.889Z`. Complete API, focused API, and separate
mobile/desktop render checks pass.

Operational failure lesson: D1 native release resets schema before importing
data chunks. An interrupted process left a partial database with 19,909
entries and zero senses until the audited 18 chunks were replayed. The native
push script now retries each SQL file and verifies all seven remote table
counts against `manifest.json` before printing completion. Treat a missing
post-import count verification as a failed release, even if some Wrangler
imports succeeded.

Unicode smoke-test lesson: Windows PowerShell 5 encoded a raw Chinese JSON
request body as question marks, making a valid `分度器` D1 row appear to miss.
Use Node `fetch`, UTF-8 bytes, or Unicode escapes for non-ASCII API checks.
The Worker resolves canonical keys, entry forms, and localized terms with
three small sequential indexed queries before aggregating an entry. The
focused API suite locks this behavior with `ja-protractor-form-lookup`.

Core Unsloth pipeline scripts also load the ignored project-root `.env.local`
through `scripts/lib/load-local-env.mjs`. This makes the key available across
new shells and Codex tasks even when their parent process did not inherit the
Windows user environment. An explicit process-level `UNSLOTH_API_KEY` still
takes precedence, so temporary key rotation remains possible without editing
the file. Never print the token or pass it as a CLI argument.

## Large-batch replay identity and 500-row gate (2026-08-13)

All generation, reverse-evidence, consensus, replay, checkpoint, and promote
joins must use `source_entry_id:source_sense_id`. Entry-only replay is invalid
because one headword can contribute several independently reviewed senses.
The supplement replay path now enforces this exact identity and throws when a
source sense is missing.

The current 500-row qualification funnel is:

- Qwen generation valid: `464/500` (92.8%), endpoint failures `0`;
- deterministic reverse evidence: `454/500` (90.8%);
- independent Gemma no-correction consensus: `400/454`;
- final promoted: `400/500` (80.0%).

Gemma `nano` review can emit only `{"corrections":[]}` for some rows. Do not
infer acceptance. Resume only invalid rows with `prompt-mode=full`,
`max-tokens=320`, and `max-seq-length=2048`. The 500-row gate then reached zero
failed reviews. Process large multilingual JSON with Node UTF-8 reads rather
than Windows PowerShell 5 `ConvertFrom-Json`.
### v95 supplemental evidence exhaustion follow-up (2026-08-13)

After the local 500-row gate and the final 11-row strict batch, the product DB
contains 37,742 publishable senses. No D1 release was made in this phase; the
online baseline remains v94.

The all-history attempt index now contains 39,591 exact entry/sense attempts.
Rebuilding the strict v95 pool against that index leaves one fresh candidate
(`giroscópio`), which is not enough for another LLM batch.

JMdict coverage was rechecked with an extractor that respects written forms,
readings, `re_restr`, `stagk`, and `stagr`, and requires an exact English sense
anchor. The complete 459-row Japanese near-unlock bucket produced 189
candidate matches and 166 unique lexical-evidence rows. Declaring official
JMdict as a strong Japanese supplemental family increased the strict pool only
from 1,278 to 1,281 rows. Most matches still lack independent round-trip
evidence for every target language, so JMdict alone does not unlock scale.

Two negative capacity checks are also intentional results:

- The 364 Chinese near-unlock rows had no exact CC-CEDICT headword matches.
- The 310 Portuguese near-unlock rows had no exact FreeDict por-eng headword
  matches.

Do not replace these checks with fuzzy substring matching. A source term merely
occurring inside a longer dictionary headword is not independent evidence for
the candidate sense. The next safe expansion requires a new independent
lexicon with better modern/inflected-form coverage, or a reviewed semantic
alignment stage whose outputs remain candidate-bound and auditable.

#### UniMorph to FreeDict morphology bridge

The official UniMorph Portuguese dataset (303,996 rows, 211,091 distinct
forms, CC BY-SA 3.0) was tested strictly as a morphology bridge, not as a new
lexical-evidence family. Of 310 Portuguese near-unlock rows, 21 mapped to a
lemma and eight lemmas existed in FreeDict por-eng. Qwen review on nodes 147,
56, and 47 accepted two `diferenciado` source senses and rejected six semantic
or homograph mismatches. A deterministic adjudicator then retained only the
risk-free participle chain `diferenciado -> diferenciar -> differentiate ->
differentiated`; the second sense carried an elegant-vs-distinct scope risk.

Appending that one candidate-bound FreeDict row did not increase the strict
pool. The source side gained two independent families, but its existing OMW
target terms still failed: Chinese `区别的` did not reverse to
`differentiated`, and Japanese `分化型` had no strong reverse evidence. This
proves that the next useful lane is target-term repair, not more source-side
generation. Start with the 737 target deficits that already have one observed
family (`zh=511`, `ja=226`), ask the model for bounded alternatives, then admit
only alternatives independently found in CC-CEDICT/JMdict and matching the
same English anchor.

#### Target-term repair qualification result

The first 20-row bounded suggestion run returned valid JSON for every row on
nodes 147, 56, and 47; node 155 was excluded. Deterministic validation retained
12 replacement terms after target-script checks and strong-family filtering.
The repaired report increased the strict pool by one candidate only:
Portuguese `caracterizacao`, with Japanese `描写` replacing the unrelated
`制立`. That candidate was already present in the exact historical attempt
index, so history subtraction still leaves only `giroscopio` as fresh.

This result validates the repair mechanism but not production capacity. Before
another remote generation run, select a larger bounded cohort from the 511
Chinese and 226 Japanese one-family deficits, validate proposed terms against
current dictionary data, rebuild the strict pool, and subtract the complete
`source_entry_id:source_sense_id` history. Do not generate merely because a
model suggestion parsed successfully.

The follow-up 100-row capacity check (`zh=50`, `ja=50`) produced 100 valid
model responses and zero endpoint failures on nodes 147, 56, and 47. The first
lightweight validation retained 39 candidates. Requiring two strong reverse
families on the same proposed term reduced that precheck to 29 candidates, but
the authoritative prefilter, which also checks polysemy and dictionary
conflicts, still accepted only one repair. The overall strict pool did not grow
beyond 1,282 and history subtraction still left only `giroscopio`.

`report-dictionary-v2-product-target-deficit-intersections.mjs` now separates
single one-family gaps from candidates that also need another target language.
There are 577 nominal single one-family gaps, but a focused 20-row replay still
unlocked only `caracterizacao`. Treat the lightweight suggestion validator as
a cost-saving precheck only; every repair must be rebuilt by the authoritative
prefilter. Do not spend more remote generation on this lane until a genuinely
independent lexicon or a stricter prefilter-backed selector shows recoverable
capacity.

#### Independent Gemma target-term review on node 155

A6000-155 was restored and loaded with
`unsloth/gemma-4-31B-it-qat-GGUF / UD-Q4_K_XL`, context 2,048, without
speculative decoding. `review-dictionary-v2-product-target-terms-unsloth.mjs`
then reviewed the 29 candidates that passed the lightweight two-family
precheck. All requests and JSON responses were valid, and Gemma accepted all
29 candidates (31 terms) at confidence 0.90-1.00.

Treat this as proof that node 155 is usable, not as lexical evidence. The
review prompt measures semantic naturalness and is less selective than the
authoritative deterministic prefilter, which still admits only one repair.
Model consensus must not create an evidence family or bypass dictionary
conflict, source-direction, polysemy, or round-trip gates.

#### ConceptNet as a discovery layer, not evidence

The official ConceptNet 5.7 assertions snapshot is processed locally with
`probe-conceptnet-source-gap-zero-family.mjs`; the script streams the gzip and
does not create a large decompressed intermediate. ConceptNet is an aggregator,
so its edges inherit provenance from sources such as Wiktionary, WordNet,
JMdict, and DBpedia. Count those underlying families, never `conceptnet` or a
`/s/process/*` URI, as independent evidence.

For the current zero-family deficits, exact English-anchor synonym edges found
target-term suggestions for 2,055 candidates but added zero new source
families. The deterministic workflow is:

1. build discovery-only suggestions with
   `build-conceptnet-target-term-suggestions.mjs`;
2. validate proposed terms against local lexical databases;
3. apply repairs only to an isolated coverage report;
4. rerun the authoritative strict prefilter and exact history subtraction;
5. run dual-model source review, generation dry-run, reverse-evidence
   validation, and independent no-correction consensus;
6. write no draft unless the bounded cohort clears the production threshold.

The first run increased the strict pool from 1,281 to 1,331 and left 23 fresh
rows after history subtraction. Its 20-row bounded gate ended with 11 fully
supported, consensus-accepted generations (55%). This validates the recovery
mechanism but blocks large-scale expansion. No database or deployment state
changed.

#### Frozen pre-generation quality gates

After source consensus, the production runner must build a locked four-language
semantic preview, run independent Gemma full-contract review, retain only
no-correction accepts, and apply the deterministic JMdict generation preflight
before Qwen generation. The relevant scripts are
`build-dictionary-v2-source-gap-semantic-preview.mjs`,
`select-dictionary-v2-source-gap-candidates-by-review.mjs --accepted-only true`,
and `filter-dictionary-v2-source-gap-jmdict-generation-preflight.mjs`.

Do not remove these gates to increase volume. On the 1,690-row strict stress
pool this sequence produced `254/255` valid Qwen generations and `237/254`
final safe accepts, with zero endpoint or JSON failures. The remote report set
is `v97-strict1690-semantic-jmdict-integrated`.

For controlled writes, build a consensus-filtered replay with
`build-dictionary-v2-product-source-gap-consensus-replay.mjs`, then run
`supplement-dictionary-v2-product-source-gaps-unsloth.mjs` with
`--replay-report`, `--controlled-consensus-draft-write true`, and
`--publishable false`. Use this order:

1. replay initial final-Gemma accepts as draft;
2. deterministic promote the initial lane;
3. replay reverse-supported structured repairs as draft;
4. deterministic promote the repair lane;
5. run fast audit and published-risk audit.

Applying both draft lanes before the first promote can leave a shared entry in
`needs_review` and make repair promotion correctly fail
`entry_not_promotable`. Repeated replay must match zero rows and write zero
senses.

The 1,690-row run validates sustained orchestration, checkpoint recovery, and
quality rates, but not 500 fresh writes: 388 JMdict-ready rows already had
accepted/draft links, leaving 255 new generation attempts. Rebuild a truly
fresh strict pool from additional independent Chinese/Japanese lexical evidence
before the 500-new-sense write gate. Do not reuse historical retries to inflate
the count.

## Risk-routed source-gap pipeline

The product contract remains simple: one entry contains pronunciation groups,
each pronunciation group contains senses, and every sense has `en`, `pt-BR`,
`zh`, and `ja` localizations with the appropriate reading or pronunciation,
definition, and examples. Pipeline complexity is an offline publication
control and must not leak into the query response shape.

Run `dict:v2:coverage:route-source-gap` before remote model work. The router
writes compatible `fast` and `strict` candidate reports. A candidate enters the
fast lane only when it has one source sense, no sense realignment, no single-CJK
character ambiguity, complete reverse coverage, and at least two independent
strong lexical families for every non-source language. Word2word corpus hints
do not count as a strong family, and Kaikki/WikDict count once as Wiktionary.

The strict lane keeps the full Qwen source review, locked-term Gemma review,
independent reverse evidence, semantic preview, generation preflight, Qwen
generation, reverse evidence, and final Gemma review. The fast lane may skip
the two source-review model calls only after a representative validation batch
shows zero final false accepts; deterministic reading/pronunciation checks,
reverse evidence, final Gemma review, draft-only writes, promote, and release
audits remain mandatory.

The first v98 5,000-candidate routing test produced `fast=0` and `strict=5000`.
This agrees with the full run: only 99 candidates survived all model and
evidence gates, and deterministic promotion accepted 90. The immediate
bottleneck is independent lexical evidence in the candidate pool, not model
transport or four-language JSON generation.

## CedPane public-domain Chinese evidence

CedPane's `PD-English-Definitions.tsv` is an independent editorial Chinese-
English source distributed under a PDDL/Unlicense public-domain dedication. Do
not use the main `cedpane.tsv` names collection for the ordinary high-value
source-gap queue. The ordinary-definitions file must be downloaded from the
official `ssb22/CedPane` repository and retained outside Git under
`.tmp/cedpane/`.

Run the bounded probe and export with:

```powershell
npm.cmd run dict:v2:coverage:probe-cedpane -- `
  --report logs/product-source-gap-v98-evidence-acquisition-near-unlock1000.json `
  --source .tmp/cedpane/PD-English-Definitions.tsv

npm.cmd run dict:v2:coverage:export-cedpane -- `
  --report logs/product-source-gap-v98-cedpane-near-unlock-probe.json `
  --out .tmp/cedpane/cedpane-pd-definitions-evidence.db
```

The probe requires an exact Chinese term after traditional-to-simplified
normalization and at least `0.67` content-token coverage in both directions
between the candidate English anchor and the source gloss. Raw traditional
forms remain in provenance, but generated Chinese terms use simplified forms
to preserve the Mainland-first policy. The exported source metadata records
the upstream and report hashes, extraction rule, license, and final reverse-
evidence requirement.

The initial 2026-08-15 probe used overlap divided by the smaller token set. It
covered `192/600` Chinese target deficits but incorrectly treated a partial
match such as `Maltese` against `Maltese dog` as complete. That report is
diagnostic only. Bidirectional `0.67` coverage reduced the authoritative result
to `141/600`, 99 unique terms (151 candidate-bound evidence rows after the
binding repair), and a strict pool of `2,012`
before the proper-name fix.

A first fresh 20-row Qwen source review was structurally stable (`20/20` valid,
zero transport failures) but approved only `14/20`. Gemma independently
approved all 14 locked Qwen accepts. The six Qwen rejections exposed real
target-term problems such as wrong POS or wrong Chinese/Japanese sense, so this
source must stay in the strict lane. Do not expand the remaining 31 fresh rows
or treat CedPane as a fast-lane source until candidate term selection reaches
the normal source-review threshold.

The six rejected target terms were sent through the existing bounded repair
path. The first attempt exposed an old utility bug: both Qwen and Gemma used
their output budget without returning JSON because the request omitted
`enable_thinking=false`. `suggest-dictionary-v2-product-target-terms-unsloth.mjs`
now disables reasoning, defaults to 320 output tokens, and records truncated
raw content on parse failure. The corrected Gemma run returned `6/6` valid
JSON responses. Deterministic two-family validation retained only two repairs:
`あたら -> 呜呼` and `entonação -> 语调`. The other four remain manual review;
LLM suggestions alone are not evidence. Even with both repairs, the bounded
cohort reaches at most `16/20`, so it still cannot unlock expansion.

The capitalized-anchor filter also previously missed names containing lowercase
connectors, such as `Saint Kitts and Nevis`. It now permits common connectors
inside the pattern while requiring every other token to be title-cased. The
final strict report contains 1,989 rows; the named-country regression is
`unsupported/capitalized_proper_or_named_english_anchor`, and the `Maltese dog`
false positive is no longer supported.

After excluding complete history and the first 20 reviewed source entries, a
second fresh cohort approved `17/20`. Only five additional unseen entries
remained after excluding both reviewed cohorts, and Qwen approved `4/5`.
Therefore the corrected fresh sample is `21/25` (84%), with `25/25` valid JSON
and zero transport failures. The source is useful but remains below the 90%
expansion gate. Do not recycle historical entries to manufacture a third
20-row cohort; acquire another independent source or improve sense/POS-bound
target selection first.

The lexical evidence rules are covered by a committed regression check:

```powershell
npm.cmd run check:source-gap-lexical-contract
```

It locks the bidirectional phrase-coverage behavior (`Maltese` must not satisfy
`Maltese dog`) and proper-name detection with lowercase connectors (`Saint
Kitts and Nevis`). Run it whenever the source-gap prefilter or a supplemental
lexical probe changes.

The first CedPane evidence export incorrectly stored candidate IDs only in its
provenance table while giving `lexical_evidence.concept_id` a reusable CedPane
hash. The main prefilter binds supplemental rows only when that field is
`candidate:<entry>:<sense>`, so terms could leak across aligned senses sharing
an English anchor. The corrected exporter writes candidate-bound concept IDs
and fails if any exported row is unbound. Rebuilding the strict pool removed
23 leaked rows (`1,989 -> 1,966`), including the `lantejoula` false match.

Because all remaining candidate-bound CedPane rows had already been reviewed,
there was no honest fresh CedPane cohort after this repair. The earlier
`21/25` result is therefore diagnostic rather than an expansion gate result.
A separate fresh 20-row sample from the complete strict-v4 pool returned valid
JSON for all rows but only `8 accept / 10 reject / 2 manual_review`. Rejections
were primarily cross-language sense collisions (`rotary`, `mould`, `mate`) plus
regional or grammatical mismatch. Keep semantic source review mandatory; do
not send this pool directly to generation or Gemma final review.

The eight Qwen accepts were independently source-reviewed by Gemma: six passed,
one was rejected (`買物`, noun-versus-verb Chinese mismatch), and one remained
manual (`永い`, thin Chinese definition contract). Qwen then generated complete
four-language records for all six consensus candidates in about 29 seconds;
all six passed deterministic reverse evidence. Final full-record Gemma review
accepted only four and rejected `prevalência` (general prevalence mixed with
medical prevalence/dominance) and `automação` (automation mixed with
mechanization). The authoritative funnel is therefore `20 -> 8 -> 6 -> 6 -> 4`
(20% final yield), with zero database writes. Infrastructure is healthy, but
the current candidate pool is not suitable for large-scale generation.

### Shared-concept lexical-equivalence gate (2026-08-15)

`select-dictionary-v2-source-gap-shared-concept.mjs` can isolate candidates
whose target languages share one locked OMW or Wikidata concept. This is a
useful recall filter, not sufficient publication evidence: a co-synset term
may be conceptually related without being a lexical translation.

The `キロリットル` regression exposed this distinction. OMW proposed
Portuguese `metro cubico`, which denotes an equivalent volume but does not
translate the lexical unit name. WikDict provides the exact Portuguese term
`quilolitro`. The reverse-gloss index now expands compound English anchors
such as `kiloliter; kilolitre; cubic meter; cubic metre` and prioritizes terms
matching the earliest English sense before comparing evidence-family counts.

After that repair the preferred hint is `quilolitro`, but it has only the
Wiktionary source family in the current evidence database. The strict
independent-target gate therefore rejects the candidate before any LLM call.
Do not fall back to `metro cubico`, count Kaikki and WikDict separately, or
relax the two-family rule merely to complete a four-language record.

The follow-up target-evidence path resolved this candidate without relaxing
the gate. `probe-dicionario-aberto-target-terms.mjs` looked up the preferred
Portuguese generation hint in the licensed Dicionario Aberto XML and found
`quilolitro: Medida de mil litros.` Qwen (`0.95`) and Gemma (`1.0`)
independently approved the same definition. The exporter now writes
`candidate:<entry>:<sense>` concept IDs; legacy
`dicionario-aberto-definition:<entry>:<sense>` IDs are also interpreted as
candidate-bound during migration so they cannot leak across candidates.

The first full replay still failed correctly because Chinese was locked to
`立方米`, an equivalent volume rather than the lexical unit name. The reverse
target index now includes WikDict Chinese, merges British and American
`litre/liter` and `metre/meter` spelling variants into one lexical priority,
and prefers the mainland term `千升` over legacy or Taiwan-oriented forms
`公秉`, `千公升`, `竏`, and `千竔`. The corrected four-language lock is
`kiloliter / quilolitro / 千升 / キロリットル`.

The final no-write pipeline passed every stage: Qwen source review, Gemma
source review, deterministic source reverse evidence, semantic preview Gemma,
Qwen complete generation, deterministic generated-record reverse evidence,
and final Gemma (`1/1` throughout the accepted path). No product DB rows were
written. This validates the acquisition method, not a broad expansion gate;
apply it to a fresh bounded cohort before scaling.
### Mainland Chinese target-term ranking (v98)

Reverse-gloss indexes must not keep the first Chinese terms encountered in
source-row order. That favored rare, historical, or Taiwan-oriented forms and
could hide a common mainland term before generation-hint ranking ran. Chinese
reverse-gloss buckets now retain up to 64 terms, ordered by the narrow regional
unit rule and the minimum `entries.frequency_rank` across simplified and
traditional lookup variants. Lexical-anchor priority still runs first, so a
frequent related concept cannot replace the requested lexical translation.

The v13 full rerun covered 1,966 candidates and selected 1,475. It changed
`敏い / clever` from the rare `㑇` hint to `聪明`, `机灵`, and related forms,
which restored independent reverse evidence and made that candidate supported.
It also kept `花俏` ahead of less common gaudy synonyms. The Dicionario Aberto
target batch improved Portuguese evidence for 11 rows, but unlocked none by
itself because most still lacked a second independent Chinese family. Do not
count this as a model failure or lower the two-family gate; acquire evidence
for the modern Chinese term instead.

Caching canonical term frequency reduced the same full prefilter from about
149.6 seconds to 27.0 seconds. Candidate-bound evidence audit passed with 1,966
validations, 1,398 bound rows, and zero violations. No product database row was
written by this experiment.

### v98 current-code scale readiness

Three bounded low-ambiguity runs established a minimum 20-record generated
sample: 60 raw candidates produced 25 generation-ready records, 23 valid
generations, 23 reverse-supported records, and 21 final no-correction accepts.
The measured rates were 92.0% generation validity, 100% reverse support, 91.3%
final acceptance, and zero infrastructure failures. The reproducible evaluator
is `npm run dict:v2:remote-scale-readiness`; it deliberately reports raw
candidate-to-generation yield separately from generation quality.

The current-code pressure run `v98-mainland-pressure489-v15` then processed 489
unique candidate entries through three Qwen workers and three Gemma workers.
It produced 149 generation-ready records, 147 valid generations, 147
reverse-supported records, and 142 final accepts including one bounded repair.
That is 98.7% generation validity and 96.6% final acceptance with zero
infrastructure failures and zero database writes. The run passed every scale
readiness gate.

The earlier isolated 2,000-record qualification remains present and audited:
1,619 records were promoted in the isolated database, all blocking audit
counters were zero, and native export/import matched. Together with the new
489-record current-code regression, this is sufficient to start large-batch
generation. Do not interpret it as 5,000-record source capacity: rebuilding the
34,216 aligned gaps with current v8 evidence yields only 1,523 strict
candidates. Additional dictionary evidence is required beyond that capacity.

Candidate-bound evidence subsets are additive. Never use `--replace-family`
when merging a new CedPane or pivot batch unless the new database is a complete
replacement for every prior candidate-bound subset in that family. Replacing
the family temporarily dropped the strict pool from 1,475 to 1,405; incremental
merge restored prior evidence and raised it to 1,497.
