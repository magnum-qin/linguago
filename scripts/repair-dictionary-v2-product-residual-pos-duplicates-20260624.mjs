import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const apply = args.apply === 'true' || args.apply === true;
const source = 'manual:residual-pos-duplicate-repair-20260624';

const repairs = [
  {
    sense_id: 7304,
    part_of_speech: 'noun',
    localizations: {
      ja: {
        term: '評価額',
        reading: 'ひょうかがく',
        reading_system: 'kana',
        definition: '資産や会社などの金銭的な価値を見積もること。また、その金額。'
      },
      'pt-BR': {
        term: 'valoração',
        definition: 'Estimativa do valor monetário ou econômico de algo.'
      }
    }
  },
  {
    sense_id: 11896,
    part_of_speech: 'verb',
    localizations: {
      en: {
        term: 'be patient',
        definition: 'To wait or endure difficulty calmly without becoming annoyed.'
      },
      ja: {
        term: '辛抱強い',
        reading: 'しんぼうづよい',
        reading_system: 'kana',
        definition: '困難や遅れに対して、いらだたずに落ち着いて耐えるさま。'
      }
    }
  },
  {
    sense_id: 12055,
    part_of_speech: 'noun',
    localizations: {
      zh: {
        term: '发明',
        reading: 'fā míng',
        reading_system: 'pinyin',
        definition: '被创造出来的新事物、新装置或新方法。'
      },
      ja: {
        term: '発明品',
        reading: 'はつめいひん',
        reading_system: 'kana',
        definition: '新しく考え出され、作られた物や方法。'
      }
    }
  },
  {
    sense_id: 13237,
    part_of_speech: 'noun',
    localizations: {
      en: {
        term: 'Chinese poem',
        definition: 'A poem written in Chinese or in a Chinese poetic tradition.'
      },
      zh: {
        term: '汉诗',
        reading: 'hàn shī',
        reading_system: 'pinyin',
        definition: '以汉语或汉诗传统写成的诗。'
      }
    }
  },
  {
    sense_id: 17113,
    part_of_speech: 'verb',
    localizations: {
      en: {
        term: 'take a photograph',
        definition: 'To use a camera to capture an image.'
      },
      zh: {
        term: '摄影',
        reading: 'shè yǐng',
        reading_system: 'pinyin',
        definition: '用相机拍摄并记录影像。'
      }
    }
  },
  {
    sense_id: 17393,
    part_of_speech: 'verb',
    localizations: {
      en: {
        term: 'be similar',
        definition: 'To resemble another thing without being exactly the same.'
      },
      zh: {
        term: '相似',
        reading: 'xiāng sì',
        reading_system: 'pinyin',
        definition: '彼此相像，但不完全相同。'
      },
      ja: {
        term: '似る',
        reading: 'にる',
        reading_system: 'kana',
        definition: '形や性質が他のものと同じように見える。'
      }
    }
  },
  {
    sense_id: 17632,
    part_of_speech: 'noun',
    localizations: {
      ja: {
        term: '無礼さ',
        reading: 'ぶれいさ',
        reading_system: 'kana',
        definition: '礼儀を欠いている性質や態度。'
      },
      zh: {
        term: '无礼',
        reading: 'wú lǐ',
        reading_system: 'pinyin',
        definition: '缺乏礼貌的行为、态度或性质。'
      }
    }
  }
];

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = @part_of_speech
  WHERE id = @sense_id
`);
const updateLocalization = db.prepare(`
  UPDATE product_localizations
  SET term = COALESCE(@term, term),
      reading = COALESCE(@reading, reading),
      reading_system = COALESCE(@reading_system, reading_system),
      definition = @definition,
      source = @source,
      confidence = 0.95,
      needs_review = 0
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

const before = readRows();
let changes = 0;

if (apply) {
  db.transaction(() => {
    for (const repair of repairs) {
      if (repair.part_of_speech) changes += updateSense.run(repair).changes;
      for (const [lang, localization] of Object.entries(repair.localizations)) {
        changes += updateLocalization.run({
          sense_id: repair.sense_id,
          lang,
          term: localization.term ?? null,
          reading: localization.reading ?? null,
          reading_system: localization.reading_system ?? null,
          definition: localization.definition,
          source
        }).changes;
      }
    }
  })();
}

const after = readRows();
console.log(JSON.stringify({ ok: true, db: dbPath, apply, changes, before, after }, null, 2));
db.close();

function readRows() {
  const ids = repairs.map((repair) => repair.sense_id);
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(
      `
      SELECT s.id AS sense_id, s.sense_order, s.part_of_speech, s.gloss_key,
             l.lang, l.term, l.reading, l.reading_system, l.definition, l.source
      FROM product_senses s
      JOIN product_localizations l ON l.product_sense_id = s.id
      WHERE s.id IN (${placeholders})
      ORDER BY s.product_entry_id, s.sense_order, l.lang
    `
    )
    .all(...ids);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
