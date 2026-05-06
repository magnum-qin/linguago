#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:?accepted jsonl path required}"
RUN="${2:-$(basename "$INPUT" .accepted.jsonl)}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="${NODE:-$ROOT_DIR/runtime/node/bin/node}"
STATE_DIR="$ROOT_DIR/state"
STATE_FILE="$STATE_DIR/imported-runs.txt"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

mkdir -p "$STATE_DIR"
touch "$STATE_FILE"

if grep -Fxq "$RUN" "$STATE_FILE"; then
  echo "Already imported $RUN"
  exit 0
fi

"$NODE" "$ROOT_DIR/scripts/import-generated-dictionary.mjs" "$INPUT" "$ROOT_DIR/data/dictionary.sqlite"
echo "$RUN" >> "$STATE_FILE"

if [[ -n "${DICTIONARY_API_TOKEN:-}" ]]; then
  curl -fsS \
    -H "Authorization: Bearer $DICTIONARY_API_TOKEN" \
    "http://127.0.0.1:${DICTIONARY_PORT:-8787}/admin/reload" >/dev/null || true
fi

echo "Imported $RUN"
