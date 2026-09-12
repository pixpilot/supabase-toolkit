export interface AccessChecks {
  version: 1;
  defaultPrivilegesFingerprint: string;
  roleMembershipsFingerprint: string;
}

/** Validates optional advisory metadata without changing the backup format version. */
export function isAccessChecks(value: unknown): value is AccessChecks {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AccessChecks>;
  return (
    entry.version === 1 &&
    [entry.defaultPrivilegesFingerprint, entry.roleMembershipsFingerprint].every(
      (fingerprint) =>
        typeof fingerprint === 'string' && /^[a-f0-9]{32}$/u.test(fingerprint),
    )
  );
}

/** Fingerprints configured global/schema defaults and cluster-wide membership grants by role name. */
export function accessChecksSql(schemas: readonly string[]): string {
  const names = schemas.map((name) => `'${name.replaceAll("'", "''")}'`).join(', ');
  return `
WITH defaults AS (
  SELECT pg_catalog.jsonb_build_array(
    pg_catalog.pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype::text,
    ARRAY(SELECT a::text FROM pg_catalog.unnest(d.defaclacl) a ORDER BY a::text COLLATE "C")
  )::text AS entry
  FROM pg_catalog.pg_default_acl d
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
  WHERE d.defaclnamespace = 0 OR n.nspname IN (${names})
), memberships AS (
  SELECT pg_catalog.jsonb_build_array(
    pg_catalog.pg_get_userbyid(m.roleid), r.rolname, pg_catalog.pg_get_userbyid(m.grantor),
    m.admin_option,
    COALESCE((pg_catalog.to_jsonb(m)->>'inherit_option')::boolean, r.rolinherit),
    COALESCE((pg_catalog.to_jsonb(m)->>'set_option')::boolean, true)
  )::text AS entry
  FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid = m.member
)
SELECT pg_catalog.jsonb_build_object(
  'version', 1,
  'defaultPrivilegesFingerprint', (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(entry, E'\\n' ORDER BY entry COLLATE "C"), '')) FROM defaults),
  'roleMembershipsFingerprint', (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(entry, E'\\n' ORDER BY entry COLLATE "C"), '')) FROM memberships)
) AS snapshot`;
}
