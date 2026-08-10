import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import initSqlJs from 'sql.js';

const HOST = process.env.DICTIONARY_HOST || '0.0.0.0';
const PORT = Number(process.env.DICTIONARY_PORT || 8787);
const TOKEN = process.env.DICTIONARY_API_TOKEN || '';
const DB_FILE = path.resolve(process.env.DICTIONARY_DB || 'data/dictionary.sqlite');
const SQL_WASM = path.resolve(process.env.SQL_WASM || 'node_modules/sql.js/dist/sql-wasm.wasm');
const LANGS = ['zh', 'en', 'pt-BR', 'ja'];

let SQL;
let db;
let loadedMtime = 0;

await loadDatabase(true);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        db_loaded: Boolean(db),
        updated_at: dbUpdatedAt()
      });
    }

    if (url.pathname === '/admin/reload') {
      if (!authorized(request)) return sendJson(response, 401, { error: 'unauthorized' });
      await loadDatabase(true);
      return sendJson(response, 200, { ok: true, updated_at: dbUpdatedAt() });
    }

    if (!url.pathname.startsWith('/api/')) {
      return sendJson(response, 404, { error: 'not found' });
    }

    if (!authorized(request)) {
      return sendJson(response, 401, { error: 'unauthorized' });
    }

    await loadDatabase(false);

    if (url.pathname === '/api/dictionary/stats') {
      return sendJson(response, 200, dictionaryStats());
    }

    if (url.pathname === '/api/dictionary/lookup') {
      const term = normalize(url.searchParams.get('term') || '');
      if (!term) return sendJson(response, 400, { error: 'missing term' });
      return sendJson(response, 200, lookupTerm(term));
    }

    if (url.pathname === '/api/dictionary/report' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
      }
      try {
        const payload = JSON.parse(body);
        if (!payload.term) return sendJson(response, 400, { error: 'missing term' });

        const report = {
          term: payload.term,
          target_lang: payload.target_lang,
          reason: payload.reason,
          reported_at: new Date().toISOString(),
          status: 'pending'
        };
        fs.appendFileSync(path.resolve('data/error_reports.jsonl'), JSON.stringify(report) + '\n');
        return sendJson(response, 200, { ok: true });
      } catch (e) {
        return sendJson(response, 400, { error: 'invalid format' });
      }
    }

    return sendJson(response, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: 'internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dictionary API listening on ${HOST}:${PORT}`);
});

async function loadDatabase(force) {
  const stat = fs.statSync(DB_FILE);
  if (!force && db && stat.mtimeMs === loadedMtime) return;
  SQL ||= await initSqlJs({ wasmBinary: fs.readFileSync(SQL_WASM) });
  db?.close();
  db = new SQL.Database(fs.readFileSync(DB_FILE));
  loadedMtime = stat.mtimeMs;
}

function authorized(request) {
  if (!TOKEN) return false;
  return request.headers.authorization === `Bearer ${TOKEN}`;
}

function dictionaryStats() {
  const entry = selectOne(
    "SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM dictionary_entries WHERE status = 'accepted'",
    []
  );
  return {
    accepted_words: Number(entry?.count || 0),
    updated_at: entry?.updated_at || null,
    db_size: fs.statSync(DB_FILE).size
  };
}

function lookupTerm(normalizedTerm) {
  const directMatches = selectAll(
    `
      SELECT id, 'headword' AS match_type
      FROM dictionary_entries
      WHERE (normalized_headword = ? OR headword = ?)
        AND status = 'accepted'
      ORDER BY quality_score DESC, id ASC
      LIMIT 8
    `,
    [normalizedTerm, normalizedTerm]
  );

  const translationMatches = selectAll(
    `
      SELECT e.id, 'translation:' || t.lang AS match_type
      FROM dictionary_translations t
      JOIN dictionary_entries e ON e.id = t.entry_id
      WHERE t.normalized_text = ?
        AND e.status = 'accepted'
      ORDER BY e.quality_score DESC, e.id ASC
      LIMIT 8
    `,
    [normalizedTerm]
  );

  const matchById = new Map();
  for (const match of [...directMatches, ...translationMatches]) {
    if (!matchById.has(match.id)) matchById.set(match.id, match.match_type);
  }

  const entries = [...matchById.entries()].map(([id, matchType]) => buildEntry(Number(id), String(matchType)));

  return {
    term: normalizedTerm,
    count: entries.length,
    entries
  };
}

function buildEntry(id, matchType) {
  const entry = selectOne(
    `
      SELECT id, entry_type, source_lang, headword, normalized_headword, status, quality_score
      FROM dictionary_entries
      WHERE id = ?
    `,
    [id]
  );

  const translations = byLang(
    selectAll('SELECT lang, text, confidence FROM dictionary_translations WHERE entry_id = ?', [id])
  );
  const pronunciations = byLang(
    selectAll('SELECT lang, phonetic, audio_text FROM dictionary_pronunciations WHERE entry_id = ?', [id])
  );

  const definitions = selectAll(
    'SELECT sense_order, lang, definition FROM dictionary_definitions WHERE entry_id = ? ORDER BY sense_order, lang',
    [id]
  );
  const definitionsBySense = new Map();
  for (const definition of definitions) {
    if (!definitionsBySense.has(definition.sense_order)) {
      definitionsBySense.set(definition.sense_order, Object.fromEntries(LANGS.map((lang) => [lang, ''])));
    }
    definitionsBySense.get(definition.sense_order)[definition.lang] = definition.definition;
  }

  const senses = selectAll(
    `
      SELECT sense_order, part_of_speech, gloss_key, register_label,
             domain_label, frequency_rank, confidence
      FROM dictionary_senses
      WHERE entry_id = ?
      ORDER BY sense_order
    `,
    [id]
  ).map((sense) => ({
    ...sense,
    definitions: definitionsBySense.get(sense.sense_order) || Object.fromEntries(LANGS.map((lang) => [lang, '']))
  }));

  const examples = selectAll(
    `
      SELECT sense_order, example_order, source_sentence AS sentence,
             zh, en, pt_br AS "pt-BR", ja
      FROM dictionary_examples
      WHERE entry_id = ?
      ORDER BY sense_order, example_order
      LIMIT 6
    `,
    [id]
  ).map((example) => ({
    sense_order: example.sense_order,
    sentence: example.sentence,
    translations: {
      zh: example.zh,
      en: example.en,
      'pt-BR': example['pt-BR'],
      ja: example.ja
    }
  }));

  return {
    ...entry,
    match_type: matchType,
    translations,
    pronunciations,
    senses,
    examples
  };
}

function byLang(rows) {
  const output = Object.fromEntries(LANGS.map((lang) => [lang, null]));
  for (const row of rows) {
    output[row.lang] = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'lang'));
  }
  return output;
}

function selectAll(sql, params = []) {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function selectOne(sql, params = []) {
  return selectAll(sql, params)[0] || null;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function dbUpdatedAt() {
  try {
    return dictionaryStats().updated_at;
  } catch {
    return null;
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(data));
}
