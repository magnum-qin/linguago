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
npm run dict:v2:import:sources -- --sources ecdict,kaikki-zh,cedict,jmdict
```

For a quick validation sample, use a small limit per source:

```powershell
npm run dict:v2:init -- --db data/processed/linguago_v2_sample.db --reset
npm run dict:v2:import:sources -- --db data/processed/linguago_v2_sample.db --sources ecdict,kaikki-zh,cedict,jmdict --limit 25
```

These commands only populate `dictionary_sources`, `source_entries`, and `source_senses`. They do not create canonical `entries/senses/sense_localizations` yet.

Build a first-pass canonical dictionary from staging:

```powershell
npm run dict:v2:build:canonical -- --db data/processed/linguago_v2_sample.db
```

The first-pass builder is deliberately conservative: each source sense becomes one canonical sense with one `sense_localizations` row in the source language. It records missing-language `quality_issues` instead of trying to guess cross-language alignment. Later pipeline stages should merge equivalent senses across sources and use LLM jobs only for missing localizations.

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
- `cc-cedict`: 125,006 source entries / 200,408 source senses.
- `jmdict`: 217,352 source entries / 251,486 source senses.

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
- `pt-BR`: 0 ranked source entries because the current open-source inputs do not include a Portuguese lemma source; Portuguese is generated as a target localization.

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

The export audit imports the generated SQL into `outputs/d1-v2-product-native-export/audit-import.db`, then writes `audit.json` and `audit-samples.json`. It is a publish gate for structural problems: manifest/count mismatches, missing four-language sense localizations, duplicate published sense order, empty required fields, orphan rows including broken pronunciation-group links, duplicate simplified/traditional Chinese examples, and failed key sample lookups. It also records non-blocking product quality warnings such as Chinese terms containing kana or Japanese terms that are still pure Latin text; review those warnings before expanding the batch, but they do not block a structurally valid D1 push.

For a normal product D1 release, use the combined release command instead of running each publish step manually:

```powershell
npm run dict:v2:release:product-d1
```

This runs product example dedupe, deterministic quality-warning repair, product-native D1 export, product export audit, TypeScript check, Cloudflare D1 push, and online UI smoke in sequence. Use the script directly with `-SkipPush` when you want a local release rehearsal without touching remote D1:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release-dictionary-v2-product-d1.ps1 -SkipPush
```

The first full-database completion batches used `qwen3.6:latest` with `profile core` and `--max-senses-per-entry 1`, then moved to the A6000 cluster behind `100.99.99.99`. Current production nodes:

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
