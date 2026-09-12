import type { ObjectStore, StorageDriver } from '../storage/object-store.js';
import type { InputValues } from './interactive.js';
import type { Prompter, PromptStreams } from './prompt.js';
import packageJson from '../../package.json' with { type: 'json' };
import { backup } from '../backup/backup.js';
import { loadStatusConfig } from '../core/config.js';
import { BackupError } from '../core/errors.js';
import { ensureValidManifestKey } from '../core/validation.js';
import { restore } from '../restore/restore.js';
import { status } from '../status/status.js';
import {
  createObjectStore,
  hasStorageSettings,
  readStorageDriver,
  storageFields,
} from '../storage/create-object-store.js';
import {
  ageIdentityField,
  allFields,
  backupFieldsFor,
  backupPrefixField,
  chooseManifestKey,
  chooseStorageDriver,
  confirmRestoreTarget,
  fillMissingInput,
  statusFieldsFor,
  targetDatabaseUrlField,
} from './interactive.js';
import { createPrompter, interactiveStreams } from './prompt.js';

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
const switchOptions = new Set([
  '--apply',
  '--no-input',
  '--no-access-checks',
  '--help',
  '-h',
  '--version',
  '-v',
]);

/**
 * The release actually running, which is not always the one that was asked for.
 *
 * An `npx …@3` invocation resolves to whatever the newest 3.x is on the day it
 * runs, so the version is reported on every run: a log months old then still
 * says which release wrote that backup, and a run that picked up a newer one
 * says so before it starts.
 */
export const cliVersion = packageJson.version;

/** The line every run prints before it starts work. */
export const versionLine = `supabase-backup ${cliVersion}`;

export interface CliArguments {
  command: string;
  switches: Set<string>;
  values: Map<string, string>;
}

