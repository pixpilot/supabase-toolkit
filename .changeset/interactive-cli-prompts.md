---
'@pixpilot/supabase-backup': minor
---

Ask for missing CLI input instead of failing. `backup`, `status`, and `restore`
now prompt for any value that was not supplied by a flag or the environment when
the session is a terminal, so `restore` with no `--key` lists the newest backups
to pick from, and `--apply` asks for the target database URL and the typed target
confirmation. A value that is already present is never asked about again.

Secrets are accepted only from the environment or a hidden prompt, never from a
flag, and typed secrets are not echoed. Prompts go to stderr, every value is
resolved before the command starts, and non-terminal sessions such as CI never
prompt: they fail immediately naming the missing variable, which `--no-input`
also forces in a terminal.

Adds `--prefix`, `--schemas`, `--no-input`, and `--help`, and unknown options now
fail instead of being ignored.
