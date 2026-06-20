import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] !== "false";
const source = "known-residual-json-failures-finalize-20260620";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const fixes = [
  {
    job_id: 53125,
    sense_id: 7922,
    lang: "ja",
    term: "得点；走行",
    reading: "とくてん；そうこう",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "野球などで走者が得る得点、または走ること・試験的な運転や連続した動作を表す語。"
  },
  {
    job_id: 53126,
    sense_id: 11199,
    lang: "ja",
    term: "中断；休憩；破損",
    reading: "ちゅうだん；きゅうけい；はそん",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "活動を一時的に止めること、休み、または物が割れる・壊れること。"
  },
  {
    job_id: 53129,
    sense_id: 11199,
    lang: "pt-BR",
    term: "pausas; quebras",
    reading: null,
    reading_system: null,
    pronunciation: "/ˈpaw.zas ˈkɛ.bɾas/",
    pronunciation_system: "IPA",
    definition: "Interrupções, intervalos ou rupturas; também pode indicar uma ocorrência inesperada que interrompe uma atividade."
  }
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const statements = {
  findLocalization: db.prepare("SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?"),
  updateLocalization: db.prepare(`
    UPDATE product_localizations
    SET term = @term,
        reading = @reading,
        reading_system = @reading_system,
        pronunciation = @pronunciation,
        pronunciation_system = @pronunciation_system,
        definition = @definition,
        source = @source,
        confidence = 0.96,
        needs_review = 0
    WHERE product_sense_id = @sense_id
      AND lang = @lang
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
    VALUES
      (@sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.96, 0)
  `),
  markJobAccepted: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'accepted',
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @job_id
  `),
  completedCleanLangCount: db.prepare(`
    SELECT COUNT(DISTINCT lang) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 0
  `),
  reviewLocalizationCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 1
  `),
  markSenseAccepted: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ?
      AND status IN ('ready_for_llm', 'needs_review', 'draft_fused', 'draft_single_source')
  `),
  senseEntry: db.prepare("SELECT product_entry_id FROM product_senses WHERE id = ?"),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare("UPDATE product_entries SET status = ? WHERE id = ?")
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  fixes: fixes.length,
  inserted: 0,
  updated: 0,
  jobs_marked_accepted: 0,
  senses_marked_accepted: 0
};

if (!dryRun) {
  db.transaction(() => {
    for (const fix of fixes) applyFix(fix);
  })();
} else {
  for (const fix of fixes) {
    if (statements.findLocalization.get(fix.sense_id, fix.lang)) stats.updated++;
    else stats.inserted++;
  }
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function applyFix(fix) {
  const payload = { ...fix, source };
  if (statements.findLocalization.get(fix.sense_id, fix.lang)) {
    statements.updateLocalization.run(payload);
    stats.updated++;
  } else {
    statements.insertLocalization.run(payload);
    stats.inserted++;
  }
  stats.jobs_marked_accepted += statements.markJobAccepted.run(fix).changes;
  if (
    statements.completedCleanLangCount.get(fix.sense_id).count >= 4 &&
    statements.reviewLocalizationCount.get(fix.sense_id).count === 0
  ) {
    stats.senses_marked_accepted += statements.markSenseAccepted.run(fix.sense_id).changes;
    const entry = statements.senseEntry.get(fix.sense_id);
    if (entry) updateEntryStatus(entry.product_entry_id);
  }
}

function updateEntryStatus(productEntryId) {
  const statuses = statements.entryStatusCounts.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  if (accepted === total) statements.setEntryStatus.run("accepted", productEntryId);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
