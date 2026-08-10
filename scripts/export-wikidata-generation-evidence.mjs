#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'

const API = 'https://www.wikidata.org/w/api.php'
const LANG_MAP = { en: 'en', 'pt-BR': 'pt', zh: 'zh', ja: 'ja' }

function parseArgs(argv) {
  const result = {}
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    result[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return result
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/g, ' ').trim()
}

function valuesFor(entity, field, lang) {
  if (field === 'labels') {
    return entity.labels?.[lang]?.value ? [entity.labels[lang].value] : []
  }
  return (entity.aliases?.[lang] ?? []).map((item) => item.value)
}

function localizedValues(entity, lang) {
  return [...valuesFor(entity, 'labels', lang), ...valuesFor(entity, 'aliases', lang)]
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function mapConcurrent(items, concurrency, callback) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await callback(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

async function fetchJson(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': 'LinguaGoDictionaryEvidence/1.0 (local validation)',
        },
      })
      if (response.ok) return await response.json()
      if (response.status !== 429 || attempt === attempts) {
        throw new Error(`Wikidata HTTP ${response.status}: ${await response.text()}`)
      }
      await sleep(Number(response.headers.get('retry-after') ?? 2) * 1000)
    } catch (error) {
      if (attempt === attempts) throw error
      await sleep(1000 * 2 ** (attempt - 1))
    }
  }
  throw new Error('Wikidata request exhausted retries')
}

async function searchEntities(term, limit) {
  const query = new URLSearchParams({
    action: 'wbsearchentities',
    search: term,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: String(limit),
    maxlag: '5',
    format: 'json',
    origin: '*',
  })
  return (await fetchJson(`${API}?${query}`)).search ?? []
}

async function getEntities(ids) {
  if (!ids.length) return {}
  const query = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props: 'labels|aliases',
    languages: 'en|pt|zh|ja',
    languagefallback: '0',
    maxlag: '5',
    format: 'json',
    origin: '*',
  })
  return (await fetchJson(`${API}?${query}`)).entities ?? {}
}

