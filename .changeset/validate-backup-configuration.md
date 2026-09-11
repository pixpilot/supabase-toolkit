---
'@pixpilot/supabase-backup': patch
---

Validate environment configuration before any network call so a mistyped variable fails immediately with a message naming the field. Rejects an `R2_ENDPOINT` carrying a bucket path, credentials, or plain http; a non-bucket-name `R2_BUCKET`; R2 credentials containing whitespace from a multi-line paste; an age identity supplied where a recipient belongs (and the reverse for `AGE_IDENTITY`); a `BACKUP_PREFIX` that is a URL or has empty segments; and a connection string missing a user or still carrying `[YOUR-PASSWORD]`-style template placeholders. Also writes the restore identity file with a trailing newline so SSH private keys are accepted by `age`.

Also reject incompatible PostgreSQL client programs before dumping: `pg_dump` older than the server major (read from `SHOW server_version` during the existing preflight), and `pg_restore` older than `pg_dump`, which otherwise fails with an unsupported file-header version. `restore` performs the same check against the `pgDumpVersion` recorded in the manifest.
