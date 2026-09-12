import { spawn } from 'node:child_process';

import { BackupError } from './errors.js';
import { redact } from './redact.js';

/** Caps how much subprocess stderr is kept so a failure message stays readable. */
const stderrLimit = 4000;

export interface ProgramRunner {
  run: (
    command: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv; onStdout?: (chunk: string) => void },
  ) => Promise<string>;
}

/** Builds a failure message carrying the subprocess diagnostics with secrets removed. */
function failureMessage(command: string, code: number | null, stderr: string): string {
  const details = redact(stderr.trim()).slice(-stderrLimit).trim();
  const exit = code === null ? 'was terminated by a signal' : `exited with code ${code}`;
  return details
    ? `${command} ${exit}: ${details}`
    : `${command} ${exit} without writing any diagnostics.`;
}

/** Runs a required system program, surfacing redacted stderr when it fails. */
export const systemRunner: ProgramRunner = {
  async run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        options.onStdout?.(text);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-stderrLimit * 2);
      });
      child.once('error', () =>
        reject(new BackupError(`Required system tool '${command}' is unavailable.`)),
      );
      child.once('close', (code) =>
        code === 0
          ? resolve(stdout.trim())
          : reject(new BackupError(failureMessage(command, code, stderr))),
      );
    });
  },
};
