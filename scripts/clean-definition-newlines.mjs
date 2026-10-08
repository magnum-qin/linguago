#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || 'D:/linguago-runner/data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const apply = process.argv[3] === '--apply';

const db = new Database(dbPath, { readonly: !apply });

function cleanDefinition(rawDef, lang) {
  if (!rawDef) return rawDef;

  // Check if contains newline (actual or escaped) or pseudo HTML
  const hasNewline = rawDef.includes('\n') || rawDef.includes('\\n');
  const hasPseudoHtml = /<[a-z/][\s\S]*>/i.test(rawDef);
  const hasEscapedQuotes = rawDef.includes('\\"');

  if (!hasNewline && !hasPseudoHtml && !hasEscapedQuotes) return rawDef;

  let text = rawDef.replaceAll('\\"', '"');
  // Clean pseudo HTML tags
  text = text.replace(/<informal>=?/gi, '(informal) ')
             .replace(/<colloq>=?/gi, '(colloq) ')
             .replace(/<slang>=?/gi, '(slang) ')
             .replace(/<vulgar>=?/gi, '(vulgar) ')
             .replace(/<archaic>=?/gi, '(archaic) ');

  if (!text.includes('\n') && !text.includes('\\n')) {
    return text.trim();
  }

  // Split into lines
  const lines = text.split(/\r?\n|\\n/g)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  // Clean lines of leading POS tags like "v. ", "n. ", "a. ", "r. ", "s. "
  const cleanedLines = lines.map(line => {
    let l = line.replace(/^[varnsq]\.\s+/i, '');
    l = l.replace(/^[varnsq]\s+(?=[A-Za-z\u4e00-\u9faf\u3040-\u30ff])/u, '');
    return l.trim();
  }).filter(Boolean);

  const sep = (lang === 'zh' || lang === 'ja') ? '；' : '; ';
  
  // Format as numbered list: "1. line1；2. line2..."
  const formatted = cleanedLines.map((line, idx) => {
    // If line already starts with a number like "1.", "1)", just keep it
    if (/^\d+[\.\)]\s*/.test(line)) {
      return line;
    }
    return `${idx + 1}. ${line}`;
  }).join(sep);

  return formatted;
}

const rows = db.prepare(`
  SELECT id, lang, definition
  FROM product_localizations
  WHERE instr(definition, char(10)) > 0
     OR instr(definition, '\\n') > 0
     OR definition LIKE '%<informal>%'
     OR definition LIKE '%<colloq>%'
`).all();

console.log(`Found ${rows.length} definitions with newlines or pseudo-HTML.`);

let updatedCount = 0;
const sampleUpdates = [];

const updateStmt = apply ? db.prepare('UPDATE product_localizations SET definition = ? WHERE id = ?') : null;

if (apply) {
  const transaction = db.transaction(() => {
    for (const row of rows) {
      const cleaned = cleanDefinition(row.definition, row.lang);
      if (cleaned !== row.definition) {
        updateStmt.run(cleaned, row.id);
        updatedCount++;
        if (sampleUpdates.length < 15) {
          sampleUpdates.push({ id: row.id, lang: row.lang, before: row.definition, after: cleaned });
        }
      }
    }
  });
  transaction();
} else {
  for (const row of rows) {
    const cleaned = cleanDefinition(row.definition, row.lang);
    if (cleaned !== row.definition) {
      updatedCount++;
      if (sampleUpdates.length < 15) {
        sampleUpdates.push({ id: row.id, lang: row.lang, before: row.definition, after: cleaned });
      }
    }
  }
}

console.log(`Updated ${updatedCount} definitions (apply=${apply}).`);
console.log('Sample updates:');
console.log(JSON.stringify(sampleUpdates.slice(0, 5), null, 2));

db.close();
