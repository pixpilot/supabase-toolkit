import type { AccessChecks } from '../core/access-checks.js';
import type { Queryable } from '../db/auth.js';
import { accessChecksSql, isAccessChecks } from '../core/access-checks.js';

/** Captures advisory metadata within the backup snapshot; unavailable catalogs do not abort backup. */
export async function captureAccessChecks(
  db: Queryable,
  schemas: readonly string[],
): Promise<AccessChecks | undefined> {
  await db.query('SAVEPOINT backup_access_checks');
  try {
    const snapshot = (await db.query<{ snapshot: unknown }>(accessChecksSql(schemas)))
      .rows[0]?.snapshot;
    if (!isAccessChecks(snapshot)) throw new Error('Invalid advisory metadata');
    return snapshot;
  } catch {
    await db.query('ROLLBACK TO SAVEPOINT backup_access_checks');
    process.stderr.write(
      '[backup] Warning: could not capture default privileges and role memberships. Backup will continue without these advisory checks.\n',
    );
    return undefined;
  } finally {
    await db.query('RELEASE SAVEPOINT backup_access_checks');
  }
}
