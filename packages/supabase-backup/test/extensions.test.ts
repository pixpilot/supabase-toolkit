import type { BackupManifest } from '../src/core/manifest.js';
import type { Queryable } from '../src/db/auth.js';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseManifest } from '../src/core/manifest.js';
import { ensureExtensionsPresent, preflightSslOptions } from '../src/db/auth.js';

/** Answers only the extension listing; nothing else is asked of it. */
function databaseWith(extensions: string[]): Queryable {
  return {
    async query<T extends Record<string, unknown>>(): Promise<{ rows: T[] }> {
      const rows: Record<string, unknown>[] = extensions.map((extension_name) => ({
        extension_name,
      }));
      return { rows } as { rows: T[] };
    },
  };
}

/** A valid manifest, which each test then varies in one way. */
function manifest(overrides: Partial<BackupManifest> = {}): string {
  const digest = createHash('sha256').update('archive').digest('hex');
  return JSON.stringify({
    formatVersion: 2,
    appAccessFingerprint: 'a'.repeat(32),
    createdAt: '2026-01-01T00:00:00Z',
    environment: 'production',
    cliVersion: '3.5.0',
    pgDumpVersion: 'pg_dump (PostgreSQL) 17.4',
    postgresServerVersion: '17.4',
    appObjectKey: 'app.dump.age',
    appChecksumObjectKey: 'app.sha256',
    authObjectKey: 'auth.dump.age',
    authChecksumObjectKey: 'auth.sha256',
    appEncryptedBytes: 1,
    authEncryptedBytes: 1,
    appSha256: digest,
    authSha256: digest,
    appSchemas: ['public'],
    appTableCounts: [{ table: 'public.profiles', count: 2 }],
    authTables: ['auth.users', 'auth.identities'],
    authRowCounts: [
      { table: 'auth.users', count: 1 },
      { table: 'auth.identities', count: 1 },
    ],
    authColumns: {
      'auth.users': [{ name: 'id', dataType: 'uuid' }],
      'auth.identities': [{ name: 'id', dataType: 'uuid' }],
    },
    ...overrides,
  });
}

describe('extensions a restore needs', () => {
  it('passes when the target already has every extension the backup names', async () => {
    await expect(
      ensureExtensionsPresent(databaseWith(['plpgsql', 'pgcrypto', 'vector']), [
        'plpgsql',
        'vector',
      ]),
    ).resolves.toBeUndefined();
  });

  it('names every missing extension at once rather than one per attempt', async () => {
    await expect(
      ensureExtensionsPresent(databaseWith(['plpgsql']), [
        'plpgsql',
        'vector',
        'postgis',
      ]),
    ).rejects.toThrow('2 extension(s) the backup needs: vector, postgis');
  });

  it('checks nothing for a backup written before extensions were recorded', async () => {
    await expect(
      ensureExtensionsPresent(databaseWith([]), undefined),
    ).resolves.toBeUndefined();
    await expect(ensureExtensionsPresent(databaseWith([]), [])).resolves.toBeUndefined();
  });
});

describe('manifests that carry extensions', () => {
  it('reads a backup written before extensions were recorded', () => {
    expect(parseManifest(manifest()).extensions).toBeUndefined();
  });

  it('keeps the recorded extensions, including hyphenated names', () => {
    expect(
      parseManifest(manifest({ extensions: ['plpgsql', 'uuid-ossp', 'pg_net'] }))
        .extensions,
    ).toEqual(['plpgsql', 'uuid-ossp', 'pg_net']);
  });

  it('refuses an extension list that is malformed or repeats a name', () => {
    for (const extensions of [
      ['plpgsql', 'plpgsql'],
      ['drop table users'],
      [''],
      [1],
      'plpgsql',
    ])
      expect(() =>
        parseManifest(manifest({ extensions } as Partial<BackupManifest>)),
      ).toThrow('incomplete or invalid');
  });
});

describe('manifests written by an older release', () => {
  /*
   * The managed-schema list grows as Supabase adds schemas. Re-applying today's
   * list while reading a manifest would make yesterday's archive unreadable on
   * the day it is needed, so only the shape of the recorded names is checked.
   */
  it('still reads a backup whose schemas the current release would not take', () => {
    const older = manifest({
      appSchemas: ['public', 'cron'],
      appTableCounts: [
        { table: 'public.profiles', count: 2 },
        { table: 'cron.job', count: 1 },
      ],
    });
    expect(parseManifest(older).appSchemas).toEqual(['public', 'cron']);
  });

  it('still refuses schemas that are not identifiers, or an empty list', () => {
    const refused: [string[], string | RegExp][] = [
      [['public', 'not a schema'], 'comma-separated schema names'],
      [['public', ''], 'incomplete or invalid'],
      [[], 'invalid schemas, counts, or Auth columns'],
    ];
    for (const [appSchemas, reason] of refused)
      expect(() => parseManifest(manifest({ appSchemas }))).toThrow(reason);
  });
});

describe('preflight TLS', () => {
  it('verifies the certificate only when the URL asked for it', () => {
    expect(preflightSslOptions('disable')).toBe(false);
    expect(preflightSslOptions('require')).toEqual({ rejectUnauthorized: false });
    expect(preflightSslOptions('verify-ca')).toEqual({ rejectUnauthorized: true });
    expect(preflightSslOptions('verify-full')).toEqual({ rejectUnauthorized: true });
  });
});
