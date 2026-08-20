#!/usr/bin/env node

import assert from 'node:assert/strict';
import { inspectFreeDictProvenanceXml } from './lib/freedict-source-provenance.mjs';

const wrap = (sourceDesc) => `<?xml version="1.0"?><TEI><teiHeader><fileDesc><titleStmt><title>Fixture</title></titleStmt><sourceDesc><p>${sourceDesc}</p></sourceDesc></fileDesc></teiHeader></TEI>`;

const wikdict = inspectFreeDictProvenanceXml(wrap('Automatic creation by WikDict from Wiktionary via DBnary.'));
assert.equal(wikdict.source_family, 'wiktionary');
assert.equal(wikdict.independent_lexical_family, false);

const ergane = inspectFreeDictProvenanceXml(wrap('This Database was generated from Ergane. Home: TravLang.'));
assert.equal(ergane.source_family, 'freedict-ergane');
assert.equal(ergane.independent_lexical_family, true);

const ding = inspectFreeDictProvenanceXml(wrap('Based on the TU Chemnitz Ding dictionary.'));
assert.equal(ding.source_family, 'freedict-ding');
assert.equal(ding.independent_lexical_family, true);

const unknown = inspectFreeDictProvenanceXml(wrap('Unspecified historical source.'));
assert.equal(unknown.source_family, 'freedict-unresolved');
assert.equal(unknown.production_evidence_eligible, false);

console.log(JSON.stringify({ ok: true, cases: 4 }, null, 2));
