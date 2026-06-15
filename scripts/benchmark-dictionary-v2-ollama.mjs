import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_ENDPOINT = "http://100.99.99.99:11436";
const DEFAULT_MODELS = ["translategemma:27b", "gemma4:26b", "qwen3.6:latest"];
const DEFAULT_DB = "data/processed/linguago_v2_sample.db";
const DEFAULT_OUT = "output/dictionary-v2-ollama-benchmark.json";

const args = parseArgs(process.argv.slice(2));
const endpoint = String(args.endpoint || process.env.OLLAMA_HOST || DEFAULT_ENDPOINT).replace(/\/$/, "");
const models = String(args.models || process.env.OLLAMA_MODELS || DEFAULT_MODELS.join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const timeoutMs = Number(args["timeout-ms"] || args.timeout || 120_000);
const prewarmTimeoutMs = Number(args["prewarm-timeout-ms"] || 180_000);
const maxTokens = Number(args["max-tokens"] || 900);
const prewarm = args.prewarm !== "false";
const fixtureMode = args.fixture || "auto";
const jobLimit = Number(args["job-limit"] || args.limit || 3);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const dbPath = path.resolve(args.db || DEFAULT_DB);

if (!models.length) {
  console.error("No models specified. Use --models modelA,modelB");
  process.exit(2);
}

const tasks = loadTasks();
if (!tasks.length) {
  console.error("No benchmark tasks found. Use --fixture builtin or create llm_completion_jobs first.");
  process.exit(2);
}

const systemPrompt = `You complete one missing localization for a multilingual dictionary.
Return JSON only. Do not include markdown or explanations outside JSON.
Preserve the sense meaning. Complete only the requested target language.
For zh, include Chinese term, pinyin reading, and Chinese definition.
For ja, include Japanese term, kana reading, and Japanese definition.
For pt-BR, include Brazilian Portuguese term, pronunciation, and Brazilian Portuguese definition.
For en, include English term, pronunciation, and English definition.`;

console.log(`Ollama endpoint: ${endpoint}`);
console.log(`Models: ${models.join(", ")}`);
console.log(`Tasks: ${tasks.length}`);
console.log(`Output: ${outPath}`);
console.log(`Prewarm: ${prewarm}`);

const results = [];
const prewarmResults = [];
for (const model of models) {
  if (prewarm) {
    const result = await prewarmModel(model);
    prewarmResults.push(result);
    console.log(
      `[prewarm] model=${model} ok=${result.ok} seconds=${result.seconds} load_seconds=${result.load_seconds ?? "n/a"}`
    );
  }

  for (const task of tasks) {
    const result = await runOne({ model, task });
    results.push(result);
    const status = result.ok ? "ok" : "fail";
    console.log(
      `[${status}] model=${model} target=${task.target_lang} entry=${task.entry.word} seconds=${result.seconds ?? "n/a"} score=${result.score}`
    );
  }
}

const summary = summarize(results);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      ok: true,
      endpoint,
      created_at: new Date().toISOString(),
      task_count: tasks.length,
      prewarm,
      prewarm_results: prewarmResults,
      summary,
      results
    },
    null,
    2
  )
);

console.table(
  summary.map((row) => ({
    model: row.model,
    ok: `${row.ok_count}/${row.task_count}`,
    avg_seconds: row.avg_seconds,
    avg_score: row.avg_score,
    json_ok: `${row.json_ok_count}/${row.task_count}`,
    recommendation_rank: row.rank
  }))
);
console.log(JSON.stringify({ summary, out: path.relative(process.cwd(), outPath) }, null, 2));

