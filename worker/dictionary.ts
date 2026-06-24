import { normalizeExamples, normalizeStringOrText } from "./normalization";
import type {
  DisplayLanguageCode,
  Env,
  LanguageCode,
  LocalizedText,
  WordExample,
  WordDetail,
  WordPronunciationGroup,
  WordResponse,
  WordSense
} from "./types";

type V2WordSense = WordSense & { examples: WordExample[] };
type DictionaryLookupInput = {
  env: Env;
  text: string;
  targetLang: LanguageCode;
  sourceLang?: LanguageCode | "auto";
};

export interface DictionaryAdapter {
  name: string;
  lookup(input: DictionaryLookupInput): Promise<WordResponse | null>;
}

export class CloudflareD1V2Adapter implements DictionaryAdapter {
  name = "cloudflare-d1-v2";

  async lookup(input: DictionaryLookupInput): Promise<WordResponse | null> {
    if (!input.env.DB) return null;

    const normalized = normalizeDictionaryKey(input.text);
    const preferredSourceLang = preferredDictionarySourceLang(input.text, input.targetLang, input.sourceLang);

    try {
      const sql = `
        WITH matched_entries AS (
          SELECT id, matched_lang
          FROM (
            SELECT e.id, e.source_lang, e.source_lang AS matched_lang, 0 AS match_rank, e.frequency_rank
            FROM v2_entries e
            WHERE e.normalized_key = ? OR lower(e.word) = ?
            UNION
            SELECT e.id, e.source_lang, ef.lang AS matched_lang, 1 AS match_rank, e.frequency_rank
            FROM v2_entries e
            JOIN v2_entry_forms ef ON ef.entry_id = e.id
            WHERE ef.normalized_form = ?
            UNION
            SELECT e.id, e.source_lang, sl.lang AS matched_lang, 2 AS match_rank, e.frequency_rank
            FROM v2_entries e
            JOIN v2_senses s_match ON s_match.entry_id = e.id
            JOIN v2_sense_localizations sl ON sl.sense_id = s_match.id
            WHERE lower(sl.term) = ? OR sl.normalized_term = ?
          )
          ORDER BY
            match_rank,
            CASE WHEN source_lang = ? THEN 0 ELSE 1 END,
            CASE WHEN matched_lang = ? THEN 0 ELSE 1 END,
            frequency_rank IS NULL,
            frequency_rank,
            id
          LIMIT 1
        ),
        base_entry AS (
          SELECT e.*, me.matched_lang
          FROM v2_entries e
          JOIN matched_entries me ON me.id = e.id
        ),
        selected_entries AS (
          SELECT e2.id
          FROM v2_entries e2
          CROSS JOIN base_entry b
          WHERE e2.normalized_key = b.normalized_key
            AND e2.source_lang = b.source_lang
        )
        SELECT json_object(
          'id', e.id,
          'word', e.word,
          'normalized_key', e.normalized_key,
          'source_lang', e.source_lang,
          'matched_lang', e.matched_lang,
          'frequency_rank', e.frequency_rank,
          'senses', (
            SELECT json_group_array(json_object(
              'id', s.id,
              'sense_order', s.publish_sense_order,
              'part_of_speech', s.part_of_speech,
              'domain', s.domain,
              'register_label', s.register_label,
              'gloss_key', s.gloss_key,
              'pronunciation_group', CASE WHEN s.pronunciation_group_id IS NOT NULL THEN json_object(
                'id', s.pronunciation_group_id,
                'lang', s.group_lang,
                'reading', s.group_reading,
                'reading_key', s.group_reading_key,
                'reading_system', s.group_reading_system
              ) ELSE NULL END,
              'localizations', (
                SELECT json_group_object(sl.lang, json_object(
                  'term', sl.term,
                  'reading', sl.reading,
                  'reading_system', sl.reading_system,
                  'pronunciation', sl.pronunciation,
                  'pronunciation_system', sl.pronunciation_system,
                  'definition', sl.definition,
                  'usage_note', sl.usage_note
                ))
                FROM v2_sense_localizations sl
                WHERE sl.sense_id = s.id
              ),
              'examples', (
                SELECT json_group_array(json_object(
                  'id', ex.id,
                  'example_order', ex.example_order,
                  'source_lang', ex.source_lang,
                  'source_text', ex.source_text,
                  'source_reading', ex.source_reading,
                  'localizations', (
                    SELECT json_group_object(el.lang, json_object(
                      'text', el.text,
                      'reading', el.reading
                    ))
                    FROM v2_example_localizations el
                    WHERE el.example_id = ex.id
                  )
                ))
                FROM v2_examples ex
                WHERE ex.sense_id = s.id
              )
            ))
            FROM (
              SELECT s.*,
                ROW_NUMBER() OVER (
                  ORDER BY
                    COALESCE(g.display_order, s.sense_order),
                    s.sense_order,
                    s.id
                ) AS publish_sense_order,
                COALESCE(g.display_order, s.sense_order) AS group_display_order,
                g.lang AS group_lang,
                g.reading AS group_reading,
                g.reading_key AS group_reading_key,
                g.reading_system AS group_reading_system
              FROM v2_senses s
              LEFT JOIN v2_pronunciation_groups g ON g.id=s.pronunciation_group_id
              WHERE s.entry_id IN (SELECT id FROM selected_entries)
              ORDER BY
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM v2_sense_localizations sl_order
                  WHERE sl_order.sense_id = s.id
                    AND (lower(sl_order.term) = ? OR sl_order.normalized_term = ?)
                ) THEN 0 ELSE 1 END,
                COALESCE(g.display_order, s.sense_order),
                s.sense_order,
                s.id
              LIMIT 8
            ) s
          )
        ) AS data
        FROM base_entry e
        ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id
        LIMIT 1
      `;

      const row = await input.env.DB.prepare(sql)
        .bind(
          normalized,
          normalized,
          normalized,
          normalized,
          normalized,
          preferredSourceLang,
          preferredSourceLang,
          normalized,
          normalized
        )
        .first<{ data: string }>();

      if (!row?.data) return null;
      const entry = parseJsonValue(row.data) as Record<string, unknown>;
      const parsedSenses = parseJsonValue(entry.senses);
      const senses = Array.isArray(parsedSenses) ? parsedSenses : [];
      if (senses.length === 0) return null;
      entry.senses = senses;

      console.log("D1 v2 Dictionary hit for", input.text);
      return v2DictionaryEntryToResponse(entry, input.text, input.targetLang);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("no such table: v2_entries")) return null;
      console.error("D1 v2 lookup error:", err);
      return null;
    }
  }
}

export class CloudflareD1Adapter implements DictionaryAdapter {
  name = "cloudflare-d1";

