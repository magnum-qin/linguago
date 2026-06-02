import { escapeHtml, escapeRegExp } from "./text-utils.js";

export function formatPronunciationText(text, lang) {
  if (lang === "ja") {
    return formatJapaneseFurigana(text);
  }
  if (lang === "en") {
    return formatEnglishKeywordPronunciation(text);
  }
  return escapeHtml(text);
}

function formatJapaneseFurigana(text) {
  const readings = {
    観光スポット: "かんこうスポット",
    観光: "かんこう",
    景色: "けしき",
    場所: "ばしょ",
    美しい: "うつくしい",
    綺麗: "きれい",
    有名: "ゆうめい",
    人気: "にんき",
    公園: "こうえん",
    散歩: "さんぽ",
    旅行: "りょこう",
    今日: "きょう",
    明日: "あした",
    昨日: "きのう",
    朝: "あさ",
    昼: "ひる",
    夜: "よる",
    勉強: "べんきょう",
    練習: "れんしゅう",
    葡萄牙語: "ポルトガルご",
    英語: "えいご",
    中国語: "ちゅうごくご",
    日本語: "にほんご",
    金曜日: "きんようび",
    月曜日: "げつようび",
    火曜日: "かようび",
    水曜日: "すいようび",
    木曜日: "もくようび",
    土曜日: "どようび",
    日曜日: "にちようび",
    確認: "かくにん",
    更新: "こうしん",
    修正: "しゅうせい",
    変更: "へんこう",
    送信: "そうしん",
    請求書: "せいきゅうしょ",
    番号: "ばんごう",
    契約: "けいやく",
    契約書: "けいやくしょ",
    提案: "ていあん",
    会議: "かいぎ",
    顧客: "こきゃく",
    取引先: "とりひきさき",
    納期: "のうき",
    配送: "はいそう",
    配達: "はいたつ",
    予定: "よてい",
    保証: "ほしょう",
    保証書: "ほしょうしょ",
    発票: "はっぴょう",
    書類: "しょるい",
    資料: "しりょう"
  };
  const keys = Object.keys(readings).sort((a, b) => b.length - a.length);
  if (!keys.length) return escapeHtml(text);

  const pattern = new RegExp(keys.map(escapeRegExp).join("|"), "g");
  return escapeHtml(text).replace(pattern, (match) => {
    const reading = readings[match];
    return reading ? `<ruby>${escapeHtml(match)}<rt>${escapeHtml(reading)}</rt></ruby>` : match;
  });
}

function formatEnglishKeywordPronunciation(text) {
  const pronunciations = {
    scenic: "SEE-nik",
    beautiful: "BYOO-tuh-ful",
    tourist: "TOOR-ist",
    attraction: "uh-TRAK-shun",
    sightseeing: "SITE-see-ing",
    popular: "POP-yuh-ler",
    famous: "FAY-mus",
    wonderful: "WUN-der-ful",
    gorgeous: "GOR-jus",
    amazing: "uh-MAY-zing",
    exercise: "EK-ser-syz",
    exercises: "EK-ser-syz-iz",
    practice: "PRAK-tis",
    portuguese: "POR-chuh-geez",
    language: "LANG-gwij",
    coffee: "KAW-fee",
    morning: "MOR-ning",
    tomorrow: "tuh-MOR-oh",
    tonight: "tuh-NITE",
    afternoon: "af-ter-NOON",
    together: "tuh-GEH-ther",
    confirm: "kuhn-FURM",
    confirmed: "kuhn-FURMD",
    invoice: "IN-voys",
    number: "NUM-ber",
    contract: "KON-trakt",
    revised: "ri-VYZD",
    revision: "ri-VIZH-un",
    proposal: "pruh-POH-zul",
    supplier: "suh-PLY-er",
    vendor: "VEN-der",
    delivery: "di-LIV-er-ee",
    schedule: "SKEJ-ool",
    immediately: "ih-MEE-dee-it-lee",
    warranty: "WOR-un-tee",
    meeting: "MEE-ting",
    decision: "di-SIZH-un",
    client: "KLY-ent",
    review: "ri-VYOO",
    document: "DOK-yoo-ment"
  };
  const words = text.match(/\b[A-Za-z][A-Za-z'-]{4,}\b/g) || [];
  const targets = [...new Set(
    words
      .map((word) => word.toLowerCase())
      .filter((word) => pronunciations[word] || shouldAnnotateEnglishWord(word))
  )].slice(0, 4);
  let html = escapeHtml(text);

  for (const target of targets) {
    const pattern = new RegExp(`\\b${escapeRegExp(target)}\\b`, "i");
    html = html.replace(pattern, (match) => {
      const pronunciation = pronunciations[target] || approximateEnglishPronunciation(match);
      return `<span class="keyword-pronunciation">${escapeHtml(match)}<small>${escapeHtml(pronunciation)}</small></span>`;
    });
  }

  return html;
}

function shouldAnnotateEnglishWord(word) {
  const normalized = String(word || "").toLowerCase();
  if (normalized.length < 7) return false;
  return /tion|sion|ous|eous|ious|cial|tial|gh|ph|ch|qu|gue|ese|ique|ology|graphy|beautiful|scenic/u.test(normalized);
}

function approximateEnglishPronunciation(word) {
  const value = String(word || "").toLowerCase();
  const syllables = value
    .replace(/tion\b/g, "shun")
    .replace(/sion\b/g, "zhun")
    .replace(/ph/g, "f")
    .replace(/gh\b/g, "")
    .replace(/qu/g, "kw")
    .replace(/c(?=e|i|y)/g, "s")
    .replace(/c/g, "k")
    .replace(/([aeiouy]+)(?=[bcdfghjklmnpqrstvwxyz])/g, "$1-")
    .replace(/-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 4);
  return syllables.length ? syllables.join("-") : value;
}
