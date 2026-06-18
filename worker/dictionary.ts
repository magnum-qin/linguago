import { normalizeExamples, normalizeStringOrText } from "./normalization";
import type {
  DisplayLanguageCode,
  Env,
  LanguageCode,
  LocalizedText,
  WordExample,
  WordDetail,
  WordResponse,
  WordSense
} from "./types";

type V2WordSense = WordSense & { examples: WordExample[] };

export interface DictionaryAdapter {
  name: string;
  lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null>;
}

export class CloudflareD1V2Adapter implements DictionaryAdapter {
  name = "cloudflare-d1-v2";

  async lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
    if (!input.env.DB) return null;

    const normalized = normalizeDictionaryKey(input.text);

    try {
      const sql = `
        WITH matched_entries AS (
          SELECT id, matched_lang
          FROM (
            SELECT e.id, e.source_lang AS matched_lang, 0 AS match_rank, e.frequency_rank
            FROM v2_entries e
            WHERE e.normalized_key = ? OR lower(e.word) = ?
            UNION
            SELECT e.id, ef.lang AS matched_lang, 1 AS match_rank, e.frequency_rank
            FROM v2_entries e
            JOIN v2_entry_forms ef ON ef.entry_id = e.id
            WHERE ef.normalized_form = ?
            UNION
            SELECT e.id, sl.lang AS matched_lang, 2 AS match_rank, e.frequency_rank
            FROM v2_entries e
            JOIN v2_senses s_match ON s_match.entry_id = e.id
            JOIN v2_sense_localizations sl ON sl.sense_id = s_match.id
            WHERE lower(sl.term) = ? OR sl.normalized_term = ?
          )
          ORDER BY match_rank, frequency_rank IS NULL, frequency_rank, id
          LIMIT 1
        )
        SELECT json_object(
          'id', e.id,
          'word', e.word,
          'normalized_key', e.normalized_key,
          'source_lang', e.source_lang,
          'matched_lang', me.matched_lang,
          'frequency_rank', e.frequency_rank,
          'senses', (
            SELECT json_group_array(json_object(
              'id', s.id,
              'sense_order', s.sense_order,
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
                g.lang AS group_lang,
                g.reading AS group_reading,
                g.reading_key AS group_reading_key,
                g.reading_system AS group_reading_system
              FROM v2_senses s
              LEFT JOIN v2_pronunciation_groups g ON g.id=s.pronunciation_group_id
              WHERE s.entry_id = e.id
              ORDER BY
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM v2_sense_localizations sl_order
                  WHERE sl_order.sense_id = s.id
                    AND (lower(sl_order.term) = ? OR sl_order.normalized_term = ?)
                ) THEN 0 ELSE 1 END,
                s.sense_order
              LIMIT 8
            ) s
          )
        ) AS data
        FROM v2_entries e
        JOIN matched_entries me ON me.id = e.id
        ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id
        LIMIT 1
      `;

      const row = await input.env.DB.prepare(sql)
        .bind(normalized, normalized, normalized, normalized, normalized, normalized, normalized)
        .first<{ data: string }>();

      if (!row?.data) return null;
      const entry = parseJsonValue(row.data) as Record<string, unknown>;
      const senses = Array.isArray(entry.senses) ? entry.senses : [];
      if (senses.length === 0) return null;

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

  async lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
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

  async lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
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

  async lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
    // Only return mock data if translating 'hello' to Japanese to simulate an external JMDict response
    if (input.text.toLowerCase() === "hello" && input.targetLang === "ja") {
      return {
        detected_source_lang: "en",
        target_lang: "ja",
        original: "hello",
        translation: "こんにちは",
        translations: {
          ja: { text: "こんにちは", phonetic: "kon'nichiwa", audio_text: "こんにちは" },
          zh: { text: "", phonetic: "", audio_text: "" },
          en: { text: "", phonetic: "", audio_text: "" },
          "pt-BR": { text: "", phonetic: "", audio_text: "" }
        },
        provider: "dictionary",
        model: "mock-jmdict",
        cached: true,
        type: "word",
        phonetic: "kon'nichiwa",
        audio_text: "hello",
        examples: [
          {
            sentence: "Hello, how are you today?",
            translations: { ja: "こんにちは、今日の調子はどうですか？", zh: "", en: "", "pt-BR": "" }
          }
        ],
        senses: [
          {
            sense_order: 2,
            part_of_speech: "interjection (from JMDict)",
            gloss_key: "greeting",
            definitions: { ja: "（日中の挨拶）こんにちは。", zh: "", en: "", "pt-BR": "" }
          }
        ],
        word_details: {
          ja: { word: "こんにちは", definition: "日中に出会った人に対してかける挨拶の言葉。" },
          zh: { word: "", definition: "" },
          en: { word: "", definition: "" },
          "pt-BR": { word: "", definition: "" }
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

  async lookupAll(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
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
    cached: true,
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
  const rawSenses = Array.isArray(entry.senses) ? (entry.senses as Array<Record<string, unknown>>) : [];
  const senses = rawSenses.map((sense, index) => normalizeV2Sense(sense, index));
  const firstSense = senses[0] || null;
  const translations = v2PrimaryTranslations(senses);
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
    cached: true,
    type: "word",
    phonetic: translations[String(entry.matched_lang || entry.source_lang || "en") as LanguageCode]?.phonetic || "",
    audio_text: translations[String(entry.matched_lang || entry.source_lang || "en") as LanguageCode]?.audio_text || String(entry.word || original),
    examples,
    senses,
    word_details: {
      zh: dictionaryWordDetail(translations.zh?.text, firstSense?.definitions.zh),
      en: dictionaryWordDetail(translations.en?.text, firstSense?.definitions.en),
      "pt-BR": dictionaryWordDetail(translations["pt-BR"]?.text, firstSense?.definitions["pt-BR"]),
      ja: dictionaryWordDetail(translations.ja?.text, firstSense?.definitions.ja)
    }
  };
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
  "见们东丢两严丧个丰临为丽举义乌乐乔习乡书买乱争于亏云亚产亩亲亵亿仅从仑仓仪们价众优伙会伞伟传伤伦伪体余佣佥侠侣侥侦侧侨侩侪侬俣俦俨俩俪俭债倾偬偻偾偿傥傧储傩儿兑兖兰关兴养兽冁内冈册写军农冯冲决况冻净凉减凑凛几凤凫凭凯击凼凿刍刘则刚创删别刬刭刹刽刿剀剂剐剑剥剧劝办务动励劲劳势勋勐勚匀匦匮区医华协单卖卢卤卫却厂厅历厉压厌厍厕厢厣厦厨厩县参双发变叙叠叶号叹叽吁后吓吕吗吨听启吴呐呒呓呕呖呗员呙呛呜咏咙咛咝咤响哑哒哓哔哕哗哙哜哝哟唛唠唢唤啧啬啭啮啰啴啸喷喽喾嗫嗳嘘嘤嘱噜嚣团园囱围囵国图圆圣圹场坂坏块坚坛坜坝坞坟坠垄垅垆垒垦垩垫垭垯垱垲垴埘埙埚埯堑堕塆墙壮声壳壶处备复够头夹夺奁奂奋奖奥妆妇妈妩妪妫姗姜娄娅娆娇娈娱娲娴婳婴婵婶媪嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝尧尴尸尽层屃屉届属屡屦屿岁岂岖岗岘岙岚岛岭岳岽岿峃峡峤峥峦崂崃崄崭嵘嵚嵝巅巩巯币帅师帏帐帘帜带帧帮帱帻帼幂庄庆庐庑库应庙庞废庼廪开异弃张弥弪弯弹强归当录彝彦彻径徕忆忏忧忾怀态怂怃怄怅怆怜总怼怿恋恒恳恶恸恹恺恻恼恽悦悬悭悯惊惧惨惩惫惬惭惮惯愠愤愦愿慑懑懒懔戆戋戏戗战戬户扎扑托执扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挢挣挤挥挦捞损捡换捣据捻掳掴掷掸掺揽揿搀搁搂搅携摄摅摆摇摈摊撄撑撵撷撸撺擞攒敌敛数斋斓斗斩断无旧时旷旸昙昼显晋晒晓晔晕晖暂暧术机杀杂权条来杨杰极构枞枢枣枥枧枨枪枫枭柜柠柽栀栅标栈栉栊栋栌栎栏树栖样栾桠桡桢档桤桥桦桧桨桩梦梼梾检棂椁椟椠椤椭楼榄榅榇榈榉槚槛槟槠横樯樱橥橱橹橼檩欢欤欧歼殁殇残殒殓殚殡殴毁毂毕毙毡毵氇气氢氩氲汇汉污汤汹沟没沣沤沥沦沧沪泞泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浊测浍济浏浐浑浒浓浔涛涝涞涟涠涡涢涣涤润涧涨涩淀渊渌渍渎渐渔渖渗温湾湿溃溅溆溇滗滚滞滟滠满滢滤滥滦滨滩滪漓漤潆潇潋潍潜潴澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煴爱爷牍牦牵牺犊状犷犸犹狈狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玛玮环现玱玺珐珑珰珲琏琐琼瑶瑷璎瓒瓮电画畅畴疖疗疟疠疡疬疮疯疱疴痈痉痒痖痨痪痫瘅瘗瘘瘪瘫瘾瘿癞癣癫皑皱皲盏盐监盖盗盘眍眦着睁睐睑瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硁硕硖硗硙硚确硷碍碛碜碱礼祃祎祢祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穷窃窍窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筑筚筛筜筝筹签简箓箦箧箨箩箪箫篑篓篮篱簖籁籴类籼粜粝粤粪粮糁糇紧絷纟纠红纣纤约级纨纪纫纬纭纯纰纱纲纳纵纶纷纸纹纺纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绑绒结绔绕绖绗绘给绚绛络绝绞统绠绡绢绣绤绥绦继绩绪绫续绮绯绰绱绲绳维绵绶绷绸绹绺综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缌缍缎缏缐缑缒缓缔缕编缗缘缙缚缛缜缝缞缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵罂网罗罚罢罴羁羟羡翘翙翚耧耸耻聂聋职聍联聩聪肃肠肤肮肴肾肿胀胁胆胜胧胨胪胫胶脉脍脏脐脑脓脔脚脱脶脸腊腌腘腭腻腼腽腾膑臜舆舣舰舱舻艰艳艺节芈芗芜芦苁苇苈苋苌苍苎苏苧苹茎茏茑茔茕茧荆荐荙荚荛荜荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药莅莱莲莳莴莶获莸莹莺莼萚萝萤营萦萧萨葱蒇蒉蒋蒌蓝蓟蓠蓣蓥蓦蔷蔹蔺蔼蕲蕴薮藓蘖虏虑虚虫虬虮虽虾虿蚀蚁蚂蚕蚬蛊蛎蛏蛮蛰蛱蛲蛳蛴蜕蜗蜡蝇蝈蝉蝎蝼蝾螀螨蟏衅衔补表衬衮袄袅袆袜袭袯装裆裈裢裣裤裥褛褴襁襕见观觃规觅视觇览觉觊觋觌觎觏觐觑觞触觯詟誉誊讠计订讣认讥讦讧讨让讪讫训议讯记讲讳讴讵讶讷许讹论讼讽设访诀证诂诃评诅识诇诈诉诊诋诌词诎诏译诒诓诔试诖诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谞谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谷豮贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赓赔赕赖赗赘赙赚赛赜赝赞赠赡赢赣赵赶趋趱跃跄跞践跶跷跸跹跻踊踌踪踬踯蹑蹒蹰蹿躏躜躯车轧轨轩轪轫转轭轮软轰轱轲轳轴轵轶轷轸轹轺轻轼载轾轿辀辁辂较辄辅辆辇辈辉辊辋辌辍辎辏辐辑输辔辕辖辗辘辙辚辞辟辩辫边辽达迁过迈运还这进远违连迟迩迳迹适选逊递逦逻遗遥邓邝邬邮邹邺邻郁郏郐郑郓郦郧郸酝酦酱酽酾酿释里鉴銮錾钅钆钇针钉钊钋钌钍钎钏钐钒钓钔钕钗钘钙钚钛钜钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铍铎铐铑铒铕铗铘铙铚铛铜铝铞铟铠铡铢铣铤铥铧铨铩铪铫铭铮铯铰铱铲铳铴铵银铷铸铹铺铻铼铽链铿销锁锂锅锈锉锋锌锎锏锐锑锒锓锔锕锖锗错锚锛锜锞锟锡锢锣锤锥锦锧锨锩锪锫锬锭键锯锰锱锲锴锵锶锷锸锹锺锻锼锽锾锿镀镁镂镃镄镅镆镇镈镉镊镋镌镍镎镏镐镑镒镓镔镕镖镗镘镙镚镜镝镞镟镠镡镢镣镤镥镦镧镨镩镪镫镬镭镮镯镰镱镲镳镴镶长门闩闪闫闭问闯闰闲间闵闶闷闸闹闺闻闼闽闾闿阀阁阂阃阅阆阈阉阊阋阌阍阎阏阐阑阒阔阕阖阗阘阙阚阛队阳阴阵阶际陆陇陈陉陕陧陨险随隐隶隽难雏雠雳雾霁霉霭靓静靥鞑鞒鞯韦韧韩韪韫韬韵页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颋颌颍颎颏颐频颓颔颖颗题颙颚颛颜额颞颟颠颡颢颤颥颦颧风飏飐飒飓飔飕飖飘飙飚飞飨餍饣饥饦饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饿馀馁馂馃馄馅馆馇馈馉馊馋馌馍馎馏馐馑馒馓馔馕马驭驮驯驰驱驲驳驴驶驷驸驹驻驺驼驽驾驿骀骁骂骄骅骆骇骈骉骊骋验骏骐骑骒骓骖骗骘骚骛骜骝骞骟骠骡骢骣骤骥骦骧髅髋髌鬓魇魉鱼鱽鱾鱿鲀鲁鲂鲅鲆鲇鲈鲋鲍鲎鲐鲑鲒鲔鲕鲚鲛鲜鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲸鲹鲺鲻鲼鲽鳀鳁鳃鳄鳅鳆鳇鳊鳋鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳘鳙鳜鳝鳞鳟鳠鳡鳢鳣鸟鸠鸡鸢鸣鸥鸦鸧鸨鸩鸪鸫鸬鸭鸮鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹏鹐鹑鹒鹕鹖鹗鹘鹚鹛鹜鹞鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹮鹰鹱鹲鹳鹴鹾麦麸黄黉黡黩黪黾鼋鼍鼗鼹齄齐齑齿龀龁龂龃龄龅龆龇龈龉龊龋龌龙龚龛龟";

const TRADITIONAL_HINT_CHARS =
  "見們東丟兩嚴喪個豐臨為麗舉義烏樂喬習鄉書買亂爭於虧雲亞產畝親褻億僅從侖倉儀們價眾優夥會傘偉傳傷倫偽體餘傭僉俠侶僥偵側僑儈儕儂俁儔儼倆儷儉債傾傯僂僨償儻儐儲儺兒兌兗蘭關興養獸囅內岡冊寫軍農馮沖決況凍淨涼減湊凜幾鳳鳧憑凱擊氹鑿芻劉則剛創刪別剗剄剎劊劌剴劑剮劍剝劇勸辦務動勵勁勞勢勛勐勩勻匭匱區醫華協單賣盧鹵衛卻廠廳歷厲壓厭厙廁廂厴廈廚廄縣參雙發變敘疊葉號嘆嘰籲後嚇呂嗎噸聽啟吳吶嘸囈嘔嚦唄員咼嗆嗚詠嚨嚀噝吒響啞噠嘵嗶噦嘩噲嚌噥喲嘜嘮嗩喚嘖嗇囀齧囉嘽嘯噴嘍嚳囁噯噓嚶囑嚕囂團園囪圍圇國圖圓聖壙場阪壞塊堅壇壢壩塢墳墜壟壠壚壘墾堊墊埡墶壋塏堖塒塤堝垵塹墮壪牆壯聲殼壺處備復夠頭夾奪奩奐奮獎奧妝婦媽嫵嫗媯姍薑婁婭嬈嬌孌娛媧嫻嫿嬰嬋嬸媼嬡嬪嬙嬤孫學孿寧寶實寵審憲宮寬賓寢對尋導壽將爾塵嘗堯尷屍盡層屭屜屆屬屢屨嶼歲豈嶇崗峴嶴嵐島嶺嶽崬巋嶨峽嶠崢巒嶗崍嶮嶄嶸嶔嶁巔鞏巰幣帥師幃帳簾幟帶幀幫幬幘幗冪莊慶廬廡庫應廟龐廢廎廩開異棄張彌弳彎彈強歸當錄彞彥徹徑徠憶懺憂愾懷態慫憮慪悵愴憐總懟懌戀恆懇惡慟懨愷惻惱惲悅懸慳憫驚懼慘懲憊愜慚憚慣慍憤憒願懾懣懶懍戇戔戲戧戰戩戶紮撲託執擴捫掃揚擾撫拋摶摳掄搶護報擔擬攏揀擁攔擰撥擇掛摯攣掗撾撻挾撓擋撟掙擠揮撏撈損撿換搗據撚擄摑擲撣摻攬撳攙擱摟攪攜攝攄擺搖擯攤攖撐攆擷擼攛擻攢敵斂數齋斕鬥斬斷無舊時曠暘曇晝顯晉曬曉曄暈暉暫曖術機殺雜權條來楊傑極構樅樞棗櫪梘棖槍楓梟櫃檸檉梔柵標棧櫛櫳棟櫨櫟欄樹棲樣欒椏橈楨檔榿橋樺檜槳樁夢檮棶檢欞槨櫝槧欏橢樓欖榲櫬櫚櫸檟檻檳櫧橫檣櫻櫫櫥櫓櫞檁歡歟歐殲歿殤殘殞殮殫殯毆毀轂畢斃氈毿氌氣氫氬氳匯漢汙湯洶溝沒灃漚瀝淪滄滬濘淚澩瀧瀘濼瀉潑澤涇潔灑窪浹淺漿澆湞濁測澮濟瀏滻渾滸濃潯濤澇淶漣潿渦溳渙滌潤澗漲澀澱淵淥漬瀆漸漁瀋滲溫灣濕潰濺漵漊潷滾滯灩灄滿瀅濾濫灤濱灘澦灕濫瀠瀟瀲濰潛瀦瀾瀨瀕灝滅燈靈災燦煬爐燉煒熗點煉熾爍爛烴燭煙煩燒燁燴燙燼熱煥燜燾熅愛爺牘氂牽犧犢狀獷獁猶狽獰獨狹獅獪猙獄猻獫獵獼玀豬貓蝟獻獺璣瑪瑋環現瑲璽琺瓏璫琿璉瑣瓊瑤璦瓔瓚甕電畫暢疇癤療瘧癘瘍鬁瘡瘋皰痾癰痙癢瘂癆瘓癇癉瘞瘺癟癱癮癭癩癬癲皚皺皸盞鹽監蓋盜盤瞘眥著睜睞瞼瞞矚矯磯礬礦碭碼磚硨硯碸礪礱礫礎硜碩硤磽磑礄確鹼礙磧磣堿禮禡禕禰禎禱禍稟祿禪離禿稈種積稱穢穠穭稅穌穩穡窮竊竅窯竄窩窺竇窶豎競篤筍筆筧箋籠籩築篳篩簹箏籌簽簡籙簀篋籜籮簞簫簣簍籃籬籪籟糴類秈糶糲粵糞糧糝餱緊縶糾紅紂纖約級紈紀紉緯紜純紕紗綱納縱綸紛紙紋紡紐紓線紺紲紱練組紳細織終縐絆紼絀紹繹經綁絨結絝繞絰絎繪給絢絳絡絕絞統綆綃絹繡綌綏絛繼績緒綾續綺緋綽緔輥繩維綿綬繃綢綯綹綜綻綰綠綴緇緙緗緘緬纜緹緲緝縕繢緦綞緞緶線緱縋緩締縷編緡緣縉縛縟縝縫縗縞纏縭縊縑繽縹縵縲纓縮繆繅纈繚繕繒韁繾繰繯繳纘罌網羅罰罷羆羈羥羨翹翽翬耬聳恥聶聾職聹聯聵聰肅腸膚骯肴腎腫脹脅膽勝朧腖臚脛膠脈膾髒臍腦膿臠腳脫腡臉臘醃膕齶膩靦膃騰臏臢輿艤艦艙艫艱豔藝節羋薌蕪蘆蓯葦藶莧萇蒼苧蘇蘋莖蘢蔦塋煢繭荊薦薘莢蕘蓽蕎薈薺蕩榮葷滎犖熒蕁藎蓀蔭蕒葒葤藥蒞萊蓮蒔萵薟獲蕕瑩鶯蓴蘀蘿螢營縈蕭薩蔥蕆蕢蔣蔞藍薊蘺蕷鎣驀薔蘞藺藹蘄蘊藪蘚櫱虜慮虛蟲虯蟣雖蝦蠆蝕蟻螞蠶蜆蠱蠣蟶蠻蟄蛺蟯螄蠐蛻蝸蠟蠅蟈蟬蠍螻蠑螿蟎蠨釁銜補錶襯袞襖裊褘襪襲襏裝襠褌褳襝褲襇褸襤繈襴見觀覎規覓視覘覽覺覬覡覿覦覯覲覷觴觸觶讋譽謄計訂訃認譏訐訌討讓訕訖訓議訊記講諱謳詎訝訥許訛論訟諷設訪訣證詁訶評詛識詗詐訴診詆謅詞詘詔譯詒誆誄試詿詩詰詼誠誅詵話誕詬詮詭詢詣諍該詳詫諢詡誡誣語誚誤誥誘誨誑說誦誒請諸諏諾讀諑誹課諉諛誰諗調諂諒諄談誼謀諶諜謊諫諧謔謁謂諤諭諼讒諮諳諺諦謎諞諝謨讜謖謝謠謗諡謙謐謹謾謫譾謬譚譖譙讕譜譎讞譴譫穀豶貝貞負貢財責賢敗賬貨質販貪貧貶購貯貫貳賤賁貰貼貴貺貸貿費賀貽賊贄賈賄貲賃賂贓資賅贐賕賑賚賒賦賭齎贖賞賜賡賠賧賴賵贅賻賺賽賾贗贊贈贍贏贛趙趕趨趲躍蹌躒踐躂蹺蹕躚躋踴躊蹤躓躑躡蹣躕躥躪躦軀車軋軌軒軑軔轉軛輪軟轟軲軻轤軸軹軼軤軫轢軺輕軾載輊轎輈輇輅較輒輔輛輦輩輝輥輞輬輟輜輳輻輯輸轡轅轄輾轆轍轔辭闢辯辮邊遼達遷過邁運還這進遠違連遲邇逕跡適選遜遞邐邏遺遙鄧鄺鄔郵鄒鄴鄰鬱郟鄶鄭鄆酈鄖鄲醞醱醬釅釃釀釋裡鑒鑾鏨釓釔針釘釗釙釕釷釺釧釤釩釣鍆釹釵鈃鈣鈈鈦鉅鈍鈔鐘鈉鋇鋼鈑鈐鑰欽鈞鎢鉤鈧鈁鈥鈄鈕鈀鈺錢鉦鉗鈷缽鈳鉕鈽鈸鉞鑽鉬鉭鉀鈿鈾鐵鉑鈴鑠鉛鉚鈰鉉鉈鉍鈹鐸銬銠鉺銪鋏鋣鐃銍鐺銅鋁銱銦鎧鍘銖銑鋌銩鏵銓鎩鉿銚銘錚銫鉸銥鏟銃鐋銨銀銣鑄鐒鋪鋙錸鋱鏈鏗銷鎖鋰鍋鏽銼鋒鋅鐦鐧銳銻鋃鋟鋦錒錆鍺錯錨錛錡錁錕錫錮鑼錘錐錦鑕鍁錈鍃錇錟錠鍵鋸錳錙鍥鍇鏘鍶鍔鍤鍬鍾鍛鎪鍠鍰鎄鍍鎂鏤鎡鐨鎇鏌鎮鎛鎘鑷钂鐫鎳鎿鎦鎬鎊鎰鎵鑌鎔鏢鏜鏝鏍鏰鏡鏑鏃鏇鏐鐔钁鐐鏷鑥鐓鑭鐠鑹鏹鐙鑊鐳鐶鐲鐮鐿鑔鑣鑞鑲長門閂閃閆閉問闖閏閑間閔閌悶閘鬧閨聞闥閩閭闓閥閣閡閫閱閬閾閹閶鬩閿閽閻閼闡闌闃闊闋闔闐闒闕闞闤隊陽陰陣階際陸隴陳陘陝隉隕險隨隱隸雋難雛讎靂霧霽黴靄靚靜靨韃鞽韉韋韌韓韙韞韜韻頁頂頃頇項順須頊頑顧頓頎頒頌頏預顱領頗頸頡頰頲頜潁熲頦頤頻頹頷穎顆題顒顎顓顏額顳顢顛顙顥顫顬顰顴風颺颭颯颶颸颼颻飄飆飈飛饗饜飢飥餳飩餼飪飫飭飯飲餞飾飽飼飿飴餌饒餉餄餎餃餏餅餑餓餘餒餕餜餛餡館餷饋餶餿饞饁饃餺餾饈饉饅饊饌饢馬馭馱馴馳驅馹駁驢駛駟駙駒駐騶駝駑駕驛駘驍罵驕驊駱駭駢驫驪騁驗駿騏騎騍騅驂騙騭騷騖驁騮騫騸驃騾驄驏驟驥驦驤髏髖髕鬢魘魎魚魛魢魷魨魯魴鮁鮃鮎鱸鮒鮑鱟鮐鮭鮚鮪鮞鱭鮫鮮鯗鱘鯁鱺鰱鰹鯉鰣鰷鯀鯊鯇鯽鯖鯪鯫鯡鯤鯧鯝鯢鯰鯛鯨鰺鯴鯔鱝鰈鯷鰮鰓鱷鰍鰒鰉鯿鰠鰲鰭鰨鰥鰩鰳鰾鱈鱉鰻鰵鱅鱖鱔鱗鱒鱯鱤鱧鱣鳥鳩雞鳶鳴鷗鴉鶬鴇鴆鴣鶇鸕鴨鴞鴦鴟鴝鴛鴕鷥鷙鴯鴰鵂鴿鸞鴻鵓鸝鵑鵠鵝鵒鷳鵜鵡鵲鶓鵪鵬鵮鶉鶊鶘鶡鶚鶻鶿鶥鶩鷂鶺鷁鶼鶴鷖鸚鷓鷚鷯鷦鷲鷸鷺䴉鷹鸌鸏鸛鸘鹺麥麩黃黌黶黷黲黽黿鼉鞀鼴齇齊齏齒齔齕齗齟齡齙齠齜齦齬齪齲齷龍龔龕龜";

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
