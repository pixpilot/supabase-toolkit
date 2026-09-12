import type { BackupConfig } from '../src/core/config.js';
import type { BackupManifest } from '../src/core/manifest.js';
import type { Queryable } from '../src/db/auth.js';
import type { ProgramRunner } from '../src/utils/process.js';
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { dumpDatabase } from '../src/backup/dump-database.js';
import { loadBackupConfig } from '../src/core/config.js';
import { authTables, parseManifest, storageTables } from '../src/core/manifest.js';
import { selectBackupSchemas } from '../src/core/schemas.js';
import { parseAppSchemas } from '../src/core/validation.js';
import { getManagedStorageTables } from '../src/db/auth.js';
import { restorePreflightSql, restoreValidationSql } from '../src/restore/restore-sql.js';
import { authRestoreArguments } from '../src/restore/restore.js';

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

interface SourceDatabase {
  /** Every schema the database reports, as pg_namespace lists them. */
  schemas: string[];
  /** Storage tables the database has, and whether the backup role may read them. */
  storage: { table: string; readable: boolean }[];
  /** Application tables, as `schema.table`. */
  tables: string[];
}

/** Answers the preflight queries of one dump from a described database. */
function sourceConnection(
  source: SourceDatabase,
): Queryable & { end: () => Promise<void> } {
  const rows = <T extends Record<string, unknown>>(values: T[]): { rows: T[] } => ({
    rows: values,
  });
  return {
    async end(): Promise<void> {
      // Nothing to close; the dump still ends its transaction through this call.
    },
    async query<T extends Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
      const answer = (values: Record<string, unknown>[]): { rows: T[] } =>
        rows(values) as { rows: T[] };
      if (sql.includes('SHOW server_version')) return answer([{ version: '17.4' }]);
      if (sql.includes('pg_export_snapshot')) return answer([{ snapshot: '0000003-1' }]);
      if (sql.includes('mfa_factors')) return answer([]);
      if (sql.includes('information_schema.columns')) {
        return answer(
          ['users', 'identities'].map((table_name) => ({
            table_name,
            column_name: 'id',
            data_type: 'uuid',
          })),
        );
      }
      if (sql.includes("n.nspname = 'storage'")) {
        return answer(
          source.storage.map(({ table, readable }) => ({
            table_name: table.replace('storage.', ''),
            readable,
          })),
        );
      }
      if (sql.includes('nspname AS schema_name')) {
        return answer(source.schemas.map((schema_name) => ({ schema_name })));
      }
      if (sql.includes('BASE TABLE')) {
        return answer(
          source.tables
            .filter((table) => sql.includes(`'${table.split('.')[0] ?? ''}'`))
            .map((table) => ({
              table_schema: table.split('.')[0],
              table_name: table.split('.')[1],
            })),
        );
      }
      if (sql.includes('SELECT COUNT(*)')) return answer([{ count: '2' }]);
      if (sql.includes('AS fingerprint'))
        return answer([{ fingerprint: 'a'.repeat(32) }]);
      if (sql.includes('AS snapshot')) {
        return answer([
          {
            snapshot: {
              version: 1,
              defaultPrivilegesFingerprint: 'b'.repeat(32),
              roleMembershipsFingerprint: 'c'.repeat(32),
            },
          },
        ]);
      }
      return answer([]);
    },
  };
}

/** Records what a dump asked the PostgreSQL client programs to do. */
function recordingRunner(): ProgramRunner & {
  calls: { command: string; args: string[] }[];
} {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    async run(command: string, args: string[]): Promise<string> {
      calls.push({ command, args });
      return '(PostgreSQL) 17.4';
    },
  };
}

/** Runs one dump against a described database and returns what it did. */
async function dump(
  source: SourceDatabase,
  schemas: { appSchemas?: string[]; excludedSchemas?: string[] } = {},
): Promise<{
  appArgs: string[];
  managedArgs: string[];
  metadata: Awaited<ReturnType<typeof dumpDatabase>>;
}> {
  const config: BackupConfig = {
    ...loadBackupConfig(env),
    ...(schemas.appSchemas ? { appSchemas: schemas.appSchemas } : {}),
    excludedSchemas: schemas.excludedSchemas ?? [],
  };
  const runner = recordingRunner();
  const metadata = await dumpDatabase(
    config,
    runner,
    '/tmp/app.dump',
    '/tmp/auth.dump',
    async () => sourceConnection(source),
  );
  const dumps = runner.calls.filter(
    ({ command, args }) => command === 'pg_dump' && !args.includes('--version'),
  );
  return {
    appArgs: dumps[0]?.args ?? [],
    managedArgs: dumps[1]?.args ?? [],
    metadata,
  };
}

