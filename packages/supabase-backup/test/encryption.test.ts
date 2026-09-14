import type { CliArguments } from '../src/cli/command-line.js';
import type { InputValues } from '../src/cli/interactive.js';
import type { Prompter, TextPromptOptions } from '../src/cli/prompt.js';
import type { BackupConfig } from '../src/core/config.js';
import type { BackupManifest } from '../src/core/manifest.js';
import type { ProgramRunner } from '../src/utils/process.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArguments, planCommand, runCli } from '../src/cli/command-line.js';
import { backupFieldsFor } from '../src/cli/interactive.js';
import {
  encryptionDisabled,
  loadBackupConfig,
  loadRestoreConfig,
} from '../src/core/config.js';
import { BackupError } from '../src/core/errors.js';
import { authTables, backupObjectKeys, parseManifest } from '../src/core/manifest.js';
import { getBackupStatus } from '../src/status/status.js';
import { LocalStore } from '../src/storage/adapters/local-store.js';
import { withTemporaryDirectory } from '../src/utils/files.js';
import { systemRunner } from '../src/utils/process.js';
import { MemoryStore } from './helpers/memory-store.js';

/*
 * Encryption is the default, and this suite exists to keep it that way.
 *
 * Every path is checked in both directions: that a run which says nothing still
 * demands a recipient, encrypts, and names its archives `.age`, and that only an
 * explicit --no-encryption changes any of that. The two are asserted together so
 * a change that loosens the default fails here rather than in production.
 */

/** Distinctive bytes, so a stored object proves which file reached the store. */
const appDumpBytes = 'app-dump-bytes';
const authDumpBytes = 'auth-dump-bytes';

/** Marks the bytes the age stub produced, so encryption is visible in the store. */
const sealed = (plaintext: string): string => `age-sealed(${plaintext})`;

/** The metadata a real dump returns, with nothing encryption depends on. */
function dumpMetadata(): Omit<
  BackupManifest,
  | 'appChecksumObjectKey'
  | 'appEncryptedBytes'
  | 'appObjectKey'
  | 'appSha256'
  | 'authChecksumObjectKey'
  | 'authEncryptedBytes'
  | 'authObjectKey'
  | 'authSha256'
  | 'authTables'
  | 'cliVersion'
  | 'createdAt'
  | 'encryption'
  | 'environment'
  | 'formatVersion'
> {
  return {
    appAccessFingerprint: 'a'.repeat(32),
    appSchemas: ['public'],
    appTableCounts: [{ table: 'public.profiles', count: 2 }],
    authColumns: {
      'auth.users': [{ name: 'id', dataType: 'uuid' }],
      'auth.identities': [{ name: 'id', dataType: 'uuid' }],
    },
    authRowCounts: authTables.map((table) => ({ table, count: 1 })),
    extensions: ['plpgsql'],
    pgDumpVersion: 'pg_dump (PostgreSQL) 17.4',
    postgresServerVersion: '17.4',
  };
}

/*
 * The dump is replaced so this suite needs no database. What it writes is real:
 * the two archive files the backup then reads, hashes, and uploads, which is the
 * part encryption changes.
 */
vi.mock('../src/backup/dump-database.js', () => ({
  async dumpDatabase(
    _config: BackupConfig,
    _runner: ProgramRunner,
    appDump: string,
    authDump: string,
  ) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(appDump, appDumpBytes);
    await writeFile(authDump, authDumpBytes);
    return dumpMetadata();
  },
}));

const { backupWithConfig } = await import('../src/backup/backup.js');
const { restore } = await import('../src/restore/restore.js');

/** Records every program a run invokes, and stands in for age and pg_restore. */
function recordingRunner(): {
  calls: { program: string; args: string[] }[];
  programs: () => string[];
  runner: ProgramRunner;
} {
  const calls: { program: string; args: string[] }[] = [];
  return {
    calls,
    programs: () => calls.map(({ program }) => program),
    runner: {
      async run(program, used): Promise<string> {
        calls.push({ program, args: [...used] });
        if (program === 'pg_restore' && used.includes('--version'))
          return 'pg_restore (PostgreSQL) 17.4';
        if (program === 'age') {
          const { readFile: read, writeFile } = await import('node:fs/promises');
          const input = used.at(-1) ?? '';
          const output = used[used.indexOf('--output') + 1] ?? '';
          const contents = await read(input, 'utf8');
          await writeFile(
            output,
            used.includes('--decrypt')
              ? (/^age-sealed\((?<plain>.*)\)$/su.exec(contents)?.groups?.['plain'] ??
                  contents)
              : sealed(contents),
          );
        }
        return '';
      },
    },
  };
}

