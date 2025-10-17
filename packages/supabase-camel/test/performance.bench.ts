import type { SupabaseClient } from '@supabase/supabase-js';
import { bench, describe } from 'vitest';

import { createCamelCaseDb } from '../src/supabase-camel';

/**
 * Performance benchmarks for supabase-camel
 *
 * These benchmarks measure the overhead of the proxy-based camelCase conversion.
 * Run with: pnpm vitest bench
 */

// Mock Supabase client for benchmarking
function createMockSupabaseClient() {
  const mockQueryBuilder = {
    select(_columns?: string) {
      return this;
    },
    eq(_column: string, _value: any) {
      return this;
    },
    neq(_column: string, _value: any) {
      return this;
    },
    gt(_column: string, _value: any) {
      return this;
    },
    lt(_column: string, _value: any) {
      return this;
    },
    order(_column: string, _options?: any) {
      return this;
    },
    limit(_count: number) {
      return this;
    },
    // Simulate promise resolution with data
    async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
      const result = {
        data: [
          { user_id: 1, first_name: 'John', last_name: 'Doe', is_active: true },
          { user_id: 2, first_name: 'Jane', last_name: 'Smith', is_active: false },
          { user_id: 3, first_name: 'Bob', last_name: 'Johnson', is_active: true },
        ],
        error: null,
        count: null,
        status: 200,
        statusText: 'OK',
      };

      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };

  return {
    from: (_table: string) => mockQueryBuilder,
  } as unknown as SupabaseClient<any>;
}

describe('performance benchmarks', () => {
  const mockClient = createMockSupabaseClient();
  const db = createCamelCaseDb(mockClient);

  describe('query chain performance', () => {
    bench('simple select query', async () => {
      await db.from('users').select('*');
    });

    bench('query with single filter', async () => {
      await db.from('users').select('*').eq('userId', 1);
    });

    bench('query with multiple filters (short chain)', async () => {
      await db.from('users').select('*').eq('userId', 1).eq('isActive', true);
    });

    bench('query with multiple filters (long chain)', async () => {
      await db
        .from('users')
        .select('*')
        .eq('userId', 1)
        .eq('isActive', true)
        .neq('firstName', 'Test')
        .gt('userId', 0)
        .lt('userId', 1000)
        .order('userId')
        .limit(10);
    });
  });

  describe('column name conversion', () => {
    bench('convert camelCase columns (with cache hits)', async () => {
      // These should hit the cache after the first call
      for (let i = 0; i < 10; i++) {
        await db.from('users').select('*').eq('userId', i);
      }
    });

    bench('convert different columns (no cache hits)', async () => {
      // Different columns each time - no cache hits
      await db.from('users').select('*').eq('userId', 1);
      await db.from('users').select('*').eq('firstName', 'John');
      await db.from('users').select('*').eq('lastName', 'Doe');
      await db.from('users').select('*').eq('isActive', true);
      await db.from('users').select('*').eq('createdAt', '2024-01-01');
    });
  });

  describe('data transformation', () => {
    bench('transform response data (small dataset - 3 rows)', async () => {
      await db.from('users').select('*');
    });
  });
});
