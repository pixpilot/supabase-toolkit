import type { CliArguments } from '../src/cli/command-line.js';
import type { InputValues } from '../src/cli/interactive.js';
import type { Prompter, TextPromptOptions } from '../src/cli/prompt.js';
import type { ObjectStore } from '../src/storage/object-store.js';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import {
  cliVersion,
  inputFromArguments,
  parseArguments,
  planCommand,
  usage,
  versionLine,
} from '../src/cli/command-line.js';
import {
  backupFields,
  chooseManifestKey,
  confirmRestoreTarget,
  defaultBackupPrefix,
  describeBackupKey,
  fillMissingInput,
  r2Fields,
  statusFields,
} from '../src/cli/interactive.js';
import { createPrompter, interactiveStreams, isInteractive } from '../src/cli/prompt.js';
import { BackupError } from '../src/core/errors.js';
import { preflightFailureMessage } from '../src/db/auth.js';
import { parseDatabaseUrl, restoreTargetRef } from '../src/db/database-url.js';
import * as restoreModule from '../src/restore/restore.js';
import {
  appRestoreArguments,
  authRestoreArguments,
  filterExistingSchemas,
  restoreFollowUp,
} from '../src/restore/restore.js';

/** The flags a fully specified run passes. */
const connectionFlags: Record<string, string> = {
  '--source-database-url':
    'postgresql://backup:secret@db.example.test:5432/postgres?sslmode=require',
  '--age-recipient': 'age1recipient',
  '--age-identity': 'AGE-SECRET-KEY-1TESTIDENTITY',
  '--r2-access-key-id': 'key',
  '--r2-secret-access-key': 'secret',
  '--r2-endpoint': 'https://account.r2.cloudflarestorage.com',
  '--r2-bucket': 'private-backups',
  '--prefix': 'production/database',
  '--schemas': 'public',
};

/** The same values keyed the way the loaders read them. */
const given: InputValues = inputFromArguments(args('backup', connectionFlags));

/** Records what was asked and replays scripted answers. */
class StubPrompter implements Prompter {
  public readonly asked: string[] = [];
  public closed = false;
  public constructor(
    private readonly answers: string[] = [],
    private readonly confirmations: boolean[] = [],
    private readonly selections: number[] = [],
  ) {}

  public readonly notes: string[] = [];
  public close(): void {
    this.closed = true;
  }

  public note(text: string): void {
    this.notes.push(text);
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

  public async confirm(question: string, defaultValue = false): Promise<boolean> {
    this.asked.push(question);
    return this.confirmations.shift() ?? defaultValue;
  }

  public offered: readonly string[] = [];
  public async select(question: string, choices: readonly string[]): Promise<number> {
    this.asked.push(question);
    this.offered = choices;
    const selected = this.selections.shift() ?? 0;
    if (selected >= choices.length) throw new BackupError('Selection out of range.');
    return selected;
  }
}

/** Minimal in-memory object store for listing manifests. */
class MemoryStore implements ObjectStore {
  public readonly values = new Map<string, Uint8Array>();
  public async get(key: string): Promise<Uint8Array> {
    const value = this.values.get(key);
    if (!value) throw new BackupError(`missing ${key}`);
    return value;
  }

  public async has(key: string): Promise<boolean> {
    return this.values.has(key);
  }