/** A backup configuration with an explicit opt-out for plaintext fixtures. */
function backupConfig(ageRecipient: string | undefined): BackupConfig {
  return {
    accessKeyId: 'key',
    bucket: 'private-backups',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    secretAccessKey: 'secret',
    ...(ageRecipient === undefined ? { encryption: 'none' as const } : { ageRecipient }),
    appSchemas: ['public'],
    excludedSchemas: [],
    prefix: 'production/database',
    sourceDatabaseUrl:
      'postgresql://backup:secret@db.example.test:5432/postgres?sslmode=require',
  };
}

const createdAt = new Date('2026-01-01T00:00:00.000Z');

/** Runs one backup against an in-memory store and returns everything it wrote. */
async function runBackup(config: BackupConfig): Promise<{
  calls: { program: string; args: string[] }[];
  manifest: BackupManifest;
  programs: () => string[];
  store: MemoryStore;
  stored: (key: string) => string;
}> {
  const store = new MemoryStore();
  const { calls, programs, runner } = recordingRunner();
  const manifest = await backupWithConfig(config, { now: createdAt, runner, store });
  return {
    calls,
    manifest,
    programs,
    store,
    stored: (key: string): string =>
      Buffer.from(store.values.get(key) ?? new Uint8Array()).toString('utf8'),
  };
}

const env = {
  BACKUP_AGE_RECIPIENT: 'age1recipient',
  BACKUP_PREFIX: 'production/database',
  R2_ACCESS_KEY_ID: 'key',
  R2_BUCKET: 'private-backups',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_SECRET_ACCESS_KEY: 'secret',
  SOURCE_DATABASE_URL:
    'postgresql://backup:secret@db.example.test:5432/postgres?sslmode=require',
};

const restoreEnv = {
  AGE_IDENTITY: 'AGE-SECRET-KEY-1TESTIDENTITY',
  R2_ACCESS_KEY_ID: 'key',
  R2_BUCKET: 'private-backups',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_SECRET_ACCESS_KEY: 'secret',
};

/** Replays scripted answers and records which questions were reached. */
class StubPrompter implements Prompter {
  public readonly asked: string[] = [];
  public constructor(private readonly answers: string[] = []) {}
  public close(): void {
    // Nothing to close.
  }

  public note(): void {
    // Nothing to show.
  }

  public async text(question: string, options: TextPromptOptions = {}): Promise<string> {
    this.asked.push(question);
    const answer = this.answers.shift();
    if (answer === undefined || answer === '') {
      if (options.defaultValue === undefined)
        throw new BackupError(`No scripted answer for '${question}'.`);
      return options.defaultValue;
    }
    options.validate?.(answer);
    return answer;
  }

  public async confirm(): Promise<boolean> {
    return true;
  }

  public async select(): Promise<number> {
    return 0;
  }
}

function args(
  command: string,
  values: Record<string, string> = {},
  switches: string[] = [],
): CliArguments {
  return {
    command,
    values: new Map(Object.entries(values)),
    switches: new Set(switches),
  };
}

/** The flags a fully specified run passes, less the ones a test drops. */
const flags: Record<string, string> = {
  '--age-identity': 'AGE-SECRET-KEY-1TESTIDENTITY',
  '--age-recipient': 'age1recipient',
  '--prefix': 'production/database',
  '--r2-access-key-id': 'key',
  '--r2-bucket': 'private-backups',
  '--r2-endpoint': 'https://account.r2.cloudflarestorage.com',
  '--r2-secret-access-key': 'secret',
  '--source-database-url':
    'postgresql://backup:secret@db.example.test:5432/postgres?sslmode=require',
};

/** Everything but the named flags, for testing what a run is still asked for. */
function without(...dropped: string[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(flags).filter(([flag]) => !dropped.includes(flag)),
  );
}

