---
'@pixpilot/supabase-backup': major
---

Take every value as a flag and ask for what is missing. The CLI no longer reads
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
