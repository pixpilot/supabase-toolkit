import type { BackupManifest } from '../core/manifest.js';
import type { ObjectStore } from './object-store.js';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BackupError } from '../core/errors.js';

/** Where each verified archive is written, when a caller needs it on disk. */
export interface ArchiveDestinations {
  app: string;
  auth: string;
}

/**
 * Reads both archives and checks their lengths and SHA-256 digests before use.
 *
 * The bytes are hashed as they arrive and never collected, so an archive far
 * larger than this process could hold is still verified. A caller restoring from
 * one names a file to write it to; a caller only proving a backup is intact,
 * such as `status`, names none and the bytes are discarded as they are counted.
 */
export async function readVerifiedArchives(
  manifest: BackupManifest,
  store: ObjectStore,
  destinations?: ArchiveDestinations,
): Promise<void> {
  const read = async (
    key: string,
    checksumKey: string,
    expected: string,
    bytes: number,
    destination?: string,
  ): Promise<void> => {
    const checksum = Buffer.from(await store.get(checksumKey))
      .toString('utf8')
      .trim()
      .split(/\s+/u)[0];
    const digest = createHash('sha256');
    let size = 0;
    const tally = async function* (
      source: AsyncIterable<Buffer>,
    ): AsyncGenerator<Buffer> {
      for await (const chunk of source) {
        size += chunk.byteLength;
        digest.update(chunk);
        yield chunk;
      }
    };
    await pipeline(
      await store.getStream(key),
      tally,
      destination
        ? createWriteStream(destination, { flags: 'wx', mode: 0o600 })
        : new Writable({
            write(_chunk, _encoding, done) {
              done();
            },
          }),
    );
    if (size !== bytes || digest.digest('hex') !== expected || checksum !== expected)
      throw new BackupError('Backup archive checksum verification failed.');
  };
  await Promise.all([
    read(
      manifest.appObjectKey,
      manifest.appChecksumObjectKey,
      manifest.appSha256,
      manifest.appEncryptedBytes,
      destinations?.app,
    ),
    read(
      manifest.authObjectKey,
      manifest.authChecksumObjectKey,
      manifest.authSha256,
      manifest.authEncryptedBytes,
      destinations?.auth,
    ),
  ]);
}
