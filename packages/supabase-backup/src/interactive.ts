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
 * A flag always wins, the environment comes next, and only a terminal session is
 * asked. Secrets are never accepted as flags, because command-line arguments are
 * visible to other processes on the machine and are kept in shell history.
 */

export interface EnvironmentField {
  defaultValue?: string;
  name: string;
  question: string;
  secret?: boolean;
  validate?: (value: string) => void;
}

/** Backups listed before the manual-entry choice when picking a restore. */
const maximumListedBackups = 10;

const sourceDatabaseUrl: EnvironmentField = {
  name: 'SOURCE_DATABASE_URL',
  question: 'Source database URL (postgresql://user:password@host:5432/postgres)',
  secret: true,
  validate: (value: string): void => {
    parseDatabaseUrl(value);
  },
};

export const targetDatabaseUrlField: EnvironmentField = {
  name: 'TARGET_DATABASE_URL',
  question: 'Target database URL to restore into',
  secret: true,
  validate: (value: string): void => {
    parseDatabaseUrl(value);
  },
};

/** Prefix offered at the prompt when neither a flag nor the environment sets one. */
export const defaultBackupPrefix = 'production/database';

export const backupPrefixField: EnvironmentField = {
  name: 'BACKUP_PREFIX',
  question: 'Backup object-key prefix',
  defaultValue: defaultBackupPrefix,
  validate: (value: string): void =>
    ensureValidBackupPrefix(value.replace(/^\/+|\/+$/gu, '')),
};

export const ageIdentityField: EnvironmentField = {
  name: 'AGE_IDENTITY',
  question: 'age identity used to decrypt (AGE-SECRET-KEY-1…)',
  secret: true,
  validate: ensureValidAgeIdentity,
};

/** R2 credentials and location, shared by every command. */
export const r2Fields: readonly EnvironmentField[] = [
  {
    name: 'R2_ENDPOINT',
    question: 'R2 S3 endpoint (https://<account-id>.r2.cloudflarestorage.com)',
    validate: ensureValidR2Endpoint,
  },
  {
    name: 'R2_BUCKET',
    question: 'R2 bucket name',
    validate: ensureValidR2Bucket,
  },
  {
    name: 'R2_ACCESS_KEY_ID',
    question: 'R2 access key ID',
    secret: true,
    validate: (value: string): void => ensureOpaqueSecret('R2_ACCESS_KEY_ID', value),
  },
  {
    name: 'R2_SECRET_ACCESS_KEY',
    question: 'R2 secret access key',
    secret: true,
    validate: (value: string): void => ensureOpaqueSecret('R2_SECRET_ACCESS_KEY', value),
  },
];

/** Everything `backup` reads, in the order an operator is asked for it. */
export const backupFields: readonly EnvironmentField[] = [
  sourceDatabaseUrl,
  {
    name: 'BACKUP_AGE_RECIPIENT',
    question: 'age recipient used to encrypt (age1…)',
    validate: ensureValidAgeRecipient,
  },
  ...r2Fields,
  backupPrefixField,
  {
    name: 'APP_SCHEMAS',
    question: 'Application schemas to back up, comma separated',
    defaultValue: 'public',
    validate: (value: string): void => {
      parseAppSchemas(value);
    },
  },
];

/** Everything the read-only health check reads. */
export const statusFields: readonly EnvironmentField[] = [...r2Fields, backupPrefixField];

/** Returns a copy of the environment with every missing field asked for. */
export async function fillMissingEnvironment(
  fields: readonly EnvironmentField[],
  env: NodeJS.ProcessEnv,
  prompter: Prompter | undefined,
): Promise<NodeJS.ProcessEnv> {
  const filled: NodeJS.ProcessEnv = { ...env };
  for (const field of fields) {
    if (filled[field.name]?.trim()) continue;
    if (!prompter) {
      if (field.defaultValue !== undefined) continue;
      throw new BackupError(
        `${field.name} is required. Set it in the environment, or run the command in a terminal to be asked for it.`,
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
