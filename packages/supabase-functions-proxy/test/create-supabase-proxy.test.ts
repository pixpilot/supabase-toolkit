import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSupabaseProxy, defaultRequestHeadersToRemove } from '../src';

describe('createSupabaseProxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('forwards the request path, query, body, and safe headers upstream', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('upstream response', {
        status: 201,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const handler = createSupabaseProxy({
      supabaseUrl: 'https://project.functions.supabase.co',
      requestHeaders: { 'x-proxy-token': 'server-token' },
    });
    const request = new Request(
      'https://app.example.com/api/process-job?source=extension',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          connection: 'keep-alive, x-connection-only',
          'x-connection-only': 'remove me',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ url: 'https://example.com/job' }),
      },
    );

    const response = await handler(request);

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('upstream response');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.functions.supabase.co/process-job?source=extension',
      expect.objectContaining({ method: 'POST', duplex: 'half' }),
    );

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer user-token');
    expect(headers.get('x-proxy-token')).toBe('server-token');
    expect(headers.get('connection')).toBeNull();
    expect(headers.get('x-connection-only')).toBeNull();
    expect(headers.get('x-forwarded-for')).toBeNull();
    expect(await new Response(init?.body).text()).toBe(
      JSON.stringify({ url: 'https://example.com/job' }),
    );
  });

  it('does not send a body for GET requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    const handler = createSupabaseProxy({
      supabaseUrl: 'https://project.functions.supabase.co',
    });

    await handler(new Request('https://app.example.com/api/health?full=true'));

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.body).toBeUndefined();
    expect(init).not.toHaveProperty('duplex');
  });

  it('removes unsafe upstream headers and applies CORS and custom headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('ok', {
        headers: {
          'content-encoding': 'gzip',
          'set-cookie': 'session=upstream',
          'x-forwarded-for': '203.0.113.10',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const handler = createSupabaseProxy({
      supabaseUrl: 'https://project.functions.supabase.co',
      responseHeaders: { 'x-proxy-version': '1' },
      requestHeadersToRemove: ['x-remove-me'],
    });

    const response = await handler(
      new Request('https://app.example.com/api/health', {
        headers: { origin: 'https://extension.example.com' },
      }),
    );

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-forwarded-for')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://extension.example.com',
    );
    expect(response.headers.get('x-proxy-version')).toBe('1');
  });

  it('returns a configuration error without calling fetch when no URL is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createSupabaseProxy({ supabaseUrl: '' });

    const response = await handler(new Request('https://app.example.com/api/health'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Proxy configuration error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a 502 response when the upstream request fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Network failure'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createSupabaseProxy({
      supabaseUrl: 'https://project.functions.supabase.co',
    });

    const response = await handler(new Request('https://app.example.com/api/health'));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Proxy fetch failed',
      message: 'The proxy server could not connect to the upstream service.',
    });
  });

  it('returns a 504 response when the upstream request times out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createSupabaseProxy({
      supabaseUrl: 'https://project.functions.supabase.co',
      timeout: 10,
    });

    const pendingResponse = handler(new Request('https://app.example.com/api/health'));
    await vi.advanceTimersByTimeAsync(10);
    const response = await pendingResponse;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'Request timeout' });
  });
});

describe('defaultRequestHeadersToRemove', () => {
  it('includes runtime-managed and proxy-sensitive headers', () => {
    expect(defaultRequestHeadersToRemove).toEqual(
      expect.arrayContaining([
        'connection',
        'content-length',
        'set-cookie',
        'x-forwarded-for',
      ]),
    );
  });
});