  async lookup(input: DictionaryLookupInput): Promise<WordResponse | null> {
    if (!input.env.DB) return null;

    try {
      const sql = `
        SELECT json_object(
          'source_lang', e.source_lang,
          'senses', (
            SELECT json_group_array(json_object(
              'sense_order', s.sense_order,
              'part_of_speech', s.pos,
              'gloss_key', s.gloss,
              'pronunciation', s.pronunciation,
              'definitions', (
                SELECT json_group_object(d.lang, d.translation)
                FROM definitions d WHERE d.sense_id = s.id
              )
            ))
            FROM senses s WHERE s.entry_id = e.id
          ),
          'examples', (
            SELECT json_group_array(json_object(
              'sense_order', s.sense_order,
              'sentence', ex.source_sentence,
              'translations', json_object(
                'zh', ex.translation_zh,
                'en', ex.translation_en,
                'ja', ex.translation_ja,
                'pt-BR', ex.translation_pt
              )
            ))
            FROM examples ex 
            INNER JOIN senses s ON ex.sense_id = s.id 
            WHERE s.entry_id = e.id
          )
        ) as data
        FROM entries e
        WHERE e.word = ?
      `;

      const row = await input.env.DB.prepare(sql).bind(input.text).first<{ data: string }>();
      
      if (!row || !row.data || row.data === '{}' || row.data.includes('"senses":[]')) {
        return null;
      }

      const entry = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      
      // Build translations from senses data
      // gloss_key is the full English definition (e.g. "to extend; to spread")
      // definitions contain per-language translations (en is just a keyword, not useful)
      entry.translations = {};
      
      if (entry.senses && entry.senses.length > 0) {
        // Use the first sense's gloss as the primary English translation
        const firstGloss = entry.senses[0].gloss_key || "";
        entry.translations.en = { text: firstGloss, phonetic: "", audio_text: "" };
        
        // For zh, ja, pt-BR: aggregate from definitions across all senses
        ['zh', 'ja', 'pt-BR'].forEach((lang: string) => {
          const texts: string[] = [];
          for (const sense of entry.senses) {
            const defs = sense.definitions || {};
            if (defs[lang] && !texts.includes(defs[lang])) {
              texts.push(defs[lang]);
            }
          }
          if (texts.length > 0) {
            entry.translations[lang] = { text: texts.join("; "), phonetic: "", audio_text: "" };
          }
        });
        
        // Also enrich senses definitions with gloss as English definition
        for (const sense of entry.senses) {
          if (!sense.definitions) sense.definitions = {};
          sense.definitions.en = sense.gloss_key || sense.definitions.en || "";
        }
      }

      console.log("D1 Dictionary hit for", input.text);
      return dictionaryEntryToResponse(entry, input.text, input.targetLang);
    } catch (err) {
      console.error("D1 lookup error:", err);
      return null;
    }
  }
}

export class LouisSQLiteAdapter implements DictionaryAdapter {
  name = "louis-sqlite";

  async lookup(input: DictionaryLookupInput): Promise<WordResponse | null> {
    if (!input.env.DICTIONARY_API_URL || !input.env.DICTIONARY_API_TOKEN) return null;

    try {
      const url = new URL("/api/dictionary/lookup", input.env.DICTIONARY_API_URL);
      url.searchParams.set("term", input.text);
      const token = input.env.DICTIONARY_API_TOKEN;
      console.log("Fetching URL:", url.toString());
      const response = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`
        },
        signal: AbortSignal.timeout(1800)
      });

      if (!response.ok) {
        console.error("Dictionary API returned not ok:", response.status, await response.text());
        return null;
      }
      const payload = (await response.json()) as { entries?: Array<Record<string, unknown>> };
      const entry = payload.entries?.[0];
      if (!entry) {
        console.log("No entry found for", input.text);
        return null;
      }
      console.log("Dictionary hit for", input.text);
      return dictionaryEntryToResponse(entry, input.text, input.targetLang);
    } catch (err) {
      console.error("Fetch error:", err);
      return null;
    }
  }
}

export class MockJMDictAdapter implements DictionaryAdapter {
  name = "mock-jmdict";

  async lookup(input: DictionaryLookupInput): Promise<WordResponse | null> {
    // Only return mock data if translating 'hello' to Japanese to simulate an external JMDict response
    if (input.text.toLowerCase() === "hello" && input.targetLang === "ja") {
      return {
        detected_source_lang: "en",
        target_lang: "ja",
        original: "hello",
        translation: "こんにちは",
        translations: {
          ja: { text: "こんにちは", phonetic: "konnichiwa", audio_text: "こんにちは" },
          zh: { text: "你好", phonetic: "ni hao", audio_text: "你好" },
          en: { text: "hello", phonetic: "/həˈloʊ/", audio_text: "hello" },
          "pt-BR": { text: "olá", phonetic: "o-LA", audio_text: "olá" }
        },
        provider: "dictionary",
        model: "mock-jmdict",
        cached: false,
        cache_hit: false,
        type: "word",
        phonetic: "konnichiwa",
        audio_text: "こんにちは",
        examples: [
          {
            sentence: "Hello, how are you today?",
            translations: {
              ja: "こんにちは、今日は調子はどうですか。",
              zh: "你好，今天感觉怎么样？",
              en: "Hello, how are you today?",
              "pt-BR": "Olá, como você está hoje?"
            }
          }
        ],
        senses: [
          {
            sense_order: 1,
            part_of_speech: "interjection (from JMDict)",
            gloss_key: "greeting",
            definitions: {
              ja: "日中に人に会った時の挨拶。",
              zh: "见面时使用的问候语。",
              en: "Used as a greeting.",
              "pt-BR": "Usado como saudação."
            }
          }
        ],
        word_details: {
          ja: { word: "こんにちは", definition: "日中に人に会った時の挨拶。" },
          zh: { word: "你好", definition: "见面时使用的问候语。" },
          en: { word: "hello", definition: "Used as a greeting." },
          "pt-BR": { word: "olá", definition: "Usado como saudação." }
        }
      };
    }
    return null;
  }
}

export class CompositeDictionaryManager {
  private adapters: DictionaryAdapter[] = [];

  constructor() {
    this.adapters.push(new CloudflareD1V2Adapter());
  }

  async lookupAll(input: DictionaryLookupInput): Promise<WordResponse | null> {
    if (!isDictionaryLookupCandidate(input.text)) return null;

    const adapters = [...this.adapters];
    if (input.env.DICTIONARY_ENABLE_LEGACY_SOURCES === "true") {
      adapters.push(new CloudflareD1Adapter(), new LouisSQLiteAdapter(), new MockJMDictAdapter());
    }

    const results = await Promise.all(adapters.map(adapter => adapter.lookup(input)));
    const validResults = results.filter((res): res is WordResponse => res !== null);

    if (validResults.length === 0) return null;

    // Merge strategy:
    // We use the first result as the "base" response, and append senses/examples from others.
    const base = validResults[0];

    for (let i = 1; i < validResults.length; i++) {
      const additional = validResults[i];
      // Merge examples
      if (additional.examples) {
        base.examples = [...(base.examples || []), ...additional.examples];
      }
      // Merge senses
      if (additional.senses) {
        base.senses = [...(base.senses || []), ...additional.senses];
      }
      // If we want to enrich phonetic or translations, we could do that here too.
    }

    base.model = validResults.map(r => r.model).join(" + ");
    return base;
  }
}

const dictionaryManager = new CompositeDictionaryManager();

export async function lookupDictionaryFirst(input: {
  env: Env;
  text: string;
  targetLang: LanguageCode;
  sourceLang?: LanguageCode | "auto";
}): Promise<WordResponse | null> {
  return dictionaryManager.lookupAll(input);
}

export async function fetchDictionaryStats(env: Env): Promise<Record<string, unknown>> {
  if (env.DB) {
    try {
      const stats = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM v2_entries) AS entries,
          (SELECT COUNT(*) FROM v2_senses) AS senses,
          (SELECT COUNT(*) FROM v2_sense_localizations) AS sense_localizations,
          (SELECT COUNT(*) FROM v2_examples) AS examples,
          (SELECT COUNT(*) FROM v2_example_localizations) AS example_localizations,
          (SELECT value FROM v2_meta WHERE key = 'published_at') AS published_at,
          (SELECT value FROM v2_meta WHERE key = 'policy') AS policy
      `).first<Record<string, unknown>>();
      if (stats) {
        return {
          source: "cloudflare-d1-v2",
          ...stats
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("no such table: v2_entries")) {
        console.error("D1 v2 stats error:", err);
      }
    }
  }

  if (!env.DICTIONARY_API_URL || !env.DICTIONARY_API_TOKEN) {
    throw new Error("dictionary API is not configured");
  }

