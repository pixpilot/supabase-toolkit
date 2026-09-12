import type { BackupManifest } from './manifest.js';

import type { ProgramRunner } from './process.js';
import type { ObjectStore } from './r2.js';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  connectForPreflight,
  ensureApplicationSchemasEmpty,
  ensureAuthCompatible,
  ensureAuthTablesEmpty,
  getExistingSchemas,
} from './auth.js';
import { checkRestoreAccess } from './check-restore-access.js';
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
import { filterManagedDefaultPrivileges } from './filter-managed-default-privileges.js';
import { parseManifest } from './manifest.js';
import { ensureRestoreToolSupportsArchive } from './postgres-tools.js';
import { systemRunner } from './process.js';
import { R2Store } from './r2.js';
import { readVerifiedArchives } from './read-verified-archives.js';
import { resetExistingSchemaPrivilegesSql } from './reset-existing-schema-privileges.js';
import {
  prepareRestoreDefaultsSql,
  restoreTargetDefaultsSql,
} from './restore-default-privileges.js';
import { createRestoreProgress, logRestoreProgress } from './restore-progress.js';
import {
  authTriggerList,
  restorePreflightSql,
  restoreValidationSql,
} from './restore-sql.js';
import { reuseExistingSchemas } from './reuse-existing-schemas.js';
import { ensureValidManifestKey } from './validation.js';

