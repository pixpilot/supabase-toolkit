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
        };
        Insert: {
          user_id?: string;
          user_name: string;
          email_address: string;
        };
        Update: {
          user_id?: string;
          user_name?: string;
          email_address?: string;
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
            job_id: '123',
            short_description: 'Test Job',
            is_active: true,
            created_at: '2024-01-01',
            meta_data: { key: 'value' },
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
            job_id: '456',
            short_description: 'New Job',
            is_active: true,
            created_at: '2024-01-02',
            meta_data: {},
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
            job_id: '789',
            short_description: 'Upserted Job',
            is_active: false,
            created_at: '2024-01-03',
            meta_data: {},
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
            job_id: '123',
            short_description: 'Updated Job',
            is_active: false,
            created_at: '2024-01-01',
            meta_data: {},
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
            job_id: '123',
            short_description: 'Deleted Job',
            is_active: true,
            created_at: '2024-01-01',
            meta_data: {},
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
      const result = await db.from('jobs').select('*');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('jobs');
      expect(mockTable.select).toHaveBeenCalledWith('*');
      expect(result.data).toEqual([
        {
          jobId: '123',
          shortDescription: 'Test Job',
          isActive: true,
          createdAt: '2024-01-01',
          metaData: { key: 'value' },
        },
      ]);
    });

    it('should execute select query without parameters', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('jobs').select();

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
      const result = await db.from('jobs').select('*');

      expect(result.data).toBe(null);
    });

    it('should support eq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').eq('jobId', '123');

      expect(mockTable.eq).toHaveBeenCalledWith('job_id', '123');
    });

    it('should support neq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').neq('isActive', false);

      expect(mockTable.neq).toHaveBeenCalledWith('is_active', false);
    });

    it('should support gt filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').gt('jobId', '100');

      expect(mockTable.gt).toHaveBeenCalledWith('job_id', '100');
    });

    it('should support gte filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').gte('jobId', '100');

      expect(mockTable.gte).toHaveBeenCalledWith('job_id', '100');
    });

    it('should support lt filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').lt('jobId', '100');

      expect(mockTable.lt).toHaveBeenCalledWith('job_id', '100');
    });

    it('should support lte filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').lte('jobId', '100');

      expect(mockTable.lte).toHaveBeenCalledWith('job_id', '100');
    });

    it('should support like filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').like('shortDescription', '%test%');

      expect(mockTable.like).toHaveBeenCalledWith('short_description', '%test%');
    });

    it('should support ilike filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').ilike('shortDescription', '%TEST%');

      expect(mockTable.ilike).toHaveBeenCalledWith('short_description', '%TEST%');
    });

    it('should support is filter with null', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').is('metaData', null);

      expect(mockTable.is).toHaveBeenCalledWith('meta_data', null);
    });

    it('should support is filter with boolean', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').is('isActive', true);

      expect(mockTable.is).toHaveBeenCalledWith('is_active', true);
    });

    it('should support in filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').in('jobId', ['123', '456']);

      expect(mockTable.in).toHaveBeenCalledWith('job_id', ['123', '456']);
    });

    it('should support contains filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').contains('metaData', { key: 'value' });

      expect(mockTable.contains).toHaveBeenCalledWith('meta_data', { key: 'value' });
    });

    it('should support order without options', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').order('createdAt');

      expect(mockTable.order).toHaveBeenCalledWith('created_at', undefined);
    });

    it('should support order with ascending option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').order('createdAt', { ascending: false });

      expect(mockTable.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('should support order with nullsFirst option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('jobs')
        .select('*')
        .order('createdAt', { ascending: true, nullsFirst: true });

      expect(mockTable.order).toHaveBeenCalledWith('created_at', {
        ascending: true,
        nullsFirst: true,
      });
    });

    it('should support limit', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').limit(10);

      expect(mockTable.limit).toHaveBeenCalledWith(10);
    });

    it('should support range', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').select('*').range(0, 9);

      expect(mockTable.range).toHaveBeenCalledWith(0, 9);
    });

    it('should support chained filters', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('jobs')
        .select('*')
        .eq('isActive', true)
        .gte('jobId', '100')
        .order('createdAt', { ascending: false })
        .limit(5);

      expect(mockTable.eq).toHaveBeenCalledWith('is_active', true);
      expect(mockTable.gte).toHaveBeenCalledWith('job_id', '100');
      expect(mockTable.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockTable.limit).toHaveBeenCalledWith(5);
    });

    it('should handle select with onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('jobs').select('*');

      const callback = vi.fn((result) => result.data);
      const result = await query.then(callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toEqual([
        {
          jobId: '123',
          shortDescription: 'Test Job',
          isActive: true,
          createdAt: '2024-01-01',
          metaData: { key: 'value' },
        },
      ]);
    });
  });

  describe('insert queries', () => {
    it('should insert single record and convert keys', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('jobs').insert({
        shortDescription: 'New Job',
        isActive: true,
      });

      expect(mockTable.insert).toHaveBeenCalledWith({
        short_description: 'New Job',
        is_active: true,
      });
      expect(result.data).toEqual([
        {
          jobId: '456',
          shortDescription: 'New Job',
          isActive: true,
          createdAt: '2024-01-02',
          metaData: {},
        },
      ]);
    });

    it('should insert multiple records', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('jobs').insert([
        { shortDescription: 'Job 1', isActive: true },
        { shortDescription: 'Job 2', isActive: false },
      ]);

      expect(mockTable.insert).toHaveBeenCalledWith([
        { short_description: 'Job 1', is_active: true },
        { short_description: 'Job 2', is_active: false },
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
      const result = await db.from('jobs').insert({ shortDescription: 'Test' });

      expect(result.data).toBe(null);
    });
  });

  describe('upsert queries', () => {
    it('should upsert single record without options', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('jobs').upsert({
        jobId: '789',
        shortDescription: 'Upserted Job',
        isActive: false,
      });

      expect(mockTable.upsert).toHaveBeenCalledWith(
        {
          job_id: '789',
          short_description: 'Upserted Job',
          is_active: false,
        },
        undefined,
      );
      expect(result.data).toEqual([
        {
          jobId: '789',
          shortDescription: 'Upserted Job',
          isActive: false,
          createdAt: '2024-01-03',
          metaData: {},
        },
      ]);
    });

    it('should upsert with onConflict option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('jobs')
        .upsert({ jobId: '789', shortDescription: 'Test' }, { onConflict: 'job_id' });

      expect(mockTable.upsert).toHaveBeenCalledWith(
        { job_id: '789', short_description: 'Test' },
        { onConflict: 'job_id' },
      );
    });

    it('should upsert with ignoreDuplicates option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db
        .from('jobs')
        .upsert({ shortDescription: 'Test' }, { ignoreDuplicates: true });

      expect(mockTable.upsert).toHaveBeenCalledWith(
        { short_description: 'Test' },
        { ignoreDuplicates: true },
      );
    });

    it('should upsert with count option', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').upsert({ shortDescription: 'Test' }, { count: 'exact' });

      expect(mockTable.upsert).toHaveBeenCalledWith(
        { short_description: 'Test' },
        { count: 'exact' },
      );
    });

    it('should upsert multiple records', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      await db.from('jobs').upsert([
        { jobId: '1', shortDescription: 'Job 1' },
        { jobId: '2', shortDescription: 'Job 2' },
      ]);

      expect(mockTable.upsert).toHaveBeenCalledWith(
        [
          { job_id: '1', short_description: 'Job 1' },
          { job_id: '2', short_description: 'Job 2' },
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
      const result = await db.from('jobs').upsert({ shortDescription: 'Test' });

      expect(result.data).toBe(null);
    });
  });

  describe('update queries', () => {
    it('should update with eq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db
        .from('jobs')
        .update({ shortDescription: 'Updated Job', isActive: false })
        .eq('jobId', '123');

      expect(mockTable.update).toHaveBeenCalledWith({
        short_description: 'Updated Job',
        is_active: false,
      });
      expect(mockTable.eq).toHaveBeenCalledWith('job_id', '123');
      expect(result.data).toEqual([
        {
          jobId: '123',
          shortDescription: 'Updated Job',
          isActive: false,
          createdAt: '2024-01-01',
          metaData: {},
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
          jobId: '123',
          shortDescription: 'Updated Job',
          isActive: false,
          createdAt: '2024-01-01',
          metaData: {},
        },
      ]);
    });
  });

  describe('delete queries', () => {
    it('should delete with eq filter', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const result = await db.from('jobs').delete().eq('jobId', '123');

      expect(mockTable.delete).toHaveBeenCalled();
      expect(mockTable.eq).toHaveBeenCalledWith('job_id', '123');
      expect(result.data).toEqual([
        {
          jobId: '123',
          shortDescription: 'Deleted Job',
          isActive: true,
          createdAt: '2024-01-01',
          metaData: {},
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
      const result = await db.from('jobs').delete().eq('jobId', '999');

      expect(result.data).toBe(null);
    });

    it('should handle delete with onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('jobs').delete().eq('jobId', '123');

      const callback = vi.fn((result) => result.data);
      const result = await query.then(callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toEqual([
        {
          jobId: '123',
          shortDescription: 'Deleted Job',
          isActive: true,
          createdAt: '2024-01-01',
          metaData: {},
        },
      ]);
    });
  });

  describe('promise rejection handling', () => {
    it('should handle select with null onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('jobs').select('*');

      const result = await query.then(null, null);

      expect(result.data).toEqual([
        {
          jobId: '123',
          shortDescription: 'Test Job',
          isActive: true,
          createdAt: '2024-01-01',
          metaData: { key: 'value' },
        },
      ]);
    });

    it('should handle update with null onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('jobs').update({ isActive: false }).eq('jobId', '123');

      const result = await query.then(null, null);

      expect(result.data).toEqual([
        {
          jobId: '123',
          shortDescription: 'Updated Job',
          isActive: false,
          createdAt: '2024-01-01',
          metaData: {},
        },
      ]);
    });

    it('should handle delete with null onfulfilled callback', async () => {
      const db = createCamelCaseDb(mockSupabaseClient);
      const query = db.from('jobs').delete().eq('jobId', '123');

      const result = await query.then(null, null);

      expect(result.data).toEqual([
        {
          jobId: '123',
          shortDescription: 'Deleted Job',
          isActive: true,
          createdAt: '2024-01-01',
          metaData: {},
        },
      ]);
    });
  });
});
