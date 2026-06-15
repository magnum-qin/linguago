import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago_d1_ready.db', { readonly: true });
const sql = `
SELECT json_object(
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
WHERE e.word = '11区';
`;

const row = db.prepare(sql).get();
if (row) {
  console.log(JSON.stringify(JSON.parse(row.data), null, 2));
} else {
  console.log("Not found");
}