describe('the --no-encryption flag', () => {
  it('is accepted by backup and restore, and refused anywhere else', () => {
    for (const command of ['backup', 'restore']) {
      expect(
        parseArguments([command, '--no-encryption']).switches.has('--no-encryption'),
      ).toBe(true);
    }
    for (const command of ['status', ''])
      expect(() => parseArguments([command, '--no-encryption'])).toThrow(
        '--no-encryption is only supported for backup and restore.',
      );
  });

  it('never takes a value, so it cannot be switched off by writing one', () => {
    for (const written of ['--no-encryption=false', '--no-encryption=true'])
      expect(() => parseArguments(['backup', written])).toThrow('does not take a value');
  });

  it('refuses to run alongside the key flag it contradicts', () => {
    expect(() =>
      parseArguments(['backup', '--no-encryption', '--age-recipient', 'age1x']),
    ).toThrow('--no-encryption cannot be combined with --age-recipient.');
    expect(() =>
      parseArguments([
        'restore',
        '--no-encryption',
        '--age-identity',
        'AGE-SECRET-KEY-1X',
      ]),
    ).toThrow('--no-encryption cannot be combined with --age-identity.');
  });

  it('leaves the other command alone, so each rejects only its own contradiction', () => {
    expect(
      parseArguments([
        'backup',
        '--no-encryption',
        '--age-identity',
        'AGE-SECRET-KEY-1X',
      ]).switches.has('--no-encryption'),
    ).toBe(true);
  });

  it('is documented in the help text', async () => {
    const { usage } = await import('../src/cli/command-line.js');
    expect(usage).toContain('--no-encryption');
  });
});

describe('configuration, which decides whether a run may skip encryption', () => {
  it('requires a recipient and an identity when nothing opts out', () => {
    const { BACKUP_AGE_RECIPIENT: _recipient, ...bare } = env;
    expect(() => loadBackupConfig(bare)).toThrow('BACKUP_AGE_RECIPIENT is required.');
    expect(loadBackupConfig(env).ageRecipient).toBe('age1recipient');
    const { AGE_IDENTITY: _identity, ...withoutIdentity } = restoreEnv;
    expect(() => loadRestoreConfig(withoutIdentity)).toThrow('AGE_IDENTITY is required.');
    expect(loadRestoreConfig(restoreEnv).ageIdentity).toBe(
      'AGE-SECRET-KEY-1TESTIDENTITY',
    );
  });

  it('drops both keys only for a run that opted out', () => {
    const { BACKUP_AGE_RECIPIENT: _recipient, ...bare } = env;
    expect(loadBackupConfig({ ...bare, BACKUP_ENCRYPTION: 'none' })).toMatchObject({
      encryption: 'none',
    });
    const { AGE_IDENTITY: _identity, ...withoutIdentity } = restoreEnv;
    expect(
      loadRestoreConfig({ ...withoutIdentity, BACKUP_ENCRYPTION: 'none' }).ageIdentity,
    ).toBeUndefined();
  });

  it('treats anything but the exact opt-out word as encrypted, or refuses it', () => {
    for (const value of [undefined, ''])
      expect(encryptionDisabled({ BACKUP_ENCRYPTION: value })).toBe(false);
    expect(encryptionDisabled({ BACKUP_ENCRYPTION: ' none ' })).toBe(true);
    for (const value of ['NONE', 'false', 'no', 'off', '0', 'plaintext'])
      expect(() => encryptionDisabled({ BACKUP_ENCRYPTION: value })).toThrow(
        "BACKUP_ENCRYPTION must be 'none'",
      );
  });

  it('still validates the recipient of a run that did not opt out', () => {
    expect(() =>
      loadBackupConfig({ ...env, BACKUP_AGE_RECIPIENT: 'AGE-SECRET-KEY-1LEAKED' }),
    ).toThrow('is an age identity (private key)');
  });

  it('rejects contradictory encryption settings through the library too', () => {
    expect(() => loadBackupConfig({ ...env, BACKUP_ENCRYPTION: 'none' })).toThrow(
      'BACKUP_ENCRYPTION: none cannot be combined with BACKUP_AGE_RECIPIENT.',
    );
    // Ignoring the identity instead would fail later saying one was needed.
    expect(() => loadRestoreConfig({ ...restoreEnv, BACKUP_ENCRYPTION: 'none' })).toThrow(
      'BACKUP_ENCRYPTION: none cannot be combined with AGE_IDENTITY.',
    );
  });

  it.each(['', '   '])(
    'reads a declared but blank key (%j) as one that was never set',
    (blank) => {
      const opted = { BACKUP_ENCRYPTION: 'none' };
      expect(
        loadBackupConfig({ ...env, ...opted, BACKUP_AGE_RECIPIENT: blank }),
      ).toMatchObject({ encryption: 'none' });
      expect(
        loadRestoreConfig({ ...restoreEnv, ...opted, AGE_IDENTITY: blank }).ageIdentity,
      ).toBeUndefined();
    },
  );
});

