---
'@pixpilot/supabase-backup': major
---

Capture row counts, access rules, and both archives from one shared PostgreSQL snapshot. Preserve application ownership and privileges and recover Auth table triggers. Require formatVersion 2 manifests and restore all database changes and validations in one transaction using psql. Verify uploaded and downloaded archive contents before publishing a manifest or reporting healthy status.

Recovery requires empty application schemas/Auth tables, matching roles and extensions, and compatible access rules. The reusable workflow now uses CLI flags; pin its package-version to this release after publication.
