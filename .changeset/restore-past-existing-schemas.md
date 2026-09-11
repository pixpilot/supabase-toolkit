---
'@pixpilot/supabase-backup': patch
---

Restore past the archive's own `CREATE SCHEMA`. `pg_dump --schema=<name>` always
records the schema it was pointed at, and every database already owns `public`,
so applying aborted on the first statement with `schema "public" already exists`.
The target's existing schemas are now removed from the archive's table of
contents before it is restored, leaving everything inside them untouched, while a
schema the target genuinely lacks is still created.

A failed preflight connection now reports why. It names the host, port, and
database that were tried and the driver's own reason, with credentials redacted,
instead of the bare `Database preflight connection failed.` A direct
`db.<project-ref>.supabase.co` host that cannot be reached also points at the
Session Pooler, which is the usual cause without the IPv4 add-on.

Auth data is restored again. `pg_restore --table` takes a bare table name and
ignores any schema written into it, so `--table=auth.users` matched nothing and
the run reported success having inserted no rows; the application data that
followed then failed to add its foreign keys to `auth.users`. The schema now
travels in `--schema`, and the Auth row counts are checked immediately after the
Auth phase rather than at the end, so an empty restore is caught before anything
depends on it.
