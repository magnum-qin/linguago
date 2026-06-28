import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  row(8546, "noun", "plural of answer", "Plural of answer."),
  row(8762, "verb", "past tense and past participle of stand", "Past tense and past participle of stand."),
  row(8788, "verb", "present participle and gerund of check", "Present participle and gerund of check."),
  row(9198, "verb", "present participle and gerund of pull", "Present participle and gerund of pull."),
  row(9361, "verb", "past tense and past participle of escape", "Past tense and past participle of escape."),
  row(9598, "verb", "past tense and past participle of serve", "Past tense and past participle of serve."),
  row(9952, "verb", "third-person singular present of help", "Third-person singular present of help."),
  row(10584, "noun", "plural or third-person singular form of stand", "Plural or third-person singular form of stand."),
  row(10613, "noun", "plural of mind", "Plural of mind."),
  row(11199, "noun", "plural or third-person singular form of break", "Plural or third-person singular form of break."),
  row(11332, "verb", "third-person singular present of believe", "Third-person singular present of believe."),
  row(11516, "verb", "present participle and gerund of consider", "Present participle and gerund of consider."),
  row(13355, "verb", "third-person singular present of hold", "Third-person singular present of hold."),
  row(13506, "noun", "plural of bell", "Plural of bell."),
  row(13619, "noun", "plural or third-person singular form of beat", "Plural or third-person singular form of beat."),
  row(13894, "noun", "a portion of food or the act of serving", "A portion of food or the act of serving."),
  row(14035, "noun", "plural of suspect", "Plural of suspect."),
  row(14087, "adjective", "comparative of deep", "Comparative of deep."),
  row(15990, "verb", "third-person singular present of grow", "Third-person singular present of grow."),
  row(16974, "noun", "plural of father", "Plural of father."),
  row(18932, "adjective", "having a crack or cracks", "Having a crack or cracks."),
  row(18970, "verb", "third-person singular present of decide", "Third-person singular present of decide."),
  row(19018, "verb", "third-person singular present of hear", "Third-person singular present of hear."),
  row(19352, "verb", "third-person singular present of allow", "Third-person singular present of allow."),
  row(19431, "verb", "third-person singular present of remember", "Third-person singular present of remember."),
  row(19597, "adjective", "called off or no longer scheduled", "Called off or no longer scheduled."),
  row(19762, "verb", "past tense and past participle of pop", "Past tense and past participle of pop."),
  row(19797, "adjective", "called off or made invalid", "Called off or made invalid."),
  row(19935, "noun", "plural of floor", "Plural of floor."),
  row(23002, "verb", "past tense and past participle of sacrifice", "Past tense and past participle of sacrifice."),
  row(20013, "verb", "past tense and past participle of lift", "Past tense and past participle of lift."),
  row(20087, "verb", "past tense and past participle of fear", "Past tense and past participle of fear."),
  row(20101, "verb", "present participle and gerund of refer", "Present participle and gerund of refer."),
  row(20497, "verb", "past tense and past participle of swallow", "Past tense and past participle of swallow."),
  row(20527, "verb", "past tense and past participle of promote", "Past tense and past participle of promote."),
  row(20740, "verb", "past tense and past participle of rush", "Past tense and past participle of rush."),
  row(20782, "verb", "third-person singular present of fail", "Third-person singular present of fail."),
  row(21045, "adjective", "fixed, restricted, or taught the basics", "Fixed, restricted, or taught the basics."),
  row(21218, "verb", "past tense and past participle of free", "Past tense and past participle of free."),
  row(21598, "verb", "past tense and past participle of skip", "Past tense and past participle of skip."),
  row(21637, "verb", "third-person singular present of agree", "Third-person singular present of agree."),
  row(21678, "verb", "past tense and past participle of whip", "Past tense and past participle of whip."),
  row(23703, "verb", "past tense and past participle of pour", "Past tense and past participle of pour."),
  row(24111, "verb", "third-person singular present of enter", "Third-person singular present of enter."),
  row(24344, "verb", "past tense and past participle of hack", "Past tense and past participle of hack."),
  row(24708, "verb", "past tense and past participle of encourage", "Past tense and past participle of encourage."),
  row(25728, "verb", "present participle and gerund of rip", "Present participle and gerund of rip."),
  row(25759, "adjective", "said or done again", "Said or done again."),
  row(25928, "verb", "present participle and gerund of bust", "Present participle and gerund of bust."),
  row(26473, "verb", "past tense and past participle of scratch", "Past tense and past participle of scratch."),
  row(25102, "verb", "present participle and gerund of connect", "Present participle and gerund of connect."),
  row(27215, "verb", "past tense and past participle of consume", "Past tense and past participle of consume."),
  row(27292, "verb", "third-person singular present of forget", "Third-person singular present of forget."),
  row(28239, "verb", "past tense and past participle of convert", "Past tense and past participle of convert."),
  row(28537, "adjective", "increased to twice as much", "Increased to twice as much."),
  row(29124, "verb", "third-person singular present of destroy", "Third-person singular present of destroy."),
  row(29285, "verb", "present participle and gerund of skip", "Present participle and gerund of skip.")
];

const db = new Database(dbPath);
db.pragma("busy_timeout = 30000");

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
      source = 'manual:inflected-batch10-20260628',
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
  return { sense_id, part_of_speech, gloss_key, definition };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}
