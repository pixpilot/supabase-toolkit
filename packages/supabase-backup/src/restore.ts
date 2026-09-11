import type { BackupManifest } from './manifest.js';

import type { ProgramRunner } from './process.js';
import type { ObjectStore } from './r2.js';
import { join } from 'node:path';
import {
  connectForPreflight,
  ensureApplicationSchemasEmpty,
  ensureAuthCompatible,
  ensureAuthTablesEmpty,
  ensureCountsMatch,
  getExistingSchemas,
} from './auth.js';
import { loadRestoreConfig } from './config.js';
import {
  databaseLabel,
  ensureDifferentDatabases,
  parseDatabaseUrl,
  restoreTargetRef,
  toLibpqEnvironment,
} from './database-url.js';
import { BackupError } from './errors.js';
import {
  ensureNonEmptyFile,
  sha256File,
  withTemporaryDirectory,
  writePrivateFile,
} from './files.js';
import { parseManifest } from './manifest.js';
import { ensureRestoreToolSupportsArchive } from './postgres-tools.js';
import { systemRunner } from './process.js';
import { R2Store } from './r2.js';
import { ensureValidManifestKey } from './validation.js';

export interface RestoreOptions {
  apply: boolean;
  confirmTarget?: string;
  key: string;
}

/**
 * Selects one Auth table, the only way `pg_restore` accepts one.
 *
 * `--table` takes a bare table name and ignores any schema in it, so
 * `--table=auth.users` silently matches nothing and the run still succeeds
 * having restored no rows. The schema has to travel in `--schema` instead.
 *
 * `--dbname` is equally unavoidable: the rest of the connection arrives through
 * the libpq environment, which keeps the password out of the process arguments,
 * but PostgreSQL 16 and later refuse to run without `-d` or `-f`, and earlier
 * versions would print SQL to stdout instead of restoring.
 */
export function authRestoreArguments(
  database: string,
  table: string,
  archive: string,
): string[] {
  const [schema, name] = table.split('.');
  if (!schema || !name || name.includes('.'))
    throw new BackupError(`Auth table '${table}' must be schema-qualified.`);
  return [
    '--dbname',
    database,
    '--data-only',
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    `--schema=${schema}`,
    `--table=${name}`,
    archive,
  ];
}

/** Matches one archive entry that creates a schema, in `pg_restore --list` output. */
const schemaEntry = /^\s*\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+(\S+)\s/u;

/**
 * Removes the schema-creation entries for schemas the target already has.
 *
 * `pg_dump --schema=<name>` always writes a `CREATE SCHEMA` entry for the schema
 * it was pointed at, and every database already owns `public`, so restoring the
 * entry aborts the run. Dropping just that entry from the archive's table of
 * contents leaves everything inside the schema untouched, and a schema the
 * target does not have is still created.
 */
export function filterExistingSchemas(list: string, existing: readonly string[]): string {
  if (!existing.length) return list;
  const wanted = new Set(existing);
  return list
    .split('\n')
    .filter((line) => {
      const match = schemaEntry.exec(line);
      return !match?.[1] || !wanted.has(match[1]);
    })
    .join('\n');
}

/**
 * Writes a table of contents that skips creating schemas the target already has.
 *
 * Returns the list path when one is needed, and nothing when the archive can be
 * restored whole, so the common case stays a plain `pg_restore`.
 */
async function appTableOfContents(
  runner: ProgramRunner,
  archive: string,
  listPath: string,
  existing: readonly string[],
): Promise<string | undefined> {
  const list = await runner.run('pg_restore', ['--list', archive]);
  const filtered = filterExistingSchemas(list, existing);
  if (filtered === list) return undefined;
  await writePrivateFile(listPath, `${filtered}\n`);
  return listPath;
}

/**
 * Arguments that load the application schemas into an empty target.
 *
 * There is deliberately no `--clean`: its `DROP … IF EXISTS` statements guard
 * only the object, not the table it belongs to, so cleaning a database that does
 * not already hold the whole schema aborts the restore. The preflight requires
 * empty application schemas instead, which also means a restore never drops
 * anything.
 */
export function appRestoreArguments(
  database: string,
  archive: string,
  tocList?: string,
): string[] {
  return [
    '--dbname',
    database,
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    ...(tocList ? ['--use-list', tocList] : []),
    archive,
  ];
}

