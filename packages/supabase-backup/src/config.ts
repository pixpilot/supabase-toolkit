import { BackupError } from './errors.js';
import {
  ensureOpaqueSecret,
  ensureValidAgeIdentity,
  ensureValidAgeRecipient,
  ensureValidBackupPrefix,
  ensureValidR2Bucket,
  ensureValidR2Endpoint,
} from './validation.js';

export interface R2Config {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  secretAccessKey: string;
}

export interface BackupConfig extends R2Config {
  ageRecipient: string;
  appSchemas: string[];
  prefix: string;
  sourceDatabaseUrl: string;
}

export interface RestoreConfig extends R2Config {
  ageIdentity: string;
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
}

export interface StatusConfig extends R2Config {
  prefix: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new BackupError(`${name} is required.`);
  return value;
}

function r2Config(env: NodeJS.ProcessEnv): R2Config {
  const config = {
    accessKeyId: required(env, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY'),
    endpoint: required(env, 'R2_ENDPOINT'),
    bucket: required(env, 'R2_BUCKET'),
  };
  ensureOpaqueSecret('R2_ACCESS_KEY_ID', config.accessKeyId);
  ensureOpaqueSecret('R2_SECRET_ACCESS_KEY', config.secretAccessKey);
  ensureValidR2Endpoint(config.endpoint);
  ensureValidR2Bucket(config.bucket);
  return config;
}

/** Reads, normalises, and validates an object-key prefix. */
function backupPrefix(env: NodeJS.ProcessEnv): string {
  const prefix = required(env, 'BACKUP_PREFIX').replace(/^\/+|\/+$/gu, '');
  ensureValidBackupPrefix(prefix);
  return prefix;
}

/** Loads and validates backup-only environment configuration. */
export function loadBackupConfig(env = process.env): BackupConfig {
  const appSchemas = (env['APP_SCHEMAS'] || 'public')
    .split(',')
    .map((schema) => schema.trim())
    .filter(Boolean);
  if (
    !appSchemas.length ||
    appSchemas.includes('auth') ||
    appSchemas.some((schema) => !/^[A-Za-z_][\w$]*$/u.test(schema))
  ) {
    throw new BackupError(
      'APP_SCHEMAS must contain valid application schemas and must not include auth.',
    );
  }
  const ageRecipient = required(env, 'BACKUP_AGE_RECIPIENT');
  ensureValidAgeRecipient(ageRecipient);
  return {
    ...r2Config(env),
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
    ...r2Config(env),
    ageIdentity,
    ...(targetDatabaseUrl ? { targetDatabaseUrl } : {}),
    ...(env['SOURCE_DATABASE_URL']?.trim()
      ? { sourceDatabaseUrl: required(env, 'SOURCE_DATABASE_URL') }
      : {}),
  };
}

/** Loads the R2 prefix and credentials required by the read-only health check. */
export function loadStatusConfig(env = process.env): StatusConfig {
  return { ...r2Config(env), prefix: backupPrefix(env) };
}
