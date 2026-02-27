# @pixpilot/supabase-functions-client

A lightweight, type-safe wrapper around the Supabase Edge Functions client with structured error handling, automatic error message extraction, and chainable response helpers.

---

## Installation

```sh
pnpm add @pixpilot/supabase-functions-client @supabase/supabase-js
```

---

## Quick Start

```typescript
import { FunctionsClient } from '@pixpilot/supabase-functions-client';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://your-project.supabase.co', 'your-anon-key');

// Wrap the Supabase client once
const functionsClient = new FunctionsClient(supabase);
```

---

## API

### `FunctionsClient`

```typescript
class FunctionsClient {
  constructor(supabaseClient: SupabaseClient);

  invoke<RequestBody = void, ResponseData = any>(
    functionName: string,
    options?: FunctionInvokeOptions<RequestBody>,
  ): Promise<ResponseData>;

  handleInvoke<T>(
    invokeCall: () => Promise<T>,
    onSuccess: (data: T) => Promise<void> | void,
    onError: (error: EdgeFunctionError) => Promise<void> | void,
    context?: string,
  ): Promise<void>;

  /** @deprecated Use handleInvoke instead. */
  handleResponse<T>(
    result: FunctionsResponse<T>,
    onSuccess: (data: T) => Promise<void> | void,
    onError: (error: string, code?: string, details?: unknown) => Promise<void> | void,
    context?: string,
  ): Promise<void>;
}
```

---

## Usage Patterns

### 1. `invoke` – Direct Try/Catch (Recommended)

`invoke` either returns data on success or **throws** an `EdgeFunctionError`
(or `EdgeFunctionNoDataError`) on failure.

```typescript
import {
  EdgeFunctionError,
  EdgeFunctionNoDataError,
  FunctionsClient,
} from '@pixpilot/supabase-functions-client';

interface ProcessJobRequest {
  jobContent: string;
  jobUrl: string;
}

interface ProcessJobResponse {
  jobId: string;
  status: string;
}

try {
  /*
   * RequestBody type is inferred, ResponseData is explicit.
   * Because ProcessJobRequest has required properties, `body` is required
   * in the second argument – TypeScript will enforce this.
   */
  const job = await functionsClient.invoke<ProcessJobRequest, ProcessJobResponse>(
    'process-job',
    { body: { jobContent: htmlContent, jobUrl: url } },
  );

  console.log('Job created:', job.jobId);
} catch (error) {
  if (error instanceof EdgeFunctionNoDataError) {
    console.error('Function returned no data for:', error.functionName);
  } else if (error instanceof EdgeFunctionError) {
    console.error('Function failed:', error.message);
    if (error.code) console.error('Error code:', error.code);
    if (error.details) console.error('Details:', error.details);
  } else {
    throw error; // Re-throw unexpected errors
  }
}
```

#### Void body (no request body)

When `RequestBody` is `void` or omitted, the options argument is optional and
`body` is not allowed:

```typescript
interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
}

// No second argument needed
const health = await functionsClient.invoke<void, HealthCheckResponse>('health-check');
console.log('Status:', health.status);
```

#### All-optional body

When every property of `RequestBody` is optional, the options argument is also
optional:

```typescript
interface SearchRequest {
  query?: string;
  limit?: number;
}

interface SearchResponse {
  results: string[];
}

// Can omit options entirely
const results = await functionsClient.invoke<SearchRequest, SearchResponse>('search');

// Or pass a partial body
const filtered = await functionsClient.invoke<SearchRequest, SearchResponse>('search', {
  body: { query: 'typescript', limit: 10 },
});
```

---

### 2. `handleInvoke` – Callback Pattern

Use `handleInvoke` when you want clean success/error callbacks without a
try/catch block. Uncaught non-`EdgeFunctionError` exceptions are re-thrown.

```typescript
await functionsClient.handleInvoke(
  // The function call
  () =>
    functionsClient.invoke<ProcessJobRequest, ProcessJobResponse>('process-job', {
      body: { jobContent: htmlContent, jobUrl: url },
    }),

  // Success handler
  (job) => {
    console.log('Job created:', job.jobId);
    showSuccessNotification(job);
  },

  // Error handler – receives an EdgeFunctionError
  (error) => {
    console.error('Function failed:', error.message);
    if (error.code === 'QUOTA_EXCEEDED') {
      showQuotaWarning();
    } else {
      showErrorNotification(error.message);
    }
  },

  // Optional context label – included in log output
  'Process Job',
);
```

