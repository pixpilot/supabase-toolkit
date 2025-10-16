import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { RespondHelpers, ResponseHeaders } from './types.ts';

/**
 * Data passed to the server callback function
 */
export interface ServerCallbackContext<
  TDatabase = any,
  TAuthenticate extends boolean = true,
> {
  /**
   * The incoming HTTP request
   */
  request: Request;
  /**
   * Authenticated user (if authentication is enabled)
   * - Required when authenticate is true
   * - Optional when authenticate is false
   */
  user: TAuthenticate extends true ? User : User | undefined;
  /**
   * Supabase client with user context (respects RLS)
   */
  client: SupabaseClient<TDatabase>;
  /**
   * Supabase admin client (bypasses RLS)
   */
  adminClient: SupabaseClient<TDatabase>;
  /**
   * Merged response headers (defaults + custom)
   */
  headers: ResponseHeaders;
  /**
   * Response helper functions with context headers defaults
   */
  respond: RespondHelpers;
}

/**
 * Server callback function type
 * Supports both synchronous and asynchronous callbacks
 */
export type ServerCallback<TDatabase = any, TAuthenticate extends boolean = true> = (
  context: ServerCallbackContext<TDatabase, TAuthenticate>,
) => Response | Promise<Response>;
