#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report || 'logs/product-source-gap-v97-evidence-acquisition-all.json');
const dumpPath = requiredPath(args.input || 'data/raw/wikidata-latest-lexemes.json.gz');
const outPath = path.resolve(args.out || '.tmp/wikidata/wikidata-lexeme-v97-evidence.db');
const limit = boundedInteger(args.limit, Number.MAX_SAFE_INTEGER, 1);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const dumpHash = sha256File(dumpPath);
const candidates = (report.selected || []).slice(0, limit).filter(validCandidate);
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const candidateBySource = new Map();

for (const candidate of candidates) {
  const key = sourceKey(candidate.source_lang, candidate.word);
  if (!candidateBySource.has(key)) candidateBySource.set(key, []);
  candidateBySource.get(key).push(candidate);
}

const targetSenseBindings = new Map();
const targetItemBindings = new Map();
const stats = {
  candidates: candidates.length,
  pass1_entities: 0,
  pass1_source_lexemes: 0,
  pass1_source_senses: 0,
  pass1_aligned_senses: 0,
  pass1_senses_with_items: 0,
  pass1_senses_with_translations: 0,
  translation_targets: 0,
  item_targets: 0,
  pass2_entities: 0,
  resolved_target_senses: 0,
  rejected_target_language: 0,
  rejected_target_gloss: 0
};

await scanDump(async (entity) => {
  stats.pass1_entities += 1;
  const lemmas = extractLemmas(entity);
  const matchingCandidates = unique(
    lemmas.flatMap((lemma) => candidateBySource.get(sourceKey(lemma.lang, lemma.value)) || [])
  );
  if (!matchingCandidates.length) return;
  stats.pass1_source_lexemes += 1;

  for (const candidate of matchingCandidates) {
    for (const sense of entity.senses || []) {
      stats.pass1_source_senses += 1;
      const englishGloss = glossValue(sense, ['en', 'en-gb', 'en-ca']);
      if (!posCompatible(candidate.part_of_speech, entity.lexicalCategory)) continue;
      const sourceGlossAligned = Boolean(
        englishGloss && semanticMatch(candidate.english_anchor, englishGloss)
      );
      if (sourceGlossAligned) stats.pass1_aligned_senses += 1;
      const itemIds = claimEntityIds(sense, 'P5137', 'item');
      const targetSenseIds = claimEntityIds(sense, 'P5972', 'sense');
      if (itemIds.length) stats.pass1_senses_with_items += 1;
      if (targetSenseIds.length) stats.pass1_senses_with_translations += 1;
      const binding = {
        candidate,
        source_lexeme_id: entity.id,
        source_sense_id: sense.id,
        source_gloss: englishGloss,
        source_gloss_aligned: sourceGlossAligned,
        source_item_ids: itemIds
      };
      for (const targetSenseId of targetSenseIds) {
        if (!targetSenseBindings.has(targetSenseId)) targetSenseBindings.set(targetSenseId, []);
        targetSenseBindings.get(targetSenseId).push(binding);
      }
      for (const itemId of itemIds) {
        if (!targetItemBindings.has(itemId)) targetItemBindings.set(itemId, []);
        targetItemBindings.get(itemId).push(binding);
      }
    }
  }
});
stats.translation_targets = targetSenseBindings.size;
stats.item_targets = targetItemBindings.size;

const evidenceRows = [];
await scanDump(async (entity) => {
  stats.pass2_entities += 1;
  const relevantSenses = (entity.senses || []).filter((sense) =>
    targetSenseBindings.has(sense.id) ||
    claimEntityIds(sense, 'P5137', 'item').some((itemId) => targetItemBindings.has(itemId))
  );
  if (!relevantSenses.length) return;
  const lemmas = extractLemmas(entity);

  for (const sense of relevantSenses) {
    const targetGloss = glossValue(sense, ['en', 'en-gb', 'en-ca']);
    const targetItemIds = claimEntityIds(sense, 'P5137', 'item');
    const directBindings = targetSenseBindings.get(sense.id) || [];
    const itemBindings = targetItemIds.flatMap((itemId) => targetItemBindings.get(itemId) || []);
    for (const binding of unique([...directBindings, ...itemBindings])) {
      const targetLang = binding.candidate.target_lang;
      const matchingTargetLemmas = lemmas.filter((lemma) => lemma.lang === targetLang);
      const bestVariantPriority = matchingTargetLemmas.length
        ? Math.min(...matchingTargetLemmas.map((lemma) => lemma.variant_priority))
        : null;
      const targetLemmas = matchingTargetLemmas.filter(
        (lemma) => lemma.variant_priority === bestVariantPriority
      );
      if (!targetLemmas.length) {
        stats.rejected_target_language += 1;
        continue;
      }
      const sharedItem = binding.source_item_ids.some((id) => targetItemIds.includes(id));
      const targetGlossAligned = Boolean(
        targetGloss && semanticMatch(binding.candidate.english_anchor, targetGloss)
      );
      if (!binding.source_gloss_aligned && !targetGlossAligned) {
        stats.rejected_target_gloss += 1;
        continue;
      }
      for (const lemma of targetLemmas) {
        const cleaned = cleanTargetTerm(lemma.value, targetLang);
        if (!cleaned) continue;
        evidenceRows.push({
          candidate_key: binding.candidate.candidate_key,
          source_entry_id: Number(binding.candidate.source_entry_id),
          source_sense_id: Number(binding.candidate.source_sense_id),
          source_word: binding.candidate.word,
          source_lang: binding.candidate.source_lang,
          target_lang: targetLang,
          term: cleaned,
          english_gloss: binding.candidate.english_anchor,
          source_lexeme_id: binding.source_lexeme_id,
          source_wikidata_sense_id: binding.source_sense_id,
          target_lexeme_id: entity.id,
          target_wikidata_sense_id: sense.id,
          shared_item: sharedItem,
          explicit_translation: directBindings.includes(binding)
        });
      }
      stats.resolved_target_senses += 1;
    }
  }
});

