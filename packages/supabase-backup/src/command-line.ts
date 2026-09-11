import type { Prompter, PromptStreams } from './prompt.js';
import type { ObjectStore } from './r2.js';
import { backup } from './backup.js';
import { loadStatusConfig } from './config.js';
import { BackupError } from './errors.js';
import {
  ageIdentityField,
  backupFields,
  backupPrefixField,
  chooseManifestKey,
  confirmRestoreTarget,
  fillMissingEnvironment,
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
 * Every value a command needs is resolved before the command starts, so a long
 * run never stops halfway to ask a question, and the prompt is closed before any
 * dump, upload, or restore begins.
 */

/** Options that take the next argument, or an inline `--option=value`. */
const valueOptions = new Set([
  '--confirm-target',
  '--key',
  '--max-age-hours',
  '--prefix',
  '--schemas',
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

Options:
  --prefix <prefix>         Object-key prefix; overrides BACKUP_PREFIX.
  --schemas <a,b>           Application schemas; overrides APP_SCHEMAS.
  --max-age-hours <hours>   Fail status when the newest backup is older.
  --key <manifest-key>      Manifest to restore.
  --apply                   Write to TARGET_DATABASE_URL.
  --confirm-target <label>  Typed confirmation, '<host>:<port>/<database>'.
  --no-input                Never ask; fail when a value is missing.
  -h, --help                Show this help.

Anything not supplied is asked for when the session is a terminal, so a missing
--key offers the newest backups to choose from, and the prefix is asked with the
default 'production/database'. Secrets such as database URLs, R2 credentials,
and the age identity are read only from the environment or a hidden prompt,
never from a flag.`;

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

/** Resolves restore input, then returns the call that performs the restore. */
async function planRestore(
  parsed: CliArguments,
  base: NodeJS.ProcessEnv,
  prompter: Prompter | undefined,
  dependencies: { store?: ObjectStore },
): Promise<() => Promise<unknown>> {
  let env = await fillMissingEnvironment(r2Fields, base, prompter);
  let key = parsed.values.get('--key');
  if (key === undefined) {
    if (!prompter)
      throw new BackupError(
        'restore requires --key <manifest-key> when the session is not a terminal.',
      );
    env = await fillMissingEnvironment([backupPrefixField], env, prompter);
    const config = loadStatusConfig(env);
    const store = dependencies.store || new R2Store(config);
    key = await chooseManifestKey(config.prefix, store, prompter);
  }
  ensureValidManifestKey(key);
  env = await fillMissingEnvironment([ageIdentityField], env, prompter);
  const apply =
    parsed.switches.has('--apply') ||
    (prompter
      ? await prompter.confirm(
          'Apply this backup to the target database? It writes data.',
          false,
        )
      : false);
  let confirmTarget = parsed.values.get('--confirm-target');
  if (apply && prompter) {
    env = await fillMissingEnvironment([targetDatabaseUrlField], env, prompter);
    if (confirmTarget === undefined)
      confirmTarget = await confirmRestoreTarget(
        env['TARGET_DATABASE_URL'] ?? '',
        prompter,
      );
  }
  const options = { key, apply, ...(confirmTarget ? { confirmTarget } : {}) };
  const resolved = env;
  return async () => restore(options, resolved);
}

/** Collects every missing value first, so nothing is asked mid-run. */
export async function planCommand(
  parsed: CliArguments,
  base: NodeJS.ProcessEnv,
  prompter: Prompter | undefined,
  dependencies: { store?: ObjectStore } = {},
): Promise<() => Promise<unknown>> {
  const overrides: NodeJS.ProcessEnv = { ...base };
  const prefix = parsed.values.get('--prefix');
  if (prefix !== undefined) overrides['BACKUP_PREFIX'] = prefix;
  const schemas = parsed.values.get('--schemas');
  if (schemas !== undefined) overrides['APP_SCHEMAS'] = schemas;
  if (parsed.command === 'backup') {
    const env = await fillMissingEnvironment(backupFields, overrides, prompter);
    return async () => backup(env);
  }
  if (parsed.command === 'status') {
    const env = await fillMissingEnvironment(statusFields, overrides, prompter);
    const raw = parsed.values.get('--max-age-hours');
    return async () => status(raw === undefined ? undefined : Number(raw), env);
  }
  if (parsed.command === 'restore')
    return planRestore(parsed, overrides, prompter, dependencies);
  throw new BackupError(usage);
}

/** Executes the package CLI commands. */
export async function runCli(
  args = process.argv.slice(2),
  streams: PromptStreams = { input: process.stdin, output: process.stderr },
  env: NodeJS.ProcessEnv = process.env,
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
    run = await planCommand(parsed, env, prompter);
  } finally {
    prompter?.close();
  }
  await run();
}
