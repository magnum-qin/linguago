import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const repairsPath = requiredPath(args.repairs, 'repairs');
const selectedPath = args['selected-report'] ? requiredPath(args['selected-report'], 'selected-report') : null;
const outPath = path.resolve(args.out || 'logs/product-coverage-gaps-target-term-repaired.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const repairs = JSON.parse(fs.readFileSync(repairsPath, 'utf8'));
const selectedKeys = selectedPath
  ? new Set((JSON.parse(fs.readFileSync(selectedPath, 'utf8')).selected || []).map((row) => row.candidate_key))
  : null;
const repairByKey = new Map();
for (const row of repairs.validations || []) {
  if (row.decision !== 'accept' || (selectedKeys && !selectedKeys.has(row.candidate_key))) continue;
  if (!repairByKey.has(row.candidate_key)) repairByKey.set(row.candidate_key, []);
  repairByKey.get(row.candidate_key).push(row);
}
let applied = 0;
const selected = (report.selected || []).map((row) => {
  const repairsForCandidate = repairByKey.get(row.candidate_key);
  if (!repairsForCandidate?.length) return row;
  const repairRecords = repairsForCandidate.map((repair) => {
    const terms = repair.accepted_terms.map((item) => item.term);
    const families = [...new Set(repair.accepted_terms.flatMap((item) => item.families))].sort();
    return {
      target_lang: repair.target_lang,
      previous_terms: repair.existing_terms,
      terms,
      evidence_families: families,
      term_regions: [...new Set(repair.accepted_terms.map((item) => item.region).filter(Boolean))],
      validation_report: path.relative(process.cwd(), repairsPath)
    };
  });
  applied += 1;
  return {
    ...row,
    target_term_repairs: repairRecords,
    ...(repairRecords.length === 1 ? { target_term_repair: repairRecords[0] } : {})
  };
});
const output = { ...report, generated_at: new Date().toISOString(), policy: { ...(report.policy || {}), target_term_repair_applied: true, target_term_repair_version: 'v1' }, summary: { ...(report.summary || {}), target_term_repair: { eligible_repairs: repairByKey.size, applied } }, selected };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), eligible_repairs: repairByKey.size, applied }, null, 2));

function requiredPath(value,name) { if(!value)throw new Error(`Missing --${name}`);const result=path.resolve(value);if(!fs.existsSync(result))throw new Error(`File not found: ${result}`);return result; }
function parseArgs(argv) { const out={};for(let i=0;i<argv.length;i+=1){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];if(next&&!next.startsWith('--')){out[key]=next;i+=1;}else out[key]=true;}return out; }
