import { redact } from './redact.js';

interface RestoreStep {
  message: string;
  file?: string;
}

/** Prints a restore phase without exposing connection credentials. */
export function logRestoreProgress(message: string): void {
  process.stdout.write(`[restore] ${redact(message)}\n`);
}

/** Interleaves live psql progress with SQL files, forwarding only our known messages. */
export function createRestoreProgress(steps: RestoreStep[]): {
  args: string[];
  onStdout: (chunk: string) => void;
} {
  const messages = new Set(steps.map(({ message }) => `[restore] ${message}`));
  let pending = '';
  return {
    args: steps.flatMap(({ message, file }) => [
      '--command',
      `\\echo [restore] ${message}`,
      ...(file ? ['--file', file] : []),
    ]),
    onStdout(chunk) {
      const lines = (pending + chunk).split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) if (messages.has(line)) process.stdout.write(`${line}\n`);
    },
  };
}
