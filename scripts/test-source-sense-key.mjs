import assert from "node:assert/strict";
import { candidateSourceSenseKey, sourceSenseKey } from "./lib/source-sense-key.mjs";

assert.equal(sourceSenseKey(2035055, null), "2035055:0");
assert.equal(sourceSenseKey(2035055, undefined), "2035055:0");
assert.equal(candidateSourceSenseKey({ source_entry_id: 2035055 }), "2035055:0");
assert.equal(
  candidateSourceSenseKey({ source_entry_id: 2035055, first_sense_id: 42 }),
  "2035055:42"
);
assert.equal(
  candidateSourceSenseKey({ source_entry_id: 2035055, useful_senses: [{ id: 81 }] }),
  "2035055:81"
);

console.log("source-sense key tests passed");
