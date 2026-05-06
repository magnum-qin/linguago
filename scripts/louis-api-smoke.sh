#!/usr/bin/env bash
set -euo pipefail

cd /root/translation-dictionary-api
TOKEN="$(sed -n 's/^DICTIONARY_API_TOKEN=//p' .env)"

echo "stats"
curl -sS -H "Authorization: Bearer ${TOKEN}" \
  "http://127.0.0.1:8787/api/dictionary/stats"
echo

echo "lookup"
curl -sS -H "Authorization: Bearer ${TOKEN}" \
  "http://127.0.0.1:8787/api/dictionary/lookup?term=you" | head -c 700
echo

echo "unauthorized"
curl -sS -i "http://127.0.0.1:8787/api/dictionary/stats" | head -5
