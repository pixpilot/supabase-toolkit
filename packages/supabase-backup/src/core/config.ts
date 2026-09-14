import type { StorageConfig } from '../storage/create-object-store.js';
import { loadStorageConfig } from '../storage/create-object-store.js';
import { required } from './env.js';
import { BackupError } from './errors.js';
import {
  ensureValidAgeIdentity,
  ensureValidAgeRecipient,
  ensureValidBackupPrefix,
  parseAppSchemas,
  parseSchemaList,
} from './validation.js';

/*
 * Storage settings are not listed here. Each backend owns its own, so this file
 * carries whatever the selected adapter loaded without naming R2, a directory,
 * or anything else specific to one of them.
 */

/** Backup settings require a recipient unless plaintext is explicitly selected. */
export type BackupConfig = StorageConfig & {
  /** Schemas to dump whole. Unset backs up every schema the project owns. */
  appSchemas?: string[];
  excludedSchemas: string[];
  prefix: string;
  sourceDatabaseUrl: string;
} & (
    | { ageRecipient: string; encryption?: 'age' }
    | { ageRecipient?: never; encryption: 'none' }
  );

export type RestoreConfig = StorageConfig & {
  /** Identity the archives are decrypted with; unset only when a run opted out. */
  ageIdentity?: string;
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
};

export type StatusConfig = StorageConfig & {
  prefix: string;
};

/** The only value BACKUP_ENCRYPTION accepts, which turns encryption off. */
export const encryptionOff = 'none';

/**
 * Says whether a run deliberately opted out of encrypting its archives.
 *
 * Encryption is what a backup is for, so it stays on unless this reads the exact
 * opt-out word: a value that is empty, misspelt, or anything else is refused
 * rather than quietly taken as permission to store a plaintext database dump.
 */
export function encryptionDisabled(env: NodeJS.ProcessEnv): boolean {
  const value = env['BACKUP_ENCRYPTION']?.trim();
  if (value === undefined || value === '') return false;
  if (value !== encryptionOff)
    throw new BackupError(
      `BACKUP_ENCRYPTION must be '${encryptionOff}' when it is set at all. Leave it unset to encrypt, which is the default.`,
    );
  return true;
}

/** Reads, normalises, and validates an object-key prefix. */
function backupPrefix(env: NodeJS.ProcessEnv): string {
  const prefix = required(env, 'BACKUP_PREFIX').replace(/^\/+|\/+$/gu, '');
  ensureValidBackupPrefix(prefix);
  return prefix;
}

/** Loads and validates backup-only environment configuration. */
export function loadBackupConfig(env = process.env): BackupConfig {
  const named = env['APP_SCHEMAS']?.trim();
  const excluded = env['EXCLUDE_SCHEMAS']?.trim();
  const unencrypted = encryptionDisabled(env);
  if (unencrypted && env['BACKUP_AGE_RECIPIENT']?.trim())
    throw new BackupError(
      'BACKUP_ENCRYPTION: none cannot be combined with BACKUP_AGE_RECIPIENT.',
    );
  const ageRecipient = unencrypted ? undefined : required(env, 'BACKUP_AGE_RECIPIENT');
  if (ageRecipient !== undefined) ensureValidAgeRecipient(ageRecipient);
  return {
    ...loadStorageConfig(env),
    ...(ageRecipient === undefined ? { encryption: 'none' as const } : { ageRecipient }),
    sourceDatabaseUrl: required(env, 'SOURCE_DATABASE_URL'),
    prefix: backupPrefix(env),
    ...(named ? { appSchemas: parseAppSchemas(named) } : {}),
    excludedSchemas: excluded ? parseSchemaList(excluded) : [],
  };
}

/** Loads restore credentials while allowing dry-run archive checks without a target. */
export function loadRestoreConfig(
  env = process.env,
  requireTarget = false,
): RestoreConfig {
  const targetDatabaseUrl = env['TARGET_DATABASE_URL']?.trim();
  if (requireTarget && !targetDatabaseUrl)
    throw new BackupError('TARGET_DATABASE_URL is required with --apply.');
  /*
   * A run that did not opt out still needs the identity here rather than once
   * the manifest has been read, so forgetting the flag fails before anything is
   * downloaded. Whether the backup actually needs decrypting is the manifest's
   * to say, and the restore checks it against what this loaded.
   */
  const unencrypted = encryptionDisabled(env);
  if (unencrypted && env['AGE_IDENTITY']?.trim())
    throw new BackupError(
      'BACKUP_ENCRYPTION: none cannot be combined with AGE_IDENTITY.',
    );
  const ageIdentity = unencrypted ? undefined : required(env, 'AGE_IDENTITY');
  if (ageIdentity !== undefined) ensureValidAgeIdentity(ageIdentity);
  return {
    ...loadStorageConfig(env),
    ...(ageIdentity === undefined ? {} : { ageIdentity }),
    ...(targetDatabaseUrl ? { targetDatabaseUrl } : {}),
    ...(env['SOURCE_DATABASE_URL']?.trim()
      ? { sourceDatabaseUrl: required(env, 'SOURCE_DATABASE_URL') }
      : {}),
  };
}

/** Loads the object-key prefix and storage settings the health check reads. */
export function loadStatusConfig(env = process.env): StatusConfig {
  return { ...loadStorageConfig(env), prefix: backupPrefix(env) };
}
