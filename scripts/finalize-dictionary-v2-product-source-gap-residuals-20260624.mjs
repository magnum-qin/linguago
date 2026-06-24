import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const LANGS = ["en", "pt-BR", "zh", "ja"];
const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const SOURCE = "manual:source-gap-residual-finalize-20260624";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] !== "false";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const records = [
  rec(608559, 608559, "en", "sakes", 6018, "reasons or purposes", null, {
    en: ipa("sakes", "/seɪks/", "Plural form of sake; reasons or purposes for which something is done."),
    "pt-BR": ipa("razões", "/ʁaˈzõjs/", "Motivos ou finalidades pelos quais algo é feito."),
    zh: reading("缘故", "yuán gù", "pinyin", "表示原因、目的或为了某事的缘由。"),
    ja: reading("ため", "ため", "kana", "目的や理由を表す語。何かの利益や理由を示す。")
  }),
  rec(249511, 249511, "en", "facebook", 6140, "social networking service", null, {
    en: ipa("facebook", "/ˈfeɪsbʊk/", "A social networking service or its website and app."),
    "pt-BR": ipa("Facebook", "/ˈfejs.buk/", "Rede social e plataforma on-line de comunicação."),
    zh: reading("脸书", "liǎn shū", "pinyin", "一种社交网络服务或其网站和应用。"),
    ja: reading("フェイスブック", "フェイスブック", "kana", "オンラインのソーシャルネットワークサービス。")
  }),
  rec(218429, 218429, "en", "dvd", 6390, "digital video disc", "noun", {
    en: ipa("dvd", "/ˌdiː viː ˈdiː/", "A digital optical disc used for video or data storage."),
    "pt-BR": ipa("DVD", "/ˌde.veˈde/", "Disco óptico digital usado para vídeo ou dados."),
    zh: reading("数字光盘", "shù zì guāng pán", "pinyin", "用于存储视频或数据的数字光学盘。"),
    ja: reading("ディーブイディー", "ディーブイディー", "kana", "映像やデータを記録するデジタル光ディスク。")
  }),
  rec(677440, 677440, "en", "supposedly", 6987, "believed or reputed to be the case", "adverb", {
    en: ipa("supposedly", "/səˈpoʊzɪdli/", "According to what is generally believed or claimed."),
    "pt-BR": ipa("supostamente", "/su.pos.taˈmẽ.tʃi/", "De acordo com o que se acredita ou se afirma."),
    zh: reading("据说", "jù shuō", "pinyin", "表示根据传闻或一般说法如此。"),
    ja: reading("と言われている", "といわれている", "kana", "一般にそうだと言われていることを表す。")
  }),
  rec(531936, 531936, "en", "pinch", 7016, "squeeze with the fingers", null, {
    en: ipa("pinch", "/pɪntʃ/", "To squeeze something tightly between fingers; also a small squeeze or difficult situation."),
    "pt-BR": ipa("beliscão", "/be.liʃˈkɐ̃w/", "Ato de apertar algo com os dedos; aperto ou beliscão."),
    zh: reading("捏", "niē", "pinyin", "用手指夹住并用力挤压。"),
    ja: reading("つねる", "つねる", "kana", "指で皮膚などを強く挟んで押す。")
  }),
  rec(1079246, 1079246, "pt-BR", "regular", 7737, "normal", "adjective", {
    en: ipa("normal", "/ˈnɔːrməl/", "Usual, standard, or within the expected pattern."),
    "pt-BR": ipa("regular", "/ʁe.guˈlaʁ/", "Que segue um padrão normal, comum ou esperado."),
    zh: reading("正常", "zhèng cháng", "pinyin", "符合通常情况或一般标准。"),
    ja: reading("普通", "ふつう", "kana", "通常の状態で、特別ではないこと。")
  }),
  rec(342491, 342491, "en", "iii", 7756, "three; Roman numeral three", "numeral", {
    en: ipa("iii", "/θriː/", "The Roman numeral or written form representing the number three."),
    "pt-BR": ipa("três", "/tɾejs/", "Número cardinal equivalente a um mais um mais um."),
    zh: reading("三", "sān", "pinyin", "数字三，表示二加一的数量。"),
    ja: reading("三", "さん", "kana", "数の三。一、二の次の数。")
  }),
  rec(181264, 181264, "en", "daly", 8103, "disability-adjusted life year", "abbreviation", {
    en: ipa("daly", "/ˈdæli/", "An abbreviation for disability-adjusted life year, a public-health burden measure."),
    "pt-BR": ipa("ano de vida ajustado por incapacidade", "/ˈɐ.nu dʒi ˈvi.dɐ a.ʒuʃˈta.du poʁ ĩ.ka.pa.siˈda.dʒi/", "Medida de carga de doença baseada em anos de vida ajustados por incapacidade."),
    zh: reading("伤残调整生命年", "shāng cán tiáo zhěng shēng mìng nián", "pinyin", "衡量疾病负担的公共卫生指标。"),
    ja: reading("障害調整生存年", "しょうがいちょうせいせいぞんねん", "kana", "疾病負担を表す公衆衛生上の指標。")
  }),
  rec(1115024, 1115024, "pt-BR", "cereal", 8124, "grain", "noun", {
    en: ipa("grain", "/ɡreɪn/", "A seed or crop such as wheat, rice, or corn used as food."),
    "pt-BR": ipa("cereal", "/se.ɾeˈaw/", "Planta ou grão usado como alimento, como arroz, trigo ou milho."),
    zh: reading("谷物", "gǔ wù", "pinyin", "可作粮食的禾本科作物或其籽粒。"),
    ja: reading("穀物", "こくもつ", "kana", "米、麦、トウモロコシなど食用になる作物の種子。")
  }),
  rec(798734, 798734, "zh", "组长", 8236, "group leader", "noun", {
    en: ipa("group leader", "/ˈɡruːp ˌliːdər/", "A person who leads or supervises a group."),
    "pt-BR": ipa("líder de grupo", "/ˈli.deʁ dʒi ˈɡɾu.pu/", "Pessoa que lidera ou coordena um grupo."),
    zh: reading("组长", "zǔ zhǎng", "pinyin", "负责带领或管理一个小组的人。"),
    ja: reading("グループリーダー", "グループリーダー", "kana", "集団や班をまとめて指導する人。")
  }),
  rec(695468, 695468, "en", "texting", 8273, "sending text messages", "noun", {
    en: ipa("texting", "/ˈtekstɪŋ/", "The act of sending text messages by phone or another device."),
    "pt-BR": ipa("envio de mensagens", "/ẽˈvi.u dʒi mẽˈsaʒẽjs/", "Ato de enviar mensagens de texto por celular ou outro dispositivo."),
    zh: reading("发短信", "fā duǎn xìn", "pinyin", "通过手机或设备发送文字信息。"),
    ja: reading("メッセージ送信", "メッセージそうしん", "kana", "携帯電話などで文字メッセージを送ること。")
  }),
  rec(370522, 370522, "en", "jerks", 8325, "foolish or unpleasant people; abrupt movements", "noun", {
    en: ipa("jerks", "/dʒɝːks/", "Plural of jerk; foolish or unpleasant people, or sudden abrupt movements."),
    "pt-BR": ipa("idiotas", "/i.dʒiˈɔ.tɐs/", "Pessoas tolas ou desagradáveis; também movimentos bruscos."),
    zh: reading("蠢人", "chǔn rén", "pinyin", "愚蠢或令人讨厌的人；也可指突然的抽动。"),
    ja: reading("ばか者たち", "ばかものたち", "kana", "愚かで不快な人々。または急な動き。")
  }),
  rec(763675, 763675, "en", "wrecked", 8360, "destroyed in an accident", "adjective", {
    en: ipa("wrecked", "/rekt/", "Destroyed, badly damaged, or ruined in an accident."),
    "pt-BR": ipa("destruído", "/des.tɾuˈi.du/", "Que foi destruído, arruinado ou muito danificado."),
    zh: reading("毁坏的", "huǐ huài de", "pinyin", "因事故或破坏而严重损坏的。"),
    ja: reading("壊れた", "こわれた", "kana", "事故などでひどく損なわれた状態。")
  }),
  rec(3334, 3334, "en", "abi", 8564, "abbreviation with several technical meanings", "abbreviation", {
    en: ipa("abi", "/ˌeɪ biː ˈaɪ/", "An abbreviation used in technical contexts, including ankle-brachial index or application binary interface."),
    "pt-BR": ipa("abreviação ABI", "/a.bɾe.vi.aˈsɐ̃w a be ˈi/", "Abreviação técnica usada em áreas como medicina e computação."),
    zh: reading("ABI 缩写", "ABI suō xiě", "pinyin", "技术领域中的缩写，可指踝肱指数或应用二进制接口等。"),
    ja: reading("ABI略語", "エービーアイりゃくご", "kana", "医学や計算機分野などで使われる技術的な略語。")
  }),
  rec(278024, 278024, "en", "fucks", 8646, "vulgar sexual intercourse", "noun", {
    en: ipa("fucks", "/fʌks/", "Vulgar plural or verb form referring to sexual intercourse."),
    "pt-BR": ipa("fodas", "/ˈfɔ.dɐs/", "Termo vulgar relacionado a relações sexuais."),
    zh: reading("性交", "xìng jiāo", "pinyin", "粗俗语境中指性行为。"),
    ja: reading("性交", "せいこう", "kana", "俗語的な文脈で性行為を指す語。")
  }),
  rec(1629187, 1629187, "pt-BR", "habitual", 8794, "regular or usual", "adjective", {
    en: ipa("usual", "/ˈjuːʒuəl/", "Done or occurring regularly; customary."),
    "pt-BR": ipa("habitual", "/a.bi.tuˈaw/", "Que ocorre ou se faz com frequência; costumeiro."),
    zh: reading("习惯性的", "xí guàn xìng de", "pinyin", "经常发生或通常如此的。"),
    ja: reading("習慣的", "しゅうかんてき", "kana", "いつも行われる、または慣例となっていること。")
  }),
  rec(121555, 121555, "en", "cee", 8902, "the letter C", "noun", {
    en: ipa("cee", "/siː/", "The name of the letter C."),
    "pt-BR": ipa("letra cê", "/ˈle.tɾɐ se/", "Nome da letra C."),
    zh: reading("字母 C", "zì mǔ C", "pinyin", "拉丁字母表中的字母 C。"),
    ja: reading("シー", "シー", "kana", "英字 C の名称。")
  }),
  rec(1633385, 1633385, "pt-BR", "similar", 8922, "like or resembling", "adjective", {
    en: ipa("similar", "/ˈsɪmələr/", "Having qualities in common; alike but not identical."),
    "pt-BR": ipa("similar", "/si.miˈlaʁ/", "Que se parece com outra coisa; semelhante."),
    zh: reading("相似的", "xiāng sì de", "pinyin", "彼此有共同点但不完全相同的。"),
    ja: reading("類似した", "るいじした", "kana", "よく似ているが同一ではないこと。")
  }),
  rec(24344, 24344, "en", "alleged", 9180, "declared but not proved", "adjective", {
    en: ipa("alleged", "/əˈledʒd/", "Claimed to be true but not yet proved."),
    "pt-BR": ipa("alegado", "/a.leˈɡa.du/", "Declarado ou acusado, mas ainda não comprovado."),
    zh: reading("声称的", "shēng chēng de", "pinyin", "被宣称为真实但尚未证实的。"),
    ja: reading("申し立てられた", "もうしたてられた", "kana", "事実だと主張されているが証明されていないこと。")
  }),
  rec(798390, 798390, "zh", "炖", 9186, "to stew or simmer", "verb", {
    en: ipa("stew", "/stuː/", "To cook slowly in liquid at low heat."),
    "pt-BR": ipa("cozinhar lentamente", "/ko.ziˈɲaʁ lẽ.taˈmẽ.tʃi/", "Cozinhar em líquido e em fogo baixo por bastante tempo."),
    zh: reading("炖", "dùn", "pinyin", "用小火长时间煮，使食物熟烂入味。"),
    ja: reading("煮込む", "にこむ", "kana", "弱火で長時間煮て味をしみ込ませる。")
  }),
  rec(668763, 668763, "en", "struggled", 9189, "made a strenuous effort", "verb", {
    en: ipa("struggled", "/ˈstrʌɡəld/", "Made a strong effort against difficulty or opposition."),
    "pt-BR": ipa("lutou", "/luˈtow/", "Fez esforço intenso contra dificuldade ou oposição."),
    zh: reading("挣扎", "zhēng zhá", "pinyin", "在困难或阻力中努力奋斗。"),
    ja: reading("苦闘した", "くとうした", "kana", "困難や抵抗に対して懸命に努力した。")
  }),
  rec(849367, 849367, "zh", "女婿", 9280, "son-in-law", "noun", {
    en: ipa("son-in-law", "/ˈsʌn ɪn lɔː/", "The husband of one's daughter."),
    "pt-BR": ipa("genro", "/ˈʒẽ.ɾu/", "Marido da filha de alguém."),
    zh: reading("女婿", "nǚ xu", "pinyin", "女儿的丈夫。"),
    ja: reading("娘婿", "むすめむこ", "kana", "娘の夫。")
  }),
  rec(580340, 580340, "en", "realizing", 9895, "becoming aware; making real", "verb", {
    en: ipa("realizing", "/ˈriːəlaɪzɪŋ/", "Becoming aware of something, or making something real."),
    "pt-BR": ipa("percebendo", "/peʁ.seˈbẽ.du/", "Tomando consciência de algo; percebendo ou concretizando."),
    zh: reading("意识到", "yì shí dào", "pinyin", "开始明白或察觉某事；也可指实现。"),
    ja: reading("気づくこと", "きづくこと", "kana", "何かを理解したり認識したりすること。")
  }),
  rec(1421479, 1421479, "ja", "ダイナー", 10081, "diner", "noun", {
    en: ipa("diner", "/ˈdaɪnər/", "A small informal restaurant, especially one serving simple meals."),
    "pt-BR": ipa("lanchonete", "/lɐ̃.ʃoˈnɛ.tʃi/", "Pequeno restaurante informal que serve refeições simples."),
    zh: reading("小餐馆", "xiǎo cān guǎn", "pinyin", "供应简餐的非正式小型餐馆。"),
    ja: reading("ダイナー", "ダイナー", "kana", "軽食などを出す気軽な小型レストラン。")
  }),
  rec(1180990, 1180990, "pt-BR", "genro", 10332, "son-in-law", "noun", {
    en: ipa("son-in-law", "/ˈsʌn ɪn lɔː/", "The husband of one's daughter."),
    "pt-BR": ipa("genro", "/ˈʒẽ.ɾu/", "Marido da filha de alguém."),
    zh: reading("女婿", "nǚ xu", "pinyin", "女儿的丈夫。"),
    ja: reading("娘婿", "むすめむこ", "kana", "娘の夫。")
  }),
  rec(89808, 89808, "en", "bmw", 10611, "Bavarian Motor Works; automobile brand", "proper noun", {
    en: ipa("bmw", "/ˌbiː ɛm ˈdʌbəljuː/", "An abbreviation for Bavarian Motor Works, a German automobile brand."),
    "pt-BR": ipa("BMW", "/be eme ˈdɐbliw/", "Marca alemã de automóveis, abreviação de Bavarian Motor Works."),
    zh: reading("宝马", "bǎo mǎ", "pinyin", "德国汽车品牌 BMW 的中文名称。"),
    ja: reading("ビーエムダブリュー", "ビーエムダブリュー", "kana", "ドイツの自動車ブランド BMW の名称。")
  })
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const statements = {
  getEntry: db.prepare("SELECT id FROM product_entries WHERE group_key = ?"),
  insertEntry: db.prepare(`
    INSERT INTO product_entries
      (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
    VALUES
      (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'source_gap_manual_residual', 'accepted', 1, 4, @created_at)
  `),
  updateEntry: db.prepare(`
    UPDATE product_entries
    SET status = 'accepted',
        source_count = MAX(source_count, 1),
        lang_count = 4
    WHERE id = ?
  `),
  getSenseByLink: db.prepare(`
    SELECT ps.id
    FROM product_sense_source_links link
    JOIN product_senses ps ON ps.id = link.product_sense_id
    WHERE link.source_sense_id = ?
    LIMIT 1
  `),
  getSense: db.prepare("SELECT id FROM product_senses WHERE product_entry_id = ? AND gloss_key = ?"),
  getNextSenseOrder: db.prepare("SELECT COALESCE(MAX(sense_order), 0) + 1 AS next_order FROM product_senses WHERE product_entry_id = ?"),
  insertSense: db.prepare(`
    INSERT INTO product_senses
      (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
    VALUES
      (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, 'accepted', 0.72, @created_at)
  `),
  acceptSense: db.prepare("UPDATE product_senses SET status = 'accepted', confidence = MAX(confidence, 0.72) WHERE id = ?"),
  upsertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.72, 0)
    ON CONFLICT(product_sense_id, lang) DO UPDATE SET
      term = excluded.term,
      reading = excluded.reading,
      reading_system = excluded.reading_system,
      pronunciation = excluded.pronunciation,
      pronunciation_system = excluded.pronunciation_system,
      definition = excluded.definition,
      source = excluded.source,
      confidence = excluded.confidence,
      needs_review = 0
  `),
  insertLink: db.prepare(`
    INSERT OR IGNORE INTO product_sense_source_links
      (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence)
    VALUES
      (@product_sense_id, @source_entry_id, @source_sense_id, @source_lang, @source_word, @source_frequency_rank, 'source_gap_manual_residual', 0.72)
  `),
  deleteWrongManualLinks: db.prepare(`
    DELETE FROM product_sense_source_links
    WHERE product_sense_id = ?
      AND match_method = 'source_gap_manual_residual'
      AND source_lang = ?
      AND source_word = ?
      AND source_sense_id <> ?
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  records: records.length,
  entries_inserted: 0,
  entries_reused: 0,
  senses_inserted: 0,
  senses_reused: 0,
  localizations_upserted: 0,
  source_links_upserted: 0
};

