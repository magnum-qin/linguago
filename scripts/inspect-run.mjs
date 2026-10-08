import fs from 'node:fs';
import path from 'node:path';

const runDir = process.argv[2] || 'runs/production-1000-controlled-run1';
const manifestPath = path.join(runDir, 'manifest.json');
const finalGemmaPath = path.join(runDir, '07-final-gemma.json');
const finalAcceptedPath = path.join(runDir, '07-final-gemma-accepted.json');
const summaryPath = path.join(runDir, 'summary.json');
const gemmaReviewPath = path.join(runDir, '03-gemma-source-review.json');
const genReadyPath = path.join(runDir, '04f-generation-ready-candidates.json');

if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log('Manifest status:', m.status);
  console.log('Stages completed/failed:');
  for (const [name, st] of Object.entries(m.stages || {})) {
    console.log(` - ${name}: ${st.status} (exit_code=${st.exit_code})`);
  }
}

if (fs.existsSync(gemmaReviewPath)) {
  const gr = JSON.parse(fs.readFileSync(gemmaReviewPath, 'utf8'));
  console.log('\n=== GEMMA SOURCE REVIEW ===');
  console.log('summary:', gr.summary);
}

if (fs.existsSync(genReadyPath)) {
  const gr = JSON.parse(fs.readFileSync(genReadyPath, 'utf8'));
  const items = gr.selected || gr.items || gr.candidates || [];
  console.log(`\n=== 04F GENERATION READY CANDIDATES: ${items.length} ===`);
  const byLang = {};
  for (const item of items) {
    const l = item.source_lang || 'unknown';
    byLang[l] = (byLang[l] || 0) + 1;
  }
  console.log('By language:', byLang);
}

if (fs.existsSync(finalGemmaPath)) {
  const finalGemma = JSON.parse(fs.readFileSync(finalGemmaPath, 'utf8'));
  console.log('\n=== FINAL GEMMA ===');
  console.log('summary:', finalGemma.summary);
}

if (fs.existsSync(summaryPath)) {
  console.log('\n=== SUMMARY ===');
  console.log(fs.readFileSync(summaryPath, 'utf8'));
}

const secondRunDir = process.argv[3];
if (secondRunDir && fs.existsSync(secondRunDir)) {
  const acc1Path = path.join(runDir, '07-final-gemma-accepted.json');
  const acc2Path = path.join(secondRunDir, '07-final-gemma-accepted.json');
  if (fs.existsSync(acc1Path) && fs.existsSync(acc2Path)) {
    const acc1 = JSON.parse(fs.readFileSync(acc1Path, 'utf8'));
    const acc2 = JSON.parse(fs.readFileSync(acc2Path, 'utf8'));
    const words1 = new Set((acc1.reviews || []).map(r => r.word));
    const words2 = (acc2.reviews || []).map(r => r.word);
    const overlap = words2.filter(w => words1.has(w));
    const unique2 = words2.filter(w => !words1.has(w));
    console.log(`\n=== COMPARISON BETWEEN ${runDir} AND ${secondRunDir} ===`);
    console.log(`Run 1 accepted: ${words1.size}`);
    console.log(`Run 2 accepted: ${words2.length}`);
    console.log(`Overlap words: ${overlap.length}`);
    console.log(`Unique to Run 2: ${unique2.length}`);
    console.log(`Total distinct accepted words across both: ${words1.size + unique2.length}`);
  }
}