  const url = new URL("/api/dictionary/stats", env.DICTIONARY_API_URL);
  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${env.DICTIONARY_API_TOKEN}`
    },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) throw new Error(`dictionary stats failed: ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

function dictionaryEntryToResponse(
  entry: Record<string, unknown>,
  original: string,
  targetLang: LanguageCode
): WordResponse {
  const translations = normalizeDictionaryTranslations(entry.translations, entry.pronunciations);
  const senses = normalizeDictionarySenses(entry.senses);
  const firstSense = senses[0] || null;
  const definitions =
    firstSense?.definitions || {};
  const targetText = translations[targetLang]?.text || translations.en?.text || original;

  return {
    detected_source_lang: String(entry.source_lang || "auto"),
    target_lang: targetLang,
    original,
    translation: targetText,
    translations,
    provider: "dictionary",
    model: "louis-sqlite",
    cached: false,
        cache_hit: false,
    type: "word",
    phonetic: translations[String(entry.source_lang || "en") as LanguageCode]?.phonetic || "",
    audio_text: original,
    examples: normalizeExamples(entry.examples),
    senses,
    word_details: {
      zh: dictionaryWordDetail(translations.zh?.text, definitions.zh),
      en: dictionaryWordDetail(translations.en?.text, definitions.en),
      "pt-BR": dictionaryWordDetail(translations["pt-BR"]?.text, definitions["pt-BR"]),
      ja: dictionaryWordDetail(translations.ja?.text, definitions.ja)
    }
  };
}

function v2DictionaryEntryToResponse(
  entry: Record<string, unknown>,
  original: string,
  targetLang: LanguageCode
): WordResponse {
  const parsedSenses = parseJsonValue(entry.senses);
  const rawSenses = Array.isArray(parsedSenses) ? (parsedSenses as Array<Record<string, unknown>>) : [];
  const senses = rawSenses.map((sense, index) => normalizeV2Sense(sense, index));
  const firstSense = senses[0] || null;
  const translations = v2PrimaryTranslations(senses);
  const pronunciationGroups = v2PronunciationGroups(senses, String(entry.word || original));
  const targetText =
    translations[targetLang]?.text ||
    translations[String(entry.source_lang || "en") as LanguageCode]?.text ||
    translations.en?.text ||
    String(entry.word || original);

  const examples = dedupeV2Examples(senses.flatMap((sense) => sense.examples));

  return {
    detected_source_lang: String(entry.matched_lang || entry.source_lang || "auto"),
    target_lang: targetLang,
    original,
    translation: targetText,
    translations,
    provider: "dictionary",
    model: "cloudflare-d1-v2",
    cached: false,
        cache_hit: false,
    type: "word",
    phonetic: translations[String(entry.matched_lang || entry.source_lang || "en") as LanguageCode]?.phonetic || "",
    audio_text: translations[String(entry.matched_lang || entry.source_lang || "en") as LanguageCode]?.audio_text || String(entry.word || original),
    examples,
    senses,
    pronunciation_groups: pronunciationGroups,
    word_details: {
      zh: dictionaryWordDetail(translations.zh?.text, firstSense?.definitions.zh),
      en: dictionaryWordDetail(translations.en?.text, firstSense?.definitions.en),
      "pt-BR": dictionaryWordDetail(translations["pt-BR"]?.text, firstSense?.definitions["pt-BR"]),
      ja: dictionaryWordDetail(translations.ja?.text, firstSense?.definitions.ja)
    }
  };
}

function v2PronunciationGroups(senses: V2WordSense[], headword: string): WordPronunciationGroup[] {
  const groups: WordPronunciationGroup[] = [];
  const groupIndex = new Map<string, WordPronunciationGroup>();
  const ungroupedKey = "__ungrouped";

  for (const sense of senses) {
    const group = sense.pronunciation_group;
    const key = group?.reading_key || group?.reading || ungroupedKey;
    let item = groupIndex.get(key);
    if (!item) {
      item = {
        lang: group?.lang || "",
        reading: group?.reading || "",
        reading_key: group?.reading_key || key,
        reading_system: group?.reading_system || "",
        group_order: groups.length + 1,
        audio_text: headword,
        senses: []
      };
      groupIndex.set(key, item);
      groups.push(item);
    }
    item.senses.push(sense);
  }

  return groups;
}

function normalizeV2Sense(sense: Record<string, unknown>, index: number): V2WordSense {
  const localizations = normalizeV2Localizations(sense.localizations);
  const definitions = {
    zh: normalizeStringOrText(localizations.zh?.definition),
    en: normalizeStringOrText(localizations.en?.definition),
    "pt-BR": normalizeStringOrText(localizations["pt-BR"]?.definition),
    ja: normalizeStringOrText(localizations.ja?.definition)
  };
  const examples = normalizeV2Examples(sense.examples);
  const senseOrder = Number(sense.sense_order || index + 1);

  return {
    sense_order: Number.isFinite(senseOrder) && senseOrder > 0 ? senseOrder : index + 1,
    part_of_speech: normalizeStringOrText(sense.part_of_speech),
    gloss_key: normalizeStringOrText(sense.gloss_key),
    pronunciation_group: normalizeV2PronunciationGroup(sense.pronunciation_group),
    domain: normalizeStringOrText(sense.domain),
    register_label: normalizeStringOrText(sense.register_label),
    definitions,
    localizations,
    examples
  };
}

function normalizeV2PronunciationGroup(value: unknown): WordSense["pronunciation_group"] {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== "object") return undefined;
  const source = parsed as Record<string, unknown>;
  const reading = normalizeStringOrText(source.reading);
  const readingKey = normalizeStringOrText(source.reading_key);
  if (!reading && !readingKey) return undefined;
  return {
    lang: normalizeStringOrText(source.lang),
    reading,
    reading_key: readingKey,
    reading_system: normalizeStringOrText(source.reading_system)
  };
}

function normalizeV2Localizations(value: unknown): NonNullable<WordSense["localizations"]> {
  const parsed = parseJsonValue(value);
  const source = parsed && typeof parsed === "object" ? (parsed as Record<string, Record<string, unknown>>) : {};
  const output: NonNullable<WordSense["localizations"]> = {};

  for (const lang of ["zh", "en", "pt-BR", "ja"] as const) {
    const item = source[lang];
    if (!item || typeof item !== "object") continue;
    output[lang] = {
      term: normalizeStringOrText(item.term),
      reading: normalizeStringOrText(item.reading),
      reading_system: normalizeStringOrText(item.reading_system),
      pronunciation: normalizeStringOrText(item.pronunciation),
      pronunciation_system: normalizeStringOrText(item.pronunciation_system),
      definition: normalizeStringOrText(item.definition),
      usage_note: normalizeStringOrText(item.usage_note)
    };
  }

  return output;
}

function normalizeV2Examples(value: unknown): WordExample[] {
  const parsed = parseJsonValue(value);
  const items = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];

  return items.map((example) => {
    const localizations = normalizeV2ExampleLocalizations(example.localizations);
    return {
      sentence: normalizeStringOrText(example.source_text),
      source_lang: normalizeStringOrText(example.source_lang),
      source_reading: normalizeStringOrText(example.source_reading),
      translations: {
        zh: normalizeStringOrText(localizations.zh?.text),
        en: normalizeStringOrText(localizations.en?.text),
        "pt-BR": normalizeStringOrText(localizations["pt-BR"]?.text),
        ja: normalizeStringOrText(localizations.ja?.text)
      },
      localizations
    };
  });
}

function dedupeV2Examples(examples: WordExample[]): WordExample[] {
  const seen = new Map<string, number>();
  const output: WordExample[] = [];

  for (const example of examples) {
    const key =
      [
        example.localizations?.en?.text,
        example.localizations?.["pt-BR"]?.text,
        example.localizations?.ja?.text
      ]
        .map((value) => normalizeDictionaryKey(value || ""))
        .filter(Boolean)
        .join("|") || normalizeDictionaryKey(example.sentence);

    if (!key) continue;
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, output.length);
      output.push(example);
      continue;
    }

    if (simplifiedChineseScore(example) > simplifiedChineseScore(output[existingIndex])) {
      output[existingIndex] = example;
    }
  }

  return output;
}

function simplifiedChineseScore(example: WordExample): number {
  const text = `${example.sentence || ""} ${example.localizations?.zh?.text || ""}`;
  return countChars(text, SIMPLIFIED_HINT_CHARS) - countChars(text, TRADITIONAL_HINT_CHARS);
}

function countChars(value: string, chars: string): number {
  let count = 0;
  for (const char of value) {
    if (chars.includes(char)) count++;
  }
  return count;
}

