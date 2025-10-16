import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCamelCaseDb, keysToCamelCase, keysToSnakeCase } from '../src/index';

// Mock types for testing
interface TestDatabase {
  public: {
    Tables: {
      jobs: {
        Row: {
          job_id: string;
          short_description: string;
          is_active: boolean;
          created_at: string;
          meta_data: Record<string, unknown>;
        };
        Insert: {
          job_id?: string;
          short_description: string;
          is_active?: boolean;
          created_at?: string;
          meta_data?: Record<string, unknown>;
        };
        Update: {
          job_id?: string;
          short_description?: string;
          is_active?: boolean;
          created_at?: string;
          meta_data?: Record<string, unknown>;
        };
      };
      users: {
        Row: {
          user_id: string;
          user_name: string;
          email_address: string;
          is_active: boolean;
        };
        Insert: {
          user_id?: string;
          user_name: string;
          email_address: string;
          is_active?: boolean;
        };
        Update: {
          user_id?: string;
          user_name?: string;
          email_address?: string;
          is_active?: boolean;
        };
      };
    };
  };
}

// Helper function to create a mock table with chainable methods
function createMockTable() {
  const mockTable: any = {
    select: vi.fn().mockReturnValue(
      Promise.resolve({
        data: [
          {
            user_id: '123',
            user_name: 'John Doe',
            email_address: 'john@example.com',
            is_active: true,
          },
        ],
        error: null,
        count: null,
        status: 200,
        statusText: 'OK',
      }),
    ),
    insert: vi.fn().mockReturnValue(
      Promise.resolve({
        data: [
          {
            user_id: '456',
            user_name: 'Jane Doe',
            email_address: 'jane@example.com',
            is_active: true,
          },
        ],
        error: null,
        count: null,
        status: 201,
        statusText: 'Created',
      }),
    ),
    upsert: vi.fn().mockReturnValue(
      Promise.resolve({
        data: [
          {
            user_id: '789',
            user_name: 'Bob Smith',
            email_address: 'bob@example.com',
            is_active: false,
          },
        ],
        error: null,
        count: null,
        status: 201,
        statusText: 'Created',
      }),
    ),
    update: vi.fn().mockReturnValue(
      Promise.resolve({
        data: [
          {
            user_id: '123',
            user_name: 'Updated User',
            email_address: 'updated@example.com',
            is_active: false,
          },
        ],
        error: null,
        count: null,
        status: 200,
        statusText: 'OK',
      }),
    ),
    delete: vi.fn().mockReturnValue(
      Promise.resolve({
        data: [
          {
            user_id: '123',
            user_name: 'Deleted User',
            email_address: 'deleted@example.com',
            is_active: true,
          },
        ],
        error: null,
        count: null,
        status: 200,
        statusText: 'OK',
      }),
    ),
    eq: vi.fn(),
    neq: vi.fn(),
    gt: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    lte: vi.fn(),
    like: vi.fn(),
    likeAllOf: vi.fn(),
    likeAnyOf: vi.fn(),
    ilike: vi.fn(),
    ilikeAllOf: vi.fn(),
    ilikeAnyOf: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    contains: vi.fn(),
    containedBy: vi.fn(),
    rangeGt: vi.fn(),
    rangeGte: vi.fn(),
    rangeLt: vi.fn(),
    rangeLte: vi.fn(),
    rangeAdjacent: vi.fn(),
    overlaps: vi.fn(),
    textSearch: vi.fn(),
    match: vi.fn(),
    not: vi.fn(),
    or: vi.fn(),
    filter: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };

  // Make all filter methods chainable
  mockTable.eq.mockReturnValue(mockTable);
  mockTable.neq.mockReturnValue(mockTable);
  mockTable.gt.mockReturnValue(mockTable);
  mockTable.gte.mockReturnValue(mockTable);
  mockTable.lt.mockReturnValue(mockTable);
  mockTable.lte.mockReturnValue(mockTable);
  mockTable.like.mockReturnValue(mockTable);
  mockTable.likeAllOf.mockReturnValue(mockTable);
  mockTable.likeAnyOf.mockReturnValue(mockTable);
  mockTable.ilike.mockReturnValue(mockTable);
  mockTable.ilikeAllOf.mockReturnValue(mockTable);
  mockTable.ilikeAnyOf.mockReturnValue(mockTable);
  mockTable.is.mockReturnValue(mockTable);
  mockTable.in.mockReturnValue(mockTable);
  mockTable.contains.mockReturnValue(mockTable);
  mockTable.containedBy.mockReturnValue(mockTable);
  mockTable.rangeGt.mockReturnValue(mockTable);
  mockTable.rangeGte.mockReturnValue(mockTable);
  mockTable.rangeLt.mockReturnValue(mockTable);
  mockTable.rangeLte.mockReturnValue(mockTable);
  mockTable.rangeAdjacent.mockReturnValue(mockTable);
  mockTable.overlaps.mockReturnValue(mockTable);
  mockTable.textSearch.mockReturnValue(mockTable);
  mockTable.match.mockReturnValue(mockTable);
  mockTable.not.mockReturnValue(mockTable);
  mockTable.or.mockReturnValue(mockTable);
  mockTable.filter.mockReturnValue(mockTable);
  mockTable.order.mockReturnValue(mockTable);
  mockTable.limit.mockReturnValue(mockTable);
  mockTable.range.mockReturnValue(mockTable);
  mockTable.single.mockReturnValue(mockTable);
  mockTable.maybeSingle.mockReturnValue(mockTable);

  return mockTable;
}