---

### 3. `handleResponse` – Legacy Callback Pattern _(deprecated)_

This method takes a `FunctionsResponse` object (the old `{data, error}` shape)
and dispatches to one of two callbacks. Prefer `handleInvoke` for new code.

```typescript
const result: FunctionsResponse<ProcessJobResponse> = {
  data: { jobId: '123', status: 'pending' },
  error: null,
};

await functionsClient.handleResponse(
  result,
  // onSuccess
  (job) => {
    console.log('Job created:', job.jobId);
  },
  // onError
  (errorMessage, errorCode, details) => {
    console.error('Function failed:', errorMessage);
    if (errorCode) console.error('Error code:', errorCode);
  },
);
```

---

## Error Classes

### `EdgeFunctionError`

The base error class for all Edge Function failures.

```typescript
class EdgeFunctionError extends Error {
  /** Name of the Edge Function that failed */
  readonly functionName: string;

  /** Optional machine-readable error code from the function response */
  readonly code?: string;

  /** Additional structured details from the function response */
  readonly details?: unknown;
}
```

### `EdgeFunctionNoDataError`

Extends `EdgeFunctionError`. Thrown when the function call succeeds (HTTP 2xx)
but returns no data.

```typescript
class EdgeFunctionNoDataError extends EdgeFunctionError {
  // message: 'No data received from Edge Function.'
}
```

### `instanceof` Checks

```typescript
import {
  EdgeFunctionError,
  EdgeFunctionNoDataError,
} from '@pixpilot/supabase-functions-client';

try {
  const data = await functionsClient.invoke('my-function');
} catch (error) {
  if (error instanceof EdgeFunctionNoDataError) {
    // Successful HTTP call but empty body
    console.log('No data from:', error.functionName);
  } else if (error instanceof EdgeFunctionError) {
    // HTTP error OR network error
    console.log(`${error.functionName} failed: ${error.message}`);
    if (error.code) console.log('Code:', error.code);
  }
}
```

---

## Automatic Error Message Extraction

When an Edge Function returns a non-2xx response, the client automatically
parses the JSON body and extracts the human-readable message. The resolution
order is:

1. `body.error` field
2. `body.message` field
3. HTTP error message (fallback)

Edge Functions should return a structured error body:

```typescript
// From your Edge Function (Deno / Node):
return new Response(
  JSON.stringify({
    error: 'User not found', // → EdgeFunctionError.message
    code: 'USER_NOT_FOUND', // → EdgeFunctionError.code
    details: { userId: 123 }, // → EdgeFunctionError.details
  }),
  { status: 404, headers: { 'Content-Type': 'application/json' } },
);
```

---

## Nested `ApiResponse` Unwrapping

If your Edge Function wraps data in a `{ data, message }` envelope, the client
automatically unwraps it:

```typescript
// Edge Function returns:
// { data: { jobId: '123' }, message: 'Success' }

// invoke() returns the inner data directly:
const job = await functionsClient.invoke<void, ProcessJobResponse>('process-job');
// job === { jobId: '123' }
```

---

## Exported Types

| Type                                 | Description                                                            |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `EdgeFunctionErrorResponse`          | Shape of the error JSON returned by Edge Functions                     |
| `FunctionsResponse<T>`               | Legacy `{ data, error, code, details }` response envelope              |
| `FunctionInvokeOptions<RequestBody>` | Options passed to `invoke()`, body requirement adapts to `RequestBody` |
| `InvokeOptions<RequestBody>`         | Determines whether options are required or optional                    |
| `RequiredKeys<T>`                    | Utility: extracts required keys from a type                            |
| `HasRequiredProperties<T>`           | Utility: `true` if `T` has at least one required key                   |

---

## Migration from Direct `supabase.functions.invoke`

**Before:**

```typescript
const result = await supabase.functions.invoke<ProcessJobResponse>('process-job', {
  body: { jobContent, jobUrl },
});

if (result.error) {
  if (result.error instanceof FunctionsHttpError) {
    // Manual JSON parsing, error code extraction...
  }
  return null;
}

return result.data ?? undefined;
```

**After:**

```typescript
try {
  return await functionsClient.invoke<ProcessJobRequest, ProcessJobResponse>(
    'process-job',
    { body: { jobContent, jobUrl } },
  );
} catch (error) {
  if (error instanceof EdgeFunctionError) {
    console.error('Failed:', error.message, error.code);
  }
  return null;
}
```

---

## License

MIT
