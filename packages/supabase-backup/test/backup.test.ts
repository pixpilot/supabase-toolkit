import type { BackupManifest } from '../src/core/manifest.js';
import type { ProgramRunner } from '../src/utils/process.js';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  loadBackupConfig,
  loadRestoreConfig,
  loadStatusConfig,
} from '../src/core/config.js';
import { BackupError } from '../src/core/errors.js';
import { authTables, backupObjectKeys, parseManifest } from '../src/core/manifest.js';
import {
  ensureApplicationSchemasEmpty,
  ensureAuthCompatible,
  ensureSupportedAuthState,
  getAuthColumns,
} from '../src/db/auth.js';
import {
  databaseLabel,
  ensureDifferentDatabases,
  parseDatabaseUrl,
  toLibpqEnvironment,
} from '../src/db/database-url.js';
import {
  ensureDumpToolsCompatible,
  ensureRestoreToolSupportsArchive,
  parsePostgresMajor,
} from '../src/db/postgres-tools.js';
import { restore } from '../src/restore/restore.js';
import { getBackupStatus } from '../src/status/status.js';
import { r2ErrorDetails } from '../src/storage/adapters/r2-store.js';
import {
  ensureNonEmptyFile,
  sha256File,
  withTemporaryDirectory,
} from '../src/utils/files.js';
import { systemRunner } from '../src/utils/process.js';
import { redact } from '../src/utils/redact.js';

const env = {
  SOURCE_DATABASE_URL:
    'postgresql://backup:secret@db.example.test:5432/postgres?sslmode=require',
  BACKUP_AGE_RECIPIENT: 'age1recipient',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_BUCKET: 'private-backups',
  BACKUP_PREFIX: 'production/database',
};

class MemoryStore {
  public readonly values = new Map<string, Uint8Array>();
  public async get(key: string): Promise<Uint8Array> {
    const value = this.values.get(key);
    if (!value) throw new Error('missing');
    return value;
  }

  public async has(key: string): Promise<boolean> {
    return this.values.has(key);
  }

  public async list(prefix: string): Promise<string[]> {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  public async putImmutable(key: string, body: Uint8Array): Promise<void> {
    if (this.values.has(key)) throw new BackupError('overwrite');
    this.values.set(key, body);
  }
}

function manifest(): BackupManifest {
  return {
    formatVersion: 2,
    appAccessFingerprint: 'a'.repeat(32),
    createdAt: '2026-01-01T00:00:00Z',
    environment: 'production',
    appObjectKey: 'app',
    appChecksumObjectKey: 'app.sha256',
    authObjectKey: 'auth',
    authChecksumObjectKey: 'auth.sha256',
    appSha256: createHash('sha256').update('x').digest('hex'),
    authSha256: createHash('sha256').update('x').digest('hex'),
    appEncryptedBytes: 1,
    authEncryptedBytes: 1,
    appSchemas: ['public'],
    authTables: [...authTables],
    pgDumpVersion: 'pg_dump',
    postgresServerVersion: '17',
    cliVersion: '1.0.0',
    authColumns: {
      'auth.users': [{ name: 'id', dataType: 'uuid' }],
      'auth.identities': [{ name: 'id', dataType: 'uuid' }],
    },
    appTableCounts: [],
    authRowCounts: authTables.map((table) => ({ table, count: 0 })),
  };
}

async function authDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(
    'CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid, email text); CREATE TABLE auth.identities (id uuid, user_id uuid);',
  );
  return db;
}

