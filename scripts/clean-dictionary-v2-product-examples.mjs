import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || 'data/processed/linguago_v2_product_top5000_fused_only_pilot.db';
const dryRun = args['dry-run'] === 'true' || args['dry-run'] === true;

const traditionalChars = new Set(
  '這裡裏國動請問麼幫與為個會來時後對說經過還發無開關買賣學習體見聽點電話電腦網網頁應該誰讓給們長門間書車東萬風飛馬鳥魚貓龍葉雲愛樂氣頭髮聲區廣廠產業務員師醫藥術畫話語讀寫記錄錄類數據據庫庫頁項目標標題題難簡單舊新實驗驗證選擇擇處理線綫沒興臺雖卻別離顯於潤豐獎敵義鬥佔從勞'
);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const examples = db
  .prepare(
    `
  SELECT
    e.id,
    e.product_sense_id,
    e.example_order,
    e.source_lang,
    e.source_text,
    zh.id AS zh_loc_id,
    zh.text AS zh_text,
    zh.reading AS zh_reading,
    en.text AS en_text
  FROM product_examples e
  JOIN product_example_localizations zh
    ON zh.product_example_id = e.id
   AND zh.lang = 'zh'
   AND zh.needs_review = 0
  LEFT JOIN product_example_localizations en
    ON en.product_example_id = e.id
   AND en.lang = 'en'
   AND en.needs_review = 0
  WHERE e.needs_review = 0
    AND e.source_lang = 'zh'
`
  )
  .all();

const groups = new Map();
for (const example of examples) {
  const key = [
    example.product_sense_id,
    example.source_lang,
    normalize(example.en_text || ''),
    normalize(example.zh_reading || '')
  ].join('\u001f');
  if (!example.en_text || !example.zh_reading) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(example);
}

const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
const removals = [];

for (const group of duplicateGroups) {
  const sorted = [...group].sort(compareExamplePreference);
  const keep = sorted[0];
  for (const remove of sorted.slice(1)) {
    removals.push({
      keep_id: keep.id,
      remove_id: remove.id,
      product_sense_id: remove.product_sense_id,
      keep_text: keep.zh_text,
      remove_text: remove.zh_text,
      keep_traditional_score: traditionalScore(keep.zh_text),
      remove_traditional_score: traditionalScore(remove.zh_text)
    });
  }
}

const stats = {
  db: dbPath,
  dry_run: dryRun,
  zh_examples_checked: examples.length,
  duplicate_groups: duplicateGroups.length,
  examples_to_delete: removals.length,
  example_localizations_to_delete: 0,
  examples_deleted: 0,
  example_orders_renumbered: 0,
  sample_removals: removals.slice(0, 10)
};

if (!dryRun && removals.length) {
  const deleteLocalizations = db.prepare('DELETE FROM product_example_localizations WHERE product_example_id = ?');
  const deleteExample = db.prepare('DELETE FROM product_examples WHERE id = ?');
  const examplesForSense = db.prepare(`
    SELECT id
    FROM product_examples
    WHERE product_sense_id = ?
    ORDER BY example_order, id
  `);
  const updateOrder = db.prepare('UPDATE product_examples SET example_order = ? WHERE id = ?');

  const touchedSenseIds = new Set(removals.map((row) => row.product_sense_id));
  const tx = db.transaction(() => {
    for (const row of removals) {
      stats.example_localizations_to_delete += deleteLocalizations.run(row.remove_id).changes;
      stats.examples_deleted += deleteExample.run(row.remove_id).changes;
    }
    for (const senseId of touchedSenseIds) {
      let order = 1;
      for (const example of examplesForSense.all(senseId)) {
        stats.example_orders_renumbered += updateOrder.run(order, example.id).changes;
        order++;
      }
    }
  });
  tx();
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function compareExamplePreference(a, b) {
  const scoreDelta = traditionalScore(a.zh_text) - traditionalScore(b.zh_text);
  if (scoreDelta !== 0) return scoreDelta;
  const simplifiedHintDelta = simplifiedHintScore(b.zh_text) - simplifiedHintScore(a.zh_text);
  if (simplifiedHintDelta !== 0) return simplifiedHintDelta;
  if (a.example_order !== b.example_order) return a.example_order - b.example_order;
  return a.id - b.id;
}

function traditionalScore(value) {
  let score = 0;
  for (const char of value || '') {
    if (traditionalChars.has(char)) score++;
  }
  return score;
}

function simplifiedHintScore(value) {
  let score = 0;
  for (const char of value || '') {
    if (
      '这这里国动请问么帮与为个会来时后对说经过还发无开关买卖学习体见听点电话电脑网网页应该谁让给们长门间书车东万风飞马鸟鱼猫龙叶云爱乐气头发声区广厂产业务员师医药术画话语读写记录类数据库页项目标题难简单旧新实验验证选择处理线没兴台虽却别离显于润丰奖敌义斗占从劳'.includes(
        char
      )
    ) {
      score++;
    }
  }
  return score;
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?.,，、；;：:]/g, '');
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}
