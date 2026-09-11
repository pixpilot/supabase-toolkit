import { describe, expect, it } from 'vitest';
import { authTriggerList } from '../src/restore-sql.js';

describe('auth trigger archive selection', () => {
  it('restores trigger definitions without replacing managed Auth tables or constraints', () => {
    const trigger = '4000; 2620 18000 TRIGGER auth users create_profile postgres';
    const otherTrigger =
      '4001; 2620 18001 TRIGGER auth identities update_identity postgres';
    const list = [
      '3000; 1259 17000 TABLE auth users supabase_auth_admin',
      '3001; 0 17000 TABLE DATA auth users supabase_auth_admin',
      '3002; 2606 17001 FK CONSTRAINT auth identities identities_user_id_fkey supabase_auth_admin',
      '3003; 0 0 ACL auth TABLE users supabase_auth_admin',
      trigger,
      otherTrigger,
      '4002; 2620 18002 TRIGGER public profiles ignore_me postgres',
    ].join('\n');
    expect(authTriggerList(list)).toBe(`${trigger}\n${otherTrigger}`);
    expect(authTriggerList('; empty archive')).toBe('');
  });
});
