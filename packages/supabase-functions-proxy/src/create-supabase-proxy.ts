import { defaultRequestHeadersToRemove } from './request-headers-to-remove';

const EDGE_FUNCTION_TIMEOUT_MS = 595_000;
const HTTP_STATUS_BAD_GATEWAY = 502;
const HTTP_STATUS_GATEWAY_TIMEOUT = 504;
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;

type StreamingRequestInit = RequestInit & { duplex?: 'half' };

export interface CreateSupabaseProxyOptions {
  /** The Supabase Functions origin, for example https://project.functions.supabase.co. */
  supabaseUrl: string;
  /** Headers added to the request sent upstream. */
  requestHeaders?: Record<string, string>;
  /** Headers added to every response returned by the proxy. */
  responseHeaders?: Record<string, string>;
  /** Maximum upstream request duration in milliseconds. Defaults to 595,000 ms. */
  timeout?: number;
  /** Extra headers to remove from both proxied requests and responses. */
  requestHeadersToRemove?: readonly string[];
}

/**
 * Creates a Fetch API handler that forwards `/api/<function>` requests to a
 * Supabase Function while preserving method, body, query string, and safe
 * headers. It can be used directly in Next.js, Cloudflare Workers, and other
 * Fetch-compatible server runtimes.
 */
export function createSupabaseProxy(options: CreateSupabaseProxyOptions) {
  const {
    supabaseUrl,
    requestHeaders: additionalRequestHeaders = {},
    responseHeaders: additionalResponseHeaders = {},
    timeout = EDGE_FUNCTION_TIMEOUT_MS,
    requestHeadersToRemove: additionalRequestHeadersToRemove = [],
  } = options;
  const requestHeadersToRemove = [
    ...defaultRequestHeadersToRemove,
    ...additionalRequestHeadersToRemove,
  ];

  return async function handler(request: Request): Promise<Response> {
    if (!supabaseUrl) {
      console.error('[Supabase proxy] SUPABASE_URL is not set.');
      return createErrorResponse(
        request,
        HTTP_STATUS_INTERNAL_SERVER_ERROR,
        'Proxy configuration error',
        additionalResponseHeaders,
      );
    }

    const targetUrl = createTargetUrl(supabaseUrl, request.url);
    const headers = new Headers(request.headers);
    removeUnsafeHeaders(headers, requestHeadersToRemove);

    for (const [key, value] of Object.entries(additionalRequestHeaders)) {
      headers.set(key, value);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: StreamingRequestInit = {
        method: request.method,
        headers,
        signal: controller.signal,
      };

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        fetchOptions.body = request.body;
        fetchOptions.duplex = 'half';
      }

      const upstreamResponse = await fetch(targetUrl, fetchOptions);
      const responseHeaders = new Headers(upstreamResponse.headers);
      removeUnsafeHeaders(responseHeaders, requestHeadersToRemove);
      addCorsHeader(responseHeaders, request);

      for (const [key, value] of Object.entries(additionalResponseHeaders)) {
        responseHeaders.set(key, value);
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      if (isAbortError(error)) {
        console.error(`[Supabase proxy] Request to ${targetUrl} timed out.`);
        return createErrorResponse(
          request,
          HTTP_STATUS_GATEWAY_TIMEOUT,
          'Request timeout',
          additionalResponseHeaders,
        );
      }

      console.error(`[Supabase proxy] Failed to fetch ${targetUrl}:`, error);
      return createErrorResponse(
        request,
        HTTP_STATUS_BAD_GATEWAY,
        'Proxy fetch failed',
        additionalResponseHeaders,
        'The proxy server could not connect to the upstream service.',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

function createTargetUrl(supabaseUrl: string, requestUrl: string): string {
  const incomingUrl = new URL(requestUrl);
  const targetUrl = new URL(supabaseUrl);

  targetUrl.pathname = incomingUrl.pathname.replace(/^\/api(?=\/|$)/u, '') || '/';
  targetUrl.search = incomingUrl.search;

  return targetUrl.toString();
}

function removeUnsafeHeaders(headers: Headers, headersToRemove: readonly string[]): void {
  const connectionHeaders = headers
    .get('connection')
    ?.split(',')
    .map((header) => header.trim())
    .filter(Boolean);

  for (const header of [...headersToRemove, ...(connectionHeaders ?? [])]) {
    headers.delete(header);
  }
}

function addCorsHeader(headers: Headers, request: Request): void {
  if (!headers.has('access-control-allow-origin')) {
    headers.set('access-control-allow-origin', request.headers.get('origin') ?? '*');
  }
}

function createErrorResponse(
  request: Request,
  status: number,
  error: string,
  additionalResponseHeaders: Record<string, string>,
  message?: string,
): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  addCorsHeader(headers, request);

  for (const [key, value] of Object.entries(additionalResponseHeaders)) {
    headers.set(key, value);
  }

  return new Response(
    JSON.stringify({ error, ...(message !== undefined ? { message } : {}) }),
    {
      status,
      headers,
    },
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
