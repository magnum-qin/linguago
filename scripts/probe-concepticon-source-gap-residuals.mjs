#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import csvParser from 'csv-parser'
import Database from 'better-sqlite3'

const args = parseArgs(process.argv.slice(2))
const glossesPath = path.resolve(required(args.glosses, 'glosses'))
const residualPath = path.resolve(required(args.residual, 'residual'))
const dbPath = path.resolve(required(args.db, 'db'))
const outPath = path.resolve(required(args.out, 'out'))

const languageMap = new Map([
  ['english', 'en'],
  ['portuguese', 'pt-BR'],
  ['chinese', 'zh'],
  ['japanese', 'ja']
])
const concepts = new Map()

await new Promise((resolve, reject) => {
  fs.createReadStream(glossesPath)
    .pipe(csvParser())
    .on('data', (row) => {
      const lang = languageMap.get(row.Language_ID)
      const term = cleanTerm(row.Form)
      if (!lang || !term || !row.Parameter_ID || row.Parameter_ID === '0') return
      const concept = concepts.get(row.Parameter_ID) || new Map()
      const terms = concept.get(lang) || new Set()
      terms.add(normalize(term))
      concept.set(lang, terms)
      concepts.set(row.Parameter_ID, concept)
    })
    .on('end', resolve)
    .on('error', reject)
})

const fourLanguageConcepts = new Set(
  [...concepts.entries()]
    .filter(([, langs]) => [...languageMap.values()].every((lang) => langs.get(lang)?.size))
    .map(([id]) => id)
)

const termIndex = new Map()
for (const [conceptId, langs] of concepts) {
  for (const [lang, terms] of langs) {
    for (const term of terms) {
      const key = `${lang}\u0000${term}`
      const ids = termIndex.get(key) || new Set()
      ids.add(conceptId)
      termIndex.set(key, ids)
    }
  }
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
const productTerms = new Set(
  db.prepare('SELECT primary_lang AS lang, normalized_key AS term FROM product_entries')
    .all()
    .map((row) => `${row.lang}\u0000${normalize(row.term)}`)
)
db.close()

const fourLanguageTerms = new Set()
for (const conceptId of fourLanguageConcepts) {
  for (const [lang, terms] of concepts.get(conceptId)) {
    for (const term of terms) fourLanguageTerms.add(`${lang}\u0000${term}`)
  }
}

const residual = JSON.parse(fs.readFileSync(residualPath, 'utf8'))
const rows = residual.validations || residual.candidates || residual.rows || []
const matches = []
for (const row of rows) {
  const sourceKey = `${row.source_lang}\u0000${normalize(row.word)}`
  const sourceConcepts = termIndex.get(sourceKey)
  if (!sourceConcepts?.size) continue
  let best = null
  for (const conceptId of sourceConcepts) {
    const concept = concepts.get(conceptId)
    const targetMatches = {}
    for (const lang of languageMap.values()) {
      if (lang === row.source_lang) continue
      const hints = row.generation_hints?.[lang]?.terms || []
      const forms = concept.get(lang) || new Set()
      const exact = hints.map(cleanTerm).map(normalize).filter((term) => forms.has(term))
      if (exact.length) targetMatches[lang] = [...new Set(exact)]
    }
    const score = Object.keys(targetMatches).length
    if (!best || score > best.target_match_count) {
      best = {
        concept_id: conceptId,
        four_language_concept: fourLanguageConcepts.has(conceptId),
        target_match_count: score,
        target_matches: targetMatches
      }
    }
  }
  matches.push({
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    decision: row.decision,
    reason: row.reason,
    ...best
  })
}

const output = {
  generated_at: new Date().toISOString(),
  inputs: {
    glosses: path.relative(process.cwd(), glossesPath),
    residual: path.relative(process.cwd(), residualPath),
    db: path.relative(process.cwd(), dbPath)
  },
  policy: {
    publication_evidence: false,
    requires_source_list_license_review: true,
    exact_normalized_forms_only: true,
    concepticon_is_not_a_dictionary_definition_source: true
  },
  summary: {
    concepts: concepts.size,
    four_language_concepts: fourLanguageConcepts.size,
    four_language_unique_terms: fourLanguageTerms.size,
    four_language_terms_already_in_product: [...fourLanguageTerms].filter((term) => productTerms.has(term)).length,
    residual_rows: rows.length,
    residual_source_matches: matches.length,
    residual_matches_with_one_target: matches.filter((row) => row.target_match_count >= 1).length,
    residual_matches_with_two_targets: matches.filter((row) => row.target_match_count >= 2).length,
    residual_matches_with_all_targets: matches.filter((row) => row.target_match_count >= 3).length
  },
  matches: matches.sort((a, b) => b.target_match_count - a.target_match_count || String(a.word).localeCompare(String(b.word)))
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2))

function cleanTerm(value) {
  return String(value || '')
    .replace(/^[$*]+|[$*]+$/gu, '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim()
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('und')
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`)
  return String(value)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true'
  }
  return parsed
}
