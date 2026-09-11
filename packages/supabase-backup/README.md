# @pixpilot/supabase-backup

Encrypted backups of application schemas plus `auth.users`, `auth.identities`,
and their trigger definitions, captured from one consistent database snapshot.
It is deliberately not full Supabase-project disaster recovery: read
[what a restore does not carry](#what-a-restore-does-not-carry) before relying on
it. Requires Node
22+, `pg_dump`, `pg_restore`, `psql`, and `age`; direct PostgreSQL or the Supabase
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

Manifests require `formatVersion: 2`. Counts, application access rules, and both
archives use the same exported PostgreSQL snapshot. Application ownership,
GRANT/REVOKE rules, and RLS policies are preserved. Auth table definitions are
stored so their triggers can be recovered; restore never replaces the managed
Auth tables. Uploaded archives are downloaded and verified before the manifest
is published.

`--prefix` defaults to `production/database`. `--schemas` is comma-separated and
defaults to `public`; `auth` is never an application schema. Backups fail if non-empty `auth.mfa_factors`,
`auth.sso_providers`, or `auth.saml_providers` would be omitted. R2 must be a
private bucket with bucket-scoped credentials.

## R2 lifecycle retention

Location: [Cloudflare R2](https://dash.cloudflare.com/) → R2 Object Storage →
your bucket → Settings → Object Lifecycle Rules.

1. Select **Add rule**.
2. Name the rule, such as `production-backups-30-days`.
3. Set the prefix to `production/database/` — your `--prefix` plus a trailing
   slash.
4. Set **Delete objects** to `30` days.
5. Save the rule.

Stopping at `--prefix` covers every key layout, so a future generation beside
`v1/`, and the pre-`v1` `YYYY/MM/DD/` keys, expire under the same rule. Keep the
trailing slash: without it the rule would also match a sibling such as
`production/database-archive/`. Scope it to `production/database/v1/` instead
only if you keep something under that prefix that must not expire.

Each object is deleted on its own clock, that many days after it was written, so
the newest backup is never at risk: the prefix decides which objects the age
applies to, not what is deleted now. Thirty daily backups under a 30-day rule
settle into a rolling 30-day window.

Cloudflare applies lifecycle deletion independently of this CLI; objects are
typically removed within 24 hours of their expiry. See Cloudflare's
[Object lifecycles documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
for lifecycle-rule limits and API/Wrangler configuration.

## Restore drill

Keep the age identity outside GitHub Actions and R2 credentials. Use a fresh
recovery project with matching Supabase Auth schema, required extensions, and
application roles. Application schemas must contain no objects, and the two
Auth tables must be empty with no custom triggers. Keep application traffic
away from the recovery project until verification is complete.

Restore verifies hashes, decrypts in a private temporary directory, and renders
SQL before writing to the target. Noninteractive restore needs `--apply`;
interactive restore asks for an explicit target confirmation.

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
  --confirm-target '<recovery-project-ref>'
```

Running `restore` with no flags walks you through the same steps, including a
list of the newest backups to choose from.

Apply locks and rechecks the empty Auth tables, restores Auth rows, application
objects, and Auth triggers, then validates counts and application ownership and
privileges before committing. These steps run in one `psql --single-transaction`
session with `ON_ERROR_STOP`: any SQL or validation failure rolls back the
restore. It never drops existing objects. If target default privileges would
change access, restore fails rather than committing those differences.

Verify existing-user login, new-user signup/profile creation, and an application
workflow afterward. Check access as `anon` and `authenticated`, including
functions and tables that must remain private.

## What a restore does not carry

A backup holds the application schemas plus the rows and trigger definitions
of `auth.users` and `auth.identities`. Everything below survives only because you
recreate it, so a recovery project is not usable until you have worked through
this list. Plan the drill with that in mind, and keep the sources of these values
somewhere the loss of the project cannot take with it.

**Role definitions.** Application privileges and ownership are restored, but
roles themselves are not created. Supabase supplies its managed roles; create
any custom roles and required memberships on the target first. Missing roles or
incompatible access rules cause the restore transaction to roll back. RLS
policies and enabled/disabled RLS state are restored with their tables.

**Auth configuration and the rest of Auth.** Providers and their secrets, SMTP,
email templates, redirect URLs, rate limits, the JWT secret, and Auth Hooks are
project settings held outside PostgreSQL. Point a hook at its restored function
again under **Supabase dashboard → Authentication → Hooks**. Database triggers
attached to the two backed-up Auth tables are restored automatically after
application data; their custom functions must be in a backed-up application
schema. Other Auth table changes are managed by Supabase and are not applied.

Only `auth.users` and `auth.identities` are backed up, so sessions and refresh
tokens are gone and every user signs in again. MFA factors and SSO/SAML
providers are refused at backup time rather than silently dropped.

**Everything in other schemas.** Storage buckets and object metadata live in
`storage` and the files themselves live in Supabase's object store; neither is
included. The same applies to Realtime publications, `cron` jobs, queues, Vault
secrets, extensions installed into `extensions`, and any schema you did not name
in `--schemas`.

**Everything outside the database.** Edge functions, their secrets, API keys,
custom domains, network restrictions, and the project's own settings.

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
# Target database URL to restore into:
# Restore target: aws-1-eu-west-1.pooler.supabase.com:5432/postgres
#                 user postgres.abcdefghijklmnopqrst
# Are you sure you want to restore into 'abcdefghijklmnopqrst'? Type YES to continue:
```

Backups are listed newest first, ten at a time, from `--prefix`. Leave `--prefix`
out as well and it is asked for, with `production/database` offered as the
default.

A terminal session restores: it asks for the target and makes you confirm it,
rather than asking whether you meant to. To verify an archive without writing
anything, run it unattended instead — without `--apply` it downloads, checks the
checksums, decrypts, inspects both archives, and stops.

- The prefix prompt offers `production/database` as its default and `--schemas`
  offers `public`, so pressing Enter accepts them. A default is only ever shown
  for a value that is safe to display, never for a secret.
- A secret typed at the prompt is not echoed and never reaches the process
  arguments, which are visible to other processes and are kept in shell history.
  Prefer the prompt over `--r2-secret-access-key`, `--age-identity`, and the two
  database URL flags on a shared or personal machine.
- Every value is collected before the command starts, so a run never stops
  halfway to ask a question.
- A restore from a terminal always ends in a write, so `--apply` is implied
  there; unattended, nothing is written without it.
- The target is confirmed before anything is written. At the prompt the target is
  printed and the question names it, and `YES` in capitals continues; nothing
  else does. Unattended, `--confirm-target` carries that name instead: the
  Supabase project reference, or `<host>:<port>/<database>` for a database that
  has none. The address is never what you retype, because a pooler host is shared
  by every project in its region and would confirm nothing.
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

| Option                         | Commands  | Purpose                                                           |
| ------------------------------ | --------- | ----------------------------------------------------------------- |
| `--r2-endpoint <url>`          | all       | `https://<account-id>.r2.cloudflarestorage.com`.                  |
| `--r2-bucket <name>`           | all       | Private bucket holding the backups.                               |
| `--r2-access-key-id <id>`      | all       | R2 access key ID.                                                 |
| `--r2-secret-access-key <key>` | all       | R2 secret access key.                                             |
| `--source-database-url <url>`  | `backup`  | Database to back up.                                              |
| `--age-recipient <age1…>`      | `backup`  | Public recipient used to encrypt.                                 |
| `--age-identity <AGE-SECRET…>` | `restore` | Private identity used to decrypt.                                 |
| `--target-database-url <url>`  | `restore` | Database to restore into, required by `--apply`.                  |
| `--prefix <prefix>`            | all       | Object-key prefix. Default: `production/database`.                |
| `--schemas <a,b>`              | `backup`  | Application schemas. Default: `public`.                           |
| `--max-age-hours <hours>`      | `status`  | Fail when the newest backup is older.                             |
| `--key <manifest-key>`         | `restore` | Manifest to restore, ending in `.json`.                           |
| `--apply`                      | `restore` | Write to the target database; omit for a dry run.                 |
| `--confirm-target <ref>`       | `restore` | Typed confirmation: project ref, else `<host>:<port>/<database>`. |
| `--no-input`                   | all       | Never ask; fail when a value is missing.                          |
| `-h`, `--help`                 | all       | Print the option list.                                            |

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
  --confirm-target '<recovery-ref>' \
  --no-input
```

`--confirm-target` must exactly equal the target's Supabase project reference —
the `<ref>` in a `postgres.<ref>` pooler user or a `db.<ref>.supabase.co` host —
or, for a database with no such reference, its `<host>:<port>/<database>`. It
stops the restore before anything is touched.
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

`postgres-client-version`, `package-version`, and `app-schemas` are optional.
`app-schemas` defaults to `public`; list all application schemas that must be
recovered. The workflow passes configuration as quoted CLI flags.

`package-version` selects the published npm release. **Publish the recovery-safety
release and set this input to that exact version before relying on these
guarantees in Actions.** The checked-in default remains the already published
`2.2.0` until the new release is available; it does not contain these fixes.
Pin the reusable workflow to a reviewed commit as well.

`postgres-client-version` selects the `postgresql-client-<major>` package installed
from the PostgreSQL APT repository; it defaults to `17`. It must be greater than or
equal to your Supabase server's major version, otherwise `pg_dump` aborts with a
server version mismatch. Check yours with `select version()` in the SQL editor.

Publish matching npm and workflow releases; run a recovery drill immediately,
quarterly, and after material Auth changes.

## Development checks

Run `pnpm --filter @pixpilot/supabase-backup typecheck` and
`pnpm --filter @pixpilot/supabase-backup test` from the repository root.
`pnpm --filter @pixpilot/supabase-backup test:integration` additionally needs
Docker and PostgreSQL client tools on PATH. It creates and removes a disposable
local PostgreSQL container with synthetic data. The integration suite uses real
dump/restore tools; encryption and R2 are substituted, so a real encrypted R2
restore drill is still required before production adoption.

## Verify

Location: your terminal and **Cloudflare Dashboard → R2 Object Storage → your
bucket**.

1. Run the health check, answering the prompts or passing the connection flags
   listed in the [command reference](#command-reference):

   ```bash
   npx @pixpilot/supabase-backup@latest status --max-age-hours 36
   ```

2. Confirm it reports verified encrypted archive integrity and a completed manifest key.
3. Open the R2 bucket and confirm one `<prefix>/v1/<timestamp>/` folder holds
   `manifest.json` plus the encrypted app and Auth archives and their checksums.
4. Open **Settings → Object Lifecycle Rules** and confirm the enabled rule matches
   `<prefix>/` and its retention period.

## Gotchas

- Do not use `secrets: inherit`; pass only the three required secrets explicitly.
- Lifecycle deletion is asynchronous and typically occurs within 24 hours after expiry.
- `status` downloads both encrypted archives to check their lengths and SHA-256 hashes; it does not prove a database restore will succeed.
- New backups also download their uploaded archives for verification before publishing the manifest.
- Keep `pg_dump`, `pg_restore`, and `psql` from the same PostgreSQL client installation.
- Required custom roles, extensions, and target default privileges must be compatible before recovery.
- A restore failure rolls back database changes; it does not undo external effects from untrusted SQL functions. Restore only trusted backups into an isolated recovery project.
