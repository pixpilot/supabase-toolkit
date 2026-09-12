import type { InputField } from '../../core/input.js';
import type { ObjectStore, StorageAdapter, StorageSettings } from '../object-store.js';

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { required } from '../../core/env.js';
import { BackupError } from '../../core/errors.js';

export interface LocalConfig extends StorageSettings {
  driver: 'local';
  root: string;
}

/** Rejects a root that is really a URL, which is the usual paste mistake. */
export function ensureValidStorageRoot(value: string): void {
  if (value.includes('://'))
    throw new BackupError(
      '--storage-root is a directory on this machine, not a URL. Pass a path such as /srv/backups.',
    );
}

/** The directory this backend writes under, asked for only when it is selected. */
export const localFields: readonly InputField[] = [
  {
    flag: '--storage-root',
    name: 'STORAGE_ROOT',
    question: 'Directory that holds the backups',
    validate: ensureValidStorageRoot,
  },
];

/** Reads and checks the local storage root. */
export function loadLocalConfig(env: NodeJS.ProcessEnv): LocalConfig {
  const root = required(env, 'STORAGE_ROOT');
  ensureValidStorageRoot(root);
  return { driver: 'local', root: resolve(root) };
}

/**
 * A filesystem-backed object store, used for a local or mounted backup target.
 *
 * Keys map to paths under the root, and are listed as keys rather than as paths,
 * so a prefix matches the same objects it would in R2. The immutability the tool
 * relies on comes from an exclusive create, which is the filesystem's own
 * equivalent of a write that refuses to replace an existing object.
 */
export class LocalStore implements ObjectStore {
  private readonly root: string;

  public constructor(config: LocalConfig) {
    this.root = resolve(config.root);
  }

  public async has(key: string): Promise<boolean> {
    // Resolved outside the catch, so a key that escapes the root is reported
    // as the refusal it is rather than as an absent object.
    const path = this.pathFor(key);
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  public async putImmutable(key: string, body: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    if (await this.has(key))
      throw new BackupError(`Refusing to overwrite existing local object '${key}'.`);
    try {
      await mkdir(dirname(path), { recursive: true });
    } catch {
      throw new BackupError(`Local storage write failed for '${key}'.`);
    }
    try {
      // 'wx' fails when the path exists, so two concurrent runs cannot both win.
      await writeFile(path, body, { flag: 'wx', mode: 0o600 });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new BackupError(`Refusing to overwrite existing local object '${key}'.`);
      throw new BackupError(`Local storage write failed for '${key}'.`);
    }
  }

  public async get(key: string): Promise<Uint8Array> {
    const path = this.pathFor(key);
    try {
      return await readFile(path);
    } catch {
      throw new BackupError(`Local storage read failed for '${key}'.`);
    }
  }

  public async list(prefix: string): Promise<string[]> {
    const keys = await this.collect(this.root, '');
    return keys.filter((key) => key.startsWith(prefix));
  }

  /** Walks the root, naming every file by the key it is stored under. */
  private async collect(directory: string, prefix: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // A root that does not exist yet simply holds no objects.
      return [];
    }
    const keys: string[] = [];
    for (const entry of entries) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        keys.push(...(await this.collect(join(directory, entry.name), key)));
      else if (entry.isFile()) keys.push(key);
    }
    return keys;
  }

  /** Maps a key to a path, refusing any key that would escape the root. */
  private pathFor(key: string): string {
    const target = resolve(this.root, ...key.split('/'));
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`))
      throw new BackupError(`Object key '${key}' resolves outside the storage root.`);
    return target;
  }
}

/** A directory on this machine, or on anything mounted into it. */
export const localAdapter: StorageAdapter<LocalConfig> = {
  driver: 'local',
  summary: 'A directory on this machine, or a mounted volume.',
  fields: localFields,
  loadConfig: loadLocalConfig,
  createStore: (config: LocalConfig): ObjectStore => new LocalStore(config),
};
