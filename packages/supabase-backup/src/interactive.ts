import type { Prompter } from './prompt.js';
import type { ObjectStore } from './r2.js';
import { databaseLabel, parseDatabaseUrl } from './database-url.js';
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
        `${field.flag} is required. Pass it, or run the command in a terminal to be asked for it.`,
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

/** Lists the newest backups and returns the manifest key the operator picked. */
export async function chooseManifestKey(
  prefix: string,
  store: ObjectStore,
  prompter: Prompter,
): Promise<string> {
  const keys = await listManifestKeys(prefix, store);
  if (!keys.length) {
    throw new BackupError(
      `No backup manifest exists under '${prefix}/${backupKeyLayoutVersion}/'.`,
    );
  }
  const listed = keys.slice(0, maximumListedBackups);
  const suffix = `/${manifestObjectName}`;
  const choice = await prompter.select('Select a backup to restore (newest first):', [
    ...listed.map((key) => key.slice(0, -suffix.length)),
    'Enter another manifest key',
  ]);
  const selected = listed[choice];
  if (selected !== undefined) return selected;
  return prompter.text('Manifest key', { validate: ensureValidManifestKey });
}

/** Requires the operator to retype the target label before a destructive apply. */
export async function confirmRestoreTarget(
  targetUrl: string,
  prompter: Prompter,
): Promise<string> {
  const label = databaseLabel(parseDatabaseUrl(targetUrl));
  return prompter.text(`Type '${label}' to confirm the restore target`, {
    validate: (value: string): void => {
      if (value !== label)
        throw new BackupError(`Restore confirmation must exactly equal '${label}'.`);
    },
  });
}
