import type { InputField, InputValues } from '../core/input.js';
import type { ObjectStore, StorageDriver } from '../storage/object-store.js';
import type { Prompter } from './prompt.js';
import { BackupError } from '../core/errors.js';
import { backupKeyLayoutVersion, manifestObjectName } from '../core/manifest.js';
import {
  ensureValidAgeIdentity,
  ensureValidAgeRecipient,
  ensureValidBackupPrefix,
  ensureValidManifestKey,
  parseAppSchemas,
  parseSchemaList,
} from '../core/validation.js';
import { databaseLabel, parseDatabaseUrl, restoreTargetRef } from '../db/database-url.js';
import { listManifestKeys } from '../status/status.js';
import { storageAdapters } from '../storage/adapters/index.js';
import {
  allStorageFields,
  defaultStorageDriver,
  storageFields,
} from '../storage/create-object-store.js';
import { storageDrivers } from '../storage/object-store.js';

export type { InputField, InputValues } from '../core/input.js';
/** R2 credentials and location, kept here as the name earlier releases exported. */
export { r2Fields } from '../storage/adapters/r2-store.js';

/**
 * Resolves the values a command needs but was not given.
 *
 * Every value is a flag, and the process environment is never read. What a flag
 * did not supply is asked for when the session is a terminal, which is also the
 * only way to keep a secret out of the process arguments, where it is visible to
 * other processes and is kept in shell history.
 */

/** Backups listed before the manual-entry choice when picking a restore. */
const maximumListedBackups = 10;

/** Prefix used when `--prefix` is absent. */
export const defaultBackupPrefix = 'production/database';

export const sourceDatabaseUrlField: InputField = {
  flag: '--source-database-url',
  name: 'SOURCE_DATABASE_URL',
  question: 'Source database URL (postgresql://user:password@host:5432/postgres)',
  secret: true,
  validate: (value: string): void => {
    parseDatabaseUrl(value);
  },
};

export const targetDatabaseUrlField: InputField = {
  flag: '--target-database-url',
  name: 'TARGET_DATABASE_URL',
  question: 'Target database URL to restore into',
  secret: true,
  validate: (value: string): void => {
    parseDatabaseUrl(value);
  },
};

export const backupPrefixField: InputField = {
  flag: '--prefix',
  name: 'BACKUP_PREFIX',
  question: 'Backup object-key prefix',
  defaultValue: defaultBackupPrefix,
  validate: (value: string): void =>
    ensureValidBackupPrefix(value.replace(/^\/+|\/+$/gu, '')),
};

export const ageIdentityField: InputField = {
  flag: '--age-identity',
  name: 'AGE_IDENTITY',
  question: 'age identity used to decrypt (AGE-SECRET-KEY-1…)',
  secret: true,
  validate: ensureValidAgeIdentity,
};

export const ageRecipientField: InputField = {
  flag: '--age-recipient',
  name: 'BACKUP_AGE_RECIPIENT',
  question: 'age recipient used to encrypt (age1…)',
  validate: ensureValidAgeRecipient,
};

export const appSchemasField: InputField = {
  flag: '--schemas',
  name: 'APP_SCHEMAS',
  question:
    'Schemas to back up, comma separated (empty backs up every schema the project owns)',
  optional: true,
  validate: (value: string): void => {
    parseAppSchemas(value);
  },
};

export const excludedSchemasField: InputField = {
  flag: '--exclude-schemas',
  name: 'EXCLUDE_SCHEMAS',
  question: 'Schemas to leave out, comma separated (empty leaves nothing out)',
  optional: true,
  validate: (value: string): void => {
    parseSchemaList(value);
  },
};

/**
 * Everything `backup` reads, in the order an operator is asked for it.
 *
 * The storage settings come from the selected backend rather than from a fixed
 * list, so a run is only ever asked for the ones that backend uses.
 */
export function backupFieldsFor(driver: StorageDriver): readonly InputField[] {
  return [
    sourceDatabaseUrlField,
    ageRecipientField,
    ...storageFields(driver),
    backupPrefixField,
    appSchemasField,
    excludedSchemasField,
  ];
}

/** Everything the read-only health check reads from the selected backend. */
export function statusFieldsFor(driver: StorageDriver): readonly InputField[] {
  return [...storageFields(driver), backupPrefixField];
}

/** Everything `backup` reads on the default R2 backend. */
export const backupFields: readonly InputField[] = backupFieldsFor('r2');

/** Everything the read-only health check reads on the default R2 backend. */
export const statusFields: readonly InputField[] = statusFieldsFor('r2');

/**
 * Every field any command accepts, which defines the value flags the CLI parses.
 *
 * Every backend's flags are parsed, whichever one a run selects; only the
 * selected backend's are ever required or asked for.
 */
