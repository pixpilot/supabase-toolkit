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
    ilike: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    contains: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
  };

  // Make all filter methods chainable
  mockTable.eq.mockReturnValue(mockTable);
  mockTable.neq.mockReturnValue(mockTable);
  mockTable.gt.mockReturnValue(mockTable);
  mockTable.gte.mockReturnValue(mockTable);
  mockTable.lt.mockReturnValue(mockTable);
  mockTable.lte.mockReturnValue(mockTable);
  mockTable.like.mockReturnValue(mockTable);
  mockTable.ilike.mockReturnValue(mockTable);
  mockTable.is.mockReturnValue(mockTable);
  mockTable.in.mockReturnValue(mockTable);
  mockTable.contains.mockReturnValue(mockTable);
  mockTable.order.mockReturnValue(mockTable);
  mockTable.limit.mockReturnValue(mockTable);
  mockTable.range.mockReturnValue(mockTable);

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
