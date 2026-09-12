/** Makes schema-only archive SQL reuse existing schemas, retaining ALTER OWNER statements. */
export function reuseExistingSchemas(sql: string, existing: readonly string[]): string {
  return sql.replace(
    /^CREATE SCHEMA ("(?:[^"]|"")*"|[A-Za-z_][\w$]*);\r?$/gmu,
    (statement: string, identifier: string) => {
      const name = identifier.startsWith('"')
        ? identifier.slice(1, -1).replaceAll('""', '"')
        : identifier;
      return existing.includes(name)
        ? statement.replace('CREATE SCHEMA ', 'CREATE SCHEMA IF NOT EXISTS ')
        : statement;
    },
  );
}
