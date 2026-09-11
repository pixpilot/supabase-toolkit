---
'@pixpilot/supabase-backup': patch
---

Say what a restored database still needs. A completed `restore --apply` now ends
with the work that no backup can carry: the grants, the Auth Hook that has to be
pointed back at its function, the rest of the Auth configuration, and everything
living outside the backed-up schemas. It is printed where a recovery is actually
happening rather than only in the README, and it notes that sessions are gone, so
sign-in is the first thing to check.