export const allFields: readonly InputField[] = [
  sourceDatabaseUrlField,
  targetDatabaseUrlField,
  ageRecipientField,
  ageIdentityField,
  ...allStorageFields,
  backupPrefixField,
  appSchemasField,
  excludedSchemasField,
];

/** Returns a copy of the values with every missing field asked for. */
export async function fillMissingInput(
  fields: readonly InputField[],
  values: InputValues,
  prompter: Prompter | undefined,
): Promise<InputValues> {
  const filled: InputValues = { ...values };
  for (const field of fields) {
    if (filled[field.name]?.trim()) continue;
    if (field.optional === true) continue;
    if (!prompter) {
      if (field.defaultValue !== undefined) {
        filled[field.name] = field.defaultValue;
        continue;
      }
      throw new BackupError(
        `${field.flag} is required. Pass it, or run the command in an interactive terminal to be asked for it.`,
      );
    }
    filled[field.name] = await prompter.text(field.question, {
      ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
      ...(field.secret === undefined ? {} : { secret: field.secret }),
      ...(field.validate === undefined ? {} : { validate: field.validate }),
    });
  }
  return filled;
}

/** Matches the compact UTC folder name one backup is written under. */
const backupStamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u;

/** States an age in the largest unit that still reads precisely. */
function ageLabel(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} old`;
  return `${Math.floor(hours / 24)} days old`;
}

/** Describes one manifest key as a line an operator can compare at a glance. */
export function describeBackupKey(key: string, now = new Date()): string {
  const folder = key.endsWith(`/${manifestObjectName}`)
    ? key.slice(0, -(manifestObjectName.length + 1))
    : key;
  const stamp = folder.split('/').at(-1) ?? folder;
  const parts = backupStamp.exec(stamp);
  if (!parts) return folder;
  const [, year, month, day, hour, minute, second] = parts;
  const created = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  const age = now.getTime() - created.getTime();
  if (!Number.isFinite(age) || age < 0) return stamp;
  return `${year}-${month}-${day} ${hour}:${minute} UTC  (${ageLabel(age)})  ${stamp}`;
}

/**
 * Lists the storage backends and returns the one the operator picked.
 *
 * Only reached when nothing else settled the question: a run that named a
 * backend, or gave settings that belong to one, is never asked.
 */
export async function chooseStorageDriver(prompter: Prompter): Promise<StorageDriver> {
  const choice = await prompter.select(
    'Where are the backups kept?',
    storageDrivers.map((driver) => `${driver} — ${storageAdapters[driver].summary}`),
  );
  return storageDrivers[choice] ?? defaultStorageDriver;
}

/** Lists the newest backups and returns the manifest key the operator picked. */
export async function chooseManifestKey(
  prefix: string,
  store: ObjectStore,
  prompter: Prompter,
  now = new Date(),
): Promise<string> {
  const keys = await listManifestKeys(prefix, store);
  if (!keys.length) {
    throw new BackupError(
      `No backup manifest exists under '${prefix}/${backupKeyLayoutVersion}/'.`,
    );
  }
  const listed = keys.slice(0, maximumListedBackups);
  const choice = await prompter.select('Select a backup to restore (newest first):', [
    ...listed.map((key) => describeBackupKey(key, now)),
    'Enter another manifest key',
  ]);
  const selected = listed[choice];
  if (selected !== undefined) return selected;
  return prompter.text('Manifest key', { validate: ensureValidManifestKey });
}

/** The word that has to be typed out before a restore writes anything. */
const confirmationWord = 'YES';

/**
 * Shows what is about to be overwritten, then asks for a deliberate yes.
 *
 * The target is printed rather than retyped: a Supabase pooler host is shared by
 * every project in its region, so retyping it would confirm nothing, and the
 * project reference on screen is what says which database this is. Typing a word
 * in full is the part a reflex keypress cannot do.
 *
 * Returns the reference, which is what `--confirm-target` carries when the same
 * restore runs unattended.
 */
export async function confirmRestoreTarget(
  targetUrl: string,
  prompter: Prompter,
): Promise<string> {
  const connection = parseDatabaseUrl(targetUrl);
  const reference = restoreTargetRef(connection);
  prompter.note(`Restore target: ${databaseLabel(connection)}`);
  prompter.note(`                user ${connection.user}`);
  await prompter.text(
    `Are you sure you want to restore into '${reference}'? Type ${confirmationWord} to continue`,
    {
      validate: (value: string): void => {
        if (value !== confirmationWord)
          throw new BackupError(
            `Type ${confirmationWord} in capitals to restore into '${reference}', or press Ctrl-C to stop.`,
          );
      },
    },
  );
  return reference;
}
