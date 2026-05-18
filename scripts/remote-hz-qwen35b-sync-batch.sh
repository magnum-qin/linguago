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
STATUS_DIR="${STATUS_DIR:-state/batches}"
STATUS_FILE="$STATUS_DIR/$RUN.status"

mkdir -p "$OUT_DIR" "$STATUS_DIR"

write_status() {
  local state="$1"
  local message="${2:-}"
  {
    echo "run=$RUN"
    echo "state=$state"
    echo "message=$message"
    echo "batch_start=$BATCH_START"
    echo "batch_size=$BATCH_SIZE"
    echo "updated_at=$(date -Is)"
    echo "ollama_host=${OLLAMA_HOST:-}"
    echo "ollama_model=${OLLAMA_MODEL:-}"
    echo "candidates_file=$CANDIDATES_FILE"
    echo "generated_file=$OUT_DIR/generated.jsonl"
    echo "failed_file=$OUT_DIR/generated.failed.jsonl"
    echo "accepted_file=data/processed/$RUN.accepted.jsonl"
    echo "needs_review_file=data/processed/$RUN.needs_review.jsonl"
    echo "generated_count=$(wc -l < "$OUT_DIR/generated.jsonl" 2>/dev/null || echo 0)"
    echo "failed_count=$(wc -l < "$OUT_DIR/generated.failed.jsonl" 2>/dev/null || echo 0)"
    echo "accepted_count=$(wc -l < "data/processed/$RUN.accepted.jsonl" 2>/dev/null || echo 0)"
    echo "needs_review_count=$(wc -l < "data/processed/$RUN.needs_review.jsonl" 2>/dev/null || echo 0)"
    echo "remote_incoming=$LOUIS_DIR/incoming/$RUN.accepted.jsonl"
  } > "$STATUS_FILE"
}

on_error() {
  local exit_code=$?
  write_status "failed" "exit_code=$exit_code line=${BASH_LINENO[0]:-unknown}"
  exit "$exit_code"
}

trap on_error ERR

end_line=$((BATCH_START + BATCH_SIZE - 1))
sed -n "${BATCH_START},${end_line}p" "$SOURCE_FILE" > "$CANDIDATES_FILE"

if [[ ! -s "$CANDIDATES_FILE" ]]; then
  write_status "empty" "no candidates found for ${BATCH_START}-${end_line}"
  echo "No candidates found for ${BATCH_START}-${end_line}" >&2
  exit 1
fi

export OLLAMA_HOST="${OLLAMA_HOST:-http://100.93.53.98:11437}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.6:35B}"

write_status "started" "generation started"

"$NODE" scripts/ollama-schema-test.mjs \
  --candidates-file "$CANDIDATES_FILE" \
  --word-only \
  --out "$OUT_DIR/generated.jsonl" \
  --fail-out "$OUT_DIR/generated.failed.jsonl" \
  --retries 2 \
  --timeout 180000 \
  --max-tokens 2600

write_status "generated" "generation completed"

"$NODE" scripts/validate-generated-dictionary.mjs \
  "$OUT_DIR/generated.jsonl" \
  "$RUN"

write_status "validated" "validation completed"

"$NODE" scripts/import-generated-dictionary.mjs \
  "data/processed/$RUN.accepted.jsonl"

write_status "imported-local" "local import completed"

accepted_file="data/processed/$RUN.accepted.jsonl"
if [[ ! -s "$accepted_file" ]]; then
  write_status "no-accepted" "no accepted entries to sync"
  echo "No accepted entries to sync for $RUN" >&2
  exit 1
fi

remote_incoming="$LOUIS_DIR/incoming/$RUN.accepted.jsonl"
ssh "$LOUIS_HOST" "mkdir -p '$LOUIS_DIR/incoming' '$LOUIS_DIR/state'"
scp "$accepted_file" "$LOUIS_HOST:$remote_incoming"
ssh "$LOUIS_HOST" "cd '$LOUIS_DIR' && ./bin/import-incoming.sh '$remote_incoming' '$RUN'"

write_status "synced" "synced to $LOUIS_HOST"
echo "Synced $RUN to $LOUIS_HOST"
