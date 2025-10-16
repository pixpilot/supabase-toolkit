# Supabase Edge Kit

Type-safe toolkit for building Supabase Edge Functions with built-in authentication, error handling, and CORS support.

## Installation

Add to your `deno.json`:

```json
{
  "imports": {
    "supabase-edge-kit": "npm:supabase-edge-kit@1.1.0",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

## Quick Start

### Authenticated Function

```typescript
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'supabase-edge-kit';

createServer(
  async ({ user, client, respond }) => {
    const { data } = await client.from('users').select('*').eq('user_id', user.id);

    return respond.success(data);
  },
  {
    createClient: (url, key, options) => createClient(url, key, options),
  },
);
```

### Public Endpoint

```typescript
createServer(async ({ respond }) => respond.success({ status: 'healthy' }), {
  createClient: (url, key, options) => createClient(url, key, options),
  authenticate: false,
  allowedMethods: ['GET'],
});
```

### With Input Validation

```typescript
import { z, ZodError } from 'zod';

const schema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
});

createServer(
  async ({ request, user, client, respond }) => {
    try {
      const body = await request.json();
      const validatedData = schema.parse(body);

      const { data } = await client
        .from('jobs')
        .insert({ ...validatedData, user_id: user.id })
        .select()
        .single();

      return respond.success(data);
    } catch (error) {
      if (error instanceof ZodError) {
        return respond.badRequest({
          message: 'Validation failed',
          details: error.format(),
        });
      }
      throw error;
    }
  },
  {
    createClient: (url, key, options) => createClient(url, key, options),
  },
);
```

### With Database Types

Generate types: `npx supabase gen types typescript --local > database.types.ts`

```typescript
import type { Database } from './database.types';
import { createClient } from '@supabase/supabase-js';

