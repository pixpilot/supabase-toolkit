import type { StorageAdapterInfo, StorageDriver } from '../object-store.js';
import { localAdapter } from './local-store.js';
import { r2Adapter } from './r2-store.js';

export type { LocalConfig } from './local-store.js';
export {
  ensureValidStorageRoot,
  loadLocalConfig,
  localAdapter,
  localFields,
  LocalStore,
} from './local-store.js';
export type { R2Config } from './r2-store.js';
export {
  loadR2Config,
  r2Adapter,
  r2ErrorDetails,
  r2Fields,
  R2Store,
} from './r2-store.js';

/** Every backend, keyed by the name `--storage` selects it with. */
export const storageAdapters: Record<StorageDriver, StorageAdapterInfo> = {
  local: localAdapter,
  r2: r2Adapter,
};
