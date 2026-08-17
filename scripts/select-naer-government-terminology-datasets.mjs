import fs from 'node:fs';
import path from 'node:path';
import csv from 'csv-parser';

const args = parseArgs(process.argv.slice(2));
const catalogPath = path.resolve(
  args.catalog || 'data/raw/government-lexicons/taiwan-open-data-catalog.csv'
);
const outPath = path.resolve(
  args.out || 'logs/naer-government-terminology-datasets.json'
);
if (!fs.existsSync(catalogPath)) throw new Error(`Catalog not found: ${catalogPath}`);

const selected = [];
let scanned = 0;
await new Promise((resolve, reject) => {
  fs.createReadStream(catalogPath)
    .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/u, '').replace(/^"|"$/gu, '') }))
    .on('data', (row) => {
      scanned += 1;
      const provider = String(row['提供機關'] || '');
      const title = String(row['資料集名稱'] || '');
      const description = String(row['資料集描述'] || '');
      const license = String(row['授權方式'] || '');
      const formats = String(row['檔案格式'] || '');
      if (!provider.includes('國家教育研究院')) return;
      if (!/(?:學術名詞|英中對照|中英對照|雙語詞彙|兩岸對照名詞)/u.test(`${title} ${description}`)) return;
      if (!license.includes('政府資料開放授權條款-第1版')) return;
      if (!formats.toUpperCase().includes('CSV')) return;
      selected.push({
        dataset_id: String(row['資料集識別碼'] || '').trim(),
        title,
        description,
        formats,
        download_urls: splitUrls(row['資料下載網址']),
        encoding: row['編碼格式'] || null,
        license,
        provider,
        updated_at: row['詮釋資料更新時間'] || null,
        notes: row['備註'] || null
      });
    })
    .on('end', resolve)
    .on('error', reject);
});

selected.sort((a, b) => Number(a.dataset_id) - Number(b.dataset_id));
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  catalog: path.relative(process.cwd(), catalogPath),
  policy: {
    provider: '國家教育研究院',
    license: '政府資料開放授權條款-第1版',
    csv_only: true,
    terminology_only: true
  },
  summary: {
    catalog_rows_scanned: scanned,
    selected_datasets: selected.length,
    datasets_with_download_url: selected.filter((row) => row.download_urls.length).length
  },
  datasets: selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function splitUrls(value) {
  return String(value || '')
    .split(/[;\n\r]+/u)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//iu.test(url));
}
function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      parsed[key] = value;
      i += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
