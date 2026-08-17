#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const url = String(args.url || 'https://panlex.org/source-list/');
const outPath = path.resolve(args.out || 'logs/product-source-gap-panlex-source-feasibility.json');
const minimumDenotations = positiveInteger(args['min-denotations'], 1000);
const html = await loadSource(url);
const parsedSourceList = parseSourceList(html);
const sources = parsedSourceList.rows;
const selected = sources
  .map(normalizeSource)
  .filter((row) => row.denotations >= minimumDenotations)
  .filter((row) => row.language_pair === 'cmn-eng' || row.language_pair === 'eng-cmn' ||
    row.language_pair === 'jpn-eng' || row.language_pair === 'eng-jpn')
  .map((row) => ({ ...row, ...classify(row) }))
  .sort((left, right) =>
    decisionOrder(left.decision) - decisionOrder(right.decision) ||
    right.denotations - left.denotations ||
    left.source_id - right.source_id
  );

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_url: url,
  policy: {
    diagnostic_only: true,
    publication_evidence: false,
    minimum_denotations: minimumDenotations,
    accepted_language_pairs: ['cmn-eng', 'eng-cmn', 'jpn-eng', 'eng-jpn'],
    source_provenance_required: true,
    license_verification_required: true,
    known_derivatives_collapse_to_existing_family: true,
    truncated_source_list: parsedSourceList.truncated
  },
  summary: {
    registered_sources: sources.length,
    matching_sources: selected.length,
    by_language_pair: countBy(selected, (row) => row.language_pair),
    by_decision: countBy(selected, (row) => row.decision),
    review_capacity: selected.filter((row) => row.decision === 'license_and_provenance_review').length
  },
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary,
  shortlist: selected.filter((row) => row.decision === 'license_and_provenance_review').slice(0, 20)
}, null, 2));

async function loadSource(value) {
  if (!/^https?:\/\//iu.test(value)) return fs.readFileSync(path.resolve(value), 'utf8');
  const response = await fetch(value, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`PanLex source list HTTP ${response.status}`);
  return response.text();
}

function parseSourceList(html) {
  const marker = html.match(/var\s+sourceList\s*=\s*/iu);
  if (!marker || marker.index == null) throw new Error('Could not locate PanLex sourceList marker');
  const start = marker.index + marker[0].length;
  const end = html.indexOf('];', start);
  if (end >= 0) return { rows: JSON.parse(html.slice(start, end + 1)), truncated: false };
  const lastCompleteObject = html.lastIndexOf('}');
  if (lastCompleteObject < start) throw new Error('PanLex sourceList response contains no complete rows');
  return {
    rows: JSON.parse(`${html.slice(start, lastCompleteObject + 1)}]`),
    truncated: true
  };
}

function normalizeSource(row) {
  const tag = String(row.tt || '');
  const languagePair = tag.split(':', 1)[0];
  const title = decodeHtml(stripTags(row.ti || ''));
  return {
    source_id: Number(row.i),
    source_tag: tag,
    language_pair: languagePair,
    title,
    author: row.au || null,
    year: Number(row.yr) || null,
    denotations: Number(row.dns) || 0,
    source_url: extractHref(row.ti || '')
  };
}

function classify(row) {
  const text = `${row.title} ${row.source_tag} ${row.source_url || ''}`.toLowerCase();
  const known = [
    ['japan_moj_legal_terms', /standard dictionary of legal terms|法令用語日英標準対訳辞書|jesdlt/iu],
    ['wiktionary', /wiktionary|wiktionnaire|wiktionaryz|wikiwoordenboek/iu],
    ['jmdict', /jmdict|edict2?|wwwjdic|electronic dictionary research|edrdg/iu],
    ['wordnet', /wordnet|open multilingual wordnet/iu],
    ['freedict', /freedict/iu],
    ['cc-cedict', /cc-cedict|cedict/iu],
    ['apertium', /apertium/iu],
    ['restricted_ldc', /linguistic data consortium|:ldc\b/iu],
    ['dicts_info_nonredistributable', /dicts\.info/iu],
    ['babylon_or_stardict_unverified', /babylon|stardict|huzheng|quick_eng/iu],
    ['kanji_validation_only', /1000 kanji|kanjidic/iu]
  ];
  for (const [family, pattern] of known) {
    if (pattern.test(text)) {
      const rejected = ['restricted_ldc', 'dicts_info_nonredistributable', 'babylon_or_stardict_unverified'];
      return {
        decision: rejected.includes(family)
          ? 'reject_unverified_redistribution'
          : family === 'kanji_validation_only'
            ? 'validation_only'
            : 'collapse_existing_family',
        mapped_family: family,
        reason: rejected.includes(family)
          ? 'Original redistribution rights are restricted or unresolved'
          : family === 'kanji_validation_only'
            ? 'Character/reading validation is not independent word-sense translation evidence'
            : `Known derivative or existing source family: ${family}`
      };
    }
  }
  if (/ocean dictionary|海洋辞典|ecsmet|computational linguistics term list|bondcltl/iu.test(text)) {
    return {
      decision: 'specialist_source_review',
      mapped_family: null,
      reason: 'Potential independent specialist terminology, not a general modern lexical source'
    };
  }
  return {
    decision: 'license_and_provenance_review',
    mapped_family: null,
    reason: 'Potential independent source; verify original license, direction, region, and downloadable provenance'
  };
}

function stripTags(value) { return String(value).replace(/<[^>]*>/gu, ' '); }
function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#0*39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/\s+/gu, ' ').trim();
}
function extractHref(value) {
  const match = String(value).match(/href=["']([^"']+)["']/iu);
  return match ? decodeHtml(match[1]) : null;
}
function decisionOrder(value) {
  return { license_and_provenance_review: 0, specialist_source_review: 1, collapse_existing_family: 2,
    validation_only: 3, reject_unverified_redistribution: 4 }[value] ?? 9;
}
function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) { parsed[key] = value; index += 1; }
    else parsed[key] = true;
  }
  return parsed;
}
