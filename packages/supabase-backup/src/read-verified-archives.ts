/* eslint-disable ts/explicit-module-boundary-types */
import type { BackupManifest } from './manifest.js';
import type { ObjectStore } from './r2.js';
import { createHash } from 'node:crypto';
import { BackupError } from './errors.js';

/** Downloads both archives and checks their lengths and SHA-256 digests before use. */
export async function readVerifiedArchives(manifest: BackupManifest, store: ObjectStore) {
  const read = async (
    key: string,
    checksumKey: string,
    expected: string,
    bytes: number,
  ) => {
    const [archive, checksum] = await Promise.all([
      store.get(key),
      store.get(checksumKey),
    ]);
    if (
      archive.byteLength !== bytes ||
      createHash('sha256').update(archive).digest('hex') !== expected ||
      Buffer.from(checksum).toString('utf8').trim().split(/\s+/u)[0] !== expected
    )
      throw new BackupError('Encrypted archive checksum verification failed.');
    return archive;
  };
  const [app, auth] = await Promise.all([
    read(
      manifest.appObjectKey,
      manifest.appChecksumObjectKey,
      manifest.appSha256,
      manifest.appEncryptedBytes,
    ),
    read(
      manifest.authObjectKey,
      manifest.authChecksumObjectKey,
      manifest.authSha256,
      manifest.authEncryptedBytes,
    ),
  ]);
  return { app, auth };
}
