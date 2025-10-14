/* eslint-disable no-console */
import type { User } from '@supabase/supabase-js';

import { z, ZodError } from 'zod';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_METHOD_NOT_ALLOWED,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_UNAUTHORIZED,
} from './http-status.ts';
import { createErrorResponse } from './responses.ts';
import {
  createSupabaseAdminClient,
  createSupabaseClient,
  getUser,
  handleCors,
  validateEnvironment,
  validateMethod,
} from './utils.ts';

export function testZodVersion(): 'v3' | 'v4' {
  try {
    // ✅ 1. Zod v4 introduced `z.string().pipe()`
    z.string().pipe(z.string());

    // ✅ 2. Zod v4 introduced `z.uuidv4()` (alias for stricter UUIDs)
    // eslint-disable-next-line ts/no-unsafe-call, ts/no-unsafe-member-access
    (z as any).uuid();

    // ✅ 3. Zod v4’s `ZodError` includes `.issues` array that always has a `message`

    const error = (() => {
      try {
        z.string().parse(123);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    // eslint-disable-next-line ts/strict-boolean-expressions, ts/no-unsafe-member-access, unicorn/error-message
    if (!error || !Array.isArray((error as any).issues)) throw new Error();

    // ✅ 4. Zod v4 schema has a `readonly()` method (not present in v3)

    // ✅ 5. Zod v4 added `catch()` (was `catchall()` in v3)
    z.string().catch('default');

    // ✅ 6. Zod v4’s `ZodObject` supports `.extend()` with readonly props (runtime difference)
    z.object({ a: z.string() }).extend({ b: z.number() });

    console.log('✅ Library: Zod v4 features available');
    return 'v4';
  } catch {
    console.log('❌ Library: Using Zod v3');
    return 'v3';
  }
}

/**
 * Configuration options for the server
 */
export interface ServerOptions {
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
   * Whether to handle CORS automatically (default: true)
   */
  handleCors?: boolean;
}

/**
 * Data passed to the server callback function
 */
export interface ServerCallbackContext<DB = any> {
  /**
   * The incoming HTTP request
   */
  request: Request;
  /**
   * Authenticated user (if authentication is enabled)
   */
  user?: User;
  /**
   * Supabase client with user context
   */
  supabaseClient: ReturnType<typeof createSupabaseClient<DB>>;
  /**
   * Supabase admin client (bypasses RLS)
   */
  supabaseAdminClient: ReturnType<typeof createSupabaseAdminClient<DB>>;
}

/**
 * Server callback function type
 */
export type ServerCallback<DB = any> = (
  context: ServerCallbackContext<DB>,
) => Promise<Response>;

/**
 * Default server options
 */
const DEFAULT_OPTIONS: Required<ServerOptions> = {
  authenticate: true,
  allowedMethods: ['POST'],
  requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  timeoutMs: 60000,
  handleCors: true,
};

/**
 * Creates a reusable Supabase Edge Function server with common functionality
 *
 * @param callback - The main logic function to execute
 * @param options - Configuration options for the server
 *
 * @example
 * ```typescript
 * import { createServer } from '../_shared/create-server.ts';
 *
 * createServer(async ({ request, user, supabaseClient }) => {
 *   const body = await request.json();
 *   // Your logic here
 *   return createSuccessResponse({ message: 'Hello world' });
 * });
 * ```
 */
export function createServer<DB = any>(
  callback: ServerCallback<DB>,
  options: ServerOptions = {},
): void {
  const config = { ...DEFAULT_OPTIONS, ...options };
  testZodVersion();
  // eslint-disable-next-line ts/no-floating-promises
  Deno.serve(async (req: Request) => {
    try {
      // Handle CORS preflight requests
      if (config.handleCors && req.method === 'OPTIONS') {
        return handleCors();
      }

      // Validate HTTP method
      if (!validateMethod(req, config.allowedMethods)) {
        return createErrorResponse('Method not allowed', HTTP_STATUS_METHOD_NOT_ALLOWED);
      }

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Request timed out after ${config.timeoutMs}ms`)),
          config.timeoutMs,
        );
      });

      // Race the main processing against the timeout
      const result = await Promise.race([
        processRequest<DB>(req, callback, config),
        timeoutPromise,
      ]);

      return result;
    } catch (error) {
      // Handle timeout errors
      if (error instanceof Error && error.message.includes('Request timed out')) {
        return createErrorResponse('Request timed out', HTTP_STATUS_REQUEST_TIMEOUT);
      }

      // Handle other errors
      console.error('Server error:', error);
      return createErrorResponse(
        error instanceof Error ? error.message : 'Internal server error',
        HTTP_STATUS_INTERNAL_SERVER_ERROR,
      );
    }
  });
}

/**
 * Process the incoming request with all validations and setup
 */
async function processRequest<DB = any>(
  req: Request,
  callback: ServerCallback<DB>,
  config: Required<ServerOptions>,
): Promise<Response> {
  // Validate required environment variables
  const missingEnvVars = validateEnvironment(config.requiredEnvVars);
  if (missingEnvVars.length > 0) {
    return createErrorResponse(
      `Missing required environment variables: ${missingEnvVars.join(', ')}`,
      HTTP_STATUS_INTERNAL_SERVER_ERROR,
    );
  }

  // Create Supabase clients
  const supabaseClient = createSupabaseClient<DB>(req);
  const supabaseAdminClient = createSupabaseAdminClient<DB>();

  // Handle authentication if required
  let user: User | undefined;
  if (config.authenticate) {
    user = (await getUser(supabaseClient)) ?? undefined;
    if (!user) {
      return createErrorResponse('Unauthorized', HTTP_STATUS_UNAUTHORIZED);
    }
  }

  // Create context and call the callback with enhanced error handling
  const context: ServerCallbackContext<DB> = {
    request: req,
    user: user!,
    supabaseClient,
    supabaseAdminClient,
  };

  try {
    return await callback(context);
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      console.error('Validation error:', error.format());
      return createErrorResponse(
        {
          message: 'Invalid data provided.',
          code: 'VALIDATION_ERROR',
          details: error.format(),
        },
        HTTP_STATUS_BAD_REQUEST,
      );
    }
    // Handle JSON parsing errors
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      console.error('JSON parsing error:', error);
      return createErrorResponse('Invalid JSON in request body', HTTP_STATUS_BAD_REQUEST);
    }

    // Re-throw other errors to be handled by the outer catch block
    throw error;
  }
}
