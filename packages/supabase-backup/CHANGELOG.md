# @pixpilot/supabase-backup

## 2.1.0

### Minor Changes

- enhance restore process with database name handling and schema checks
- e908032: Pass `--dbname` to every restoring `pg_restore` call. The connection already
  reached the tool through the libpq environment, which keeps the password out of
  the process arguments, but `--dbname` has no environment equivalent: PostgreSQL
  16 and later abort with `one of -d/--dbname and -f/--file must be specified`, and
  earlier versions printed SQL to stdout instead of restoring. `restore --apply`
  now writes to the target database as intended.

  `restore --apply` also stopped passing `--clean --if-exists`, which could never
  work: those `DROP … IF EXISTS` statements guard the object but not the table it
  belongs to, so restoring into a fresh recovery database aborted on the first
  policy, trigger, or constraint whose table was absent. A restore now only ever
  adds objects, and a new preflight requires the target application schemas to be
  empty, naming the tables that are in the way and how to clear them.

## 2.0.0

### Major Changes

- 803efb1: Take every value as a flag and ask for what is missing. The CLI no longer reads
  the environment: `--source-database-url`, `--target-database-url`,
  `--age-recipient`, `--age-identity`, `--r2-endpoint`, `--r2-bucket`,
  `--r2-access-key-id`, `--r2-secret-access-key`, `--prefix`, and `--schemas`
  replace `SOURCE_DATABASE_URL`, `TARGET_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`,
  `AGE_IDENTITY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `BACKUP_PREFIX`, and `APP_SCHEMAS`. The library entry
  points still take the same configuration object, so only the CLI changes.

  Anything a flag did not supply is asked for when the session is a terminal, so
  `restore` with no `--key` lists the newest backups to pick from, and `--apply`
  asks for the target database URL and the typed target confirmation. A value that
  was passed is never asked about again, a secret typed at the prompt is not echoed
  and never reaches the process arguments, prompts go to stderr, and every value is
  resolved before the command starts.

  `--prefix` defaults to `production/database` and `--schemas` to `public`. A
  non-terminal session, such as CI, never prompts: it fails naming the flag to
  pass, which `--no-input` also forces in a terminal.

  Adds `--no-input` and `--help`, and unknown options now fail instead of being
  ignored. The reusable workflow passes the new flags.

### Minor Changes

- update package version to `latest` in workflow and documentation
- enhance backup restoration process with detailed timestamps
- refactor command-line interface for improved input handling
- update version to 1.8.0 and enhance CLI functionality
- enhance CLI prompts for missing inputs and defaults
- 803efb1: Write each backup as one immutable folder, `BACKUP_PREFIX/v1/<UTC timestamp>/`, holding fixed names `app.dump.age`, `app.sha256`, `auth.dump.age`, `auth.sha256`, and `manifest.json`, replacing the previous `BACKUP_PREFIX/YYYY/MM/DD/<timestamp>.<name>` keys. Timestamps are compact UTC (`20260911T031700Z`) so folders still sort chronologically, and `v1` marks the key-layout generation. `status` now discovers manifests under `BACKUP_PREFIX/v1/` and no longer reports pre-`v1` backups; `restore --key` still reads them, because every manifest carries the full object keys of its own archives. Existing lifecycle rules scoped to `BACKUP_PREFIX/` continue to match.

## 1.8.0

### Minor Changes

- add interactive CLI and versioned backups
- 803efb1: Ask for missing CLI input instead of failing. `backup`, `status`, and `restore`
  now prompt for any value that was not supplied by a flag or the environment when
  the session is a terminal, so `restore` with no `--key` lists the newest backups
  to pick from, and `--apply` asks for the target database URL and the typed target
  confirmation. A value that is already present is never asked about again.

  Secrets are accepted only from the environment or a hidden prompt, never from a
  flag, and typed secrets are not echoed. Prompts go to stderr, every value is
  resolved before the command starts, and non-terminal sessions such as CI never
  prompt: they fail immediately naming the missing variable, which `--no-input`
  also forces in a terminal.

  Adds `--prefix`, `--schemas`, `--no-input`, and `--help`, and unknown options now
  fail instead of being ignored.

- 803efb1: Write each backup as one immutable folder, `BACKUP_PREFIX/v1/<UTC timestamp>/`, holding fixed names `app.dump.age`, `app.sha256`, `auth.dump.age`, `auth.sha256`, and `manifest.json`, replacing the previous `BACKUP_PREFIX/YYYY/MM/DD/<timestamp>.<name>` keys. Timestamps are compact UTC (`20260911T031700Z`) so folders still sort chronologically, and `v1` marks the key-layout generation. `status` now discovers manifests under `BACKUP_PREFIX/v1/` and no longer reports pre-`v1` backups; `restore --key` still reads them, because every manifest carries the full object keys of its own archives. Existing lifecycle rules scoped to `BACKUP_PREFIX/` continue to match.

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
