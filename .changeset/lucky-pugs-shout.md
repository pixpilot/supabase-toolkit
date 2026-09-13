---
'@pixpilot/supabase-backup': minor
---

Make a backup restorable on a project that is not identical to the source.

- Record the source's extensions in the manifest, and check them against the
  restore target before anything is written. No archive installs an extension,
  because `pg_dump` of named schemas writes no `CREATE EXTENSION`, so a missing
  one used to surface partway through a restore; every missing extension is now
  named at once, up front.
- Leave out schemas holding only objects an extension installed, such as `pgmq`,
  `pgtle`, or PostGIS's `tiger`. Dumping them whole carried definitions the
  target already has once the extension is enabled, which blocked the restore. A
  schema holding anything the project created is still taken whole, and `public`
  is never treated this way.
- Stop treating an extension's own objects inside an application schema as a
  reason a target is too full to restore into. PostGIS and pg_partman install
  tables, functions, and types into `public`, and a restore neither carries nor
  recreates them, so a recovery project with those extensions enabled used to be
  refused outright. They are also no longer counted as application tables, which
  compared the two installations' reference data rather than anything backed up.
- Leave `_realtime` and `_supavisor` to Supabase, alongside the managed schemas
  already listed. A local or self-hosted stack keeps them in the project
  database, where they were taken whole and then blocked the restore.
- Record the PostgreSQL server version the source actually reported. `SHOW`
  returns the setting under its own name, so the column read was always empty and
  every backup recorded `unknown`, which silently disabled the check that refuses
  a `pg_dump` older than the server it is dumping.
- Stop re-applying the managed-schema rules while reading a manifest. Those rules
  belong to the run that wrote it: growing the managed list made an existing
  backup unreadable on the day its archive was still needed. Manifests are still
  checked for shape, identifiers, counts, and duplicates.
- Honour `sslmode=verify-ca` and `sslmode=verify-full` on the preflight
  connection instead of silently skipping certificate verification on the one
  connection that carries the password.
- Report R2 status codes and request IDs on failed uploads, downloads, and
  listings, the way object lookups already did.