writeEvidenceDb(deduplicateEvidence(evidenceRows));

function writeEvidenceDb(rows) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.rmSync(outPath, { force: true });
  const db = new Database(outPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE evidence_sources (
      source_key TEXT PRIMARY KEY, source_family TEXT NOT NULL, lang TEXT NOT NULL,
      lexicon_spec TEXT NOT NULL, license TEXT NOT NULL, metadata_json TEXT NOT NULL
    );
    CREATE TABLE lexical_evidence (
      id INTEGER PRIMARY KEY, source_key TEXT NOT NULL, source_family TEXT NOT NULL,
      lang TEXT NOT NULL, term TEXT NOT NULL, normalized_key TEXT NOT NULL,
      english_gloss TEXT NOT NULL, english_normalized_key TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      UNIQUE(source_key, lang, normalized_key, english_gloss, concept_id)
    );
    CREATE INDEX idx_lexical_evidence_lookup ON lexical_evidence(lang, normalized_key);
    CREATE INDEX idx_lexical_evidence_english ON lexical_evidence(lang, english_normalized_key);
    CREATE TABLE wikidata_lexeme_candidate_provenance (
      candidate_key TEXT NOT NULL, source_key TEXT NOT NULL,
      source_entry_id INTEGER NOT NULL, source_sense_id INTEGER NOT NULL,
      source_lexeme_id TEXT NOT NULL, source_wikidata_sense_id TEXT NOT NULL,
      target_lexeme_id TEXT NOT NULL, target_wikidata_sense_id TEXT NOT NULL,
      target_lang TEXT NOT NULL, normalized_key TEXT NOT NULL,
      shared_item INTEGER NOT NULL DEFAULT 0,
      explicit_translation INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(candidate_key, target_wikidata_sense_id, normalized_key)
    );
  `);
  const sourceKeyValue = `wikidata-lexeme-${dumpHash.slice(0, 12)}`;
  db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
    sourceKeyValue,
    'wikidata-lexeme',
    'multi',
    'Wikidata Lexeme P5972 translations or shared P5137 concepts with source/target English-gloss alignment',
    'CC0-1.0',
    JSON.stringify({
      dump: path.basename(dumpPath),
      dump_sha256: dumpHash,
      report: path.relative(process.cwd(), reportPath),
      report_sha256: sha256File(reportPath),
      item_labels_are_not_evidence: true,
      explicit_translation_property: 'P5972',
      sense_item_property: 'P5137'
    })
  );
  const insertEvidence = db.prepare(`
    INSERT OR IGNORE INTO lexical_evidence
      (source_key, source_family, lang, term, normalized_key,
       english_gloss, english_normalized_key, concept_id)
    VALUES (?, 'wikidata-lexeme', ?, ?, ?, ?, ?, ?)
  `);
  const insertProvenance = db.prepare(`
    INSERT OR IGNORE INTO wikidata_lexeme_candidate_provenance
      (candidate_key, source_key, source_entry_id, source_sense_id,
       source_lexeme_id, source_wikidata_sense_id, target_lexeme_id,
       target_wikidata_sense_id, target_lang, normalized_key, shared_item,
       explicit_translation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const row of rows) {
      const normalizedTerm = normalize(row.term);
      const conceptId = `${row.source_wikidata_sense_id}->${row.target_wikidata_sense_id}`;
      insertEvidence.run(
        sourceKeyValue,
        row.target_lang,
        row.term,
        normalizedTerm,
        row.english_gloss,
        normalize(row.english_gloss),
        conceptId
      );
      insertProvenance.run(
        row.candidate_key,
        sourceKeyValue,
        row.source_entry_id,
        row.source_sense_id,
        row.source_lexeme_id,
        row.source_wikidata_sense_id,
        row.target_lexeme_id,
        row.target_wikidata_sense_id,
        row.target_lang,
        normalizedTerm,
        row.shared_item ? 1 : 0,
        row.explicit_translation ? 1 : 0
      );
    }
  })();
  db.pragma('journal_mode = DELETE');
  const integrity = db.pragma('integrity_check', { simple: true });
  const counts = {
    ...stats,
    lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
    candidate_bindings: db.prepare('SELECT COUNT(*) count FROM wikidata_lexeme_candidate_provenance').get().count,
    candidates_with_evidence: db.prepare('SELECT COUNT(DISTINCT candidate_key) count FROM wikidata_lexeme_candidate_provenance').get().count,
    by_lang: db.prepare('SELECT lang, COUNT(*) rows FROM lexical_evidence GROUP BY lang ORDER BY lang').all(),
    shared_item_bindings: db.prepare('SELECT COUNT(*) count FROM wikidata_lexeme_candidate_provenance WHERE shared_item = 1').get().count,
    explicit_translation_bindings: db.prepare('SELECT COUNT(*) count FROM wikidata_lexeme_candidate_provenance WHERE explicit_translation = 1').get().count
  };
  db.close();
  console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), source_key: sourceKeyValue, counts }, null, 2));
}

