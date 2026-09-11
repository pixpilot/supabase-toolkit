import type { ProgramRunner } from './process.js';

import { BackupError } from './errors.js';

/**
 * Guards against PostgreSQL client programs that cannot handle the work asked of them.
 *
 * Two mismatches produce failures whose own error text explains little. A `pg_dump`
 * older than the server aborts before writing anything, and Debian-style packaging
 * installs `pg_dump` and `pg_restore` as `pg_wrapper` symlinks that each choose a
 * version at run time, so an archive can reach a `pg_restore` too old to read it.
 */

const pathHint =
  'Put a single PostgreSQL client major version first on PATH, for example /usr/lib/postgresql/<major>/bin.';

/**
 * Extracts the major version from a `--version` banner or a `server_version` value.
 *
 * Returns undefined for anything unrecognised so callers defer to the real command
 * rather than blocking a working setup.
 */
export function parsePostgresMajor(value: string): number | undefined {
  const match =
    /\(PostgreSQL\)\s+(\d+)/iu.exec(value) ??
    /^\s*v?(\d+)(?:\.|\b)/u.exec(value) ??
    /\b(\d+)(?:\.\d+|devel|beta|rc)/u.exec(value);
  const major = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isInteger(major) && major > 0 ? major : undefined;
}

/**
 * Verifies the client programs can dump this server, and returns the `pg_dump` banner.
 *
 * `pg_dump` must be at least the server major, and `pg_restore` must be at least the
 * `pg_dump` major. Newer is always fine in both directions, so only older is rejected.
 */
export async function ensureDumpToolsCompatible(
  runner: ProgramRunner,
  serverVersion?: string,
): Promise<string> {
  const [dumpBanner, restoreBanner] = await Promise.all([
    runner.run('pg_dump', ['--version']),
    runner.run('pg_restore', ['--version']),
  ]);
  const dumpMajor = parsePostgresMajor(dumpBanner);
  const restoreMajor = parsePostgresMajor(restoreBanner);
  const serverMajor = serverVersion ? parsePostgresMajor(serverVersion) : undefined;
  if (dumpMajor !== undefined && serverMajor !== undefined && dumpMajor < serverMajor) {
    throw new BackupError(
      `pg_dump ${dumpMajor} cannot dump a PostgreSQL ${serverMajor} server. Install PostgreSQL client ${serverMajor} or newer. ${pathHint}`,
    );
  }
  if (dumpMajor !== undefined && restoreMajor !== undefined && restoreMajor < dumpMajor) {
    throw new BackupError(
      `pg_restore ${restoreMajor} cannot read archives written by pg_dump ${dumpMajor}. ${pathHint}`,
    );
  }
  return dumpBanner;
}

/** Verifies the local `pg_restore` is new enough for the `pg_dump` that wrote a backup. */
export async function ensureRestoreToolSupportsArchive(
  runner: ProgramRunner,
  archivePgDumpVersion: string,
): Promise<void> {
  const archiveMajor = parsePostgresMajor(archivePgDumpVersion);
  const restoreMajor = parsePostgresMajor(await runner.run('pg_restore', ['--version']));
  if (
    archiveMajor !== undefined &&
    restoreMajor !== undefined &&
    restoreMajor < archiveMajor
  ) {
    throw new BackupError(
      `This backup was written by pg_dump ${archiveMajor} but the local pg_restore is ${restoreMajor}, which cannot read it. Install PostgreSQL client ${archiveMajor} or newer. ${pathHint}`,
    );
  }
}
