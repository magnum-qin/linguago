import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const targetPath = requiredPath(args.target);
const inputPath = requiredPath(args.input);
if (targetPath === inputPath) throw new Error('Target and input must differ');

const db = new Database(targetPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.exec(`ATTACH DATABASE ${JSON.stringify(inputPath)} AS incoming`);
const conflicts = db.prepare(`
  SELECT i.source_key
  FROM incoming.evidence_sources i
  JOIN main.evidence_sources m ON m.source_key = i.source_key
  WHERE m.source_family <> i.source_family OR m.license <> i.license OR m.metadata_json <> i.metadata_json
`).all();
if (conflicts.length) throw new Error(`Source metadata conflict: ${conflicts.map((row) => row.source_key).join(', ')}`);
const before = db.prepare('SELECT COUNT(*) n FROM lexical_evidence').get().n;
db.transaction(() => {
  db.exec(`
    INSERT OR IGNORE INTO main.evidence_sources
      (source_key, source_family, lang, lexicon_spec, license, metadata_json)
    SELECT source_key, source_family, lang, lexicon_spec, license, metadata_json
    FROM incoming.evidence_sources;
    INSERT OR IGNORE INTO main.lexical_evidence
      (source_key, source_family, lang, term, normalized_key,
       english_gloss, english_normalized_key, concept_id)
    SELECT source_key, source_family, lang, term, normalized_key,
           english_gloss, english_normalized_key, concept_id
    FROM incoming.lexical_evidence;
  `);
})();
const after = db.prepare('SELECT COUNT(*) n FROM lexical_evidence').get().n;
db.exec('DETACH DATABASE incoming');
db.pragma('wal_checkpoint(TRUNCATE)');
const integrity = db.pragma('integrity_check', { simple: true });
const familyRows = db.prepare('SELECT COUNT(*) n FROM lexical_evidence WHERE source_family = ?').get('openhownet').n;
db.close();
console.log(JSON.stringify({ ok: integrity === 'ok', target: path.relative(process.cwd(), targetPath), input: path.relative(process.cwd(), inputPath), added: after - before, openhownet_rows: familyRows, integrity }, null, 2));

function requiredPath(value) { if (!value) throw new Error('Required: --target and --input'); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true; } return out; }