describe('configuration and safety', () => {
  it('maps database URLs to libpq and rejects the transaction pooler', () => {
    const connection = parseDatabaseUrl(env.SOURCE_DATABASE_URL);
    expect(toLibpqEnvironment(connection)).toMatchObject({
      PGHOST: 'db.example.test',
      PGPORT: '5432',
      PGUSER: 'backup',
      PGPASSWORD: 'secret',
      PGDATABASE: 'postgres',
      PGSSLMODE: 'require',
    });
    expect(databaseLabel(connection)).toBe('db.example.test:5432/postgres');
    expect(() =>
      parseDatabaseUrl('postgresql://user:pass@db.example.test:6543/postgres'),
    ).toThrow('Transaction Pooler');
    expect(() => ensureDifferentDatabases(connection, connection)).toThrow(
      'SOURCE_DATABASE_URL',
    );
  });

  it('validates configuration and never permits managed schemas among app schemas', () => {
    expect(loadBackupConfig(env).appSchemas).toBeUndefined();
    expect(loadBackupConfig(env).excludedSchemas).toEqual([]);
    expect(loadBackupConfig({ ...env, APP_SCHEMAS: 'public' }).appSchemas).toEqual([
      'public',
    ]);
    expect(
      loadBackupConfig({ ...env, EXCLUDE_SCHEMAS: 'audit, drizzle' }).excludedSchemas,
    ).toEqual(['audit', 'drizzle']);
    expect(() => loadBackupConfig({ ...env, APP_SCHEMAS: 'public,auth' })).toThrow(
      'application schemas',
    );
    expect(() =>
      loadStatusConfig({
        ...env,
        SOURCE_DATABASE_URL: undefined,
        BACKUP_AGE_RECIPIENT: undefined,
      }),
    ).not.toThrow();
  });

  it('redacts connection strings and private age identities', () => {
    expect(redact('postgresql://a:password@host/db AGE-SECRET-KEY-123')).not.toContain(
      'password',
    );
  });

  it('formats safe R2 error metadata without exposing an error message', () => {
    expect(
      r2ErrorDetails({
        Code: 'SignatureDoesNotMatch',
        message: 'contains a secret',
        $metadata: { httpStatusCode: 403, requestId: 'request-123' },
      }),
    ).toBe(' [r2Code=SignatureDoesNotMatch, httpStatus=403, requestId=request-123]');
  });
});

