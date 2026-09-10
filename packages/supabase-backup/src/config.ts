import { BackupError } from './errors.js';

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
  return {
    accessKeyId: required(env, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY'),
    endpoint: required(env, 'R2_ENDPOINT'),
    bucket: required(env, 'R2_BUCKET'),
  };
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
  const prefix = required(env, 'BACKUP_PREFIX').replace(/^\/+|\/+$/gu, '');
  if (!prefix || prefix.includes('..'))
    throw new BackupError('BACKUP_PREFIX must be a non-empty object-key prefix.');
  return {
    ...r2Config(env),
    ageRecipient: required(env, 'BACKUP_AGE_RECIPIENT'),
    sourceDatabaseUrl: required(env, 'SOURCE_DATABASE_URL'),
    prefix,
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
  return {
    ...r2Config(env),
    ageIdentity: required(env, 'AGE_IDENTITY'),
    ...(targetDatabaseUrl ? { targetDatabaseUrl } : {}),
    ...(env['SOURCE_DATABASE_URL']?.trim()
      ? { sourceDatabaseUrl: env['SOURCE_DATABASE_URL'].trim() }
      : {}),
  };
}

/** Loads the R2 prefix and credentials required by the read-only health check. */
export function loadStatusConfig(env = process.env): StatusConfig {
  const prefix = required(env, 'BACKUP_PREFIX').replace(/^\/+|\/+$/gu, '');
  if (!prefix || prefix.includes('..'))
    throw new BackupError('BACKUP_PREFIX must be a non-empty object-key prefix.');
  return { ...r2Config(env), prefix };
}