  public async list(prefix: string): Promise<string[]> {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  public async putImmutable(key: string, body: Uint8Array): Promise<void> {
    this.values.set(key, body);
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

/** Streams that look like a terminal without needing a real one. */
function terminalStreams(): {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  written: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer | string) => chunks.push(String(chunk)));
  Object.assign(input, { isTTY: true });
  Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
  return {
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream,
    written: () => chunks.join(''),
  };
}

describe('command-line parsing', () => {
  it('accepts the restore-only advisory opt-out and rejects values or other commands', () => {
    expect(
      parseArguments(['restore', '--no-access-checks']).switches.has(
        '--no-access-checks',
      ),
    ).toBe(true);
    expect(() => parseArguments(['restore', '--no-access-checks=true'])).toThrow(
      'does not take a value',
    );
    expect(() => parseArguments(['backup', '--no-access-checks'])).toThrow(
      'only supported for restore',
    );
    expect(usage).toContain('--no-access-checks');
    expect(usage).toContain('enabled by default');
  });
  it('reads a command, spaced values, inline values, and switches', () => {
    const parsed = parseArguments([
      'restore',
      '--key',
      'production/database/v1/20260101T000000Z/manifest.json',
      '--confirm-target=db.example.test:5432/postgres',
      '--apply',
    ]);
    expect(parsed.command).toBe('restore');
    expect(parsed.values.get('--key')).toBe(
      'production/database/v1/20260101T000000Z/manifest.json',
    );
    expect(parsed.values.get('--confirm-target')).toBe('db.example.test:5432/postgres');
    expect(parsed.switches.has('--apply')).toBe(true);
  });

  it('rejects typos instead of silently changing a run', () => {
    expect(() => parseArguments(['backup', '--unknown'])).toThrow("Unknown option '--");
    expect(() => parseArguments(['restore', '--key'])).toThrow('--key requires a value.');
    expect(() => parseArguments(['restore', '--key', '--apply'])).toThrow(
      '--key requires a value.',
    );
    expect(() => parseArguments(['backup', '--apply=yes'])).toThrow(
      '--apply does not take a value.',
    );
    expect(() => parseArguments(['backup', 'status'])).toThrow(
      "Unexpected argument 'status'.",
    );
  });

  it('documents every command in the usage text', () => {
    expect(usage).toContain('backup');
    expect(usage).toContain('status');
    expect(usage).toContain('restore');
    expect(usage).toContain('--no-input');
  });

  it('reports the release that is actually running', () => {
    // An `npx …@3` run resolves to whichever 3.x is newest that day, so the
    // reported version has to be the one this build shipped.
    expect(cliVersion).toBe(packageJson.version);
    expect(versionLine).toBe(`supabase-backup ${packageJson.version}`);
    expect(usage).toContain('--version');
  });

  it('accepts the version switch without a value', () => {
    expect(parseArguments(['--version']).switches.has('--version')).toBe(true);
    expect(parseArguments(['-v']).switches.has('-v')).toBe(true);
    expect(() => parseArguments(['--version=3'])).toThrow('does not take a value');
  });
});

describe('filling missing values', () => {
  it('asks only for values the flags did not supply', async () => {
    const prompter = new StubPrompter(['staging/database']);
    const filled = await fillMissingInput(
      statusFields,
      { ...given, BACKUP_PREFIX: '' },
      prompter,
    );
    expect(prompter.asked).toHaveLength(1);
    expect(prompter.asked[0]).toContain('prefix');
    expect(filled['BACKUP_PREFIX']).toBe('staging/database');
    expect(filled['R2_BUCKET']).toBe('private-backups');
  });

  it('re-asks after an answer that cannot work', async () => {
    const prompter = new StubPrompter(['not-a-url']);
    await expect(fillMissingInput(r2Fields, {}, prompter)).rejects.toThrow(
      'must be an absolute URL',
    );
  });

  it('offers a visible default that an empty answer accepts', async () => {
    const prompter = new StubPrompter([]);
    const filled = await fillMissingInput(
      backupFields,
      { ...given, BACKUP_PREFIX: '' },
      prompter,
    );
    expect(prompter.asked).toEqual(['Backup object-key prefix']);
    expect(filled['BACKUP_PREFIX']).toBe(defaultBackupPrefix);
  });

  it('never asks for the schema lists, which back up everything when left out', async () => {
    const prompter = new StubPrompter([]);
    const filled = await fillMissingInput(
      backupFields,
      { ...given, APP_SCHEMAS: '', EXCLUDE_SCHEMAS: '' },
      prompter,
    );
    expect(prompter.asked).toEqual([]);
    expect(filled['APP_SCHEMAS']).toBe('');
    expect(filled['EXCLUDE_SCHEMAS']).toBe('');
  });

  it('applies the standard prefix when nothing can be asked', async () => {
    const filled = await fillMissingInput(
      backupFields,
      { ...given, BACKUP_PREFIX: '', APP_SCHEMAS: '' },
      undefined,
    );
    expect(defaultBackupPrefix).toBe('production/database');
    expect(filled['BACKUP_PREFIX']).toBe(defaultBackupPrefix);
    expect(filled['APP_SCHEMAS']).toBe('');
  });

  it('names the missing flag when nothing can be asked', async () => {
    await expect(
      fillMissingInput(statusFields, { ...given, R2_BUCKET: '' }, undefined),
    ).rejects.toThrow('--r2-bucket is required. Pass it,');
  });
});

describe('choosing a backup to restore', () => {
  const store = new MemoryStore();
  const older = 'production/database/v1/20260101T000000Z/manifest.json';
  const newer = 'production/database/v1/20260102T000000Z/manifest.json';
  store.values.set(older, Buffer.from('{}'));
  store.values.set(newer, Buffer.from('{}'));
  store.values.set(
    'production/database/v1/20260102T000000Z/app.dump.age',
    Buffer.from(''),
  );

  it('offers the newest backup first, dated and aged', async () => {
    const prompter = new StubPrompter([], [], [0]);
    const now = new Date('2026-01-03T00:00:00Z');
    await expect(
      chooseManifestKey('production/database', store, prompter, now),
    ).resolves.toBe(newer);
    expect(prompter.offered).toEqual([
      '2026-01-02 00:00 UTC  (24 hours old)  20260102T000000Z',
      '2026-01-01 00:00 UTC  (2 days old)  20260101T000000Z',
      'Enter another manifest key',
    ]);
  });

  it('falls back to the key when a folder is not a backup stamp', () => {
    expect(describeBackupKey('production/database/custom/manifest.json')).toBe(
      'production/database/custom',
    );
  });

  it('accepts a key typed in instead of the listed backups', async () => {
    const prompter = new StubPrompter([older], [], [2]);
    await expect(chooseManifestKey('production/database', store, prompter)).resolves.toBe(
      older,
    );
  });

  it('rejects a typed key that is not an immutable manifest', async () => {
    const prompter = new StubPrompter(['production/database/v1/latest'], [], [2]);
    await expect(
      chooseManifestKey('production/database', store, prompter),
    ).rejects.toThrow('--key must be an immutable backup manifest key ending in .json.');
  });

  it('reports when the prefix holds no backup at all', async () => {
    const prompter = new StubPrompter([], [], [0]);
    await expect(chooseManifestKey('staging/database', store, prompter)).rejects.toThrow(
      "No backup manifest exists under 'staging/database/v1/'.",
    );
  });
});

describe('naming a restore target', () => {
  it('identifies a pooled Supabase project by the reference in its user', () => {
    expect(
      restoreTargetRef(
        parseDatabaseUrl(
          'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
        ),
      ),
    ).toBe('abcdefghijklmnopqrst');
  });

  it('identifies a direct Supabase project by its host', () => {
    expect(
      restoreTargetRef(
        parseDatabaseUrl(
          'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
        ),
      ),
    ).toBe('abcdefghijklmnopqrst');
  });

  it('falls back to the full label when no project reference exists', () => {
    expect(
      restoreTargetRef(
        parseDatabaseUrl('postgresql://backup:secret@db.example.test:5432/recovery'),
      ),
    ).toBe('db.example.test:5432/recovery');
  });
});

describe('confirming a restore target', () => {
  const pooled =
    'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

  it('shows the target, names it in the question, and takes YES', async () => {
    const prompter = new StubPrompter(['YES']);
    await expect(confirmRestoreTarget(pooled, prompter)).resolves.toBe(
      'abcdefghijklmnopqrst',
    );
    expect(prompter.notes.join('\n')).toContain(
      'aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
    );
    expect(prompter.notes.join('\n')).toContain('postgres.abcdefghijklmnopqrst');
    expect(prompter.asked[0]).toBe(
      "Are you sure you want to restore into 'abcdefghijklmnopqrst'? Type YES to continue",
    );
  });

  it('never shows the password of the target it prints', async () => {
    const prompter = new StubPrompter(['YES']);
    await confirmRestoreTarget(pooled, prompter);
    expect(prompter.notes.join('\n')).not.toContain('secret');
  });

  it('refuses anything but YES in capitals', async () => {
    for (const answer of ['yes', 'y', 'abcdefghijklmnopqrst']) {
      const prompter = new StubPrompter([answer]);
      await expect(confirmRestoreTarget(pooled, prompter)).rejects.toThrow(
        "Type YES in capitals to restore into 'abcdefghijklmnopqrst'",
      );
    }
  });
});

describe('planning a command', () => {
  it.each([
    { switches: [], enabled: true },
    { switches: ['--no-access-checks'], enabled: false },
  ])(
    'passes accessChecks=$enabled to the restore operation',
    async ({ switches, enabled }) => {
      const restoreCall = vi
        .spyOn(restoreModule, 'restore')
        .mockRejectedValue(new Error('Recorded restore call'));
      try {
        const run = await planCommand(
          args(
            'restore',
            {
              ...connectionFlags,
              '--key': 'production/database/v1/20260101T000000Z/manifest.json',
            },
            switches,
          ),
          undefined,
        );
        await expect(run()).rejects.toThrow('Recorded restore call');
        expect(restoreCall).toHaveBeenCalledWith(
          expect.objectContaining({ accessChecks: enabled }),
          expect.anything(),
        );
      } finally {
        restoreCall.mockRestore();
      }
    },
  );
  it('keeps configuration flags apart from command flags', () => {
    const parsed = inputFromArguments(
      args('restore', { ...connectionFlags, '--key': 'a/manifest.json' }),
    );
    expect(parsed['R2_BUCKET']).toBe('private-backups');
    expect(parsed['AGE_IDENTITY']).toBe('AGE-SECRET-KEY-1TESTIDENTITY');
    expect(Object.keys(parsed)).not.toContain('--key');
  });

  it('asks for nothing when every value arrives as a flag', async () => {
    const prompter = new StubPrompter();
    await planCommand(args('backup', connectionFlags), prompter);
    expect(prompter.asked).toEqual([]);
  });

  it('asks only for the values the flags left out', async () => {
    const prompter = new StubPrompter(['age1recipient']);
    const { '--age-recipient': _recipient, ...withoutRecipient } = connectionFlags;
    await planCommand(args('backup', withoutRecipient), prompter);
    expect(prompter.asked).toEqual(['age recipient used to encrypt (age1…)']);
  });

  it('picks a backup, then asks for the target and its confirmation', async () => {
    const store = new MemoryStore();
    const key = 'production/database/v1/20260101T000000Z/manifest.json';
    store.values.set(key, Buffer.from('{}'));
    const prompter = new StubPrompter(
      [
        'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
        'YES',
      ],
      [],
      [0],
    );
    const run = await planCommand(args('restore', connectionFlags), prompter, { store });
    expect(prompter.asked).toEqual([
      'Select a backup to restore (newest first):',
      'Target database URL to restore into',
      "Are you sure you want to restore into 'abcdefghijklmnopqrst'? Type YES to continue",
    ]);
    expect(typeof run).toBe('function');
  });

  it('writes nothing without --apply when it cannot ask', async () => {
    const run = await planCommand(
      args('restore', {
        ...connectionFlags,
        '--key': 'production/database/v1/20260101T000000Z/manifest.json',
      }),
      undefined,
    );
    expect(typeof run).toBe('function');
  });

  it('requires --key when the session cannot be asked', async () => {
    await expect(
      planCommand(args('restore', connectionFlags), undefined),
    ).rejects.toThrow('restore needs --key <manifest-key> unless it can ask.');
  });

  it('rejects a manifest key that could escape the backup namespace', async () => {
    await expect(
      planCommand(
        args('restore', { ...connectionFlags, '--key': '../secrets.json' }),
        undefined,
      ),
    ).rejects.toThrow('--key must be an immutable backup manifest key ending in .json.');
  });

  it('requires the typed target when --apply cannot be confirmed at a prompt', async () => {
    await expect(
      planCommand(
        args(
          'restore',
          {
            ...connectionFlags,
            '--key': 'production/database/v1/20260101T000000Z/manifest.json',
            '--target-database-url': 'postgresql://restore:secret@db.test:5432/postgres',
          },
          ['--apply'],
        ),
        undefined,
      ),
    ).rejects.toThrow('--apply requires --confirm-target');
  });

  it('reports usage for an unknown command', async () => {
    await expect(planCommand(args('rollback'), undefined)).rejects.toThrow('Usage:');
  });

  it('offers the storage backends when nothing else says which one to use', async () => {
    const prompter = new StubPrompter(['/srv/backups'], [], [1]);
    await planCommand(args('status'), prompter);
    expect(prompter.offered).toEqual([
      'r2 — Cloudflare R2 bucket over the S3 API.',
      'local — A directory on this machine, or a mounted volume.',
    ]);
    expect(prompter.asked).toEqual([
      'Where are the backups kept?',
      'Directory that holds the backups',
      'Backup object-key prefix',
    ]);
  });

  it('asks the chosen backend own questions and no other backend questions', async () => {
    const prompter = new StubPrompter(
      ['https://account.r2.cloudflarestorage.com', 'private-backups', 'key', 'secret'],
      [],
      [0],
    );
    await planCommand(args('status'), prompter);
    expect(prompter.asked).toEqual([
      'Where are the backups kept?',
      'R2 S3 endpoint (https://<account-id>.r2.cloudflarestorage.com)',
      'R2 bucket name',
      'R2 access key ID',
      'R2 secret access key',
      'Backup object-key prefix',
    ]);
  });

  it('never asks which backend when a flag already settled it', async () => {
    const named = new StubPrompter(['/srv/backups']);
    await planCommand(args('status', { '--storage': 'local' }), named);
    expect(named.asked).toEqual([
      'Directory that holds the backups',
      'Backup object-key prefix',
    ]);

    // A setting that belongs to one backend names it just as well.
    const implied = new StubPrompter();
    await planCommand(args('status', { '--storage-root': '/srv/backups' }), implied);
    expect(implied.asked).toEqual(['Backup object-key prefix']);
  });

  it('offers the command list when a terminal run names no command', async () => {
    const prompter = new StubPrompter(['/srv/backups'], [], [1, 1]);
    const run = await planCommand(args(''), prompter);
    expect(prompter.asked[0]).toBe('What do you want to do?');
    expect(typeof run).toBe('function');
  });

  it('still reports usage for a missing command when it cannot ask', async () => {
    await expect(planCommand(args(''), undefined)).rejects.toThrow('Usage:');
  });
});

describe('restoring into a database', () => {
  it('renders SQL files for one transaction with ownership and privileges intact', () => {
    expect(
      authRestoreArguments('/tmp/users.sql', 'auth.users', '/tmp/auth.dump'),
    ).toEqual([
      '--file',
      '/tmp/users.sql',
      '--data-only',
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--strict-names',
      '--schema=auth',
      '--table=users',
      '/tmp/auth.dump',
    ]);
    expect(appRestoreArguments('/tmp/app.sql', '/tmp/app.dump')).toEqual([
      '--file',
      '/tmp/app.sql',
      '--exit-on-error',
      '/tmp/app.dump',
    ]);
  });

  it('skips creating a schema the target already has, and nothing else', () => {
    const list = [
      ';',
      '; Archive created at 2026-09-11 13:10:38 UTC',
      ';',
      '4; 2615 2200 SCHEMA - public postgres',
      '5; 2615 16398 SCHEMA - billing postgres',
      '218; 1259 16399 TABLE public user_roles postgres',
      '3456; 0 16399 TABLE DATA public user_roles postgres',
      '3460; 3256 16420 POLICY public user_roles Allow auth admin postgres',
    ].join('\n');
    const filtered = filterExistingSchemas(list, ['public']);
    expect(filtered).not.toContain('SCHEMA - public');
    expect(filtered).toContain('SCHEMA - billing');
    expect(filtered).toContain('TABLE public user_roles');
    expect(filtered).toContain('TABLE DATA public user_roles');
    expect(filtered).toContain('POLICY public user_roles');
  });

  it('leaves the table of contents alone when no schema exists yet', () => {
    const list = '4; 2615 2200 SCHEMA - public postgres\n';
    expect(filterExistingSchemas(list, [])).toBe(list);
    expect(filterExistingSchemas(list, ['billing'])).toBe(list);
  });

  it('uses a filtered list only when one was written', () => {
    expect(appRestoreArguments('postgres', '/tmp/app.dump', '/tmp/app.list')).toContain(
      '--use-list',
    );
    expect(appRestoreArguments('postgres', '/tmp/app.dump')).not.toContain('--use-list');
  });

  it('never qualifies the table name, which pg_restore would match against nothing', () => {
    const selected = authRestoreArguments(
      'postgres',
      'auth.identities',
      '/tmp/auth.dump',
    );
    expect(selected).toContain('--table=identities');
    expect(selected).not.toContain('--table=auth.identities');
    expect(selected).toContain('--schema=auth');
    expect(() => authRestoreArguments('postgres', 'users', '/tmp/auth.dump')).toThrow(
      'must be schema-qualified',
    );
  });

  it('tells the operator what a restored database still needs', () => {
    for (const subject of [
      'Access',
      'supabase_auth_admin',
      'Auth Hooks',
      'object metadata are restored',
      'edge functions',
      'signs in again',
    ])
      expect(restoreFollowUp).toContain(subject);
  });

  it('never cleans, because a clean cannot work on a fresh database', () => {
    expect(appRestoreArguments('postgres', '/tmp/app.dump')).not.toContain('--clean');
    expect(appRestoreArguments('postgres', '/tmp/app.dump')).not.toContain('--if-exists');
  });
});

describe('diagnosing a failed preflight connection', () => {
  const target = parseDatabaseUrl(
    'postgresql://postgres:secret@db.abcdefghijklm.supabase.co:5432/postgres',
  );

  it('names the target and the driver reason, without the credentials', () => {
    const message = preflightFailureMessage(
      target,
      Object.assign(new Error('password authentication failed for user "postgres"'), {
        code: '28P01',
      }),
    );
    expect(message).toContain('db.abcdefghijklm.supabase.co:5432/postgres');
    expect(message).toContain('password authentication failed');
    expect(message).not.toContain('secret');
  });

  it('points at the session pooler when a direct Supabase host is unreachable', () => {
    const message = preflightFailureMessage(
      target,
      Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' }),
    );
    expect(message).toContain('Session Pooler');
  });

  it('names the URL parameter when the database serves no TLS', () => {
    const local = parseDatabaseUrl(
      'postgresql://postgres:secret@localhost:54322/postgres',
    );
    const message = preflightFailureMessage(
      local,
      new Error('The server does not support SSL connections'),
    );
    expect(message).toContain('localhost:54322/postgres');
    expect(message).toContain('sslmode=disable');
  });

  it('adds no hint when the host answered', () => {
    const message = preflightFailureMessage(
      target,
      Object.assign(new Error('database "postgres" does not exist'), { code: '3D000' }),
    );
    expect(message).not.toContain('Session Pooler');
  });
});

describe('terminal prompting', () => {
  it('draws on stdout when only stderr is redirected', () => {
    const terminal = terminalStreams();
    const redirected = new PassThrough() as unknown as NodeJS.WriteStream;
    expect(interactiveStreams(terminal.input, [redirected, terminal.output])).toEqual({
      input: terminal.input,
      output: terminal.output,
    });
    expect(interactiveStreams(terminal.input, [redirected])).toBeUndefined();
    expect(
      interactiveStreams(new PassThrough() as unknown as NodeJS.ReadStream, [
        terminal.output,
      ]),
    ).toBeUndefined();
  });

  it('is unavailable when either stream is not a terminal', () => {
    const streams = terminalStreams();
    expect(isInteractive(streams)).toBe(true);
    expect(
      isInteractive({
        input: new PassThrough() as unknown as NodeJS.ReadStream,
        output: streams.output,
      }),
    ).toBe(false);
    expect(() =>
      createPrompter({
        input: new PassThrough() as unknown as NodeJS.ReadStream,
        output: streams.output,
      }),
    ).toThrow('Interactive input is unavailable outside a terminal.');
  });

  it('reads a plain answer and echoes what was typed', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.text('Backup prefix');
    streams.input.write('production/database\n');
    await expect(answer).resolves.toBe('production/database');
    expect(streams.written()).toContain('Backup prefix');
    expect(streams.written()).toContain('production/database');
    prompter.close();
  });

  it('never echoes a secret answer', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.text('R2 secret access key', { secret: true });
    streams.input.write('super-secret-value\n');
    await expect(answer).resolves.toBe('super-secret-value');
    expect(streams.written()).toContain('R2 secret access key');
    expect(streams.written()).not.toContain('super-secret-value');
    prompter.close();
  });