const SIMPLIFIED_HINT_CHARS =
  "瑙佷滑涓滀涪涓や弗涓т釜涓颁复涓轰附涓句箟涔屼箰涔斾範涔′功涔颁贡浜変簬浜忎簯浜氫骇浜╀翰浜典嚎浠呬粠浠戜粨浠滑浠蜂紬浼樹紮浼氫紴浼熶紶浼や鸡浼綋浣欎剑浣ヤ緺渚ｄ茎渚︿晶渚ㄤ京渚粳淇ｄ喀淇ㄤ咯淇凯鍊哄€惧伂鍋诲伨鍋垮偉鍌у偍鍌╁効鍏戝厲鍏板叧鍏村吇鍏藉唩鍐呭唸鍐屽啓鍐涘啘鍐啿鍐冲喌鍐诲噣鍑夊噺鍑戝嚊鍑犲嚖鍑嚟鍑嚮鍑煎嚳鍒嶅垬鍒欏垰鍒涘垹鍒埇鍒埞鍒藉埧鍓€鍓傚墣鍓戝墺鍓у姖鍔炲姟鍔ㄥ姳鍔插姵鍔垮媼鍕愬嫐鍖€鍖﹀尞鍖哄尰鍗庡崗鍗曞崠鍗㈠崵鍗嵈鍘傚巺鍘嗗帀鍘嬪帉鍘嶅帟鍘㈠帲鍘﹀帹鍘╁幙鍙傚弻鍙戝彉鍙欏彔鍙跺彿鍙瑰徑鍚佸悗鍚撳悤鍚楀惃鍚惎鍚村憪鍛掑憮鍛曞憱鍛楀憳鍛欏憶鍛滃拸鍜欏挍鍜濆挙鍝嶅搼鍝掑摀鍝斿摃鍝楀摍鍝滃摑鍝熷敍鍞犲敘鍞ゅ暓鍟暛鍟暟鍟村暩鍠峰柦鍠惧棲鍡冲槝鍢ゅ槺鍣滃殻鍥㈠洯鍥卞洿鍥靛浗鍥惧渾鍦ｅ湽鍦哄潅鍧忓潡鍧氬潧鍧滃潩鍧炲潫鍧犲瀯鍨呭瀱鍨掑灕鍨╁灚鍨灟鍨卞灢鍨村煒鍩欏煔鍩爲鍫曞澧欏．澹板３澹跺澶囧澶熷ご澶瑰ず濂佸濂嬪濂ュ濡囧濡╁Κ濡濮滃▌濞呭▎濞囧▓濞卞ú濞村┏濠村┑濠跺瀚掑珨瀚卞瀛欏瀛畞瀹濆疄瀹犲瀹瀹藉瀵濆瀵诲瀵垮皢灏斿皹灏濆哀灏村案灏藉眰灞冨眽灞婂睘灞″宝灞垮瞾宀傚矕宀楀矘宀欏矚宀涘箔宀冲步宀垮硟宄″长宄ュ肠宕傚磧宕勫喘宓樺禋宓濆穮宸╁矾甯佸竻甯堝笍甯愬笜甯滃甫甯у府甯卞富甯煎箓搴勫簡搴愬簯搴撳簲搴欏簽搴熷杭寤紑寮傚純寮犲讥寮集寮瑰己褰掑綋褰曞綕褰﹀交寰勫緯蹇嗗繌蹇у烤鎬€鎬佹€傛€冩€勬€呮€嗘€滄€绘€兼€挎亱鎭掓伋鎭舵伕鎭规伜鎭绘伡鎭芥偊鎮偔鎮儕鎯ф儴鎯╂儷鎯儹鎯儻鎰犳劋鎰︽効鎱戞噾鎳掓嚁鎴嗘垕鎴忔垪鎴樻埇鎴锋墡鎵戞墭鎵ф墿鎵壂鎵壈鎶氭姏鎶熸姞鎶℃姠鎶ゆ姤鎷呮嫙鎷㈡嫞鎷ユ嫤鎷ф嫧鎷╂寕鎸氭寷鎸滄対鎸炴専鎸犳尅鎸㈡專鎸ゆ尌鎸︽崬鎹熸崱鎹㈡崳鎹嵒鎺虫幋鎺锋幐鎺烘徑鎻挎悁鎼佹悅鎼呮惡鎽勬憛鎽嗘憞鎽堟憡鎾勬拺鎾垫挿鎾告捄鎿炴敀鏁屾暃鏁版枊鏂撴枟鏂╂柇鏃犳棫鏃舵椃鏃告槞鏄兼樉鏅嬫檼鏅撴檾鏅曟櫀鏆傛毀鏈満鏉€鏉傛潈鏉℃潵鏉ㄦ澃鏋佹瀯鏋炴灑鏋ｆ灔鏋ф灗鏋灚鏋煖鏌犳熃鏍€鏍呮爣鏍堟爥鏍婃爧鏍屾爭鏍忔爲鏍栨牱鏍炬妗℃、妗ｆ·妗ユˇ妗ф〃妗╂ⅵ姊兼⒕妫€妫傛妞熸妞ゆき妤兼姒呮姒堟妲氭妲熸妯ǒ妯辨━姗辨┕姗兼娆㈡娆ф娈佹畤娈嬫畳娈撴畾娈℃姣佹瘋姣曟瘷姣℃姘囨皵姘㈡癌姘叉眹姹夋薄姹ゆ惫娌熸病娌ｆ菠娌ユ拨娌ф勃娉炴唱娉舵撤娉告澈娉绘臣娉芥尘娲佹磼娲兼祪娴呮祮娴囨祱娴婃祴娴嶆祹娴忔祼娴戞祾娴撴禂娑涙稘娑炴稛娑犳丁娑㈡叮娑ゆ鼎娑ф定娑╂穩娓婃笇娓嶆笌娓愭笖娓栨笚娓╂咕婀挎簝婧呮簡婧囨粭婊氭粸婊熸粻婊℃虎婊ゆ互婊︽花婊╂华婕撴激娼嗘絿娼嬫綅娼滄酱婢滄繎婵掔亸鐏伅鐏电伨鐏跨個鐐夌倴鐐滅倽鐐圭偧鐐界儊鐑傜儍鐑涚儫鐑︾儳鐑ㄧ儵鐑儸鐑剷鐒栫剺鐓寸埍鐖风墠鐗︾壍鐗虹妸鐘剁姺鐘哥姽鐙堢嫗鐙嫮鐙嫰鐙扮嫳鐙茬寖鐚庣寱鐚＄尓鐚尙鐚嵀鐜戠帥鐜幆鐜扮幈鐜虹彁鐝戠彴鐝茬悘鐞愮惣鐟剁懛鐠庣搾鐡數鐢荤晠鐣寸枛鐤楃枱鐤犵枴鐤柈鐤柋鐤寸棃鐥夌棐鐥栫棬鐥棲鐦呯槜鐦樼槳鐦樉鐦跨櫈鐧ｇ櫕鐨戠毐鐨茬洀鐩愮洃鐩栫洍鐩樼湇鐪︾潃鐫佺潗鐫戠瀿鐬╃煫鐭剁熅鐭跨爛鐮佺爾鐮楃牃鐮滅牶鐮荤牼纭€纭佺纭栫纭欑纭》纰嶇纰滅⒈绀肩绁庣ア绁シ绁哥绂勭绂荤绉嗙绉О绉界Ь绋嗙◣绋ｇǔ绌戠┓绐冪獚绐戠獪绐濈绐︾绔栫珵绗冪瑡绗旂瑫绗虹绗剧瓚绛氱瓫绛滅瓭绛圭绠€绠撶绠х绠╃绠瘧绡撶绡辩皷绫佺贝绫荤奔绮滅矟绮ょ勃绮硜绯囩揣绲风簾绾犵孩绾ｇ氦绾︾骇绾ㄧ邯绾含绾函绾扮罕绾茬撼绾电憾绾风焊绾圭汉绾界壕绾跨粈缁佺粋缁冪粍缁呯粏缁囩粓缁夌粖缁嬬粚缁嶇粠缁忕粦缁掔粨缁旂粫缁栫粭缁樼粰缁氱粵缁滅粷缁炵粺缁犵弧缁㈢唬缁ょ互缁︾户缁╃华缁画缁化缁扮槐缁茬怀缁寸坏缁剁环缁哥还缁虹患缁界痪缁跨紑缂佺紓缂冪紕缂呯紗缂囩紙缂夌紛缂嬬紝缂嶇紟缂忕紣缂戠紥缂撶紨缂曠紪缂楃紭缂欑細缂涚紲缂濈紴缂熺紶缂＄饥缂ｇ激缂ョ鸡缂х绩缂╃吉缂棘缂籍缂及缂辩疾缂崇即缂电絺缃戠綏缃氱舰缃寸緛缇熺尽缈樼繖缈氳€ц€歌€昏亗鑱嬭亴鑱嶈仈鑱╄仾鑲冭偁鑲よ偖鑲磋偩鑲胯儉鑳佽儐鑳滆儳鑳ㄨ儶鑳兌鑴夎剭鑴忚剱鑴戣創鑴旇剼鑴辫劧鑴歌厞鑵岃厴鑵吇鑵艰吔鑵捐啈鑷滆垎鑸ｈ埌鑸辫埢鑹拌壋鑹鸿妭鑺堣姉鑺滆姦鑻佽媷鑻堣媼鑻岃媿鑻庤嫃鑻ц嫻鑼庤審鑼戣寯鑼曡導鑽嗚崘鑽欒崥鑽涜崪鑽炶崯鑽犺崱鑽ｈ崵鑽ヨ崷鑽ц崹鑽╄崻鑽崿鑽嵁鑽巺鑾辫幉鑾宠幋鑾惰幏鑾歌幑鑾鸿幖钀氳悵钀よ惀钀﹁惂钀ㄨ懕钂囪拤钂嬭拰钃濊摕钃犺摚钃ヨ摝钄疯敼钄鸿敿钑茶暣钖棑铇栬檹铏戣櫄铏櫖铏櫧铏捐櫩铓€铓佽殏铓曡毈铔婅泿铔忚洰铔拌洷铔茶洺铔磋湑铚楄湣铦囪潏铦夎潕铦艰澗铻€铻ㄨ煆琛呰琛ヨ〃琛‘琚勮琚嗚琚瑁呰瑁堣＂瑁ｈ￥瑁ヨ瑜磋瑗曡瑙傝瑙勮瑙嗚瑙堣瑙婅瑙岃瑙忚瑙戣瑙﹁Н瑭熻獕瑾婅疇璁¤璁ｈ璁ヨ璁ц璁╄璁璁璁拌璁宠璁佃璁疯璁硅璁艰璁捐璇€璇佽瘋璇冭瘎璇呰瘑璇囪瘓璇夎瘖璇嬭瘜璇嶈瘞璇忚瘧璇掕瘬璇旇瘯璇栬瘲璇樿瘷璇氳瘺璇滆瘽璇炶療璇犺璇㈣璇よ璇﹁璇ㄨ璇璇璇璇辫璇宠璇佃璇疯璇硅璇昏璇借璇胯皜璋佽皞璋冭皠璋呰皢璋堣皧璋嬭皩璋嶈皫璋忚皭璋戣皰璋撹皵璋曡皷璋楄皹璋欒皻璋涜皽璋濊盀璋熻盃璋¤阿璋ｈ挨璋ヨ唉璋ц皑璋╄蔼璋艾璋爱璋鞍璋辫安璋宠按璋佃胺璞礉璐炶礋璐¤储璐ｈ搐璐ヨ处璐ц川璐╄椽璐船璐串璐窗璐辫床璐宠创璐佃炊璐疯锤璐硅春璐昏醇璐借淳璐胯祤璧佽祩璧冭祫璧呰祮璧囪祱璧夎祳璧嬭祵璧嶈祹璧忚祼璧撹禂璧曡禆璧楄禈璧欒禋璧涜禍璧濊禐璧犺怠璧㈣担璧佃刀瓒嬭侗璺冭穭璺炶返璺惰贩璺歌饭璺昏笂韪岃釜韪腐韫戣箳韫拌箍韬忚簻韬溅杞ц建杞╄姜杞浆杞疆杞桨杞辫讲杞宠酱杞佃蕉杞疯礁杞硅胶杞昏郊杞借骄杞胯線杈佽緜杈冭緞杈呰締杈囪緢杈夎緤杈嬭緦杈嶈編杈忚緪杈戣緭杈旇緯杈栬緱杈樿緳杈氳緸杈熻京杈竟杈借揪杩佽繃杩堣繍杩樿繖杩涜繙杩濊繛杩熻咯杩宠抗閫傞€夐€婇€掗€﹂€婚仐閬ラ倱閭濋偓閭偣閭洪偦閮侀儚閮愰儜閮撻儲閮ч兏閰濋叇閰遍吔閰鹃吙閲婇噷閴撮姰閷鹃拝閽嗛拠閽堥拤閽婇拫閽岄拲閽庨拸閽愰拻閽撻挃閽曢挆閽橀挋閽氶挍閽滈挐閽為挓閽犻挕閽㈤挘閽ら挜閽﹂挧閽ㄩ挬閽挮閽挱閽挴閽伴挶閽查挸閽撮挼閽堕挿閽搁捁閽洪捇閽奸捊閽鹃捒閾€閾侀搨閾冮搫閾呴搯閾堥搲閾婇搵閾嶉搸閾愰搼閾掗摃閾楅摌閾欓摎閾涢摐閾濋摓閾熼摖閾￠摙閾ｉ摛閾ラ摟閾ㄩ摡閾摣閾摦閾摪閾遍摬閾抽摯閾甸摱閾烽摳閾归摵閾婚摷閾介摼閾块攢閿侀攤閿呴攬閿夐攱閿岄攷閿忛攼閿戦敀閿撻敂閿曢敄閿楅敊閿氶敍閿滈敒閿熼敗閿㈤敚閿ら敟閿﹂敡閿ㄩ敥閿敨閿敪閿敮閿伴敱閿查敶閿甸敹閿烽敻閿归敽閿婚敿閿介斁閿块晙闀侀晜闀冮晞闀呴晢闀囬晥闀夐晩闀嬮晫闀嶉晭闀忛晲闀戦晵闀撻晹闀曢晼闀楅晿闀欓暁闀滈暆闀為暉闀犻暋闀㈤暎闀ら暐闀﹂暓闀ㄩ暕闀暙闀暛闀暞闀伴暠闀查暢闀撮暥闀块棬闂╅棯闂棴闂棷闂伴棽闂撮椀闂堕椃闂搁椆闂洪椈闂奸椊闂鹃椏闃€闃侀槀闃冮槄闃嗛槇闃夐槉闃嬮槍闃嶉槑闃忛槓闃戦槖闃旈槙闃栭槜闃橀槞闃氶槢闃熼槼闃撮樀闃堕檯闄嗛檱闄堥檳闄曢櫑闄ㄩ櫓闅忛殣闅堕毥闅鹃洀闆犻洺闆鹃渷闇夐湱闈撻潤闈ラ瀾闉掗灟闊﹂煣闊╅煪闊煬闊甸〉椤堕》椤搁」椤洪』椤奸〗椤鹃】棰€棰侀棰冮棰呴棰囬棰夐棰嬮棰嶉棰忛棰戦棰旈棰楅棰欓棰涢棰濋棰熼棰￠ⅱ棰らⅴ棰﹂ⅶ椋庨椋愰椋撻椋曢椋橀椋氶椋ㄩ楗ｉゥ楗﹂ェ楗ㄩォ楗カ楗キ楗ク楗伴ケ楗查コ楗撮サ楗堕シ楗搁ス楗洪セ楗奸ソ楗块棣侀棣冮棣呴棣囬棣夐棣嬮棣嶉棣忛棣戦棣撻棣曢┈椹┊椹┌椹遍┎椹抽┐椹堕┓椹搁┕椹婚┖椹奸┙椹鹃┛楠€楠侀獋楠勯獏楠嗛獓楠堥獕楠婇獘楠岄獜楠愰獞楠掗獡楠栭獥楠橀獨楠涢獪楠濋獮楠熼獱楠￠楠ｉ楠ラ楠ч珔楂嬮珜楝撻瓏榄夐奔楸介本楸块瞼椴侀矀椴呴矄椴囬矆椴嬮矋椴庨矏椴戦矑椴旈矔椴氶矝椴滈矠椴熼矤椴￠并椴ｉ菠椴ラ拨椴ч波椴╅搏椴伯椴伴脖椴查渤椴撮驳椴堕卜椴搁补椴洪不椴奸步槌€槌侀硟槌勯硡槌嗛硣槌婇硧槌岄硩槌庨硰槌愰硴槌旈硶槌栭硹槌橀硻槌滈碀槌為碂槌犻场槌㈤常楦熼笭楦￠涪楦ｉ弗楦﹂抚楦ㄩ俯楦斧楦腑楦腐楦遍覆楦抽傅楦堕阜楦搁腹楦洪附楦鹃缚楣侀箓楣冮箘楣呴箚楣囬箞楣夐箠楣嬮箤楣忛箰楣戦箳楣曢箹楣楅箻楣氶箾楣滈篂楣￠耿楣ｉ工楣ラ功楣ч龚楣╅躬楣宫楣巩楣伴贡楣查钩楣撮咕楹﹂焊榛勯粔榛￠哗榛痪榧嬮紞榧楅脊榻勯綈榻戦娇榫€榫侀緜榫冮緞榫呴締榫囬緢榫夐緤榫嬮緦榫欓練榫涢緹";

