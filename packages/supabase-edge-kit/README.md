# Supabase Edge Kit

A lightweight, type-safe toolkit for building robust Supabase Edge Functions with built-in authentication, validation, error handling, and timeout protection.

## ✨ Features

- 🔐 **Built-in Authentication** - User auth handling out of the box
- ✅ **Automatic Validation** - Zod schema validation with detailed error messages
- 🛡️ **Error Handling** - Automatic handling of JSON parsing, validation, and timeout errors
- 📤 **Response Helpers** - Convenient functions for all HTTP status codes
- 🌐 **CORS Support** - Automatic CORS handling for preflight requests
- ⏱️ **Timeout Protection** - Configurable request timeouts (default: 60s)
- 🔧 **Environment Validation** - Ensure required env vars are present
- 📝 **TypeScript First** - Full type safety with custom database types
- 🎯 **Minimal Boilerplate** - Focus on your business logic

## 📦 Installation

Add to your `deno.json` in your Supabase functions directory:

```json
{
  "imports": {
    "supabase-edge-kit": "npm:supabase-edge-kit@0.0.0",
    "zod": "npm:zod@4.1.11",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

## 🚀 Quick Start

### Basic Authenticated Function

```typescript
// functions/my-function/index.ts
import { createServer, createSuccessResponse } from 'supabase-edge-kit';

createServer(async ({ user, supabaseClient }) => {
  const { data } = await supabaseClient.from('jobs').select('*').eq('user_id', user!.id);

  return createSuccessResponse(data);
});
```

**That's it!** You now have a fully functional Edge Function with authentication, CORS, error handling, and timeout protection.

### With Input Validation

```typescript
import {
  createServer,
  createSuccessResponse,
  validateRequestBody,
} from 'supabase-edge-kit';

import { z } from 'zod';

const createJobSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  company: z.string().min(1, 'Company is required'),
  location: z.string().optional(),
  salary: z.number().positive().optional(),
});

createServer(async ({ request, user, supabaseClient }) => {
  const body = await request.json();

  // Validate input - returns error response automatically if invalid
  const validation = validateRequestBody(body, createJobSchema);
  if (!validation.success) {
    return validation.response;
  }

  // validation.data is fully typed!
  const { data } = await supabaseClient
    .from('jobs')
    .insert({
      ...validation.data,
      user_id: user!.id,
    })
    .select()
    .single();

  return createSuccessResponse(data, 'Job created successfully');
});
```

### Public Endpoint (No Authentication)

```typescript
// functions/health/index.ts
import { createServer, createSuccessResponse } from 'supabase-edge-kit';

createServer(
  async () =>
    createSuccessResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
  {
    authenticate: false,
    allowedMethods: ['GET'],
  },
);
```

## 📖 API Reference

### `createServer(callback, options?)`

Creates a Supabase Edge Function with built-in functionality.

#### Callback Context

```typescript
interface ServerCallbackContext<DB> {
  request: Request; // The incoming HTTP request
  user?: User; // Authenticated user (if auth enabled)
  supabaseClient: SupabaseClient<DB>; // User-scoped client (respects RLS)
  supabaseAdminClient: SupabaseClient<DB>; // Admin client (bypasses RLS)
}
```

#### Options

```typescript
interface ServerOptions {
  authenticate?: boolean; // Require authentication (default: true)
  allowedMethods?: string[]; // Allowed HTTP methods (default: ['POST'])
  requiredEnvVars?: string[]; // Required environment variables
  timeoutMs?: number; // Request timeout in ms (default: 60000)
  handleCors?: boolean; // Auto-handle CORS (default: true)
}
```

**Example:**

```typescript
createServer(callback, {
  authenticate: false,
  allowedMethods: ['GET', 'POST'],
  timeoutMs: 30000,
  requiredEnvVars: ['OPENAI_API_KEY', 'STRIPE_SECRET_KEY'],
});
```

### Response Helpers

```typescript
import {
  createBadRequestResponse,
  createConflictResponse,
  createErrorResponse,
  createForbiddenResponse,
  createInternalServerErrorResponse,
  createMethodNotAllowedResponse,
  createNotFoundResponse,
  createOkResponse,
  createRequestTimeoutResponse,
  createServiceUnavailableResponse,
  createSuccessResponse,
  createTooManyRequestsResponse,
  createUnauthorizedResponse,
  createUnprocessableEntityResponse,
} from 'supabase-edge-kit';

