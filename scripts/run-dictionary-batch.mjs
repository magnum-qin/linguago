import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const batchFile = path.resolve(process.argv[2] || "data/processed/generation_batch_frequency_400.txt");
const runName = process.argv[3] || `batch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
const limit = Number(process.argv[4] || process.env.BATCH_LIMIT || 0);
const outputDir = path.resolve("output/batches", runName);
const successFile = path.join(outputDir, "generated.jsonl");
const failedFile = path.join(outputDir, "generated.failed.jsonl");
const summaryFile = path.join(outputDir, "summary.json");
const ollamaHost = (process.env.OLLAMA_HOST || "http://192.168.2.152:11434").replace(/\/$/, "");

fs.mkdirSync(outputDir, { recursive: true });

const terms = fs
  .readFileSync(batchFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const planned = limit > 0 ? terms.slice(0, limit) : terms;
const plannedFile = path.join(outputDir, "planned_terms.txt");
fs.writeFileSync(plannedFile, planned.join("\n") + "\n");

console.log(`[batch] name=${runName}`);
console.log(`[batch] terms=${planned.length}`);
console.log(`[batch] planned=${path.relative(process.cwd(), plannedFile)}`);
console.log(`[batch] ollama=${ollamaHost}`);

await assertOllamaReachable();

runNode([
  "scripts/ollama-schema-test.mjs",
  "--terms-file",
  plannedFile,
  "--word-only",
  "--out",
  successFile,
  "--fail-out",
  failedFile
]);

runNode(["scripts/validate-generated-dictionary.mjs", successFile, runName]);
runNode(["scripts/import-generated-dictionary.mjs", path.resolve(`data/processed/${runName}.accepted.jsonl`)]);

const summary = {
  generated_at: new Date().toISOString(),
  run_name: runName,
  batch_file: path.relative(process.cwd(), batchFile),
  planned_terms: planned.length,
  success_file: path.relative(process.cwd(), successFile),
  failed_file: path.relative(process.cwd(), failedFile),
  accepted_file: `data/processed/${runName}.accepted.jsonl`,
  review_file: `data/processed/${runName}.needs_review.jsonl`
};

fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[done] wrote ${path.relative(process.cwd(), summaryFile)}`);

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) throw new Error(`Command failed: node ${args.join(" ")}`);
}

async function assertOllamaReachable() {
  try {
    const response = await fetch(`${ollamaHost}/api/tags`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Ollama host unreachable: ${ollamaHost}. ` +
        `Set OLLAMA_HOST to a reachable Ollama endpoint before running this batch. Original error: ${error.message}`
    );
  }
}
