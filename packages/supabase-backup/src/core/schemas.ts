/**
 * Which schemas a backup takes whole, and which it leaves to the platform.
 *
 * A backup dumps every schema the project owns, because the one that is missed
 * is always the one nobody thought to name. Two groups are left out: PostgreSQL
 * owns its own catalogs, and Supabase defines its managed schemas on every
 * project it creates, so restoring their definitions into a fresh project would
 * collide with what is already there. The durable rows inside the managed ones
 * are still backed up, table by table, on their own.
 */

/** PostgreSQL's own schemas, which are never part of a project's data. */
export const postgresSystemSchemas = ['information_schema', 'pg_catalog', 'pg_toast'];

/** Per-session catalogs PostgreSQL names by number as it needs them. */
export const postgresSystemSchemaPatterns = [/^pg_temp_\d+$/u, /^pg_toast_temp_\d+$/u];

/**
 * Schemas Supabase and its extensions define and own.
 *
 * Their definitions are never dumped as application schemas. Anything durable
 * they hold is backed up as data instead, and `supabase_migrations` is kept
 * whole because it is the project's own record of how its schema was built.
 */
export const supabaseManagedSchemas = [
  '_analytics',
  'auth',
  'cron',
  'extensions',
  'graphql',
  'graphql_public',
  'net',
  'pgbouncer',
  'pgsodium',
  'pgsodium_masks',
  'realtime',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'vault',
];

/** Managed schemas kept whole, definitions and rows, rather than as data only. */
export const migrationSchemas = ['supabase_migrations'];

/** Reports a schema PostgreSQL maintains for itself. */
export function isSystemSchema(name: string): boolean {
  return (
    postgresSystemSchemas.includes(name) ||
    postgresSystemSchemaPatterns.some((pattern) => pattern.test(name))
  );
}

/** Reports a schema Supabase defines, and whose definition a restore must not carry. */
export function isManagedSchema(name: string): boolean {
  return supabaseManagedSchemas.includes(name) && !migrationSchemas.includes(name);
}

/** Keeps the schemas a project owns, in the order the database reported them. */
export function selectBackupSchemas(
  discovered: readonly string[],
  excluded: readonly string[] = [],
): string[] {
  return discovered.filter(
    (schema) =>
      !isSystemSchema(schema) && !isManagedSchema(schema) && !excluded.includes(schema),
  );
}
