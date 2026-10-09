#!/usr/bin/env node
// Fills reading/pronunciation data for basic vocabulary entries that were
// imported without it. Data is curated inline (all words are JLPT N5/N4
// or CEFR A1 level with unambiguous readings).

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const prodPath = requiredPath(args['product-db'], 'product-db');
const apply = args.apply === 'true';

const db = new Database(prodPath);
db.pragma('busy_timeout = 30000');

// Japanese kana readings
const jaReadings = {
  'する': 'する', 'いる': 'いる', 'ある': 'ある', '言う': 'いう', 'できる': 'できる',
  'こと': 'こと', 'とき': 'とき', 'もの': 'もの', 'これ': 'これ', 'それ': 'それ',
  'あれ': 'あれ', 'ここ': 'ここ', 'そこ': 'そこ', 'どこ': 'どこ', '人': 'ひと',
  '年': 'とし', '日': 'ひ', '時間': 'じかん', '今': 'いま', '私': 'わたし',
  'あなた': 'あなた', '彼': 'かれ', '彼女': 'かのじょ', '誰': 'だれ', '何': 'なに',
  'そう': 'そう', 'いい': 'いい', '多い': 'おおい', '少ない': 'すくない', '大きい': 'おおきい',
  '小さい': 'ちいさい', '新しい': 'あたらしい', '古い': 'ふるい', '高い': 'たかい', '安い': 'やすい',
  '長い': 'ながい', '短い': 'みじかい', '早い': 'はやい', '遅い': 'おそい', '強い': 'つよい',
  '弱い': 'よわい', '上手': 'じょうず', '下手': 'へた', '好き': 'すき', '嫌い': 'きらい',
  '美しい': 'うつくしい', '面白い': 'おもしろい', '楽しい': 'たのしい', '嬉しい': 'うれしい', '悲しい': 'かなしい',
  '怖い': 'こわい', '痛い': 'いたい', '眠い': 'ねむい', 'こんにちは': 'こんにちは', 'さようなら': 'さようなら',
  'ありがとう': 'ありがとう', 'すみません': 'すみません', 'おやすみなさい': 'おやすみなさい', 'こんばんは': 'こんばんは',
  'どうぞ': 'どうぞ', 'どうも': 'どうも', '大丈夫': 'だいじょうぶ', '危ない': 'あぶない',
  '覚える': 'おぼえる', '忘れる': 'わすれる', '食べる': 'たべる', '飲む': 'のむ',
  '行く': 'いく', '来る': 'くる', '見る': 'みる', '聞く': 'きく', '話す': 'はなす',
  '読む': 'よむ', '書く': 'かく', '買う': 'かう', '売る': 'うる', '作る': 'つくる',
  '使う': 'つかう', '持つ': 'もつ'
};

