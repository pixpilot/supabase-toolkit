---
'@pixpilot/supabase-backup': minor
---

Pass `--dbname` to every restoring `pg_restore` call. The connection already
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