createServer<Database>( // Optional: explicitly specify Database type
  async ({ user, client, respond }) => {
    // Fully typed queries - client is typed with Database
    const { data } = await client.from('todos').select('*').eq('user_id', user.id);

    return respond.success(data);
  },
  {
    createClient: (url, key) => createClient<Database>(url, key),
  },
);
```

## API Reference

### `createServer<Database>(callback, options)`

**Options:**

```typescript
interface ServerOptions<TDatabase = any> {
  authenticate?: boolean; // Default: true
  allowedMethods?: string[]; // Default: ['POST']
  timeoutMs?: number; // Default: 60000
  autoHandlePreflight?: boolean; // Default: true
  headers?: Partial<ResponseHeaders>; // Custom response headers
  requiredEnvVars?: string[]; // Default: []
  onError?: (error) => { message; code?; details? } | null;
  createClient: (url, key, options?) => SupabaseClient<TDatabase>; // Required
}
```

**Context:**

```typescript
interface ServerCallbackContext<TDatabase = any> {
  request: Request;
  user: User; // Required if authenticate: true
  client: SupabaseClient<TDatabase>;
  adminClient: SupabaseClient<TDatabase>;
  headers: ResponseHeaders; // Merged response headers (defaults + custom)
  respond: {
    // All response helpers with default headers
    success: <T>(
      data: T,
      message?: string,
      status?: number,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    error: (
      error: string | ApiError,
      status?: number,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    ok: <T>(data: T, message?: string, headers?: Partial<ResponseHeaders>) => Response;
    badRequest: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    unauthorized: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    forbidden: (error: string | ApiError, headers?: Partial<ResponseHeaders>) => Response;
    notFound: (error: string | ApiError, headers?: Partial<ResponseHeaders>) => Response;
    methodNotAllowed: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    requestTimeout: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    conflict: (error: string | ApiError, headers?: Partial<ResponseHeaders>) => Response;
    unprocessableEntity: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    tooManyRequests: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    internalServerError: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
    serviceUnavailable: (
      error: string | ApiError,
      headers?: Partial<ResponseHeaders>,
    ) => Response;
  };
}
```

### Response Helpers

All response helpers are available via `context.respond.*` and automatically use the configured response headers. You can optionally override headers for specific responses:

```typescript
// Uses default headers from server config
return respond.success(data);

// Override headers for this specific response
const successStatus = 200;
return respond.success(data, 'Custom message', successStatus, {
  'Access-Control-Allow-Origin': 'https://custom-domain.com',
});
```

**Available response helpers:**

- `respond.success(data, message?, status?, headers?)` - Success response (default: 200)
- `respond.error(error, status?, headers?)` - Error response (default: 400)
- `respond.ok(data, message?, headers?)` - OK response (200)
- `respond.badRequest(error, headers?)` - Bad Request (400)
- `respond.unauthorized(error, headers?)` - Unauthorized (401)
- `respond.forbidden(error, headers?)` - Forbidden (403)
- `respond.notFound(error, headers?)` - Not Found (404)
- `respond.methodNotAllowed(error, headers?)` - Method Not Allowed (405)
- `respond.requestTimeout(error, headers?)` - Request Timeout (408)
- `respond.conflict(error, headers?)` - Conflict (409)
- `respond.unprocessableEntity(error, headers?)` - Unprocessable Entity (422)
- `respond.tooManyRequests(error, headers?)` - Too Many Requests (429)
- `respond.internalServerError(error, headers?)` - Internal Server Error (500)
- `respond.serviceUnavailable(error, headers?)` - Service Unavailable (503)

## Common Patterns

### Multiple HTTP Methods

```typescript
createServer(
  async ({ request, user, client, respond }) => {
    if (request.method === 'GET') {
      const { data } = await client.from('users').select('*').eq('user_id', user.id);
      return respond.success(data);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const { data } = await client
        .from('users')
        .insert({ ...body, user_id: user.id })
        .select()
        .single();
      return respond.success(data);
    }

    return respond.badRequest('Bad Request');
  },
  {
    createClient: (url, key, options) => createClient(url, key, options),
    allowedMethods: ['GET', 'POST'],
  },
);
```

### Admin Operations

```typescript
createServer(
  async ({ user, client, adminClient, respond }) => {
    const { data: userRole } = await client
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (userRole?.role !== 'admin') {
      return respond.forbidden('Insufficient permissions');
    }

    // Use admin client to bypass RLS
    const { data } = await adminClient.from('sensitive_data').select('*');

    return respond.success(data);
  },
  {
    createClient: (url, key, options) => createClient(url, key, options),
  },
);
```

### File Uploads

```typescript
createServer(
  async ({ request, user, client, respond }) => {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return respond.badRequest('No file provided');
    }

    const { data, error } = await client.storage
      .from('uploads')
      .upload(`${user.id}/${file.name}`, file);

    if (error) {
      return respond.badRequest(error.message);
    }

    return respond.success({ path: data.path });
  },
  {
    createClient: (url, key, options) => createClient(url, key, options),
    allowedMethods: ['POST'],
  },
);
```

### Custom Response Headers per Response

```typescript
createServer(
  async ({ respond }) => {
    // Use default headers
    if (someCondition) {
      return respond.success({ data: 'default headers' });
    }

    // Override headers for specific response
    return respond.success({ data: 'custom headers' }, 'Success', undefined, {
      'Access-Control-Allow-Origin': 'https://specific-domain.com',
    });
  },
  {
    createClient: (url, key, options) => createClient(url, key, options),
    headers: {
      'Access-Control-Allow-Origin': 'https://default-domain.com',
    },
  },
);
```

### Error Handling with Zod

You can handle validation errors globally using the `onError` option:

```typescript
import { z, ZodError } from 'zod';

createServer(
  async ({ request, client, respond }) => {
    const body = await request.json();
    const validatedData = schema.parse(body); // Will be caught by onError
    // ... rest of your logic
  },
  {
    createClient: (url, key) => createClient(url, key),
    onError: (error) => {
      if (error instanceof ZodError) {
        return {
          message: error.issues.map((issue) => issue.message).join(', '),
          code: 'VALIDATION_ERROR',
        };
      }
      return null; // Use default error handling
    },
  },
);
```

## License

MIT
