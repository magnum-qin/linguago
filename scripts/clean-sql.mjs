import fs from 'fs';
import readline from 'readline';

const input = fs.createReadStream('linguago.sql');
const output = fs.createWriteStream('linguago_clean.sql');
const rl = readline.createInterface({ input, crlfDelay: Infinity });

rl.on('line', (line) => {
  if (line === 'BEGIN TRANSACTION;' || line === 'COMMIT;') return;
  output.write(line + '\n');
});

rl.on('close', () => {
  output.end();
  console.log('Done cleaning SQL');
});
