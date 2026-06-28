# Dictionary Pipeline

This pipeline builds a fast four-language word dictionary for the translation PWA.

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

For a real write, change `--dry-run true --apply false` to `--dry-run false --apply true`, then run the fast audit:

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

| Table | Rows |
| --- | ---: |
| `v2_entries` | 29144 |
| `v2_senses` | 29675 |
| `v2_sense_localizations` | 118700 |
| `v2_examples` | 3057 |
| `v2_example_localizations` | 12006 |

Online checks after deployment passed for core samples and manual residual samples (`facebook`, `dvd`, `bmw`, `女婿`, `ダイナー`), all returning `provider=dictionary` and `model=cloudflare-d1-v2`.

Post-release quality cleanup on 2026-06-24 closed the deterministic Japanese Latin-only warning set and merged only the safest same-entry duplicate senses. The updated export is `outputs/d1-v2-product-native-export-quality-fixes-20260624`; it passed full import audit and was pushed to Cloudflare D1 `linguago-dictionary`.

Remote D1 counts after the quality-fix push:

| Table | Rows |
| --- | ---: |
| `v2_entries` | 29144 |
| `v2_senses` | 29668 |
| `v2_sense_localizations` | 118672 |
| `v2_examples` | 3057 |
| `v2_example_localizations` | 12006 |

The post-fix audit has no `zh_terms_with_kana` or `ja_terms_with_latin_only` warnings. It still reports `80` duplicate same-entry localization warnings, but the conservative merge scanner finds no remaining rule-safe merge pairs; keep those for semantic review instead of automatic deletion. Online checks for `of`, `would`, `were`, `been`, `gonna`, and `could` return the repaired Japanese entries from `provider=dictionary`, `model=cloudflare-d1-v2`.

The first semantic duplicate review pass is recorded in `logs/product-semantic-duplicate-review-20260624.json` and `logs/product-semantic-duplicate-review-20260624.md`. The `80` duplicate localization groups collapsed to `63` unique sense pairs: `18` were appropriate for LLM semantic review and `45` were single-term collision/manual review cases. The LLM review used `scripts/review-dictionary-v2-product-semantic-duplicates-unsloth.mjs` against the 4090 Unsloth endpoints and produced `logs/product-semantic-duplicate-llm-review-20260624.json`: `17` merge decisions and `1` keep-separate decision (`aunty`).

The accepted LLM merge decisions were converted with `scripts/convert-dictionary-v2-product-llm-duplicate-review-to-merge-plan.mjs` into `logs/product-llm-approved-duplicate-merge-plan-20260624.json`, then applied through the existing duplicate merge applicator. This merged `17` senses, moved `4` source links, deleted `68` duplicate localizations, and preserved examples. The `aunty` keep-separate case was repaired manually with `scripts/repair-dictionary-v2-product-aunty-broad-sense-20260624.mjs` by broadening sense `22993` in Chinese, Japanese, and Portuguese instead of merging it.

Fast audit after this pass is `logs/product-fast-audit-after-aunty-repair-20260624.json` and is green. The remaining duplicate warning state is now:

| Metric | Count |
| --- | ---: |
| duplicate localization groups | 45 |
| unique sense pairs | 45 |
| LLM semantic-review pairs | 0 |
| conservative auto-merge pairs | 0 |

Treat the remaining `45` as manual keep/merge review items. They are not currently blocking publication because every publishable sense still has four valid localizations, no duplicate sense order, and no script/Latin-only warnings.

The semantic-dedupe release export is `outputs/d1-v2-product-native-export-semantic-dedupe-20260624`. It passed full import audit with samples `hello`, `你好`, `中`, `tight`, `graduate`, `aunty`, `机长`, `of`, `would`, `facebook`, `dvd`, `bmw`, `女婿`, and `ダイナー`, then was pushed to Cloudflare D1 `linguago-dictionary`.

Remote D1 counts after the semantic-dedupe push:

| Table | Rows |
| --- | ---: |
| `v2_entries` | 29144 |
| `v2_senses` | 29651 |
| `v2_sense_localizations` | 118604 |
| `v2_examples` | 3057 |
| `v2_example_localizations` | 12006 |

