import type { InputField } from '../core/input.js';
import type { LocalConfig } from './adapters/local-store.js';
import type { R2Config } from './adapters/r2-store.js';
import type { ObjectStore, StorageDriver } from './object-store.js';

import { BackupError } from '../core/errors.js';
import { localAdapter, r2Adapter, storageAdapters } from './adapters/index.js';
import { isStorageDriver, storageDrivers } from './object-store.js';

/** Settings for whichever backend a run selected. */
export type StorageConfig = LocalConfig | R2Config;

/** The backend used when `--storage` is absent, which leaves existing runs unchanged. */
export const defaultStorageDriver: StorageDriver = 'r2';

function unknownStorageDriver(): BackupError {
  return new BackupError(`--storage must be one of: ${storageDrivers.join(', ')}.`);
}

export function ensureValidStorageDriver(value: string): void {
  if (!isStorageDriver(value)) throw unknownStorageDriver();
}

/** Selects the backend, which is R2 unless a run asks for another. */
export const storageDriverField: InputField = {
  flag: '--storage',
  name: 'STORAGE_DRIVER',
  question: 'Storage backend',
  defaultValue: defaultStorageDriver,
  validate: ensureValidStorageDriver,
};

/** The backends whose own settings appear among the given values. */
function suppliedDrivers(env: NodeJS.ProcessEnv): StorageDriver[] {
  return storageDrivers.filter((driver) =>
    storageAdapters[driver].fields.some((field) => env[field.name]?.trim()),
  );
}

/** True once the given values settle which backend a run uses. */
export function hasStorageSettings(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env['STORAGE_DRIVER']?.trim()) || suppliedDrivers(env).length > 0;
}

/**
 * Names the backend a run uses.
 *
 * A run that named one is taken at its word. Otherwise the settings themselves
 * say which backend was meant, so passing a storage root is enough to mean the
 * local one; only settings for several backends, or for none, fall back to R2.
 */
export function readStorageDriver(env: NodeJS.ProcessEnv): StorageDriver {
  const value = env['STORAGE_DRIVER']?.trim();
  if (value) {
    if (!isStorageDriver(value)) throw unknownStorageDriver();
    return value;
  }
  const supplied = suppliedDrivers(env);
  return supplied.length === 1
    ? (supplied[0] ?? defaultStorageDriver)
    : defaultStorageDriver;
}

/** The flags and questions the selected backend needs, and nothing else. */
export function storageFields(driver: StorageDriver): readonly InputField[] {
  return storageAdapters[driver].fields;
}

/** Every storage flag the CLI parses, across all backends. */
export const allStorageFields: readonly InputField[] = [
  storageDriverField,
  ...storageDrivers.flatMap((driver) => [...storageAdapters[driver].fields]),
];

/** Reads and checks the selected backend's own settings. */
export function loadStorageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  return readStorageDriver(env) === 'local'
    ? localAdapter.loadConfig(env)
    : r2Adapter.loadConfig(env);
}

/** Builds the store for settings its owning adapter already loaded. */
export function createObjectStore(config: StorageConfig): ObjectStore {
  return config.driver === 'local'
    ? localAdapter.createStore(config)
    : r2Adapter.createStore(config);
}
