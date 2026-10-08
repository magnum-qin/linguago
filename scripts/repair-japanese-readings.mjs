#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function normalizeJapaneseKanaReading(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s・.／/、，,]+/gu, '')
    .replace(/[ァ-ヶ]/gu, (character) => String.fromCodePoint(character.codePointAt(0) - 0x60));
}

function isValidJapaneseKanaReading(value) {
  const reading = normalizeJapaneseKanaReading(value);
  return Boolean(reading) && !reading.includes('\uFFFD') && /^[\p{Script=Hiragana}ー]+$/u.test(reading);
}

// Curated exact readings for the identified kanji / latin / multi-source anomalies
const EXACT_READING_OVERRIDES = {
  // Kanji in readings
  72131: { reading: '〜のために', term: '〜のために' }, // behalf の意味
  164561: { reading: 'かたくな' }, // かたくな -> 固く
  161241: { reading: 'かぶり' }, // かぶり -> 被り
  161313: { reading: 'こたえ' }, // こたえ -> 答え
  36677: { reading: 'そのご' }, // その後 -> その後
  161317: { reading: 'なまり' }, // なまり -> 訛り
  166337: { reading: 'よい' }, // よい -> 良い
  125481: { reading: 'よりかしこい' }, // より賢い -> より 贤い
  66214: { reading: 'うさぎのすあな' }, // ウサギの巣穴 -> うさぎのすな穴
  22920: { reading: 'ばるぶ・すいっち・もんのようこうぞうぶつ' }, // 门
  24903: { reading: 'ふぃるむ・てれびどらま・しゃしん・れこーど' }, // 片
  115037: { reading: 'いちばんかしこい' }, // 一番賢い -> いちばん 贤い
  66969: { reading: 'ほかにせんたくしがない' }, // 他に選択肢がない
  164833: { reading: 'ぞくっぽい' }, // 俗っぽい
  5627: { reading: 'こじんてきな' }, // 個人的な -> こてき的な
  148745: { reading: 'てんけいてきに' }, // 典型的に -> ていてき的に
  125921: { reading: 'うつし' }, // 写し
  69375: { reading: 'であう' }, // 出会う -> で会う
  87065: { reading: 'であう' }, // 出会う -> で会う
  57325: { reading: 'りえきをえる' }, // 利益を得る
  123021: { reading: 'ほくせい' }, // 北西 -> きたに西
  119257: { reading: 'はきけ' }, // 吐き気
  97429: { reading: 'とうがらし' }, // 唐辛子 -> からしん子
  85369: { reading: 'やかんの' }, // 夜間の -> や間の
  41807: { reading: 'けんおかんのある' }, // 嫌悪感のある
  89297: { reading: 'ゆうれいがでるとされる' }, // 幽霊が出るとされる
  35233: { reading: 'てっていてきな' }, // 徹底的な
  38850: { reading: 'せいてきな' }, // 性的な -> てき的な
  72188: { reading: 'なやんだ' }, // 悩んだ
  83673: { reading: 'いぎ' }, // 意義 -> ぎ義
  161221: { reading: 'おく' }, // おく -> 置く
  119385: { reading: 'いぎ' }, // 意義 -> ぎ義
  36662: { reading: 'おろかな' }, // 愚かな -> 愚かな
  21542: { reading: 'もうどうのとう' }, // 懵懂の「懂」
  56671: { reading: 'てがみをかく' }, // 手紙を書く
  49052: { reading: 'てくび' }, // 手首
  35162: { reading: 'こいに' }, // 故意に
  98405: { reading: 'くまににたどうぶつ' }, // 熊に似た動物
  85741: { reading: 'もうしたて' }, // 申し立て
  35510: { reading: 'おとこのこ' }, // 男の子
  155377: { reading: 'おとこのこ' }, // 男の子
  80113: { reading: 'たちさる' }, // 立ち去る
  125529: { reading: 'いじする' }, // 維持する
  91733: { reading: 'かしこい' }, // 賢い
  163693: { reading: 'かしこく' }, // 賢く
  86933: { reading: 'あしくび' }, // 足首
  159921: { reading: 'とほうにくれる' }, // 途方に暮れる
  169769: { reading: 'ひなんのよちがない' }, // 非難の余地がない
  117313: { reading: 'けんびきょうかぎょうしゅうしすう' }, // 顕微鏡下凝集指数
  151921: { reading: 'ねがわくば' }, // 願わくば
  22931: { reading: 'のなか' }, // ～の中
  72197: { reading: 'のなかに' }, // ～の中に
  22930: { reading: 'のあいだ' }, // ～の間
  24922: { reading: 'のあいだに' }, // ～の間に

  // Special katakana cases
  45526: { reading: 'えりざべす' }, // エリザベス
  26817: { reading: 'じぇーむず' }, // ジェームズ
  36727: { reading: 'ふぃるはーもにー' }, // フィル
  54044: { reading: 'ぶれーど' }, // ブレード
  115465: { reading: 'ぽーとらんど' }, // ポートランド

  // Latin letters in readings
  78277: { reading: 'でぃーじばぐ' }, // D字馬具
  54466: { reading: 'ぶいじへんたい' }, // V字編隊
  146993: { reading: 'かんがるー' }, // カンガルー -> かanguーる
  160825: { reading: 'しろあり' }, // シロアリ -> kana: しろあり
  54687: { reading: 'たいみんぐ' }, // タイミング -> たいming
  126093: { reading: 'はらすめんと', term: 'ハラスメント' }, // ハーassing
  169077: { reading: 'もろっこの' }, // モロッコの -> モロッコ no
  32237: { reading: 'そば' }, // 側 -> そば (soba)
  25276: { reading: 'にいさん' }, // 兄さん -> にisan
  85001: { reading: 'せいてい' }, // 制定 -> せいtei
  22768: { reading: 'しょうのいたいじ' }, // 小の異体字
  32652: { reading: 'にじゅうのいたいじ' }, // 廿の異体字
  115753: { reading: 'ゆうえき' }, // 有益 -> ゆうeki
  165513: { reading: 'まつ' }, // 松 -> まつ (matsu)
  123889: { reading: 'おすうま' }, // 牡馬 -> おsmうま
  25624: { reading: 'りのいたいじ' }, // 理の異体字
  53290: { reading: 'きょうのいたいじ' }, // 腥の異体字
  1349: { reading: 'じぶんで' }, // 自分で -> じぶんde
  160513: { reading: 'すすめ' }, // 薦め -> すすme
  37200: { reading: 'むし' }, // 蠆 -> むし (mushi)
  166441: { reading: 'こうし' }, // 講師 -> こうshi
  26775: { reading: 'けん・ふん' }, // 量詞：件[jian4]、份[fen4]
  24430: { reading: 'はながつまった' }, // 鼻が詰まった -> hanaがつまった
  22872: { reading: 'でせんと' } // decentな -> でせん-な
};

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'D:/linguago-runner/data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const outReportPath = path.resolve(args.out || 'D:/linguago-runner/logs/repair-japanese-readings-report.json');
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: !apply });
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