const TRADITIONAL_HINT_CHARS =
  "瑕嬪€戞澅涓熷叐鍤村柂鍊嬭睈鑷ㄧ偤楹楄垑缇╃儚妯傚柆缈掗剦鏇歌卜浜傜埈鏂艰櫑闆蹭簽鐢㈢暆瑕せ鍎勫儏寰炰緰鍊夊剙鍊戝児鐪惧劒澶ユ渻鍌樺亯鍌冲偡鍊伣楂旈鍌儔淇犱径鍍ュ伒鍋村儜鍎堝剷鍎備縼鍎斿劶鍊嗗劮鍎夊偟鍌惧偗鍍傚儴鍎熷劵鍎愬劜鍎哄厭鍏屽厳铇棞鑸堥鐛稿泤鍏у病鍐婂杌嶈静棣矕姹烘硜鍑嶆法娑兼笡婀婂嚋骞鹃吵槌ф啈鍑辨搳姘归懣鑺诲妷鍓囧墰鍓靛埅鍒ュ墬鍓勫墡鍔婂妼鍓村姂鍓妽鍓濆妵鍕歌睛鍕欏嫊鍕靛媮鍕炲嫝鍕涘嫄鍕╁嫽鍖尡鍗€閱彲鍗斿柈璩ｇ洤楣佃鍗诲粻寤虫鍘插鍘帣寤佸粋鍘村粓寤氬粍绺ｅ弮闆欑櫦璁婃晿鐤婅憠铏熷槅鍢扮辈寰屽殗鍛傚棊鍣歌伣鍟熷惓鍚跺樃鍥堝様鍤﹀攧鍝″捈鍡嗗棜瑭犲毃鍤€鍣濆悞闊垮暈鍣犲樀鍡跺櫐鍢╁櫜鍤屽櫏鍠插槣鍢棭鍠氬槚鍡囧泙榻у泬鍢藉槸鍣村槏鍤冲泚鍣檽鍤跺洃鍤曞泜鍦樺湌鍥湇鍦囧湅鍦栧湏鑱栧鍫撮槳澹炲鍫呭澹㈠）濉㈠⒊澧滃澹犲澹樺⒕鍫婂鍩″⒍澹嬪鍫栧濉ゅ牆鍨靛」澧＊鐗嗗／鑱叉澹鸿檿鍌欏京澶犻牠澶惧オ濂╁濂崕濂у濠﹀瀚靛珬濯钖戝﹣濠瑘瀣屽瓕濞涘瀚诲瀣板瑡瀣稿瀣″瀣欏瀛瀛垮瀵跺瀵靛鎲插瀵硴瀵㈠皪灏嬪皫澹藉皣鐖惧〉鍢楀牤灏峰睄鐩″堡灞睖灞嗗爆灞㈠报宥兼璞堝秶宕楀炒宥村祼宄跺逗宥藉船宸嬪定宄藉稜宕㈠窉宥楀磵宥秳宥稿稊宥佸窋闉忓钒骞ｅ弗甯箖甯崇熬骞熷付骞€骞宫骞樺箺鍐帄鎱跺滑寤″韩鎳夊粺榫愬虎寤庡哗闁嬬暟妫勫嫉褰屽汲褰庡綀寮锋鐣堕寗褰炲渐寰瑰緫寰犳喍鎳烘唫鎰炬嚪鎱嬫叓鎲叒鎮垫劥鎲愮附鎳熸噷鎴€鎭嗘噰鎯℃厽鎳ㄦ劮鎯绘儽鎯叉倕鎳告叧鎲鎳兼厴鎳叉唺鎰滄厷鎲氭叄鎱嶆啢鎲掗鎳炬嚕鎳舵噸鎴囨垟鎴叉埀鎴版埄鎴剁串鎾茶鍩锋摯鎹巸鎻氭摼鎾媼鎽舵懗鎺勬惗璀峰牨鎿旀摤鏀忔弨鎿佹敂鎿版挜鎿囨帥鎽敚鎺楁捑鎾绘尵鎾撴搵鎾熸帣鎿犳彯鎾忔拡鎼嶆捒鎻涙悧鎿氭挌鎿勬憫鎿叉挘鎽绘敩鎾虫敊鎿辨憻鏀敎鏀濇攧鎿烘悥鎿敜鏀栨拹鏀嗘摲鎿兼敍鎿绘敘鏁垫杺鏁搁綃鏂曢鏂柗鐒¤垔鏅傛洜鏆樻泧鏅濋’鏅夋洭鏇夋泟鏆堟殙鏆洊琛撴娈洪洔娆婃渚嗘鍌戞サ妲嬫▍妯炴娅妫栨妤撴娅冩妾夋鏌垫妫ф珱娅虫娅ㄦ珶娆勬ü妫叉ǎ娆掓姗堟エ妾旀姗嬫ê妾滄С妯佸あ妾６妾㈡瑸妲ㄦ珴妲ф瑥姗㈡〒娆栨Σ娅珰娅告獰妾绘娅ф┇妾ｆ娅娅撴珵妾佹姝熸瓙娈叉娈ゆ畼娈炴娈姣嗘瘈杞傜暍鏂冩皥姣挎皩姘ｆ矮姘俺鍖饥姹欐汞娲舵簼娌掔亙婕氱€濇藩婊勬滑婵樻窔婢╃€х€樻考鐎夋綉婢ゆ秶娼旂亼绐倒娣烘伎婢嗘篂婵佹脯婢繜鐎忔换娓炬桓婵冩蒋婵ゆ緡娣舵迹娼挎甫婧虫笝婊屾饯婢楁疾婢€婢辨返娣ユ棘鐎嗘几婕佺€嬫徊婧仯婵曟桨婵烘嫉婕婃椒婊炬化鐏╃亜婊跨€呮烤婵仱婵辩仒婢︾仌婵€犵€熺€叉堪娼涚€︾€剧€ㄧ€曠仢婊呯噲闈堢伣鐕︾叕鐖愮噳鐓掔啑榛炵厜鐔剧垗鐖涚兇鐕厵鐓╃噿鐕佺嚧鐕欑嚰鐔辩叆鐕滅嚲鐔呮剾鐖虹墭姘傜壗鐘х姠鐙€鐛风崄鐚剁嫿鐛扮崹鐙圭崊鐛寵鐛勭尰鐛嵉鐛肩巰璞矒铦熺嵒鐛虹挘鐟憢鐠扮従鐟茬捊鐞虹搹鐠惪鐠夌懀鐡婄懁鐠︾摂鐡氱敃闆荤暙鏆㈢枃鐧ょ檪鐦х櫂鐦嶉瑏鐦＄構鐨扮椌鐧扮棛鐧㈢槀鐧嗙槗鐧囩檳鐦炵樅鐧熺櫛鐧櫗鐧╃櫖鐧茬殮鐨虹毟鐩為菇鐩ｈ搵鐩滅洡鐬樼湧钁楃潨鐫炵灱鐬炵煔鐭／绀う纰⒓纾氱〃纭⒏绀け绀纭滅ⅸ纭ょ＝纾戠纰洪辜绀欑＇纾ｅ牽绂Α绂曠Π绂庣Ρ绂嶇绁跨Κ闆㈢绋堢ó绌嶇ū绌㈢绌▍绌岀┅绌＄绔婄珔绐珓绐╃绔囩璞庣绡ょ瓖绛嗙绠嬬睜绫╃瘔绡崇绨圭畯绫岀敖绨＄睓绨€绡嬬睖绫盀绨埃绨嶇眱绫豹绫熺炒椤炵绯剁巢绮电碁绯х碀椁辩穵绺剁尘绱呯磦绾栫磩绱氱磮绱€绱夌矾绱滅磾绱曠礂缍辩磵绺辩陡绱涚礄绱嬬础绱愮磽绶氱春绱茬幢绶寸祫绱崇窗绻旂祩绺愮祮绱肩祤绱圭构缍撶秮绲ㄧ祼绲濈篂绲扮祹绻郸绲㈢党绲＄禃绲炵当缍嗙秲绲圭埂缍岀稄绲涚辜绺剧窉缍剧簩缍虹穻缍界窋杓ョ供缍犊缍箖缍㈢动缍圭稖缍荤栋缍犵洞绶囩窓绶楃窐绶簻绶圭凡绶濈笗绻㈢乏缍炵窞绶剁窔绶辩笅绶╃窢绺风法绶＄罚绺夌笡绺熺笣绺笚绺炵簭绺笂绺戠菇绺圭傅绺茬簱绺箚绻呯簣绻氱箷绻掗焷绻剧拱绻钩绾樼綄缍茬緟缃扮椒缇嗙緢缇ョ鲸缈圭拷缈€伋鎭ヨ伓鑱捐伔鑱硅伅鑱佃伆鑲呰吀鑶氶鑲磋厧鑵劰鑴呰喗鍕濇湩鑵栬嚉鑴涜啝鑴堣喚楂掕噸鑵﹁喛鑷犺叧鑴叀鑷夎嚇閱冭啎榻惰啯闈﹁唭楱拌噺鑷㈣伎鑹よ墻鑹欒壂鑹辫睌钘濈瘈缇嬭枌钑槅钃懄钘惰帶钀囪捈鑻ц槆铇嬭帠铇㈣敠濉嬬參绻崐钖﹁枠鑾㈣晿钃借晭钖堣柡钑╂Ξ钁锋粠鐘栫啋钑佽棊钃€钄晵钁掕懁钘ヨ挒钀婅摦钂旇惖钖熺嵅钑曠懇槎摯铇€铇胯灑鐕熺笀钑柀钄ヨ晢钑㈣敚钄炶棈钖婅樅钑烽帲椹€钖旇槥钘鸿椆铇勮槉钘槡娅辫櫆鎱櫅锜茶櫙锜ｉ洊铦﹁爢铦曡熁铻炶牰铚嗚牨锠ｈ煻锠昏焺铔鸿煰铻勮爯铔昏澑锠熻爡锜堣煬锠嶈灮锠戣灴锜庤牗閲侀姕瑁滈尪瑗瑗栬瑜樿オ瑗茶瑁濊瑜岃こ瑗濊げ瑗囪じ瑗ょ箞瑗磋瑙€瑕庤瑕撹瑕樿瑕鸿Μ瑕¤瑕﹁Ο瑕茶Ψ瑙磋Ц瑙惰畫璀借瑒瑷堣▊瑷冭獚璀忚◥瑷岃◣璁撹〞瑷栬〒璀拌▕瑷樿瑳璜辫瑭庤瑷ヨū瑷涜珫瑷熻瑷í瑷ｈ瓑瑭佽ǘ瑭曡璀樿瑭愯ù瑷鸿﹩璎呰瑭樿璀瑾嗚獎瑭﹁┛瑭╄┌瑭艰獱瑾呰┑瑭辫獣瑭┊瑭瑭ｈ珝瑭茶┏瑭瑭¤瑾ｈ獮瑾氳瑾ヨ獦瑾ㄨ獞瑾瑾掕珛璜歌珡璜捐畝璜戣瑾茶珘璜涜璜楄璜傝珤璜勮珖瑾艰瑎璜惰珳璎婅璜ц瑪璎佽瑐璜よ璜艰畳璜璜鸿璎庤珵璜濊璁滆瑬璎濊瑺璎楄璎欒瑦璎硅璎璎瓪璀栬瓩璁曡瓬璀庤疄璀磋绌€璞惰矟璨炶矤璨㈣病璨尝鏁楄超璨ㄨ唱璨╄勃璨ц捕璩艰帛璨渤璩よ硜璨拌布璨磋埠璨歌部璨昏硛璨借硦璐勮硤璩勮膊璩冭硞璐撹硣璩呰磹璩曡硲璩氳硳璩﹁抄榻庤礀璩炶硿璩¤碃璩ц炒璩佃磪璩昏澈璩借尘璐楄磰璐堣磵璐忚礇瓒欒稌瓒ㄨ恫韬嶈箤韬掕笎韬傝购韫曡簹韬嬭复韬婅工韬撹簯韬¤梗韬曡亥韬害杌€杌婅粙杌岃粧杌戣粩杞夎粵杓粺杞熻徊杌昏饯杌歌还杌艰护杌舰杌鸿紩杌捐級杓婅綆杓堣紘杓呰純杓掕紨杓涜鸡杓╄紳杓ヨ紴杓紵杓滆汲杓昏集杓歌健杞呰絼杓捐絾杞嶈綌杈棦杈井閭婇伡閬旈伔閬庨倎閬嬮倓閫欓€查仩閬曢€ｉ伈閭囬€曡贰閬╅伕閬滈仦閭愰倧閬洪仚閯ч労閯旈兊閯掗劥閯伴閮熼劧閯剢閰堥剸閯查啚閱遍啲閲呴噧閲€閲嬭！閼掗懢閺ㄩ嚀閲旈嚌閲橀嚄閲欓嚂閲烽嚭閲ч嚖閲╅嚕閸嗛嚬閲甸垉閳ｉ垐閳﹂墔閳嶉垟閻橀垑閶囬嫾閳戦垚閼版閳為帰閴ら埀閳侀垾閳勯垥閳€閳洪將閴﹂墬閳风冀閳抽墪閳介埜閴為懡閴壄閴€閳块埦閻甸墤閳撮憼閴涢墯閳伴墘閴堥墠閳归惛閵姞閴洪姫閶忛嫞閻冮妽閻洪妳閶侀姳閵﹂帶閸橀姈閵戦媽閵╅彽閵撻帺閴块姎閵橀寶閵壐閵ラ彑閵冮悑閵ㄩ妧閵ｉ憚閻掗嫪閶欓尭閶遍張閺楅姺閹栭嫲閸嬮徑閵奸嫆閶呴惁閻ч姵閵婚媰閶熼嫤閷掗寙閸洪尟閷ㄩ寷閷￠寔閷曢尗閷懠閷橀寪閷﹂憰閸侀寛閸冮寚閷熼尃閸甸嫺閷抽寵閸ラ崌閺橀嵍閸旈崵閸嵕閸涢帾閸犻嵃閹勯崓閹傞彜閹￠惃閹囬弻閹帥閹橀懛閽傞惈閹抽幙閹﹂幀閹婇幇閹甸憣閹旈彚閺滈彎閺嶉彴閺￠彂閺冮弴閺愰悢閽侀悙閺烽懃閻撻懎閻犻懝閺归悪閼婇惓閻堕惒閻惪閼旈懀閼為懖闀烽杸闁傞杻闁嗛枆鍟忛棖闁忛枒闁撻枖闁屾偠闁橀闁ㄨ仦闂ラ柀闁棑闁ラ枺闁￠柅闁遍柆闁鹃柟闁堕闁块柦闁婚柤闂￠棇闂冮棅闂嬮棓闂愰棐闂曢棡闂ら殜闄介櫚闄ｉ殠闅涢櫢闅撮櫝闄橀櫇闅夐殨闅毃闅遍毟闆嬮洠闆涜畮闈傞湩闇介淮闈勯潥闈滈潹闊冮灲闊夐煁闊岄煋闊欓煘闊滈熁闋侀爞闋冮爣闋呴爢闋堥爦闋戦¨闋撻爭闋掗爩闋忛爯椤遍牁闋楅牳闋￠牥闋查牅娼佺啿闋﹂牑闋婚牴闋风椤嗛椤掗椤撻椤嶉〕椤㈤椤欓ˉ椤‖椤伴〈棰ㄩ⒑棰棰堕⒏棰奸⒒椋勯椋堥楗楅椋㈤％椁抽）椁奸＊椋－椋２椁為＞椋介＜椋块４椁岄椁夐椁庨椁忛椁戦椁橀椁曢椁涢ぁ椁ㄩし楗嬮ざ椁块楗侀椁洪ぞ楗堥楗呴楗岄ア棣Ν棣遍Υ棣抽﹨棣归椹㈤椐熼椐掗楱堕椐戦椹涢椹嶇降椹曢椐遍Л椐㈤┇椹▉椹楅Э楱忛◣楱嶉▍椹傞楱ǚ楱栭﹣楱ǐ楱搁﹥楱鹃﹦椹忛椹ラ│椹ら珡楂栭珪楝㈤瓨榄庨瓪榄涢榄烽榄楫侀畠楫庨备楫掗畱楸熼異楫畾楫疄楸楫瘲楸橀瘉楸洪氨榘归瘔榘ｉ胺榀€榀婇瘒榀介瘱榀榀￠榀ч瘽榀㈤榀涢榘洪榀旈睗榘堥榘皳楸烽皪榘掗皦榀块盃榘查碍榘ㄩ哎榘╅俺榘鹃眻楸夐盎榘甸眳楸栭睌楸楅睊楸堡楸ч保槌ラ畅闆為扯槌撮窏榇夐冬榇囬磫榇ｉ秶楦曢川榇為处榇熼礉榇涢磿榉ラ窓榇窗榈傞纯楦為椿榈撻笣榈戦禒榈濋祾榉抽禍榈￠挡槎撻氮榈诞槎夐秺槎橀丁槎氶痘槎块顶槎╅穫槎洪穪槎奸洞榉栭笟榉撻窔榉乏榉查犯榉轰磯榉归笇楦忛笡楦橀购楹ラ憨榛冮粚榛堕环榛查唤榛块級闉€榧撮絿榻婇綇榻掗綌榻曢綏榻熼健榻欓綘榻滈溅榻姜榻查椒榫嶉緮榫曢緶";