describe('backup records', () => {
  it('accepts old manifests and validates the optional advisory baseline on new ones', () => {
    const old = manifest();
    const current = {
      ...old,
      accessChecks: {
        version: 1,
        defaultPrivilegesFingerprint: 'a'.repeat(32),
        roleMembershipsFingerprint: 'b'.repeat(32),
      },
    } satisfies BackupManifest;
    expect(parseManifest(JSON.stringify(old)).accessChecks).toBeUndefined();
    expect(parseManifest(JSON.stringify(current))).toEqual(current);
    for (const accessChecks of [
      null,
      {},
      { ...current.accessChecks, version: 2 },
      { ...current.accessChecks, defaultPrivilegesFingerprint: 'bad' },
      { ...current.accessChecks, roleMembershipsFingerprint: false },
    ]) {
      expect(() => parseManifest(JSON.stringify({ ...old, accessChecks }))).toThrow(
        'incomplete or invalid',
      );
    }
  });

  it('rejects unsupported formats and malformed metadata before restoring', () => {
    const valid = manifest();
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...valid, formatVersion: 1 },
      { ...valid, appSchemas: ['public; DROP SCHEMA auth'] },
      { ...valid, appSchemas: ['public,private'] },
      { ...valid, createdAt: 'not-a-date' },
      { ...valid, authTables: [] },
      { ...valid, authRowCounts: [] },
      { ...valid, appEncryptedBytes: 0 },
      { ...valid, authColumns: {} },
      { ...valid, appAccessFingerprint: 'invalid' },
      { ...valid, appSha256: [valid.appSha256] },
      { ...valid, authTables: valid.authTables.map((table) => [table]) },
      { ...valid, appTableCounts: [{ table: 'public.users', count: -1 }] },
      { ...valid, appTableCounts: [{ table: 'other.users', count: 1 }] },
    ];
    expect(parseManifest(JSON.stringify(valid))).toEqual(valid);
    for (const value of invalid)
      expect(() => parseManifest(JSON.stringify(value))).toThrow(BackupError);
  });

  it('uses immutable UTC object keys and rejects malformed manifests', () => {
    const keys = backupObjectKeys(
      'production/database',
      new Date('2026-09-10T03:00:00Z'),
    );
    expect(keys.app).toBe('production/database/v1/20260910T030000Z/app.dump.age');
    expect(keys.manifest).toBe('production/database/v1/20260910T030000Z/manifest.json');
    expect(() => parseManifest('{}')).toThrow('incomplete');
  });

  it('cleans temporary plaintext files and hashes files', async () => {
    let directory = '';
    await withTemporaryDirectory(async (value) => {
      directory = value;
      const file = join(value, 'dump');
      await writeFile(file, 'archive');
      expect(await sha256File(file)).toHaveLength(64);
    });
    await expect(ensureNonEmptyFile(join(directory, 'dump'))).rejects.toThrow(
      'missing or empty',
    );
    const empty = await mkdtemp(join(tmpdir(), 'backup-empty-'));
    try {
      await writeFile(join(empty, 'empty'), '');
      await expect(ensureNonEmptyFile(join(empty, 'empty'))).rejects.toThrow(
        'missing or empty',
      );
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('detects stale or incomplete manifests', async () => {
    const store = new MemoryStore();
    store.values.set('production/database/v1/invalid/manifest.json', Buffer.from('{}'));
    await expect(
      getBackupStatus('production/database', store, new Date('2026-01-03T00:00:00Z')),
    ).rejects.toThrow('incomplete');
    store.values.delete('production/database/v1/invalid/manifest.json');
    const complete = manifest();
    store.values.set(
      'production/database/v1/20260101T000000Z/manifest.json',
      Buffer.from(JSON.stringify(complete)),
    );
    for (const key of [complete.appObjectKey, complete.authObjectKey])
      store.values.set(key, Buffer.from('x'));
    store.values.set(
      complete.appChecksumObjectKey,
      Buffer.from(`${complete.appSha256}  app\n`),
    );
    store.values.set(
      complete.authChecksumObjectKey,
      Buffer.from(`${complete.authSha256}  auth\n`),
    );
    await expect(
      getBackupStatus('production/database', store, new Date('2026-01-03T00:00:00Z')),
    ).resolves.toMatchObject({ ageHours: 48 });
  });

  it('rejects immutable overwrite, missing backup objects, and subprocess failures', async () => {
    const store = new MemoryStore();
    await store.putImmutable('one', Buffer.from('first'));
    await expect(store.putImmutable('one', Buffer.from('second'))).rejects.toThrow(
      'overwrite',
    );
    store.values.set(
      'production/database/v1/20260101T000000Z/manifest.json',
      Buffer.from(JSON.stringify(manifest())),
    );
    await expect(getBackupStatus('production/database', store)).rejects.toThrow(
      'references missing',
    );
    await expect(
      systemRunner.run('supabase-backup-tool-that-does-not-exist', []),
    ).rejects.toThrow('unavailable');
  });

  it('reports subprocess stderr on failure while redacting credentials', async () => {
    await expect(
      systemRunner.run(process.execPath, [
        '-e',
        "process.stderr.write('pg_dump: error: connection to postgresql://u:p@h/db failed'); process.exit(3);",
      ]),
    ).rejects.toThrow(
      /exited with code 3: pg_dump: error: connection to \[redacted database URL\] failed/u,
    );

    await expect(
      systemRunner.run(process.execPath, ['-e', 'process.exit(2);']),
    ).rejects.toThrow('without writing any diagnostics');
  });

  it('requires an exact target confirmation before restore can change a database', async () => {
    const store = new MemoryStore();
    store.values.set('manifest.json', Buffer.from(JSON.stringify(manifest())));
    await expect(
      restore(
        { key: 'manifest.json', apply: true, confirmTarget: 'wrong' },
        {
          ...env,
          AGE_IDENTITY: 'AGE-SECRET-KEY-TEST',
          TARGET_DATABASE_URL:
            'postgresql://restore:secret@recovery.example.test:5432/postgres',
        },
        { store },
      ),
    ).rejects.toThrow('confirmation');
  });
});

describe('auth preflight with PGlite', () => {
  it('keeps Auth restore scope ordered by users then identities', () => {
    expect(authTables).toEqual(['auth.users', 'auth.identities']);
  });
  it('accepts supported Auth scope and compares required target columns', async () => {
    const source = await authDatabase();
    const target = await authDatabase();
    try {
      await expect(ensureSupportedAuthState(source)).resolves.toBeUndefined();
      await expect(
        ensureAuthCompatible(target, await getAuthColumns(source)),
      ).resolves.toBeUndefined();
    } finally {
      await source.close();
      await target.close();
    }
  });

  it('refuses to restore into application schemas that already hold tables', async () => {
    const target = await authDatabase();
    try {
      await expect(
        ensureApplicationSchemasEmpty(target, ['public']),
      ).resolves.toBeUndefined();
      await target.exec('CREATE TABLE public.user_roles (id uuid, role text);');
      await expect(ensureApplicationSchemasEmpty(target, ['public'])).rejects.toThrow(
        'public.user_roles',
      );
    } finally {
      await target.close();
    }
  });

  it('fails on unsupported durable Auth state and incompatible tables', async () => {
    const source = await authDatabase();
    const target = new PGlite();
    try {
      await source.exec(
        "CREATE TABLE auth.mfa_factors (id uuid); INSERT INTO auth.mfa_factors VALUES ('00000000-0000-0000-0000-000000000000');",
      );
      await expect(ensureSupportedAuthState(source)).rejects.toThrow('mfa_factors');
      await target.exec(
        'CREATE SCHEMA auth; CREATE TABLE auth.users (id text, email text); CREATE TABLE auth.identities (id uuid, user_id uuid);',
      );
      const supported = await authDatabase();
      try {
        await expect(
          ensureAuthCompatible(target, await getAuthColumns(supported)),
        ).rejects.toThrow('incompatible');
      } finally {
        await supported.close();
      }
    } finally {
      await source.close();
      await target.close();
    }
  });
});

describe('configuration validation', () => {
  it('accepts the credential shapes real deployments use', () => {
    const valid = [
      { R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com' },
      { R2_ENDPOINT: 'https://account.eu.r2.cloudflarestorage.com/' },
      { R2_ENDPOINT: 'http://localhost:9000' },
      { R2_BUCKET: 'abc' },
      { R2_BUCKET: 'my.bucket-name.2024' },
      { BACKUP_PREFIX: '/production/database/' },
      { BACKUP_PREFIX: 'a' },
      { BACKUP_AGE_RECIPIENT: 'age1yubikey1qwt50d05nh5vutpdzmlg5wn80xq5negm4uj9ghv0' },
      { BACKUP_AGE_RECIPIENT: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI user@host' },
      { R2_SECRET_ACCESS_KEY: 'b6f9c1de/4a+2==' },
      {
        SOURCE_DATABASE_URL:
          'postgresql://postgres.ref:pa%40ss@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
      },
    ];
    for (const override of valid)
      expect(() => loadBackupConfig({ ...env, ...override })).not.toThrow();
    expect(
      loadBackupConfig({ ...env, BACKUP_PREFIX: '/production/database/' }),
    ).toMatchObject({ prefix: 'production/database' });
  });

  it('rejects an endpoint that carries a bucket path, credentials, or plain http', () => {
    const cases: [string, string][] = [
      [
        'https://account.r2.cloudflarestorage.com/private-backups',
        'must not include a path',
      ],
      [
        'https://key:secret@account.r2.cloudflarestorage.com',
        'must not embed credentials',
      ],
      ['http://account.r2.cloudflarestorage.com', 'must use https'],
      ['https://account.r2.cloudflarestorage.com?x=1', 'query string'],
      ['account.r2.cloudflarestorage.com', 'absolute URL'],
    ];
    for (const [R2_ENDPOINT, message] of cases)
      expect(() => loadStatusConfig({ ...env, R2_ENDPOINT })).toThrow(message);
  });

  it('rejects a bucket that is really a URL, a path, or an unusable name', () => {
    const cases: [string, string][] = [
      ['https://account.r2.cloudflarestorage.com/bucket', 'bucket name only'],
      ['private-backups/production', 'bucket name only'],
      ['Private-Backups', 'lowercase letters'],
      ['-backups', 'lowercase letters'],
      ['ab', 'between 3 and 63'],
    ];
    for (const [R2_BUCKET, message] of cases)
      expect(() => loadStatusConfig({ ...env, R2_BUCKET })).toThrow(message);
  });

  it('rejects credentials that were pasted across lines or as a URL', () => {
    expect(() =>
      loadStatusConfig({ ...env, R2_SECRET_ACCESS_KEY: 'first half\nsecond half' }),
    ).toThrow('R2_SECRET_ACCESS_KEY contains whitespace');
    expect(() =>
      loadStatusConfig({
        ...env,
        R2_ACCESS_KEY_ID: 'https://account.r2.cloudflarestorage.com',
      }),
    ).toThrow('R2_ACCESS_KEY_ID looks like a URL');
  });

  it('refuses an age private identity used where a recipient belongs', () => {
    expect(() =>
      loadBackupConfig({
        ...env,
        BACKUP_AGE_RECIPIENT: 'AGE-SECRET-KEY-1QWERTYUIOPASDFGHJKLZXCVBNM',
      }),
    ).toThrow('is an age identity (private key)');
    expect(() => loadBackupConfig({ ...env, BACKUP_AGE_RECIPIENT: 'not-a-key' })).toThrow(
      'must be an age recipient starting with age1',
    );
  });

  it('refuses an age recipient used where a private identity belongs', () => {
    expect(() => loadRestoreConfig({ ...env, AGE_IDENTITY: 'age1recipient' })).toThrow(
      'is an age recipient (public key)',
    );
    expect(() => loadRestoreConfig({ ...env, AGE_IDENTITY: 'nonsense' })).toThrow(
      'must be an age identity',
    );
    expect(() =>
      loadRestoreConfig({
        ...env,
        AGE_IDENTITY: '-----BEGIN OPENSSH PRIVATE KEY-----\nx',
      }),
    ).not.toThrow();
  });

  it('rejects object-key prefixes that cannot address R2 objects', () => {
    const cases: [string, string][] = [
      ['production database', 'whitespace, backslashes, or control characters'],
      ['production\\database', 'whitespace, backslashes, or control characters'],
      ['https://bucket/production', 'not a URL'],
      ['production//database', 'empty path segments'],
      ['../production', 'non-empty object-key prefix'],
    ];
    for (const [BACKUP_PREFIX, message] of cases)
      expect(() => loadStatusConfig({ ...env, BACKUP_PREFIX })).toThrow(message);
  });

  it('rejects connection strings whose template placeholders were never replaced', () => {
    expect(() =>
      parseDatabaseUrl(
        'postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
      ),
    ).toThrow('still contains a placeholder');
    expect(() => parseDatabaseUrl('postgresql://db.example.test:5432/postgres')).toThrow(
      'must include the database user',
    );
    expect(() =>
      parseDatabaseUrl('postgresql://backup:secret@[2001:DB8::1]:5432/postgres'),
    ).not.toThrow();
  });
});

describe('postgres client tooling', () => {
  const banners: [string, number | undefined][] = [
    ['pg_dump (PostgreSQL) 18.0 (Ubuntu 18.0-1.pgdg24.04+1)', 18],
    ['pg_restore (PostgreSQL) 16.9', 16],
    ['pg_dump (PostgreSQL) 19devel', 19],
    ['not a version banner', undefined],
    ['17.4', 17],
    ['15.8 (Ubuntu 15.8-1.pgdg22.04+1)', 15],
    ['18', 18],
  ];

  it('reads the major version out of a --version banner', () => {
    for (const [banner, major] of banners) expect(parsePostgresMajor(banner)).toBe(major);
  });

  it('rejects a pg_restore older than pg_dump and allows the reverse', async () => {
    const runnerFor = (dump: string, list: string): ProgramRunner => ({
      async run(command) {
        return command === 'pg_dump' ? dump : list;
      },
    });
    await expect(
      ensureDumpToolsCompatible(
        runnerFor('pg_dump (PostgreSQL) 18.0', 'pg_restore (PostgreSQL) 16.9'),
      ),
    ).rejects.toThrow('pg_restore 16 cannot read archives written by pg_dump 18');
    await expect(
      ensureDumpToolsCompatible(
        runnerFor('pg_dump (PostgreSQL) 16.9', 'pg_restore (PostgreSQL) 18.0'),
      ),
    ).resolves.toBe('pg_dump (PostgreSQL) 16.9');
  });

  it('refuses to dump a server newer than pg_dump', async () => {
    const runner: ProgramRunner = {
      async run(command) {
        return command === 'pg_dump'
          ? 'pg_dump (PostgreSQL) 16.9'
          : 'pg_restore (PostgreSQL) 16.9';
      },
    };
    await expect(ensureDumpToolsCompatible(runner, '17.4')).rejects.toThrow(
      'pg_dump 16 cannot dump a PostgreSQL 17 server',
    );
    await expect(ensureDumpToolsCompatible(runner, '15.8')).resolves.toBe(
      'pg_dump (PostgreSQL) 16.9',
    );
    await expect(ensureDumpToolsCompatible(runner)).resolves.toBe(
      'pg_dump (PostgreSQL) 16.9',
    );
  });

  it('refuses to restore an archive the local pg_restore cannot read', async () => {
    const runner: ProgramRunner = {
      async run() {
        return 'pg_restore (PostgreSQL) 16.9';
      },
    };
    await expect(
      ensureRestoreToolSupportsArchive(runner, 'pg_dump (PostgreSQL) 18.0'),
    ).rejects.toThrow('written by pg_dump 18 but the local pg_restore is 16');
    await expect(
      ensureRestoreToolSupportsArchive(runner, 'pg_dump (PostgreSQL) 15.4'),
    ).resolves.toBeUndefined();
  });
});
