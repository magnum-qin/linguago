#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/product-source-gap-agrovoc-probe.json');
const endpoint = String(args.endpoint || 'https://agrovoc.fao.org/sparql');
const batchSize = positiveInteger(args['batch-size'], 40);
const maxAttempts = positiveInteger(args['max-attempts'], 2);
const input = readJson(reportPath);
const candidates = Array.isArray(input.selected) ? input.selected : [];

const anchorToCandidates = new Map();
for (const candidate of candidates) {
  for (const anchor of splitAnchors(candidate.english_anchor)) {
    const key = normalize(anchor);
    if (!key) continue;
    if (!anchorToCandidates.has(key)) anchorToCandidates.set(key, []);
    anchorToCandidates.get(key).push(candidate);
  }
}

const anchors = [...anchorToCandidates.keys()];
const conceptRows = [];
for (let offset = 0; offset < anchors.length; offset += batchSize) {
  const batch = anchors.slice(offset, offset + batchSize);
  const rows = await queryBatch(batch);
  conceptRows.push(...rows);
  console.log(`[agrovoc] ${Math.min(offset + batch.length, anchors.length)}/${anchors.length} anchors, ${rows.length} rows`);
}

const concepts = new Map();
for (const row of conceptRows) {
  const concept = row.concept?.value;
  const anchor = normalize(row.anchor?.value);
  const label = row.label?.value;
  const lang = normalizeLang(row.label?.['xml:lang'] || row.label?.lang);
  if (!concept || !anchor || !label || !lang || !anchorToCandidates.has(anchor)) continue;
  const key = `${anchor}\u0000${concept}`;
  if (!concepts.has(key)) concepts.set(key, { concept, anchor, labels: {} });
  const item = concepts.get(key);
  item.labels[lang] ||= [];
  if (!item.labels[lang].includes(label)) item.labels[lang].push(label);
}

const matches = [];
for (const concept of concepts.values()) {
  const candidatesForAnchor = anchorToCandidates.get(concept.anchor) || [];
  for (const candidate of candidatesForAnchor) {
    const targetLabels = concept.labels[candidate.target_lang] || [];
    if (!targetLabels.length) continue;
    matches.push({
      ...candidate,
      agrovoc_concept: concept.concept,
      matched_english_anchor: concept.anchor,
      agrovoc_labels: concept.labels,
      target_terms: targetLabels,
      source_family: 'agrovoc',
      source_key: 'agrovoc-fao-current',
      production_publishable: true
    });
  }
}

const deduplicated = uniqueBy(matches, (row) => `${row.candidate_key}:${row.target_lang}:${row.agrovoc_concept}`);
deduplicated.sort((left, right) =>
  Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) -
    Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER) ||
  left.source_entry_id - right.source_entry_id
);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  source: {
    name: 'AGROVOC Multilingual Thesaurus',
    publisher: 'Food and Agriculture Organization of the United Nations',
    endpoint,
    family: 'agrovoc',
    license: 'CC BY IGO 3.0',
    license_url: 'https://creativecommons.org/licenses/by/3.0/igo/',
    attribution_required: true,
    independent_of_wiktionary: true,
    domain: 'agriculture, food, environment, and related sciences'
  },
  policy: {
    diagnostic_only: true,
    database_write: false,
    exact_english_label_match: true,
    concept_bound_multilingual_labels: true,
    mainland_chinese_output_still_requires_script_check: true
  },
  summary: {
    input_candidates: candidates.length,
    unique_english_anchors: anchors.length,
    matched_candidate_concepts: deduplicated.length,
    matched_candidates: new Set(deduplicated.map((row) => row.candidate_key)).size,
    by_target_lang: countBy(deduplicated, (row) => row.target_lang),
    four_project_language_concepts: deduplicated.filter((row) =>
      ['en', 'pt-BR', 'zh', 'ja'].every((lang) => row.agrovoc_labels[lang]?.length)
    ).length
  },
  selected: deduplicated
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

async function queryBatch(batch) {
  const values = batch.map((anchor) => `${sparqlString(anchor)}@en`).join(' ');
  const query = `
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT DISTINCT ?concept ?anchor ?label WHERE {
  VALUES ?anchor { ${values} }
  ?concept (skos:prefLabel|skos:altLabel) ?anchor .
  ?concept (skos:prefLabel|skos:altLabel) ?label .
  FILTER(LANG(?label) IN ("en", "zh", "ja", "pt-BR", "pt"))
}`;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'LinguaGo-AGROVOC-Evidence-Probe/1.0'
        },
        body: new URLSearchParams({ query })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const payload = await response.json();
      return payload.results?.bindings || [];
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

function splitAnchors(value) {
  return String(value || '').split(/[;|]/).map((item) => item.trim()).filter(Boolean);
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en');
}

function normalizeLang(lang) {
  if (lang === 'pt') return 'pt-BR';
  return lang;
}

function sparqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(rows, keyFn) {
  const result = {};
  for (const row of rows) {
    const key = String(keyFn(row));
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`Missing file for --${name}: ${resolved}`);
  return resolved;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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
    } else parsed[key] = true;
  }
  return parsed;
}
