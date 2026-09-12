import type { AuthTable, Column, StorageTable, TableCount } from '../core/manifest.js';

import type { DatabaseConnection } from './database-url.js';
import { Client } from 'pg';
import { BackupError } from '../core/errors.js';
import { storageTables } from '../core/manifest.js';
import { redact } from '../utils/redact.js';
import { databaseLabel } from './database-url.js';

export interface Queryable {
  query: <T extends Record<string, unknown>>(sql: string) => Promise<{ rows: T[] }>;
}

const unsupportedTables = ['mfa_factors', 'sso_providers', 'saml_providers'] as const;

/** Network failures that mean the host itself could not be reached. */
const unreachableCodes = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

/** The driver's wording when TLS was required and the server offered none. */
const noServerSsl = /does not support SSL/iu;

/**
 * Explains a failed preflight connection without leaking the credentials.
 *
 * The label names the host, port, and database that were actually tried, which
 * is usually the mistake, and the driver's own reason distinguishes a wrong
 * password from a host that never answered.
 */
export function preflightFailureMessage(
  connection: DatabaseConnection,
  error: unknown,
): string {
  const reason = redact(
    error instanceof Error && error.message ? error.message : 'no reason reported',
  );
  const { code } = error as { code?: unknown };
  const supabaseDirect =
    typeof code === 'string' &&
    unreachableCodes.has(code) &&
    /^db\.[a-z0-9]+\.supabase\.co$/u.test(connection.host);
  /*
   * A database that serves no TLS at all is the normal local one, and the
   * driver's own wording says nothing about how to connect to it anyway. The
   * hint names the URL parameter rather than offering a flag, because a
   * connection setting belongs to the connection string that carries it.
   */
  let hint = '';
  if (noServerSsl.test(reason))
    hint =
      " The database serves no TLS, which is how a local database such as the one 'supabase start' runs on port 54322 is set up. Add '?sslmode=disable' to the database URL to connect to it without TLS. Never do this for a database reached over a network.";
  else if (supabaseDirect)
    hint =
      " A direct db.<project-ref>.supabase.co connection resolves to IPv6 only unless the IPv4 add-on is enabled; use the Session Pooler host on port 5432 instead, whose user is 'postgres.<project-ref>'.";
  return `Database preflight connection to ${databaseLabel(connection)} failed: ${reason}.${hint}`;
}

/** Connects for read-only metadata checks; dump and restore still use libpq environment variables. */
export async function connectForPreflight(
  connection: DatabaseConnection,
): Promise<Client> {
  const client = new Client({
    host: connection.host,
    port: Number(connection.port),
    user: connection.user,
    password: connection.password,
    database: connection.database,
    ssl: connection.sslmode === 'disable' ? false : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    return client;
  } catch (error: unknown) {
    throw new BackupError(preflightFailureMessage(connection, error));
  }
}

/** Fails when non-empty durable Auth features would be omitted from the backup. */
export async function ensureSupportedAuthState(db: Queryable): Promise<void> {
  const result = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' AND table_name IN ('mfa_factors', 'sso_providers', 'saml_providers')",
  );
  for (const { table_name } of result.rows) {
    const safeName = unsupportedTables.find((name) => name === table_name);
    if (!safeName) continue;
    const rows = await db.query<{ has_rows: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM auth.${safeName} LIMIT 1) AS has_rows`,
    );
    if (rows.rows[0]?.has_rows)
      throw new BackupError(
        `Unsupported durable Auth state detected in auth.${safeName}. Add explicit support before backing up this project.`,
      );
  }
}

/** Reads Auth column names/types for compatibility checks recorded in the manifest. */
export async function getAuthColumns(
  db: Queryable,
): Promise<Record<AuthTable, Column[]>> {
  const rows = await db.query<{
    column_name: string;
    data_type: string;
    table_name: string;
  }>(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'auth' AND table_name IN ('users', 'identities') ORDER BY table_name, ordinal_position",
  );
  const result: Record<AuthTable, Column[]> = { 'auth.users': [], 'auth.identities': [] };
  for (const row of rows.rows) {
    const table = `auth.${row.table_name}` as AuthTable;
    if (table in result)
      result[table].push({ name: row.column_name, dataType: row.data_type });
  }
  if (Object.values(result).some((columns) => columns.length === 0))
    throw new BackupError('Required Auth tables are missing.');
  return result;
}

/** Verifies target Auth columns/types can accept the backed-up data. */
export async function ensureAuthCompatible(
  db: Queryable,
  expected: Record<AuthTable, Column[]>,
): Promise<void> {
  const actual = await getAuthColumns(db);
  for (const table of Object.keys(expected) as AuthTable[]) {
    for (const column of expected[table]) {
      const target = actual[table].find((candidate) => candidate.name === column.name);
      if (!target || target.dataType !== column.dataType)
        throw new BackupError(
          `Target ${table} is incompatible at column '${column.name}'. Use a Supabase project with matching Auth schema.`,
        );
    }
  }
}

/** Returns row counts for tables included in backup/restore validation. */
export async function getTableCounts(
  db: Queryable,
  tables: string[],
): Promise<TableCount[]> {
  const result: TableCount[] = [];
  for (const table of tables) {
    if (!/^(auth\.(users|identities)|[A-Za-z_][\w$]*\.[A-Za-z_][\w$]*)$/u.test(table))
      throw new BackupError('Invalid table identifier.');
    const [schema, name] = table.split('.');
    if (schema === undefined || name === undefined)
      throw new BackupError('Invalid table identifier.');
    const count = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}"."${name}"`,
    );
    result.push({ table, count: Number(count.rows[0]?.count || 0) });
  }
  return result;
}