if (!dryRun) {
  db.transaction(() => {
    for (const item of records) applyRecord(item);
  })();
} else {
  for (const item of records) previewRecord(item);
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function applyRecord(item) {
  const now = new Date().toISOString();
  const groupKey = `source-gap:${item.primary_lang}:${normalize(item.normalized_key)}`;
  let entryId = statements.getEntry.get(groupKey)?.id;
  if (entryId) {
    stats.entries_reused++;
    statements.updateEntry.run(entryId);
  } else {
    entryId = Number(
      statements.insertEntry.run({
        headword: item.headword,
        normalized_key: normalize(item.normalized_key),
        primary_lang: item.primary_lang,
        frequency_rank: item.frequency_rank,
        group_key: groupKey,
        created_at: now
      }).lastInsertRowid
    );
    stats.entries_inserted++;
  }

  let senseId = statements.getSenseByLink.get(item.source_sense_id)?.id;
  if (senseId) {
    stats.senses_reused++;
    statements.acceptSense.run(senseId);
  } else {
    senseId = statements.getSense.get(entryId, item.gloss_key)?.id;
    if (senseId) {
      stats.senses_reused++;
      statements.acceptSense.run(senseId);
    } else {
      senseId = Number(
        statements.insertSense.run({
          product_entry_id: entryId,
          sense_order: statements.getNextSenseOrder.get(entryId).next_order,
          part_of_speech: item.part_of_speech,
          gloss_key: item.gloss_key,
          created_at: now
        }).lastInsertRowid
      );
      stats.senses_inserted++;
    }
  }

  for (const lang of LANGS) {
    const loc = item.localizations[lang];
    statements.upsertLocalization.run({
      product_sense_id: senseId,
      lang,
      term: loc.term,
      reading: loc.reading || null,
      reading_system: loc.reading_system || null,
      pronunciation: loc.pronunciation || null,
      pronunciation_system: loc.pronunciation_system || null,
      definition: loc.definition,
      source: SOURCE
    });
    stats.localizations_upserted++;
  }

  statements.deleteWrongManualLinks.run(senseId, item.primary_lang, item.headword, item.source_sense_id);
  stats.source_links_upserted += statements.insertLink.run({
    product_sense_id: senseId,
    source_entry_id: item.source_entry_id,
    source_sense_id: item.source_sense_id,
    source_lang: item.primary_lang,
    source_word: item.headword,
    source_frequency_rank: item.frequency_rank
  }).changes;
}

function previewRecord(item) {
  const groupKey = `source-gap:${item.primary_lang}:${normalize(item.normalized_key)}`;
  if (statements.getEntry.get(groupKey)) stats.entries_reused++;
  else stats.entries_inserted++;
  if (statements.getSenseByLink.get(item.source_sense_id)) stats.senses_reused++;
  else stats.senses_inserted++;
  stats.localizations_upserted += LANGS.length;
}

function rec(sourceEntryId, sourceSenseId, primaryLang, headword, frequencyRank, glossKey, partOfSpeech, localizations) {
  return {
    source_entry_id: sourceEntryId,
    source_sense_id: sourceSenseId,
    primary_lang: primaryLang,
    headword,
    normalized_key: headword,
    frequency_rank: frequencyRank,
    gloss_key: glossKey,
    part_of_speech: partOfSpeech,
    localizations
  };
}

function ipa(term, pronunciation, definition) {
  return { term, pronunciation, pronunciation_system: "IPA", reading: null, reading_system: null, definition };
}

function reading(term, value, system, definition) {
  return { term, reading: value, reading_system: system, pronunciation: null, pronunciation_system: null, definition };
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
