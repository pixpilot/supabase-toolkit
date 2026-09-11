# @pixpilot/supabase-backup

## 1.7.0

### Minor Changes

- validate environment configuration and enhance error handling

### Patch Changes

- 455ee64: Validate environment configuration before any network call so a mistyped variable fails immediately with a message naming the field. Rejects an `R2_ENDPOINT` carrying a bucket path, credentials, or plain http; a non-bucket-name `R2_BUCKET`; R2 credentials containing whitespace from a multi-line paste; an age identity supplied where a recipient belongs (and the reverse for `AGE_IDENTITY`); a `BACKUP_PREFIX` that is a URL or has empty segments; and a connection string missing a user or still carrying `[YOUR-PASSWORD]`-style template placeholders. Also writes the restore identity file with a trailing newline so SSH private keys are accepted by `age`.

  Also reject incompatible PostgreSQL client programs before dumping: `pg_dump` older than the server major (read from `SHOW server_version` during the existing preflight), and `pg_restore` older than `pg_dump`, which otherwise fails with an unsupported file-header version. `restore` performs the same check against the `pgDumpVersion` recorded in the manifest.

## 1.6.2

### Patch Changes

- enhance error handling for subprocess failures
- 450b5c9: Include the failing subprocess's exit code and redacted stderr in CLI errors. `pg_dump`, `pg_restore`, and `age` failures previously reported only a fixed string with no diagnostics, and their stderr was piped but never consumed, which could stall a child that wrote more than the pipe buffer.

## 1.6.1

### Patch Changes

- improve error logging formatting
- pin S3 SDK and expose R2 error metadata
- f8c6bf8: Pin the S3 SDK used for R2 and include safe R2 error metadata in CLI failures.

## 1.6.0

### Minor Changes

- implement backup workflows
- scaffold backup package

### Patch Changes

- update workflow reference in README
- 8005fc3: fix repo url

## 1.5.0

### Minor Changes

- implement backup workflows
- scaffold backup package

### Patch Changes

- update workflow reference in README
- 613a53e: fix node version

## 1.4.0

### Minor Changes

- implement backup workflows
- scaffold backup package

### Patch Changes

- update workflow reference in README
- b40249b: fix for ci

## 1.3.0

### Minor Changes

- implement backup workflows
- scaffold backup package

### Patch Changes

- update workflow reference in README
- a6fadea: fix ci

## 1.2.0

### Minor Changes

- implement backup workflows
- scaffold backup package

### Patch Changes

- update workflow reference in README

## 1.1.0

### Minor Changes

- implement backup workflows
- scaffold backup package

### Patch Changes

- update workflow reference in README
