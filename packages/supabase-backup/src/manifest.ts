import { BackupError } from './errors.js';

export const authTables = ['auth.users', 'auth.identities'] as const;
export type AuthTable = (typeof authTables)[number];
export interface Column {
  dataType: string;
  name: string;
}
export interface TableCount {
  table: string;
  count: number;
}

export interface BackupManifest {
  appChecksumObjectKey: string;
  appEncryptedBytes: number;
  appObjectKey: string;
  appSchemas: string[];
  appSha256: string;
  appTableCounts: TableCount[];
  authColumns: Record<AuthTable, Column[]>;
  authChecksumObjectKey: string;
  authEncryptedBytes: number;
  authObjectKey: string;
  authRowCounts: TableCount[];
  authSha256: string;
  authTables: AuthTable[];
  cliVersion: string;
  createdAt: string;
  environment: string;
  pgDumpVersion: string;
  postgresServerVersion: string;
}

/** Key-layout generation; bump only when the object-key structure changes. */
export const backupKeyLayoutVersion = 'v1';

/** Names the manifest inside every backup folder. */
export const manifestObjectName = 'manifest.json';

/** Generates immutable object names for one UTC backup timestamp. */
export function backupObjectKeys(
  prefix: string,
  createdAt: Date,
): Record<'app' | 'auth' | 'appChecksum' | 'authChecksum' | 'manifest', string> {
  const stamp = createdAt
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}Z$/u, 'Z');
  const base = `${prefix}/${backupKeyLayoutVersion}/${stamp}`;
  return {
    app: `${base}/app.dump.age`,
    auth: `${base}/auth.dump.age`,
    appChecksum: `${base}/app.sha256`,
    authChecksum: `${base}/auth.sha256`,
    manifest: `${base}/${manifestObjectName}`,
  };
}

/** Rejects malformed manifests before they can guide a restore. */
export function parseManifest(value: string): BackupManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(value);
  } catch {
    throw new BackupError('Backup manifest is not valid JSON.');
  }
  const item = manifest as Partial<BackupManifest>;
  if (
    !item.createdAt ||
    !item.appObjectKey ||
    !item.appChecksumObjectKey ||
    !item.authObjectKey ||
    !item.authChecksumObjectKey ||
    !/^[a-f0-9]{64}$/u.test(item.appSha256 || '') ||
    !/^[a-f0-9]{64}$/u.test(item.authSha256 || '') ||
    !Array.isArray(item.authTables) ||
    !item.authColumns ||
    !item.appTableCounts ||
    !item.authRowCounts
  ) {
    throw new BackupError('Backup manifest is incomplete or invalid.');
  }
  return item as BackupManifest;
}