async function scanDump(visit) {
  const input = fs.createReadStream(dumpPath).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line === '[' || line === ']') continue;
    if (line.startsWith('[')) line = line.slice(1).trim();
    if (line.endsWith(',')) line = line.slice(0, -1).trim();
    if (line.endsWith(']')) line = line.slice(0, -1).trim();
    if (!line) continue;
    await visit(JSON.parse(line));
  }
}

function extractLemmas(entity) {
  return Object.values(entity.lemmas || {})
    .map((lemma) => ({
      lang: normalizeLang(lemma.language),
      value: String(lemma.value || '').trim(),
      variant_priority: languageVariantPriority(lemma.language)
    }))
    .filter((lemma) => lemma.lang && lemma.value);
}
function glossValue(sense, languages) {
  for (const lang of languages) {
    const value = sense?.glosses?.[lang]?.value;
    if (value) return String(value).trim();
  }
  return null;
}
function claimEntityIds(entity, property, type) {
  return (entity?.claims?.[property] || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter((value) => value?.['entity-type'] === type && typeof value.id === 'string')
    .map((value) => value.id);
}
function normalizeLang(lang) {
  const value = String(lang || '').toLowerCase();
  if (value === 'pt' || value === 'pt-br') return 'pt-BR';
  if (['zh', 'zh-cn', 'zh-hans', 'zh-hant', 'zh-tw'].includes(value)) return 'zh';
  if (value === 'ja' || value === 'en') return value;
  return null;
}
function sourceKey(lang, word) {
  const normalizedLang = normalizeLang(lang);
  const normalizedWord = normalizedLang === 'zh' ? normalize(toSimplified(String(word))) : normalize(word);
  return `${normalizedLang}:${normalizedWord}`;
}
function languageVariantPriority(lang) {
  const value = String(lang || '').toLowerCase();
  if (value === 'zh-cn' || value === 'zh-hans') return 0;
  if (value === 'zh') return 1;
  if (value === 'zh-hant' || value === 'zh-tw') return 2;
  return 0;
}
function semanticMatch(anchor, gloss) {
  const left = lexicalTokens(anchor);
  const right = lexicalTokens(gloss);
  if (!left.length || !right.length) return false;
  const leftText = left.join(' ');
  const rightText = right.join(' ');
  if (leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText)) return true;
  return left.some((token) => right.some((other) => lexicalTokenMatch(token, other)));
}
function lexicalTokens(value) {
  return normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
}
function lexicalTokenMatch(left, right) {
  if (left === right) return true;
  if (left.length >= 5 && right.length >= 5) {
    const stemLeft = left.replace(/(?:ing|ed|es|s)$/u, '');
    const stemRight = right.replace(/(?:ing|ed|es|s)$/u, '');
    return stemLeft.length >= 4 && stemLeft === stemRight;
  }
  return false;
}
function posCompatible(partOfSpeech, categoryId) {
  if (!partOfSpeech) return true;
  const expected = {
    noun: 'Q1084', verb: 'Q24905', adjective: 'Q34698', adverb: 'Q380057'
  }[String(partOfSpeech).toLowerCase()];
  return !expected || !categoryId || categoryId === expected;
}
function cleanTargetTerm(value, lang) {
  let term = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!term || /<[^>]+>|&(?:#\d+|#x[\da-f]+|\w+);/iu.test(term)) return null;
  if (lang === 'zh') {
    if (!/\p{Script=Han}/u.test(term)) return null;
    term = toSimplified(term);
  } else if (lang === 'ja') {
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term)) return null;
  } else if (lang === 'pt-BR' && !/\p{Script=Latin}/u.test(term)) return null;
  return term;
}
function validCandidate(row) {
  return row?.candidate_key && row?.word && row?.source_lang && row?.target_lang && row?.english_anchor;
}
function unique(values) {
  return [...new Set(values)];
}
function deduplicateEvidence(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.candidate_key}:${row.target_wikidata_sense_id}:${normalize(row.term)}`;
    if (!map.has(key) || (!map.get(key).shared_item && row.shared_item)) map.set(key, row);
  }
  return [...map.values()];
}
function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}
function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function boundedInteger(value, fallback, minimum) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`Invalid integer: ${value}`);
  return number;
}
function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