function normalizeV2ExampleLocalizations(value: unknown): NonNullable<WordExample["localizations"]> {
  const parsed = parseJsonValue(value);
  const source = parsed && typeof parsed === "object" ? (parsed as Record<string, Record<string, unknown>>) : {};
  const output: NonNullable<WordExample["localizations"]> = {};

  for (const lang of ["zh", "en", "pt-BR", "ja"] as const) {
    const item = source[lang];
    if (!item || typeof item !== "object") continue;
    output[lang] = {
      text: normalizeStringOrText(item.text),
      reading: normalizeStringOrText(item.reading)
    };
  }

  return output;
}

function v2PrimaryTranslations(senses: V2WordSense[]): Record<DisplayLanguageCode, LocalizedText> {
  const output: Record<DisplayLanguageCode, LocalizedText> = {
    zh: { text: "", phonetic: "", audio_text: "" },
    en: { text: "", phonetic: "", audio_text: "" },
    "pt-BR": { text: "", phonetic: "", audio_text: "" },
    ja: { text: "", phonetic: "", audio_text: "" }
  };

  for (const lang of ["zh", "en", "pt-BR", "ja"] as const) {
    const localization = senses.find((sense) => sense.localizations?.[lang])?.localizations?.[lang];
    if (!localization) continue;
    output[lang] = {
      text: localization.term,
      phonetic: localization.pronunciation || localization.reading || "",
      audio_text: localization.term
    };
  }

  return output;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeDictionarySenses(value: unknown): WordSense[] {
  const items = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  return items
    .map((sense, index) => {
      const definitions =
        sense.definitions && typeof sense.definitions === "object"
          ? (sense.definitions as Record<string, unknown>)
          : {};
      const senseOrder = Number(sense.sense_order || index + 1);
      return {
        sense_order: Number.isFinite(senseOrder) && senseOrder > 0 ? senseOrder : index + 1,
        part_of_speech: normalizeStringOrText(sense.part_of_speech),
        gloss_key: normalizeStringOrText(sense.gloss_key),
        definitions: {
          zh: normalizeStringOrText(definitions.zh),
          en: normalizeStringOrText(definitions.en),
          "pt-BR": normalizeStringOrText(definitions["pt-BR"]),
          ja: normalizeStringOrText(definitions.ja)
        }
      };
    })
    .filter((sense) => Object.values(sense.definitions).some(Boolean));
}

function normalizeDictionaryTranslations(
  translationsValue: unknown,
  pronunciationsValue: unknown
): Record<DisplayLanguageCode, LocalizedText> {
  const translations =
    translationsValue && typeof translationsValue === "object"
      ? (translationsValue as Record<string, unknown>)
      : {};
  const pronunciations =
    pronunciationsValue && typeof pronunciationsValue === "object"
      ? (pronunciationsValue as Record<string, unknown>)
      : {};

  return {
    zh: dictionaryLocalizedText(translations.zh, pronunciations.zh),
    en: dictionaryLocalizedText(translations.en, pronunciations.en),
    "pt-BR": dictionaryLocalizedText(translations["pt-BR"], pronunciations["pt-BR"]),
    ja: dictionaryLocalizedText(translations.ja, pronunciations.ja)
  };
}

function dictionaryLocalizedText(translation: unknown, pronunciation: unknown): LocalizedText {
  const translationItem =
    translation && typeof translation === "object" ? (translation as Record<string, unknown>) : {};
  const pronunciationItem =
    pronunciation && typeof pronunciation === "object" ? (pronunciation as Record<string, unknown>) : {};
  const text = normalizeStringOrText(translationItem.text);

  return {
    text,
    phonetic: normalizeStringOrText(pronunciationItem.phonetic),
    audio_text: normalizeStringOrText(pronunciationItem.audio_text) || text
  };
}

function dictionaryWordDetail(word: unknown, definition: unknown): WordDetail {
  return {
    word: normalizeStringOrText(word),
    definition: normalizeStringOrText(definition)
  };
}

function isDictionaryLookupCandidate(text: string): boolean {
  if (!text || text.length > 48) return false;
  return !/\s/u.test(text.trim());
}

function normalizeDictionaryKey(value: string): string {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function preferredDictionarySourceLang(
  text: string,
  targetLang: LanguageCode,
  sourceLang: LanguageCode | "auto" = "auto"
): LanguageCode {
  if (sourceLang && sourceLang !== "auto") return sourceLang;
  const value = String(text || "");
  if (/[\u3040-\u30ff]/u.test(value)) return "ja";
  if (/[\u4e00-\u9fff]/u.test(value)) return "zh";
  if (/[茫玫谩脿芒锚茅铆贸么煤莽]/iu.test(value)) return "pt-BR";
  return targetLang === "pt-BR" ? "pt-BR" : "en";
}
