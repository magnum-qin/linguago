import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/product-source-gap-pipeline-routing.json');
const fastOutPath = path.resolve(args['fast-out'] || siblingPath(outPath, 'fast'));
const strictOutPath = path.resolve(args['strict-out'] || siblingPath(outPath, 'strict'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = report.selected || report.candidates || report.gaps || report.rows || [];

if (!Array.isArray(rows)) throw new Error('Report does not contain a candidate array');

const routed = rows.map((row) => {
  const strictReasons = strictRouteReasons(row);
  return {
    ...row,
    pipeline_route: strictReasons.length ? 'strict' : 'fast',
    pipeline_route_reasons: strictReasons.length ? strictReasons : ['deterministic_high_confidence']
  };
});
const fast = routed.filter((row) => row.pipeline_route === 'fast');
const strict = routed.filter((row) => row.pipeline_route === 'strict');

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  policy: {
    fast_route: [
      'one source sense only',
      'no sense realignment',
      'not a single CJK character',
      'full deterministic reverse match for all three target languages',
      'at least two independent strong lexical families for every non-source language'
    ],
    strict_route: 'all candidates that do not satisfy every fast-route condition',
    publication_gate_unchanged: true
  },
  summary: {
    input: routed.length,
    fast: fast.length,
    strict: strict.length,
    fast_rate: routed.length ? Number((fast.length / routed.length).toFixed(4)) : 0,
    strict_reasons: countReasons(strict)
  },
  fast,
  strict
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
writeLaneReport(fastOutPath, 'fast', fast);
writeLaneReport(strictOutPath, 'strict', strict);
console.log(JSON.stringify({
  ok: true,
  out: path.relative(process.cwd(), outPath),
  fast_out: path.relative(process.cwd(), fastOutPath),
  strict_out: path.relative(process.cwd(), strictOutPath),
  summary: output.summary
}, null, 2));

function writeLaneReport(filePath, route, selected) {
  const laneReport = {
    ...report,
    generated_at: new Date().toISOString(),
    routed_from: path.relative(process.cwd(), reportPath),
    pipeline_route: route,
    routing_policy: output.policy,
    selected_count: selected.length,
    selected
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(laneReport, null, 2)}\n`, 'utf8');
}

function siblingPath(filePath, suffix) {
  const extension = path.extname(filePath) || '.json';
  return path.join(path.dirname(filePath), `${path.basename(filePath, extension)}-${suffix}${extension}`);
}

function strictRouteReasons(row) {
  const reasons = [];
  const senseCount = Number(row?.sense_alignment?.eligible_sense_count ?? row?.sense_count ?? 0);
  if (senseCount !== 1) reasons.push('multiple_source_senses');
  if (row?.sense_alignment?.changed === true) reasons.push('sense_realigned');
  if (isSingleCjkCharacter(row?.word)) reasons.push('single_cjk_character');

  const reverse = row?.reverse_evidence_prefilter || {};
  if (Number(reverse.target_coverage_count || 0) < 3) reasons.push('incomplete_reverse_target_coverage');
  if (Number(reverse.match_ratio || 0) < 1) reasons.push('partial_reverse_match');

  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    if (lang === row?.source_lang) continue;
    const families = strongFamilies(row?.generation_hints?.[lang]);
    if (families.size < 2) reasons.push(`insufficient_independent_evidence_${lang}`);
  }
  return [...new Set(reasons)];
}

function strongFamilies(hint) {
  const families = new Set();
  for (const raw of hint?.evidence_families || []) {
    const family = normalizeFamily(raw);
    if (family) families.add(family);
  }
  for (const raw of hint?.sources || []) {
    const family = familyFromSource(raw);
    if (family) families.add(family);
  }
  return families;
}

function normalizeFamily(value) {
  const family = String(value || '').toLowerCase();
  if (!family || family === 'corpus_word2word') return null;
  if (family.includes('wiktionary') || family.includes('wikdict') || family.includes('kaikki')) return 'wiktionary';
  if (family.includes('cc-cedict') || family.includes('cedict')) return 'cc-cedict';
  if (family.includes('jmdict')) return 'jmdict';
  if (family.includes('freedict')) return 'freedict';
  if (family.includes('ecdict')) return 'ecdict';
  if (family.includes('omw') || family.includes('wordnet')) return 'omw';
  if (family.includes('government') || family.includes('naer')) return 'government';
  if (family.includes('wikidata')) return 'wikidata';
  return null;
}

function familyFromSource(value) {
  const source = String(value || '').toLowerCase();
  if (source.includes('word2word')) return null;
  return normalizeFamily(source);
}

function isSingleCjkCharacter(value) {
  return [...String(value || '').trim()].length === 1 && /[\u3400-\u9fff]/u.test(String(value || ''));
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row.pipeline_route_reasons || []) counts[reason] = (counts[reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