// Success response
return createSuccessResponse(data, 'Optional success message');
return createOkResponse(data, 'Success message'); // Same as above

// Error responses - convenient methods
return createBadRequestResponse('Invalid input data');
return createUnauthorizedResponse('Authentication required');
return createForbiddenResponse('Insufficient permissions');
return createNotFoundResponse('Resource not found');
return createMethodNotAllowedResponse('Method not allowed');
return createRequestTimeoutResponse('Request timed out');
return createConflictResponse('Resource conflict');
return createUnprocessableEntityResponse('Validation failed');
return createTooManyRequestsResponse('Rate limit exceeded');
return createInternalServerErrorResponse('Internal server error');
return createServiceUnavailableResponse('Service temporarily unavailable');

// Or use the generic functions with custom status
return createErrorResponse('Custom error', HTTP_STATUS_BAD_REQUEST);
return createErrorResponse(
  { message: 'Not found', code: 'RESOURCE_NOT_FOUND' },
  HTTP_STATUS_NOT_FOUND,
);
```

### Validation Helper

```typescript
import { validateRequestBody } from 'supabase-edge-kit';
import { z } from 'zod';

const schema = z.object({ name: z.string() });
const validation = validateRequestBody(body, schema);

if (!validation.success) {
  return validation.response; // Returns 400 with detailed errors
}

// validation.data is typed according to your schema
const { name } = validation.data;

// Always return a value at the end
return createSuccessResponse({ name });
```

## 📋 Common Patterns

### Pagination

```typescript
import {
  builtInSchemas,
  createServer,
  createSuccessResponse,
  validateRequestBody,
} from 'supabase-edge-kit';

createServer(async ({ request, user, supabaseClient }) => {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());

  // Validate pagination params (page, limit)
  const validation = validateRequestBody(queryParams, builtInSchemas.paginationQuery);
  if (!validation.success) return validation.response;

  const { page, limit } = validation.data;
  const offset = (page - 1) * limit;

  const { data, count } = await supabaseClient
    .from('jobs')
    .select('*', { count: 'exact' })
    .eq('user_id', user!.id)
    .range(offset, offset + limit - 1);

  return createSuccessResponse({
    data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
});
```

### Admin Operations

```typescript
import {
  createErrorResponse,
  createServer,
  createSuccessResponse,
  HTTP_STATUS_FORBIDDEN,
} from 'supabase-edge-kit';

createServer(async ({ user, supabaseClient, supabaseAdminClient }) => {
  // Check if user has admin role
  const { data: userRole } = await supabaseClient
    .from('user_roles')
    .select('role')
    .eq('user_id', user!.id)
    .single();

  if (userRole?.role !== 'admin') {
    return createForbiddenResponse('Insufficient permissions');
  }

  // Use admin client to bypass RLS for privileged operations
  const { data } = await supabaseAdminClient.from('sensitive_data').select('*');

  return createSuccessResponse(data);
});
```

### Multiple HTTP Methods

```typescript
createServer(
  async ({ request, user, supabaseClient }) => {
    if (request.method === 'GET') {
      // Handle GET - fetch data
      const { data } = await supabaseClient
        .from('jobs')
        .select('*')
        .eq('user_id', user!.id);
      return createSuccessResponse(data);
    }

    if (request.method === 'POST') {
      // Handle POST - create data
      const body = await request.json();
      const { data } = await supabaseClient
        .from('jobs')
        .insert({ ...body, user_id: user!.id })
        .select()
        .single();
      return createSuccessResponse(data);
    }

    return createBadRequestResponse('Bad Request');

    // Other methods rejected automatically
  },
  {
    allowedMethods: ['GET', 'POST'],
  },
);
```

### File Uploads

```typescript
createServer(
  async ({ request, user, supabaseClient }) => {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return createBadRequestResponse('No file provided');
    }

    // Upload to Supabase Storage
    const { data, error } = await supabaseClient.storage
      .from('uploads')
      .upload(`${user!.id}/${file.name}`, file);

    if (error) {
      return createBadRequestResponse(error.message);
    }

    return createSuccessResponse({ path: data.path });
  },
  {
    allowedMethods: ['POST'],
  },
);
```

## 🎯 Advanced Usage

### Custom Database Types

Generate types from your database and use them for full type safety:

```bash
npx supabase gen types typescript --local > database/types/database.ts
```

```typescript
import type { Database } from '../../database/types/database.ts';