async function runOne({ model, task }) {
  const started = performance.now();
  try {
    const envelope = await callOllama({ model, task });
    const seconds = Number(((performance.now() - started) / 1000).toFixed(2));
    const content = envelope?.message?.content || envelope?.response || "";
    const parsed = parseJson(content);
    const validation = validate(parsed, task);
    return {
      ok: validation.errors.length === 0,
      model,
      task_id: task.id,
      target_lang: task.target_lang,
      entry_word: task.entry.word,
      seconds,
      score: validation.score,
      max_score: validation.max_score,
      errors: validation.errors,
      response: parsed,
      prompt_eval_count: envelope?.prompt_eval_count ?? null,
      eval_count: envelope?.eval_count ?? null
    };
  } catch (error) {
    return {
      ok: false,
      model,
      task_id: task.id,
      target_lang: task.target_lang,
      entry_word: task.entry.word,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      score: 0,
      max_score: 10,
      errors: [`${error.name || "Error"}: ${error.message || String(error)}`],
      response: null
    };
  }
}

async function prewarmModel(model) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), prewarmTimeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: "20m",
        prompt: "Return only OK.",
        options: {
          temperature: 0,
          num_predict: 2
        }
      })
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    const envelope = JSON.parse(text);
    return {
      ok: true,
      model,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      load_seconds: envelope.load_duration ? Number((envelope.load_duration / 1_000_000_000).toFixed(2)) : null,
      prompt_eval_count: envelope.prompt_eval_count ?? null,
      eval_count: envelope.eval_count ?? null
    };
  } catch (error) {
    return {
      ok: false,
      model,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      error: `${error.name || "Error"}: ${error.message || String(error)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama({ model, task }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: "20m",
        format: outputSchema(task.target_lang),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildPrompt(task) }
        ],
        options: {
          temperature: 0,
          top_p: 0.8,
          num_ctx: 4096,
          num_predict: maxTokens
        }
      })
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(task) {
  return `Complete the missing target language localization.

Input:
${JSON.stringify(task.input, null, 2)}

Return exactly this JSON shape:
{
  "sense_localization": {
    "lang": "${task.target_lang}",
    "term": "...",
    "reading": "... or null",
    "reading_system": "... or null",
    "pronunciation": "... or null",
    "pronunciation_system": "... or null",
    "definition": "...",
    "usage_note": "... or null"
  },
  "example_localizations": [
    {
      "example_id": 1,
      "lang": "${task.target_lang}",
      "text": "...",
      "reading": "... or null"
    }
  ]
}`;
}

function outputSchema(lang) {
  const senseRequired = ["lang", "term", "definition"];
  const readingSchema = { type: ["string", "null"] };
  const readingSystemSchema = { type: ["string", "null"] };
  const pronunciationSchema = { type: ["string", "null"] };
  const pronunciationSystemSchema = { type: ["string", "null"] };

  if (lang === "zh" || lang === "ja") {
    senseRequired.push("reading", "reading_system");
    readingSchema.type = "string";
    readingSchema.minLength = 1;
    readingSystemSchema.type = "string";
    readingSystemSchema.minLength = 1;
  }
  if (lang === "en" || lang === "pt-BR") {
    senseRequired.push("pronunciation", "pronunciation_system");
    pronunciationSchema.type = "string";
    pronunciationSchema.minLength = 1;
    pronunciationSystemSchema.type = "string";
    pronunciationSystemSchema.minLength = 1;
  }

  return {
    type: "object",
    required: ["sense_localization", "example_localizations"],
    properties: {
      sense_localization: {
        type: "object",
        required: senseRequired,
        properties: {
          lang: { const: lang },
          term: { type: "string", minLength: 1 },
          reading: readingSchema,
          reading_system: readingSystemSchema,
          pronunciation: pronunciationSchema,
          pronunciation_system: pronunciationSystemSchema,
          definition: { type: "string", minLength: 1 },
          usage_note: { type: ["string", "null"] }
        }
      },
      example_localizations: {
        type: "array",
        items: {
          type: "object",
          required: ["example_id", "lang", "text"],
          properties: {
            example_id: { type: "number" },
            lang: { const: lang },
            text: { type: "string", minLength: 1 },
            reading: { type: ["string", "null"] }
          }
        }
      }
    }
  };
}

function loadTasks() {
  if (fixtureMode === "builtin") return builtinTasks().slice(0, jobLimit || undefined);
  if (fixtureMode !== "builtin" && fs.existsSync(dbPath)) {
    const dbTasks = loadTasksFromDb();
    if (dbTasks.length || fixtureMode === "db") return dbTasks;
  }
  return builtinTasks().slice(0, jobLimit || undefined);
}

function loadTasksFromDb() {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `
        SELECT id, target_id, lang, input_json
        FROM llm_completion_jobs
        WHERE target_type = 'sense_localization'
          AND status = 'queued'
        ORDER BY lang, id
        LIMIT ?
      `
      )
      .all(jobLimit || 3);

    return rows.map((row) => {
      const input = JSON.parse(row.input_json);
      return {
        id: `job:${row.id}`,
        target_lang: row.lang,
        entry: input.entry,
        input
      };
    });
  } finally {
    db.close();
  }
}

function builtinTasks() {
  return [
    buildBuiltinTask({
      id: "builtin:bank:zh",
      target_lang: "zh",
      word: "bank",
      source_lang: "en",
      part_of_speech: "noun",
      gloss_key: "financial institution",
      known: {
        en: {
          lang: "en",
          term: "bank",
          pronunciation: "/baenk/",
          pronunciation_system: "IPA",
          definition: "A financial institution that accepts deposits and lends money."
        }
      },
      examples: [{ id: 1, source_text: "She opened a savings account at the bank." }]
    }),
    buildBuiltinTask({
      id: "builtin:serene:ja",
      target_lang: "ja",
      word: "serene",
      source_lang: "en",
      part_of_speech: "adjective",
      gloss_key: "calm and peaceful",
      known: {
        en: {
          lang: "en",
          term: "serene",
          pronunciation: "/səˈriːn/",
          pronunciation_system: "IPA",
          definition: "Calm, peaceful, and untroubled."
        }
      },
      examples: [{ id: 1, source_text: "The lake looked serene at sunrise." }]
    }),
    buildBuiltinTask({
      id: "builtin:公园:pt-BR",
      target_lang: "pt-BR",
      word: "公园",
      source_lang: "zh",
      part_of_speech: "noun",
      gloss_key: "public park",
      known: {
        zh: {
          lang: "zh",
          term: "公园",
          reading: "gong1 yuan2",
          reading_system: "pinyin",
          definition: "供公众游览、休息和进行户外活动的绿地或开放空间。"
        },
        en: {
          lang: "en",
          term: "park",
          pronunciation: "/pɑːrk/",
          pronunciation_system: "IPA",
          definition: "A public green area used for recreation."
        }
      },
      examples: [{ id: 1, source_text: "孩子们在公园里玩。" }]
    })
  ];
}

function buildBuiltinTask({ id, target_lang, word, source_lang, part_of_speech, gloss_key, known, examples }) {
  const input = {
    task: "complete_missing_sense_localization",
    target_lang,
    requirements: {
      preserve_existing_languages: true,
      complete_only_target_lang: true,
      output_json_only: true,
      use_brazilian_portuguese_for_pt_BR: target_lang === "pt-BR",
      include_reading: target_lang === "zh" || target_lang === "ja",
      include_pronunciation: target_lang === "en" || target_lang === "pt-BR",
      avoid_adding_new_senses: true
    },
    entry: {
      id: 0,
      word,
      normalized_key: word.toLocaleLowerCase(),
      source_lang
    },
    sense: {
      id: 0,
      sense_order: 1,
      part_of_speech,
      domain: null,
      register_label: null,
      gloss_key,
      source: "benchmark-fixture",
      confidence: 0.9
    },
    known_localizations: known,
    examples,
    expected_output_schema: outputSchema(target_lang)
  };

  return { id, target_lang, entry: input.entry, input };
}

function parseJson(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("empty model content");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("content is not JSON");
  }
}

function validate(value, task) {
  const errors = [];
  let score = 0;
  const maxScore = 10;
  const loc = value?.sense_localization;

  if (loc && typeof loc === "object") score += 1;
  else errors.push("missing sense_localization object");

  if (loc?.lang === task.target_lang) score += 1;
  else errors.push(`lang must be ${task.target_lang}`);

  if (nonEmpty(loc?.term)) score += 1;
  else errors.push("missing term");

  if (nonEmpty(loc?.definition)) score += 1;
  else errors.push("missing definition");

  if (task.target_lang === "zh" || task.target_lang === "ja") {
    if (nonEmpty(loc?.reading)) score += 1;
    else errors.push("missing reading");
    if (task.target_lang === "zh" && containsCjk(loc?.term)) score += 1;
    else if (task.target_lang === "ja" && containsJapanese(loc?.term + loc?.reading)) score += 1;
    else errors.push("target script does not look right");
  } else {
    if (nonEmpty(loc?.pronunciation)) score += 1;
    else errors.push("missing pronunciation");
    if (containsLatin(loc?.term)) score += 1;
    else errors.push("target term does not look Latin-script");
  }

  if (definitionLanguageLooksRight(loc?.definition, task.target_lang)) score += 1;
  else errors.push("definition language looks suspicious");

  if (Array.isArray(value?.example_localizations)) score += 1;
  else errors.push("missing example_localizations array");

  const firstExample = value?.example_localizations?.[0];
  if (firstExample?.lang === task.target_lang && nonEmpty(firstExample?.text)) score += 1;
  else errors.push("missing localized example text");

  if (!hasUnexpectedTopLevelKeys(value)) score += 1;
  else errors.push("unexpected top-level keys");

  return { score, max_score: maxScore, errors };
}

function summarize(rows) {
  const byModel = new Map();
  for (const row of rows) {
    if (!byModel.has(row.model)) byModel.set(row.model, []);
    byModel.get(row.model).push(row);
  }

  const summary = [...byModel.entries()].map(([model, modelRows]) => {
    const completed = modelRows.filter((row) => Number.isFinite(row.seconds));
    const avgSeconds = average(completed.map((row) => row.seconds));
    const avgScore = average(modelRows.map((row) => row.score));
    const okCount = modelRows.filter((row) => row.ok).length;
    return {
      model,
      task_count: modelRows.length,
      ok_count: okCount,
      json_ok_count: modelRows.filter((row) => row.response).length,
      avg_seconds: round(avgSeconds),
      avg_score: round(avgScore),
      score_per_second: avgSeconds > 0 ? round(avgScore / avgSeconds) : 0,
      failures: modelRows.filter((row) => !row.ok).map((row) => ({
        task_id: row.task_id,
        target_lang: row.target_lang,
        errors: row.errors
      }))
    };
  });

  summary
    .sort((a, b) => b.avg_score - a.avg_score || a.avg_seconds - b.avg_seconds)
    .forEach((row, index) => {
      row.rank = index + 1;
    });

  return summary.sort((a, b) => a.rank - b.rank);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function round(value) {
  return Number(value.toFixed(2));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function containsJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || ""));
}

function containsLatin(value) {
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(String(value || ""));
}

function definitionLanguageLooksRight(value, lang) {
  const text = String(value || "");
  if (lang === "zh") return containsCjk(text);
  if (lang === "ja") return containsJapanese(text);
  if (lang === "pt-BR") return containsLatin(text) && /\b(de|para|que|um|uma|o|a|em|por)\b/i.test(text);
  if (lang === "en") return containsLatin(text);
  return false;
}

function hasUnexpectedTopLevelKeys(value) {
  const allowed = new Set(["sense_localization", "example_localizations"]);
  return Object.keys(value || {}).some((key) => !allowed.has(key));
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) i++;
  }
  return result;
}
