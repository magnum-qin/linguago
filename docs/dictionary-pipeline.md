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
- `sense_localizations`: four-language term, reading, pronunciation, definition, and usage note rows keyed by `sense_id + lang`.
- `examples`, `example_localizations`: sense-attached examples with four-language text keyed by `example_id + lang`.
- `llm_completion_jobs`, `quality_issues`: generated-data tracking and validation results.

## Notes

Frequency order is currently based on `hermitdave/FrequencyWords` because the earlier `wordfrequency.info` mirror had machine-translated Chinese terms such as `一世` for a high-rank English-derived item. The older files are still downloaded for comparison, but the generation batch uses `FrequencyWords` by default.
