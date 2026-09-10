import type { BackupConfig } from './config.js';
import type { BackupManifest } from './manifest.js';

import type { ProgramRunner } from './process.js';
import type { ObjectStore } from './r2.js';
import { readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  connectForPreflight,
  ensureSupportedAuthState,
  getApplicationTables,
  getAuthColumns,
  getTableCounts,
} from './auth.js';
import { loadBackupConfig } from './config.js';
import { parseDatabaseUrl, toLibpqEnvironment } from './database-url.js';
import { BackupError } from './errors.js';
import { ensureNonEmptyFile, sha256File, withTemporaryDirectory } from './files.js';
import { authTables, backupObjectKeys } from './manifest.js';
import { systemRunner } from './process.js';
import { R2Store } from './r2.js';

const packageVersion = '1.0.0';

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
  const connection = parseDatabaseUrl(config.sourceDatabaseUrl);
  const preflight = await connectForPreflight(connection);
  let serverVersion: string;
  let authColumns: Awaited<ReturnType<typeof getAuthColumns>>;
  let appTableCounts: Awaited<ReturnType<typeof getTableCounts>>;
  let authRowCounts: Awaited<ReturnType<typeof getTableCounts>>;
  try {
    await ensureSupportedAuthState(preflight);
    serverVersion =
      (await preflight.query<{ version: string }>('SHOW server_version')).rows[0]
        ?.version || 'unknown';
    authColumns = await getAuthColumns(preflight);
    appTableCounts = await getTableCounts(
      preflight,
      await getApplicationTables(preflight, config.appSchemas),
    );
    authRowCounts = await getTableCounts(preflight, [...authTables]);
  } finally {
    await preflight.end();
  }
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
    const pgEnv = toLibpqEnvironment(connection);
    await runner.run(
      'pg_dump',
      [
        '--format=custom',
        ...config.appSchemas.map((schema) => `--schema=${schema}`),
        '--no-owner',
        '--no-privileges',
        `--file=${appDump}`,
      ],
      { env: pgEnv },
    );
    await runner.run(
      'pg_dump',
      [
        '--format=custom',
        '--data-only',
        ...authTables.map((table) => `--table=${table}`),
        '--no-owner',
        '--no-privileges',
        `--file=${authDump}`,
      ],
      { env: pgEnv },
    );
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
    const [appSha256, authSha256, appBytes, authBytes, pgDumpVersion] = await Promise.all(
      [
        sha256File(appEncrypted),
        sha256File(authEncrypted),
        stat(appEncrypted).then((file) => file.size),
        stat(authEncrypted).then((file) => file.size),
        runner.run('pg_dump', ['--version']),
      ],
    );
    const manifest: BackupManifest = {
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
      pgDumpVersion,
      postgresServerVersion: serverVersion,
      cliVersion: packageVersion,
      authColumns,
      appTableCounts,
      authRowCounts,
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
    await store.putImmutable(keys.manifest, Buffer.from(`${JSON.stringify(manifest)}\n`));
    for (const key of Object.values(keys))
      if (!(await store.has(key)))
        throw new BackupError(
          'R2 verification failed after upload; manifest cannot be trusted.',
        );
    return manifest;
  });
}