// Portuguese IPA pronunciations
const ptPronunciations = {
  "eu": "/ˈew/", "você": "/voˈse/", "não": "/nɐ̃w̃/", "que": "/ki/",
  "a": "/a/", "o": "/o/", "e": "/i/", "do": "/du/", "da": "/da/",
  "em": "/ẽj̃/", "um": "/ũ/", "para": "/ˈpaɾɐ/", "com": "/kõ/",
  "uma": "/ˈũmɐ/", "os": "/us/", "no": "/nu/", "se": "/si/",
  "as": "/as/", "das": "/das/", "como": "/ˈkomu/", "mas": "/mas/",
  "ao": "/aw/", "ele": "/ˈeli/", "à": "/a/", "seu": "/ˈsew/",
  "sua": "/ˈsuɐ/", "ou": "/ow/", "quando": "/ˈkwɐ̃du/", "muito": "/ˈmujɲtu/",
  "também": "/tɐ̃ˈbẽj̃/", "só": "/sɔ/", "já": "/ʒa/",
  "aqui": "/aˈki/", "lá": "/ˈla/", "bem": "/bẽj̃/", "tudo": "/ˈtudu/",
  "nada": "/ˈnadɐ/", "algo": "/ˈawɡu/", "alguém": "/awˈgẽj̃/",
  "ninguém": "/nĩˈgẽj̃/", "cada": "/ˈkadɐ/", "pouco": "/ˈpowku/",
  "grande": "/ˈɡɾɐ̃dʒi/", "pequeno": "/peˈkẽnu/", "bom": "/bõ/",
  "mau": "/maw/", "novo": "/ˈnovu/", "velho": "/ˈveʎu/",
  "bonito": "/boˈnitu/", "feio": "/ˈfeju/", "caro": "/ˈkaɾu/",
  "barato": "/baˈɾatu/", "fácil": "/ˈfasiw/", "difícil": "/dʒiˈfisiw/",
  "rápido": "/ˈχapidu/", "lento": "/ˈlẽtu/", "quente": "/ˈkẽtʃi/",
  "frio": "/ˈfɾiu/", "chuva": "/ˈʃuva/", "sol": "/sɔw/",
  "dia": "/ˈdʒiɐ/", "noite": "/ˈnɔitʃi/", "manhã": "/mɐˈɲɐ̃/",
  "tarde": "/ˈtaɾdʒi/", "hoje": "/ˈoʒi/", "amanhã": "/ɐmɐˈɲɐ̃/",
  "ontem": "/ˈõtẽj̃/", "agora": "/ɐˈɡɔɾɐ/",
  "depois": "/deˈpojs/", "antes": "/ˈɐ̃tʃis/", "casa": "/ˈkazɐ/",
  "escola": "/isˈkɔlɐ/", "trabalho": "/tɾɐˈbaʎu/", "amigo": "/ɐˈmiɡu/",
  "família": "/fɐˈmiliɐ/", "comida": "/kuˈmidɐ/", "água": "/ˈaɡwɐ/",
  "tempo": "/ˈtẽpu/", "ano": "/ˈɐnu/", "mês": "/ˈmes/",
  "semana": "/seˈmɐ̃nɐ/", "hora": "/ˈɔɾɐ/", "olá": "/ɔˈla/",
  "tchau": "/ˈtʃaw/", "obrigado": "/obɾiˈɡadu/", "desculpa": "/dʒisˈkuwpa/",
  "sim": "/sĩ/", "onde": "/ˈõdʒi/", "o que": "/u ki/",
  "por quê": "/puɾ ˈke/", "bom dia": "/bõ ˈdʒiɐ/",
  "boa tarde": "/ˈboɐ ˈtaɾdʒi/", "boa noite": "/ˈboɐ ˈnɔitʃi/",
  "de nada": "/dʒi ˈnadɐ/"
};

// Chinese pinyin readings
const zhPinyin = {
  '时间': 'shíjiān', '天气': 'tiānqì', '看电影': 'kàn diànyǐng',
  '买东西': 'mǎi dōngxi', '喝水': 'hē shuǐ', '坐车': 'zuò chē',
  '问路': 'wèn lù', '孩子': 'háizi', '工作': 'gōngzuò',
  '已经': 'yǐjīng', '怎么': 'zěnme', '哪里': 'nǎlǐ',
  '这些': 'zhèxiē', '春节': 'chūnjié', '昨天': 'zuótiān',
  '晚上好': 'wǎnshang hǎo', '以后': 'yǐhòu'
};

// English IPA
const enIPA = {
  'I': '/aɪ/', 'a': '/ə/', 'thank you': '/ˈθæŋk juː/'
};

const stats = { apply, ja_updated: 0, pt_updated: 0, zh_updated: 0, en_updated: 0, not_found: 0 };

const updateLoc = db.prepare("UPDATE product_localizations SET reading = ?, reading_system = ?, pronunciation = ?, pronunciation_system = ? WHERE product_sense_id = (SELECT s.id FROM product_senses s JOIN product_entries e ON e.id = s.product_entry_id WHERE e.headword = ? AND e.primary_lang = ? AND e.status = 'accepted' LIMIT 1) AND lang = ? AND (reading IS NULL AND pronunciation IS NULL)");

function applyPronunciation(data, lang, system, statsKey) {
  for (const [word, value] of Object.entries(data)) {
    const isIPA = lang !== 'ja' || system === 'ipa';
    const info = updateLoc.run(
      lang === 'ja' ? value : null,
      lang === 'ja' ? 'kana' : null,
      lang !== 'ja' ? value : null,
      lang !== 'ja' ? 'ipa' : null,
      word, lang, lang
    );
    if (info.changes > 0) stats[statsKey]++;
    else stats.not_found++;
  }
}

const txn = apply ? db.transaction(() => {
  applyPronunciation(jaReadings, 'ja', 'kana', 'ja_updated');
  applyPronunciation(ptPronunciations, 'pt-BR', 'ipa', 'pt_updated');
  applyPronunciation(zhPinyin, 'zh', 'pinyin', 'zh_updated');
  applyPronunciation(enIPA, 'en', 'ipa', 'en_updated');
}) : null;
if (apply) txn();

console.log(JSON.stringify({ ...stats, quick_check: db.prepare('PRAGMA quick_check').get().quick_check }));
db.close();

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const p = path.resolve(value);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return p;
}
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    result[argv[i].slice(2)] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return result;
}
