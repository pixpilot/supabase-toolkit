import { describe, expect, it } from 'vitest';
import { filterManagedDefaultPrivileges } from '../src/restore/filter-managed-default-privileges.js';

describe('managed default privileges', () => {
  it('skips only default ACL entries owned by supabase_admin', () => {
    const retained = [
      '; DEFAULT ACL entries follow',
      '4; 2615 2200 SCHEMA - public postgres',
      '218; 1259 16399 TABLE public profiles postgres',
      '3456; 0 16399 TABLE DATA public profiles postgres',
      '3457; 0 0 ACL public TABLE profiles supabase_admin',
      '3458; 0 0 ACL - SCHEMA public supabase_admin',
      '3459; 3256 16420 POLICY public profiles read_profiles postgres',
      '3460; 826 16421 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres',
      '3461; 826 16422 DEFAULT ACL public DEFAULT PRIVILEGES FOR FUNCTIONS app_owner',
      '3462; 826 16423 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES supabase_admin_custom',
      '3463; 826 16424 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES custom supabase_admin',
      '',
    ];
    const managed = ['TABLES', 'SEQUENCES', 'FUNCTIONS', 'TYPES'].map(
      (kind, index) =>
        `${3500 + index}; 826 ${16500 + index} DEFAULT ACL public DEFAULT PRIVILEGES FOR ${kind} supabase_admin`,
    );
    expect(filterManagedDefaultPrivileges([...retained, ...managed].join('\n'))).toBe(
      retained.join('\n'),
    );
  });

  it('handles Windows line endings and preserves entries when no managed defaults exist', () => {
    const retained = '4; 2615 2200 SCHEMA - public postgres\r\n';
    const managed =
      '3500; 826 16500 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES supabase_admin\r\n';
    expect(filterManagedDefaultPrivileges(retained + managed)).toBe(retained);
    expect(filterManagedDefaultPrivileges(retained)).toBe(retained);
    expect(filterManagedDefaultPrivileges('')).toBe('');
  });
});
