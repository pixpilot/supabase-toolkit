/** Saves and suspends the restore role's defaults while application objects are created. */
export function prepareRestoreDefaultsSql(schemas: readonly string[]): string {
  const names = schemas.map((name) => `'${name.replaceAll("'", "''")}'`).join(', ');
  return `
CREATE TEMP TABLE backup_restore_defaults ON COMMIT DROP AS
SELECT d.defaclnamespace, d.defaclobjtype, d.defaclacl
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
WHERE d.defaclrole = current_user::regrole
  AND (d.defaclnamespace = 0 OR n.nspname IN (${names}));
${defaultPrivilegesSql(false)}`;
}

/** Restores the saved target defaults before replaying defaults from the archive. */
export function restoreTargetDefaultsSql(): string {
  return defaultPrivilegesSql(true);
}

const suspendDefaults = `
    FOR access IN SELECT DISTINCT grantee FROM aclexplode(entry.defaclacl) LOOP
      recipient := CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(access.grantee)) END;
      EXECUTE command || format(' REVOKE ALL ON %s FROM %s', object_kind, recipient);
    END LOOP;
    IF entry.defaclnamespace = 0 THEN
      EXECUTE command || format(' GRANT ALL ON %s TO %I', object_kind, current_user);
      IF entry.defaclobjtype IN ('f', 'T') THEN
        EXECUTE command || format(' GRANT %s ON %s TO PUBLIC',
          CASE entry.defaclobjtype WHEN 'f' THEN 'EXECUTE' ELSE 'USAGE' END, object_kind);
      END IF;
    END IF;`;

const restoreDefaults = `
    IF entry.defaclnamespace = 0 THEN
      EXECUTE command || format(' REVOKE ALL ON %s FROM %I, PUBLIC', object_kind, current_user);
    END IF;
    FOR access IN
      SELECT grantee, is_grantable, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
      FROM aclexplode(entry.defaclacl) GROUP BY grantee, is_grantable
    LOOP
      recipient := CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(access.grantee)) END;
      EXECUTE command || format(' GRANT %s ON %s TO %s%s', access.privileges, object_kind,
        recipient, CASE WHEN access.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;`;

function defaultPrivilegesSql(restore: boolean): string {
  return `
DO $backup_defaults$
DECLARE
  entry record;
  access record;
  object_kind text;
  command text;
  recipient text;
BEGIN
  FOR entry IN SELECT * FROM pg_temp.backup_restore_defaults LOOP
    object_kind := CASE entry.defaclobjtype
      WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
      WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' WHEN 'L' THEN 'LARGE OBJECTS'
    END;
    IF object_kind IS NULL THEN
      RAISE EXCEPTION 'Unsupported default privilege object type: %', entry.defaclobjtype;
    END IF;
    command := format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s', current_user,
      CASE WHEN entry.defaclnamespace = 0 THEN '' ELSE
        format(' IN SCHEMA %I', (SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = entry.defaclnamespace)) END);
    ${restore ? restoreDefaults : suspendDefaults}
  END LOOP;
END $backup_defaults$;
`;
}