/** Requires empty target Auth tables before modifying them. */
export async function ensureAuthTablesEmpty(db: Queryable): Promise<void> {
  const counts = await getTableCounts(db, ['auth.users', 'auth.identities']);
  if (counts.some(({ count }) => count !== 0))
    throw new BackupError(
      'Target auth.users and auth.identities must be empty for recovery restore.',
    );
}

/** Finds application table names for post-restore count validation. */
export async function getApplicationTables(
  db: Queryable,
  schemas: string[],
): Promise<string[]> {
  const values = schemas.map((schema) => `'${schema.replace(/'/gu, "''")}'`).join(', ');
  const result = await db.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema IN (${values}) ORDER BY table_schema, table_name`,
  );
  return result.rows.map(
    ({ table_schema, table_name }) => `${table_schema}.${table_name}`,
  );
}

/** Reports which of the application schemas the target database already has. */
export async function getExistingSchemas(
  db: Queryable,
  schemas: string[],
): Promise<string[]> {
  const values = schemas.map((schema) => `'${schema.replace(/'/gu, "''")}'`).join(', ');
  const result = await db.query<{ schema_name: string }>(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN (${values})`,
  );
  return result.rows.map(({ schema_name }) => schema_name);
}

/** Lists every schema the database has, so a backup can pick what it owns. */
export async function getSchemaNames(db: Queryable): Promise<string[]> {
  const result = await db.query<{ schema_name: string }>(
    'SELECT nspname AS schema_name FROM pg_namespace ORDER BY nspname',
  );
  return result.rows.map(({ schema_name }) => schema_name);
}

/**
 * Reports which managed storage tables this database has, and which it withholds.
 *
 * A database without Supabase Storage reports neither, so it is not treated as a
 * backup that lost something. A table the connected role cannot read is reported
 * separately, because that is worth saying out loud rather than dumping nothing.
 */
export async function getManagedStorageTables(
  db: Queryable,
): Promise<{ readable: StorageTable[]; unreadable: StorageTable[] }> {
  const result = await db.query<{ table_name: string; readable: boolean }>(
    "SELECT c.relname AS table_name, has_table_privilege(c.oid, 'SELECT') AS readable " +
      'FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ' +
      "WHERE n.nspname = 'storage' AND c.relkind = 'r' AND c.relname IN ('buckets', 'objects')",
  );
  const found = new Map(
    result.rows.map(({ table_name, readable }) => [`storage.${table_name}`, readable]),
  );
  return {
    readable: storageTables.filter((table) => found.get(table) === true),
    unreadable: storageTables.filter((table) => found.get(table) === false),
  };
}

/**
 * Requires application schemas with nothing in them before restoring into them.
 *
 * A restore adds objects and never drops them. `pg_restore --clean` cannot be
 * used to make room, because its `DROP … IF EXISTS` statements still fail when
 * the table an object belongs to is absent, which is exactly the state of a
 * fresh recovery database. Refusing a populated schema keeps the restore from
 * failing halfway and never drops anything the operator did not drop.
 */
export async function ensureApplicationSchemasEmpty(
  db: Queryable,
  schemas: string[],
): Promise<void> {
  const tables = await getApplicationTables(db, schemas);
  if (!tables.length) return;
  const listed = tables.slice(0, 5).join(', ');
  throw new BackupError(
    `Target schemas ${schemas.join(', ')} already contain ${tables.length} table(s), including ${listed}. Restore into a fresh recovery database.`,
  );
}

/** Confirms restored table counts match the source manifest. */
export async function ensureCountsMatch(
  db: Queryable,
  expected: TableCount[],
): Promise<void> {
  const actual = await getTableCounts(
    db,
    expected.map(({ table }) => table),
  );
  for (const expectedCount of expected) {
    const current = actual.find(({ table }) => table === expectedCount.table);
    if (!current || current.count !== expectedCount.count)
      throw new BackupError(
        `Restore validation failed for ${expectedCount.table}: row count does not match the backup manifest.`,
      );
  }
}
