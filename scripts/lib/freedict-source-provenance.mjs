import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

export function inspectFreeDictProvenance(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  return inspectFreeDictProvenanceXml(xml);
}

export function inspectFreeDictProvenanceXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    trimValues: true
  });
  const parsed = parser.parse(xml);
  const title = firstText(collectLocalText(parsed, 'title'));
  const edition = firstText(collectLocalText(parsed, 'edition'));
  const sourceDescription = unique(collectLocalText(parsed, 'sourceDesc')).join(' ');
  const availability = unique(collectLocalText(parsed, 'availability')).join(' ');
  const normalizedSource = sourceDescription.toLocaleLowerCase('en');

  let sourceFamily = 'freedict-unresolved';
  let upstream = 'unknown';
  let independentLexicalFamily = false;
  let reason = 'FreeDict packages data from multiple upstream projects; unresolved provenance cannot be counted independently.';

  if (/wikdict|wiktionary|dbnary/u.test(normalizedSource)) {
    sourceFamily = 'wiktionary';
    upstream = 'WikDict/Wiktionary/DBnary';
    reason = 'The TEI source description identifies a WikDict/Wiktionary-derived dictionary.';
  } else if (/ergane|travlang/u.test(normalizedSource)) {
    sourceFamily = 'freedict-ergane';
    upstream = 'Ergane/TravLang';
    independentLexicalFamily = true;
    reason = 'The TEI source description identifies the independent Ergane/TravLang database.';
  } else if (/tu\s*chemnitz|\bding\b/u.test(normalizedSource)) {
    sourceFamily = 'freedict-ding';
    upstream = 'TU Chemnitz Ding';
    independentLexicalFamily = true;
    reason = 'The TEI source description identifies the independent TU Chemnitz Ding dictionary.';
  }

  return {
    title,
    edition,
    source_description: sourceDescription,
    availability,
    source_family: sourceFamily,
    upstream,
    independent_lexical_family: independentLexicalFamily,
    production_evidence_eligible: independentLexicalFamily,
    reason
  };
}

function collectLocalText(node, wantedName) {
  const values = [];
  visit(node, (key, value) => {
    if (localName(key) !== wantedName) return;
    const text = flattenText(value);
    if (text) values.push(text);
  });
  return values;
}

function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) visit(item, callback);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    callback(key, value);
    visit(value, callback);
  }
}

function flattenText(value) {
  const parts = [];
  const append = (item) => {
    if (item == null) return;
    if (typeof item === 'string' || typeof item === 'number') {
      const text = String(item).replace(/\s+/gu, ' ').trim();
      if (text) parts.push(text);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) append(child);
      return;
    }
    if (typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (!key.startsWith('@_')) append(child);
      }
    }
  };
  append(value);
  return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

function localName(value) {
  return String(value).split(':').at(-1);
}

function firstText(values) {
  return values.find(Boolean) || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
