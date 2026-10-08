import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./supplement-dictionary-v2-product-source-gaps-unsloth.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function replayGeneratedReport() {');
const end = source.indexOf('\nfunction ', start + 1);
assert.ok(start >= 0 && end > start);
const body = source.slice(start, end);
const original = { localizations: { en: { term: 'moisturizing', pronunciation: '/test/' } }, source_meaning_anchors: ['locked'] };
for (const controlled of [true, false]) {
  let normalizations = 0;
  let validated;
  const input = structuredClone(original);
  const stop = new Error('stop after validation');
  const context = vm.createContext({
    fs: { readFileSync: () => JSON.stringify({ generated: [{ valid: true, output: input }] }) },
    replayReportPath: 'fixture', selected: [{}], replayCandidateKey: () => 'entry:sense',
    controlledConsensusDraftWrite: controlled, replayInvalidOutputs: false,
    validateControlledConsensusReplay: () => new Set(['entry']), structuredClone,
    normalizeGeneratedOutput: (_row, output) => {
      normalizations++;
      output.localizations.en.term = 'stale preferred term';
      return output;
    },
    validateOutput: (_row, output) => { validated = structuredClone(output); throw stop; }
  });
  assert.throws(() => vm.runInContext(`${body}\nreplayGeneratedReport();`, context), error => error === stop);
  assert.equal(normalizations, controlled ? 0 : 1);
  if (controlled) assert.deepEqual(validated, original);
  else assert.equal(validated.localizations.en.term, 'stale preferred term');
}
console.log('Controlled replay preserves reviewed content; ordinary replay retains normalization.');
