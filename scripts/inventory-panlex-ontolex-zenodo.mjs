#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const metadataPath = path.resolve(required(args.metadata, 'metadata'))
const outPath = path.resolve(required(args.out, 'out'))
const recordId = String(args['record-id'] || '6757353')
const prefixBytes = boundedInteger(args['prefix-bytes'], 524288, 16384)
const concurrency = boundedInteger(args.concurrency, 6, 1)
const timeoutMs = boundedInteger(args['timeout-ms'], 30000, 1000)
const maxAttempts = boundedInteger(args['max-attempts'], 2, 1)
const resumePath = args['resume-from'] ? path.resolve(String(args['resume-from'])) : null
const targetLangs = new Set(
  String(args['target-langs'] || 'pt,zh,ja')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
)

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
const records = metadata?.hits?.hits || []
const record = records.find((item) => String(item.id) === recordId) || metadata
const files = Array.isArray(record.files) ? record.files : []
if (!files.length) throw new Error(`No files found for Zenodo record ${recordId}`)

const results = new Array(files.length)
const resumed = loadResumedResults(resumePath)
let cursor = 0
await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))

const selected = results.filter((item) =>
  item.ok && item.canonical_languages.includes('en') &&
    item.canonical_languages.some((lang) => targetLangs.has(lang))
)
const output = {
  ok: results.every((item) => item.ok),
  generated_at: new Date().toISOString(),
  record_id: recordId,
  record_title: record.metadata?.title || null,
  policy: {
    prefix_bytes: prefixBytes,
    target_langs: [...targetLangs].sort(),
    require_english: true,
    metadata_only: true,
    production_publishable: false,
    resumed_from: resumePath || null
  },
  summary: {
    files: files.length,
    inspected: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    selected: selected.length,
    selected_bytes: selected.reduce((sum, item) => sum + item.size, 0),
    selected_by_target_lang: Object.fromEntries(
      [...targetLangs].sort().map((lang) => [
        lang,
        selected.filter((item) => item.canonical_languages.includes(lang)).length
      ])
    )
  },
  selected,
  files: results
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2))
if (!output.ok) process.exitCode = 2

async function worker() {
  while (true) {
    const index = cursor++
    if (index >= files.length) return
    const prior = resumed.get(files[index].key)
    results[index] = prior || await inspectFile(files[index])
  }
}

async function inspectFile(file) {
  const url = file.links?.self ||
    `https://zenodo.org/api/records/${recordId}/files/${encodeURIComponent(file.key)}/content`
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=0-${prefixBytes - 1}` },
        signal: controller.signal
      })
      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}`)
      }
      const text = await response.text()
      const languages = detectLanguages(text)
      return {
        ok: true,
        source_id: String(file.key).replace(/\.ttl$/iu, ''),
        key: file.key,
        size: Number(file.size || 0),
        checksum: file.checksum || null,
        url,
        response_status: response.status,
        bytes_read: Buffer.byteLength(text),
        languages,
        canonical_languages: canonicalizeLanguages(languages)
      }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    ok: false,
    source_id: String(file.key).replace(/\.ttl$/iu, ''),
    key: file.key,
    size: Number(file.size || 0),
    checksum: file.checksum || null,
    url,
    error: String(lastError?.message || lastError || 'unknown_error')
  }
}

function loadResumedResults(filePath) {
  const reusable = new Map()
  if (!filePath || !fs.existsSync(filePath)) return reusable
  const prior = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  for (const item of prior.files || []) {
    if (!item?.ok || !item.key) continue
    reusable.set(item.key, {
      ...item,
      canonical_languages: canonicalizeLanguages(item.languages || [])
    })
  }
  return reusable
}

function canonicalizeLanguages(languages) {
  const aliases = {
    cmn: 'zh',
    zho: 'zh',
    jpn: 'ja',
    por: 'pt',
    eng: 'en'
  }
  return [...new Set(languages.map((lang) => aliases[lang] || lang))].sort()
}

function detectLanguages(text) {
  const languages = new Set()
  const patterns = [
    /ontolex:writtenRep\s+"(?:[^"\\]|\\.)*"@([a-z][a-z0-9-]*)/giu,
    /rdfs:label\s+"(?:[^"\\]|\\.)*"@([a-z][a-z0-9-]*)/giu
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) languages.add(match[1].toLowerCase())
  }
  return [...languages].sort()
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`)
  return String(value)
}

function boundedInteger(value, fallback, minimum) {
  const number = Number(value ?? fallback)
  if (!Number.isInteger(number) || number < minimum) throw new Error(`Invalid integer: ${value}`)
  return number
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