export const usage = `Usage: supabase-backup <backup|status|restore> [options]

Commands:
  backup     Dump, encrypt, and upload one immutable backup folder.
  status     Verify the newest encrypted archives and their age.
  restore    Verify a backup, and write to a database only when asked.

Storage options:
  --storage <r2|local>          Where backups are kept. Default: r2.
  --r2-endpoint <url>           r2: https://<account-id>.r2.cloudflarestorage.com
  --r2-bucket <name>            r2: private bucket holding the backups.
  --r2-access-key-id <id>       r2: access key ID.
  --r2-secret-access-key <key>  r2: secret access key.
  --storage-root <dir>          local: directory that holds the backups.

Connection options:
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
  --no-access-checks             Skip advisory default-grant and role-membership
                                checks after restore (enabled by default).
  --confirm-target <ref>        Typed confirmation: the Supabase project ref,
                                or '<host>:<port>/<database>' elsewhere.
  --no-input                    Never ask; fail when a value is missing.
  -v, --version                 Print the version that is running.
  -h, --help                    Show this help.

Only the selected backend's storage options are required or asked for, so an
--storage local run never asks for R2 credentials. Passing an option that belongs
to one backend selects it, so --storage-root alone is enough to mean local. A
terminal run that passes no storage option at all is offered the list to pick
from, and one that names no command is offered the commands.

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
  if (switches.has('--no-access-checks') && command !== 'restore')
    throw new BackupError('--no-access-checks is only supported for restore.');
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

/** The commands offered when a session is asked which one to run. */
const commands = ['backup', 'status', 'restore'] as const;

/** Lists the commands and returns the one the operator picked. */
async function chooseCommand(prompter: Prompter): Promise<string> {
  const choice = await prompter.select('What do you want to do?', [
    'backup — dump, encrypt, and upload one immutable backup folder',
    'status — verify the newest encrypted archives and their age',
    'restore — verify a backup, and write to a database only when asked',
  ]);
  return commands[choice] ?? '';
}

/**
 * Names the backend to use, asking only when nothing else settles it.
 *
 * A run that passed --storage, or any setting belonging to one backend, has
 * already answered the question and is not asked it again.
 */
async function resolveStorageDriver(
  given: InputValues,
  prompter: Prompter | undefined,
): Promise<StorageDriver> {
  if (prompter && !hasStorageSettings(given)) return chooseStorageDriver(prompter);
  return readStorageDriver(given);
}

/** Resolves restore input, then returns the call that performs the restore. */
async function planRestore(
  parsed: CliArguments,
  given: InputValues,
  driver: StorageDriver,
  prompter: Prompter | undefined,
  dependencies: { store?: ObjectStore },
): Promise<() => Promise<unknown>> {
  let values = await fillMissingInput(storageFields(driver), given, prompter);
  let key = parsed.values.get('--key');
  if (key === undefined) {
    if (!prompter)
      throw new BackupError(
        'restore needs --key <manifest-key> unless it can ask. Run it in an interactive terminal without --no-input to pick from the newest backups, or pass --key.',
      );
    values = await fillMissingInput([backupPrefixField], values, prompter);
    const config = loadStatusConfig(values);
    const store = dependencies.store || createObjectStore(config);
    key = await chooseManifestKey(config.prefix, store, prompter);
  }
  ensureValidManifestKey(key);
  values = await fillMissingInput([ageIdentityField], values, prompter);
  /*
   * Someone sitting at the prompt came here to restore, so they are asked for a
   * target and made to confirm it, rather than asked whether they meant it. An
   * unattended run still writes nothing until --apply says so, which is how it
   * verifies an archive without a database.
   */
  const apply = parsed.switches.has('--apply') || Boolean(prompter);
  let confirmTarget = parsed.values.get('--confirm-target');
  if (apply) {
    values = await fillMissingInput([targetDatabaseUrlField], values, prompter);
    if (confirmTarget === undefined) {
      if (!prompter)
        throw new BackupError(
          '--apply requires --confirm-target, naming the target as the restore would ask for it: the Supabase project reference, or <host>:<port>/<database> for any other database.',
        );
      confirmTarget = await confirmRestoreTarget(
        values['TARGET_DATABASE_URL'] ?? '',
        prompter,
      );
    }
  }
  const options = {
    key,
    apply,
    accessChecks: !parsed.switches.has('--no-access-checks'),
    ...(confirmTarget ? { confirmTarget } : {}),
  };
  const resolved = values;
  return async () => restore(options, resolved);
}

/** Collects every missing value first, so nothing is asked mid-run. */
export async function planCommand(
  parsed: CliArguments,
  prompter: Prompter | undefined,
  dependencies: { store?: ObjectStore } = {},
): Promise<() => Promise<unknown>> {
  const command =
    parsed.command || (prompter ? await chooseCommand(prompter) : parsed.command);
  const driver = await resolveStorageDriver(inputFromArguments(parsed), prompter);
  // The chosen backend travels with the values, so loading the config later
  // reads the settings of the backend this run actually selected.
  const given: InputValues = { ...inputFromArguments(parsed), STORAGE_DRIVER: driver };
  if (command === 'backup') {
    const values = await fillMissingInput(backupFieldsFor(driver), given, prompter);
    return async () => backup(values);
  }
  if (command === 'status') {
    const values = await fillMissingInput(statusFieldsFor(driver), given, prompter);
    const raw = parsed.values.get('--max-age-hours');
    return async () => status(raw === undefined ? undefined : Number(raw), values);
  }
  if (command === 'restore')
    return planRestore(parsed, given, driver, prompter, dependencies);
  throw new BackupError(usage);
}

/** Executes the package CLI commands. */
export async function runCli(
  args = process.argv.slice(2),
  streams: PromptStreams | undefined = interactiveStreams(),
): Promise<void> {
  const parsed = parseArguments(args);
  if (parsed.switches.has('--version') || parsed.switches.has('-v')) {
    process.stdout.write(`${versionLine}\n`);
    return;
  }
  if (parsed.switches.has('--help') || parsed.switches.has('-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  // Written to stderr so command output stays machine readable.
  process.stderr.write(`${versionLine}\n`);
  const prompter =
    parsed.switches.has('--no-input') || !streams ? undefined : createPrompter(streams);
  let run: () => Promise<unknown>;
  try {
    run = await planCommand(parsed, prompter);
  } finally {
    prompter?.close();
  }
  await run();
}
