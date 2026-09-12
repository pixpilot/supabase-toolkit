/* eslint-disable ts/explicit-module-boundary-types */
import type { BackupConfig } from '../core/config.js';
import type { Queryable } from '../db/auth.js';
import type { DatabaseConnection } from '../db/database-url.js';
import type { ProgramRunner } from '../utils/process.js';
import { BackupError } from '../core/errors.js';
import { authTables } from '../core/manifest.js';
import { selectBackupSchemas } from '../core/schemas.js';
import { applicationAccessSql } from '../db/application-access.js';
import {
  connectForPreflight,
  ensureSupportedAuthState,
  getApplicationTables,
  getAuthColumns,
  getManagedStorageTables,
  getSchemaNames,
  getTableCounts,
} from '../db/auth.js';
import { parseDatabaseUrl, toLibpqEnvironment } from '../db/database-url.js';
import { ensureDumpToolsCompatible } from '../db/postgres-tools.js';
import { captureAccessChecks } from './capture-access-checks.js';

/**
 * Decides which schemas this run dumps whole.
 *
 * A run that named schemas gets exactly those, so nothing it did not ask for is
 * read. A run that named none gets every schema the project owns, which is the
 * only way a schema added later still reaches the backup.
 */
async function chooseSchemas(db: Queryable, config: BackupConfig): Promise<string[]> {
  const discovered = await getSchemaNames(db);
  const missing = config.appSchemas?.filter((schema) => !discovered.includes(schema));
  if (missing?.length)
    throw new BackupError(
      `--schemas names ${missing.join(', ')}, which the source database does not have.`,
    );
  const schemas = config.appSchemas
    ? config.appSchemas.filter((schema) => !config.excludedSchemas.includes(schema))
    : selectBackupSchemas(discovered, config.excludedSchemas);
  if (!schemas.length)
    throw new BackupError(
      'No schemas left to back up. Name the schemas to dump with --schemas, or leave more of them in with --exclude-schemas.',
    );
  return schemas;
}

/** Opens the snapshot connection; injected in tests so no database is needed. */
export type DumpConnect = (
  connection: DatabaseConnection,
) => Promise<Queryable & { end: () => Promise<void> }>;

/** Captures metadata and both archives from one exported, read-only snapshot. */
export async function dumpDatabase(
  config: BackupConfig,
  runner: ProgramRunner,
  appDump: string,
  authDump: string,
  connect: DumpConnect = connectForPreflight,
) {
  const connection = parseDatabaseUrl(config.sourceDatabaseUrl);
  const db = await connect(connection);
  try {
    const postgresServerVersion =
      (await db.query<{ version: string }>('SHOW server_version')).rows[0]?.version ||
      'unknown';
    const pgDumpVersion = await ensureDumpToolsCompatible(runner, postgresServerVersion);
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query('SET LOCAL search_path = pg_catalog');
    const snapshot = (
      await db.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot')
    ).rows[0]?.snapshot;
    if (!snapshot) throw new BackupError('Could not export a database snapshot.');
    await ensureSupportedAuthState(db);
    const authColumns = await getAuthColumns(db);
    const appSchemas = await chooseSchemas(db, config);
    const storage = await getManagedStorageTables(db);
    if (storage.unreadable.length)
      process.stderr.write(
        `Skipping ${storage.unreadable.join(', ')}: the backup role cannot read them. Grant SELECT to include storage metadata.\n`,
      );
    const appTableCounts = await getTableCounts(
      db,
      await getApplicationTables(db, appSchemas),
    );
    const authRowCounts = await getTableCounts(db, [...authTables]);
    const storageRowCounts = await getTableCounts(db, storage.readable);
    const appAccessFingerprint = (
      await db.query<{ fingerprint: string }>(applicationAccessSql(appSchemas))
    ).rows[0]?.fingerprint;
    if (!appAccessFingerprint)
      throw new BackupError('Could not capture application access rules.');
    const accessChecks = await captureAccessChecks(db, appSchemas);
    const common = ['--format=custom', '--strict-names', `--snapshot=${snapshot}`];
    const options = { env: toLibpqEnvironment(connection) };
    await runner.run(
      'pg_dump',
      [
        ...common,
        ...appSchemas.map((schema) => `--schema="${schema}"`),
        `--file=${appDump}`,
      ],
      options,
    );
    // Keep Auth trigger definitions, but restore its managed tables as data only.
    await runner.run(
      'pg_dump',
      [
        ...common,
        ...[...authTables, ...storage.readable].map((table) => `--table=${table}`),
        '--no-owner',
        '--no-privileges',
        `--file=${authDump}`,
      ],
      options,
    );
    return {
      ...(accessChecks ? { accessChecks } : {}),
      ...(storage.readable.length
        ? { storageTables: storage.readable, storageRowCounts }
        : {}),
      appSchemas,
      postgresServerVersion,
      pgDumpVersion,
      authColumns,
      appTableCounts,
      authRowCounts,
      appAccessFingerprint,
    };
  } finally {
    // Closing the connection also rolls back the read-only transaction on failure.
    await db.end();
  }
}
