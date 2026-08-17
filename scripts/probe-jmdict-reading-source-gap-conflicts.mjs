#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report);
const jmdictPath = requiredPath(args.jmdict || 'data/raw/JMdict_e.gz');
const outPath = path.resolve(args.out || 'logs/product-source-gap-jmdict-reading-conflicts.json');
const evidenceOutPath = args['evidence-out'] ? path.resolve(args['evidence-out']) : null;
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const pool = String(args.pool || 'source-conflicts');
const reportRows = pool === 'source-near-unlock'
  ? report.source_near_unlock
  : pool === 'near-unlock'
    ? report.near_unlock
    : pool === 'selected'
      ? report.selected
      : report.source_conflicts;
if (!Array.isArray(reportRows)) {
  throw new Error(`Report does not contain the requested ${pool} pool`);
}
const sourceConflicts = reportRows
  .filter((row) => row.source_lang === 'ja');
const candidatesByTerm = new Map();

for (const row of sourceConflicts) {
  const term = normalizeJapanese(row.word);
  if (!term) continue;
  if (!candidatesByTerm.has(term)) candidatesByTerm.set(term, []);
  candidatesByTerm.get(term).push({
    ...row,
    anchor_terms: splitAnchor(row.anchor)
  });
}

const matchesByKey = new Map();
let entriesScanned = 0;
const stream = fs.createReadStream(jmdictPath).pipe(zlib.createGunzip());
let buffer = '';
for await (const chunk of stream) {
  buffer += chunk.toString('utf8');
  while (true) {
    const start = buffer.indexOf('<entry>');
    if (start < 0) {
      buffer = buffer.slice(-32);
      break;
    }
    const end = buffer.indexOf('</entry>', start);
    if (end < 0) {
      if (start > 0) buffer = buffer.slice(start);
      break;
    }
    entriesScanned += 1;
    inspectEntry(buffer.slice(start + 7, end));
    buffer = buffer.slice(end + 8);
  }
}

const assessed = sourceConflicts.map((row) => {
  const matches = matchesByKey.get(row.candidate_key) || [];
  const conceptIds = unique(matches.map((match) => match.entry_sequence));
  const matchedGlosses = unique(matches.flatMap((match) => match.matched_glosses));
  const status = matches.length === 0
    ? 'unmatched'
    : conceptIds.length === 1
      ? 'qualified'
      : 'multiple_jmdict_entries';
  return {
    ...row,
    status,
    jmdict_entry_count: conceptIds.length,
    matched_glosses: matchedGlosses,
    matches
  };
});
const selected = assessed.filter((row) => row.status === 'qualified');
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    source_language: 'ja',
    input_pool: pool,
    exact_jmdict_term_or_reading: true,
    reading_restrictions_respected: true,
    exact_semicolon_anchor_gloss: true,
    unique_jmdict_entry_required: true,
    source_evidence_only: true,
    product_database_write: false
  },
  source_report: relative(reportPath),
  jmdict: relative(jmdictPath),
  summary: {
    entries_scanned: entriesScanned,
    input_rows: sourceConflicts.length,
    qualified_rows: selected.length,
    statuses: countBy(assessed, (row) => row.status)
  },
  selected,
  assessed
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
if (evidenceOutPath) writeEvidenceDb(evidenceOutPath, selected);
console.log(JSON.stringify({
  out: relative(outPath),
  evidence_out: evidenceOutPath ? relative(evidenceOutPath) : null,
  ...output.summary
}, null, 2));

function writeEvidenceDb(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const db = new Database(filePath);
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
    CREATE TABLE jmdict_reading_evidence_provenance (
      candidate_key TEXT NOT NULL, concept_id TEXT NOT NULL,
      reading TEXT NOT NULL, written_terms_json TEXT NOT NULL,
      all_glosses_json TEXT NOT NULL,
      PRIMARY KEY(candidate_key, concept_id)
    );
  `);
  const sourceSha256 = sha256File(jmdictPath);
  const reportSha256 = sha256File(reportPath);
  const policyVersion = 'term-reading-sense-v2';
  const sourceKeyHash = crypto.createHash('sha256')
    .update(`${sourceSha256}:${reportSha256}:${policyVersion}`)
    .digest('hex')
    .slice(0, 12);
  const sourceKey = `jmdict-term-reading-${sourceKeyHash}`;
  const metadata = {
    production_publishable: true,
    candidate_bound: true,
    source_url: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
    source_file: relative(jmdictPath),
    source_sha256: sourceSha256,
    report_sha256: reportSha256,
    policy_version: policyVersion,
    extraction_policy: 'exact JMdict written term or reading with reading/sense restrictions and exact semicolon-split English gloss',
    generated_at: new Date().toISOString()
  };
  db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
    sourceKey,
    'jmdict',
    'ja',
    'JMdict written terms and reading aliases bound to exact English sense glosses',
    'CC BY-SA 4.0',
    JSON.stringify(metadata)
  );
  const insertEvidence = db.prepare(`
    INSERT OR IGNORE INTO lexical_evidence
      (source_key, source_family, lang, term, normalized_key, english_gloss,
       english_normalized_key, concept_id)
    VALUES (?, 'jmdict', 'ja', ?, ?, ?, ?, ?)
  `);
  const insertProvenance = db.prepare(`
    INSERT OR IGNORE INTO jmdict_reading_evidence_provenance
      VALUES (?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const row of rows) {
      for (const match of row.matches) {
        const conceptId = `jmdict:${match.entry_sequence}:${match.sense_order}`;
        for (const gloss of match.matched_glosses) {
          insertEvidence.run(
            sourceKey,
            row.word,
            normalizeJapanese(row.word),
            gloss,
            normalizeEnglish(gloss),
            conceptId
          );
        }
        insertProvenance.run(
          row.candidate_key,
          conceptId,
          row.word,
          JSON.stringify(match.written_terms),
          JSON.stringify(match.all_glosses)
        );
      }
    }
  })();
  db.pragma('journal_mode = DELETE');
  const integrity = db.pragma('integrity_check', { simple: true });
  db.close();
  if (integrity !== 'ok') throw new Error(`Evidence DB integrity check failed: ${integrity}`);
}

