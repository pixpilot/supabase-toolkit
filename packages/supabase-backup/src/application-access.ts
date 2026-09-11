/** Produces a stable digest of application ownership and effective object ACLs. */
export function applicationAccessSql(schemas: string[]): string {
  const names = schemas.map((schema) => `'${schema.replace(/'/gu, "''")}'`).join(', ');
  return `
SELECT md5(COALESCE(string_agg(json_build_array(kind, name, owner, privileges)::text, E'\\n' ORDER BY kind COLLATE "C", name COLLATE "C"), '')) AS fingerprint
FROM (
  SELECT 'schema' AS kind, n.nspname::text AS name, pg_get_userbyid(n.nspowner)::text AS owner,
    ARRAY(SELECT a::text FROM unnest(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a ORDER BY a::text COLLATE "C") AS privileges
  FROM pg_namespace n WHERE n.nspname IN (${names})
  UNION ALL
  SELECT 'relation', n.nspname || '.' || c.relname, pg_get_userbyid(c.relowner),
    ARRAY(SELECT a::text FROM unnest(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) a ORDER BY a::text COLLATE "C")
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN (${names}) AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_userbyid(p.proowner),
    ARRAY(SELECT a::text FROM unnest(COALESCE(p.proacl, acldefault('f', p.proowner))) a ORDER BY a::text COLLATE "C")
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN (${names})
  UNION ALL
  SELECT 'type', n.nspname || '.' || t.typname, pg_get_userbyid(t.typowner),
    ARRAY(SELECT a::text FROM unnest(COALESCE(t.typacl, acldefault('T', t.typowner))) a ORDER BY a::text COLLATE "C")
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname IN (${names})
  UNION ALL
  SELECT 'column', n.nspname || '.' || c.relname || '.' || att.attname, pg_get_userbyid(c.relowner),
    ARRAY(SELECT a::text FROM unnest(att.attacl) a ORDER BY a::text COLLATE "C")
  FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN (${names}) AND att.attnum > 0 AND NOT att.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
) access_entries`;
}
