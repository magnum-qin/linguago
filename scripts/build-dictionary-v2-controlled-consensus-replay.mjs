#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const generationPath = requiredPath(args.generation, 'generation');
const consensusPath = requiredPath(args.consensus, 'consensus');
const outPath = path.resolve(String(args.out || '').trim());
if (!String(args.out || '').trim()) throw new Error('Missing --out');

const generation = readJson(generationPath);
const consensus = readJson(consensusPath);
const generated = Array.isArray(generation.generated) ? generation.generated : [];
const reviews = Array.isArray(consensus.reviews) ? consensus.reviews : [];
const acceptedRows = reviews
  .filter((row) =>
    row?.valid === true &&
    row?.decision === 'accept' &&
    row?.consensus_accepted === true &&
    Number(row?.confidence || 0) >= 0.9
  );
const acceptedEntryIds = new Set(
  acceptedRows.map((row) => Number(row.source_entry_id))
);
if (acceptedEntryIds.size !== acceptedRows.length) {
  throw new Error('Consensus report contains multiple accepted senses for the same source entry');
}
const matched = generated.filter(
  (row) => row?.valid === true && acceptedEntryIds.has(Number(row.source_entry_id))
);

if (matched.length !== acceptedEntryIds.size) {
  const generatedEntryIds = new Set(matched.map((row) => Number(row.source_entry_id)));
  const missing = [...acceptedEntryIds].filter((entryId) => !generatedEntryIds.has(entryId));
  throw new Error(`Consensus accepted ${acceptedEntryIds.size} rows but only ${matched.length} generated rows matched: ${missing.slice(0, 8).join(', ')}`);
}

const excludedProperLike = [];
const selected = matched.filter((row) => {
  const reason = latinProperLikeReason(row);
  if (!reason) return true;
  excludedProperLike.push({
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row?.output?.source_sense_id || 0) || null,
    word: row.word,
    source_lang: row.source_lang,
    reason
  });
  return false;
});

const report = {
  ...generation,
  generated_at: new Date().toISOString(),
  stats: {
    ...(generation.stats || {}),
    generated: selected.length,
    accepted: selected.length,
    rejected: 0,
    consensus_filtered: true,
    consensus_accepted: acceptedEntryIds.size,
    proper_like_excluded: excludedProperLike.length,
    replay_accepted: selected.length
  },
  generated: selected,
  selection_policy: {
    lane: 'controlled_model_consensus',
    automatic_promotion: false,
    final_generation_evidence_consensus_gate: true,
    require_independent_no_correction_consensus: true
  },
  derived_from: {
    generation: generationPath,
    consensus: consensusPath,
    excluded_source_entry_ids: excludedProperLike.map((row) => row.source_entry_id),
    excluded_proper_like: excludedProperLike
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true,
  generation_rows: generated.length,
  consensus_reviews: reviews.length,
  consensus_accepted: acceptedEntryIds.size,
  proper_like_excluded: excludedProperLike.length,
  replay_rows: selected.length,
  out: outPath
}, null, 2));

function latinProperLikeReason(row) {
  if (!['en', 'pt-BR'].includes(String(row?.source_lang || ''))) return null;
  const word = String(row?.word || '').trim();
  if (!word || !/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]*$/u.test(word)) return null;

  const output = row?.output || {};
  const en = output?.localizations?.en || {};
  const partOfSpeech = String(output.part_of_speech || '').toLowerCase();
  const anchor = String(output.source_meaning_anchor || '').trim().toLowerCase();
  const definition = String(en.definition || '').trim().toLowerCase();

  if (/\bproper\s+noun\b/.test(partOfSpeech)) return 'proper_noun_part_of_speech';
  if (/^(?:a|the)\s+(?:brand|trademark)\b|^the theme park created by\b/.test(definition)) {
    return 'brand_or_company_entity';
  }
  if (/^(?:a|the)\s+(?:given name|family name|surname|personal name)\b/.test(definition)) {
    return 'person_name_entity';
  }
  if (
    /^(?:the\s+)?(?:country|city|city-state|capital|continent|island nation|special administrative region|sovereign city-state|province|republic|kingdom|territory)\b/.test(definition) ||
    /^(?:capital|country|city|city-state|continent|province|state|territory)\s+of\b/.test(anchor)
  ) {
    return 'geographic_entity';
  }
  if (/^(?:the\s+)?(?:planet|dwarf planet|constellation)\b/.test(definition)) {
    return 'astronomical_entity';
  }
  return null;
}

function requiredPath(value, name) {
  const resolved = path.resolve(String(value || '').trim());
  if (!String(value || '').trim()) throw new Error(`Missing --${name}`);
  if (!fs.existsSync(resolved)) throw new Error(`Missing ${name} report: ${resolved}`);
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
