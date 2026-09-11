import type { BackupManifest } from './manifest.js';

import type { ProgramRunner } from './process.js';
import type { ObjectStore } from './r2.js';
import { join } from 'node:path';
import {
  connectForPreflight,
  ensureApplicationSchemasEmpty,
  ensureAuthCompatible,
  ensureAuthTablesEmpty,
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
import { ensureNonEmptyFile, withTemporaryDirectory, writePrivateFile } from './files.js';
import { parseManifest } from './manifest.js';
import { ensureRestoreToolSupportsArchive } from './postgres-tools.js';
import { systemRunner } from './process.js';
import { R2Store } from './r2.js';
import { readVerifiedArchives } from './read-verified-archives.js';
import {
  authTriggerList,
  restorePreflightSql,
  restoreValidationSql,
} from './restore-sql.js';
import { ensureValidManifestKey } from './validation.js';

export interface RestoreOptions {
  apply: boolean;
  confirmTarget?: string;
  key: string;
}

/** Renders one Auth table's data to SQL for the shared restore transaction. */
export function authRestoreArguments(
  outputFile: string,
  table: string,
  archive: string,
): string[] {
  const [schema, name, extra] = table.split('.');
  if (
    schema !== 'auth' ||
    !['users', 'identities'].includes(name ?? '') ||
    extra !== undefined
  )
    throw new BackupError(`Auth table '${table}' must be schema-qualified.`);
  return [
    '--file',
    outputFile,
    '--data-only',
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    '--strict-names',
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

/** Renders application SQL with its original ownership and access rules. */
export function appRestoreArguments(
  outputFile: string,
  archive: string,
  tocList?: string,
): string[] {
  return [
    '--file',
    outputFile,
    '--exit-on-error',
    ...(tocList ? ['--use-list', tocList] : []),
    archive,
  ];
}

/**
 * What a restored database still needs before the project works again.
 *
 * A backup holds the application schemas and the Auth rows, so everything that
 * lives outside them survives only by being set up again. This is printed where
 * it is noticed: at the end of a restore, by whoever is in the middle of a
 * recovery.
 */
export const restoreFollowUp = `
The database is restored; the project is not. Set these up by hand:

  Access        Application ownership, GRANT/REVOKE rules, and Auth table
                triggers are restored. Verify access as anon, authenticated,
                service_role, and supabase_auth_admin before serving traffic.
  Auth Hooks    A hook is project configuration, not a database object. Point it
                back at its function under Authentication -> Hooks, or push it
                from config.toml.
  Auth settings Providers and their secrets, SMTP, email templates, redirect
                URLs, and the JWT secret.
  Elsewhere     Storage objects, edge functions and their secrets, cron jobs,
                Vault secrets, and anything in a schema that was not backed up.

Sessions are not part of a backup either, so every user signs in again. Verify
that an existing user can, and that one representative workflow runs, before
calling the recovery complete.
`;

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
    const archives = await readVerifiedArchives(manifest, store);
    await Promise.all([
      writePrivateFile(appEncrypted, archives.app),
      writePrivateFile(authEncrypted, archives.auth),
      writePrivateFile(identity, `${config.ageIdentity}\n`),
    ]);
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
          `Restore plan (no changes): target ${databaseLabel(target)}; Auth columns are compatible. Apply requires empty application schemas and Auth tables, matching roles/extensions, and no existing custom Auth triggers.\n`,
        );
        return manifest;
      }
      await ensureAuthTablesEmpty(targetDb);
      await ensureApplicationSchemasEmpty(targetDb, manifest.appSchemas);
      const appList = await appTableOfContents(
        runner,
        appDump,
        join(directory, 'app.list'),
        await getExistingSchemas(targetDb, manifest.appSchemas),
      );
      const preflightSql = join(directory, 'preflight.sql');
      const validationSql = join(directory, 'validation.sql');
      const appSql = join(directory, 'app.sql');
      const authSql: string[] = [];
      for (const table of manifest.authTables) {
        const file = join(directory, `${table}.sql`);
        await runner.run('pg_restore', authRestoreArguments(file, table, authDump));
        authSql.push(file);
      }
      await runner.run('pg_restore', appRestoreArguments(appSql, appDump, appList));
      const triggers = authTriggerList(
        await runner.run('pg_restore', ['--list', authDump]),
      );
      const triggerFiles: string[] = [];
      if (triggers) {
        const listFile = join(directory, 'auth-triggers.list');
        const sqlFile = join(directory, 'auth-triggers.sql');
        await writePrivateFile(listFile, `${triggers}\n`);
        await runner.run('pg_restore', [
          '--file',
          sqlFile,
          '--no-owner',
          '--no-privileges',
          '--use-list',
          listFile,
          authDump,
        ]);
        triggerFiles.push(sqlFile);
      }
      await writePrivateFile(preflightSql, restorePreflightSql(manifest.appSchemas));
      await writePrivateFile(validationSql, restoreValidationSql(manifest));
      // psql owns the one connection/transaction, including checks before COMMIT.
      await runner.run(
        'psql',
        [
          '--no-psqlrc',
          '--no-password',
          '--single-transaction',
          '--quiet',
          '--set=ON_ERROR_STOP=on',
          '--set=ON_ERROR_ROLLBACK=off',
          '--dbname',
          target.database,
          ...[preflightSql, ...authSql, appSql, ...triggerFiles, validationSql].flatMap(
            (file) => ['--file', file],
          ),
        ],
        { env: toLibpqEnvironment(target) },
      );
    } finally {
      await targetDb.end();
    }
    process.stdout.write(
      `Restore database phase complete for ${databaseLabel(target)}.\n${restoreFollowUp}`,
    );
    return manifest;
  });
}
