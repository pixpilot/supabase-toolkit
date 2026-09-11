---
'@pixpilot/supabase-backup': patch
---

Include the failing subprocess's exit code and redacted stderr in CLI errors. `pg_dump`, `pg_restore`, and `age` failures previously reported only a fixed string with no diagnostics, and their stderr was piped but never consumed, which could stall a child that wrote more than the pipe buffer.
