import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || "data/processed/linguago_v2_staging.db");
const schemaPath = path.resolve(args.schema || "data/schema/dictionary-v2.sql");

if (!fs.existsSync(schemaPath)) {
  throw new Error(`Schema not found: ${schemaPath}`);
}

if (args.reset && fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(schemaPath, "utf8"));

const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  .all()
  .map((row) => row.name);

db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      db: path.relative(process.cwd(), dbPath),
      schema: path.relative(process.cwd(), schemaPath),
      table_count: tables.length,
      tables
    },
    null,
    2
  )
);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reset") {
      result.reset = true;
    } else if (arg.startsWith("--")) {
      result[arg.slice(2)] = argv[++i];
    }
  }
  return result;
}
