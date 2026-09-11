/* eslint-disable ts/explicit-module-boundary-types */
import type { BackupConfig } from './config.js';
import type { ProgramRunner } from './process.js';
import { applicationAccessSql } from './application-access.js';
import {
  connectForPreflight,
  ensureSupportedAuthState,
  getApplicationTables,
  getAuthColumns,
  getTableCounts,
} from './auth.js';
import { parseDatabaseUrl, toLibpqEnvironment } from './database-url.js';
import { BackupError } from './errors.js';
import { authTables } from './manifest.js';
import { ensureDumpToolsCompatible } from './postgres-tools.js';

/** Captures metadata and both archives from one exported, read-only snapshot. */
export async function dumpDatabase(
  config: BackupConfig,
  runner: ProgramRunner,
  appDump: string,
  authDump: string,
) {
  const connection = parseDatabaseUrl(config.sourceDatabaseUrl);
  const db = await connectForPreflight(connection);
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
    const appTableCounts = await getTableCounts(
      db,
      await getApplicationTables(db, config.appSchemas),
    );
    const authRowCounts = await getTableCounts(db, [...authTables]);
    const appAccessFingerprint = (
      await db.query<{ fingerprint: string }>(applicationAccessSql(config.appSchemas))
    ).rows[0]?.fingerprint;
    if (!appAccessFingerprint)
      throw new BackupError('Could not capture application access rules.');
    const common = ['--format=custom', '--strict-names', `--snapshot=${snapshot}`];
    const options = { env: toLibpqEnvironment(connection) };
    await runner.run(
      'pg_dump',
      [
        ...common,
        ...config.appSchemas.map((schema) => `--schema="${schema}"`),
        `--file=${appDump}`,
      ],
      options,
    );
    // Keep Auth trigger definitions, but restore its managed tables as data only.
    await runner.run(
      'pg_dump',
      [
        ...common,
        ...authTables.map((table) => `--table=${table}`),
        '--no-owner',
        '--no-privileges',
        `--file=${authDump}`,
      ],
      options,
    );
    return {
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
