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

## Database

The planned SQLite / Cloudflare D1-compatible schema is in `data/schema/dictionary.sql`.

The schema keeps these layers separate:

- `dictionary_source_candidates`: cleaned public dictionary and frequency metadata.
- `dictionary_generation_runs`: model, prompt, schema version, and run stats.
- `dictionary_generation_outputs`: raw model output plus validation errors and warnings.
- `dictionary_entries`: accepted canonical lookup entries.
- `dictionary_translations`, `dictionary_definitions`, `dictionary_examples`, `dictionary_pronunciations`: expandable child tables.

## Notes

Frequency order is currently based on `hermitdave/FrequencyWords` because the earlier `wordfrequency.info` mirror had machine-translated Chinese terms such as `一世` for a high-rank English-derived item. The older files are still downloaded for comparison, but the generation batch uses `FrequencyWords` by default.
