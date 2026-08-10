import Database from 'better-sqlite3';
import fs from 'fs';

const dbPath = 'data/processed/linguago_d1_ready.db';
const db = new Database(dbPath, { readonly: true });

const idsRow = db.prepare('SELECT id FROM entries ORDER BY RANDOM() LIMIT 100;').all();
const ids = idsRow.map((r) => r.id);

const sql = `
SELECT json_object(
  'word', e.word,
  'source_lang', e.source_lang,
  'senses', (
    SELECT json_group_array(json_object(
      'sense_order', s.sense_order,
      'part_of_speech', s.pos,
      'gloss_key', s.gloss,
      'definitions', (
        SELECT json_group_object(d.lang, d.translation)
        FROM definitions d WHERE d.sense_id = s.id
      )
    ))
    FROM senses s WHERE s.entry_id = e.id
  ),
  'examples', (
    SELECT json_group_array(json_object(
      'sense_order', s.sense_order,
      'sentence', ex.source_sentence,
      'translations', json_object(
        'zh', ex.translation_zh,
        'en', ex.translation_en,
        'ja', ex.translation_ja,
        'pt-BR', ex.translation_pt
      )
    ))
    FROM examples ex 
    INNER JOIN senses s ON ex.sense_id = s.id 
    WHERE s.entry_id = e.id
  )
) as data
FROM entries e
WHERE e.id IN (${ids.join(',')});
`;

const rows = db.prepare(sql).all();

let markdown = `# 词典数据随机抽查 (100个词条)\n\n`;
markdown += `> [!NOTE]\n> 这是从 D1 规范化数据库中通过 \`JSON_GROUP_ARRAY\` 极速提取并自动还原的嵌套树状结构样本。\n\n`;

rows.forEach((row, idx) => {
  const entry = JSON.parse(row.data);
  markdown += `### ${idx + 1}. **${entry.word}** (${entry.source_lang})\n\n`;

  if (entry.senses && entry.senses.length > 0) {
    markdown += `**义项 (Senses):**\n`;
    entry.senses.forEach((sense) => {
      const pos = sense.part_of_speech ? `[${sense.part_of_speech}]` : '';
      const gloss = sense.gloss_key ? `*${sense.gloss_key}*` : '';
      markdown += `- **${sense.sense_order}**. ${pos} ${gloss}\n`;

      const defs = sense.definitions || {};
      const defStrings = [];
      if (defs.zh) defStrings.push(`🇨🇳 ${defs.zh}`);
      if (defs.ja) defStrings.push(`🇯🇵 ${defs.ja}`);
      if (defs['pt-BR']) defStrings.push(`🇧🇷 ${defs['pt-BR']}`);
      if (defs.en) defStrings.push(`🇬🇧 ${defs.en}`);

      if (defStrings.length > 0) {
        markdown += `  - 释义: ${defStrings.join(' | ')}\n`;
      }
    });
  } else {
    markdown += `*(无详细义项)*\n`;
  }

  if (entry.examples && entry.examples.length > 0) {
    markdown += `\n**例句 (Examples):**\n`;
    entry.examples.forEach((ex) => {
      markdown += `- ${ex.sentence}\n`;
      const trans = ex.translations || {};
      const trStrings = [];
      if (trans.zh) trStrings.push(`🇨🇳 ${trans.zh}`);
      if (trans.ja) trStrings.push(`🇯🇵 ${trans.ja}`);
      if (trans['pt-BR']) trStrings.push(`🇧🇷 ${trans['pt-BR']}`);
      if (trStrings.length > 0) {
        markdown += `  - ${trStrings.join(' | ')}\n`;
      }
    });
  }

  markdown += `\n---\n\n`;
});

const outPath = 'C:/Users/qhz00/.gemini/antigravity/brain/a5fdbd3c-8af0-4f6d-932c-7b1616f9b073/audit_100_words.md';
fs.writeFileSync(outPath, markdown);
console.log('Saved to ' + outPath);
