#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/translation-pwa"

STATE_DIR="${STATE_DIR:-state}"
LOG_DIR="${LOG_DIR:-logs}"
LOCK_FILE="$STATE_DIR/hz-dictionary-sync.lock"
NEXT_FILE="$STATE_DIR/hz-dictionary-next-start.txt"
BATCH_SIZE="${BATCH_SIZE:-200}"
DEFAULT_START="${DEFAULT_START:-1201}"

mkdir -p "$STATE_DIR" "$LOG_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

{
  start=""
  start="$(cat "$NEXT_FILE" 2>/dev/null || true)"
  if [[ ! "$start" =~ ^[0-9]+$ ]]; then
    start="$DEFAULT_START"
  fi

  total=""
  total="$(wc -l < data/processed/frequency_candidates.jsonl)"
  if (( start > total )); then
    echo "$(date -Is) all candidates completed: next=$start total=$total"
    return 0
  fi

  end=$((start + BATCH_SIZE - 1))
  run="qwen35b-prod-${start}-${end}"

  echo "$(date -Is) starting $run"
  BATCH_START="$start" BATCH_SIZE="$BATCH_SIZE" RUN="$run" \
    ./scripts/remote-hz-qwen35b-sync-batch.sh

  echo "$((start + BATCH_SIZE))" > "$NEXT_FILE"
  echo "$(date -Is) completed $run; next=$(cat "$NEXT_FILE")"
} >> "$LOG_DIR/hz-dictionary-sync.log" 2>> "$LOG_DIR/hz-dictionary-sync.err.log"
