#!/usr/bin/env node
// Manages deferred D1 pushes: accumulates main-DB repairs locally and
// releases them as a single D1 push at an explicit trigger or optimal time.
// Prevents multiple daily D1 pushes from burning free-tier row-read quota.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STATE_FILE = 'state/d1-deferred-push.json';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'status';

function readState() {
  const p = path.resolve(STATE_FILE);
  if (!fs.existsSync(p)) return { pending: [], last_push: null };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeState(state) {
  fs.mkdirSync(path.dirname(path.resolve(STATE_FILE)), { recursive: true });
  fs.writeFileSync(path.resolve(STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

const state = readState();

switch (command) {
  case 'add': {
    const description = args.description || 'unnamed repair';
    const dbPath = args.db;
    if (!dbPath || !fs.existsSync(path.resolve(dbPath))) {
      throw new Error('--db required and must exist');
    }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(dbPath))).digest('hex');
    const entry = { description, db_sha256: sha, added_at: new Date().toISOString() };
    // Skip if the latest pending entry has the same hash (no new changes)
    const last = state.pending[state.pending.length - 1];
    if (last && last.db_sha256 === sha) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: 'db unchanged since last pending entry' }));
      process.exit(0);
    }
    state.pending.push(entry);
    writeState(state);
    console.log(JSON.stringify({ ok: true, queued: state.pending.length, description, db_sha256: sha.slice(0, 16) }));
    break;
  }
  case 'status': {
    console.log(JSON.stringify({
      pending_count: state.pending.length,
      pending: state.pending.map((p) => `${p.added_at.slice(0, 19)} ${p.description}`),
      last_push: state.last_push,
      recommendation: state.pending.length >= 3 ? 'ready_to_push' : state.pending.length >= 1 ? 'optional' : 'empty'
    }, null, 2));
    break;
  }
  case 'clear': {
    state.last_push = { cleared_at: new Date().toISOString(), entries: state.pending.length };
    state.pending = [];
    writeState(state);
    console.log(JSON.stringify({ ok: true, cleared: true }));
    break;
  }
  default:
    console.error('Usage: node schedule-d1-deferred-push.mjs [add --db <path> --description <text>] | [status] | [clear]');
    process.exit(1);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) { result._.push(argv[i]); continue; }
    const next = argv[i + 1];
    result[argv[i].slice(2)] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return result;
}
