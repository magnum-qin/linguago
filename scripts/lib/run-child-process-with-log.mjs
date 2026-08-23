import fs from 'node:fs';
import { spawn } from 'node:child_process';

export function runChildProcessWithLog({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  logPath,
  echoOutput = false,
  exitDrainTimeoutMs = 5000
}) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let settled = false;
    let exitCode = null;
    let drainTimer = null;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      log.end(() => resolve(Number.isInteger(Number(code)) ? Number(code) : 1));
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      log.destroy();
      reject(error);
    };

    child.stdout.on('data', (chunk) => {
      if (echoOutput) process.stdout.write(chunk);
      log.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (echoOutput) process.stderr.write(chunk);
      log.write(chunk);
    });
    child.once('error', fail);
    child.once('close', finish);
    child.once('exit', (code) => {
      exitCode = code;
      drainTimer = setTimeout(() => finish(exitCode), exitDrainTimeoutMs);
      drainTimer.unref?.();
    });
  });
}