function inspectEntry(entry) {
  const entrySequence = decodeXml(firstMatch(entry, /<ent_seq>([\s\S]*?)<\/ent_seq>/u));
  const writtenTerms = [...entry.matchAll(/<keb>([\s\S]*?)<\/keb>/gu)]
    .map((match) => decodeXml(match[1]).trim());
  const readings = [];
  for (const readingMatch of entry.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/gu)) {
    const block = readingMatch[1];
    const reading = normalizeJapanese(decodeXml(firstMatch(block, /<reb>([\s\S]*?)<\/reb>/u)));
    const restrictions = [...block.matchAll(/<re_restr>([\s\S]*?)<\/re_restr>/gu)]
      .map((match) => decodeXml(match[1]).trim());
    readings.push({ reading, written: restrictions.length ? restrictions : writtenTerms });
  }
  const entryCandidateTerms = unique([
    ...writtenTerms.map(normalizeJapanese),
    ...readings.map((item) => item.reading)
  ]).filter((term) => candidatesByTerm.has(term));
  if (!entryCandidateTerms.length) return;

  let senseOrder = 0;
  for (const senseMatch of entry.matchAll(/<sense>([\s\S]*?)<\/sense>/gu)) {
    senseOrder += 1;
    const block = senseMatch[1];
    const senseWrittenRestrictions = [...block.matchAll(/<stagk>([\s\S]*?)<\/stagk>/gu)]
      .map((match) => decodeXml(match[1]).trim());
    const senseReadingRestrictions = [...block.matchAll(/<stagr>([\s\S]*?)<\/stagr>/gu)]
      .map((match) => normalizeJapanese(decodeXml(match[1])));
    const glosses = [...block.matchAll(/<gloss(?:\s[^>]*)?>([\s\S]*?)<\/gloss>/gu)]
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    const normalizedGlosses = new Map(glosses.map((gloss) => [normalizeEnglish(gloss), gloss]));

    for (const candidateTerm of entryCandidateTerms) {
      let matchingReadings = readings.filter((item) =>
        item.reading === candidateTerm || item.written.some((term) => normalizeJapanese(term) === candidateTerm)
      );
      if (!matchingReadings.length) continue;
      if (senseReadingRestrictions.length) {
        matchingReadings = matchingReadings.filter((item) => senseReadingRestrictions.includes(item.reading));
      }
      if (senseWrittenRestrictions.length) {
        matchingReadings = matchingReadings.filter((item) =>
          item.written.some((term) => senseWrittenRestrictions.includes(term))
        );
      }
      if (!matchingReadings.length) continue;
      const applicableWritten = unique(matchingReadings.flatMap((item) => item.written));
      for (const candidate of candidatesByTerm.get(candidateTerm) || []) {
        const matchedGlosses = candidate.anchor_terms
          .map((anchor) => normalizedGlosses.get(normalizeEnglish(anchor)))
          .filter(Boolean);
        if (!matchedGlosses.length) continue;
        if (!matchesByKey.has(candidate.candidate_key)) matchesByKey.set(candidate.candidate_key, []);
        matchesByKey.get(candidate.candidate_key).push({
          entry_sequence: entrySequence,
          sense_order: senseOrder,
          matched_term: candidateTerm,
          readings: unique(matchingReadings.map((item) => item.reading)),
          reading: candidate.word,
          written_terms: applicableWritten,
          matched_glosses: unique(matchedGlosses),
          all_glosses: glosses
        });
      }
    }
  }
}

function splitAnchor(value) {
  return unique(String(value || '').split(/[;|]/u).map((term) => term.trim()).filter(Boolean));
}

function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' ');
}

function normalizeJapanese(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'");
}

function firstMatch(value, pattern) {
  return String(value || '').match(pattern)?.[1] || '';
}

function unique(values) {
  return [...new Set(values)];
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function requiredPath(value) {
  if (!value) throw new Error('Missing required path argument');
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      index += 1;
    } else out[key] = true;
  }
  return out;
}
