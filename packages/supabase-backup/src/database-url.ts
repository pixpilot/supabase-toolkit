import { BackupError } from './errors.js';
import { ensureNoTemplatePlaceholder } from './validation.js';

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
