#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const inputDir = path.resolve(required(args['input-dir'], 'input-dir'))
const outPath = path.resolve(required(args.out, 'out'))
const sourceIds = String(required(args['source-ids'], 'source-ids'))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const sources = sourceIds.map((sourceId) => {
  const candidates = [
    path.join(inputDir, `panlex-${sourceId}-tail.ttl`),
    path.join(inputDir, `panlex-${sourceId}.ttl`)
  ]
  const inputPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!inputPath) throw new Error(`Missing TTL metadata input for PanLex source ${sourceId}`)

  const text = fs.readFileSync(inputPath, 'utf8')
  const metadata = {
    title: uniqueValues(text, /dc:title\s+"((?:[^"\\]|\\.)*)"/giu),
    publisher: uniqueValues(text, /dc:publisher\s+"((?:[^"\\]|\\.)*)"/giu),
    license: uniqueValues(text, /dc:license\s+"((?:[^"\\]|\\.)*)"/giu),
    source_url: uniqueValues(text, /dct:source\s+"((?:[^"\\]|\\.)*)"/giu),
    label: uniqueValues(text, /rdfs:label\s+"((?:[^"\\]|\\.)*)"\s*;/giu)
  }
  return {
    source_id: sourceId,
    input: path.relative(process.cwd(), inputPath),
    ...metadata,
    ...classify(metadata)
  }
})

const output = {
  generated_at: new Date().toISOString(),
  policy: {
    panlex_is_not_an_independent_family: true,
    co_license_is_publishable: false,
    unknown_sources_require_manual_review: true
  },
  summary: {
    sources: sources.length,
    wiktionary_family: sources.filter((item) => item.source_family === 'wiktionary').length,
    restricted_or_unreviewed: sources.filter((item) => item.decision === 'exclude_restricted').length,
    eligible_new_family: sources.filter((item) => item.decision === 'eligible').length,
    manual_review: sources.filter((item) => item.decision === 'manual_review').length
  },
  sources
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2))

function classify(metadata) {
  const haystack = [
    ...metadata.title,
    ...metadata.publisher,
    ...metadata.source_url,
    ...metadata.label
  ].join(' ').toLowerCase()
  if (haystack.includes('wiktionary') || haystack.includes('wikimedia')) {
    return {
      source_family: 'wiktionary',
      decision: 'duplicate_existing_family',
      production_publishable: false,
      reason: 'Underlying source is Wiktionary and cannot count independently from Kaikki/WikDict.'
    }
  }
  if (metadata.license.some((value) => value.toLowerCase() === 'co')) {
    return {
      source_family: 'panlex-unmapped',
      decision: 'exclude_restricted',
      production_publishable: false,
      reason: 'PanLex metadata marks this source as co; licensing and redistribution are not cleared.'
    }
  }
  return {
    source_family: 'panlex-unmapped',
    decision: 'manual_review',
    production_publishable: false,
    reason: 'Underlying family and redistribution terms require explicit review.'
  }
}

function uniqueValues(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => unescapeTurtle(match[1])))].sort()
}

function unescapeTurtle(value) {
  return value.replace(/\\"/gu, '"').replace(/\\\\/gu, '\\')
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