console.log(`Starting Japanese readings repair (apply=${apply})...`);

const rows = db.prepare(`
  SELECT pl.id, pl.product_sense_id, pl.term, pl.reading, pl.reading_system,
         ps.product_entry_id, pe.headword, pe.frequency_rank
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pl.lang = 'ja'
    AND ps.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
    )
`).all();

const updateReading = db.prepare(`
  UPDATE product_localizations
  SET reading = @reading,
      reading_system = 'hiragana'
  WHERE id = @id
`);

const updateReadingAndTerm = db.prepare(`
  UPDATE product_localizations
  SET reading = @reading,
      term = @term,
      reading_system = 'hiragana'
  WHERE id = @id
`);

const stats = {
  apply,
  total_audited: rows.length,
  overrides_applied: 0,
  katakana_normalized: 0,
  punctuation_cleaned: 0,
  skipped: 0,
  sample_repairs: []
};

const repairs = [];

for (const row of rows) {
  let targetReading = null;
  let targetTerm = null;
  let reason = '';

  // 1. Check exact overrides
  if (EXACT_READING_OVERRIDES[row.id]) {
    const override = EXACT_READING_OVERRIDES[row.id];
    targetReading = override.reading;
    if (override.term) targetTerm = override.term;
    reason = 'exact_curated_override';
  } else {
    let reading = String(row.reading || '').trim();

    // Clean wave dash and common punctuation prefixes/suffixes
    let cleaned = reading
      .replace(/^[〜~～\-ー\s]+/gu, '')
      .replace(/[〜~～\-ー\s]+$/gu, '')
      .replace(/[（(][^）)]*[）)]/gu, '')
      .trim();

    // If cleaned starts with "kana:" or similar label
    cleaned = cleaned.replace(/^kana:\s*/i, '').trim();

    // Katakana normalization
    const normalizedHiragana = normalizeJapaneseKanaReading(cleaned);

    if (normalizedHiragana && normalizedHiragana !== row.reading) {
      if (isValidJapaneseKanaReading(normalizedHiragana)) {
        targetReading = normalizedHiragana;
        reason = /[ァ-ヶ]/u.test(row.reading) ? 'katakana_normalized' : 'punctuation_cleaned';
      }
    }
  }

  if (targetReading && targetReading !== row.reading) {
    repairs.push({
      id: row.id,
      sense_id: row.product_sense_id,
      headword: row.headword,
      term: targetTerm || row.term,
      old_reading: row.reading,
      new_reading: targetReading,
      reason
    });
  }
}

console.log(`Found ${repairs.length} Japanese reading repairs.`);

if (apply) {
  const transaction = db.transaction(() => {
    for (const r of repairs) {
      if (r.term !== r.headword && r.term !== r.new_reading) {
        updateReadingAndTerm.run({ id: r.id, reading: r.new_reading, term: r.term });
      } else {
        updateReading.run({ id: r.id, reading: r.new_reading });
      }
      if (r.reason === 'exact_curated_override') stats.overrides_applied++;
      else if (r.reason === 'katakana_normalized') stats.katakana_normalized++;
      else stats.punctuation_cleaned++;
    }
  });

  transaction();
} else {
  for (const r of repairs) {
    if (r.reason === 'exact_curated_override') stats.overrides_applied++;
    else if (r.reason === 'katakana_normalized') stats.katakana_normalized++;
    else stats.punctuation_cleaned++;
  }
}

stats.sample_repairs = repairs.slice(0, 30);

fs.mkdirSync(path.dirname(outReportPath), { recursive: true });
fs.writeFileSync(outReportPath, JSON.stringify(stats, null, 2), 'utf8');

db.close();

console.log('Japanese readings repair complete:');
console.log(JSON.stringify({
  total_audited: stats.total_audited,
  repairs_count: repairs.length,
  overrides_applied: stats.overrides_applied,
  katakana_normalized: stats.katakana_normalized,
  punctuation_cleaned: stats.punctuation_cleaned,
  apply,
  outReportPath
}, null, 2));

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}
