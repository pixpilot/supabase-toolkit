import type { CliArguments } from '../src/command-line.js';
import type { InputValues } from '../src/interactive.js';
import type { Prompter, TextPromptOptions } from '../src/prompt.js';
import type { ObjectStore } from '../src/r2.js';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  inputFromArguments,
  parseArguments,
  planCommand,
  usage,
} from '../src/command-line.js';
import { BackupError } from '../src/errors.js';
import {
  backupFields,
  chooseManifestKey,
  confirmRestoreTarget,
  defaultBackupPrefix,
  describeBackupKey,
  fillMissingInput,
  r2Fields,
  statusFields,
} from '../src/interactive.js';
import { createPrompter, isInteractive } from '../src/prompt.js';

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

  public close(): void {
    this.closed = true;
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
      { ...given, APP_SCHEMAS: '' },
      prompter,
    );
    expect(prompter.asked).toEqual(['Application schemas to back up, comma separated']);
    expect(filled['APP_SCHEMAS']).toBe('public');
  });

  it('applies the standard prefix and schemas when nothing can be asked', async () => {
    const filled = await fillMissingInput(
      backupFields,
      { ...given, BACKUP_PREFIX: '', APP_SCHEMAS: '' },
      undefined,
    );
    expect(defaultBackupPrefix).toBe('production/database');
    expect(filled['BACKUP_PREFIX']).toBe(defaultBackupPrefix);
    expect(filled['APP_SCHEMAS']).toBe('public');
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
    expect(describeBackupKey('production/database/legacy/manifest.json')).toBe(
      'production/database/legacy',
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

describe('confirming a restore target', () => {
  it('returns the label the operator retyped', async () => {
    const prompter = new StubPrompter(['db.example.test:5432/postgres']);
    await expect(
      confirmRestoreTarget(
        'postgresql://backup:secret@db.example.test:5432/postgres',
        prompter,
      ),
    ).resolves.toBe('db.example.test:5432/postgres');
  });

  it('refuses a label that does not match the target exactly', async () => {
    const prompter = new StubPrompter(['db.example.test:5432/wrong']);
    await expect(
      confirmRestoreTarget(
        'postgresql://backup:secret@db.example.test:5432/postgres',
        prompter,
      ),
    ).rejects.toThrow(
      "Restore confirmation must exactly equal 'db.example.test:5432/postgres'.",
    );
  });
});

describe('planning a command', () => {
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

  it('asks which backup to restore when --key is absent', async () => {
    const store = new MemoryStore();
    const key = 'production/database/v1/20260101T000000Z/manifest.json';
    store.values.set(key, Buffer.from('{}'));
    const prompter = new StubPrompter([], [false], [0]);
    const run = await planCommand(args('restore', connectionFlags), prompter, { store });
    expect(prompter.asked).toEqual([
      'Select a backup to restore (newest first):',
      'Apply this backup to the target database? It writes data.',
    ]);
    expect(typeof run).toBe('function');
  });

  it('requires --key when the session cannot be asked', async () => {
    await expect(
      planCommand(args('restore', connectionFlags), undefined),
    ).rejects.toThrow(
      'restore requires --key <manifest-key> when the session is not a terminal.',
    );
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
    ).rejects.toThrow("--apply requires --confirm-target '<host>:<port>/<database>'.");
  });

  it('reports usage for an unknown command', async () => {
    await expect(planCommand(args('rollback'), undefined)).rejects.toThrow('Usage:');
  });
});

describe('terminal prompting', () => {
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
