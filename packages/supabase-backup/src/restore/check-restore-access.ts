import type { AccessChecks } from '../core/access-checks.js';
import type { Queryable } from '../db/auth.js';
import { accessChecksSql, isAccessChecks } from '../core/access-checks.js';
import { logRestoreProgress } from './restore-progress.js';

/** Reports access configuration differences after commit without modifying roles or failing restore. */
export async function checkRestoreAccess(
  db: Queryable,
  schemas: readonly string[],
  expected?: AccessChecks,
  enabled = true,
): Promise<void> {
  if (!enabled) {
    logRestoreProgress('Advisory access checks disabled (--no-access-checks).');
    return;
  }
  if (!expected) {
    logRestoreProgress(
      'Advisory checks skipped: this backup has no default-privilege or role-membership baseline. Create a new backup to enable these checks.',
    );
    return;
  }
  logRestoreProgress('Checking default privileges and role memberships (advisory)...');
  try {
    const actual = (await db.query<{ snapshot: unknown }>(accessChecksSql(schemas)))
      .rows[0]?.snapshot;
    if (!isAccessChecks(actual)) throw new Error('Invalid advisory metadata');
    if (actual.defaultPrivilegesFingerprint !== expected.defaultPrivilegesFingerprint)
      logRestoreProgress(
        'Warning: configured default privileges differ from the backup. Review pg_default_acl for global and application-schema grants before creating future objects; Supabase-managed defaults may intentionally differ.',
      );
    else logRestoreProgress('Configured default privileges match the backup.');
    if (actual.roleMembershipsFingerprint !== expected.roleMembershipsFingerprint)
      logRestoreProgress(
        'Warning: cluster role memberships differ from the backup. Review pg_auth_members, including ADMIN, INHERIT, and SET options; memberships have not been changed.',
      );
    else logRestoreProgress('Cluster role memberships match the backup.');
  } catch {
    logRestoreProgress(
      'Warning: could not check default privileges and role memberships. Restore is already committed; verify these settings manually. Use --no-access-checks to skip these advisory checks on future restores.',
    );
  }
}
