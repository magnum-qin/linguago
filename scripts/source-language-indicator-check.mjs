import { detectSourceLanguage } from '../src/utils/detect-source-language.js';

const cases = [
  ['', 'hidden'],
  ['123?!', 'hidden'],
  ['你好，世界', 'zh'],
  ['こんにちは', 'ja'],
  ['The movie starts in ten minutes.', 'en'],
  ['Hello, how are you?', 'en'],
  ['Olá, como você está?', 'pt-BR'],
  ['Eu gosto muito desta cidade.', 'pt-BR'],
  ['Bom dia', 'pt-BR'],
  ['casa', 'pt-BR']
];

const failures = cases
  .map(([text, expected]) => ({ text, expected, actual: detectSourceLanguage(text) }))
  .filter(({ expected, actual }) => expected !== actual);

console.log(JSON.stringify({ ok: failures.length === 0, cases: cases.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
