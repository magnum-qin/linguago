#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const supervisor = fs.readFileSync('scripts/complete-remote-dictionary-production-run.ps1', 'utf8');
const publisher = fs.readFileSync('scripts/publish-remote-dictionary-controlled-run.ps1', 'utf8');

assert.doesNotMatch(
  supervisor,
  /audit-dictionary-v2-production-cadence\.mjs/u,
  'supervisor must not run cadence audit before controlled replay exists'
);

const validationIndex = publisher.indexOf('validate-remote-dictionary-controlled-replay.ps1');
const cadenceIndex = publisher.indexOf('audit-dictionary-v2-production-cadence.mjs');
const replaceIndex = publisher.indexOf('[IO.File]::Replace');

assert.ok(validationIndex >= 0, 'controlled replay validation call is missing');
assert.ok(cadenceIndex > validationIndex, 'cadence audit must run after controlled replay');
assert.ok(replaceIndex > cadenceIndex, 'cadence audit must run before main DB replacement');

console.log('Remote production supervisor ordering regression passed.');
