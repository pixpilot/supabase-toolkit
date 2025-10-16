import type { User } from '@supabase/supabase-js';

import type { ServerCallback, ServerCallbackContext } from './types/server-callback.ts';
import type { ServerOptions } from './types/server-options.ts';

import type { ResponseHeaders } from './types/types.ts';
import { ZodError } from 'zod';
import { defaultResponseHeaders } from './constants.ts';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_METHOD_NOT_ALLOWED,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_UNAUTHORIZED,
} from './http-status.ts';
import { createRespondHelpers } from './respond-factory.ts';
import { createErrorResponse } from './responses.ts';
import { autoHandlePreflight, validateEnvironment, validateMethod } from './utils.ts';

/**
 * Configuration type for the server with required properties except onError
 */
type ServerConfig<TDatabase = any> = Required<Omit<ServerOptions<TDatabase>, 'onError'>> &
  Pick<ServerOptions<TDatabase>, 'onError'>;

/**
 * Default server options (excluding createClient which is required)
 */
const DEFAULT_OPTIONS: Omit<ServerOptions, 'createClient'> = {
  authenticate: true,
  allowedMethods: ['POST'] as string[],
  requiredEnvVars: [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as string[],
  timeoutMs: 60000,
  autoHandlePreflight: true,
  headers: {},
};

/**
 * Creates a reusable Supabase Edge Function server with common functionality
 * When authenticate is true (default), user is guaranteed to be defined
 * The Database type is automatically inferred from the createClient function
 *
 * @param callback - The main logic function to execute
 * @param configurations - Configuration options for the server
 *
 * @example
 * ```typescript
 * import type { Database } from './database.types';
 * import { createClient } from '@supabase/supabase-js';
 * import { createServer } from 'supabase-edge-kit';
 *
 * // Database type is inferred from createClient<Database>
 * createServer(async ({ request, user, supabaseClient }) => {
 *   const body = await request.json();
 *   // user is guaranteed to be defined here
 *   // supabaseClient is fully typed with Database type
 *   return createSuccessResponse({ message: 'Hello world' });
 * }, {
 *   createClient: (url, key, options) => createClient<Database>(url, key, options)
 * });
 * ```
 */
// Overload 1: Explicit Database type with authenticate: true (or default)
export function createServer<TDatabase = any>(
  callback: ServerCallback<TDatabase, true>,
  configurations: ServerOptions<TDatabase> & { authenticate?: true },
): void;

// Overload 2: Explicit Database type with authenticate: false
export function createServer<TDatabase = any>(
  callback: ServerCallback<TDatabase, false>,
  options: ServerOptions<TDatabase> & { authenticate: false },
): void;

// Implementation with automatic type inference
export function createServer<TDatabase = any>(
  callback: ServerCallback<TDatabase, any>,
  options: ServerOptions<TDatabase>,
): void {
  const config = { ...DEFAULT_OPTIONS, ...options } as ServerConfig<TDatabase>;
  // Merge response headers - after merging with defaults, we have a complete ResponseHeaders object
  config.headers = {
    ...defaultResponseHeaders,
    'Access-Control-Allow-Methods': [...config.allowedMethods, 'OPTIONS'].join(', '),
    ...config.headers,
  } as ResponseHeaders;
  // eslint-disable-next-line ts/no-floating-promises
  Deno.serve(async (req: Request) => {
    try {
      // Handle CORS preflight requests
      if (config.autoHandlePreflight && req.method === 'OPTIONS') {
        return autoHandlePreflight(config.headers as ResponseHeaders);
      }

      // Validate HTTP method
      if (!validateMethod(req, config.allowedMethods)) {
        return createErrorResponse(
          'Method not allowed',
          HTTP_STATUS_METHOD_NOT_ALLOWED,
          config.headers,
        );
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
        processRequest<TDatabase>(req, callback, config),
        timeoutPromise,
      ]);

      return result;
    } catch (error) {
      // Handle timeout errors
      if (error instanceof Error && error.message.includes('Request timed out')) {
        return createErrorResponse(
          'Request timed out',
          HTTP_STATUS_REQUEST_TIMEOUT,
          config.headers,
        );
      }

      // Handle other errors
      console.error('Server error:', error);
      return createErrorResponse(
        error instanceof Error ? error.message : 'Internal server error',
        HTTP_STATUS_INTERNAL_SERVER_ERROR,
        config.headers,
      );
    }
  });
}

/**
 * Process the incoming request with all validations and setup
 */
async function processRequest<TDatabase = any, TAuthenticate extends boolean = true>(
  req: Request,
  callback: ServerCallback<TDatabase, TAuthenticate>,
  config: ServerConfig<TDatabase>,
): Promise<Response> {
  // Validate required environment variables
  const missingEnvVars = validateEnvironment(config.requiredEnvVars);
  if (missingEnvVars.length > 0) {
    return createErrorResponse(
      `Missing required environment variables: ${missingEnvVars.join(', ')}`,
      HTTP_STATUS_INTERNAL_SERVER_ERROR,
      config.headers,
    );
  }

  // Create Supabase clients using injected createClient function
  const supabaseClient = config.createClient(
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

  const supabaseAdminClient = config.createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Handle authentication if required
  let user: User | undefined;
  if (config.authenticate) {
    try {
      // Get user from the supabaseClient
      const result = await supabaseClient.auth.getUser();
      const fetchedUser = result.data.user;
      if (result.error != null) throw result.error;
      user = fetchedUser ?? undefined;
      if (user == null) {
        return createErrorResponse(
          'Unauthorized',
          HTTP_STATUS_UNAUTHORIZED,
          config.headers,
        );
      }
    } catch (error) {
      console.error('Error getting user:', error);
      return createErrorResponse(
        'Unauthorized',
        HTTP_STATUS_UNAUTHORIZED,
        config.headers,
      );
    }
  }

  // Create respond helpers with context headers defaults
  const respond = createRespondHelpers(config.headers);

  // Create context and call the callback
  const context = {
    request: req,
    user,
    supabaseClient,
    supabaseAdminClient,
    headers: config.headers,
    respond,
  } as ServerCallbackContext<TDatabase, TAuthenticate>;

  try {
    return await callback(context);
  } catch (error) {
    // Try custom error handler first if provided
    if (config.onError != null) {
      const customError = config.onError(error);
      if (customError != null) {
        return createErrorResponse(customError, HTTP_STATUS_BAD_REQUEST, config.headers);
      }
    }

    if (error instanceof ZodError) {
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
      return createErrorResponse(
        'Invalid JSON in request body',
        HTTP_STATUS_BAD_REQUEST,
        config.headers,
      );
    }

    // Re-throw other errors to be handled by the outer catch block
    throw error;
  }
}
