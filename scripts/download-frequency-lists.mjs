import fs from "node:fs";
import path from "node:path";

const RAW_DIR = path.resolve("data/raw/frequency");
const MANIFEST_FILE = path.join(RAW_DIR, "manifest.json");

const sources = [
  {
    id: "frequencywords-en",
    lang: "en",
    url: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/en/en_50k.txt",
    file: "frequencywords-en_50k.txt",
    homepage: "https://github.com/hermitdave/FrequencyWords",
    license: "Verify upstream repository license before redistribution"
  },
  {
    id: "frequencywords-zh",
    lang: "zh",
    url: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/zh/zh_50k.txt",
    file: "frequencywords-zh_50k.txt",
    homepage: "https://github.com/hermitdave/FrequencyWords",
    license: "Verify upstream repository license before redistribution"
  },
  {
    id: "frequencywords-ja",
    lang: "ja",
    url: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/ja/ja_50k.txt",
    file: "frequencywords-ja_50k.txt",
    homepage: "https://github.com/hermitdave/FrequencyWords",
    license: "Verify upstream repository license before redistribution"
  },
  {
    id: "frequencywords-pt-br",
    lang: "pt-BR",
    url: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/pt_br/pt_br_50k.txt",
    file: "frequencywords-pt_br_50k.txt",
    homepage: "https://github.com/hermitdave/FrequencyWords",
    license: "Verify upstream repository license before redistribution"
  },
  {
    id: "wordfreq-en",
    lang: "en",
    url: "https://raw.githubusercontent.com/frekwencja/most-common-words-multilingual/main/data/wordfrequency.info/en.txt",
    file: "wordfrequency-en.txt",
    homepage: "https://github.com/frekwencja/most-common-words-multilingual",
    license: "Verify upstream repository license before redistribution"
  },
  {
    id: "wordfreq-zh-cn",
    lang: "zh",
    url: "https://raw.githubusercontent.com/frekwencja/most-common-words-multilingual/main/data/wordfrequency.info/zh-CN.txt",
    file: "wordfrequency-zh-CN.txt",
    homepage: "https://github.com/frekwencja/most-common-words-multilingual",
    license: "Verify upstream repository license before redistribution"
  },
  {
    id: "wordfreq-ja",
    lang: "ja",
    url: "https://raw.githubusercontent.com/frekwencja/most-common-words-multilingual/main/data/wordfrequency.info/ja.txt",
    file: "wordfrequency-ja.txt",
    homepage: "https://github.com/frekwencja/most-common-words-multilingual",
    license: "Verify upstream repository license before redistribution"
  },
  {
    id: "wordfreq-pt",
    lang: "pt-BR",
    url: "https://raw.githubusercontent.com/frekwencja/most-common-words-multilingual/main/data/wordfrequency.info/pt.txt",
    file: "wordfrequency-pt.txt",
    homepage: "https://github.com/frekwencja/most-common-words-multilingual",
    license: "Verify upstream repository license before redistribution"
  }
];

fs.mkdirSync(RAW_DIR, { recursive: true });

const manifest = {
  downloaded_at: new Date().toISOString(),
  sources: []
};

for (const source of sources) {
  const outPath = path.join(RAW_DIR, source.file);
  console.log(`[download] ${source.id} -> ${path.relative(process.cwd(), outPath)}`);

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`${source.id} failed: HTTP ${response.status}`);
  }

  const text = await response.text();
  fs.writeFileSync(outPath, text);

  const stat = fs.statSync(outPath);
  manifest.sources.push({
    id: source.id,
    lang: source.lang,
    url: source.url,
    file: source.file,
    bytes: stat.size,
    lines: text.split(/\r?\n/).filter(Boolean).length,
    license: source.license,
    homepage: source.homepage
  });
}

fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[done] wrote ${path.relative(process.cwd(), MANIFEST_FILE)}`);
