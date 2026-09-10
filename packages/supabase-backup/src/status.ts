import type { BackupManifest } from './manifest.js';
import type { ObjectStore } from './r2.js';
import { loadStatusConfig } from './config.js';
import { BackupError } from './errors.js';
import { parseManifest } from './manifest.js';
import { R2Store } from './r2.js';

export interface BackupStatus {
  ageHours: number;
  manifest: BackupManifest;
  manifestKey: string;
}

/** Finds the latest complete manifest and checks its referenced archives remain available. */
export async function getBackupStatus(
  prefix: string,
  store: ObjectStore,
  now = new Date(),
): Promise<BackupStatus> {
  const keys = (await store.list(`${prefix}/`))
    .filter((key) => key.endsWith('.json'))
    .sort()
    .reverse();
  for (const manifestKey of keys) {
    let manifest: BackupManifest;
    try {
      manifest = parseManifest(
        Buffer.from(await store.get(manifestKey)).toString('utf8'),
      );
    } catch {
      continue; /* Try an older malformed manifest. */
    }
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
    if (!Number.isFinite(ageHours) || ageHours < 0) continue;
    return { manifest, manifestKey, ageHours };
  }
  throw new BackupError('No valid completed backup manifest exists.');
}

/** Prints a machine-safe health result and fails when no recent valid backup exists. */
export async function status(
  maxAgeHours: number | undefined,
  env = process.env,
): Promise<BackupStatus> {
  if (maxAgeHours !== undefined && (!Number.isFinite(maxAgeHours) || maxAgeHours < 0))
    throw new BackupError('--max-age-hours must be a non-negative number.');
  const config = loadStatusConfig(env);
  const result = await getBackupStatus(config.prefix, new R2Store(config));
  if (maxAgeHours !== undefined && result.ageHours > maxAgeHours)
    throw new BackupError(
      `Latest backup is ${result.ageHours.toFixed(1)} hours old, exceeding ${maxAgeHours} hours.`,
    );
  process.stdout.write(
    `Backup healthy: ${result.manifest.createdAt} (${result.ageHours.toFixed(1)} hours old)\nManifest: ${result.manifestKey}\n`,
  );
  return result;
}
