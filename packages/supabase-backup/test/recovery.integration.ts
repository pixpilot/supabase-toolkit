import type { BackupManifest } from '../src/core/manifest.js';
import type { RestoreOptions } from '../src/restore/restore.js';
import type { ObjectStore } from '../src/storage/object-store.js';
import type { ProgramRunner } from '../src/utils/process.js';
import { randomUUID } from 'node:crypto';
import { appendFile, copyFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { backupWithConfig } from '../src/backup/backup.js';
import { backupObjectKeys } from '../src/core/manifest.js';
import { restore } from '../src/restore/restore.js';
import { getBackupStatus } from '../src/status/status.js';
import { systemRunner } from '../src/utils/process.js';
import { recoveryDatabase } from './helpers/recovery-database.js';

const first = '00000000-0000-0000-0000-000000000001';
const second = '00000000-0000-0000-0000-000000000002';
const authSchema = `CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE TABLE auth.identities(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));`;
const sourceSchema = `${authSchema}
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id), email text);
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$ BEGIN INSERT INTO public.profiles VALUES (NEW.id, NEW.email); RETURN NEW; END $$;
CREATE TRIGGER create_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE FUNCTION public.admin_only() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'private'::text $$;
REVOKE ALL ON FUNCTION public.admin_only() FROM PUBLIC;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_profiles ON public.profiles FOR SELECT TO api_anon USING (true);
GRANT SELECT ON public.profiles TO api_anon;
CREATE TABLE public.records(id bigserial PRIMARY KEY, payload jsonb, amount numeric(30,8), bytes bytea, instant timestamptz);
INSERT INTO public.records(payload, amount, bytes, instant) VALUES ('{"text":"Unicode 雪", "nested":[null,true]}', 12345678901234567890.12345678, decode('00ff01', 'hex'), '2026-01-01T03:15:00+03:00');
INSERT INTO auth.users VALUES ('${first}', 'old@example.test');
INSERT INTO auth.identities VALUES ('${first}', '${first}');`;

class MemoryStore implements ObjectStore {
  public readonly values = new Map<string, Uint8Array>();
  public async get(key: string): Promise<Uint8Array> {
    const value = this.values.get(key);
    if (!value) throw new Error(`Missing object ${key}`);
    return value;
  }

  public async has(key: string): Promise<boolean> {
    return this.values.has(key);
  }

  public async list(prefix: string): Promise<string[]> {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  public async putImmutable(key: string, data: Uint8Array): Promise<void> {
    if (this.values.has(key)) throw new Error('Object already exists');
    this.values.set(key, data);
  }
}

// Only age and R2 are substitutes. All dumps, restores, snapshots and transactions use PostgreSQL.
const runner: ProgramRunner = {
  async run(program, args, options) {
    if (program === 'age') {
      const input = args.at(-1);
      const output = args[args.indexOf('--output') + 1];
      if (!input || !output) throw new Error('Missing archive path');
      await copyFile(input, output);
      return '';
    }
    return systemRunner.run(program, args, options);
  },
};
let server: Awaited<ReturnType<typeof recoveryDatabase>>;
beforeAll(async () => {
  server = await recoveryDatabase();
});
afterAll(async () => {
  await server?.stop();
});

afterEach(() => vi.restoreAllMocks());

async function fixture(
  hook?: (
    source: Awaited<ReturnType<typeof server.create>>,
    phase: 'before' | 'after',
  ) => Promise<void>,
  prepareSource?: (source: Awaited<ReturnType<typeof server.create>>) => Promise<void>,
) {
  const source = await server.create(sourceSchema);
  await prepareSource?.(source);
  const target = await server.create(authSchema);
  const store = new MemoryStore();
  const prefix = randomUUID();
  const hookedRunner: ProgramRunner = {
    async run(program, args, options) {
      const appDump =
        program === 'pg_dump' && args.some((arg) => arg.startsWith('--schema='));
      if (appDump) await hook?.(source, 'before');
      const result = await runner.run(program, args, options);
      if (appDump) await hook?.(source, 'after');
      return result;
    },
  };
  const manifest = await backupWithConfig(
    {
      sourceDatabaseUrl: source.url,
      appSchemas: ['public'],
      excludedSchemas: [],
      prefix,
      ageRecipient: 'age1test',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      bucket: 'test-backups',
      endpoint: 'https://test.r2.cloudflarestorage.com',
    },
    { runner: hookedRunner, store },
  );
  const key = backupObjectKeys(prefix, new Date(manifest.createdAt)).manifest;
  const apply = async (
    restoreRunner: ProgramRunner = runner,
    extra: Pick<RestoreOptions, 'accessChecks'> = {},
  ) =>
    restore(
      { apply: true, confirmTarget: target.confirmTarget, key, ...extra },
      {
        TARGET_DATABASE_URL: target.url,
        AGE_IDENTITY: 'AGE-SECRET-KEY-TEST',
        R2_ACCESS_KEY_ID: 'test',
        R2_SECRET_ACCESS_KEY: 'test',
        R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
        R2_BUCKET: 'test-backups',
      },
      { store, runner: restoreRunner },
    );
  const expectEmpty = async () => {
    expect(
      (await target.db.query('SELECT count(*)::int AS count FROM auth.users')).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (await target.db.query("SELECT to_regclass('public.profiles') AS relation")).rows,
    ).toEqual([{ relation: null }]);
  };
  return { source, target, store, prefix, key, manifest, apply, expectEmpty };
}

describe('PostgreSQL recovery safety', () => {
  it('reports each restore phase in execution order and announces success after commit', async () => {
    const f = await fixture();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await f.apply();
    const logs = output.mock.calls.map(([chunk]) => String(chunk)).join('');
    output.mockRestore();
    const phases = [
      'Starting restore...',
      'Loading backup manifest...',
      'Checking PostgreSQL tool compatibility...',
      'Downloading application and Auth archives and verifying checksums...',
      'Decrypting application archive...',
      'Decrypting Auth archive...',
      'Checking decrypted archives can be read...',
      'Connecting to restore target',
      'Checking target Auth table compatibility...',
      'Checking target Auth tables are empty...',
      'Checking target application schemas are empty...',
      'Preparing application schemas and access rules...',
      'Preparing data for auth.users...',
      'Preparing data for auth.identities...',
      'Preparing application schema and data SQL...',
      'Preparing Auth triggers...',
      'Starting database restore transaction...',
      'Locking target tables and preparing default privileges...',
      'Restoring auth.users data...',
      'Restoring auth.identities data...',
      'Restoring existing schema ownership and grants...',
      'Restoring application schemas, data, and access rules...',
      'Reinstating target default privileges...',
      'Restoring Auth triggers...',
      'Validating restored row counts, ownership, and privileges...',
      'Validation passed. Committing restore...',
      'Restore transaction committed successfully.',
      'Checking default privileges and role memberships (advisory)...',
      'Configured default privileges match the backup.',
      'Cluster role memberships match the backup.',
    ];
    let previous = -1;
    for (const phase of phases) {
      const position = logs.indexOf(`[restore] ${phase}`);
      expect(position, phase).toBeGreaterThan(previous);
      previous = position;
    }
    expect(logs).not.toContain('unused');
    expect(logs).not.toContain('AGE-SECRET-KEY-TEST');
    expect(f.manifest.accessChecks).toMatchObject({ version: 1 });
  });

  it('restores old backups without requiring an advisory baseline', async () => {
    const f = await fixture();
    const { accessChecks: _accessChecks, ...old } = f.manifest;
    f.store.values.set(f.key, Buffer.from(JSON.stringify(old)));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await f.apply();
    const logs = output.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(logs).toContain('Restore transaction committed successfully.');
    expect(logs).toContain('Advisory checks skipped');
    expect(logs).not.toContain('Cluster role memberships match');
  });

  it('can disable the new advisory checks while still completing a validated restore', async () => {
    const f = await fixture();
    await f.target.db.query(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO api_anon',
    );
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await f.apply(runner, { accessChecks: false });
    const logs = output.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(logs).toContain('Restore transaction committed successfully.');
    expect(logs).toContain('Advisory access checks disabled (--no-access-checks).');
    expect(logs).not.toContain('Checking default privileges and role memberships');
    expect(logs).not.toContain('Warning: configured default privileges differ');
  });

  it('reports changed defaults and memberships after commit without changing membership grants', async () => {
    const f = await fixture();
    const member = `advisory_member_${randomUUID().replaceAll('-', '')}`;
    const parent = `advisory_parent_${randomUUID().replaceAll('-', '')}`;
    await f.target.db.query(`
      CREATE ROLE ${member} NOLOGIN;
      CREATE ROLE ${parent} NOLOGIN;
      GRANT ${parent} TO ${member} WITH ADMIN OPTION;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO api_anon;
    `);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await f.apply();
    const logs = output.mock.calls.map(([chunk]) => String(chunk)).join('');
    const committed = logs.indexOf('Restore transaction committed successfully.');
    expect(committed).toBeGreaterThan(-1);
    expect(logs.indexOf('Warning: configured default privileges differ')).toBeGreaterThan(
      committed,
    );
    expect(logs.indexOf('Warning: cluster role memberships differ')).toBeGreaterThan(
      committed,
    );
    expect(
      (
        await f.target.db.query(
          `SELECT pg_has_role('${member}', '${parent}', 'MEMBER') AS allowed`,
        )
      ).rows,
    ).toEqual([{ allowed: true }]);
    expect(
      (await f.target.db.query('SELECT count(*)::int AS count FROM auth.users')).rows,
    ).toEqual([{ count: 1 }]);
  });

  it('restores ownership of an application schema that already exists', async () => {
    const f = await fixture(undefined, async (source) => {
      await source.db.query('ALTER SCHEMA public OWNER TO review');
    });
    await f.apply();
    expect(
      (
        await f.target.db.query(
          "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'",
        )
      ).rows,
    ).toEqual([{ owner: 'review' }]);
  });

  it('replaces extra grants on an empty existing application schema', async () => {
    const f = await fixture(undefined, async (source) => {
      await source.db.query('REVOKE USAGE ON SCHEMA public FROM PUBLIC');
    });
    await f.target.db.query('GRANT CREATE ON SCHEMA public TO api_anon');
    await f.apply();
    expect(
      (
        await f.target.db.query(
          "SELECT has_schema_privilege('api_anon', 'public', 'CREATE') OR has_schema_privilege('api_anon', 'public', 'USAGE') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  });

  it('keeps managed defaults on the target while restoring application default and object grants', async () => {
    const f = await fixture(undefined, async (source) => {
      await source.db.query(`
        CREATE ROLE supabase_admin NOLOGIN;
        CREATE ROLE recovery_operator NOLOGIN;
        GRANT review TO recovery_operator;
        ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO api_anon;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO api_anon;
      `);
    });
    await f.target.db.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT INSERT ON TABLES TO api_anon;
    `);
    const defaultsSql = `SELECT defaclacl::text FROM pg_default_acl WHERE defaclrole = 'supabase_admin'::regrole`;
    const before = (await f.target.db.query(defaultsSql)).rows;
    await f.target.db.query('SET ROLE recovery_operator');
    try {
      await expect(
        f.target.db.query(
          'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO api_anon',
        ),
      ).rejects.toThrow('permission denied to change default privileges');
    } finally {
      await f.target.db.query('RESET ROLE');
    }
    await f.apply({
      async run(program, args, options) {
        return runner.run(
          program,
          args,
          program === 'psql'
            ? {
                ...options,
                env: { ...options?.env, PGOPTIONS: '-c role=recovery_operator' },
              }
            : options,
        );
      },
    });
    expect((await f.target.db.query(defaultsSql)).rows).toEqual(before);
    await f.target.db.query('CREATE TABLE public.future_table(id int)');
    expect(
      (
        await f.target.db.query(`SELECT
          has_table_privilege('api_anon', 'public.profiles', 'SELECT') AS existing,
          has_table_privilege('api_anon', 'public.future_table', 'SELECT') AS future`)
      ).rows,
    ).toEqual([{ existing: true, future: true }]);
  });

  it('explains a missing grant role, rolls back, and succeeds after the role is recreated', async () => {
    const role = `restore_role_${randomUUID().replaceAll('-', '')}`;
    const f = await fixture(undefined, async (source) => {
      await source.db.query(
        `CREATE ROLE "${role}" NOLOGIN; GRANT SELECT ON public.profiles TO "${role}";`,
      );
    });
    // Roles are cluster-wide, so remove the source grant before simulating a missing target role.
    await f.source.db.query(
      `REVOKE SELECT ON public.profiles FROM "${role}"; DROP ROLE "${role}";`,
    );
    await expect(f.apply()).rejects.toThrow(`CREATE ROLE "${role}" NOLOGIN;`);
    await f.expectEmpty();
    await f.target.db.query(`CREATE ROLE "${role}" NOLOGIN;`);
    await f.apply();
    expect(
      (
        await f.target.db.query(
          "SELECT has_table_privilege($1, 'public.profiles', 'SELECT') AS allowed",
          [role],
        )
      ).rows,
    ).toEqual([{ allowed: true }]);
  });

  it('preserves one snapshot, values, sequences, RLS, restricted access, and signup triggers', async () => {
    const f = await fixture(async (source, phase) => {
      if (phase === 'after')
        await source.db.query(
          "BEGIN; UPDATE auth.users SET email='new@example.test'; UPDATE public.profiles SET email='new@example.test'; COMMIT;",
        );
    });
    await f.apply();
    expect(
      (
        await f.target.db.query(
          'SELECT u.email AS auth, p.email AS profile FROM auth.users u JOIN public.profiles p ON p.id=u.id',
        )
      ).rows,
    ).toEqual([{ auth: 'old@example.test', profile: 'old@example.test' }]);
    expect((await f.target.db.query('SELECT * FROM public.records')).rows).toEqual(
      (await f.source.db.query('SELECT * FROM public.records')).rows,
    );
    expect(
      (await f.target.db.query('INSERT INTO public.records DEFAULT VALUES RETURNING id'))
        .rows,
    ).toEqual([{ id: '2' }]);
    expect(
      (
        await f.target.db.query(
          "SELECT has_function_privilege('api_anon', 'public.admin_only()', 'EXECUTE') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
    expect(
      (
        await f.target.db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true }]);
    await f.target.db.query(
      `INSERT INTO auth.users VALUES ('${second}', 'new-user@example.test')`,
    );
    expect(
      (await f.target.db.query('SELECT count(*)::int AS count FROM public.profiles'))
        .rows,
    ).toEqual([{ count: 2 }]);
  });

  it('keeps counts consistent when writes occur between metadata collection and dumping', async () => {
    const f = await fixture(async (source, phase) => {
      if (phase === 'before')
        await source.db.query(
          `INSERT INTO auth.users VALUES ('${second}', 'new@example.test'); INSERT INTO auth.identities VALUES ('${second}', '${second}')`,
        );
    });
    await f.apply();
    expect(
      (await f.target.db.query('SELECT count(*)::int AS count FROM auth.users')).rows,
    ).toEqual([{ count: 1 }]);
  });

  it('rolls back Auth rows on a table error and allows a corrected retry', async () => {
    const f = await fixture();
    await f.target.db.query(
      'ALTER TABLE auth.identities ADD CONSTRAINT rejected CHECK (false)',
    );
    await expect(f.apply()).rejects.toThrow('check constraint');
    await f.expectEmpty();
    await f.target.db.query('ALTER TABLE auth.identities DROP CONSTRAINT rejected');
    await f.apply();
  });

  it('rolls back application objects and Auth rows if final count validation fails', async () => {
    const f = await fixture();
    const invalid: BackupManifest = {
      ...f.manifest,
      appTableCounts: f.manifest.appTableCounts.map((entry) => ({
        ...entry,
        count: entry.count + 1,
      })),
    };
    f.store.values.set(f.key, Buffer.from(JSON.stringify(invalid)));
    await expect(f.apply()).rejects.toThrow('row count does not match');
    await f.expectEmpty();
  });

  it('restores exact application access despite target defaults, and preserves those defaults for future objects', async () => {
    const f = await fixture();
    await f.target.db.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO api_anon;
       ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
       ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO api_anon WITH GRANT OPTION;
       ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO api_anon;
       ALTER DEFAULT PRIVILEGES REVOKE USAGE ON TYPES FROM PUBLIC;`,
    );
    const defaultsSql =
      'SELECT defaclnamespace, defaclobjtype, defaclacl::text FROM pg_default_acl ORDER BY defaclnamespace, defaclobjtype';
    const before = (await f.target.db.query(defaultsSql)).rows;
    await f.apply();
    expect((await f.target.db.query(defaultsSql)).rows).toEqual(before);
    expect(
      (
        await f.target.db.query(
          "SELECT has_function_privilege('api_anon', 'public.admin_only()', 'EXECUTE') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
    await f.target.db.query(
      "CREATE FUNCTION public.future_function() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    );
    expect(
      (
        await f.target.db.query(
          "SELECT has_function_privilege('api_anon', 'public.future_function()', 'EXECUTE') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: true }]);
  });

  it.each([true, false])(
    'still rolls back if restored application access differs (advisories enabled: %s)',
    async (accessChecks) => {
      const f = await fixture();
      await f.target.db.query(`
      GRANT CREATE ON SCHEMA public TO api_anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO api_anon;
    `);
      const defaultsSql = 'SELECT defaclacl::text FROM pg_default_acl';
      const before = (await f.target.db.query(defaultsSql)).rows;
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await expect(
        f.apply(
          {
            async run(program, args, options) {
              if (program === 'psql') {
                const appSql = args.find((arg) => arg.endsWith('app.sql'));
                if (!appSql) throw new Error('Missing application SQL');
                await appendFile(
                  appSql,
                  '\nGRANT EXECUTE ON FUNCTION public.admin_only() TO api_anon;\n',
                );
              }
              return runner.run(program, args, options);
            },
          },
          { accessChecks },
        ),
      ).rejects.toThrow('ownership or privileges differ');
      const logs = output.mock.calls.map(([chunk]) => String(chunk)).join('');
      output.mockRestore();
      expect(logs).toContain(
        '[restore] Validating restored row counts, ownership, and privileges...',
      );
      expect(logs).not.toContain('Validation passed.');
      expect(logs).not.toContain('committed successfully.');
      expect(logs).not.toContain('Checking default privileges and role memberships');
      await f.expectEmpty();
      expect((await f.target.db.query(defaultsSql)).rows).toEqual(before);
      expect(
        (
          await f.target.db.query(
            "SELECT has_schema_privilege('api_anon', 'public', 'CREATE') AS allowed",
          )
        ).rows,
      ).toEqual([{ allowed: true }]);
    },
  );

  it('detects corrupted archive bytes in both status and restore before any writes', async () => {
    const f = await fixture();
    const archive = Buffer.from(await f.store.get(f.manifest.appObjectKey));
    const firstByte = archive[0] ?? 0;
    archive[0] = firstByte === 0xff ? 0 : 0xff;
    f.store.values.set(f.manifest.appObjectKey, archive);
    await expect(getBackupStatus(f.prefix, f.store)).rejects.toThrow(
      'checksum verification failed',
    );
    await expect(f.apply()).rejects.toThrow('checksum verification failed');
    await f.expectEmpty();
  });

  it('refuses existing Auth triggers instead of firing them during recovery', async () => {
    const f = await fixture();
    await f.target.db.query(`
      CREATE FUNCTION auth.existing_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER existing_trigger AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION auth.existing_trigger();
    `);
    await expect(f.apply()).rejects.toThrow('already have custom triggers');
    await f.expectEmpty();
  });

  it('does not publish a completed manifest when an archive upload is damaged', async () => {
    const source = await server.create(sourceSchema);
    const store = new MemoryStore();
    const put = store.putImmutable.bind(store);
    store.putImmutable = async (key, data) => {
      await put(key, key.endsWith('app.dump.age') ? Buffer.from('damaged') : data);
    };
    await expect(
      backupWithConfig(
        {
          sourceDatabaseUrl: source.url,
          appSchemas: ['public'],
          excludedSchemas: [],
          prefix: randomUUID(),
          ageRecipient: 'age1test',
          accessKeyId: 'test',
          secretAccessKey: 'test',
          bucket: 'test-backups',
          endpoint: 'https://test.r2.cloudflarestorage.com',
        },
        { runner, store },
      ),
    ).rejects.toThrow('checksum verification failed');
    expect([...store.values.keys()].some((key) => key.endsWith('manifest.json'))).toBe(
      false,
    );
  });
});
