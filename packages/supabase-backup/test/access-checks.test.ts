import type { AccessChecks } from '../src/access-checks.js';
import type { Queryable } from '../src/auth.js';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessChecksSql } from '../src/access-checks.js';
import { captureAccessChecks } from '../src/capture-access-checks.js';
import { checkRestoreAccess } from '../src/check-restore-access.js';

afterEach(() => vi.restoreAllMocks());

async function snapshot(db: PGlite): Promise<AccessChecks> {
  const result = await db.query<{ snapshot: AccessChecks }>(accessChecksSql(['app']));
  const value = result.rows[0]?.snapshot;
  if (!value) throw new Error('Missing advisory snapshot');
  return value;
}

describe('advisory access checks', () => {
  it('compares role names rather than database-specific role IDs', async () => {
    const db = new PGlite();
    try {
      const setup =
        'CREATE ROLE readers; CREATE ROLE app_user; GRANT readers TO app_user; ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO readers;';
      await db.exec(`CREATE SCHEMA app; ${setup}`);
      const original = await snapshot(db);
      const originalId = (
        await db.query("SELECT oid FROM pg_roles WHERE rolname = 'readers'")
      ).rows;
      await db.exec(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE SELECT ON TABLES FROM readers;
        REVOKE readers FROM app_user;
        DROP ROLE app_user;
        DROP ROLE readers;
        ${setup}
      `);
      expect(
        (await db.query("SELECT oid FROM pg_roles WHERE rolname = 'readers'")).rows,
      ).not.toEqual(originalId);
      expect(await snapshot(db)).toEqual(original);
    } finally {
      await db.close();
    }
  });

  it('detects default grants and membership options while ignoring defaults in other schemas', async () => {
    const db = new PGlite();
    try {
      await db.exec(
        'CREATE SCHEMA app; CREATE SCHEMA other; CREATE ROLE readers; CREATE ROLE app_user;',
      );
      const initial = await snapshot(db);
      await db.exec(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA other GRANT SELECT ON TABLES TO readers;',
      );
      expect(await snapshot(db)).toEqual(initial);
      await db.exec(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO readers;',
      );
      const defaults = await snapshot(db);
      expect(defaults.defaultPrivilegesFingerprint).not.toBe(
        initial.defaultPrivilegesFingerprint,
      );
      expect(defaults.roleMembershipsFingerprint).toBe(
        initial.roleMembershipsFingerprint,
      );
      await db.exec('GRANT readers TO app_user;');
      let previous = await snapshot(db);
      expect(previous.roleMembershipsFingerprint).not.toBe(
        initial.roleMembershipsFingerprint,
      );
      for (const option of ['ADMIN TRUE', 'INHERIT FALSE', 'SET FALSE']) {
        await db.exec(`GRANT readers TO app_user WITH ${option};`);
        const current = await snapshot(db);
        expect(current.roleMembershipsFingerprint).not.toBe(
          previous.roleMembershipsFingerprint,
        );
        previous = current;
      }
      await db.exec('ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO readers;');
      expect((await snapshot(db)).defaultPrivilegesFingerprint).not.toBe(
        defaults.defaultPrivilegesFingerprint,
      );
    } finally {
      await db.close();
    }
  });

  it('warns on differences without changing access settings', async () => {
    const db = new PGlite();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await db.exec('CREATE SCHEMA app; CREATE ROLE readers; CREATE ROLE app_user;');
      const expected = await snapshot(db);
      await checkRestoreAccess(db, ['app'], expected);
      expect(output.mock.calls.flat().join('')).toContain(
        'Cluster role memberships match',
      );
      output.mockClear();
      await db.exec(
        'GRANT readers TO app_user; ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO readers;',
      );
      const before = await snapshot(db);
      await checkRestoreAccess(db, ['app'], expected);
      const logs = output.mock.calls.flat().join('');
      expect(logs).toContain('Warning: configured default privileges differ');
      expect(logs).toContain('Warning: cluster role memberships differ');
      expect(await snapshot(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });

  it('recovers the backup transaction if an optional catalog query fails', async () => {
    const db = new PGlite();
    const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const unavailable: Queryable = {
      async query<T extends Record<string, unknown>>(sql: string) {
        return db.query<T>(sql.includes('WITH defaults AS') ? 'SELECT 1 / 0' : sql);
      },
    };
    try {
      await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await expect(captureAccessChecks(unavailable, ['public'])).resolves.toBeUndefined();
      expect((await db.query('SELECT 1 AS healthy')).rows).toEqual([{ healthy: 1 }]);
      expect(output.mock.calls.flat().join('')).toContain('Backup will continue');
      await expect(captureAccessChecks(db, ['public'])).resolves.toMatchObject({
        version: 1,
      });
      await db.exec('ROLLBACK');
    } finally {
      await db.close();
    }
  });

  it('skips older baselines and reports unavailable checks without failing restore or leaking errors', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const db: Queryable = {
      async query() {
        throw new Error('private connection details');
      },
    };
    await expect(checkRestoreAccess(db, ['public'])).resolves.toBeUndefined();
    expect(output.mock.calls.flat().join('')).toContain('Advisory checks skipped');
    output.mockClear();
    await expect(
      checkRestoreAccess(db, ['public'], {
        version: 1,
        defaultPrivilegesFingerprint: 'a'.repeat(32),
        roleMembershipsFingerprint: 'b'.repeat(32),
      }),
    ).resolves.toBeUndefined();
    const logs = output.mock.calls.flat().join('');
    expect(logs).toContain('Restore is already committed');
    expect(logs).toContain('--no-access-checks');
    expect(logs).not.toContain('private connection details');
  });

  it('does not query catalogs when access checks are disabled', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let queried = false;
    const db: Queryable = {
      async query() {
        queried = true;
        throw new Error('Unexpected query');
      },
    };
    await checkRestoreAccess(
      db,
      ['public'],
      {
        version: 1,
        defaultPrivilegesFingerprint: 'a'.repeat(32),
        roleMembershipsFingerprint: 'b'.repeat(32),
      },
      false,
    );
    expect(queried).toBe(false);
    expect(output.mock.calls.flat().join('')).toContain(
      'Advisory access checks disabled',
    );
  });
});
