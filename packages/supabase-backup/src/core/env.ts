import { BackupError } from './errors.js';

/** Reads a configuration value that has no default and cannot be skipped. */
export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new BackupError(`${name} is required.`);
  return value;
}