describe('what a run is asked for', () => {
  it('asks for a recipient by default and not when encryption is off', async () => {
    const asked = (fields: readonly { flag: string }[]): string[] =>
      fields.map((field) => field.flag);
    expect(asked(backupFieldsFor('r2'))).toContain('--age-recipient');
    expect(asked(backupFieldsFor('r2', true))).toContain('--age-recipient');
    expect(asked(backupFieldsFor('r2', false))).not.toContain('--age-recipient');
  });

  it('prompts for the recipient a backup left out, unless it opted out', async () => {
    const prompted = new StubPrompter(['age1recipient']);
    await planCommand(args('backup', without('--age-recipient')), prompted);
    expect(prompted.asked).toEqual(['age recipient used to encrypt (age1…)']);
    const skipped = new StubPrompter();
    await planCommand(
      args('backup', without('--age-recipient'), ['--no-encryption']),
      skipped,
    );
    expect(skipped.asked).toEqual([]);
  });

  it('fails an unattended backup that gave no recipient and did not opt out', async () => {
    await expect(
      planCommand(args('backup', without('--age-recipient')), undefined),
    ).rejects.toThrow('--age-recipient is required.');
    await expect(
      planCommand(
        args('backup', without('--age-recipient'), ['--no-encryption']),
        undefined,
      ),
    ).resolves.toBeInstanceOf(Function);
  });

  it('prompts for the identity a restore left out, unless it opted out', async () => {
    const key = 'production/database/v1/20260101T000000Z/manifest.json';
    // An interactive restore also asks for the target and its typed confirmation.
    const target = 'postgresql://restore:secret@db.test:5432/postgres?sslmode=require';
    const prompted = new StubPrompter(['AGE-SECRET-KEY-1TESTIDENTITY', target, 'YES']);
    await planCommand(
      args('restore', { ...without('--age-identity'), '--key': key }),
      prompted,
    );
    expect(prompted.asked).toContain('age identity used to decrypt (AGE-SECRET-KEY-1…)');
    const skipped = new StubPrompter([target, 'YES']);
    await planCommand(
      args('restore', { ...without('--age-identity'), '--key': key }, [
        '--no-encryption',
      ]),
      skipped,
    );
    expect(skipped.asked).not.toContain(
      'age identity used to decrypt (AGE-SECRET-KEY-1…)',
    );
  });
});

