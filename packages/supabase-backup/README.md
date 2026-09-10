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

## Configure and run a backup

Location: your terminal or the repository that calls this reusable workflow.

1. Set the R2 values below from the bucket and API token you created.
2. For automatic expiry, configure [R2 lifecycle retention](#r2-lifecycle-retention)
   after creating the backup configuration.

```bash
SOURCE_DATABASE_URL='postgresql://…' BACKUP_AGE_RECIPIENT='age1…' \
R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_ENDPOINT='https://<account>.r2.cloudflarestorage.com' \
R2_BUCKET='myapp-production-backups' BACKUP_PREFIX='production/database' \
npx @pixpilot/supabase-backup@1 backup
```

`APP_SCHEMAS` is comma-separated and defaults to `public`; `auth` is never an
application schema. Backups fail if non-empty `auth.mfa_factors`,
`auth.sso_providers`, or `auth.saml_providers` would be omitted. R2 must be a
private bucket with bucket-scoped credentials.

## R2 lifecycle retention

Location: [Cloudflare R2](https://dash.cloudflare.com/) → R2 Object Storage →
your bucket → Settings → Object Lifecycle Rules.

1. Select **Add rule**.
2. Name the rule, such as `production-backups-30-days`.
3. Set the prefix to `production/database/` — your `BACKUP_PREFIX` plus `/`.
4. Set **Delete objects** to `30` days.
5. Save the rule.

Cloudflare applies lifecycle deletion independently of this CLI; objects are
typically removed within 24 hours of their expiry. See Cloudflare's
[Object lifecycles documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
for lifecycle-rule limits and API/Wrangler configuration.

## Restore drill

Keep `AGE_IDENTITY` outside GitHub Actions and R2 credentials. Restore verifies
hashes, decrypts in a private temporary directory, inspects both archives, and
does nothing unless `--apply` is present. Apply only to a fresh recovery project.

```bash
AGE_IDENTITY='AGE-SECRET-KEY-…' R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
R2_ENDPOINT=… R2_BUCKET=… TARGET_DATABASE_URL='postgresql://…' \
npx @pixpilot/supabase-backup@1 restore --key <manifest-key> --apply \
  --confirm-target '<host>:5432/<database>'
```

Apply restores Auth data before application data, never cleans `auth`, requires
empty target Auth tables, and rejects a target matching `SOURCE_DATABASE_URL`.
Verify user login and a representative application workflow manually afterward.

## Reusable workflow

`.github/workflows/backup.yml` is `workflow_call`, has no schedule, and never
receives `AGE_IDENTITY`. Consumers own schedule, concurrency, configuration,
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
      package-version: '1'
    secrets:
      database-url: ${{ secrets.SOURCE_DATABASE_URL }}
      r2-access-key-id: ${{ secrets.R2_ACCESS_KEY_ID }}
      r2-secret-access-key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

Publish matching npm and `v1` workflow releases; run a recovery drill immediately,
quarterly, and after material Auth changes.

## Verify

Location: your terminal and **Cloudflare Dashboard → R2 Object Storage → your
bucket**.

1. Run the health check:

   ```bash
   npx @pixpilot/supabase-backup@1 status --max-age-hours 36
   ```

2. Confirm it prints a completed manifest key.
3. Open the R2 bucket and confirm the manifest plus encrypted app and Auth archives
   appear under your `BACKUP_PREFIX`.
4. Open **Settings → Object Lifecycle Rules** and confirm the enabled rule matches
   `BACKUP_PREFIX/` and its retention period.

## Gotchas

- Do not use `secrets: inherit`; pass only the three required secrets explicitly.
- Lifecycle deletion is asynchronous and typically occurs within 24 hours after expiry.
