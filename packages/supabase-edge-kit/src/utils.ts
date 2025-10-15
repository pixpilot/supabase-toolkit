import type { SupabaseClient, User } from '@supabase/supabase-js';

import { createClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client with proper authentication
 */
export function createSupabaseClient<DB = any>(
  req: Request,
): ReturnType<typeof createClient<DB>> {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')!,
        },
      },
    },
  );
}

/**
 * Create a Supabase admin client with service role key (bypasses RLS)
 */
export function createSupabaseAdminClient<DB = any>(): ReturnType<
  typeof createClient<DB>
> {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

/**
 * Handle CORS preflight requests
 */
// eslint-disable-next-line ts/explicit-module-boundary-types
export function autoHandlePreflight(cors: any): Response {
  return new Response('ok', { headers: cors as unknown as Record<string, string> });
}

/**
 * Validate request method
 */
export function validateMethod(req: Request, allowedMethods: string[]): boolean {
  return allowedMethods.includes(req.method);
}

export async function getUser<DB = any>(
  supabaseClient: SupabaseClient<DB>,
): Promise<User | null> {
  try {
    const {
      data: { user },
      error,
    } = await supabaseClient.auth.getUser();
    if (error) throw error;
    return user;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(requiredVars: string[]): string[] {
  const missing = requiredVars.filter((varName) => Deno.env.get(varName) == null);
  return missing;
}

/**
 * Rate limiting helper (basic implementation)
 */
export class RateLimiter {
  private requests = new Map<string, number[]>();

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const userRequests = this.requests.get(identifier) || [];
    const recentRequests = userRequests.filter((time) => time > windowStart);

    if (recentRequests.length >= this.maxRequests) {
      return false;
    }

    recentRequests.push(now);
    this.requests.set(identifier, recentRequests);
    return true;
  }
}
