import { describe, expect, it } from 'vitest';
import { reuseExistingSchemas } from '../src/reuse-existing-schemas.js';

describe('reusing existing schemas', () => {
  it('preserves ownership and quoting while making only existing schema creation idempotent', () => {
    const sql = [
      'CREATE SCHEMA public;',
      'ALTER SCHEMA public OWNER TO "application owner";',
      'CREATE SCHEMA "CamelCase";',
      'ALTER SCHEMA "CamelCase" OWNER TO postgres;',
      'CREATE SCHEMA billing;',
      '-- CREATE SCHEMA public;',
      '',
    ].join('\r\n');
    expect(reuseExistingSchemas(sql, ['public', 'CamelCase'])).toBe(
      sql
        .replace('CREATE SCHEMA public;', 'CREATE SCHEMA IF NOT EXISTS public;')
        .replace(
          'CREATE SCHEMA "CamelCase";',
          'CREATE SCHEMA IF NOT EXISTS "CamelCase";',
        ),
    );
    expect(reuseExistingSchemas(sql, [])).toBe(sql);
  });
});
