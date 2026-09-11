import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  ensureAuthCompatible,
  ensureSupportedAuthState,
  getAuthColumns,
} from '../src/auth.js';
import { loadBackupConfig, loadStatusConfig } from '../src/config.js';
import {
  databaseLabel,
  ensureDifferentDatabases,
  parseDatabaseUrl,
  toLibpqEnvironment,
} from '../src/database-url.js';
import { BackupError } from '../src/errors.js';
import { ensureNonEmptyFile, sha256File, withTemporaryDirectory } from '../src/files.js';
import { authTables, backupObjectKeys, parseManifest } from '../src/manifest.js';
import { systemRunner } from '../src/process.js';
import { r2ErrorDetails } from '../src/r2.js';
import { redact } from '../src/redact.js';
import { restore } from '../src/restore.js';
import { getBackupStatus } from '../src/status.js';

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

function manifest() {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    environment: 'production',
    appObjectKey: 'app',
    appChecksumObjectKey: 'app.sha256',
    authObjectKey: 'auth',
    authChecksumObjectKey: 'auth.sha256',
    appSha256: 'a'.repeat(64),
    authSha256: 'b'.repeat(64),
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
    authRowCounts: [],
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

  it('validates configuration and never permits auth among app schemas', () => {
    expect(loadBackupConfig(env).appSchemas).toEqual(['public']);
    expect(() => loadBackupConfig({ ...env, APP_SCHEMAS: 'public,auth' })).toThrow(
      'must not include auth',
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
  it('uses immutable UTC object keys and rejects malformed manifests', () => {
    const keys = backupObjectKeys(
      'production/database',
      new Date('2026-09-10T03:00:00Z'),
    );
    expect(keys.app).toBe(
      'production/database/2026/09/10/2026-09-10T03-00-00Z.app.dump.age',
    );
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
    store.values.set('production/database/invalid.json', Buffer.from('{}'));
    await expect(
      getBackupStatus('production/database', store, new Date('2026-01-03T00:00:00Z')),
    ).rejects.toThrow('No valid');
    const complete = manifest();
    store.values.set(
      'production/database/2026/01/01/backup.json',
      Buffer.from(JSON.stringify(complete)),
    );
    for (const key of [
      complete.appObjectKey,
      complete.authObjectKey,
      complete.appChecksumObjectKey,
      complete.authChecksumObjectKey,
    ])
      store.values.set(key, Buffer.from('x'));
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
      'production/database/backup.json',
      Buffer.from(JSON.stringify(manifest())),
    );
    await expect(getBackupStatus('production/database', store)).rejects.toThrow(
      'references missing',
    );
    await expect(
      systemRunner.run('supabase-backup-tool-that-does-not-exist', []),
    ).rejects.toThrow('unavailable');
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