/** A Supabase project with an application schema, a migration journal, and Storage. */
const supabase: SourceDatabase = {
  schemas: [
    'auth',
    'billing',
    'drizzle',
    'extensions',
    'graphql',
    'information_schema',
    'pg_catalog',
    'pg_temp_3',
    'pg_toast',
    'public',
    'realtime',
    'storage',
    'supabase_migrations',
    'vault',
  ],
  storage: storageTables.map((table) => ({ table, readable: true })),
  tables: [
    'billing.invoices',
    'drizzle.__drizzle_migrations',
    'public.user_roles',
    'supabase_migrations.schema_migrations',
  ],
};

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

function withStorage(): BackupManifest {
  return {
    ...manifest(),
    storageTables: [...storageTables],
    storageRowCounts: storageTables.map((table) => ({ table, count: 3 })),
  };
}

describe('choosing what a backup takes', () => {
  it('takes every schema the project owns, and leaves PostgreSQL and Supabase theirs', async () => {
    const { appArgs, metadata } = await dump(supabase);
    expect(metadata.appSchemas).toEqual([
      'billing',
      'drizzle',
      'public',
      'supabase_migrations',
    ]);
    for (const schema of metadata.appSchemas)
      expect(appArgs).toContain(`--schema="${schema}"`);
    for (const schema of ['auth', 'storage', 'extensions', 'pg_catalog', 'pg_temp_3'])
      expect(appArgs).not.toContain(`--schema="${schema}"`);
    expect(metadata.appTableCounts.map(({ table }) => table)).toContain(
      'supabase_migrations.schema_migrations',
    );
  });

  it('takes only the schemas a run named, and nothing else', async () => {
    const { appArgs, metadata } = await dump(supabase, { appSchemas: ['public'] });
    expect(appArgs.filter((argument) => argument.startsWith('--schema='))).toEqual([
      '--schema="public"',
    ]);
    expect(metadata.appSchemas).toEqual(['public']);
    expect(metadata.appTableCounts.map(({ table }) => table)).toEqual([
      'public.user_roles',
    ]);
  });

  it('leaves out the schemas a run excluded, named or discovered', async () => {
    await expect(
      dump(supabase, { excludedSchemas: ['drizzle', 'billing'] }).then(
        ({ metadata }) => metadata.appSchemas,
      ),
    ).resolves.toEqual(['public', 'supabase_migrations']);
    await expect(
      dump(supabase, {
        appSchemas: ['public', 'billing'],
        excludedSchemas: ['billing'],
      }).then(({ metadata }) => metadata.appSchemas),
    ).resolves.toEqual(['public']);
  });

  it('refuses a named schema the source database does not have', async () => {
    await expect(dump(supabase, { appSchemas: ['public', 'missing'] })).rejects.toThrow(
      'does not have',
    );
  });

  it('refuses a run that would be left with no schema at all', async () => {
    await expect(dump(supabase, { excludedSchemas: supabase.schemas })).rejects.toThrow(
      'No schemas left to back up',
    );
  });

  it('never treats a PostgreSQL or Supabase schema as an application schema', () => {
    expect(
      selectBackupSchemas([
        'pg_catalog',
        'pg_toast',
        'pg_temp_12',
        'pg_toast_temp_12',
        'information_schema',
        'auth',
        'storage',
        'cron',
        'supabase_migrations',
        'public',
      ]),
    ).toEqual(['supabase_migrations', 'public']);
    expect(selectBackupSchemas(['public', 'audit'], ['audit'])).toEqual(['public']);
    for (const refused of ['public,auth', 'public,storage', 'pg_catalog'])
      expect(() => parseAppSchemas(refused)).toThrow('application schemas');
    expect(parseAppSchemas('public,drizzle,supabase_migrations')).toEqual([
      'public',
      'drizzle',
      'supabase_migrations',
    ]);
  });
});

