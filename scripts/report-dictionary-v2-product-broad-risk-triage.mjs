import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_RISK = 'logs/product-published-risk-after-primary-conflict-fix-20260625.json';
const DEFAULT_OUT = 'logs/product-broad-risk-triage-20260625.json';
const LANGS = ['en', 'zh', 'ja', 'pt-BR'];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const riskPath = path.resolve(args.risk || DEFAULT_RISK);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const markdownPath = outPath.replace(/\.json$/u, '.md');
const limit = Number(args.limit || 120);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(riskPath)) throw new Error(`Risk report not found: ${riskPath}`);

const risk = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
const broadIds = new Set(
  (risk.flagged_senses || [])
    .filter((row) => Array.isArray(row.issues) && row.issues.includes('broad_multi_definition_gloss'))
    .map((row) => Number(row.sense_id))
);

const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');

const detailsStmt = db.prepare(`
  SELECT
    pe.id AS entry_id,
    pe.headword,
    pe.primary_lang,
    pe.frequency_rank,
    pe.group_method,
    pe.source_count AS entry_source_count,
    ps.id AS sense_id,
    ps.sense_order,
    ps.part_of_speech,
    ps.gloss_key,
    ps.status,
    ps.confidence,
    (
      SELECT COUNT(*)
      FROM product_sense_source_links l
      WHERE l.product_sense_id = ps.id
    ) AS sense_source_count
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id = ?
`);

const locStmt = db.prepare(`
  SELECT lang, term, reading, pronunciation, definition, source
  FROM product_localizations
  WHERE product_sense_id = ?
  ORDER BY lang
`);

const sourceStmt = db.prepare(`
  SELECT source_lang, source_word, source_frequency_rank, match_method, confidence
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY source_frequency_rank IS NULL, source_frequency_rank, source_lang, source_word, id
  LIMIT 24
`);

const rows = [];
for (const senseId of broadIds) {
  const detail = detailsStmt.get(senseId);
  if (!detail) continue;
  const localizations = Object.fromEntries(locStmt.all(senseId).map((row) => [row.lang, row]));
  const sources = sourceStmt.all(senseId);
  const features = buildFeatures(detail, localizations, sources);
  const triage = classify(detail, localizations, sources, features);
  rows.push({
    ...detail,
    localizations: compactLocalizations(localizations),
    source_links: sources,
    features,
    triage
  });
}

rows.sort((a, b) => {
  const priorityA = triagePriority(a.triage.recommendation);
  const priorityB = triagePriority(b.triage.recommendation);
  return (
    priorityA - priorityB ||
    Number(a.frequency_rank ?? 999999) - Number(b.frequency_rank ?? 999999) ||
    Number(b.sense_source_count || 0) - Number(a.sense_source_count || 0) ||
    a.sense_id - b.sense_id
  );
});

const summary = {
  broad_input_senses: broadIds.size,
  triaged_senses: rows.length,
  by_recommendation: countBy(rows, (row) => row.triage.recommendation),
  by_primary_lang: countBy(rows, (row) => row.primary_lang)
};

const llmCandidates = rows
  .filter((row) => row.triage.recommendation === 'llm_split_candidate')
  .slice(0, Math.max(1, Math.min(limit, 80)));

const report = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  risk: path.relative(process.cwd(), riskPath),
  generated_at: new Date().toISOString(),
  summary,
  llm_candidate_sense_ids: llmCandidates.map((row) => row.sense_id),
  llm_candidates: llmCandidates,
  rows: rows.slice(0, limit)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(markdownPath, renderMarkdown(report), 'utf8');

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      markdown: path.relative(process.cwd(), markdownPath),
      summary,
      first_llm_candidate_sense_ids: report.llm_candidate_sense_ids.slice(0, 30)
    },
    null,
    2
  )
);

db.close();

function buildFeatures(row, localizations, sources) {
  const gloss = String(row.gloss_key || '');
  const sourceWords = [...new Set(sources.map((source) => `${source.source_lang}:${source.source_word}`))];
  const lines = gloss
    .split(/\n|\\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const posMarkers = lines.filter((line) => /^(?:n|v|a|adj|adv|pron|prep|conj|int|s|r)\b[. ]/iu.test(line)).length;
  const semicolonParts = gloss
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean).length;
  const localizedNewlineDefinitions = LANGS.filter((lang) =>
    /\\n|\n/u.test(localizations[lang]?.definition || '')
  ).length;
  const enTerm = normalize(localizations.en?.term);
  const headword = normalize(row.headword);

  return {
    lines: lines.length,
    pos_markers: posMarkers,
    semicolon_parts: semicolonParts,
    source_words: sourceWords.length,
    source_langs: [...new Set(sources.map((source) => source.source_lang))].sort(),
    localized_newline_definitions: localizedNewlineDefinitions,
    english_term_matches_headword: Boolean(
      enTerm && headword && (enTerm === headword || enTerm.includes(headword) || headword.includes(enTerm))
    ),
    has_function_pos: /pron|prep|conj|det|article|aux|particle|interj|adv/u.test(
      String(row.part_of_speech || '').toLowerCase()
    )
  };
}