describe('utility functions', () => {
  describe('keysToSnakeCase', () => {
    it('should convert object keys from camelCase to snake_case', () => {
      const input = { jobId: '123', shortDescription: 'Test', isActive: true };
      const result = keysToSnakeCase(input);
      expect(result).toEqual({
        job_id: '123',
        short_description: 'Test',
        is_active: true,
      });
    });

    it('should handle null and undefined', () => {
      expect(keysToSnakeCase(null)).toBe(null);
      expect(keysToSnakeCase(undefined)).toBe(undefined);
    });

    it('should handle arrays', () => {
      const input = [
        { jobId: '1', isActive: true },
        { jobId: '2', isActive: false },
      ];
      const result = keysToSnakeCase(input);
      expect(result).toEqual([
        { job_id: '1', is_active: true },
        { job_id: '2', is_active: false },
      ]);
    });
  });

  describe('keysToCamelCase', () => {
    it('should convert object keys from snake_case to camelCase', () => {
      const input = { job_id: '123', short_description: 'Test', is_active: true };
      const result = keysToCamelCase(input);
      expect(result).toEqual({ jobId: '123', shortDescription: 'Test', isActive: true });
    });

    it('should handle null and undefined', () => {
      expect(keysToCamelCase(null)).toBe(null);
      expect(keysToCamelCase(undefined)).toBe(undefined);
    });

    it('should handle arrays', () => {
      const input = [
        { job_id: '1', is_active: true },
        { job_id: '2', is_active: false },
      ];
      const result = keysToCamelCase(input);
      expect(result).toEqual([
        { jobId: '1', isActive: true },
        { jobId: '2', isActive: false },
      ]);
    });
  });
});

