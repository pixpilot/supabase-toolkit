import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

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

/**
 * Computes the SHA-256 digest of a file, reading it a chunk at a time.
 *
 * An archive can be larger than `fs.readFile` will return, which stops at 2 GiB,
 * and larger again than this process should hold, so the file is never collected.
 */
export async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  await pipeline(createReadStream(path), async (source) => {
    for await (const chunk of source) digest.update(chunk as Buffer);
  });
  return digest.digest('hex');
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
