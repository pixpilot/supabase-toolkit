# @pixpilot/supabase-backup

Encrypted backups of application schemas plus `auth.users` and `auth.identities`.
It is deliberately not full Supabase-project disaster recovery. Requires Node
22+, `pg_dump`, `pg_restore`, and `age`; direct PostgreSQL or the Supabase
Session Pooler on port 5432 is supported, while Transaction Pooler port 6543 is rejected.

## Backup

```bash
SOURCE_DATABASE_URL='postgresql://…' BACKUP_AGE_RECIPIENT='age1…' \
R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_ENDPOINT='https://<account>.r2.cloudflarestorage.com' \
R2_BUCKET='myapp-production-backups' BACKUP_PREFIX='production/database' \
npx @pixpilot/supabase-backup@1 backup
```

`APP_SCHEMAS` is comma-separated and defaults to `public`; `auth` is never an
application schema. Backups fail if non-empty `auth.mfa_factors`,
`auth.sso_providers`, or `auth.saml_providers` would be omitted. R2 must be a
private bucket with bucket-scoped credentials; configure retention/bucket lock
in R2, not the CLI.

```bash
npx @pixpilot/supabase-backup@1 status --max-age-hours 36
```

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
    uses: pixpilot/supabase-backup/.github/workflows/backup.yml@v1
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

Do not use `secrets: inherit`. Publish matching npm and `v1` workflow releases;
run a recovery drill immediately, quarterly, and after material Auth changes.
