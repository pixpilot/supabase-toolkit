import { BackupError } from '../core/errors.js';
import { ensureNoTemplatePlaceholder } from '../core/validation.js';

export interface DatabaseConnection {
  database: string;
  host: string;
  password: string;
  port: string;
  sslmode: string;
  user: string;
}

/** Parses a PostgreSQL URL without retaining it in process arguments. */
export function parseDatabaseUrl(value: string): DatabaseConnection {
  ensureNoTemplatePlaceholder(value);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BackupError('Database URL must be a valid PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  ) {
    throw new BackupError('Database URL must include protocol, host, and database name.');
  }
  if (!url.username) {
    throw new BackupError(
      'Database URL must include the database user, for example postgresql://postgres:<password>@host:5432/postgres.',
    );
  }
  const port = url.port || '5432';
  if (port === '6543') {
    throw new BackupError(
      'Port 6543 is the Transaction Pooler and cannot be used for backup or restore. Use direct PostgreSQL or the Session Pooler on port 5432.',
    );
  }
  return {
    host: url.hostname,
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    sslmode: url.searchParams.get('sslmode') || 'require',
  };
}

/** Converts a parsed URL to the libpq environment passed to PostgreSQL tools. */
export function toLibpqEnvironment(connection: DatabaseConnection): NodeJS.ProcessEnv {
  return {
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    PGSSLMODE: connection.sslmode,
  };
}

/** Produces a non-secret target label used for typed restore confirmation. */
export function databaseLabel(connection: DatabaseConnection): string {
  return `${connection.host}:${connection.port}/${connection.database}`;
}

/** Supabase pooler hosts are shared, so the project lives in the user name. */
const poolerHost = /\.pooler\.supabase\.(?:com|co)$/u;

/** A direct Supabase host carries the project reference itself. */
const directHost = /^db\.([a-z0-9]{16,})\.supabase\.(?:com|co)$/u;

/** Pooler users are '<role>.<project-ref>'. */
const poolerUser = /^[A-Za-z_][\w$]*\.([a-z0-9]{16,})$/u;

/**
 * Names the shortest value that still identifies the database being written to.
 *
 * A typed confirmation is only worth typing when getting it wrong means you were
 * about to overwrite the wrong database. `databaseLabel` cannot do that for a
 * Supabase pooler target: every project in a region shares the host, port, and
 * database name, and only the user names the project. The project reference is
 * used where one exists, and the full label everywhere else.
 */
export function restoreTargetRef(connection: DatabaseConnection): string {
  const direct = directHost.exec(connection.host);
  if (direct?.[1]) return direct[1];
  if (poolerHost.test(connection.host)) {
    const pooled = poolerUser.exec(connection.user);
    if (pooled?.[1]) return pooled[1];
  }
  return databaseLabel(connection);
}

/** Prevents a configured source database from also being used as a restore target. */
export function ensureDifferentDatabases(
  source: DatabaseConnection | undefined,
  target: DatabaseConnection,
): void {
  if (
    source &&
    databaseLabel(source) === databaseLabel(target) &&
    source.user === target.user
  ) {
    throw new BackupError(
      'TARGET_DATABASE_URL resolves to SOURCE_DATABASE_URL. Restore into a fresh recovery target instead.',
    );
  }
}