function classify(row, localizations, sources, features) {
  const headword = String(row.headword || '').toLowerCase();
  const enTerm = String(localizations.en?.term || '').toLowerCase();
  const gloss = String(row.gloss_key || '').toLowerCase();
  const rank = Number(row.frequency_rank ?? 999999);
  const functionWords = new Set([
    'the',
    'to',
    'of',
    'is',
    'my',
    'was',
    'be',
    'what',
    'how',
    'other',
    'never',
    'you',
    'i',
    'we',
    'or',
    'by',
    'when',
    'us',
    'something',
    'into',
    'else',
    'against',
    'himself',
    'unless',
    'herself',
    'towards',
    'toward',
    'per'
  ]);
  const inflectedFunctionLike = new Set([
    'got',
    'did',
    'were',
    'had',
    'been',
    'has',
    'doing',
    'coming',
    'came',
    'getting',
    'went',
    'seen',
    'called',
    'took',
    'having',
    'gave',
    'taking',
    'makes',
    'comes',
    'goes',
    'gets',
    'lives',
    'calling',
    'takes',
    'kept',
    'thinks',
    'ran',
    'calls',
    'gives',
    'holding',
    'named',
    'names',
    'helped',
    'keeps',
    'gotten',
    'breaking',
    'records',
    'heads',
    'lines',
    'sees',
    'harder',
    'changes',
    'points',
    'runs',
    'grew',
    'grown',
    'finds',
    'stops',
    'led',
    'answers',
    'stood',
    'checking',
    'pulling',
    'escaped',
    'served',
    'helps',
    'leads',
    'fed',
    'stands',
    'minds',
    'breaks',
    'believes',
    'considering',
    'holds',
    'bells',
    'beats',
    'serving',
    'suspects',
    'deeper'
  ]);
  const properNameLike = new Set(['george', 'james', 'elizabeth', 'edward', 'steven', 'lincoln']);
  const shortEnglishNoise = new Set(['sis', 'ay']);

  if (
    row.primary_lang === 'en' &&
    (properNameLike.has(headword) || (rank > 1000 && /^[A-Z][A-Za-z.-]+$/u.test(String(localizations.en?.term || ''))))
  ) {
    return {
      recommendation: 'manual_repair_or_block',
      confidence: 0.82,
      rationale:
        'English proper-name-like entry has a broad source gloss; keep as a name or block mixed generic senses manually.'
    };
  }

  if (row.primary_lang === 'en' && rank > 1000 && shortEnglishNoise.has(headword)) {
    return {
      recommendation: 'manual_repair_or_block',
      confidence: 0.78,
      rationale:
        'Short lower-frequency English item is likely abbreviation, interjection, or source noise; review manually before publication.'
    };
  }

  if (
    row.primary_lang === 'en' &&
    (functionWords.has(headword) || functionWords.has(enTerm) || features.has_function_pos)
  ) {
    return {
      recommendation: 'function_word_keep',
      confidence: 0.78,
      rationale:
        'High-frequency English function word or grammatical word; broad dictionary gloss is expected and should not be split automatically.'
    };
  }

  if (row.primary_lang === 'en' && inflectedFunctionLike.has(headword)) {
    return {
      recommendation: 'inflected_form_repair_or_keep',
      confidence: 0.8,
      rationale:
        'Inflected English verb/auxiliary form with a broad source gloss; prefer a compact manual/lemma-style localization over sense splitting.'
    };
  }

  if (row.primary_lang === 'en' && rank > 1000 && /(?:s|ed|ing)$/u.test(headword) && !['miles'].includes(headword)) {
    return {
      recommendation: 'inflected_form_repair_or_keep',
      confidence: 0.76,
      rationale:
        'Lower-frequency English plural/inflected form with broad gloss; prefer deterministic lemma-style repair or keep rather than LLM sense splitting.'
    };
  }

  if (
    row.primary_lang === 'en' &&
    rank <= 500 &&
    /(united states|department|federal|coin|currency|unit of money|semen|fluid containing spermatozoa)/iu.test(gloss)
  ) {
    return {
      recommendation: 'manual_repair_or_block',
      confidence: 0.86,
      rationale:
        'High-frequency English entry includes an unrelated proper-noun, abbreviation, currency, or biological sense mixed into the broad gloss.'
    };
  }

  if (row.primary_lang === 'ja' && [...String(row.headword || '')].length <= 2 && rank <= 500) {
    return {
      recommendation: 'function_word_keep',
      confidence: 0.72,
      rationale: 'Short high-frequency Japanese item; likely grammatical/kana usage and unsafe for automatic split.'
    };
  }

  if (features.localized_newline_definitions >= 2 || features.pos_markers >= 4 || features.semicolon_parts >= 7) {
    return {
      recommendation: 'llm_split_candidate',
      confidence: 0.86,
      rationale:
        'Gloss/localized definitions contain multiple definition lines or many semantic parts; likely over-merged.'
    };
  }

  if (features.source_words >= 6 && features.source_langs.length >= 2 && features.pos_markers >= 2) {
    return {
      recommendation: 'llm_split_candidate',
      confidence: 0.82,
      rationale: 'Many cross-language source words are attached to one sense with multiple POS-like gloss lines.'
    };
  }

  if (/n\..*v\.|v\..*n\.|adj\..*n\.|adv\..*pron\./su.test(gloss)) {
    return {
      recommendation: 'manual_review',
      confidence: 0.7,
      rationale: 'Gloss mixes parts of speech, but current localizations may already choose one usable published sense.'
    };
  }

  return {
    recommendation: 'likely_keep',
    confidence: 0.66,
    rationale: 'Broad source gloss was flagged, but published localizations look compact enough to keep until sampled.'
  };
}