describe('taking a backup', () => {
  let warnings: string[] = [];
  beforeEach(() => {
    warnings = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk): boolean => {
      warnings.push(String(chunk));
      return true;
    });
    return () => vi.restoreAllMocks();
  });

  it.each([undefined, '', '   '])(
    'refuses a missing or blank recipient (%j) before running tools or uploading',
    async (ageRecipient) => {
      const config = backupConfig('age1recipient');
      Object.assign(config, { ageRecipient });
      const store = new MemoryStore();
      const { runner, calls } = recordingRunner();
      await expect(backupWithConfig(config, { runner, store })).rejects.toThrow(
        'ageRecipient is required unless encryption is explicitly set to none.',
      );
      expect(calls).toEqual([]);
      expect(store.values.size).toBe(0);
    },
  );

  it('refuses a recipient combined with a plaintext configuration', async () => {
    const config = backupConfig('age1recipient');
    Object.assign(config, { encryption: 'none' });
    await expect(runBackup(config)).rejects.toThrow(
      'encryption: none cannot be combined with ageRecipient.',
    );
  });

  it.each([1, 2])(
    'never uploads plaintext or publishes a manifest when age fails on archive %i',
    async (failedArchive) => {
      const store = new MemoryStore();
      const recorder = recordingRunner();
      let encryptedArchives = 0;
      const runner: ProgramRunner = {
        async run(program, used, options) {
          if (program === 'age' && ++encryptedArchives === failedArchive)
            throw new Error('age encryption failed');
          return recorder.runner.run(program, used, options);
        },
      };
      await expect(
        backupWithConfig(backupConfig('age1recipient'), { runner, store }),
      ).rejects.toThrow('age encryption failed');
      expect(encryptedArchives).toBe(failedArchive);
      expect(store.values.size).toBe(0);
    },
  );

  it('encrypts both archives, names them .age, and says so in the manifest', async () => {
    const { manifest, programs, store, stored } = await runBackup(
      backupConfig('age1recipient'),
    );
    const keys = backupObjectKeys('production/database', createdAt);
    expect(programs().filter((program) => program === 'age')).toHaveLength(2);
    expect(manifest.encryption).toBe('age');
    expect(keys.app).toBe('production/database/v1/20260101T000000Z/app.dump.age');
    expect(manifest.appObjectKey).toBe(keys.app);
    expect(manifest.authObjectKey).toBe(keys.auth);
    expect(stored(keys.app)).toBe(sealed(appDumpBytes));
    expect(stored(keys.auth)).toBe(sealed(authDumpBytes));
    expect(store.values.has(keys.manifest)).toBe(true);
    expect(warnings.join('')).not.toContain('Encryption is off');
  });

  it('names the recipient it was given to age, for both archives', async () => {
    const { calls } = await runBackup(backupConfig('age1recipient'));
    for (const call of calls.filter(({ program }) => program === 'age'))
      expect(call.args).toEqual([
        '--recipient',
        'age1recipient',
        '--output',
        expect.stringMatching(/\.dump\.age$/u),
        expect.stringMatching(/\.dump$/u),
      ]);
  });

  it('stores the plain dumps under honest names when encryption is off', async () => {
    const { manifest, programs, stored } = await runBackup(backupConfig(undefined));
    const keys = backupObjectKeys('production/database', createdAt, false);
    expect(programs()).not.toContain('age');
    expect(manifest.encryption).toBe('none');
    expect(keys.app).toBe('production/database/v1/20260101T000000Z/app.dump');
    expect(keys.auth).toBe('production/database/v1/20260101T000000Z/auth.dump');
    expect(manifest.appObjectKey).toBe(keys.app);
    expect(stored(keys.app)).toBe(appDumpBytes);
    expect(stored(keys.auth)).toBe(authDumpBytes);
  });

  it('warns that an unencrypted backup is readable by whoever can read the store', async () => {
    await runBackup(backupConfig(undefined));
    expect(warnings.join('')).toContain('Encryption is off');
    expect(warnings.join('')).toContain('plaintext database dump');
  });

  it('records checksums and sizes of what it actually stored, either way', async () => {
    for (const recipient of ['age1recipient', undefined]) {
      const { manifest, stored } = await runBackup(backupConfig(recipient));
      const app = stored(manifest.appObjectKey);
      expect(manifest.appSha256).toBe(createHash('sha256').update(app).digest('hex'));
      expect(manifest.appEncryptedBytes).toBe(Buffer.byteLength(app));
      const checksum = stored(manifest.appChecksumObjectKey);
      expect(checksum).toBe(
        `${manifest.appSha256}  ${manifest.appObjectKey.split('/').at(-1)}\n`,
      );
    }
  });

  it('publishes a manifest that reads back as valid, encrypted or not', async () => {
    for (const recipient of ['age1recipient', undefined]) {
      const { manifest, stored } = await runBackup(backupConfig(recipient));
      const keys = backupObjectKeys(
        'production/database',
        createdAt,
        recipient !== undefined,
      );
      const published = parseManifest(stored(keys.manifest));
      expect(published.encryption).toBe(recipient === undefined ? 'none' : 'age');
      expect(published).toEqual(manifest);
    }
  });
});

describe('a manifest that says how it is protected', () => {
  /** A published manifest, which each test then varies in one way. */
  const published = (encryption?: string): string => {
    const digest = createHash('sha256').update('archive').digest('hex');
    return JSON.stringify({
      ...dumpMetadata(),
      ...(encryption === undefined ? {} : { encryption }),
      formatVersion: 2,
      appChecksumObjectKey: 'app.sha256',
      appEncryptedBytes: 1,
      appObjectKey: 'app.dump.age',
      appSha256: digest,
      authChecksumObjectKey: 'auth.sha256',
      authEncryptedBytes: 1,
      authObjectKey: 'auth.dump.age',
      authSha256: digest,
      authTables: [...authTables],
      cliVersion: '3.6.0',
      createdAt: '2026-01-01T00:00:00Z',
      environment: 'production',
    });
  };

  it('reads a backup written before encryption could be turned off', () => {
    expect(parseManifest(published()).encryption).toBeUndefined();
  });

  it('reads both values it knows', () => {
    expect(parseManifest(published('age')).encryption).toBe('age');
    expect(parseManifest(published('none')).encryption).toBe('none');
  });

  it('refuses a value it does not know, rather than guessing at the archive', () => {
    for (const value of ['', 'None', 'gpg', 'true', 'aes'])
      expect(() => parseManifest(published(value))).toThrow(
        'Backup manifest is incomplete or invalid.',
      );
  });
});

