#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/translation-pwa"

RUN="qwen35b-prod-200"
NODE="$HOME/opt/node-v22.16.0-linux-x64/bin/node"
OUT_DIR="output/batches/$RUN"

mkdir -p "$OUT_DIR"

export OLLAMA_HOST="http://100.93.53.98:11437"
export OLLAMA_MODEL="qwen3.6:35B"

nohup bash -lc "
  '$NODE' scripts/ollama-schema-test.mjs \
    --candidates-file data/processed/frequency_candidates.jsonl \
    --limit 200 \
    --word-only \
    --out '$OUT_DIR/generated.jsonl' \
    --fail-out '$OUT_DIR/generated.failed.jsonl' \
    --retries 2 \
    --timeout 180000 \
    --max-tokens 2600

  '$NODE' scripts/validate-generated-dictionary.mjs \
    '$OUT_DIR/generated.jsonl' \
    '$RUN'

  '$NODE' scripts/import-generated-dictionary.mjs \
    'data/processed/$RUN.accepted.jsonl'
" > "$OUT_DIR/run.log" 2> "$OUT_DIR/run.err.log" &

echo "STARTED pid=$!"
sleep 1
ps -p "$!" -o pid,etime,pcpu,pmem,args
