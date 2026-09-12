import type { InputField } from '../src/core/input.js';
import type { StorageConfig } from '../src/storage/create-object-store.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBackupConfig, loadStatusConfig } from '../src/core/config.js';
import { BackupError } from '../src/core/errors.js';
import { LocalStore } from '../src/storage/adapters/local-store.js';
import { R2Store } from '../src/storage/adapters/r2-store.js';
import {
  allStorageFields,
  createObjectStore,
  hasStorageSettings,
  loadStorageConfig,
  readStorageDriver,
  storageFields,
} from '../src/storage/create-object-store.js';

const roots: string[] = [];

async function storeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'local-store-'));
  roots.push(root);
  return root;
}

async function localStore(): Promise<LocalStore> {
  return new LocalStore({ driver: 'local', root: await storeRoot() });
}

function flags(fields: readonly InputField[]): string[] {
  return fields.map((field) => field.flag);
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { force: true, recursive: true });
});

describe('local object store', () => {
  it('reads back exactly what it wrote, under a nested key', async () => {
    const store = await localStore();
    const body = new Uint8Array([1, 2, 3, 250]);
    await store.putImmutable('production/database/v1/20240101T000000Z/app.age', body);
    expect(await store.has('production/database/v1/20240101T000000Z/app.age')).toBe(true);
    expect([
      ...(await store.get('production/database/v1/20240101T000000Z/app.age')),
    ]).toEqual([1, 2, 3, 250]);
  });

  it('refuses to replace a key that already holds a backup', async () => {
    const store = await localStore();
    await store.putImmutable('backups/app.age', new Uint8Array([1]));
    await expect(
      store.putImmutable('backups/app.age', new Uint8Array([2])),
    ).rejects.toThrow(BackupError);
    // The first write is the one that survives.
    expect([...(await store.get('backups/app.age'))]).toEqual([1]);
  });

  it('reports a missing key rather than inventing an empty object', async () => {
    const store = await localStore();
    expect(await store.has('backups/missing.age')).toBe(false);
    await expect(store.get('backups/missing.age')).rejects.toThrow(BackupError);
  });

  it('lists keys rather than paths, matching a prefix as plain text', async () => {
    const store = await localStore();
    await store.putImmutable('production/database/v1/a/app.age', new Uint8Array([1]));
    await store.putImmutable('production/database/v1/b/app.age', new Uint8Array([2]));
    await store.putImmutable('staging/database/v1/a/app.age', new Uint8Array([3]));
    expect((await store.list('production/database')).sort()).toEqual([
      'production/database/v1/a/app.age',
      'production/database/v1/b/app.age',
    ]);
    // A prefix is not a directory boundary, exactly as it is not in R2.
    expect(await store.list('production/database/v1/b')).toEqual([
      'production/database/v1/b/app.age',
    ]);
    expect(await store.list('nothing-here')).toEqual([]);
  });

  it('treats a root that does not exist yet as holding no backups', async () => {
    const store = new LocalStore({
      driver: 'local',
      root: join(await storeRoot(), 'not', 'created', 'yet'),
    });
    expect(await store.list('production')).toEqual([]);
    expect(await store.has('production/app.age')).toBe(false);
  });

  it('refuses a key that would reach outside the storage root', async () => {
    const store = await localStore();
    await expect(store.get('../escaped.age')).rejects.toThrow(
      'resolves outside the storage root',
    );
    await expect(
      store.putImmutable('../escaped.age', new Uint8Array([1])),
    ).rejects.toThrow('resolves outside the storage root');
  });

  it('ignores directories when listing, so only real objects are returned', async () => {
    const root = await storeRoot();
    const store = new LocalStore({ driver: 'local', root });
    await store.putImmutable('a/b/app.age', new Uint8Array([1]));
    await writeFile(join(root, 'loose.age'), new Uint8Array([2]));
    expect((await store.list('')).sort()).toEqual(['a/b/app.age', 'loose.age']);
  });
});

