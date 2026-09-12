import { BackupError } from './errors.js';
import { isManagedSchema, isSystemSchema } from './schemas.js';

/**
 * Input checks for environment-supplied configuration.
 *
 * Every rule here rejects only values that cannot work, so a valid deployment is
 * never blocked. Messages never echo the value itself, because several of these
 * fields are secrets.
 */

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Matches the uppercase bracketed tokens used in connection-string templates. */
const templatePlaceholder = /\[[A-Z][A-Z0-9-]*\]/u;

/** Detects C0 control characters and DEL without a control-character regex literal. */
function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

/** Rejects credentials carrying whitespace or a URL, which always means a bad paste. */
export function ensureOpaqueSecret(name: string, value: string): void {
  if (/\s/u.test(value)) {
    throw new BackupError(
      `${name} contains whitespace, which usually means it was pasted across multiple lines. Store it as a single line.`,
    );
  }
  if (/^[a-z][\w+.-]*:\/\//iu.test(value))
    throw new BackupError(
      `${name} looks like a URL. It must be the credential value only.`,
    );
}

/** Requires a bare HTTPS S3 endpoint so the bucket is never folded into the host. */
export function ensureValidR2Endpoint(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BackupError(
      'R2_ENDPOINT must be an absolute URL such as https://<account-id>.r2.cloudflarestorage.com.',
    );
  }
  if (url.username || url.password) {
    throw new BackupError(
      'R2_ENDPOINT must not embed credentials. Supply them through R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.',
    );
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && loopbackHosts.has(url.hostname))
  )
    throw new BackupError('R2_ENDPOINT must use https.');
  if (url.search || url.hash)
    throw new BackupError('R2_ENDPOINT must not include a query string or fragment.');
  if (url.pathname !== '/') {
    throw new BackupError(
      'R2_ENDPOINT must not include a path. The bucket name belongs in R2_BUCKET, not in the endpoint.',
    );
  }
}

/** Requires a bare bucket name rather than a URL, a path, or an unusable name. */
export function ensureValidR2Bucket(value: string): void {
  if (value.includes('/')) {
    throw new BackupError(
      'R2_BUCKET must be the bucket name only, without a URL, a path, or a key prefix.',
    );
  }
  if (/\s/u.test(value)) throw new BackupError('R2_BUCKET must not contain whitespace.');
  if (value.length < 3 || value.length > 63)
    throw new BackupError('R2_BUCKET must be between 3 and 63 characters.');
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(value)) {
    throw new BackupError(
      'R2_BUCKET must use lowercase letters, digits, hyphens, or dots, and must start and end with a letter or digit.',
    );
  }
}

/** Requires an age public recipient and refuses a private identity used in its place. */
export function ensureValidAgeRecipient(value: string): void {
  if (/AGE-SECRET-KEY-/iu.test(value)) {
    throw new BackupError(
      'BACKUP_AGE_RECIPIENT is an age identity (private key). Use the matching public recipient, which starts with age1.',
    );
  }
  if (value.startsWith('ssh-rsa ') || value.startsWith('ssh-ed25519 ')) return;
  if (!value.startsWith('age1')) {
    throw new BackupError(
      'BACKUP_AGE_RECIPIENT must be an age recipient starting with age1, or an ssh-rsa/ssh-ed25519 public key.',
    );
  }
  if (/\s/u.test(value))
    throw new BackupError('BACKUP_AGE_RECIPIENT must not contain whitespace.');
}

/** Requires an age private identity and refuses a public recipient used in its place. */
export function ensureValidAgeIdentity(value: string): void {
  if (/AGE-SECRET-KEY-/iu.test(value) || value.includes('-----BEGIN ')) return;
  if (value.startsWith('age1')) {
    throw new BackupError(
      'AGE_IDENTITY is an age recipient (public key). Use the matching private identity, which starts with AGE-SECRET-KEY-1.',
    );
  }
  throw new BackupError(
    'AGE_IDENTITY must be an age identity containing AGE-SECRET-KEY-1, or an SSH private key.',
  );
}

/** Requires an object-key prefix that cannot escape its namespace or break key parsing. */
export function ensureValidBackupPrefix(value: string): void {
  if (!value || value.includes('..'))
    throw new BackupError('BACKUP_PREFIX must be a non-empty object-key prefix.');
  if (/[\s\u005C]/u.test(value) || hasControlCharacter(value)) {
    throw new BackupError(
      'BACKUP_PREFIX must not contain whitespace, backslashes, or control characters.',
    );
  }
  if (value.includes('://'))
    throw new BackupError('BACKUP_PREFIX must be an object-key prefix, not a URL.');
  if (value.includes('//'))
    throw new BackupError('BACKUP_PREFIX must not contain empty path segments.');
}

/** Rejects a connection string whose template placeholders were never filled in. */
export function ensureNoTemplatePlaceholder(value: string): void {
  if (templatePlaceholder.test(value)) {
    throw new BackupError(
      'Database URL still contains a placeholder such as [YOUR-PASSWORD] from the Supabase connection-string template. Replace it with the real value.',
    );
  }
}

/** Requires an immutable manifest key that cannot escape the backup namespace. */
export function ensureValidManifestKey(value: string): void {
  if (!value.endsWith('.json') || value.includes('..'))
    throw new BackupError(
      '--key must be an immutable backup manifest key ending in .json.',
    );
}

/** Splits and validates a comma-separated schema list into schema identifiers. */
export function parseSchemaList(value: string): string[] {
  const schemas = value
    .split(',')
    .map((schema) => schema.trim())
    .filter(Boolean);
  if (schemas.some((schema) => !/^[A-Za-z_][\w$]*$/u.test(schema)))
    throw new BackupError('Schema lists must be comma-separated schema names.');
  return schemas;
}

/**
 * Splits and validates the comma-separated list of schemas to back up whole.
 *
 * PostgreSQL's own catalogs and the schemas Supabase defines are refused here.
 * Their definitions belong to the platform, and the durable rows inside `auth`
 * and `storage` are backed up as data on their own.
 */
export function parseAppSchemas(value: string): string[] {
  const schemas = parseSchemaList(value);
  const refused = schemas.filter(
    (schema) => isSystemSchema(schema) || isManagedSchema(schema),
  );
  if (!schemas.length || refused.length) {
    throw new BackupError(
      `--schemas must name application schemas${
        refused.length
          ? `; ${refused.join(', ')} ${refused.length > 1 ? 'are' : 'is'} maintained by PostgreSQL or Supabase and cannot be dumped whole`
          : ''
      }.`,
    );
  }
  return schemas;
}
