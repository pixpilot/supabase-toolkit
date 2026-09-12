export { backup, backupWithConfig } from './backup/backup.js';
export {
  type CliArguments,
  cliVersion,
  inputFromArguments,
  parseArguments,
  planCommand,
  runCli,
  usage,
  versionLine,
} from './cli/command-line.js';
export {
  allFields,
  backupFields,
  backupFieldsFor,
  chooseManifestKey,
  confirmRestoreTarget,
  defaultBackupPrefix,
  describeBackupKey,
  fillMissingInput,
  type InputField,
  type InputValues,
  r2Fields,
  statusFields,
  statusFieldsFor,
} from './cli/interactive.js';
export {
  createPrompter,
  interactiveStreams,
  isInteractive,
  type Prompter,
  type PromptStreams,
  type TextPromptOptions,
} from './cli/prompt.js';
export type { AccessChecks } from './core/access-checks.js';
export { loadBackupConfig, loadRestoreConfig, loadStatusConfig } from './core/config.js';
export { BackupError } from './core/errors.js';
export { type BackupManifest, backupObjectKeys, parseManifest } from './core/manifest.js';
export {
  ensureNoTemplatePlaceholder,
  ensureOpaqueSecret,
  ensureValidAgeIdentity,
  ensureValidAgeRecipient,
  ensureValidBackupPrefix,
  ensureValidManifestKey,
  ensureValidR2Bucket,
  ensureValidR2Endpoint,
  parseAppSchemas,
} from './core/validation.js';
export {
  ensureApplicationSchemasEmpty,
  getExistingSchemas,
  preflightFailureMessage,
} from './db/auth.js';
export {
  databaseLabel,
  ensureDifferentDatabases,
  parseDatabaseUrl,
  restoreTargetRef,
  toLibpqEnvironment,
} from './db/database-url.js';
export {
  ensureDumpToolsCompatible,
  ensureRestoreToolSupportsArchive,
  parsePostgresMajor,
} from './db/postgres-tools.js';
export {
  appRestoreArguments,
  authRestoreArguments,
  filterExistingSchemas,
  restore,
  restoreFollowUp,
} from './restore/restore.js';
export { getBackupStatus, listManifestKeys, status } from './status/status.js';
export type {
  LocalConfig,
  ObjectStore,
  R2Config,
  StorageAdapter,
  StorageAdapterInfo,
  StorageConfig,
  StorageDriver,
  StorageSettings,
} from './storage/index.js';
export {
  allStorageFields,
  createObjectStore,
  defaultStorageDriver,
  ensureValidStorageDriver,
  ensureValidStorageRoot,
  isStorageDriver,
  loadLocalConfig,
  loadR2Config,
  loadStorageConfig,
  localAdapter,
  localFields,
  LocalStore,
  r2Adapter,
  r2ErrorDetails,
  R2Store,
  readStorageDriver,
  readVerifiedArchives,
  storageAdapters,
  storageDriverField,
  storageDrivers,
  storageFields,
} from './storage/index.js';
export { redact } from './utils/redact.js';