describe('restoring', () => {
  /** Puts one backup's archives, checksums, and manifest into a store. */
  async function published(
    encryption: 'age' | 'none' | undefined,
  ): Promise<{ key: string; store: MemoryStore }> {
    const store = new MemoryStore();
    const encrypted = encryption !== 'none';
    const keys = backupObjectKeys('production/database', createdAt, encrypted);
    const bodies = {
      [keys.app]: encrypted ? sealed(appDumpBytes) : appDumpBytes,
      [keys.auth]: encrypted ? sealed(authDumpBytes) : authDumpBytes,
    };
    const digest = (body: string): string =>
      createHash('sha256').update(body).digest('hex');
    for (const [key, body] of Object.entries(bodies))
      store.values.set(key, Buffer.from(body));
    store.values.set(
      keys.appChecksum,
      Buffer.from(`${digest(bodies[keys.app] ?? '')}  app\n`),
    );
    store.values.set(
      keys.authChecksum,
      Buffer.from(`${digest(bodies[keys.auth] ?? '')}  auth\n`),
    );
    store.values.set(
      keys.manifest,
      Buffer.from(
        JSON.stringify({
          ...dumpMetadata(),
          ...(encryption === undefined ? {} : { encryption }),
          formatVersion: 2,
          appChecksumObjectKey: keys.appChecksum,
          appEncryptedBytes: Buffer.byteLength(bodies[keys.app] ?? ''),
          appObjectKey: keys.app,
          appSha256: digest(bodies[keys.app] ?? ''),
          authChecksumObjectKey: keys.authChecksum,
          authEncryptedBytes: Buffer.byteLength(bodies[keys.auth] ?? ''),
          authObjectKey: keys.auth,
          authSha256: digest(bodies[keys.auth] ?? ''),
          authTables: [...authTables],
          cliVersion: '3.6.0',
          createdAt: createdAt.toISOString(),
          environment: 'production',
        }),
      ),
    );
    return { key: keys.manifest, store };
  }

  let printed: string[] = [];
  let warnings: string[] = [];
  beforeEach(() => {
    printed = [];
    warnings = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk): boolean => {
      printed.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk): boolean => {
      warnings.push(String(chunk));
      return true;
    });
    return () => vi.restoreAllMocks();
  });

  it('decrypts an encrypted backup with the identity it was given', async () => {
    const { key, store } = await published('age');
    const { calls, programs, runner } = recordingRunner();
    const manifest = await restore({ apply: false, key }, restoreEnv, { runner, store });
    expect(manifest.encryption).toBe('age');
    const decrypts = calls.filter(
      ({ args: used, program }) => program === 'age' && used.includes('--decrypt'),
    );
    expect(decrypts).toHaveLength(2);
    expect(programs()).toContain('pg_restore');
    expect(printed.join('')).toContain('intact and decrypts');
  });

  it('decrypts a backup written before the manifest recorded encryption', async () => {
    const { key, store } = await published(undefined);
    const { calls, runner } = recordingRunner();
    const manifest = await restore({ apply: false, key }, restoreEnv, { runner, store });
    expect(manifest.encryption).toBeUndefined();
    expect(calls.filter(({ program }) => program === 'age')).toHaveLength(2);
  });

  it('reads an unencrypted backup without calling age at all', async () => {
    const { key, store } = await published('none');
    const { programs, runner } = recordingRunner();
    const manifest = await restore(
      { apply: false, key },
      { ...restoreEnv, AGE_IDENTITY: undefined, BACKUP_ENCRYPTION: 'none' },
      { runner, store },
    );
    expect(manifest.encryption).toBe('none');
    expect(programs()).not.toContain('age');
    expect(programs()).toContain('pg_restore');
    expect(printed.join('')).toContain('intact and reads');
  });

  it('refuses an encrypted backup when the run said to expect plaintext', async () => {
    const { key, store } = await published('age');
    const { programs, runner } = recordingRunner();
    await expect(
      restore(
        { apply: false, key },
        { ...restoreEnv, AGE_IDENTITY: undefined, BACKUP_ENCRYPTION: 'none' },
        { runner, store },
      ),
    ).rejects.toThrow('is encrypted, so --age-identity is required');
    expect(programs()).not.toContain('age');
  });

  it('believes the manifest, not the run, when a backup turns out to be plaintext', async () => {
    const { key, store } = await published('none');
    const { programs, runner } = recordingRunner();
    await expect(
      restore({ apply: false, key }, restoreEnv, { runner, store }),
    ).resolves.toMatchObject({ encryption: 'none' });
    expect(programs()).not.toContain('age');
    // Believing it silently is what would hide a bucket full of plaintext.
    expect(warnings.join('')).toContain('is not encrypted');
  });

  it('says a backup is not encrypted however the run asked for it', async () => {
    const { key, store } = await published('none');
    await restore(
      { apply: false, key },
      { ...restoreEnv, AGE_IDENTITY: undefined, BACKUP_ENCRYPTION: 'none' },
      { runner: recordingRunner().runner, store },
    );
    expect(warnings.join('')).toContain(`Backup '${key}' is not encrypted`);
    expect(warnings.join('')).toContain('plaintext database dump');
  });

  it('says nothing of the sort about an encrypted backup', async () => {
    const { key, store } = await published('age');
    await restore({ apply: false, key }, restoreEnv, {
      runner: recordingRunner().runner,
      store,
    });
    expect(warnings.join('')).not.toContain('not encrypted');
  });

  it('writes the archive it downloaded straight to the dump when unencrypted', async () => {
    const { key, store } = await published('none');
    const { calls, runner } = recordingRunner();
    await restore(
      { apply: false, key },
      { ...restoreEnv, AGE_IDENTITY: undefined, BACKUP_ENCRYPTION: 'none' },
      { runner, store },
    );
    const listed = calls.filter(
      ({ args: used, program }) => program === 'pg_restore' && used.includes('--list'),
    );
    expect(listed).toHaveLength(2);
    for (const call of listed) expect(call.args.at(-1)).toMatch(/\.dump$/u);
  });

  it.each(['age', 'none'] as const)(
    'rejects corrupted %s archives during both status and restore',
    async (encryption) => {
      const { key, store } = await published(encryption);
      const manifest = parseManifest(Buffer.from(await store.get(key)).toString('utf8'));
      const damaged = Buffer.from(await store.get(manifest.appObjectKey));
      damaged[0] = ((damaged[0] ?? 0) + 1) % 256;
      store.values.set(manifest.appObjectKey, damaged);
      const { runner, calls } = recordingRunner();
      await expect(getBackupStatus('production/database', store)).rejects.toThrow(
        'checksum verification failed',
      );
      await expect(
        restore(
          { apply: false, key },
          encryption === 'none'
            ? { ...restoreEnv, AGE_IDENTITY: undefined, BACKUP_ENCRYPTION: 'none' }
            : restoreEnv,
          { runner, store },
        ),
      ).rejects.toThrow('checksum verification failed');
      expect(calls).toEqual([{ program: 'pg_restore', args: ['--version'] }]);
    },
  );
});

