---
'@pixpilot/supabase-backup': patch
---

Explain missing-role restore failures with a recovery-only CREATE ROLE ... NOLOGIN instruction, without skipping permissions or automatically granting access. Verify that the failed restore rolls back and a retry succeeds after recreating the role.
