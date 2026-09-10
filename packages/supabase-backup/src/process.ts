import { spawn } from 'node:child_process';

import { BackupError } from './errors.js';

export interface ProgramRunner {
  run: (
    command: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv },
  ) => Promise<string>;
}

/** Runs a required system program without printing its potentially sensitive output. */
export const systemRunner: ProgramRunner = {
  async run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.once('error', () =>
        reject(new BackupError(`Required system tool '${command}' is unavailable.`)),
      );
      child.once('close', (code) =>
        code === 0
          ? resolve(stdout.trim())
          : reject(
              new BackupError(
                `${command} failed; no secrets or command output were logged.`,
              ),
            ),
      );
    });
  },
};
