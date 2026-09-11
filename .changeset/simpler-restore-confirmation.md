---
'@pixpilot/supabase-backup': minor
---

Confirm a restore target by reading it, not by retyping its address. The prompt
now prints the target and its user, names the project in the question, and takes
`YES` in capitals: `Are you sure you want to restore into <ref>? Type YES to
continue`. A pooler host is shared by every project in its region, so retyping
the old `<host>:<port>/<database>` label confirmed nothing about which database
was about to be overwritten, while being the longest thing to type.

`--confirm-target`, which carries the same confirmation for an unattended run,
now takes the Supabase project reference — the `<ref>` in a `postgres.<ref>`
pooler user or a `db.<ref>.supabase.co` host — and falls back to
`<host>:<port>/<database>` only where no such reference exists.

The question preceding it is shorter too: `Apply the restore to a target
database?` rather than a sentence warning that it writes data, which the typed
confirmation immediately after already makes plain.

The question that preceded it is gone. A restore started from a terminal now asks
for a target and confirms it, instead of first asking whether to apply at all:
someone who typed `restore` came to restore, and answering no left the run in its
least useful state, verifying the archive without even checking that a database
could accept it. An unattended run is unchanged and still writes nothing without
`--apply`, which is how an archive is verified. Both dry-run summaries now name
`--target-database-url` and `--apply` rather than the environment variables the
CLI stopped reading.
