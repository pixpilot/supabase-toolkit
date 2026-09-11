---
'@pixpilot/supabase-backup': minor
---

Write each backup as one immutable folder, `BACKUP_PREFIX/v1/<UTC timestamp>/`, holding fixed names `app.dump.age`, `app.sha256`, `auth.dump.age`, `auth.sha256`, and `manifest.json`, replacing the previous `BACKUP_PREFIX/YYYY/MM/DD/<timestamp>.<name>` keys. Timestamps are compact UTC (`20260911T031700Z`) so folders still sort chronologically, and `v1` marks the key-layout generation. `status` now discovers manifests under `BACKUP_PREFIX/v1/` and no longer reports pre-`v1` backups; `restore --key` still reads them, because every manifest carries the full object keys of its own archives. Existing lifecycle rules scoped to `BACKUP_PREFIX/` continue to match.
