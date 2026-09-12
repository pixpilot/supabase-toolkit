/** Leaves Supabase's internal-role defaults on the target while preserving object ACLs. */
export function filterManagedDefaultPrivileges(list: string): string {
  // The project login cannot ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin.
  const managedDefault =
    /^\s*\d+;\s+\d+\s+\d+\s+DEFAULT ACL\s+\S+\s+DEFAULT PRIVILEGES FOR (?:TABLES|SEQUENCES|FUNCTIONS|TYPES|SCHEMAS|LARGE OBJECTS)\s+supabase_admin\s*$/u;
  return list
    .split('\n')
    .filter((line) => !managedDefault.test(line))
    .join('\n');
}
