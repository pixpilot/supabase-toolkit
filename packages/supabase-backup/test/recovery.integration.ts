import type { BackupManifest } from '../src/manifest.js';
import type { ProgramRunner } from '../src/process.js';
import type { ObjectStore } from '../src/r2.js';
import { randomUUID } from 'node:crypto';
import { copyFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupWithConfig } from '../src/backup.js';
import { backupObjectKeys } from '../src/manifest.js';
import { systemRunner } from '../src/process.js';
import { restore } from '../src/restore.js';
import { getBackupStatus } from '../src/status.js';
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

async function fixture(
  hook?: (
    source: Awaited<ReturnType<typeof server.create>>,
    phase: 'before' | 'after',
  ) => Promise<void>,
) {
  const source = await server.create(sourceSchema);
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
  const apply = async () =>
    restore(
      { apply: true, confirmTarget: target.confirmTarget, key },
      {
        TARGET_DATABASE_URL: target.url,
        AGE_IDENTITY: 'AGE-SECRET-KEY-TEST',
        R2_ACCESS_KEY_ID: 'test',
        R2_SECRET_ACCESS_KEY: 'test',
        R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
        R2_BUCKET: 'test-backups',
      },
      { store, runner },
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

  it('rolls back if target default privileges would broaden application access', async () => {
    const f = await fixture();
    await f.target.db.query(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO api_anon',
    );
    await expect(f.apply()).rejects.toThrow('ownership or privileges differ');
    await f.expectEmpty();
  });

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
