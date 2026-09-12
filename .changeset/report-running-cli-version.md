---
'@pixpilot/supabase-backup': minor
---

Report the version that is running. Every command now prints `supabase-backup <version>` to stderr before it starts, and `-v` / `--version` prints it on its own. An `npx …@3` invocation resolves to whichever 3.x is newest on the day it runs, so a CI log now records which release actually wrote a backup.
