import type { KeysToCamelCase, KeysToSnakeCase } from '@pixpilot/object';
import type { PostgrestResponse, SupabaseClient } from '@supabase/supabase-js';
import { keysToCamelCase, keysToSnakeCase } from '@pixpilot/object';

// Type definitions for camelCase versions of database types
type CamelCaseRow<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> = KeysToCamelCase<DB['public']['Tables'][T]['Row']>;

type CamelCaseInsert<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> = KeysToCamelCase<DB['public']['Tables'][T]['Insert']>;

type CamelCaseUpdate<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> = KeysToCamelCase<DB['public']['Tables'][T]['Update']>;

interface CamelCasePostgrestResponse<T> extends Omit<PostgrestResponse<T>, 'data'> {
  data: T | null;
}

// Simplified table interface
interface SupabaseTable {
  select: (query?: string) => Promise<PostgrestResponse<unknown>>;
  insert: (data: unknown) => Promise<PostgrestResponse<unknown>>;
  upsert: (
    data: unknown,
    options?: Record<string, unknown>,
  ) => Promise<PostgrestResponse<unknown>>;
  update: (data: unknown) => Promise<PostgrestResponse<unknown>>;
  delete: () => Promise<PostgrestResponse<unknown>>;
  eq: (column: string, value: unknown) => SupabaseTable;
  neq: (column: string, value: unknown) => SupabaseTable;
  gt: (column: string, value: unknown) => SupabaseTable;
  gte: (column: string, value: unknown) => SupabaseTable;
  lt: (column: string, value: unknown) => SupabaseTable;
  lte: (column: string, value: unknown) => SupabaseTable;
  like: (column: string, pattern: string) => SupabaseTable;
  ilike: (column: string, pattern: string) => SupabaseTable;
  is: (column: string, value: boolean | null) => SupabaseTable;
  in: (column: string, values: unknown[]) => SupabaseTable;
  contains: (column: string, value: unknown) => SupabaseTable;
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) => SupabaseTable;
  limit: (count: number) => SupabaseTable;
  range: (from: number, to: number) => SupabaseTable;
}

/**
 * Enhanced table query builder with proper typing and camelCase conversion
 */
class CamelCaseTableQueryBuilder<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> {
  constructor(private originalTable: SupabaseTable) {}

  select(query?: string): CamelCaseSelectQueryBuilder<DB, T> {
    return new CamelCaseSelectQueryBuilder<DB, T>(this.originalTable, query);
  }

  async insert(
    data: CamelCaseInsert<DB, T> | CamelCaseInsert<DB, T>[],
  ): Promise<CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>> {
    const snakeCaseData = keysToSnakeCase(data);
    const result = await this.originalTable.insert(snakeCaseData);
    return {
      ...result,
      data:
        result.data != null
          ? (keysToCamelCase(result.data) as CamelCaseRow<DB, T>[])
          : null,
    };
  }

  async upsert(
    data: CamelCaseInsert<DB, T> | CamelCaseInsert<DB, T>[],
    options?: {
      onConflict?: string;
      ignoreDuplicates?: boolean;
      count?: 'exact' | 'planned' | 'estimated';
    },
  ): Promise<CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>> {
    const snakeCaseData = keysToSnakeCase(data);
    const result = await this.originalTable.upsert(snakeCaseData, options);
    return {
      ...result,
      data:
        result.data != null
          ? (keysToCamelCase(result.data) as CamelCaseRow<DB, T>[])
          : null,
    };
  }

  update(data: CamelCaseUpdate<DB, T>): CamelCaseUpdateQueryBuilder<DB, T> {
    const snakeCaseData = keysToSnakeCase(data);
    return new CamelCaseUpdateQueryBuilder<DB, T>(this.originalTable, snakeCaseData);
  }

  delete(): CamelCaseDeleteQueryBuilder<DB, T> {
    return new CamelCaseDeleteQueryBuilder<DB, T>(this.originalTable);
  }
}

/**
 * Select query builder with filtering capabilities
 */
class CamelCaseSelectQueryBuilder<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> {
  constructor(
    private originalTable: SupabaseTable,
    private query?: string,
  ) {}

  // Query filters with method chaining
  eq(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.eq(snakeColumnKey, value);
    return this;
  }

  neq(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.neq(snakeColumnKey, value);
    return this;
  }

  gt(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.gt(snakeColumnKey, value);
    return this;
  }

  gte(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.gte(snakeColumnKey, value);
    return this;
  }

  lt(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.lt(snakeColumnKey, value);
    return this;
  }

  lte(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.lte(snakeColumnKey, value);
    return this;
  }

  like(column: keyof CamelCaseRow<DB, T>, pattern: string): this {
    const snakeColumn = keysToSnakeCase({ [column]: pattern });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.like(snakeColumnKey, pattern);
    return this;
  }

