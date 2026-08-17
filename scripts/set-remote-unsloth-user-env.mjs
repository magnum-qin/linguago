#!/usr/bin/env node

import './lib/load-local-env.mjs';
import { spawnSync } from 'node:child_process';

const token = process.env.UNSLOTH_API_KEY;
if (!token) throw new Error('Local UNSLOTH_API_KEY is not set');

const encoded = Buffer.from(token, 'utf8').toString('base64');
const script = [
  `$value=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
  `[Environment]::SetEnvironmentVariable('UNSLOTH_API_KEY',$value,'User')`,
  `Write-Output 'UNSLOTH_API_KEY=set'`
].join(';');
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', 'ts-win-jump', 'powershell', '-NoProfile', '-Command', '-'], {
  input: script,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe']
});
if (result.status !== 0) throw new Error(result.stderr || `ssh exited ${result.status}`);
process.stdout.write(result.stdout);
