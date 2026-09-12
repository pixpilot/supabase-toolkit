import type { BackupManifest } from '../core/manifest.js';
import type { ObjectStore } from '../storage/object-store.js';
import { loadStatusConfig } from '../core/config.js';
import { BackupError } from '../core/errors.js';
import {
  backupKeyLayoutVersion,
  manifestObjectName,
  parseManifest,
} from '../core/manifest.js';
import { createObjectStore } from '../storage/create-object-store.js';
import { readVerifiedArchives } from '../storage/read-verified-archives.js';

export interface BackupStatus {
  ageHours: number;
  manifest: BackupManifest;
  manifestKey: string;
}

/** Lists every manifest key for the current key layout, newest first. */
export async function listManifestKeys(
  prefix: string,
  store: ObjectStore,
): Promise<string[]> {
  return (await store.list(`${prefix}/${backupKeyLayoutVersion}/`))
    .filter((key) => key.endsWith(`/${manifestObjectName}`))
    .sort()
    .reverse();
}

/** Verifies the newest manifest and encrypted archive bytes without needing a private key. */
export async function getBackupStatus(
  prefix: string,
  store: ObjectStore,
  now = new Date(),
): Promise<BackupStatus> {
  const keys = await listManifestKeys(prefix, store);
  const manifestKey = keys[0];
  if (!manifestKey) throw new BackupError('No valid completed backup manifest exists.');
  const manifest = parseManifest(
    Buffer.from(await store.get(manifestKey)).toString('utf8'),
  );
  if (
    !(await store.has(manifest.appObjectKey)) ||
    !(await store.has(manifest.authObjectKey)) ||
    !(await store.has(manifest.appChecksumObjectKey)) ||
    !(await store.has(manifest.authChecksumObjectKey))
  ) {
    throw new BackupError(
      `Latest backup manifest '${manifestKey}' references missing R2 objects.`,
    );
  }
  const ageHours = (now.getTime() - new Date(manifest.createdAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0)
    throw new BackupError('Latest backup has an invalid or future timestamp.');
  await readVerifiedArchives(manifest, store);
  return { manifest, manifestKey, ageHours };
}

/** Prints a machine-safe health result and fails when no recent valid backup exists. */
export async function status(
  maxAgeHours: number | undefined,
  env = process.env,
): Promise<BackupStatus> {
  if (maxAgeHours !== undefined && (!Number.isFinite(maxAgeHours) || maxAgeHours < 0))
    throw new BackupError('--max-age-hours must be a non-negative number.');
  const config = loadStatusConfig(env);
  const result = await getBackupStatus(config.prefix, createObjectStore(config));
  if (maxAgeHours !== undefined && result.ageHours > maxAgeHours)
    throw new BackupError(
      `Latest backup is ${result.ageHours.toFixed(1)} hours old, exceeding ${maxAgeHours} hours.`,
    );
  process.stdout.write(
    `Backup encrypted archive integrity verified: ${result.manifest.createdAt} (${result.ageHours.toFixed(1)} hours old)\nManifest: ${result.manifestKey}\n`,
  );
  return result;
}