  it('shows a visible default and accepts it on an empty answer', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.text('Backup object-key prefix', {
      defaultValue: defaultBackupPrefix,
    });
    streams.input.write('\n');
    await expect(answer).resolves.toBe(defaultBackupPrefix);
    expect(streams.written()).toContain('[production/database]');
    prompter.close();
  });

  it('never prints the default of a secret, and keeps the answer as entered', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.text('age identity', {
      secret: true,
      defaultValue: 'AGE-SECRET-KEY-1FALLBACK',
    });
    streams.input.write('  AGE-SECRET-KEY-1TYPED  \n');
    await expect(answer).resolves.toBe('  AGE-SECRET-KEY-1TYPED  ');
    expect(streams.written()).not.toContain('AGE-SECRET-KEY-1FALLBACK');
    prompter.close();
  });

  it('reports a cancelled prompt when the input ends before an answer', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.text('Backup prefix');
    prompter.close();
    await expect(answer).rejects.toThrow('Prompt cancelled.');
  });

  it('keeps the real reason when the failure is not a cancellation', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.text('Backup prefix');
    streams.input.write(`${'x'.repeat(5000)}\n`);
    await expect(answer).rejects.toThrow('Answer exceeds 4096 characters');
    prompter.close();
  });

  it('treats an empty confirmation as the safe default', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.confirm('Apply?', false);
    streams.input.write('\n');
    await expect(answer).resolves.toBe(false);
    prompter.close();
  });

  it('returns the chosen entry of a list', async () => {
    const streams = terminalStreams();
    const prompter = createPrompter(streams);
    const answer = prompter.select('Pick one:', ['first', 'second']);
    streams.input.write('2\n');
    await expect(answer).resolves.toBe(1);
    prompter.close();
  });
});
