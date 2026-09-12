import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BackupError } from '../core/errors.js';

/** Creates a private temporary directory and always removes it after the callback. */
export async function withTemporaryDirectory<T>(
  callback: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'supabase-backup-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/** Computes the SHA-256 digest of a file. */
export async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

/** Ensures a dump exists and is not empty before inspecting it. */
export async function ensureNonEmptyFile(path: string): Promise<void> {
  try {
    if ((await stat(path)).size === 0) throw new Error('empty');
  } catch {
    throw new BackupError('Archive is missing or empty.');
  }
}

/** Writes a private secret file used only as an age identity input. */
export async function writePrivateFile(
  path: string,
  contents: string | Uint8Array,
): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 });
}