  ilike(column: keyof CamelCaseRow<DB, T>, pattern: string): this {
    const snakeColumn = keysToSnakeCase({ [column]: pattern });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.ilike(snakeColumnKey, pattern);
    return this;
  }

  is(column: keyof CamelCaseRow<DB, T>, value: boolean | null): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.is(snakeColumnKey, value);
    return this;
  }

  in(column: keyof CamelCaseRow<DB, T>, values: unknown[]): this {
    const snakeColumn = keysToSnakeCase({ [column]: values });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.in(snakeColumnKey, values);
    return this;
  }

  contains(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.contains(snakeColumnKey, value);
    return this;
  }

  order(
    column: keyof CamelCaseRow<DB, T>,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): this {
    const snakeColumn = keysToSnakeCase({ [column]: null });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.order(snakeColumnKey, options);
    return this;
  }

  limit(count: number): this {
    this.originalTable.limit(count);
    return this;
  }

  range(from: number, to: number): this {
    this.originalTable.range(from, to);
    return this;
  }

  // Execute the query
  async then<
    TResult1 = CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>,
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
          value: CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>,
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    _onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    const result = await this.originalTable.select(this.query);
    const transformedResult = {
      ...result,
      data:
        result.data != null
          ? (keysToCamelCase(result.data) as CamelCaseRow<DB, T>[])
          : null,
    };

    if (onfulfilled) {
      return onfulfilled(transformedResult);
    }
    return transformedResult as TResult1;
  }
}

/**
 * Update query builder with filtering capabilities
 */
class CamelCaseUpdateQueryBuilder<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> {
  constructor(
    private originalTable: SupabaseTable,
    private updateData: unknown,
  ) {}

  // Query filters
  eq(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.eq(snakeColumnKey, value);
    return this;
  }

  neq(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.neq(snakeColumnKey, value);
    return this;
  }

  // Execute the update
  async then<
    TResult1 = CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>,
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
          value: CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>,
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    _onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    const result = await this.originalTable.update(this.updateData);
    const transformedResult = {
      ...result,
      data:
        result.data != null
          ? (keysToCamelCase(result.data) as CamelCaseRow<DB, T>[])
          : null,
    };

    if (onfulfilled) {
      return onfulfilled(transformedResult);
    }
    return transformedResult as TResult1;
  }
}

/**
 * Delete query builder with filtering capabilities
 */
class CamelCaseDeleteQueryBuilder<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> {
  constructor(private originalTable: SupabaseTable) {}

  // Query filters
  eq(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    const snakeColumn = keysToSnakeCase({ [column]: value });
    const snakeColumnKey = Object.keys(snakeColumn)[0]!;
    this.originalTable.eq(snakeColumnKey, value);
    return this;
  }

  // Execute the delete
  async then<
    TResult1 = CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>,
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
          value: CamelCasePostgrestResponse<CamelCaseRow<DB, T>[]>,
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    _onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    const result = await this.originalTable.delete();
    const transformedResult = {
      ...result,
      data:
        result.data != null
          ? (keysToCamelCase(result.data) as CamelCaseRow<DB, T>[])
          : null,
    };

    if (onfulfilled) {
      return onfulfilled(transformedResult);
    }
    return transformedResult as TResult1;
  }
}

/**
 * CamelCase database wrapper that only wraps database operations
 */
class CamelCaseDb<DB extends Record<string, any>> {
  constructor(private supabaseClient: SupabaseClient<DB>) {}

  from<T extends keyof DB['public']['Tables']>(
    table: T,
  ): CamelCaseTableQueryBuilder<DB, T> {
    const originalTable = this.supabaseClient.from(
      table as string,
    ) as unknown as SupabaseTable;
    return new CamelCaseTableQueryBuilder(originalTable);
  }
}

/**
 * Creates a camelCase database wrapper from an existing Supabase client.
 * Only wraps database operations - auth, storage, realtime, etc. remain unchanged.
 *
 * @param supabaseClient - Your configured Supabase client
 * @returns A database wrapper with automatic camelCase conversion
 *
 * @example
 * ```typescript
 * import { createClient } from '@supabase/supabase-js';
 * import { createCamelCaseDb } from 'supabase-camel';
 *
 * const supabase = createClient(url, key);
 * const db = createCamelCaseDb(supabase);
 *
 * // Use camelCase for database queries
 * const { data } = await db.from('jobs').select('*').eq('isActive', true);
 *
 * // Use regular supabase for auth, storage, etc.
 * const { data: user } = await supabase.auth.getUser();
 * ```
 */
export function createCamelCaseDb<DB extends Record<string, any>>(
  supabaseClient: SupabaseClient<DB>,
): CamelCaseDb<DB> {
  return new CamelCaseDb(supabaseClient);
}

// Export utility functions and types
export { CamelCaseDb, keysToCamelCase, keysToSnakeCase };
export type {
  CamelCaseInsert,
  CamelCaseRow,
  CamelCaseUpdate,
  KeysToCamelCase,
  KeysToSnakeCase,
};