describe('storage adapters', () => {
  it('asks each backend only for the settings it uses', () => {
    expect(flags(storageFields('r2'))).toEqual([
      '--r2-endpoint',
      '--r2-bucket',
      '--r2-access-key-id',
      '--r2-secret-access-key',
    ]);
    expect(flags(storageFields('local'))).toEqual(['--storage-root']);
  });

  it('still parses every backend flag, whichever backend a run selects', () => {
    expect(flags(allStorageFields)).toContain('--storage');
    expect(flags(allStorageFields)).toContain('--r2-endpoint');
    expect(flags(allStorageFields)).toContain('--storage-root');
  });

  it('uses R2 unless a run asks for another backend', () => {
    expect(readStorageDriver({})).toBe('r2');
    expect(readStorageDriver({ STORAGE_DRIVER: 'local' })).toBe('local');
    expect(() => readStorageDriver({ STORAGE_DRIVER: 's3' })).toThrow(
      '--storage must be one of: r2, local.',
    );
  });

  it('loads and validates only the selected backend own settings', () => {
    const local = loadStorageConfig({
      STORAGE_DRIVER: 'local',
      STORAGE_ROOT: '/srv/backups',
    });
    expect(local.driver).toBe('local');
    expect(() => loadStorageConfig({ STORAGE_DRIVER: 'local' })).toThrow(
      'STORAGE_ROOT is required.',
    );
    expect(() =>
      loadStorageConfig({
        STORAGE_DRIVER: 'local',
        STORAGE_ROOT: 'https://example.test',
      }),
    ).toThrow('not a URL');
  });

  it('builds the store the loaded settings name', () => {
    expect(createObjectStore({ driver: 'local', root: '/srv/backups' })).toBeInstanceOf(
      LocalStore,
    );
    const r2: StorageConfig = {
      driver: 'r2',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'private-backups',
    };
    expect(createObjectStore(r2)).toBeInstanceOf(R2Store);
  });

  it('lets a command run on local storage without any R2 credential', () => {
    const env = {
      STORAGE_DRIVER: 'local',
      STORAGE_ROOT: '/srv/backups',
      BACKUP_PREFIX: 'production/database',
      SOURCE_DATABASE_URL:
        'postgresql://backup:secret@db.example.test:5432/postgres?sslmode=require',
      BACKUP_AGE_RECIPIENT: 'age1recipient',
    };
    expect(loadStatusConfig(env).prefix).toBe('production/database');
    expect(loadBackupConfig(env).driver).toBe('local');
  });

  it('still requires R2 credentials when no backend is named', () => {
    expect(() => loadStatusConfig({ BACKUP_PREFIX: 'production/database' })).toThrow(
      'R2_ACCESS_KEY_ID is required.',
    );
  });
});

describe('naming a storage backend from the settings a run was given', () => {
  it('takes a run at its word when it names one', () => {
    expect(readStorageDriver({ STORAGE_DRIVER: 'local', R2_BUCKET: 'b' })).toBe('local');
  });

  it('reads the backend off settings that belong to only one', () => {
    expect(readStorageDriver({ STORAGE_ROOT: '/srv/backups' })).toBe('local');
    expect(readStorageDriver({ R2_BUCKET: 'private-backups' })).toBe('r2');
  });

  it('falls back to R2 when the settings name no backend or several', () => {
    expect(readStorageDriver({})).toBe('r2');
    expect(readStorageDriver({ STORAGE_ROOT: '/srv/backups', R2_BUCKET: 'b' })).toBe(
      'r2',
    );
  });

  it('reports whether the settings already settle the question', () => {
    expect(hasStorageSettings({})).toBe(false);
    expect(hasStorageSettings({ BACKUP_PREFIX: 'production/database' })).toBe(false);
    expect(hasStorageSettings({ STORAGE_DRIVER: 'local' })).toBe(true);
    expect(hasStorageSettings({ STORAGE_ROOT: '/srv/backups' })).toBe(true);
    expect(
      hasStorageSettings({ R2_ENDPOINT: 'https://a.r2.cloudflarestorage.com' }),
    ).toBe(true);
  });
});