describe('backing up Supabase-managed data', () => {
  it('dumps the storage rows of a project that has Storage', async () => {
    const { managedArgs, metadata } = await dump(supabase);
    expect(managedArgs.filter((argument) => argument.startsWith('--table='))).toEqual([
      '--table=auth.users',
      '--table=auth.identities',
      '--table=storage.buckets',
      '--table=storage.objects',
    ]);
    expect(managedArgs).toContain('--no-owner');
    expect(managedArgs).toContain('--no-privileges');
    expect(metadata.storageTables).toEqual([...storageTables]);
    expect(metadata.storageRowCounts).toEqual(
      storageTables.map((table) => ({ table, count: 2 })),
    );
  });

  it('backs up a database that has no Storage at all', async () => {
    const { managedArgs, metadata } = await dump({
      schemas: ['public', 'auth'],
      storage: [],
      tables: ['public.user_roles'],
    });
    expect(managedArgs.filter((argument) => argument.startsWith('--table='))).toEqual([
      '--table=auth.users',
      '--table=auth.identities',
    ]);
    expect(metadata.storageTables).toBeUndefined();
    expect(metadata.storageRowCounts).toBeUndefined();
  });

  it('keeps the managed rows even when a run named its own schemas', async () => {
    const { managedArgs } = await dump(supabase, { appSchemas: ['public'] });
    expect(managedArgs).toContain('--table=storage.objects');
    expect(managedArgs).toContain('--table=auth.users');
  });

  it('skips a storage table the backup role cannot read, and says so', async () => {
    const written: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      });
    try {
      const { managedArgs, metadata } = await dump({
        ...supabase,
        storage: [
          { table: 'storage.buckets', readable: true },
          { table: 'storage.objects', readable: false },
        ],
      });
      expect(managedArgs).toContain('--table=storage.buckets');
      expect(managedArgs).not.toContain('--table=storage.objects');
      expect(metadata.storageTables).toEqual(['storage.buckets']);
      expect(written.join('')).toContain('storage.objects');
    } finally {
      stderr.mockRestore();
    }
  });

  it('keeps the storage tables in insert order whatever the catalog returns', async () => {
    const reversed: Record<string, unknown>[] = [
      { table_name: 'objects', readable: true },
      { table_name: 'buckets', readable: false },
    ];
    const db: Queryable = {
      async query<T extends Record<string, unknown>>(): Promise<{ rows: T[] }> {
        return { rows: reversed as T[] };
      },
    };
    await expect(getManagedStorageTables(db)).resolves.toEqual({
      readable: ['storage.objects'],
      unreadable: ['storage.buckets'],
    });
  });
});

describe('manifests that carry storage metadata', () => {
  it('reads a backup written before storage was included', () => {
    const old = manifest();
    const parsed = parseManifest(JSON.stringify(old));
    expect(parsed.storageTables).toBeUndefined();
    expect(parsed.storageRowCounts).toBeUndefined();
  });

  it('keeps the tables and their counts together and in restore order', () => {
    const valid = withStorage();
    expect(parseManifest(JSON.stringify(valid))).toEqual(valid);
    const invalid: unknown[] = [
      { ...valid, storageTables: undefined },
      { ...valid, storageRowCounts: undefined },
      { ...valid, storageTables: [] },
      { ...valid, storageTables: ['storage.objects', 'storage.buckets'] },
      { ...valid, storageTables: [...storageTables, 'storage.migrations'] },
      { ...valid, storageRowCounts: [{ table: 'storage.buckets', count: 3 }] },
      {
        ...valid,
        storageRowCounts: storageTables.map((table) => ({ table, count: -1 })),
      },
      {
        ...valid,
        storageTables: ['storage.buckets'],
        storageRowCounts: [{ table: 'storage.objects', count: 3 }],
      },
    ];
    for (const value of invalid)
      expect(() => parseManifest(JSON.stringify(value))).toThrow('incomplete or invalid');
  });
});

describe('restoring Supabase Storage rows', () => {
  it('takes only the rows of a managed storage table from the archive', () => {
    expect(
      authRestoreArguments('/tmp/objects.sql', 'storage.objects', '/tmp/auth.dump'),
    ).toEqual([
      '--file',
      '/tmp/objects.sql',
      '--data-only',
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--strict-names',
      '--schema=storage',
      '--table=objects',
      '/tmp/auth.dump',
    ]);
  });

  it('refuses a storage table that is not backed up', () => {
    for (const table of ['storage.migrations', 'storage', 'public.objects'])
      expect(() => authRestoreArguments('/tmp/x.sql', table, '/tmp/auth.dump')).toThrow(
        'must be schema-qualified',
      );
  });

  it('requires empty storage tables without locking tables it does not own', () => {
    const sql = restorePreflightSql(['public'], [...storageTables]);
    expect(sql).toContain('SELECT 1 FROM storage.buckets');
    expect(sql).toContain('Target storage.objects must be empty');
    expect(sql).toContain(
      'LOCK TABLE auth.users, auth.identities IN ACCESS EXCLUSIVE MODE NOWAIT;',
    );
    expect(sql).not.toContain('LOCK TABLE storage');
    expect(restorePreflightSql(['public'])).not.toContain('storage');
  });

  it('validates restored storage counts inside the restore transaction', () => {
    const sql = restoreValidationSql(withStorage());
    for (const table of storageTables)
      expect(sql).toContain(`FROM "${table.split('.')[0]}"."${table.split('.')[1]}"`);
    expect(restoreValidationSql(manifest())).not.toContain('storage');
  });
});
