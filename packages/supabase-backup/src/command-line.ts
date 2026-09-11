import type { InputValues } from './interactive.js';
import type { Prompter, PromptStreams } from './prompt.js';
import type { ObjectStore } from './r2.js';
import { backup } from './backup.js';
import { loadStatusConfig } from './config.js';
import { BackupError } from './errors.js';
import {
  ageIdentityField,
  allFields,
  backupFields,
  backupPrefixField,
  chooseManifestKey,
  confirmRestoreTarget,
  fillMissingInput,
  r2Fields,
  statusFields,
  targetDatabaseUrlField,
} from './interactive.js';
import { createPrompter, isInteractive } from './prompt.js';
import { R2Store } from './r2.js';
import { restore } from './restore.js';
import { status } from './status.js';
import { ensureValidManifestKey } from './validation.js';

/**
 * Command-line parsing and input resolution.
 *
 * Configuration comes from flags only; the process environment is never read.
 * Every value a command needs is resolved before the command starts, so a long
 * run never stops halfway to ask a question, and the prompt is closed before any
 * dump, upload, or restore begins.
 */

/** Configuration flags, mapped to the value each one fills. */
const configurationFlags = new Map(allFields.map((field) => [field.flag, field.name]));

/** Options that take the next argument, or an inline `--option=value`. */
const valueOptions = new Set([
  ...configurationFlags.keys(),
  '--confirm-target',
  '--key',
  '--max-age-hours',
]);

/** Options that are present or absent and never carry a value. */
const switchOptions = new Set(['--apply', '--no-input', '--help', '-h']);

export interface CliArguments {
  command: string;
  switches: Set<string>;
  values: Map<string, string>;
}

export const usage = `Usage: supabase-backup <backup|status|restore> [options]

Commands:
  backup     Dump, encrypt, and upload one immutable backup folder.
  status     Verify the newest backup exists and is recent enough.
  restore    Verify a backup, and write to a database only when asked.

Connection options:
  --r2-endpoint <url>           https://<account-id>.r2.cloudflarestorage.com
  --r2-bucket <name>            Private bucket holding the backups.
  --r2-access-key-id <id>       R2 access key ID.
  --r2-secret-access-key <key>  R2 secret access key.
  --source-database-url <url>   Database to back up.
  --target-database-url <url>   Database to restore into.
  --age-recipient <age1…>       Public recipient used to encrypt a backup.
  --age-identity <AGE-SECRET…>  Private identity used to decrypt a backup.

Command options:
  --prefix <prefix>             Object-key prefix. Default: production/database.
  --schemas <a,b>               Application schemas. Default: public.
  --max-age-hours <hours>       Fail status when the newest backup is older.
  --key <manifest-key>          Manifest to restore.
  --apply                       Write to the target database.
  --confirm-target <label>      Typed confirmation, '<host>:<port>/<database>'.
  --no-input                    Never ask; fail when a value is missing.
  -h, --help                    Show this help.

The environment is never read. Anything not passed is asked for when the session
is a terminal, so a missing --key offers the newest backups to choose from. A
secret given as a flag is visible to other processes and is kept in shell
history; answering the prompt instead keeps it out of both.`;

/** Parses argv strictly, so a typo fails instead of silently changing a run. */
export function parseArguments(args: readonly string[]): CliArguments {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  let command = '';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? '';
    if (!argument.startsWith('-')) {
      if (command) throw new BackupError(`Unexpected argument '${argument}'.`);
      command = argument;
      continue;
    }
    const separator = argument.indexOf('=');
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? undefined : argument.slice(separator + 1);
    if (switchOptions.has(name)) {
      if (inline !== undefined) throw new BackupError(`${name} does not take a value.`);
      switches.add(name);
      continue;
    }
    if (!valueOptions.has(name)) throw new BackupError(`Unknown option '${name}'.`);
    const value = inline ?? args[index + 1];
    if (value === undefined || (inline === undefined && value.startsWith('-')))
      throw new BackupError(`${name} requires a value.`);
    if (inline === undefined) index += 1;
    values.set(name, value);
  }
  return { command, values, switches };
}

/** Collects the configuration flags that were actually passed. */
export function inputFromArguments(parsed: CliArguments): InputValues {
  const values: InputValues = {};
  for (const [flag, name] of configurationFlags) {
    const value = parsed.values.get(flag);
    if (value !== undefined) values[name] = value;
  }
  return values;
}

/** Resolves restore input, then returns the call that performs the restore. */
async function planRestore(
  parsed: CliArguments,
  given: InputValues,
  prompter: Prompter | undefined,
  dependencies: { store?: ObjectStore },
): Promise<() => Promise<unknown>> {
  let values = await fillMissingInput(r2Fields, given, prompter);
  let key = parsed.values.get('--key');
  if (key === undefined) {
    if (!prompter)
      throw new BackupError(
        'restore requires --key <manifest-key> when the session is not a terminal.',
      );
    values = await fillMissingInput([backupPrefixField], values, prompter);
    const config = loadStatusConfig(values);
    const store = dependencies.store || new R2Store(config);
    key = await chooseManifestKey(config.prefix, store, prompter);
  }
  ensureValidManifestKey(key);
  values = await fillMissingInput([ageIdentityField], values, prompter);
  const apply =
    parsed.switches.has('--apply') ||
    (prompter
      ? await prompter.confirm(
          'Apply this backup to the target database? It writes data.',
          false,
        )
      : false);
  let confirmTarget = parsed.values.get('--confirm-target');
  if (apply) {
    values = await fillMissingInput([targetDatabaseUrlField], values, prompter);
    if (confirmTarget === undefined) {
      if (!prompter)
        throw new BackupError(
          "--apply requires --confirm-target '<host>:<port>/<database>'.",
        );
      confirmTarget = await confirmRestoreTarget(
        values['TARGET_DATABASE_URL'] ?? '',
        prompter,
      );
    }
  }
  const options = { key, apply, ...(confirmTarget ? { confirmTarget } : {}) };
  const resolved = values;
  return async () => restore(options, resolved);
}

/** Collects every missing value first, so nothing is asked mid-run. */
export async function planCommand(
  parsed: CliArguments,
  prompter: Prompter | undefined,
  dependencies: { store?: ObjectStore } = {},
): Promise<() => Promise<unknown>> {
  const given = inputFromArguments(parsed);
  if (parsed.command === 'backup') {
    const values = await fillMissingInput(backupFields, given, prompter);
    return async () => backup(values);
  }
  if (parsed.command === 'status') {
    const values = await fillMissingInput(statusFields, given, prompter);
    const raw = parsed.values.get('--max-age-hours');
    return async () => status(raw === undefined ? undefined : Number(raw), values);
  }
  if (parsed.command === 'restore')
    return planRestore(parsed, given, prompter, dependencies);
  throw new BackupError(usage);
}

/** Executes the package CLI commands. */
export async function runCli(
  args = process.argv.slice(2),
  streams: PromptStreams = { input: process.stdin, output: process.stderr },
): Promise<void> {
  const parsed = parseArguments(args);
  if (parsed.switches.has('--help') || parsed.switches.has('-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const prompter =
    parsed.switches.has('--no-input') || !isInteractive(streams)
      ? undefined
      : createPrompter(streams);
  let run: () => Promise<unknown>;
  try {
    run = await planCommand(parsed, prompter);
  } finally {
    prompter?.close();
  }
  await run();
}