/** Nothing below reaches a database; the archives are all that is exercised. */
describe('the round trip', () => {
  it('restores what an unencrypted backup stored, byte for byte', async () => {
    const store = new MemoryStore();
    const { runner } = recordingRunner();
    const manifest = await backupWithConfig(backupConfig(undefined), {
      now: createdAt,
      runner,
      store,
    });
    const keys = backupObjectKeys('production/database', createdAt, false);
    const reader = recordingRunner();
    const seen: string[] = [];
    const watching: ProgramRunner = {
      async run(program, used): Promise<string> {
        if (program === 'pg_restore' && used.includes('--list')) {
          const file = used.at(-1) ?? '';
          seen.push(await readFile(file, 'utf8'));
        }
        return reader.runner.run(program, used);
      },
    };
    await restore(
      { apply: false, key: keys.manifest },
      { ...restoreEnv, AGE_IDENTITY: undefined, BACKUP_ENCRYPTION: 'none' },
      { runner: watching, store },
    );
    expect(manifest.encryption).toBe('none');
    expect(seen.sort()).toEqual([appDumpBytes, authDumpBytes].sort());
  });

  it('restores what an encrypted backup stored, through age both ways', async () => {
    const store = new MemoryStore();
    const { runner } = recordingRunner();
    await backupWithConfig(backupConfig('age1recipient'), {
      now: createdAt,
      runner,
      store,
    });
    const keys = backupObjectKeys('production/database', createdAt);
    expect(
      Buffer.from(store.values.get(keys.app) ?? new Uint8Array()).toString('utf8'),
    ).toBe(sealed(appDumpBytes));
    const reader = recordingRunner();
    const seen: string[] = [];
    const watching: ProgramRunner = {
      async run(program, used): Promise<string> {
        if (program === 'pg_restore' && used.includes('--list')) {
          const file = used.at(-1) ?? '';
          seen.push(await readFile(file, 'utf8'));
        }
        return reader.runner.run(program, used);
      },
    };
    await restore({ apply: false, key: keys.manifest }, restoreEnv, {
      runner: watching,
      store,
    });
    expect(seen.sort()).toEqual([appDumpBytes, authDumpBytes].sort());
  });
});

