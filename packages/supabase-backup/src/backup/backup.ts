import type { BackupConfig } from '../core/config.js';
import type { BackupManifest } from '../core/manifest.js';

import type { ObjectStore } from '../storage/object-store.js';
import type { ProgramRunner } from '../utils/process.js';
import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };
import { loadBackupConfig } from '../core/config.js';
import { BackupError } from '../core/errors.js';
import { authTables, backupObjectKeys } from '../core/manifest.js';
import { ensureValidAgeRecipient } from '../core/validation.js';
import { createObjectStore } from '../storage/create-object-store.js';
import { readVerifiedArchives } from '../storage/read-verified-archives.js';
import {
  ensureNonEmptyFile,
  sha256File,
  withTemporaryDirectory,
} from '../utils/files.js';
import { systemRunner } from '../utils/process.js';
import { dumpDatabase } from './dump-database.js';

/**
 * Encrypts one dump to the recipient, or leaves it alone when a run opted out.
 *
 * Returns the file that is uploaded, so the plaintext dump is unlinked only once
 * an encrypted copy of it exists to take its place.
 */
async function sealArchive(
  runner: ProgramRunner,
  dump: string,
  recipient: string | undefined,
): Promise<string> {
  if (recipient === undefined) return dump;
  const encrypted = `${dump}.age`;
  await runner.run('age', ['--recipient', recipient, '--output', encrypted, dump]);
  await unlink(dump);
  return encrypted;
}

/** Creates encrypted, immutable app/Auth archives and publishes their manifest last. */
export async function backup(
  env = process.env,
  dependencies: { now?: Date; runner?: ProgramRunner; store?: ObjectStore } = {},
): Promise<BackupManifest> {
  const config = loadBackupConfig(env);
  return backupWithConfig(config, dependencies);
}

/** Implements backup with injected dependencies for deterministic tests. */
export async function backupWithConfig(
  config: BackupConfig,
  dependencies: { now?: Date; runner?: ProgramRunner; store?: ObjectStore } = {},
): Promise<BackupManifest> {
  const encrypted = config.encryption !== 'none';
  if (encrypted) {
    if (!config.ageRecipient?.trim())
      throw new BackupError(
        'ageRecipient is required unless encryption is explicitly set to none.',
      );
    ensureValidAgeRecipient(config.ageRecipient);
  } else if (config.ageRecipient !== undefined) {
    throw new BackupError('encryption: none cannot be combined with ageRecipient.');
  }
  const runner = dependencies.runner || systemRunner;
  const store = dependencies.store || createObjectStore(config);
  const createdAt = dependencies.now || new Date();
  if (!encrypted)
    process.stderr.write(
      'Encryption is off: this backup is stored as a plaintext database dump, readable by anyone who can read the backup storage.\n',
    );
  const keys = backupObjectKeys(config.prefix, createdAt, encrypted);
  for (const key of Object.values(keys))
    if (await store.has(key))
      throw new BackupError(`Refusing to overwrite existing object '${key}'.`);
  return withTemporaryDirectory(async (directory) => {
    const appDump = join(directory, 'app.dump');
    const authDump = join(directory, 'auth.dump');
    const metadata = await dumpDatabase(config, runner, appDump, authDump);
    for (const archive of [appDump, authDump]) {
      await ensureNonEmptyFile(archive);
      await runner.run('pg_restore', ['--list', archive]);
    }
    const appArchive = await sealArchive(runner, appDump, config.ageRecipient);
    const authArchive = await sealArchive(runner, authDump, config.ageRecipient);
    const [appSha256, authSha256, appBytes, authBytes] = await Promise.all([
      sha256File(appArchive),
      sha256File(authArchive),
      stat(appArchive).then((file) => file.size),
      stat(authArchive).then((file) => file.size),
    ]);
    const manifest: BackupManifest = {
      formatVersion: 2,
      ...metadata,
      createdAt: createdAt.toISOString(),
      encryption: encrypted ? 'age' : 'none',
      environment: config.prefix.split('/')[0] || 'default',
      appObjectKey: keys.app,
      appChecksumObjectKey: keys.appChecksum,
      authObjectKey: keys.auth,
      authChecksumObjectKey: keys.authChecksum,
      appSha256,
      authSha256,
      appEncryptedBytes: appBytes,
      authEncryptedBytes: authBytes,
      authTables: [...authTables],
      cliVersion: packageJson.version,
    };
    await store.putImmutable(keys.app, { file: appArchive });
    await store.putImmutable(keys.auth, { file: authArchive });
    await store.putImmutable(
      keys.appChecksum,
      Buffer.from(`${appSha256}  ${keys.app.split('/').at(-1)}\n`),
    );
    await store.putImmutable(
      keys.authChecksum,
      Buffer.from(`${authSha256}  ${keys.auth.split('/').at(-1)}\n`),
    );
    await readVerifiedArchives(manifest, store);
    await store.putImmutable(keys.manifest, Buffer.from(`${JSON.stringify(manifest)}\n`));
    for (const key of Object.values(keys))
      if (!(await store.has(key)))
        throw new BackupError(
          'R2 verification failed after upload; manifest cannot be trusted.',
        );
    return manifest;
  });
}