Online checks after the D1 push confirmed `tight` and `graduate` now each return one dictionary sense; `aunty` still returns two senses, with the broad second sense localized as `zh=阿姨`, `ja=おばさん`, and `pt-BR=tia`; `机长` returns one Chinese-source aviation-captain sense. No Worker redeploy was required because only D1 data changed.

The remaining manual-review duplicate queue was then reviewed with the same Unsloth semantic-review script using `--recommendations manual_keep_or_merge_review`. The report is `logs/product-manual-duplicate-llm-review-20260624.json`: `41` high-confidence merge decisions, `3` keep-separate decisions (`卿`, `ううん`, `frighten`), and `1` repair-before-merge decision (`murmuring`). The `41` merge decisions were applied from `logs/product-manual-llm-approved-duplicate-merge-plan-20260624.json`; `murmuring` was repaired with `scripts/repair-dictionary-v2-product-murmuring-20260624.mjs` and then merged with `logs/product-murmuring-repaired-duplicate-merge-plan-20260624.json`.

The final semantic-dedupe export is `outputs/d1-v2-product-native-export-semantic-dedupe-final-20260624`. It passed full import audit and was pushed to Cloudflare D1 `linguago-dictionary`.

Remote D1 counts after the final semantic-dedupe push:

| Table | Rows |
| --- | ---: |
| `v2_entries` | 29144 |
| `v2_senses` | 29609 |
| `v2_sense_localizations` | 118436 |
| `v2_examples` | 3057 |
| `v2_example_localizations` | 12006 |

The only remaining duplicate-localization warnings are the three intentional keep-separate cases:

| Entry | Reason to keep separate |
| --- | --- |
| `卿` | Distinct honorific/title vs suffix/pronoun usage. |
| `ううん` | General negative answer vs informal `nuh-uh` register. |
| `frighten` | General cause-fear sense vs scare-away/translation-direction nuance; needs later lexical cleanup before any merge. |

Online checks after the final D1 push confirmed `red` and `murmuring` now each return one sense, while `卿`, `ううん`, and `frighten` intentionally remain multi-sense. No Worker redeploy was required.

Current Unsloth production model guidance:

- Model: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`.
- Preferred quantization: `UD-IQ4_NL`.
- Runtime: `max_seq_length=8192`, `speculative_type=mtp`, `batch-size=1`.
- Use one worker per GPU endpoint. For the two RTX 4090 nodes, `--concurrency 2` across `11447,11448` is the tested setting.
- `UD-IQ4_NL` is smaller and faster than `UD-Q4_K_XL` for this task while keeping similar validation quality. It also fits the 24 GB RTX 4090 nodes without the previous CPU offload issue.

Relevant 2026-06-23 dry-run benchmarks:

| Node(s) | Endpoint(s) | Variant | Result | Throughput |
| --- | --- | --- | --- | --- |
| `a6000-155` | `11445` | `UD-IQ4_NL` | 48/50 accepted | 38.96 accepted/min |
| `rtx4090-56` | `11447` | `UD-IQ4_NL` | 47/50 accepted | 51.66 accepted/min |
| `rtx4090-47` | `11448` | `UD-IQ4_NL` | 47/50 accepted | 46.64 accepted/min |
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

| Table | Rows |
| --- | ---: |
| `v2_entries` | 23070 |
| `v2_senses` | 28761 |
| `v2_sense_localizations` | 115044 |
| `v2_examples` | 3049 |
| `v2_example_localizations` | 11974 |

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

| Table | Rows |
| --- | ---: |
| `v2_entries` | 23070 |
| `v2_entry_forms` | 161057 |
| `v2_pronunciation_groups` | 24878 |
| `v2_senses` | 28582 |
| `v2_sense_localizations` | 114328 |
| `v2_examples` | 3030 |
| `v2_example_localizations` | 11898 |

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

| Table | Rows |
| --- | ---: |
| `v2_entries` | 23070 |
| `v2_entry_forms` | 161074 |
| `v2_pronunciation_groups` | 24881 |
| `v2_senses` | 28582 |
| `v2_sense_localizations` | 114328 |
| `v2_examples` | 3030 |
| `v2_example_localizations` | 11898 |

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

## Notes

Frequency order is currently based on `hermitdave/FrequencyWords` because the earlier `wordfrequency.info` mirror had machine-translated Chinese terms such as `一世` for a high-rank English-derived item. The older files are still downloaded for comparison, but the generation batch uses `FrequencyWords` by default.
