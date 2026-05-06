#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/translation-pwa"

BATCH_START="${BATCH_START:-1201}"
BATCH_SIZE="${BATCH_SIZE:-200}"
RUN="${RUN:-qwen35b-prod-${BATCH_START}-$((BATCH_START + BATCH_SIZE - 1))}"
NODE="${NODE:-$HOME/opt/node-v22.16.0-linux-x64/bin/node}"
OUT_DIR="output/batches/$RUN"
SOURCE_FILE="data/processed/frequency_candidates.jsonl"
CANDIDATES_FILE="$OUT_DIR/candidates.jsonl"
LOUIS_HOST="${LOUIS_HOST:-louis-dictionary}"
LOUIS_DIR="${LOUIS_DIR:-/root/translation-dictionary-api}"

mkdir -p "$OUT_DIR"

end_line=$((BATCH_START + BATCH_SIZE - 1))
sed -n "${BATCH_START},${end_line}p" "$SOURCE_FILE" > "$CANDIDATES_FILE"

if [[ ! -s "$CANDIDATES_FILE" ]]; then
  echo "No candidates found for ${BATCH_START}-${end_line}" >&2
  exit 1
fi

export OLLAMA_HOST="${OLLAMA_HOST:-http://100.93.53.98:11437}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.6:35B}"

"$NODE" scripts/ollama-schema-test.mjs \
  --candidates-file "$CANDIDATES_FILE" \
  --word-only \
  --out "$OUT_DIR/generated.jsonl" \
  --fail-out "$OUT_DIR/generated.failed.jsonl" \
  --retries 2 \
  --timeout 180000 \
  --max-tokens 2600

"$NODE" scripts/validate-generated-dictionary.mjs \
  "$OUT_DIR/generated.jsonl" \
  "$RUN"

"$NODE" scripts/import-generated-dictionary.mjs \
  "data/processed/$RUN.accepted.jsonl"

accepted_file="data/processed/$RUN.accepted.jsonl"
if [[ ! -s "$accepted_file" ]]; then
  echo "No accepted entries to sync for $RUN" >&2
  exit 1
fi

remote_incoming="$LOUIS_DIR/incoming/$RUN.accepted.jsonl"
ssh "$LOUIS_HOST" "mkdir -p '$LOUIS_DIR/incoming' '$LOUIS_DIR/state'"
scp "$accepted_file" "$LOUIS_HOST:$remote_incoming"
ssh "$LOUIS_HOST" "cd '$LOUIS_DIR' && ./bin/import-incoming.sh '$remote_incoming' '$RUN'"

echo "Synced $RUN to $LOUIS_HOST"
