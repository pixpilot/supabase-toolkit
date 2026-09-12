/** Resets grants on empty reused schemas before the archive's schema ACLs are applied. */
export function resetExistingSchemaPrivilegesSql(schemas: readonly string[]): string {
  if (!schemas.length) return '';
  const names = schemas.map((name) => `'${name.replaceAll("'", "''")}'`).join(', ');
  return `
DO $backup_schema_privileges$
DECLARE
  entry record;
  access record;
  recipient text;
BEGIN
  FOR entry IN
    SELECT nspname, nspowner, nspacl FROM pg_catalog.pg_namespace WHERE nspname IN (${names})
  LOOP
    FOR access IN SELECT DISTINCT grantee FROM aclexplode(COALESCE(entry.nspacl, acldefault('n', entry.nspowner))) LOOP
      recipient := CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(access.grantee)) END;
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %s', entry.nspname, recipient);
    END LOOP;
    EXECUTE format('GRANT ALL ON SCHEMA %I TO %I', entry.nspname, pg_get_userbyid(entry.nspowner));
    IF entry.nspname = 'public' THEN
      EXECUTE 'GRANT USAGE ON SCHEMA public TO PUBLIC';
    END IF;
  END LOOP;
END $backup_schema_privileges$;
`;
}
