import Database from "better-sqlite3";

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const dryRun = args["dry-run"] === "true";

const repairs = [
  zh(2, "接续助词", "jiē xù zhù cí", "日语助词，用于连接动词或句子，表示动作顺序、方式、原因或状态变化。"),
  zh(3, "原因助词", "yuán yīn zhù cí", "日语助词，用于表示原因或理由，相当于“因为”“由于”。"),
  zh(2381, "并列理由助词", "bìng liè lǐ yóu zhù cí", "日语助词，用于列举理由或解释情况，常带有辩解、强调或轻微抱怨的语气。"),
  zh(2382, "引用助词", "yǐn yòng zhù cí", "日语助词，用于标记引用内容、关联关系或等同关系，相当于“和”“与”“作为”。"),
  zh(2383, "条件助词", "tiáo jiàn zhù cí", "日语助词，用于表示假定条件，意为“如果”“要是”。"),
  zh(4, "过去助动词", "guò qù zhù dòng cí", "日语助动词，表示动作或状态已经完成，相当于“了”“过”。"),
  zh(2385, "完成助动词", "wán chéng zhù dòng cí", "日语助动词，用于表示动作完成或状态持续。"),
  zh(6, "格助词", "gé zhù cí", "日语格助词，表示动作目标、方向、归着点或存在地点等。"),
  zh(2386, "地点格助词", "dì diǎn gé zhù cí", "日语格助词，用于表示动作发生的地点、时间、手段或原因。"),
  zh(11, "转折连词", "zhuǎn zhé lián cí", "日语连词，用于连接前后意思相反或相对的分句，相当于“但是”。"),
  zh(2396, "条件助词", "tiáo jiàn zhù cí", "日语助词，用于表示假设条件或时间先后顺序，意为“如果”“假如”。"),
  zh(23, "疑问语气助词", "yí wèn yǔ qì zhù cí", "日语语气助词，用于表示疑问或轻微惊讶。"),
  zh(2399, "拨音助词", "bō yīn zhù cí", "日语鼻音假名，可作为语气成分表示否定、疑问或强调。"),
  zh(2410, "起点助词", "qǐ diǎn zhù cí", "日语助词，用于表示比较、时间或空间的起点，相当于“从”。"),
  zh(2422, "口语系词", "kǒu yǔ xì cí", "日语口语系词或主题标记，相当于“是”或“作为”。"),
  zh(69, "条件助词", "tiáo jiàn zhù cí", "日语助词，用于表示假设或条件，相当于“如果”“要是”。"),
  zh(2431, "条件时间助词", "tiáo jiàn shí jiān zhù cí", "日语助词，用于表示条件或时间关系，相当于“如果……的话”或“一……就……”。"),
  zh(75, "引用助词", "yǐn yòng zhù cí", "日语口语助词，用于引用话语或表示原因，相当于“说”“因为”。"),
  zh(2432, "让步助词", "ràng bù zhù cí", "日语助词，用于表示让步或假设，意为“即使是”“就算”。"),
  zh(164, "否定推量助动词", "fǒu dìng tuī liàng zhù dòng cí", "古典日语助动词，用于表示否定推测。"),
  zh(229, "招呼感叹词", "zhāo hu gǎn tàn cí", "日语感叹词，用于引起对方注意或开始通话，相当于“喂”。"),
  zh(2611, "推测语气助词", "tuī cè yǔ qì zhù cí", "日语语气助词，用于表达疑问、推测或希望。"),
  zh(2683, "水", "shuǐ", "无色、无味的液体，是生命活动所必需的物质。"),
  zh(2764, "情况", "qíng kuàng", "事情发生的条件、场合或状态。"),
  zh(805, "笑点", "xiào diǎn", "故事、笑话或表演结尾处引人发笑的关键部分。"),
  zh(2788, "下降", "xià jiàng", "位置、程度或数值向下移动或降低。"),
  zh(2994, "鸟", "niǎo", "鸟类动物，通常有羽毛、翅膀和喙。"),
  zh(2998, "满的", "mǎn de", "装满的；达到容量或程度上限的。"),
  zh(3033, "让步连词", "ràng bù lián cí", "日语连词，用于表示转折或让步，相当于“虽然”“尽管”。"),
  zh(3159, "剪裁", "jiǎn cái", "对布料、头发或材料进行切割、修整的动作或工艺。"),
  zh(3188, "停车", "tíng chē", "使车辆停放在某处。"),
  zh(1858, "尊称", "zūn chēng", "对贵族、上级或受尊敬者使用的敬称。"),
  ja(19, "〜のために", "のために", "目的、理由、期間、交換などを表す英語の前置詞。"),
  ja(65, "〜するつもり", "するつもり", "未来の意志や予測を表す英語の助動詞。"),
  ja(71, "として", "として", "役割、資格、同等性、様態などを表す英語の機能語。"),
  ja(72, "誰", "だれ", "人について尋ねる疑問代名詞。"),
  ja(138, "〜すべき", "すべき", "義務、推量、仮定、条件などを表す英語の助動詞。"),
  ja(503, "〜しなければならない", "しなければならない", "義務、命令、約束、未来などを表す英語の助動詞。")
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const before = warningCounts(db);
const update = db.prepare(`
  UPDATE product_localizations
  SET term = @term,
      reading = @reading,
      reading_system = @reading_system,
      pronunciation = NULL,
      pronunciation_system = NULL,
      definition = @definition,
      source = 'manual:deterministic-quality-repair',
      confidence = 0.9,
      needs_review = 0
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

let changed = 0;
if (!dryRun) {
  const tx = db.transaction(() => {
    for (const repair of repairs) changed += update.run(repair).changes;
  });
  tx();
}

const after = warningCounts(db);
console.log(JSON.stringify({
  ok: true,
  db: dbPath,
  dry_run: dryRun,
  planned_repairs: repairs.length,
  changed,
  before,
  after
}, null, 2));
db.close();

function zh(senseId, term, reading, definition) {
  return { sense_id: senseId, lang: "zh", term, reading, reading_system: "pinyin", definition };
}

function ja(senseId, term, reading, definition) {
  return { sense_id: senseId, lang: "ja", term, reading, reading_system: "kana", definition };
}

function warningCounts(database) {
  return {
    zh_terms_with_kana: database.prepare(`
      SELECT COUNT(*) AS n
      FROM product_localizations
      WHERE lang='zh'
        AND needs_review=0
        AND (term GLOB '*[ぁ-んァ-ン]*' OR definition GLOB '*[ぁ-んァ-ン]*')
    `).get().n,
    ja_terms_with_latin_only: database.prepare(`
      SELECT COUNT(*) AS n
      FROM product_localizations
      WHERE lang='ja'
        AND needs_review=0
        AND term GLOB '*[A-Za-z]*'
        AND term NOT GLOB '*[ぁ-んァ-ン一-龯]*'
    `).get().n
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}
