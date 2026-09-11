import type { BackupManifest } from './manifest.js';
import { applicationAccessSql } from './application-access.js';

/** Quotes values used in the generated validation SQL. */
function literal(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

/** Rechecks the empty target under locks held until the entire restore commits. */
export function restorePreflightSql(schemas: string[]): string {
  const names = schemas.map(literal).join(', ');
  return `
SET LOCAL standard_conforming_strings = on;
LOCK TABLE auth.users, auth.identities IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $backup_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM auth.identities) THEN
    RAISE EXCEPTION 'Target Auth tables must be empty for recovery restore.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN (${names})
    UNION ALL
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN (${names})
    UNION ALL
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname IN (${names})
  ) THEN
    RAISE EXCEPTION 'Target application schemas must be empty for recovery restore.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('auth.users'::regclass, 'auth.identities'::regclass) AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Target Auth tables already have custom triggers. Use a fresh recovery project.';
  END IF;
END
$backup_preflight$;
`;
}

/** Checks row counts inside the restore transaction so a mismatch rolls back all writes. */
export function restoreValidationSql(manifest: BackupManifest): string {
  const checks = [...manifest.authRowCounts, ...manifest.appTableCounts].map(
    ({ table, count }) => {
      const quoted = table
        .split('.')
        .map((name) => `"${name}"`)
        .join('.');
      return `IF (SELECT COUNT(*) FROM ${quoted}) <> ${count} THEN RAISE EXCEPTION 'Restore row count does not match for %', ${literal(table)}; END IF;`;
    },
  );
  return `SET LOCAL search_path = pg_catalog;
DO $backup_validation$ BEGIN
${checks.join('\n')}
IF (${applicationAccessSql(manifest.appSchemas)}) <> ${literal(manifest.appAccessFingerprint)} THEN
  RAISE EXCEPTION 'Restored application ownership or privileges differ from the backup. Check target roles and default privileges.';
END IF;
END $backup_validation$;\n`;
}

/** Selects only trigger definitions; managed Auth table definitions are never restored. */
export function authTriggerList(list: string): string {
  return list
    .split('\n')
    .filter((line) =>
      /^\s*\d+;\s+\d+\s+\d+\s+TRIGGER\s+auth\s+(?:users|identities)\s/u.test(line),
    )
    .join('\n');
}
