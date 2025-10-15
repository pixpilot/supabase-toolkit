import type { SupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js';
import type { ResponseHeaders } from './types.ts';

/**
 * Configuration options for the server
 */
export interface ServerOptions<TDatabase = any> {
  /**
   * Whether to require user authentication (default: true)
   */
  authenticate?: boolean;
  /**
   * Allowed HTTP methods (default: ['POST'])
   */
  allowedMethods?: string[];
  /**
   * Required environment variables to validate
   */
  requiredEnvVars?: string[];
  /**
   * Request timeout in milliseconds (default: 15000)
   */
  timeoutMs?: number;
  /**
   * Automatically handle CORS preflight (OPTIONS) requests (default: true)
   *
   * When enabled, the server automatically responds to OPTIONS requests with CORS headers.
   * Preflight responses are cached by browsers based on the Access-Control-Max-Age header.
   *
   * Set to false if you need custom preflight logic or handle CORS at a different layer.
   */
  autoHandlePreflight?: boolean;
  /**
   * Custom response headers to merge with defaults
   */
  headers?: Partial<ResponseHeaders>;
  /**
   * Function to create a Supabase client
   * This function should handle both user-scoped and admin clients
   *
   * @example
   * ```typescript
   * import { createClient } from '@supabase/supabase-js';
   *
   * createServer(callback, {
   *   createClient: (url: string, key: string, options?) =>
   *     createClient(url, key, options)
   * })
   * ```
   */
  createClient: (
    url: string,
    key: string,
    options?: SupabaseClientOptions<any>,
  ) => SupabaseClient<TDatabase>;
  /**
   * Optional error handler callback for custom error processing
   * Return an object with message and code to handle the error, or null to use default error handling
   *
   * @example
   * ```typescript
   * import { ZodError } from 'zod';
   *
   * createServer(callback, {
   *   createClient: (url, key, options) => createClient(url, key, options),
   *   onError: (error) => {
   *     if (error instanceof ZodError) {
   *       return {
   *         message: 'Validation failed',
   *         code: 'VALIDATION_ERROR',
   *         details: error.format()
   *       };
   *     }
   *     return null; // Let the library handle other errors
   *   }
   * })
   * ```
   */
  onError?: (error: unknown) => { message: string; code?: string; details?: any } | null;
}

/**
 * Complex config type used in the createServer function
 */
export type CreateServerConfig<TDatabase> = Required<
  Omit<ServerOptions<TDatabase>, 'onError'>
> &
  Pick<ServerOptions<TDatabase>, 'onError'>;
