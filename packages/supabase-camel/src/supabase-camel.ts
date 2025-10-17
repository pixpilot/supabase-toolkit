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

/**
 * Configuration options for the camelCase database wrapper
 */
export interface CamelCaseDbOptions {
  /**
   * Enable proxy caching to prevent nested proxy wrapping.
   *
   * Enable this if:
   * - You're using custom Supabase extensions that return 'this'
   * - You want defensive protection against nested proxies
   * - You're concerned about future Supabase API changes
   *
   * Keep disabled (default) if:
   * - You're using standard Supabase queries (99% of use cases)
   * - You prefer simpler code with minimal abstractions
   *
   * @default false
   */
  cacheProxies?: boolean;
}

/**
 * Helper to convert camelCase column name to snake_case.
 * Uses a simple regex-based conversion.
 *
 * Preserves special patterns that shouldn't be converted:
 * - '*' (select all)
 * - Strings already containing underscores (likely already snake_case)
 * - Strings with special characters or syntax
 */
function convertColumnToSnakeCase(column: string | symbol): string {
  if (typeof column === 'symbol') return String(column);

  // Don't convert special patterns
  if (
    column === '*' || // select all
    column.includes('_') || // already has underscores, assume snake_case
    column.includes('(') || // function calls
    column.includes(')') || // function calls
    column.includes('.') || // nested columns
    column.includes('->') || // JSON operators
    column.includes('::') // type casts
  ) {
    return column;
  }

  // Simple regex conversion
  // Handles camelCase and PascalCase: userId -> user_id, UserID -> user_id
  return column.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Creates a proxy wrapper around a Supabase query builder that:
 * 1. Converts camelCase column names to snake_case
 * 2. Converts camelCase data objects to snake_case
 * 3. Converts snake_case response data to camelCase
 * 4. Automatically forwards all other methods without manual implementation
 *
 * This approach eliminates the need to manually implement or list any Supabase methods.
 * All methods are automatically supported including any new ones added to the Supabase API.
 *
 * Note: Proxy implementations inherently require working with `any` types.
 * Type safety is preserved at the API level through proper type definitions.
 */
function createQueryProxy<
  DB extends Record<string, any>,
  T extends keyof DB['public']['Tables'],
>(queryBuilder: any, proxyCache?: WeakMap<any, any>): any {
  // Check cache if enabled
  if (proxyCache) {
    // eslint-disable-next-line ts/no-unsafe-assignment
    const cached = proxyCache.get(queryBuilder);
    if (cached !== undefined) {
      return cached;
    }
  }

  /* eslint-disable ts/no-unsafe-assignment, ts/no-unsafe-member-access, ts/no-unsafe-call, ts/no-unsafe-return */
  const handler = {
    get(obj: any, prop: string | symbol): any {
      const value = obj[prop];

      // Handle 'then' for promise resolution with data transformation
      if (prop === 'then' && typeof value === 'function') {
        return (onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) =>
          value.call(
            obj,
            async (result: PostgrestResponse<any>) => {
              const transformedResult = {
                ...result,
                data:
                  result.data != null
                    ? (keysToCamelCase(result.data) as
                        | CamelCaseRow<DB, T>[]
                        | CamelCaseRow<DB, T>)
                    : null,
              };
              return onfulfilled ? onfulfilled(transformedResult) : transformedResult;
            },
            onrejected,
          );
      }

      // Not a function, return as-is
      if (typeof value !== 'function') return value;

      // Return a wrapped function
      return (...args: any[]) => {
        //
        // Intelligently convert arguments based on their type:
        // - String first argument -> likely a column name, convert to snake_case
        // - Plain object/Array first argument -> likely data, convert keys to snake_case
        // - Everything else -> pass through as-is
        //
        const processedArgs = args.map((arg, index) => {
          // First argument special handling
          if (index === 0 && arg != null) {
            // Column name (string)
            if (typeof arg === 'string') return convertColumnToSnakeCase(arg);
            // Data object or array of data objects
            // Only convert plain objects or arrays, not special objects like AbortSignal, Date, etc.
            if (
              typeof arg === 'object' &&
              (Array.isArray(arg) || Object.getPrototypeOf(arg) === Object.prototype)
            ) {
              return keysToSnakeCase(arg);
            }
          }
          // All other arguments pass through
          return arg;
        });

        // Call the original method
        const result = value.apply(obj, processedArgs);

        // For methods that return chainable query builders or promises, wrap in proxy
        // Only wrap if it's an object (query builders, promises, etc.)
        if (result != null && typeof result === 'object')
          return createQueryProxy<DB, T>(result, proxyCache);

        return result;
      };
    },
  };
  /* eslint-enable ts/no-unsafe-assignment, ts/no-unsafe-member-access, ts/no-unsafe-call, ts/no-unsafe-return */

  // eslint-disable-next-line ts/no-unsafe-assignment
  const proxy = new Proxy(queryBuilder, handler);

  // Cache the proxy if caching is enabled
  if (proxyCache) {
    proxyCache.set(queryBuilder, proxy);
  }

  return proxy;
}

/**
 * CamelCase database wrapper that only wraps database operations
 */
class CamelCaseDb<DB extends Record<string, any>> {
  private proxyCache?: WeakMap<any, any>;

  constructor(
    private supabaseClient: SupabaseClient<DB>,
    options: CamelCaseDbOptions = {},
  ) {
    // Only create cache if explicitly enabled
    if (options.cacheProxies === true) {
      this.proxyCache = new WeakMap<any, any>();
    }
  }

  from<T extends keyof DB['public']['Tables']>(table: T): any {
    const originalTable = this.supabaseClient.from(table as string);
    return createQueryProxy<DB, T>(originalTable, this.proxyCache);
  }
}

/**
 * Creates a camelCase database wrapper from an existing Supabase client.
 * Only wraps database operations - auth, storage, realtime, etc. remain unchanged.
 *
 * @param supabaseClient - Your configured Supabase client
 * @param options - Configuration options
 * @returns A database wrapper with automatic camelCase conversion
 *
 * @example
 * ```typescript
 * import { createClient } from '@supabase/supabase-js';
 * import { createCamelCaseDb } from 'supabase-camel';
 *
 * const supabase = createClient(url, key);
 *
 * // Without proxy cache (default, simpler)
 * const db = createCamelCaseDb(supabase);
 *
 * // With proxy cache enabled (prevents nested proxies)
 * const dbCached = createCamelCaseDb(supabase, { cacheProxies: true });
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
  options: CamelCaseDbOptions = {},
): CamelCaseDb<DB> {
  return new CamelCaseDb(supabaseClient, options);
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
