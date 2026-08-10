import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  row(299, 'verb', 'past tense and past participle of get', 'Past tense and past participle of get.', 'get'),
  row(337, 'verb', 'past tense of do', 'Past tense of do.', 'do'),
  row(
    430,
    'verb',
    'past tense plural and subjunctive form of be',
    'Past tense plural and subjunctive form of be.',
    'be'
  ),
  row(439, 'verb', 'past tense and past participle of have', 'Past tense and past participle of have.', 'have'),
  row(442, 'verb', 'past participle of be', 'Past participle of be.', 'be'),
  row(504, 'verb', 'third-person singular present of have', 'Third-person singular present of have.', 'have'),
  row(658, 'verb', 'present participle and gerund of do', 'Present participle and gerund of do.', 'do'),
  row(1010, 'verb', 'present participle and gerund of come', 'Present participle and gerund of come.', 'come'),
  row(1075, 'verb', 'past tense of come', 'Past tense of come.', 'come'),
  row(1187, 'verb', 'present participle and gerund of get', 'Present participle and gerund of get.', 'get'),
  row(1217, 'verb', 'past tense of go', 'Past tense of go.', 'go'),
  row(1323, 'verb', 'past participle of see', 'Past participle of see.', 'see'),
  row(1385, 'verb', 'past tense and past participle of call', 'Past tense and past participle of call.', 'call'),
  row(1438, 'verb', 'past tense of take', 'Past tense of take.', 'take'),
  row(1715, 'verb', 'present participle and gerund of have', 'Present participle and gerund of have.', 'have'),
  row(1819, 'verb', 'past tense of give', 'Past tense of give.', 'give'),
  row(1875, 'verb', 'present participle and gerund of take', 'Present participle and gerund of take.', 'take'),
  row(1935, 'verb', 'third-person singular present of make', 'Third-person singular present of make.', 'make'),
  row(2006, 'verb', 'third-person singular present of come', 'Third-person singular present of come.', 'come'),
  row(2151, 'verb', 'third-person singular present of go', 'Third-person singular present of go.', 'go'),
  row(2187, 'verb', 'third-person singular present of get', 'Third-person singular present of get.', 'get'),
  row(2611, 'noun', 'plural of life', 'Plural of life.', 'life'),
  row(2968, 'verb', 'present participle and gerund of call', 'Present participle and gerund of call.', 'call'),
  row(3055, 'verb', 'third-person singular present of take', 'Third-person singular present of take.', 'take'),
  row(3324, 'verb', 'past tense and past participle of keep', 'Past tense and past participle of keep.', 'keep'),
  row(3548, 'verb', 'third-person singular present of think', 'Third-person singular present of think.', 'think'),
  row(3676, 'verb', 'past tense of run', 'Past tense of run.', 'run'),
  row(4277, 'verb', 'third-person singular present of call', 'Third-person singular present of call.', 'call'),
  row(4773, 'verb', 'third-person singular present of give', 'Third-person singular present of give.', 'give'),
  row(4839, 'verb', 'present participle and gerund of hold', 'Present participle and gerund of hold.', 'hold'),
  row(5066, 'verb', 'past tense and past participle of name', 'Past tense and past participle of name.', 'name'),
  row(5245, 'noun', 'plural of name', 'Plural of name.', 'name'),
  row(5422, 'verb', 'past tense and past participle of help', 'Past tense and past participle of help.', 'help'),
  row(5753, 'verb', 'third-person singular present of keep', 'Third-person singular present of keep.', 'keep'),
  row(6183, 'verb', 'past participle of get', 'Past participle of get.', 'get'),
  row(6459, 'verb', 'present participle and gerund of break', 'Present participle and gerund of break.', 'break'),
  row(6571, 'noun', 'plural of record', 'Plural of record.', 'record'),
  row(6614, 'noun', 'plural of head', 'Plural of head.', 'head'),
  row(7294, 'noun', 'plural of line', 'Plural of line.', 'line'),
  row(7314, 'verb', 'third-person singular present of see', 'Third-person singular present of see.', 'see'),
  row(7598, 'adjective', 'comparative of hard', 'Comparative of hard.', 'hard'),
  row(7791, 'noun', 'plural of change', 'Plural of change.', 'change'),
  row(7895, 'noun', 'plural of point', 'Plural of point.', 'point'),
  row(7922, 'verb', 'third-person singular present of run', 'Third-person singular present of run.', 'run'),
  row(8049, 'verb', 'past tense of grow', 'Past tense of grow.', 'grow'),
  row(8143, 'verb', 'past participle of grow', 'Past participle of grow.', 'grow'),
  row(8206, 'verb', 'third-person singular present of find', 'Third-person singular present of find.', 'find'),
  row(8279, 'verb', 'third-person singular present of stop', 'Third-person singular present of stop.', 'stop'),
  row(8325, 'verb', 'past tense and past participle of lead', 'Past tense and past participle of lead.', 'lead')
];

const db = new Database(dbPath);
db.pragma('busy_timeout = 30000');

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = ?,
      gloss_key = ?,
      confidence = MAX(confidence, 0.9)
  WHERE id = ?
`);

const updateEnglishLocalization = db.prepare(`
  UPDATE product_localizations
  SET definition = ?,
      source = 'manual:inflected-batch9-20260628',
      confidence = MAX(confidence, 0.9),
      needs_review = 0
  WHERE product_sense_id = ?
    AND lang = 'en'
`);

const verifyLocs = db.prepare(`
  SELECT COUNT(*) AS n
  FROM product_localizations
  WHERE product_sense_id = ?
`);

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    const locCount = verifyLocs.get(repair.sense_id).n;
    if (locCount !== 4) throw new Error(`Expected 4 localizations for sense ${repair.sense_id}, got ${locCount}`);
    const senseResult = updateSense.run(repair.part_of_speech, repair.gloss_key, repair.sense_id);
    if (senseResult.changes !== 1) throw new Error(`Missing product_sense ${repair.sense_id}`);
    const locResult = updateEnglishLocalization.run(repair.definition, repair.sense_id);
    if (locResult.changes !== 1) throw new Error(`Missing English localization ${repair.sense_id}`);
  }
});

if (apply) transaction();

console.log(
  JSON.stringify(
    {
      ok: true,
      apply,
      db: path.relative(process.cwd(), dbPath),
      repaired_sense_ids: repairs.map((repair) => repair.sense_id)
    },
    null,
    2
  )
);

db.close();

function row(sense_id, part_of_speech, gloss_key, definition) {
  return {
    sense_id,
    part_of_speech,
    gloss_key,
    definition
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
