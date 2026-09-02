#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const promoter = fs.readFileSync('scripts/promote-dictionary-v2-product-source-gap-drafts.mjs', 'utf8');
const publisher = fs.readFileSync('scripts/publish-remote-dictionary-controlled-run.ps1', 'utf8');

assert.match(
  promoter,
  /accepted_sense_ids:\s*accepted\.map\(\(item\) => Number\(item\.candidate\.sense_id\)\)/,
  'promote reports must include every accepted sense ID',
);
assert.match(
  publisher,
  /PSObject\.Properties\['accepted_sense_ids'\]/,
  'publisher must prefer the complete accepted sense ID set',
);
assert.match(
  publisher,
  /accepted_preview\)\.Count -eq \[int64\]\$PromoteDry\.stats\.accepted/,
  'legacy preview fallback must be allowed only when the preview is complete',
);
assert.match(
  publisher,
  /accepted sense ID count does not match accepted stats/,
  'publisher must reject incomplete or duplicate accepted ID sets',
);

console.log(JSON.stringify({ ok: true }));
