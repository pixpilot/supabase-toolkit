import type { BackupConfig } from './config.js';
import type { BackupManifest } from './manifest.js';

import type { ProgramRunner } from './process.js';
import type { ObjectStore } from './r2.js';
import { readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { loadBackupConfig } from './config.js';
import { dumpDatabase } from './dump-database.js';
import { BackupError } from './errors.js';
import { ensureNonEmptyFile, sha256File, withTemporaryDirectory } from './files.js';
import { authTables, backupObjectKeys } from './manifest.js';
import { systemRunner } from './process.js';
import { R2Store } from './r2.js';
import { readVerifiedArchives } from './read-verified-archives.js';

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
  const runner = dependencies.runner || systemRunner;
  const store = dependencies.store || new R2Store(config);
  const createdAt = dependencies.now || new Date();
  const keys = backupObjectKeys(config.prefix, createdAt);
  for (const key of Object.values(keys))
    if (await store.has(key))
      throw new BackupError(`Refusing to overwrite existing R2 object '${key}'.`);
  return withTemporaryDirectory(async (directory) => {
    const appDump = join(directory, 'app.dump');
    const authDump = join(directory, 'auth.dump');
    const appEncrypted = `${appDump}.age`;
    const authEncrypted = `${authDump}.age`;
    const metadata = await dumpDatabase(config, runner, appDump, authDump);
    for (const archive of [appDump, authDump]) {
      await ensureNonEmptyFile(archive);
      await runner.run('pg_restore', ['--list', archive]);
    }
    await runner.run('age', [
      '--recipient',
      config.ageRecipient,
      '--output',
      appEncrypted,
      appDump,
    ]);
    await unlink(appDump);
    await runner.run('age', [
      '--recipient',
      config.ageRecipient,
      '--output',
      authEncrypted,
      authDump,
    ]);
    await unlink(authDump);
    const [appSha256, authSha256, appBytes, authBytes] = await Promise.all([
      sha256File(appEncrypted),
      sha256File(authEncrypted),
      stat(appEncrypted).then((file) => file.size),
      stat(authEncrypted).then((file) => file.size),
    ]);
    const manifest: BackupManifest = {
      formatVersion: 2,
      ...metadata,
      createdAt: createdAt.toISOString(),
      environment: config.prefix.split('/')[0] || 'default',
      appObjectKey: keys.app,
      appChecksumObjectKey: keys.appChecksum,
      authObjectKey: keys.auth,
      authChecksumObjectKey: keys.authChecksum,
      appSha256,
      authSha256,
      appEncryptedBytes: appBytes,
      authEncryptedBytes: authBytes,
      appSchemas: config.appSchemas,
      authTables: [...authTables],
      cliVersion: packageJson.version,
    };
    await store.putImmutable(keys.app, await readFile(appEncrypted));
    await store.putImmutable(keys.auth, await readFile(authEncrypted));
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
