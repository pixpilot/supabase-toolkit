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

// Simplified table interface with all filter methods
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
  likeAllOf: (column: string, patterns: readonly string[]) => SupabaseTable;
  likeAnyOf: (column: string, patterns: readonly string[]) => SupabaseTable;
  ilike: (column: string, pattern: string) => SupabaseTable;
  ilikeAllOf: (column: string, patterns: readonly string[]) => SupabaseTable;
  ilikeAnyOf: (column: string, patterns: readonly string[]) => SupabaseTable;
  is: (column: string, value: boolean | null) => SupabaseTable;
  in: (column: string, values: unknown[]) => SupabaseTable;
  contains: (column: string, value: unknown) => SupabaseTable;
  containedBy: (column: string, value: unknown) => SupabaseTable;
  rangeGt: (column: string, range: string) => SupabaseTable;
  rangeGte: (column: string, range: string) => SupabaseTable;
  rangeLt: (column: string, range: string) => SupabaseTable;
  rangeLte: (column: string, range: string) => SupabaseTable;
  rangeAdjacent: (column: string, range: string) => SupabaseTable;
  overlaps: (column: string, value: unknown) => SupabaseTable;
  textSearch: (
    column: string,
    query: string,
    options?: { config?: string; type?: 'plain' | 'phrase' | 'websearch' },
  ) => SupabaseTable;
  match: (query: Record<string, unknown>) => SupabaseTable;
  not: (column: string, operator: string, value: unknown) => SupabaseTable;
  or: (
    filters: string,
    options?: { foreignTable?: string; referencedTable?: string },
  ) => SupabaseTable;
  filter: (column: string, operator: string, value: unknown) => SupabaseTable;
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) => SupabaseTable;
  limit: (count: number) => SupabaseTable;
  range: (from: number, to: number) => SupabaseTable;
  single: () => SupabaseTable;
  maybeSingle: () => SupabaseTable;
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
 * Base class with shared filter logic to avoid code repetition
 */
abstract class BaseFilterBuilder<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> {
  constructor(protected originalTable: SupabaseTable) {}

  /**
   * Helper method to convert camelCase column to snake_case
   */
  protected convertColumn(column: keyof CamelCaseRow<DB, T>): string {
    const snakeColumn = keysToSnakeCase({ [column]: null });
    return Object.keys(snakeColumn)[0]!;
  }

  // Basic comparison filters
  eq(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.eq(this.convertColumn(column), value);
    return this;
  }

  neq(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.neq(this.convertColumn(column), value);
    return this;
  }

  gt(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.gt(this.convertColumn(column), value);
    return this;
  }

  gte(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.gte(this.convertColumn(column), value);
    return this;
  }

  lt(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.lt(this.convertColumn(column), value);
    return this;
  }

  lte(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.lte(this.convertColumn(column), value);
    return this;
  }

  // Pattern matching filters
  like(column: keyof CamelCaseRow<DB, T>, pattern: string): this {
    this.originalTable.like(this.convertColumn(column), pattern);
    return this;
  }

  likeAllOf(column: keyof CamelCaseRow<DB, T>, patterns: readonly string[]): this {
    this.originalTable.likeAllOf(this.convertColumn(column), patterns);
    return this;
  }

  likeAnyOf(column: keyof CamelCaseRow<DB, T>, patterns: readonly string[]): this {
    this.originalTable.likeAnyOf(this.convertColumn(column), patterns);
    return this;
  }

  ilike(column: keyof CamelCaseRow<DB, T>, pattern: string): this {
    this.originalTable.ilike(this.convertColumn(column), pattern);
    return this;
  }

  ilikeAllOf(column: keyof CamelCaseRow<DB, T>, patterns: readonly string[]): this {
    this.originalTable.ilikeAllOf(this.convertColumn(column), patterns);
    return this;
  }

  ilikeAnyOf(column: keyof CamelCaseRow<DB, T>, patterns: readonly string[]): this {
    this.originalTable.ilikeAnyOf(this.convertColumn(column), patterns);
    return this;
  }

  // Null/Boolean checks
  is(column: keyof CamelCaseRow<DB, T>, value: boolean | null): this {
    this.originalTable.is(this.convertColumn(column), value);
    return this;
  }

  // Array/Set operations
  in(column: keyof CamelCaseRow<DB, T>, values: unknown[]): this {
    this.originalTable.in(this.convertColumn(column), values);
    return this;
  }

  contains(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.contains(this.convertColumn(column), value);
    return this;
  }

  containedBy(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.containedBy(this.convertColumn(column), value);
    return this;
  }

  // Range operations
  rangeGt(column: keyof CamelCaseRow<DB, T>, range: string): this {
    this.originalTable.rangeGt(this.convertColumn(column), range);
    return this;
  }

  rangeGte(column: keyof CamelCaseRow<DB, T>, range: string): this {
    this.originalTable.rangeGte(this.convertColumn(column), range);
    return this;
  }

  rangeLt(column: keyof CamelCaseRow<DB, T>, range: string): this {
    this.originalTable.rangeLt(this.convertColumn(column), range);
    return this;
  }

  rangeLte(column: keyof CamelCaseRow<DB, T>, range: string): this {
    this.originalTable.rangeLte(this.convertColumn(column), range);
    return this;
  }

  rangeAdjacent(column: keyof CamelCaseRow<DB, T>, range: string): this {
    this.originalTable.rangeAdjacent(this.convertColumn(column), range);
    return this;
  }

  overlaps(column: keyof CamelCaseRow<DB, T>, value: unknown): this {
    this.originalTable.overlaps(this.convertColumn(column), value);
    return this;
  }

  // Full-text search
  textSearch(
    column: keyof CamelCaseRow<DB, T>,
    query: string,
    options?: { config?: string; type?: 'plain' | 'phrase' | 'websearch' },
  ): this {
    this.originalTable.textSearch(this.convertColumn(column), query, options);
    return this;
  }

  // Match multiple columns
  match(query: Partial<CamelCaseRow<DB, T>>): this {
    const snakeCaseQuery = keysToSnakeCase(query);
    this.originalTable.match(snakeCaseQuery);
    return this;
  }

  // Advanced filters
  not(column: keyof CamelCaseRow<DB, T>, operator: string, value: unknown): this {
    this.originalTable.not(this.convertColumn(column), operator, value);
    return this;
  }

  or(
    filters: string,
    options?: { foreignTable?: string; referencedTable?: string },
  ): this {
    this.originalTable.or(filters, options);
    return this;
  }

  filter(column: keyof CamelCaseRow<DB, T>, operator: string, value: unknown): this {
    this.originalTable.filter(this.convertColumn(column), operator, value);
    return this;
  }

  // Query modifiers
  order(
    column: keyof CamelCaseRow<DB, T>,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): this {
    this.originalTable.order(this.convertColumn(column), options);
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

  single(): this {
    this.originalTable.single();
    return this;
  }

  maybeSingle(): this {
    this.originalTable.maybeSingle();
    return this;
  }
}

/**
 * Select query builder with filtering capabilities
 */
class CamelCaseSelectQueryBuilder<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
> extends BaseFilterBuilder<DB, T> {
  constructor(
    originalTable: SupabaseTable,
    private query?: string,
  ) {
    super(originalTable);
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
> extends BaseFilterBuilder<DB, T> {
  constructor(
    originalTable: SupabaseTable,
    private updateData: unknown,
  ) {
    super(originalTable);
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
> extends BaseFilterBuilder<DB, T> {
  constructor(originalTable: SupabaseTable) {
    super(originalTable);
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
 * const { data } = await db.from('users').select('*').eq('isActive', true);
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
