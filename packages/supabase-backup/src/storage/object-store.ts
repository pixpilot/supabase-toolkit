import type { InputField } from '../core/input.js';

/**
 * The storage contract every backend implements.
 *
 * Keys are opaque, '/'-separated strings, and `list` matches them as plain text
 * rather than as directory paths, so every backend answers the same question the
 * same way. `putImmutable` is the guarantee the whole tool rests on: a key that
 * already exists is never rewritten, so a finished backup cannot be replaced by
 * a later one that happens to land on the same key.
 */
export interface ObjectStore {
  get: (key: string) => Promise<Uint8Array>;
  has: (key: string) => Promise<boolean>;
  list: (prefix: string) => Promise<string[]>;
  putImmutable: (key: string, body: Uint8Array) => Promise<void>;
}

/** The storage backends this package ships. */
export const storageDrivers = ['r2', 'local'] as const;

export type StorageDriver = (typeof storageDrivers)[number];

export function isStorageDriver(value: string): value is StorageDriver {
  return (storageDrivers as readonly string[]).includes(value);
}

/** Settings shared by every backend, naming the adapter that owns the rest. */
export interface StorageSettings {
  driver?: StorageDriver;
}

/** The part of an adapter that can be read without knowing its config type. */
export interface StorageAdapterInfo {
  /** Flags and questions this backend alone needs. */
  readonly fields: readonly InputField[];
  readonly driver: StorageDriver;
  /** One line describing the backend in `--help`. */
  readonly summary: string;
}

/**
 * One storage backend, together with the settings it alone needs.
 *
 * An adapter owns its flags, its questions, and the checks that run on them, so
 * adding a backend does not touch the CLI: a run is only ever asked for the
 * settings the selected backend actually uses.
 */
export interface StorageAdapter<TConfig extends StorageSettings>
  extends StorageAdapterInfo {
  /** Builds a store from settings this adapter already loaded. */
  createStore: (config: TConfig) => ObjectStore;
  /** Reads and checks this backend's settings, and names itself in `driver`. */
  loadConfig: (env: NodeJS.ProcessEnv) => TConfig;
}
