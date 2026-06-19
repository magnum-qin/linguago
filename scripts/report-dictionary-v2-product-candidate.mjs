import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_candidate.db";
const DEFAULT_OUT = "data/processed/product-candidate-report.json";
const LANGS = ["en", "pt-BR", "zh", "ja"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const sampleLimit = Number.parseInt(args.samples || "80", 10);

if (!fs.existsSync(dbPath)) throw new Error(`Product candidate database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

const count = (sql) => db.prepare(sql).get().n;
const rows = (sql) => db.prepare(sql).all();

const totalSenses = count(`SELECT COUNT(*) AS n FROM product_senses`);
const fullyLocalized = count(`
  SELECT COUNT(*) AS n
  FROM (
    SELECT product_sense_id
    FROM product_localizations
    GROUP BY product_sense_id
    HAVING COUNT(DISTINCT lang) = 4
  )
`);

const report = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  generated_at: new Date().toISOString(),
  summary: {
    product_entries: count(`SELECT COUNT(*) AS n FROM product_entries`),
    product_senses: totalSenses,
    product_localizations: count(`SELECT COUNT(*) AS n FROM product_localizations`),
    source_links: count(`SELECT COUNT(*) AS n FROM product_sense_source_links`),
    fully_localized_senses: fullyLocalized,
    fully_localized_rate: round(fullyLocalized / Math.max(totalSenses, 1), 4),
    freedict_localization_senses: count(`
      SELECT COUNT(DISTINCT product_sense_id) AS n
      FROM product_localizations
      WHERE source LIKE 'freedict-%'
    `),
    pt_source_linked_senses: count(`
      SELECT COUNT(DISTINCT product_sense_id) AS n
      FROM product_sense_source_links
      WHERE source_lang = 'pt-BR'
    `),
    freedict_localizations: count(`
      SELECT COUNT(*) AS n
      FROM product_localizations
      WHERE source LIKE 'freedict-%'
    `)
  },
  coverage: {
    localizations_by_lang: rows(`
      SELECT lang, COUNT(*) AS rows
      FROM product_localizations
      GROUP BY lang
      ORDER BY lang
    `),
    source_links_by_lang: rows(`
      SELECT source_lang, COUNT(*) AS rows
      FROM product_sense_source_links
      GROUP BY source_lang
      ORDER BY source_lang
    `),
    source_links_by_method: rows(`
      SELECT match_method, COUNT(*) AS rows
      FROM product_sense_source_links
      GROUP BY match_method
      ORDER BY rows DESC
    `),
    localization_matrix: rows(`
      SELECT localized_langs, COUNT(*) AS product_senses
      FROM (
        SELECT product_sense_id, COUNT(DISTINCT lang) AS localized_langs
        FROM product_localizations
        GROUP BY product_sense_id
      )
      GROUP BY localized_langs
      ORDER BY localized_langs
    `),
    missing_by_lang: LANGS.map((lang) => ({
      lang,
      missing_senses: count(`
        SELECT COUNT(*) AS n
        FROM product_senses ps
        WHERE NOT EXISTS (
          SELECT 1
          FROM product_localizations pl
          WHERE pl.product_sense_id = ps.id
            AND pl.lang = '${lang}'
        )
      `)
    })),
    localizations_by_source: rows(`
      SELECT source, lang, COUNT(*) AS rows
      FROM product_localizations
      GROUP BY source, lang
      ORDER BY rows DESC, source, lang
      LIMIT 50
    `)
  },
  risk: {
    high_source_count_senses: count(`
      SELECT COUNT(*) AS n
      FROM (
        SELECT product_sense_id
        FROM product_sense_source_links
        GROUP BY product_sense_id
        HAVING COUNT(*) >= 6
      )
    `),
    broad_short_gloss_senses: count(`
      SELECT COUNT(*) AS n
      FROM product_senses ps
      WHERE length(trim(ps.gloss_key)) <= 3
    `),
    freedict_short_gloss_senses: count(`
      SELECT COUNT(DISTINCT ps.id) AS n
      FROM product_senses ps
      JOIN product_sense_source_links l ON l.product_sense_id = ps.id
      WHERE l.source_lang = 'pt-BR'
        AND length(trim(ps.gloss_key)) <= 3
    `),
    high_risk_samples: rows(`
      SELECT pe.id AS entry_id,
             ps.id AS sense_id,
             pe.headword,
             pe.primary_lang,
             pe.frequency_rank,
             pe.group_method,
             pe.source_count,
             pe.lang_count,
             ps.gloss_key,
             (SELECT group_concat(DISTINCT source_lang) FROM product_sense_source_links WHERE product_sense_id = ps.id) AS source_langs,
             (SELECT group_concat(DISTINCT lang) FROM product_localizations WHERE product_sense_id = ps.id) AS localization_langs
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      WHERE pe.source_count >= 6
         OR length(trim(ps.gloss_key)) <= 3
         OR EXISTS (
           SELECT 1
           FROM product_sense_source_links l
           WHERE l.product_sense_id = ps.id
             AND l.source_lang = 'pt-BR'
             AND length(trim(ps.gloss_key)) <= 3
         )
      ORDER BY pe.frequency_rank IS NULL,
               pe.frequency_rank,
               pe.source_count DESC,
               pe.id
      LIMIT ${boundedLimit(sampleLimit)}
    `)
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary: report.summary,
      risk: {
        high_source_count_senses: report.risk.high_source_count_senses,
        broad_short_gloss_senses: report.risk.broad_short_gloss_senses,
        freedict_short_gloss_senses: report.risk.freedict_short_gloss_senses
      }
    },
    null,
    2
  )
);

function boundedLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 80;
  return Math.max(1, Math.min(parsed, 500));
}

function round(value, digits) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i++;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}
