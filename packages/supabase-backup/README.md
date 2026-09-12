# @pixpilot/supabase-backup

Encrypted backups of every schema a Supabase project owns, plus the rows of
`auth.users`, `auth.identities`, `storage.buckets`, and `storage.objects`,
captured from one consistent database snapshot.
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

`--prefix` defaults to `production/database`. Backups fail if non-empty `auth.mfa_factors`,
`auth.sso_providers`, or `auth.saml_providers` would be omitted. R2 must be a
private bucket with bucket-scoped credentials.

## What a backup takes

Left alone, a backup takes **every schema the project owns**, whole: `public`,
`drizzle`, Prisma or other tool schemas, anything added later, and
`supabase_migrations`, which is kept with both its definitions and its rows.
Nothing has to be named for a new schema to reach the backup.

Two groups are left out, because they are not the project's to define:

| Group            | Schemas                                                                                                                                                                         | Why                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| PostgreSQL's own | `pg_catalog`, `pg_toast`, `information_schema`, `pg_temp_*`, `pg_toast_temp_*`                                                                                                  | PostgreSQL maintains them for itself.              |
| Supabase-managed | `auth`, `storage`, `realtime`, `supabase_functions`, `graphql`, `graphql_public`, `extensions`, `pgsodium`, `pgsodium_masks`, `vault`, `pgbouncer`, `net`, `cron`, `_analytics` | Supabase defines them on every project it creates. |

The durable rows inside the managed ones are still backed up, table by table:
`auth.users`, `auth.identities`, `storage.buckets`, and `storage.objects`. They
are dumped and restored as data, never as definitions.

Two flags override the selection, and both are flags only — neither is ever
asked for at the prompt:

- `--schemas a,b` backs up **only** those schemas. Nothing is discovered, so a
  schema added later is not picked up until it is named. A schema the source
  database does not have fails the run rather than being skipped. Supabase-managed
  and PostgreSQL schemas are refused here; their data is backed up anyway.
- `--exclude-schemas a,b` drops schemas from whatever the run would take, whether
  discovered or named.

The managed `auth` and `storage` rows are backed up whichever flags are passed.

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
restore. It never drops existing objects. Existing empty application schemas
receive the archived ownership and grants. The restore role's target default
privileges are temporarily suspended while objects are created, then reinstated
before archived default privileges are replayed. This prevents target defaults
from adding permissions to restored objects. Any remaining ownership or access
mismatch still rolls back the entire restore, including the temporary changes.

Restore keeps the target's default privileges for Supabase's internal
`supabase_admin` role. Replaying these entries can fail with `permission denied
to change default privileges` because the project login cannot alter that role's
defaults. Application object grants, ownership, and other roles' default
privileges are still restored and existing-object access is validated before
commit. Review target defaults separately for objects created in the future.

New backups also record optional fingerprints of configured default privileges
(global and application-schema entries) and cluster-wide role memberships,
including grantors and ADMIN/INHERIT/SET options. After a successful restore
commits, the CLI reports whether these settings match the backup. Differences
or unavailable checks produce advisory messages; they do not fail the restore
or change memberships. Supabase-managed settings and unrelated cluster roles
can intentionally differ, so review these messages in context.

Advisory checks are enabled by default. Pass `restore --no-access-checks` to
disable them, or use `{ accessChecks: false }` with the `restore()` API. If a
check cannot run, the CLI explains this option. This flag only skips the new
advisories; row-count and existing-object ownership/permission validation remain
mandatory. Advisory mismatches never require retrying an already committed restore.

Older backups remain supported and print that the advisory checks are skipped.
Create a new backup to record the baseline. These checks compare catalog
configuration, not passwords, all role attributes, or full application access.

Verify existing-user login, new-user signup/profile creation, and an application
workflow afterward. Check access as `anon` and `authenticated`, including
functions and tables that must remain private.

## What a restore does not carry

A backup holds the application schemas, the rows and trigger definitions of
`auth.users` and `auth.identities`, and the rows of `storage.buckets` and
`storage.objects`. Everything below survives only because you recreate it, so a
recovery project is not usable until you have worked through this list. Plan the drill with that in mind, and keep the sources of these values
somewhere the loss of the project cannot take with it.

**Role definitions.** Application privileges and ownership are restored, but
roles themselves are not created. Supabase supplies its managed roles; create
any custom roles and required memberships on the target first. Missing roles or
incompatible access rules cause the restore transaction to roll back. RLS
policies and enabled/disabled RLS state are restored with their tables.

If restore reports `role "cloudflare_hyperdrive" does not exist`, create that
role in the **recovery project's Supabase dashboard → SQL Editor**, then retry:

```sql
CREATE ROLE "cloudflare_hyperdrive" NOLOGIN;
```

This allows the saved grants to be restored without enabling database logins.
Configure the role's login credentials and required memberships separately when
reconnecting Hyperdrive. A missing-role failure rolls back the restore transaction.

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

**Storage files and storage policies.** Bucket settings and object metadata in
`storage.buckets` and `storage.objects` are backed up and restored as rows, the
same way Auth rows are; both tables must be empty on the target. The files
themselves live in Supabase's object store and are not included, so restored
metadata points at objects you still have to re-upload. RLS policies on
`storage.objects` are captured in the archive but are not applied by a restore;
recreate them.