async function querySparqlLabels(terms, includeAliases) {
  const values = terms.map((term) => `${JSON.stringify(term)}@en`).join(' ')
  const query = includeAliases
    ? `
      SELECT ?item ?en ?value WHERE {
        VALUES ?en { ${values} }
        ?item rdfs:label ?en.
        ?item (rdfs:label|skos:altLabel) ?value.
        FILTER(LANG(?value) IN ("en", "pt", "zh", "ja"))
      }
    `
    : `
      SELECT ?item ?en ?pt ?zh ?ja WHERE {
        VALUES ?en { ${values} }
        ?item rdfs:label ?en.
        OPTIONAL { ?item rdfs:label ?pt. FILTER(LANG(?pt) = "pt") }
        OPTIONAL { ?item rdfs:label ?zh. FILTER(LANG(?zh) = "zh") }
        OPTIONAL { ?item rdfs:label ?ja. FILTER(LANG(?ja) = "ja") }
      }
    `
  const params = new URLSearchParams({ query, format: 'json' })
  return fetchJson(`https://query.wikidata.org/sparql?${params}`)
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS evidence_sources (
      source_key TEXT PRIMARY KEY,
      source_family TEXT NOT NULL,
      lang TEXT NOT NULL,
      lexicon_spec TEXT NOT NULL,
      license TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lexical_evidence (
      id INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL REFERENCES evidence_sources(source_key),
      source_family TEXT NOT NULL,
      lang TEXT NOT NULL,
      term TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      english_gloss TEXT NOT NULL,
      english_normalized_key TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      UNIQUE(source_key, lang, normalized_key, english_gloss, concept_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lexical_evidence_lookup
      ON lexical_evidence(lang, normalized_key);
    CREATE INDEX IF NOT EXISTS idx_lexical_evidence_english
      ON lexical_evidence(lang, english_normalized_key);
  `)
}

const args = parseArgs(process.argv)
if (!args.report || !args.out) {
  throw new Error('Usage: --report <generation.json> --out <evidence.db> [--base-db <db>] [--cache <json>]')
}
const report = JSON.parse(fs.readFileSync(args.report, 'utf8'))
const reportRows = report.generated ?? report.rows ?? report.selected ?? report.validations ?? report
const maxTargetCoverage = args['max-target-coverage'] == null ? null : Number(args['max-target-coverage'])
const rows = reportRows.filter((row) => {
  if (row.output?.localizations?.en?.term) return row.valid
  if (!row.generation_hints?.en?.terms?.length && !row.evidence?.anchor) return false
  if (row.decision && row.decision !== 'supported') return false
  return maxTargetCoverage == null || Number(row.target_coverage_count ?? 0) <= maxTargetCoverage
})
const limit = Number(args.limit ?? rows.length)
const searchLimit = Number(args['search-limit'] ?? 5)
const delayMs = Number(args['delay-ms'] ?? 120)
const concurrency = Math.max(1, Number(args.concurrency ?? 3))
const importAllLabels = String(args['import-all-labels'] ?? 'false') === 'true'
const maxTermsPerLang = Math.max(1, Number(args['max-terms-per-lang'] ?? 8))
const searchMode = String(args['search-mode'] ?? 'action')
const sparqlBatchSize = Math.max(1, Number(args['sparql-batch-size'] ?? 30))
const sparqlAliases = String(args['sparql-aliases'] ?? 'false') === 'true'
const selected = rows.slice(0, limit)
const cachePath = args.cache ? path.resolve(args.cache) : null
const cache = cachePath && fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {}

const rowRecords = selected.map((row) => {
  const englishTerm = row.output?.localizations?.en?.term ?? row.generation_hints?.en?.terms?.[0] ?? row.evidence.anchor
  const targetTerms = row.output?.localizations
    ? Object.fromEntries(Object.entries(row.output.localizations).map(([lang, value]) => [lang, [value.term].filter(Boolean)]))
    : Object.fromEntries(Object.entries(row.generation_hints).map(([lang, value]) => [lang, value.terms ?? []]))
  return { row, englishTerm, targetTerms, results: [] }
})
const entities = {}
let searchRecords = rowRecords
let ids = []
if (searchMode === 'sparql') {
  const batches = []
  for (let index = 0; index < rowRecords.length; index += sparqlBatchSize) {
    batches.push(rowRecords.slice(index, index + sparqlBatchSize))
  }
  const batchResults = await mapConcurrent(batches, concurrency, async (batch, index) => {
    const data = await querySparqlLabels([...new Set(batch.map((record) => record.englishTerm))], sparqlAliases)
    process.stderr.write(`SPARQL batch ${index + 1}/${batches.length}\n`)
    await sleep(delayMs)
    return data.results?.bindings ?? []
  })
  const idsByEnglish = new Map()
  for (const binding of batchResults.flat()) {
    const id = binding.item?.value?.match(/(Q\d+)$/)?.[1]
    if (!id || !binding.en?.value) continue
    entities[id] ??= { id, labels: {}, aliases: {} }
    for (const lang of ['en', 'pt', 'zh', 'ja']) {
      if (binding[lang]?.value) entities[id].labels[lang] = { language: lang, value: binding[lang].value }
    }
    if (binding.value?.value && binding.value['xml:lang']) {
      const lang = binding.value['xml:lang']
      entities[id].aliases[lang] ??= []
      if (!entities[id].aliases[lang].some((item) => item.value === binding.value.value)) {
        entities[id].aliases[lang].push({ language: lang, value: binding.value.value })
      }
    }
    const key = normalize(binding.en.value)
    if (!idsByEnglish.has(key)) idsByEnglish.set(key, new Set())
    idsByEnglish.get(key).add(id)
  }
  searchRecords = rowRecords.map((record) => ({
    ...record,
    results: [...(idsByEnglish.get(normalize(record.englishTerm)) ?? [])].map((id) => ({ id })),
  }))
  ids = [...new Set(searchRecords.flatMap((record) => record.results.map((item) => item.id)))]
} else {
  searchRecords = await mapConcurrent(rowRecords, concurrency, async (record, index) => {
    const cacheKey = normalize(record.englishTerm)
    if (!cache[cacheKey]) {
      cache[cacheKey] = await searchEntities(record.englishTerm, searchLimit)
      if (cachePath) {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true })
        fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
      }
      await sleep(delayMs)
    }
    if ((index + 1) % 25 === 0) process.stderr.write(`searched ${index + 1}/${rowRecords.length}\n`)
    return { ...record, results: cache[cacheKey] }
  })
  ids = [...new Set(searchRecords.flatMap((record) => record.results.map((item) => item.id)))].filter(Boolean)
  const entityBatches = []
  for (let index = 0; index < ids.length; index += 50) entityBatches.push(ids.slice(index, index + 50))
  const entityResults = await mapConcurrent(entityBatches, concurrency, async (batch) => {
    const result = await getEntities(batch)
    await sleep(delayMs)
    return result
  })
  for (const result of entityResults) Object.assign(entities, result)
}

const out = path.resolve(args.out)
fs.mkdirSync(path.dirname(out), { recursive: true })
if (fs.existsSync(out)) fs.rmSync(out)
if (args['base-db']) fs.copyFileSync(path.resolve(args['base-db']), out)
const db = new Database(out)
createSchema(db)
const insertSource = db.prepare(`
  INSERT OR REPLACE INTO evidence_sources
    (source_key, source_family, lang, lexicon_spec, license, metadata_json)
  VALUES (?, 'wikidata', ?, 'Wikidata item labels and aliases', 'CC0-1.0', ?)
`)
const metadata = JSON.stringify({
  access: 'MediaWiki Action API',
  match_rule: 'exact English entity label or alias plus exact target label or alias',
  report: path.resolve(args.report),
  production_publishable: true,
  import_all_labels: importAllLabels,
  max_terms_per_language: maxTermsPerLang,
})
for (const lang of ['en', 'pt-BR', 'zh', 'ja']) insertSource.run(`wikidata-labels-${lang}`, lang, metadata)
const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'wikidata', ?, ?, ?, ?, ?, ?)
`)

let matchedRows = 0
const matchedByLang = { en: 0, 'pt-BR': 0, zh: 0, ja: 0 }
db.transaction(() => {
  for (const record of searchRecords) {
    const englishNormalized = normalize(record.englishTerm)
    const exactEntities = record.results
      .map((item) => entities[item.id])
      .filter(Boolean)
      .filter((entity) => localizedValues(entity, 'en').some((value) => normalize(value) === englishNormalized))
    if (!exactEntities.length) continue
    let rowMatched = false
    for (const [lang, wikidataLang] of Object.entries(LANG_MAP)) {
      const terms = importAllLabels
        ? [...new Set(exactEntities.flatMap((entity) => localizedValues(entity, wikidataLang)))].slice(0, maxTermsPerLang)
        : record.targetTerms[lang] ?? []
      for (const term of terms) {
        const termNormalized = normalize(term)
        for (const entity of exactEntities) {
          if (!localizedValues(entity, wikidataLang).some((value) => normalize(value) === termNormalized)) continue
          insertEvidence.run(
            `wikidata-labels-${lang}`,
            lang,
            term,
            termNormalized,
            record.englishTerm,
            englishNormalized,
            entity.id,
          )
          matchedByLang[lang] += 1
          rowMatched = true
          break
        }
      }
    }
    if (rowMatched) matchedRows += 1
  }
})()
db.pragma('journal_mode = DELETE')
const integrity = db.pragma('integrity_check', { simple: true })
const total = db.prepare('SELECT COUNT(*) AS count FROM lexical_evidence').get().count
db.close()
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, inputRows: selected.length, matchedRows, matchedByLang, rows: total, entityIds: ids.length, out }, null, 2))