createServer<Database>(async ({ supabaseClient }) => {
  // Full TypeScript autocomplete for your tables!
  const { data } = await supabaseClient
    .from('jobs') // Autocompleted from your database
    .select('*');

  return createSuccessResponse(data);
});
```

### Custom Timeout

```typescript
// For long-running operations (e.g., AI generation, video processing)
createServer(callback, {
  timeoutMs: 120000, // 2 minutes
});
```

### Additional Environment Variables

```typescript
createServer(callback, {
  requiredEnvVars: [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY', // Custom API key
    'STRIPE_SECRET_KEY', // Payment provider
  ],
});
```

## 🛡️ Automatic Error Handling

The framework automatically handles common errors:

| Error Type         | Status Code | Description                                           |
| ------------------ | ----------- | ----------------------------------------------------- |
| JSON Parsing       | 400         | Invalid JSON in request body                          |
| Zod Validation     | 400         | Schema validation failed (with detailed field errors) |
| Authentication     | 401         | Missing or invalid auth token                         |
| Method Not Allowed | 405         | HTTP method not in `allowedMethods`                   |
| Timeout            | 408         | Request exceeded `timeoutMs`                          |
| Internal Error     | 500         | Unhandled exceptions                                  |

**Example Zod error response:**

```json
{
  "error": {
    "message": "Invalid data provided.",
    "code": "VALIDATION_ERROR",
    "details": {
      "title": ["Required"],
      "email": ["Invalid email address"]
    }
  }
}
```

## 💡 Best Practices

1. **Always validate user input** - Use Zod schemas for type safety
2. **Use appropriate timeouts** - Adjust based on function complexity
3. **Leverage RLS** - Use `supabaseClient` by default, `supabaseAdminClient` only when necessary
4. **Use convenient response functions** - Prefer `createBadRequestResponse()` over `createErrorResponse(error, HTTP_STATUS_BAD_REQUEST)`
5. **Log strategically** - Log errors for debugging, but avoid exposing sensitive data
6. **Handle edge cases** - Test with missing data, malformed input, and unauthorized access
7. **Keep functions focused** - One function per logical operation
8. **Use TypeScript** - Generate database types for full type safety

## 📊 HTTP Status Codes

// Status codes
import {
HTTP_STATUS_BAD_REQUEST, // 400
HTTP_STATUS_CREATED, // 201
HTTP_STATUS_FORBIDDEN, // 403
HTTP_STATUS_INTERNAL_SERVER_ERROR, // 500
HTTP_STATUS_METHOD_NOT_ALLOWED, // 405
HTTP_STATUS_NOT_FOUND, // 404
HTTP_STATUS_OK, // 200
HTTP_STATUS_REQUEST_TIMEOUT, // 408
HTTP_STATUS_UNAUTHORIZED, // 401
} from 'supabase-edge-kit';

// Convenient response functions
import { createBadRequestResponse, createNotFoundResponse } from 'supabase-edge-kit';

return createBadRequestResponse('Invalid input'); // Instead of createErrorResponse('Invalid input', HTTP_STATUS_BAD_REQUEST)

```

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit PRs.

## 📄 License

MIT

---

**Built with ❤️ for the Supabase community**
```