function compactLocalizations(localizations) {
  return Object.fromEntries(
    LANGS.map((lang) => {
      const item = localizations[lang];
      return [
        lang,
        item
          ? {
              term: item.term,
              reading: item.reading,
              pronunciation: item.pronunciation,
              definition: abbreviate(item.definition, 220),
              source: item.source
            }
          : null
      ];
    })
  );
}

function renderMarkdown(report) {
  const lines = [
    '# Product Broad Risk Triage',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Broad input senses: ${report.summary.broad_input_senses}`,
    `- Triaged senses: ${report.summary.triaged_senses}`,
    `- By recommendation: ${JSON.stringify(report.summary.by_recommendation)}`,
    '',
    '## First LLM Split Candidates',
    '',
    '| rank | entry | sense | lang | headword | en | zh | ja | pt-BR | reason |',
    '|---:|---:|---:|---|---|---|---|---|---|---|'
  ];

  for (const row of report.llm_candidates.slice(0, 40)) {
    lines.push(
      [
        row.frequency_rank ?? '',
        row.entry_id,
        row.sense_id,
        row.primary_lang,
        cell(row.headword),
        cell(row.localizations.en?.term),
        cell(row.localizations.zh?.term),
        cell(row.localizations.ja?.term),
        cell(row.localizations['pt-BR']?.term),
        cell(row.triage.rationale)
      ]
        .join(' | ')
        .replace(/^/u, '| ') + ' |'
    );
  }

  lines.push('', '## Review Queue Samples', '');
  for (const row of report.rows.slice(0, 60)) {
    lines.push(
      `### ${row.frequency_rank ?? 'n/a'} ${row.headword} (${row.primary_lang}) sense ${row.sense_order} / ${row.sense_id}`,
      '',
      `- recommendation: ${row.triage.recommendation} (${row.triage.confidence})`,
      `- rationale: ${row.triage.rationale}`,
      `- features: ${JSON.stringify(row.features)}`,
      `- en/zh/ja/pt: ${row.localizations.en?.term || ''} | ${row.localizations.zh?.term || ''} | ${row.localizations.ja?.term || ''} | ${row.localizations['pt-BR']?.term || ''}`,
      `- gloss: ${abbreviate(row.gloss_key, 500)}`,
      `- sources: ${row.source_links.map((source) => `${source.source_lang}:${source.source_word}`).join(', ')}`,
      ''
    );
  }

  return lines.join('\n');
}

function countBy(rows, getKey) {
  const counts = {};
  for (const row of rows) {
    const key = getKey(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function triagePriority(value) {
  return (
    {
      llm_split_candidate: 0,
      manual_review: 1,
      manual_repair_or_block: 2,
      inflected_form_repair_or_keep: 3,
      function_word_keep: 4,
      likely_keep: 5
    }[value] ?? 9
  );
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^to\s+/u, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function abbreviate(value, maxLength) {
  if (value == null) return '';
  const text = String(value).replace(/\s+/gu, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function cell(value) {
  return String(value ?? '')
    .replace(/\|/gu, '\\|')
    .replace(/\n/gu, ' ');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