export interface RestoreOptions {
  apply: boolean;
  accessChecks?: boolean;
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
 * Separates existing schemas and default ACLs so ownership and creation defaults
 * can be handled without changing the archived object grants.
 */
async function appTableOfContents(
  runner: ProgramRunner,
  archive: string,
  listPath: string,
  existing: readonly string[],
): Promise<{ appList?: string; schemaSql: string[]; defaultSql: string[] }> {
  const list = await runner.run('pg_restore', ['--list', archive]);
  const portable = filterManagedDefaultPrivileges(list);
  if (portable !== list)
    process.stdout.write(
      "Keeping target default privileges for Supabase-managed role supabase_admin. Application ownership, object grants, and other roles' default privileges are still restored.\n",
    );
  const withoutSchemas = filterExistingSchemas(portable, existing);
  const retained = new Set(withoutSchemas.split('\n'));
  const schemas = portable
    .split('\n')
    .filter((line) => !retained.has(line))
    .join('\n');
  const defaultEntry = /^\s*\d+;\s+\d+\s+\d+\s+DEFAULT ACL\s/u;
  const defaults = withoutSchemas
    .split('\n')
    .filter((line) => defaultEntry.test(line))
    .join('\n');
  const filtered = withoutSchemas
    .split('\n')
    .filter((line) => !defaultEntry.test(line))
    .join('\n');
  const render = async (name: string, entries: string): Promise<string[]> => {
    if (!entries) return [];
    const selection = join(dirname(listPath), `${name}.list`);
    const file = join(dirname(listPath), `${name}.sql`);
    await writePrivateFile(selection, `${entries}\n`);
    await runner.run('pg_restore', appRestoreArguments(file, archive, selection));
    if (name === 'existing-schemas')
      await writePrivateFile(
        file,
        reuseExistingSchemas(await readFile(file, 'utf8'), existing) +
          resetExistingSchemaPrivilegesSql(existing),
      );
    return [file];
  };
  const schemaSql = await render('existing-schemas', schemas);
  const defaultSql = await render('app-defaults', defaults);
  if (filtered === list) return { schemaSql, defaultSql };
  await writePrivateFile(listPath, `${filtered}\n`);
  return { appList: listPath, schemaSql, defaultSql };
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
                supabase_admin default privileges stay as configured on the
                target; review defaults for future objects separately.
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
  logRestoreProgress(
    options.apply
      ? 'Starting restore...'
      : 'Starting restore plan (no database changes)...',
  );
  ensureValidManifestKey(options.key);
  const config = loadRestoreConfig(env, options.apply);
  const store = dependencies.store || new R2Store(config);
  const runner = dependencies.runner || systemRunner;
  logRestoreProgress('Loading backup manifest...');
  const manifest = parseManifest(
    Buffer.from(await store.get(options.key)).toString('utf8'),
  );
  logRestoreProgress('Checking PostgreSQL tool compatibility...');
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
    logRestoreProgress(
      'Downloading application and Auth archives and verifying checksums...',
    );
    const archives = await readVerifiedArchives(manifest, store);
    logRestoreProgress(
      'Archive checksums verified. Preparing temporary restore files...',
    );
    await Promise.all([
      writePrivateFile(appEncrypted, archives.app),
      writePrivateFile(authEncrypted, archives.auth),
      writePrivateFile(identity, `${config.ageIdentity}\n`),
    ]);
    logRestoreProgress('Decrypting application archive...');
    await runner.run('age', [
      '--decrypt',
      '--identity',
      identity,
      '--output',
      appDump,
      appEncrypted,
    ]);
    logRestoreProgress('Decrypting Auth archive...');
    await runner.run('age', [
      '--decrypt',
      '--identity',
      identity,
      '--output',
      authDump,
      authEncrypted,
    ]);
    logRestoreProgress('Checking decrypted archives can be read...');
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
    logRestoreProgress(`Connecting to restore target ${databaseLabel(target)}...`);
    const targetDb = await connectForPreflight(target);
    try {
      logRestoreProgress('Checking target Auth table compatibility...');
      await ensureAuthCompatible(targetDb, manifest.authColumns);
      if (!options.apply) {
        process.stdout.write(
          `Restore plan (no changes): target ${databaseLabel(target)}; Auth columns are compatible. Apply requires empty application schemas and Auth tables, matching roles/extensions, and no existing custom Auth triggers.\n`,
        );
        return manifest;
      }
      logRestoreProgress('Checking target Auth tables are empty...');
      await ensureAuthTablesEmpty(targetDb);
      logRestoreProgress('Checking target application schemas are empty...');
      await ensureApplicationSchemasEmpty(targetDb, manifest.appSchemas);
      logRestoreProgress('Preparing application schemas and access rules...');
      const application = await appTableOfContents(
        runner,
        appDump,
        join(directory, 'app.list'),
        await getExistingSchemas(targetDb, manifest.appSchemas),
      );
      const preflightSql = join(directory, 'preflight.sql');
      const validationSql = join(directory, 'validation.sql');
      const defaultsSql = join(directory, 'target-defaults.sql');
      const appSql = join(directory, 'app.sql');
      const authSql: string[] = [];
      for (const table of manifest.authTables) {
        logRestoreProgress(`Preparing data for ${table}...`);
        const file = join(directory, `${table}.sql`);
        await runner.run('pg_restore', authRestoreArguments(file, table, authDump));
        authSql.push(file);
      }
      logRestoreProgress('Preparing application schema and data SQL...');
      await runner.run(
        'pg_restore',
        appRestoreArguments(appSql, appDump, application.appList),
      );
      logRestoreProgress('Preparing Auth triggers...');
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
      logRestoreProgress(
        'Preparing transaction checks and row-count/access validation...',
      );
      await writePrivateFile(
        preflightSql,
        restorePreflightSql(manifest.appSchemas) +
          prepareRestoreDefaultsSql(manifest.appSchemas),
      );
      await writePrivateFile(defaultsSql, restoreTargetDefaultsSql());
      await writePrivateFile(validationSql, restoreValidationSql(manifest));
      const progress = createRestoreProgress([
        {
          message: 'Locking target tables and preparing default privileges...',
          file: preflightSql,
        },
        ...authSql.map((file, index) => ({
          message: `Restoring ${manifest.authTables[index]} data...`,
          file,
        })),
        ...application.schemaSql.map((file) => ({
          message: 'Restoring existing schema ownership and grants...',
          file,
        })),
        {
          message: 'Restoring application schemas, data, and access rules...',
          file: appSql,
        },
        { message: 'Reinstating target default privileges...', file: defaultsSql },
        ...application.defaultSql.map((file) => ({
          message: 'Applying archived application default privileges...',
          file,
        })),
        ...triggerFiles.map((file) => ({ message: 'Restoring Auth triggers...', file })),
        {
          message: 'Validating restored row counts, ownership, and privileges...',
          file: validationSql,
        },
        { message: 'Validation passed. Committing restore...' },
      ]);
      // psql owns the one connection/transaction, including checks before COMMIT.
      logRestoreProgress('Starting database restore transaction...');
      try {
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
            ...progress.args,
          ],
          { env: toLibpqEnvironment(target), onStdout: progress.onStdout },
        );
      } catch (error: unknown) {
        const role =
          error instanceof Error
            ? /ERROR:\s+role "([^\r\n]+)" does not exist/u.exec(error.message)?.[1]
            : undefined;
        if (!role || !(error instanceof Error)) throw error;
        const identifier = `"${role.replaceAll('"', '""')}"`;
        throw new BackupError(
          `${error.message}\nRestore transaction rolled back. The recovery database is missing role ${identifier}. ` +
            `Create the role on the recovery database, then retry: CREATE ROLE ${identifier} NOLOGIN; ` +
            'Role definitions, login credentials, and memberships are not included in this backup; configure those separately as needed.',
        );
      }
      logRestoreProgress('Restore transaction committed successfully.');
      await checkRestoreAccess(
        targetDb,
        manifest.appSchemas,
        manifest.accessChecks,
        options.accessChecks,
      );
      logRestoreProgress('Cleaning up temporary files...');
    } finally {
      await targetDb.end();
    }
    process.stdout.write(
      `Restore database phase complete for ${databaseLabel(target)}.\n${restoreFollowUp}`,
    );
    return manifest;
  });
}
