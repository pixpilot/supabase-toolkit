# @pixpilot/supabase-functions-proxy

A Fetch API handler for forwarding server-side `/api/*` routes to Supabase Edge Functions. It safely streams request and response bodies, removes proxy-sensitive headers, preserves query parameters, and provides timeout and CORS handling.

## Installation

```sh
pnpm add @pixpilot/supabase-functions-proxy
```

## Next.js usage

Create a route handler such as `app/api/[...path]/route.ts`:

```typescript
import { createSupabaseProxy } from '@pixpilot/supabase-functions-proxy';

const handler = createSupabaseProxy({
  supabaseUrl: process.env.SUPABASE_FUNCTIONS_URL!,
  timeout: 595_000,
  requestHeaders: { 'x-proxy-source': 'web-app' },
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
```

`SUPABASE_FUNCTIONS_URL` should be a Supabase Functions origin, for example `https://project-ref.functions.supabase.co`. A request to `/api/process-job?source=extension` is forwarded to `https://project-ref.functions.supabase.co/process-job?source=extension`.

## Options

| Option                   | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `supabaseUrl`            | Required Supabase Functions origin.                         |
| `timeout`                | Request timeout in milliseconds. Defaults to `595000`.      |
| `requestHeaders`         | Headers to add to the upstream request.                     |
| `responseHeaders`        | Headers to add to every proxied response, including errors. |
| `requestHeadersToRemove` | Extra headers to strip from proxied requests and responses. |

## Behaviour

- Strips `/api` from the incoming path and preserves query parameters.
- Streams non-GET/HEAD request bodies and upstream response bodies.
- Removes hop-by-hop, runtime-managed, Cloudflare, forwarding, client-hint, and cookie headers.
- Adds `Access-Control-Allow-Origin` from the request origin when the upstream has not supplied one.
- Returns JSON errors with status `500` (configuration), `502` (upstream failure), or `504` (timeout).

## License

MIT
