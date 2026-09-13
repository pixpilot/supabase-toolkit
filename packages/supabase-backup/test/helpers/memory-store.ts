import type { ObjectBody, ObjectStore } from '../../src/storage/object-store.js';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { BackupError } from '../../src/core/errors.js';

/**
 * An object store held in memory, standing in for R2 across the test suites.
 *
 * It keeps whatever a real backend would keep: a body given as a file is read in
 * and stored as its bytes, so a test can still inspect and corrupt what was
 * uploaded without knowing how it was sent.
 */
export class MemoryStore implements ObjectStore {
  public readonly values = new Map<string, Uint8Array>();

  public async get(key: string): Promise<Uint8Array> {
    const value = this.values.get(key);
    if (!value) throw new BackupError(`missing ${key}`);
    return value;
  }

  public async getStream(key: string): Promise<Readable> {
    return Readable.from([Buffer.from(await this.get(key))]);
  }

  public async has(key: string): Promise<boolean> {
    return this.values.has(key);
  }

  public async list(prefix: string): Promise<string[]> {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  public async putImmutable(key: string, body: ObjectBody): Promise<void> {
    if (this.values.has(key))
      throw new BackupError(`Refusing to overwrite existing object '${key}'.`);
    this.values.set(key, body instanceof Uint8Array ? body : await readFile(body.file));
  }
}
