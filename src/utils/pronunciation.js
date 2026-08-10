import { escapeHtml, escapeRegExp } from './text-utils.js';

export function formatPronunciationText(text, lang, isAlreadyEscaped = false) {
  if (lang === 'ja') {
    return formatJapaneseFurigana(text, isAlreadyEscaped);
  }
  if (lang === 'en') {
    return formatEnglishKeywordPronunciation(text, isAlreadyEscaped);
  }
  return isAlreadyEscaped ? text : escapeHtml(text);
}

function formatJapaneseFurigana(text, isAlreadyEscaped = false) {
  let escaped = isAlreadyEscaped ? text : escapeHtml(text);

  escaped = escaped.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, (match, base, reading) => {
    return `<ruby>${base}<rt>${reading}</rt></ruby>`;
  });

  const readings = {
    観光スポット: 'かんこうスポット',
    観光: 'かんこう',
    景色: 'けしき',
    場所: 'ばしょ',
    美しい: 'うつくしい',
    綺麗: 'きれい',
    有名: 'ゆうめい',
    人気: 'にんき',
    公園: 'こうえん',
    散歩: 'さんぽ',
    旅行: 'りょこう',
    最近: 'さいきん',
    元気: 'げんき',
    今日: 'きょう',
    明日: 'あした',
    昨日: 'きのう',
    昼: 'ひる',
    ご飯: 'はん',
    何: 'なに',
    時間: 'じかん',
    朝: 'あさ',
    昼: 'ひる',
    夜: 'よる',
    勉強: 'べんきょう',
    練習: 'れんしゅう',
    葡萄牙語: 'ポルトガルご',
    英語: 'えいご',
    中国語: 'ちゅうごくご',
    日本語: 'にほんご',
    金曜日: 'きんようび',
    月曜日: 'げつようび',
    火曜日: 'かようび',
    水曜日: 'すいようび',
    木曜日: 'もくようび',
    土曜日: 'どようび',
    日曜日: 'にちようび',
    確認: 'かくにん',
    更新: 'こうしん',
    修正: 'しゅうせい',
    変更: 'へんこう',
    送信: 'そうしん',
    請求書: 'せいきゅうしょ',
    番号: 'ばんごう',
    契約: 'けいやく',
    契約書: 'けいやくしょ',
    提案: 'ていあん',
    会議: 'かいぎ',
    顧客: 'こきゃく',
    取引先: 'とりひきさき',
    納期: 'のうき',
    配送: 'はいそう',
    配達: 'はいたつ',
    予定: 'よてい',
    保証: 'ほしょう',
    保証書: 'ほしょうしょ',
    発票: 'はっぴょう',
    書類: 'しょるい',
    資料: 'しりょう'
  };
  const keys = Object.keys(readings).sort((a, b) => b.length - a.length);
  if (!keys.length) return escaped;

  const pattern = new RegExp(`(<ruby[\\s\\S]*?<\\/ruby>)|(<[^>]+>)|(${keys.map(escapeRegExp).join('|')})`, 'g');
  return escaped.replace(pattern, (match, rubyBlock, tag, word) => {
    if (rubyBlock) return rubyBlock;
    if (tag) return tag;
    const reading = readings[word];
    return reading ? `<ruby>${word}<rt>${reading}</rt></ruby>` : word;
  });
}

function formatEnglishKeywordPronunciation(text, isAlreadyEscaped = false) {
  let html = isAlreadyEscaped ? text : escapeHtml(text);

  html = html.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, (match, word, pronunciation) => {
    return `<span class="keyword-pronunciation">${word}<small>${pronunciation}</small></span>`;
  });

  return html;
}