/** Downloads, verifies, decrypts, and optionally restores a single manifest. */
export async function restore(
  options: RestoreOptions,
  env = process.env,
  dependencies: { runner?: ProgramRunner; store?: ObjectStore } = {},
): Promise<BackupManifest> {
  ensureValidManifestKey(options.key);
  const config = loadRestoreConfig(env, options.apply);
  const store = dependencies.store || new R2Store(config);
  const runner = dependencies.runner || systemRunner;
  const manifest = parseManifest(
    Buffer.from(await store.get(options.key)).toString('utf8'),
  );
  await ensureRestoreToolSupportsArchive(runner, manifest.pgDumpVersion);
  const target = config.targetDatabaseUrl
    ? parseDatabaseUrl(config.targetDatabaseUrl)
    : undefined;
  if (target)
    ensureDifferentDatabases(
      config.sourceDatabaseUrl ? parseDatabaseUrl(config.sourceDatabaseUrl) : undefined,
      target,
    );
  if (options.apply) {
    if (!target) throw new BackupError('TARGET_DATABASE_URL is required with --apply.');
    if (options.confirmTarget !== restoreTargetRef(target))
      throw new BackupError(
        `Restore confirmation must exactly equal '${restoreTargetRef(target)}'.`,
      );
  }
  return withTemporaryDirectory(async (directory) => {
    const appEncrypted = join(directory, 'app.dump.age');
    const authEncrypted = join(directory, 'auth.dump.age');
    const appDump = join(directory, 'app.dump');
    const authDump = join(directory, 'auth.dump');
    const identity = join(directory, 'identity.txt');
    const [appChecksum, authChecksum] = await Promise.all([
      store.get(manifest.appChecksumObjectKey),
      store.get(manifest.authChecksumObjectKey),
      writePrivateFile(appEncrypted, await store.get(manifest.appObjectKey)),
      writePrivateFile(authEncrypted, await store.get(manifest.authObjectKey)),
      writePrivateFile(
        identity,
        `${config.ageIdentity}
`,
      ),
    ]);
    const [actualAppSha, actualAuthSha] = await Promise.all([
      sha256File(appEncrypted),
      sha256File(authEncrypted),
    ]);
    if (
      actualAppSha !== manifest.appSha256 ||
      actualAuthSha !== manifest.authSha256 ||
      !Buffer.from(appChecksum).toString('utf8').startsWith(manifest.appSha256) ||
      !Buffer.from(authChecksum).toString('utf8').startsWith(manifest.authSha256)
    )
      throw new BackupError('Encrypted archive checksum verification failed.');
    await runner.run('age', [
      '--decrypt',
      '--identity',
      identity,
      '--output',
      appDump,
      appEncrypted,
    ]);
    await runner.run('age', [
      '--decrypt',
      '--identity',
      identity,
      '--output',
      authDump,
      authEncrypted,
    ]);
    for (const archive of [appDump, authDump]) {
      await ensureNonEmptyFile(archive);
      await runner.run('pg_restore', ['--list', archive]);
    }
    if (!target) {
      process.stdout.write(
        `Restore plan (no changes): manifest ${options.key}; app schemas ${manifest.appSchemas.join(', ')}; Auth tables ${manifest.authTables.join(', ')}. The archive is intact and decrypts. Pass --target-database-url to also check that a database can accept it.\n`,
      );
      return manifest;
    }
    const targetDb = await connectForPreflight(target);
    try {
      await ensureAuthCompatible(targetDb, manifest.authColumns);
      if (!options.apply) {
        process.stdout.write(
          `Restore plan (no changes): target ${databaseLabel(target)}; Auth tables ${manifest.authTables.join(', ')} then application schemas ${manifest.appSchemas.join(', ')}. The target accepts this backup; pass --apply to write it, which needs those schemas and the target Auth tables empty.\n`,
        );
        return manifest;
      }
      await ensureAuthTablesEmpty(targetDb);
      await ensureApplicationSchemasEmpty(targetDb, manifest.appSchemas);
      const pgEnv = toLibpqEnvironment(target);
      for (const table of manifest.authTables)
        await runner.run(
          'pg_restore',
          authRestoreArguments(target.database, table, authDump),
          { env: pgEnv },
        );
      /* Before the application data, whose foreign keys reference these rows. */
      await ensureCountsMatch(targetDb, manifest.authRowCounts);
      const appList = await appTableOfContents(
        runner,
        appDump,
        join(directory, 'app.list'),
        await getExistingSchemas(targetDb, manifest.appSchemas),
      );
      await runner.run(
        'pg_restore',
        appRestoreArguments(target.database, appDump, appList),
        { env: pgEnv },
      );
      await ensureCountsMatch(targetDb, manifest.appTableCounts);
    } finally {
      await targetDb.end();
    }
    process.stdout.write(
      `Restore database phase complete for ${databaseLabel(target)}. Manually verify an existing user can authenticate and run a representative application workflow before declaring recovery complete.\n`,
    );
    return manifest;
  });
}
