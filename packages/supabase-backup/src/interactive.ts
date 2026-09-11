import type { Prompter } from './prompt.js';
import type { ObjectStore } from './r2.js';
import { databaseLabel, parseDatabaseUrl, restoreTargetRef } from './database-url.js';
import { BackupError } from './errors.js';
import { backupKeyLayoutVersion, manifestObjectName } from './manifest.js';
import { listManifestKeys } from './status.js';
import {
  ensureOpaqueSecret,
  ensureValidAgeIdentity,
  ensureValidAgeRecipient,
  ensureValidBackupPrefix,
  ensureValidManifestKey,
  ensureValidR2Bucket,
  ensureValidR2Endpoint,
  parseAppSchemas,
} from './validation.js';

/**
 * Resolves the values a command needs but was not given.
 *
 * Every value is a flag, and the process environment is never read. What a flag
 * did not supply is asked for when the session is a terminal, which is also the
 * only way to keep a secret out of the process arguments, where it is visible to
 * other processes and is kept in shell history.
 */

export interface InputField {
  defaultValue?: string;
  flag: string;
  name: string;
  question: string;
  secret?: boolean;
  validate?: (value: string) => void;
}

/** Values a command was given or asked for, keyed by configuration name. */
export type InputValues = Record<string, string | undefined>;

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
  question: 'Application schemas to back up, comma separated',
  defaultValue: 'public',
  validate: (value: string): void => {
    parseAppSchemas(value);
  },
};

/** R2 credentials and location, shared by every command. */
export const r2Fields: readonly InputField[] = [
  {
    flag: '--r2-endpoint',
    name: 'R2_ENDPOINT',
    question: 'R2 S3 endpoint (https://<account-id>.r2.cloudflarestorage.com)',
    validate: ensureValidR2Endpoint,
  },
  {
    flag: '--r2-bucket',
    name: 'R2_BUCKET',
    question: 'R2 bucket name',
    validate: ensureValidR2Bucket,
  },
  {
    flag: '--r2-access-key-id',
    name: 'R2_ACCESS_KEY_ID',
    question: 'R2 access key ID',
    secret: true,
    validate: (value: string): void => ensureOpaqueSecret('--r2-access-key-id', value),
  },
  {
    flag: '--r2-secret-access-key',
    name: 'R2_SECRET_ACCESS_KEY',
    question: 'R2 secret access key',
    secret: true,
    validate: (value: string): void =>
      ensureOpaqueSecret('--r2-secret-access-key', value),
  },
];

/** Everything `backup` reads, in the order an operator is asked for it. */
export const backupFields: readonly InputField[] = [
  sourceDatabaseUrlField,
  ageRecipientField,
  ...r2Fields,
  backupPrefixField,
  appSchemasField,
];

/** Everything the read-only health check reads. */
export const statusFields: readonly InputField[] = [...r2Fields, backupPrefixField];

/** Every field any command accepts, which defines the value flags the CLI parses. */
export const allFields: readonly InputField[] = [
  sourceDatabaseUrlField,
  targetDatabaseUrlField,
  ageRecipientField,
  ageIdentityField,
  ...r2Fields,
  backupPrefixField,
  appSchemasField,
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
