import type { AccessChecks } from './access-checks.js';
import { isAccessChecks } from './access-checks.js';
import { BackupError } from './errors.js';
import { parseAppSchemas } from './validation.js';

export const authTables = ['auth.users', 'auth.identities'] as const;
export type AuthTable = (typeof authTables)[number];

/**
 * Supabase-managed storage tables, in the order a restore must insert them.
 *
 * These hold bucket settings and object metadata. Like the Auth tables they are
 * owned by Supabase, so they are dumped and restored as data only. They are
 * included only when the source database has them, so a plain PostgreSQL
 * database still backs up.
 */
export const storageTables = ['storage.buckets', 'storage.objects'] as const;
export type StorageTable = (typeof storageTables)[number];

export interface Column {
  dataType: string;
  name: string;
}
export interface TableCount {
  table: string;
  count: number;
}

export interface BackupManifest {
  formatVersion: 2;
  accessChecks?: AccessChecks;
  appAccessFingerprint: string;
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
  storageRowCounts?: TableCount[];
  storageTables?: StorageTable[];
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
  if (!manifest || typeof manifest !== 'object')
    throw new BackupError('Backup manifest is incomplete or invalid.');
  const item = manifest as Partial<BackupManifest>;
  if (
    item.formatVersion !== 2 ||
    (item.accessChecks !== undefined && !isAccessChecks(item.accessChecks)) ||
    !isText(item.appAccessFingerprint) ||
    !/^[a-f0-9]{32}$/u.test(item.appAccessFingerprint || '') ||
    !isText(item.createdAt) ||
    !Number.isFinite(Date.parse(item.createdAt)) ||
    !isText(item.environment) ||
    !isText(item.cliVersion) ||
    !isText(item.pgDumpVersion) ||
    !isText(item.postgresServerVersion) ||
    !isText(item.appObjectKey) ||
    !isText(item.appChecksumObjectKey) ||
    !isText(item.authObjectKey) ||
    !isText(item.authChecksumObjectKey) ||
    !Number.isSafeInteger(item.appEncryptedBytes) ||
    (item.appEncryptedBytes ?? 0) <= 0 ||
    !Number.isSafeInteger(item.authEncryptedBytes) ||
    (item.authEncryptedBytes ?? 0) <= 0 ||
    !isText(item.appSha256) ||
    !/^[a-f0-9]{64}$/u.test(item.appSha256) ||
    !isText(item.authSha256) ||
    !/^[a-f0-9]{64}$/u.test(item.authSha256) ||
    !Array.isArray(item.appSchemas) ||
    !item.appSchemas.every(isText) ||
    !Array.isArray(item.authTables) ||
    item.authTables.length !== authTables.length ||
    !item.authTables.every((table, index) => table === authTables[index]) ||
    !item.authColumns ||
    !validCounts(item.appTableCounts) ||
    !validCounts(item.authRowCounts) ||
    !validStorage(item)
  ) {
    throw new BackupError('Backup manifest is incomplete or invalid.');
  }
  const schemas = parseAppSchemas(item.appSchemas.join(','));
  if (
    new Set(schemas).size !== schemas.length ||
    schemas.length !== item.appSchemas.length ||
    schemas.some((schema, index) => schema !== item.appSchemas?.[index]) ||
    item.appTableCounts.some(
      ({ table }) => !schemas.includes(table.split('.')[0] ?? ''),
    ) ||
    item.authRowCounts
      .map(({ table }) => table)
      .sort()
      .join(',') !== [...authTables].sort().join(',') ||
    authTables.some((table) => {
      const columns = item.authColumns?.[table];
      return (
        !Array.isArray(columns) ||
        !columns.length ||
        columns.some(
          (column) => !column || !isText(column.name) || !isText(column.dataType),
        )
      );
    })
  )
    throw new BackupError(
      'Backup manifest contains invalid schemas, counts, or Auth columns.',
    );
  return item as BackupManifest;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Accepts a manifest without storage metadata, and validates it when present.
 *
 * Backups written before storage was included carry neither field, and both are
 * required together once either appears, so a restore never reads counts for
 * tables it was not told about.
 */
function validStorage(item: Partial<BackupManifest>): boolean {
  if (item.storageTables === undefined && item.storageRowCounts === undefined)
    return true;
  const tables = item.storageTables;
  if (
    !Array.isArray(tables) ||
    !tables.length ||
    !validCounts(item.storageRowCounts) ||
    item.storageRowCounts.length !== tables.length
  )
    return false;
  const expected = storageTables.filter((table) => tables.includes(table));
  return (
    expected.length === tables.length &&
    expected.every((table, index) => table === tables[index]) &&
    item.storageRowCounts.every(({ table }) => tables.includes(table as StorageTable))
  );
}

function validCounts(value: unknown): value is TableCount[] {
  if (!Array.isArray(value)) return false;
  const tables = new Set<string>();
  return value.every((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const { table, count } = entry as Partial<TableCount>;
    if (
      !isText(table) ||
      !/^[A-Za-z_][\w$]*\.[A-Za-z_][\w$]*$/u.test(table) ||
      !Number.isSafeInteger(count) ||
      (count ?? -1) < 0 ||
      tables.has(table)
    )
      return false;
    tables.add(table);
    return true;
  });
}
