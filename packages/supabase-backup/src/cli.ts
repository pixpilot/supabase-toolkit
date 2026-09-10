#!/usr/bin/env node
import { backup } from './backup.js';
import { BackupError } from './errors.js';
import { redact } from './redact.js';
import { restore } from './restore.js';
import { status } from './status.js';

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** Executes the package CLI commands. */
export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const [command] = args;
  if (command === 'backup') {
    await backup();
    return;
  }
  if (command === 'status') {
    const raw = valueAfter(args, '--max-age-hours');
    await status(raw === undefined ? undefined : Number(raw));
    return;
  }
  if (command === 'restore') {
    const key = valueAfter(args, '--key');
    if (!key) throw new BackupError('restore requires --key <manifest-key>.');
    const confirmTarget = valueAfter(args, '--confirm-target');
    await restore({
      key,
      apply: args.includes('--apply'),
      ...(confirmTarget ? { confirmTarget } : {}),
    });
    return;
  }
  throw new BackupError('Usage: supabase-backup <backup|status|restore> [options]');
}

runCli().catch((error: unknown) => {
  process.stderr.write(
    `${redact(error instanceof Error ? error.message : 'Unexpected backup failure.')}\n`,
  );
  process.exitCode = 1;
});
