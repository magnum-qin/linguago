#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const args = parseArgs(process.argv.slice(2))
const dbPath = path.resolve(required(args.db, 'db'))
const outPath = args.out ? path.resolve(args.out) : null
const sampleSourceKey = String(args['sample-source-key'] || '').trim()

if (!fs.existsSync(dbPath)) throw new Error(`Evidence DB not found: ${dbPath}`)

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
db.pragma('query_only = ON')
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
const inventories = []

for (const { name } of tables) {
  const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all().map((row) => row.name)
  if (!['source_family', 'source_key', 'lang'].every((column) => columns.includes(column))) continue
  const rows = db.prepare(`
    SELECT source_family, source_key, lang, COUNT(*) AS rows
    FROM ${quoteIdentifier(name)}
    GROUP BY source_family, source_key, lang
    ORDER BY rows DESC, source_family, source_key, lang
  `).all()
  inventories.push({ table: name, columns, rows })
}
db.close()

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  tables: inventories,
  samples: sampleSourceKey
    ? inventories.flatMap(({ table, columns }) =>
        columns.includes('source_key')
          ? dbSamples(dbPath, table, sampleSourceKey)
          : []
      )
    : [],
  summary: {
    evidence_tables: inventories.length,
    source_families: [...new Set(inventories.flatMap((item) => item.rows.map((row) => row.source_family)))].sort(),
    source_keys: [...new Set(inventories.flatMap((item) => item.rows.map((row) => row.source_key)))].sort()
  }
}

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
}
console.log(JSON.stringify(output, null, 2))

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function dbSamples(filePath, table, sourceKey) {
  const sampleDb = new Database(filePath, { readonly: true, fileMustExist: true })
  sampleDb.pragma('query_only = ON')
  const rows = sampleDb
    .prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE source_key = ? LIMIT 5`)
    .all(sourceKey)
  sampleDb.close()
  return rows.map((row) => ({ table, ...row }))
}

function required(value, name) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`Missing --${name}`)
  return text
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) parsed[key] = true
    else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}