/** Values the CLI hands the loaders, checked end to end through planCommand. */
describe('the flag reaching the configuration', () => {
  it('turns the switch into the opt-out the loaders read', async () => {
    const captured: InputValues[] = [];
    const backupModule = await import('../src/backup/backup.js');
    const spy = vi
      .spyOn(backupModule, 'backup')
      .mockImplementation(async (values): Promise<never> => {
        captured.push(values as InputValues);
        throw new BackupError('Recorded backup call');
      });
    try {
      for (const switches of [[], ['--no-encryption']]) {
        const run = await planCommand(
          args('backup', without('--age-recipient', '--age-identity'), switches),
          new StubPrompter(['age1recipient']),
        );
        await expect(run()).rejects.toThrow('Recorded backup call');
      }
    } finally {
      spy.mockRestore();
    }
    expect(captured[0]?.['BACKUP_ENCRYPTION']).toBeUndefined();
    expect(captured[0]?.['BACKUP_AGE_RECIPIENT']).toBe('age1recipient');
    expect(captured[1]?.['BACKUP_ENCRYPTION']).toBe('none');
    expect(captured[1]?.['BACKUP_AGE_RECIPIENT']).toBeUndefined();
  });
});

describe('backup and restore through the CLI using local storage', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('BACKUP_ENCRYPTION', 'none');
    vi.stubEnv('BACKUP_AGE_RECIPIENT', 'invalid-environment-recipient');
    return () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    };
  });

  it.each([false, true])(
    'stores and restores the correct bytes with plaintext requested: %s, ignoring the environment',
    async (plaintext) => {
      await withTemporaryDirectory(async (root) => {
        const recorder = recordingRunner();
        vi.spyOn(systemRunner, 'run').mockImplementation(recorder.runner.run);
        const common = ['--no-input', '--storage-root', root];
        await runCli([
          'backup',
          ...common,
          '--source-database-url',
          env.SOURCE_DATABASE_URL,
          ...(plaintext ? ['--no-encryption'] : ['--age-recipient', 'age1recipient']),
        ]);
        const store = new LocalStore({ driver: 'local', root });
        const { manifest, manifestKey } = await getBackupStatus(
          'production/database',
          store,
        );
        expect(manifest.encryption).toBe(plaintext ? 'none' : 'age');
        for (const [key, contents] of [
          [manifest.appObjectKey, appDumpBytes],
          [manifest.authObjectKey, authDumpBytes],
        ] as const) {
          expect(key.endsWith('.age')).toBe(!plaintext);
          expect(Buffer.from(await store.get(key)).toString('utf8')).toBe(
            plaintext ? contents : sealed(contents),
          );
        }
        await runCli(['status', ...common]);
        await runCli([
          'restore',
          ...common,
          '--key',
          manifestKey,
          ...(plaintext
            ? ['--no-encryption']
            : ['--age-identity', restoreEnv.AGE_IDENTITY]),
        ]);
        expect(recorder.calls.filter(({ program }) => program === 'age')).toHaveLength(
          plaintext ? 0 : 4,
        );
      });
    },
  );

  it('fails before creating any backup when the flag and recipient are both absent', async () => {
    await withTemporaryDirectory(async (root) => {
      const run = vi.spyOn(systemRunner, 'run');
      await expect(
        runCli([
          'backup',
          '--no-input',
          '--storage-root',
          root,
          '--source-database-url',
          env.SOURCE_DATABASE_URL,
        ]),
      ).rejects.toThrow('--age-recipient is required.');
      expect(run).not.toHaveBeenCalled();
      expect(await new LocalStore({ driver: 'local', root }).list('')).toEqual([]);
    });
  });
});