describe('createCamelCaseDb', () => {
  let mockSupabaseClient: SupabaseClient<TestDatabase>;
  let mockTable: ReturnType<typeof createMockTable>;

  beforeEach(() => {
    mockTable = createMockTable();
    mockSupabaseClient = {
      from: vi.fn().mockReturnValue(mockTable),
    } as any;
  });

  it('should create a CamelCaseDb instance', () => {
    const db = createCamelCaseDb(mockSupabaseClient);
    expect(db).toBeDefined();
    expect(typeof db.from).toBe('function');
  });

  describe('select queries', () => {
    it('should execute select query and convert keys to camelCase', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').select('*');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('users');
      expect(mockTable.select).toHaveBeenCalledWith('*');
      expect(result.data).toEqual([
        {
          userId: '123',
          userName: 'John Doe',
          emailAddress: 'john@example.com',
          isActive: true,
        },
      ]);
    });

    it('should execute select query without parameters', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').select();

      expect(mockTable.select).toHaveBeenCalledWith(undefined);
      expect(result.data).toBeDefined();
    });

    it('should handle select with null data', async () => {
      mockTable.select.mockReturnValue(
        Promise.resolve({
          data: null,
          error: { message: 'Not found' },
          count: null,
          status: 404,
          statusText: 'Not Found',
        }),
      );

      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').select('*');

      expect(result.data).toBe(null);
    });

    it('should support eq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').eq('userId', '123');

      expect(mockTable.eq).toHaveBeenCalledWith('user_id', '123');
    });

    it('should support neq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').neq('isActive', false);

      expect(mockTable.neq).toHaveBeenCalledWith('is_active', false);
    });

    it('should support gt filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').gt('userId', '100');

      expect(mockTable.gt).toHaveBeenCalledWith('user_id', '100');
    });

    it('should support gte filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').gte('userId', '100');

      expect(mockTable.gte).toHaveBeenCalledWith('user_id', '100');
    });

    it('should support lt filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').lt('userId', '100');

      expect(mockTable.lt).toHaveBeenCalledWith('user_id', '100');
    });

    it('should support lte filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').lte('userId', '100');

      expect(mockTable.lte).toHaveBeenCalledWith('user_id', '100');
    });

    it('should support like filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').like('userName', '%John%');

      expect(mockTable.like).toHaveBeenCalledWith('user_name', '%John%');
    });

    it('should support ilike filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').ilike('userName', '%JOHN%');

      expect(mockTable.ilike).toHaveBeenCalledWith('user_name', '%JOHN%');
    });

    it('should support is filter with null', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').is('emailAddress', null);

      expect(mockTable.is).toHaveBeenCalledWith('email_address', null);
    });

    it('should support is filter with boolean', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').is('isActive', true);

      expect(mockTable.is).toHaveBeenCalledWith('is_active', true);
    });

    it('should support in filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').in('userId', ['123', '456']);

      expect(mockTable.in).toHaveBeenCalledWith('user_id', ['123', '456']);
    });

    it('should support contains filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').contains('emailAddress', 'example.com');

      expect(mockTable.contains).toHaveBeenCalledWith('email_address', 'example.com');
    });

    it('should support order without options', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').order('userId');

      expect(mockTable.order).toHaveBeenCalledWith('user_id', undefined);
    });

    it('should support order with ascending option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').order('userId', { ascending: false });

      expect(mockTable.order).toHaveBeenCalledWith('user_id', { ascending: false });
    });

    it('should support order with nullsFirst option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('users')
        .select('*')
        .order('userId', { ascending: true, nullsFirst: true });

      expect(mockTable.order).toHaveBeenCalledWith('user_id', {
        ascending: true,
        nullsFirst: true,
      });
    });

    it('should support limit', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').limit(10);

      expect(mockTable.limit).toHaveBeenCalledWith(10);
    });

    it('should support range', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').select('*').range(0, 9);

      expect(mockTable.range).toHaveBeenCalledWith(0, 9);
    });

    it('should support chained filters', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('users')
        .select('*')
        .eq('isActive', true)
        .gte('userId', '100')
        .order('userId', { ascending: false })
        .limit(5);

      expect(mockTable.eq).toHaveBeenCalledWith('is_active', true);
      expect(mockTable.gte).toHaveBeenCalledWith('user_id', '100');
      expect(mockTable.order).toHaveBeenCalledWith('user_id', { ascending: false });
      expect(mockTable.limit).toHaveBeenCalledWith(5);
    });

    it('should handle select with onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('users').select('*');

      const callback = vi.fn((result) => result.data);
      const result = await query.then(callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toEqual([
        {
          userId: '123',
          userName: 'John Doe',
          emailAddress: 'john@example.com',
          isActive: true,
        },
      ]);
    });
  });

  describe('insert queries', () => {
    it('should insert single record and convert keys', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').insert({
        userName: 'Jane Doe',
        emailAddress: 'jane@example.com',
        isActive: true,
      });

      expect(mockTable.insert).toHaveBeenCalledWith({
        user_name: 'Jane Doe',
        email_address: 'jane@example.com',
        is_active: true,
      });
      expect(result.data).toEqual([
        {
          userId: '456',
          userName: 'Jane Doe',
          emailAddress: 'jane@example.com',
          isActive: true,
        },
      ]);
    });

    it('should insert multiple records', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').insert([
        { userName: 'User 1', emailAddress: 'user1@example.com', isActive: true },
        { userName: 'User 2', emailAddress: 'user2@example.com', isActive: false },
      ]);

      expect(mockTable.insert).toHaveBeenCalledWith([
        { user_name: 'User 1', email_address: 'user1@example.com', is_active: true },
        { user_name: 'User 2', email_address: 'user2@example.com', is_active: false },
      ]);
      expect(result.data).toBeDefined();
    });

    it('should handle insert with null data', async () => {
      mockTable.insert.mockReturnValue(
        Promise.resolve({
          data: null,
          error: { message: 'Insert failed' },
          count: null,
          status: 400,
          statusText: 'Bad Request',
        }),
      );

      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db
        .from('users')
        .insert({ userName: 'Test', emailAddress: 'test@example.com' });

      expect(result.data).toBe(null);
    });
  });

  describe('upsert queries', () => {
    it('should upsert single record without options', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').upsert({
        userId: '789',
        userName: 'Bob Smith',
        emailAddress: 'bob@example.com',
        isActive: false,
      });

      expect(mockTable.upsert).toHaveBeenCalledWith(
        {
          user_id: '789',
          user_name: 'Bob Smith',
          email_address: 'bob@example.com',
          is_active: false,
        },
        undefined,
      );
      expect(result.data).toEqual([
        {
          userId: '789',
          userName: 'Bob Smith',
          emailAddress: 'bob@example.com',
          isActive: false,
        },
      ]);
    });

    it('should upsert with onConflict option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('users')
        .upsert(
          { userId: '789', userName: 'Test', emailAddress: 'test@example.com' },
          { onConflict: 'user_id' },
        );

      expect(mockTable.upsert).toHaveBeenCalledWith(
        { user_id: '789', user_name: 'Test', email_address: 'test@example.com' },
        { onConflict: 'user_id' },
      );
    });

    it('should upsert with ignoreDuplicates option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('users')
        .upsert(
          { userName: 'Test', emailAddress: 'test@example.com' },
          { ignoreDuplicates: true },
        );

      expect(mockTable.upsert).toHaveBeenCalledWith(
        { user_name: 'Test', email_address: 'test@example.com' },
        { ignoreDuplicates: true },
      );
    });

    it('should upsert with count option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('users')
        .upsert(
          { userName: 'Test', emailAddress: 'test@example.com' },
          { count: 'exact' },
        );

      expect(mockTable.upsert).toHaveBeenCalledWith(
        { user_name: 'Test', email_address: 'test@example.com' },
        { count: 'exact' },
      );
    });

    it('should upsert multiple records', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('users').upsert([
        { userId: '1', userName: 'User 1', emailAddress: 'user1@example.com' },
        { userId: '2', userName: 'User 2', emailAddress: 'user2@example.com' },
      ]);

      expect(mockTable.upsert).toHaveBeenCalledWith(
        [
          { user_id: '1', user_name: 'User 1', email_address: 'user1@example.com' },
          { user_id: '2', user_name: 'User 2', email_address: 'user2@example.com' },
        ],
        undefined,
      );
    });

    it('should handle upsert with null data', async () => {
      mockTable.upsert.mockReturnValue(
        Promise.resolve({
          data: null,
          error: { message: 'Upsert failed' },
          count: null,
          status: 400,
          statusText: 'Bad Request',
        }),
      );

      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db
        .from('users')
        .upsert({ userName: 'Test', emailAddress: 'test@example.com' });

      expect(result.data).toBe(null);
    });
  });

  describe('update queries', () => {
    it('should update with eq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db
        .from('users')
        .update({
          userName: 'Updated User',
          emailAddress: 'updated@example.com',
          isActive: false,
        })
        .eq('userId', '123');

      expect(mockTable.update).toHaveBeenCalledWith({
        user_name: 'Updated User',
        email_address: 'updated@example.com',
        is_active: false,
      });
      expect(mockTable.eq).toHaveBeenCalledWith('user_id', '123');
      expect(result.data).toEqual([
        {
          userId: '123',
          userName: 'Updated User',
          emailAddress: 'updated@example.com',
          isActive: false,
        },
      ]);
    });

    it('should update with neq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('jobs')
        .update({ isActive: false })
        .neq('shortDescription', 'Ignore This');

      expect(mockTable.update).toHaveBeenCalledWith({ is_active: false });
      expect(mockTable.neq).toHaveBeenCalledWith('short_description', 'Ignore This');
    });

    it('should handle update with null data', async () => {
      mockTable.update.mockReturnValue(
        Promise.resolve({
          data: null,
          error: { message: 'Update failed' },
          count: null,
          status: 400,
          statusText: 'Bad Request',
        }),
      );

      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('jobs').update({ isActive: false }).eq('jobId', '999');

      expect(result.data).toBe(null);
    });

    it('should handle update with onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('jobs').update({ isActive: false }).eq('jobId', '123');

      const callback = vi.fn((result) => result.data);
      const result = await query.then(callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toEqual([
        {
          userId: '123',
          userName: 'Updated User',
          emailAddress: 'updated@example.com',
          isActive: false,
        },
      ]);
    });
  });

  describe('delete queries', () => {
    it('should delete with eq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').delete().eq('userId', '123');

      expect(mockTable.delete).toHaveBeenCalled();
      expect(mockTable.eq).toHaveBeenCalledWith('user_id', '123');
      expect(result.data).toEqual([
        {
          userId: '123',
          userName: 'Deleted User',
          emailAddress: 'deleted@example.com',
          isActive: true,
        },
      ]);
    });

    it('should handle delete with null data', async () => {
      mockTable.delete.mockReturnValue(
        Promise.resolve({
          data: null,
          error: { message: 'Delete failed' },
          count: null,
          status: 400,
          statusText: 'Bad Request',
        }),
      );

      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('users').delete().eq('userId', '999');

      expect(result.data).toBe(null);
    });

    it('should handle delete with onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('users').delete().eq('userId', '123');

      const callback = vi.fn((result) => result.data);
      const result = await query.then(callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toEqual([
        {
          userId: '123',
          userName: 'Deleted User',
          emailAddress: 'deleted@example.com',
          isActive: true,
        },
      ]);
    });
  });

  describe('advanced filter methods', () => {
    describe('pattern matching filters', () => {
      it('should support likeAllOf filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').likeAllOf('userName', ['%John%', '%Doe%']);

        expect(mockTable.likeAllOf).toHaveBeenCalledWith('user_name', [
          '%John%',
          '%Doe%',
        ]);
      });

      it('should support likeAnyOf filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').likeAnyOf('userName', ['%John%', '%Jane%']);

        expect(mockTable.likeAnyOf).toHaveBeenCalledWith('user_name', [
          '%John%',
          '%Jane%',
        ]);
      });

      it('should support ilikeAllOf filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').ilikeAllOf('userName', ['%john%', '%doe%']);

        expect(mockTable.ilikeAllOf).toHaveBeenCalledWith('user_name', [
          '%john%',
          '%doe%',
        ]);
      });

      it('should support ilikeAnyOf filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').ilikeAnyOf('userName', ['%john%', '%jane%']);

        expect(mockTable.ilikeAnyOf).toHaveBeenCalledWith('user_name', [
          '%john%',
          '%jane%',
        ]);
      });
    });

    describe('array and jsonb filters', () => {
      it('should support containedBy filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('jobs').select('*').containedBy('metaData', { key: 'value' });

        expect(mockTable.containedBy).toHaveBeenCalledWith('meta_data', { key: 'value' });
      });

      it('should support overlaps filter with array', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').overlaps('userId', ['1', '2', '3']);

        expect(mockTable.overlaps).toHaveBeenCalledWith('user_id', ['1', '2', '3']);
      });

      it('should support overlaps filter with string', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').overlaps('userId', '[1,3)');

        expect(mockTable.overlaps).toHaveBeenCalledWith('user_id', '[1,3)');
      });
    });

    describe('range filters', () => {
      it('should support rangeGt filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').rangeGt('userId', '[1,10)');

        expect(mockTable.rangeGt).toHaveBeenCalledWith('user_id', '[1,10)');
      });

      it('should support rangeGte filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').rangeGte('userId', '[1,10)');

        expect(mockTable.rangeGte).toHaveBeenCalledWith('user_id', '[1,10)');
      });

      it('should support rangeLt filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').rangeLt('userId', '[1,10)');

        expect(mockTable.rangeLt).toHaveBeenCalledWith('user_id', '[1,10)');
      });

      it('should support rangeLte filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').rangeLte('userId', '[1,10)');

        expect(mockTable.rangeLte).toHaveBeenCalledWith('user_id', '[1,10)');
      });

      it('should support rangeAdjacent filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').rangeAdjacent('userId', '[1,10)');

        expect(mockTable.rangeAdjacent).toHaveBeenCalledWith('user_id', '[1,10)');
      });
    });

    describe('full-text search', () => {
      it('should support textSearch without options', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('jobs').select('*').textSearch('shortDescription', 'developer');

        expect(mockTable.textSearch).toHaveBeenCalledWith(
          'short_description',
          'developer',
          undefined,
        );
      });

      it('should support textSearch with plain type', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('jobs')
          .select('*')
          .textSearch('shortDescription', 'developer', { type: 'plain' });

        expect(mockTable.textSearch).toHaveBeenCalledWith(
          'short_description',
          'developer',
          {
            type: 'plain',
          },
        );
      });

      it('should support textSearch with phrase type', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('jobs')
          .select('*')
          .textSearch('shortDescription', 'senior developer', { type: 'phrase' });

        expect(mockTable.textSearch).toHaveBeenCalledWith(
          'short_description',
          'senior developer',
          {
            type: 'phrase',
          },
        );
      });

      it('should support textSearch with websearch type', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('jobs')
          .select('*')
          .textSearch('shortDescription', 'developer OR engineer', { type: 'websearch' });

        expect(mockTable.textSearch).toHaveBeenCalledWith(
          'short_description',
          'developer OR engineer',
          { type: 'websearch' },
        );
      });

      it('should support textSearch with config', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('jobs')
          .select('*')
          .textSearch('shortDescription', 'developer', { config: 'english' });

        expect(mockTable.textSearch).toHaveBeenCalledWith(
          'short_description',
          'developer',
          {
            config: 'english',
          },
        );
      });
    });

    describe('advanced filters', () => {
      it('should support match filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .select('*')
          .match({ userName: 'John Doe', isActive: true });

        expect(mockTable.match).toHaveBeenCalledWith({
          user_name: 'John Doe',
          is_active: true,
        });
      });

      it('should support not filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').not('isActive', 'is', true);

        expect(mockTable.not).toHaveBeenCalledWith('is_active', 'is', true);
      });

      it('should support or filter', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .select('*')
          .or('user_name.eq.John,email_address.eq.john@example.com');

        expect(mockTable.or).toHaveBeenCalledWith(
          'user_name.eq.John,email_address.eq.john@example.com',
          undefined,
        );
      });

      it('should support or filter with referencedTable option', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .select('*')
          .or('user_name.eq.John,email_address.eq.john@example.com', {
            referencedTable: 'profiles',
          });

        expect(mockTable.or).toHaveBeenCalledWith(
          'user_name.eq.John,email_address.eq.john@example.com',
          { referencedTable: 'profiles' },
        );
      });

      it('should support filter method', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').filter('userName', 'eq', 'John Doe');

        expect(mockTable.filter).toHaveBeenCalledWith('user_name', 'eq', 'John Doe');
      });
    });

    describe('query modifiers', () => {
      it('should support single modifier', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').eq('userId', '123').single();

        expect(mockTable.single).toHaveBeenCalled();
      });

      it('should support maybeSingle modifier', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db.from('users').select('*').eq('userId', '123').maybeSingle();

        expect(mockTable.maybeSingle).toHaveBeenCalled();
      });
    });

    describe('chaining multiple advanced filters', () => {
      it('should support chaining pattern matching filters', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .select('*')
          .likeAllOf('userName', ['%John%', '%Doe%'])
          .ilikeAnyOf('emailAddress', ['%gmail%', '%yahoo%'])
          .limit(10);

        expect(mockTable.likeAllOf).toHaveBeenCalledWith('user_name', [
          '%John%',
          '%Doe%',
        ]);
        expect(mockTable.ilikeAnyOf).toHaveBeenCalledWith('email_address', [
          '%gmail%',
          '%yahoo%',
        ]);
        expect(mockTable.limit).toHaveBeenCalledWith(10);
      });

      it('should support chaining range filters', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .select('*')
          .rangeGt('userId', '[1,10)')
          .rangeLte('userId', '[50,100)')
          .order('userId');

        expect(mockTable.rangeGt).toHaveBeenCalledWith('user_id', '[1,10)');
        expect(mockTable.rangeLte).toHaveBeenCalledWith('user_id', '[50,100)');
        expect(mockTable.order).toHaveBeenCalledWith('user_id', undefined);
      });

      it('should support chaining with not and or filters', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .select('*')
          .not('isActive', 'is', false)
          .or('user_name.eq.John,user_name.eq.Jane');

        expect(mockTable.not).toHaveBeenCalledWith('is_active', 'is', false);
        expect(mockTable.or).toHaveBeenCalledWith(
          'user_name.eq.John,user_name.eq.Jane',
          undefined,
        );
      });
    });

    describe('advanced filters on update queries', () => {
      it('should support advanced filters on update', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .update({ isActive: false })
          .likeAllOf('userName', ['%Admin%'])
          .not('emailAddress', 'eq', 'admin@example.com');

        expect(mockTable.likeAllOf).toHaveBeenCalledWith('user_name', ['%Admin%']);
        expect(mockTable.not).toHaveBeenCalledWith(
          'email_address',
          'eq',
          'admin@example.com',
        );
      });

      it('should support textSearch on update', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('jobs')
          .update({ isActive: false })
          .textSearch('shortDescription', 'deprecated', { type: 'plain' });

        expect(mockTable.textSearch).toHaveBeenCalledWith(
          'short_description',
          'deprecated',
          {
            type: 'plain',
          },
        );
      });
    });

    describe('advanced filters on delete queries', () => {
      it('should support advanced filters on delete', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .delete()
          .ilikeAnyOf('emailAddress', ['%spam%', '%fake%'])
          .or('is_active.is.false,created_at.lt.2020-01-01');

        expect(mockTable.ilikeAnyOf).toHaveBeenCalledWith('email_address', [
          '%spam%',
          '%fake%',
        ]);
        expect(mockTable.or).toHaveBeenCalledWith(
          'is_active.is.false,created_at.lt.2020-01-01',
          undefined,
        );
      });

      it('should support match on delete', async () => {
        const db = createCamelCaseDb(mockSupabaseClient);
        await db
          .from('users')
          .delete()
          .match({ isActive: false, userName: 'Deleted User' });

        expect(mockTable.match).toHaveBeenCalledWith({
          is_active: false,
          user_name: 'Deleted User',
        });
      });
    });
  });

  describe('promise rejection handling', () => {
    it('should handle select with null onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('users').select('*');

      const result = await query.then(null, null);

      expect(result.data).toEqual([
        {
          userId: '123',
          userName: 'John Doe',
          emailAddress: 'john@example.com',
          isActive: true,
        },
      ]);
    });

    it('should handle update with null onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('users').update({ isActive: false }).eq('userId', '123');

      const result = await query.then(null, null);

      expect(result.data).toEqual([
        {
          userId: '123',
          userName: 'Updated User',
          emailAddress: 'updated@example.com',
          isActive: false,
        },
      ]);
    });

    it('should handle delete with null onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('users').delete().eq('userId', '123');

      const result = await query.then(null, null);

      expect(result.data).toEqual([
        {
          userId: '123',
          userName: 'Deleted User',
          emailAddress: 'deleted@example.com',
          isActive: true,
        },
      ]);
    });
  });
});
