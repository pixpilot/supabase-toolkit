import type { StorageConfig } from '../storage/create-object-store.js';
import { loadStorageConfig } from '../storage/create-object-store.js';
import { required } from './env.js';
import { BackupError } from './errors.js';
import {
  ensureValidAgeIdentity,
  ensureValidAgeRecipient,
  ensureValidBackupPrefix,
  parseAppSchemas,
} from './validation.js';

/*
 * Storage settings are not listed here. Each backend owns its own, so this file
 * carries whatever the selected adapter loaded without naming R2, a directory,
 * or anything else specific to one of them.
 */

export type BackupConfig = StorageConfig & {
  ageRecipient: string;
  appSchemas: string[];
  prefix: string;
  sourceDatabaseUrl: string;
};

export type RestoreConfig = StorageConfig & {
  ageIdentity: string;
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
};

export type StatusConfig = StorageConfig & {
  prefix: string;
};

/** Reads, normalises, and validates an object-key prefix. */
function backupPrefix(env: NodeJS.ProcessEnv): string {
  const prefix = required(env, 'BACKUP_PREFIX').replace(/^\/+|\/+$/gu, '');
  ensureValidBackupPrefix(prefix);
  return prefix;
}

/** Loads and validates backup-only environment configuration. */
export function loadBackupConfig(env = process.env): BackupConfig {
  const appSchemas = parseAppSchemas(env['APP_SCHEMAS'] || 'public');
  const ageRecipient = required(env, 'BACKUP_AGE_RECIPIENT');
  ensureValidAgeRecipient(ageRecipient);
  return {
    ...loadStorageConfig(env),
    ageRecipient,
    sourceDatabaseUrl: required(env, 'SOURCE_DATABASE_URL'),
    prefix: backupPrefix(env),
    appSchemas,
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
  const ageIdentity = required(env, 'AGE_IDENTITY');
  ensureValidAgeIdentity(ageIdentity);
  return {
    ...loadStorageConfig(env),
    ageIdentity,
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
