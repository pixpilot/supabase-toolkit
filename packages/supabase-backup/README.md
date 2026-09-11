# @pixpilot/supabase-backup

Encrypted backups of application schemas plus `auth.users` and `auth.identities`.
It is deliberately not full Supabase-project disaster recovery. Requires Node
22+, `pg_dump`, `pg_restore`, and `age`; direct PostgreSQL or the Supabase
Session Pooler on port 5432 is supported, while Transaction Pooler port 6543 is rejected.

## Create an R2 bucket

Location: [Cloudflare Dashboard](https://dash.cloudflare.com/) → R2 Object Storage.

1. Select **Create bucket**.
2. Enter a bucket name, such as `myapp-production-backups`.
3. Choose the location and default storage class, then select **Create bucket**.

## Create R2 API credentials

Location: **Cloudflare Dashboard → R2 Object Storage → Account Details → Manage**
next to API Tokens.

1. Select **Create Account API token** or **Create User API token**.
2. Select **Object Read & Write** permission.
3. Scope the token to the backup bucket only.
4. Select **Create API Token**.
5. Copy the Access Key ID, Secret Access Key, and S3 endpoint. The secret is shown once.

## Generate an age encryption key

Location: a secure terminal on the machine where you will store the restore key.

1. Generate a key pair:

   ```bash
   age-keygen -o age-identity.txt
   ```

2. Copy the public recipient value for `--age-recipient`:

   ```bash
   age-keygen -y age-identity.txt
   ```

3. Store the `AGE-SECRET-KEY-…` line from `age-identity.txt` as the restore
   secret, passed later as `--age-identity` or typed at its prompt. Add `age-identity.txt` to `.gitignore` and store a
   second copy in your approved secret manager.

## Configure and run a backup

Location: your terminal or the repository that calls this reusable workflow.

1. Set the R2 values below from the bucket and API token you created.
2. For automatic expiry, configure [R2 lifecycle retention](#r2-lifecycle-retention)
   after creating the backup configuration.

Every value is a flag; the CLI reads no environment configuration. Leave any of
them out in a terminal and you are asked for it, so the shortest run is
`npx @pixpilot/supabase-backup@latest backup`.

```bash
npx @pixpilot/supabase-backup@latest backup \
  --source-database-url 'postgresql://…' \
  --age-recipient 'age1…' \
  --r2-access-key-id … \
  --r2-secret-access-key … \
  --r2-endpoint 'https://<account>.r2.cloudflarestorage.com' \
  --r2-bucket 'myapp-production-backups' \
  --prefix 'production/database'
```

Each run writes one immutable folder under `<prefix>/v1/<UTC timestamp>/`:

```text
myapp-production-backups
└── production/
    └── database/
        └── v1/
            ├── 20260910T031700Z/
            │   ├── app.dump.age
            │   ├── app.sha256
            │   ├── auth.dump.age
            │   ├── auth.sha256
            │   └── manifest.json
            └── 20260911T031700Z/
                └── …
```

`v1` is the key-layout generation and only changes if the structure does. Folder
names sort chronologically, so `status` finds the newest backup by listing
`<prefix>/v1/`.

`--prefix` defaults to `production/database`. `--schemas` is comma-separated and
defaults to `public`; `auth` is never an application schema. Backups fail if non-empty `auth.mfa_factors`,
`auth.sso_providers`, or `auth.saml_providers` would be omitted. R2 must be a
private bucket with bucket-scoped credentials.

## R2 lifecycle retention

Location: [Cloudflare R2](https://dash.cloudflare.com/) → R2 Object Storage →
your bucket → Settings → Object Lifecycle Rules.

1. Select **Add rule**.
2. Name the rule, such as `production-backups-30-days`.
3. Set the prefix to `production/database/v1/` — your `--prefix` plus `/v1/`.
4. Set **Delete objects** to `30` days.
5. Save the rule.

Cloudflare applies lifecycle deletion independently of this CLI; objects are
typically removed within 24 hours of their expiry. See Cloudflare's
[Object lifecycles documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
for lifecycle-rule limits and API/Wrangler configuration.

## Restore drill

Keep the age identity outside GitHub Actions and R2 credentials. Restore verifies
hashes, decrypts in a private temporary directory, inspects both archives, and
does nothing unless `--apply` is present. Apply only to a fresh recovery project.

```bash
npx @pixpilot/supabase-backup@latest restore \
  --key <manifest-key> \
  --age-identity 'AGE-SECRET-KEY-…' \
  --r2-access-key-id … \
  --r2-secret-access-key … \
  --r2-endpoint … \
  --r2-bucket … \
  --target-database-url 'postgresql://…' \
  --apply \
  --confirm-target '<host>:5432/<database>'
```

Running `restore` with no flags walks you through the same steps, including a
list of the newest backups to choose from.

Apply restores Auth data before application data and only ever adds objects: it
requires the target Auth tables and the application schemas to be empty, and
rejects a target matching `--source-database-url`. If the target already holds
those tables, restore into a fresh recovery database, or drop and recreate the
schema first — `pg_restore --clean` cannot make room for you, because its
`DROP … IF EXISTS` statements still fail when the table an object belongs to is
missing. Verify user login and a representative application workflow manually
afterward.

## Interactive prompts

Location: your terminal.

Any value a command needs and was not passed as a flag is asked for when both
stdin and stderr are a terminal. Only what is missing is asked, so
`restore --key <manifest-key>` never asks about the key again:

```bash
npx @pixpilot/supabase-backup@latest restore \
  --r2-endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --r2-bucket 'roleclick-backups' \
  --r2-access-key-id … \
  --r2-secret-access-key … \
  --age-identity 'AGE-SECRET-KEY-…' \
  --prefix production/database
# Select a backup to restore (newest first):
#   1) 2026-09-11 13:10 UTC  (20 minutes old)  20260911T131038Z
#   2) 2026-09-10 03:17 UTC  (34 hours old)  20260910T031700Z
#   3) 2026-09-09 03:17 UTC  (2 days old)  20260909T031700Z
#   4) Enter another manifest key
# Select 1-4: 1
# Apply this backup to the target database? It writes data. [y/N]: y
# Target database URL to restore into:
# Type 'db.example.test:5432/postgres' to confirm the restore target:
```

Backups are listed newest first, ten at a time, from `--prefix`. Leave `--prefix`
out as well and it is asked for, with `production/database` offered as the
default. Answering `n` to the apply question keeps the run a dry run: it still
downloads, verifies the checksums, decrypts, and inspects both archives.

- The prefix prompt offers `production/database` as its default and `--schemas`
  offers `public`, so pressing Enter accepts them. A default is only ever shown
  for a value that is safe to display, never for a secret.
- A secret typed at the prompt is not echoed and never reaches the process
  arguments, which are visible to other processes and are kept in shell history.
  Prefer the prompt over `--r2-secret-access-key`, `--age-identity`, and the two
  database URL flags on a shared or personal machine.
- Every value is collected before the command starts, so a run never stops
  halfway to ask a question.
- `--apply` still requires the typed target label, whether it comes from
  `--confirm-target` or from the prompt.
- Prompts are written to stderr, so `stdout` stays machine readable.

Non-terminal sessions, including GitHub Actions, never prompt: a missing value
fails immediately naming the flag to pass. Add `--no-input` to get that behaviour
in a terminal, for example inside a wrapper script. `--help` lists every option.

## Command reference

Location: your terminal, a wrapper script, or a CI job.

The CLI reads no environment variables. Every flag is optional in a terminal,
where anything missing is asked for; the commands below pass everything
explicitly, which is what an unattended run needs. `--no-input` makes that
explicit: it fails on a missing value instead of asking, so a script never
blocks.

| Option                         | Commands  | Purpose                                            |
| ------------------------------ | --------- | -------------------------------------------------- |
| `--r2-endpoint <url>`          | all       | `https://<account-id>.r2.cloudflarestorage.com`.   |
| `--r2-bucket <name>`           | all       | Private bucket holding the backups.                |
| `--r2-access-key-id <id>`      | all       | R2 access key ID.                                  |
| `--r2-secret-access-key <key>` | all       | R2 secret access key.                              |
| `--source-database-url <url>`  | `backup`  | Database to back up.                               |
| `--age-recipient <age1…>`      | `backup`  | Public recipient used to encrypt.                  |
| `--age-identity <AGE-SECRET…>` | `restore` | Private identity used to decrypt.                  |
| `--target-database-url <url>`  | `restore` | Database to restore into, required by `--apply`.   |
| `--prefix <prefix>`            | all       | Object-key prefix. Default: `production/database`. |
| `--schemas <a,b>`              | `backup`  | Application schemas. Default: `public`.            |
| `--max-age-hours <hours>`      | `status`  | Fail when the newest backup is older.              |
| `--key <manifest-key>`         | `restore` | Manifest to restore, ending in `.json`.            |
| `--apply`                      | `restore` | Write to the target database; omit for a dry run.  |
| `--confirm-target <label>`     | `restore` | Typed confirmation, `<host>:<port>/<database>`.    |
| `--no-input`                   | all       | Never ask; fail when a value is missing.           |
| `-h`, `--help`                 | all       | Print the option list.                             |

A flag value is visible to other processes and is kept in shell history. On a
personal or shared machine, leave `--r2-secret-access-key`, `--age-identity`,
`--source-database-url`, and `--target-database-url` out and answer their hidden
prompts instead; pass them as flags from a CI job, where the runner is yours
alone and the values are masked in the log.

Backup, with every flag it accepts:

```bash
npx @pixpilot/supabase-backup@latest backup \
  --source-database-url 'postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres' \
  --age-recipient 'age1…' \
  --r2-access-key-id … \
  --r2-secret-access-key … \
  --r2-endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --r2-bucket 'roleclick-backups' \
  --prefix production/database \
  --schemas public \
  --no-input
```

Status, with every flag it accepts:

```bash
npx @pixpilot/supabase-backup@latest status \
  --r2-access-key-id … \
  --r2-secret-access-key … \
  --r2-endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --r2-bucket 'roleclick-backups' \
  --prefix production/database \
  --max-age-hours 36 \
  --no-input
```

Restore as a dry run, which verifies and decrypts the archives and writes nothing:

```bash
npx @pixpilot/supabase-backup@latest restore \
  --key production/database/v1/20260911T131038Z/manifest.json \
  --age-identity 'AGE-SECRET-KEY-…' \
  --r2-access-key-id … \
  --r2-secret-access-key … \
  --r2-endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --r2-bucket 'roleclick-backups' \
  --no-input
```

Restore with every flag, applying to a fresh recovery database:

```bash
npx @pixpilot/supabase-backup@latest restore \
  --key production/database/v1/20260911T131038Z/manifest.json \
  --age-identity 'AGE-SECRET-KEY-…' \
  --r2-access-key-id … \
  --r2-secret-access-key … \
  --r2-endpoint 'https://<account-id>.r2.cloudflarestorage.com' \
  --r2-bucket 'roleclick-backups' \
  --target-database-url 'postgresql://postgres:<password>@db.<recovery-ref>.supabase.co:5432/postgres' \
  --source-database-url 'postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres' \
  --prefix production/database \
  --apply \
  --confirm-target 'db.<recovery-ref>.supabase.co:5432/postgres' \
  --no-input
```

`--confirm-target` must equal the `<host>:<port>/<database>` of
`--target-database-url` exactly, or the restore stops before touching anything.
`--source-database-url` is optional here and only used to refuse a target that is
the source. `--prefix` is unnecessary once `--key` is given, because the manifest
carries the object keys of its own archives.

## Reusable workflow

`.github/workflows/backup.yml` is `workflow_call`, has no schedule, and never
receives the age identity. Consumers own schedule, concurrency, configuration,
and notifications:

```yaml
name: Database Backup
on:
  workflow_dispatch:
  schedule:
    - cron: '17 3 * * *'
permissions:
  contents: read
concurrency:
  group: production-database-backup
  cancel-in-progress: false
jobs:
  backup:
    uses: pixpilot/supabase-toolkit/.github/workflows/backup.yml@main
    with:
      backup-prefix: production/database
      age-recipient: ${{ vars.BACKUP_AGE_RECIPIENT }}
      r2-endpoint: ${{ vars.R2_ENDPOINT }}
      r2-bucket: ${{ vars.R2_BUCKET }}
      max-age-hours: 36
    secrets:
      database-url: ${{ secrets.SOURCE_DATABASE_URL }}
      r2-access-key-id: ${{ secrets.R2_ACCESS_KEY_ID }}
      r2-secret-access-key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

`postgres-client-version` and `package-version` are optional. `package-version` is
the npm range the job runs (`npx @pixpilot/supabase-backup@<range>`) and defaults to
the major the workflow is written against, so a breaking release cannot reach a
scheduled backup on its own. Pass `latest` if you would rather follow every
release, and expect to update the workflow when a major lands.

`postgres-client-version` selects the `postgresql-client-<major>` package installed
from the PostgreSQL APT repository; it defaults to `17`. It must be greater than or
equal to your Supabase server's major version, otherwise `pg_dump` aborts with a
server version mismatch. Check yours with `select version()` in the SQL editor.

Publish matching npm and `v1` workflow releases; run a recovery drill immediately,
quarterly, and after material Auth changes.

## Verify

Location: your terminal and **Cloudflare Dashboard → R2 Object Storage → your
bucket**.

1. Run the health check, answering the prompts or passing the connection flags
   listed in the [command reference](#command-reference):

   ```bash
   npx @pixpilot/supabase-backup@latest status --max-age-hours 36
   ```

2. Confirm it prints a completed manifest key.
3. Open the R2 bucket and confirm one `<prefix>/v1/<timestamp>/` folder holds
   `manifest.json` plus the encrypted app and Auth archives and their checksums.
4. Open **Settings → Object Lifecycle Rules** and confirm the enabled rule matches
   `<prefix>/v1/` and its retention period.

## Gotchas

- Do not use `secrets: inherit`; pass only the three required secrets explicitly.
- Lifecycle deletion is asynchronous and typically occurs within 24 hours after expiry.
- Backups written before `v1` used a `<prefix>/YYYY/MM/DD/<timestamp>.*` layout.
  `status` no longer sees them; `restore --key` still reads them, because a manifest
  carries the full object keys of its own archives. Keep the old lifecycle rule until
  those objects expire.
