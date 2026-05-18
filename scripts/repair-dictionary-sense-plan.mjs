import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const DB_FILE = path.resolve(process.argv[2] || "data/dictionary.sqlite");
const PLAN_FILE = path.resolve(process.argv[3] || "data/processed/dictionary-sense-repair-plan.json");
const SQL_WASM = path.resolve("node_modules/sql.js/dist/sql-wasm.wasm");

if (!fs.existsSync(DB_FILE)) throw new Error(`Database not found: ${DB_FILE}`);
if (!fs.existsSync(PLAN_FILE)) throw new Error(`Repair plan not found: ${PLAN_FILE}`);

const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
const repairs = Array.isArray(plan.repairs) ? plan.repairs : [];
if (!repairs.length) throw new Error("Repair plan has no repairs.");

const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(SQL_WASM) });
const db = new SQL.Database(fs.readFileSync(DB_FILE));

const selectEntry = db.prepare(`
  SELECT id, source_lang, headword, normalized_headword
  FROM dictionary_entries
  WHERE id = ?
`);
const selectSense = db.prepare(`
  SELECT id, sense_order, gloss_key
  FROM dictionary_senses
  WHERE entry_id = ? AND sense_order = ?
`);
const deleteStatements = [
  db.prepare("DELETE FROM dictionary_definitions WHERE entry_id = ? AND sense_order = ?"),
  db.prepare("DELETE FROM dictionary_examples WHERE entry_id = ? AND sense_order = ?"),
  db.prepare("DELETE FROM dictionary_senses WHERE entry_id = ? AND sense_order = ?")
];
const touchEntry = db.prepare("UPDATE dictionary_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = ?");

const results = [];
db.run("BEGIN");
try {
  for (const repair of repairs) {
    const entryId = Number(repair.entry_id);
    const removeSenseOrders = (repair.remove_sense_orders || []).map(Number).filter(Number.isFinite);
    if (!entryId || !removeSenseOrders.length) continue;

    const entry = getOne(selectEntry, [entryId]);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);

    const removed = [];
    for (const senseOrder of removeSenseOrders) {
      const sense = getOne(selectSense, [entryId, senseOrder]);
      if (!sense) {
        removed.push({ sense_order: senseOrder, status: "missing" });
        continue;
      }

      for (const statement of deleteStatements) {
        statement.run([entryId, senseOrder]);
      }
      removed.push({ sense_order: senseOrder, status: "deleted", gloss_key: sense.gloss_key });
    }

    touchEntry.run([entryId]);
    results.push({
      entry_id: entryId,
      headword: entry.headword,
      normalized_headword: entry.normalized_headword,
      reason: repair.reason || "",
      removed
    });
  }
  db.run("COMMIT");
} catch (error) {
  db.run("ROLLBACK");
  throw error;
} finally {
  selectEntry.free();
  selectSense.free();
  touchEntry.free();
  for (const statement of deleteStatements) statement.free();
}

fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
db.close();

console.log(JSON.stringify({ repaired_entries: results.length, results }, null, 2));

function getOne(statement, params) {
  statement.bind(params);
  try {
    if (!statement.step()) return null;
    return statement.getAsObject();
  } finally {
    statement.reset();
  }
}