**The Supabase-managed schemas themselves.** Realtime publications, `cron` jobs,
queues, Vault secrets, and extensions installed into `extensions` live in schemas
Supabase defines, so their definitions and rows are not carried. A fresh project
brings its own.

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

- The prefix prompt offers `production/database` as its default, so pressing
  Enter accepts it. A default is only ever shown for a value that is safe to
  display, never for a secret. `--schemas` and `--exclude-schemas` are never
  asked for: left out, a backup takes every schema the project owns.
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

Storage options belong to the backend `--storage` selects. Only that backend's
options are required or asked for, so a `--storage local` run is never asked for
an R2 credential, and an R2 run is never asked for a directory. Passing an option
that belongs to one backend selects it, so `--storage-root` on its own is enough
to mean local. In a terminal, a run that passes no storage option is offered the
list to pick from, and one that names no command is offered the commands — which
is what a bare `supabase-backup` does.

| Option                         | Commands  | Purpose                                                           |
| ------------------------------ | --------- | ----------------------------------------------------------------- |
| `--storage <r2\|local>`        | all       | Where backups are kept. Default: `r2`.                            |
| `--r2-endpoint <url>`          | all       | `r2`: `https://<account-id>.r2.cloudflarestorage.com`.            |
| `--r2-bucket <name>`           | all       | `r2`: private bucket holding the backups.                         |
| `--r2-access-key-id <id>`      | all       | `r2`: access key ID.                                              |
| `--r2-secret-access-key <key>` | all       | `r2`: secret access key.                                          |
| `--storage-root <dir>`         | all       | `local`: directory that holds the backups.                        |
| `--source-database-url <url>`  | `backup`  | Database to back up.                                              |
| `--age-recipient <age1…>`      | `backup`  | Public recipient used to encrypt.                                 |
| `--age-identity <AGE-SECRET…>` | `restore` | Private identity used to decrypt.                                 |
| `--target-database-url <url>`  | `restore` | Database to restore into, required by `--apply`.                  |
| `--prefix <prefix>`            | all       | Object-key prefix. Default: `production/database`.                |
| `--schemas <a,b>`              | `backup`  | Back up only these schemas. Default: all the project owns.        |
| `--exclude-schemas <a,b>`      | `backup`  | Schemas to leave out.                                             |
| `--max-age-hours <hours>`      | `status`  | Fail when the newest backup is older.                             |
| `--key <manifest-key>`         | `restore` | Manifest to restore, ending in `.json`.                           |
| `--apply`                      | `restore` | Write to the target database; omit for a dry run.                 |
| `--no-access-checks`           | `restore` | Skip advisory default-grant and role-membership checks.           |
| `--confirm-target <ref>`       | `restore` | Typed confirmation: project ref, else `<host>:<port>/<database>`. |
| `--no-input`                   | all       | Never ask; fail when a value is missing.                          |
| `-v`, `--version`              | all       | Print the version that is running.                                |
| `-h`, `--help`                 | all       | Print the option list.                                            |

A database URL is treated as requiring TLS unless it says otherwise. A local
database serves none, so a run against one — `supabase start` listens on port
54322 — fails preflight with `The server does not support SSL connections` until
the URL carries `?sslmode=disable`:

```bash
--target-database-url 'postgresql://postgres:postgres@localhost:54322/postgres?sslmode=disable'
```

Use that only for a database on the same machine. A database reached over a
network must keep TLS on.

Every run prints the version it is on before it starts, to stderr so command
output stays machine readable. That matters because `@pixpilot/supabase-backup@3`
resolves to whichever 3.x is newest on the day it runs: a CI log from months ago
still says which release wrote that backup, and a run that picked up a newer one
says so up front. The same version is recorded in each manifest as `cliVersion`.

A flag value is visible to other processes and is kept in shell history. On a
personal or shared machine, leave `--r2-secret-access-key`, `--age-identity`,
`--source-database-url`, and `--target-database-url` out and answer their hidden
prompts instead; pass them as flags from a CI job, where the runner is yours
alone and the values are masked in the log.

## Storage backends

`--storage r2` is the default and is what an off-site backup wants. Every
command accepts `--storage local` instead, which reads and writes the same
object layout under a directory:

```bash
npx @pixpilot/supabase-backup status \
  --storage local \
  --storage-root /mnt/backups/supabase \
  --prefix 'production/database'
```

A local backup is written the same way an R2 one is: the same keys, the same age
encryption, and the same refusal to overwrite a key that already exists. What it
does not give you is distance from the database it came from, so treat a
directory on the database host as a staging step or a drill target rather than
as the copy you would restore from after losing that host. A mounted volume that
fails independently is the case where it stands on its own.

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

`postgres-client-version`, `package-version`, `app-schemas`, and
`exclude-schemas` are optional. Both schema inputs are empty by default, so the
backup takes every schema the project owns; set `app-schemas` only to restrict a
run to exactly the schemas you name. The workflow passes configuration as quoted
CLI flags.

`package-version` selects the published npm release and defaults to `'3'`, the
major this workflow's flags belong to. A major range takes fixes and minors
without letting a breaking release reach an unattended backup. Do not override it
with an older major: `1.x` is configured through environment variables and rejects
these flags, so `package-version: '1'` fails with `Unknown option
'--source-database-url'`. Pass an exact version instead if you want every run to
use a release you have reviewed, and accept that you must bump it to get fixes.
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
