import type { SupabaseClient } from '@supabase/supabase-js';
import type { FunctionsResponse } from '../src/index';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EdgeFunctionError,
  EdgeFunctionNoDataError,
  FunctionsClient,
} from '../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock SupabaseClient whose `functions.invoke` can be
 *  controlled per-test via the returned spy.
 */
function createMockSupabase() {
  const invokeSpy = vi.fn();
  const supabase = {
    functions: { invoke: invokeSpy },
  } as unknown as SupabaseClient;
  return { supabase, invokeSpy };
}

/** Build a mock `Response`-like object whose `json()` resolves to `body`. */
function mockResponse(body: unknown): Response {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

/** Build a mock `Response`-like object whose `json()` rejects. */
function mockBrokenResponse(): Response {
  return {
    json: vi.fn().mockRejectedValue(new Error('invalid json')),
  } as unknown as Response;
}

/**
 * Create a real `FunctionsHttpError` instance wrapping the supplied
 * response-like object so that `instanceof FunctionsHttpError` checks pass.
 */
function makeFunctionsHttpError(
  response: Response,
  msg = 'Edge Function returned a non-2xx status code',
): FunctionsHttpError {
  const err = new FunctionsHttpError(response);
  // Override message so tests that rely on the default message are explicit
  Object.defineProperty(err, 'message', { value: msg, writable: true });
  return err;
}

// ---------------------------------------------------------------------------
// EdgeFunctionError
// ---------------------------------------------------------------------------

describe('edgeFunctionError', () => {
  it('sets all properties correctly', () => {
    const err = new EdgeFunctionError('Something broke', 'my-fn', 'ERR_CODE', {
      extra: 1,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EdgeFunctionError);
    expect(err.message).toBe('Something broke');
    expect(err.name).toBe('EdgeFunctionError');
    expect(err.functionName).toBe('my-fn');
    expect(err.code).toBe('ERR_CODE');
    expect(err.details).toEqual({ extra: 1 });
  });

  it('allows optional code and details to be undefined', () => {
    const err = new EdgeFunctionError('msg', 'fn');

    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EdgeFunctionNoDataError
// ---------------------------------------------------------------------------

describe('edgeFunctionNoDataError', () => {
  it('is an instance of EdgeFunctionError', () => {
    const err = new EdgeFunctionNoDataError('my-fn');

    expect(err).toBeInstanceOf(EdgeFunctionError);
    expect(err).toBeInstanceOf(EdgeFunctionNoDataError);
  });

  it('sets the correct message and name', () => {
    const err = new EdgeFunctionNoDataError('my-fn');

    expect(err.message).toBe('No data received from Edge Function.');
    expect(err.name).toBe('EdgeFunctionNoDataError');
    expect(err.functionName).toBe('my-fn');
  });
});

// ---------------------------------------------------------------------------
// FunctionsClient – constructor
// ---------------------------------------------------------------------------

describe('functionsClient constructor', () => {
  it('creates an instance without throwing', () => {
    const { supabase } = createMockSupabase();
    expect(() => new FunctionsClient(supabase)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FunctionsClient – invoke
// ---------------------------------------------------------------------------

describe('functionsClient.invoke', () => {
  let client: FunctionsClient;
  let invokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockSupabase();
    client = new FunctionsClient(mock.supabase);
    invokeSpy = mock.invokeSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── success paths ────────────────────────────────────────────────────────

  it('returns data directly when result.data is a plain value', async () => {
    invokeSpy.mockResolvedValue({ data: { id: 1 }, error: null });

    const result = await client.invoke<void, { id: number }>('my-fn');

    expect(result).toEqual({ id: 1 });
  });

  it('unwraps nested ApiResponse (data + message) structure', async () => {
    const inner = { id: 42 };
    invokeSpy.mockResolvedValue({
      data: { data: inner, message: 'ok' },
      error: null,
    });

    const result = await client.invoke<void, { id: number }>('my-fn');

    expect(result).toEqual(inner);
  });

  it('returns data that has a "data" key but no "message" key as-is', async () => {
    const payload = { data: { nested: true } }; // has "data" but NOT "message"
    invokeSpy.mockResolvedValue({ data: payload, error: null });

    const result = await client.invoke('my-fn');

    expect(result).toEqual(payload);
  });

  it('passes options down to supabase.functions.invoke', async () => {
    invokeSpy.mockResolvedValue({ data: 'ok', error: null });
    const opts = { body: { foo: 'bar' } };

    await client.invoke('my-fn', opts as any);

    expect(invokeSpy).toHaveBeenCalledWith('my-fn', opts);
  });

  // ── no-data path ─────────────────────────────────────────────────────────

  it('throws EdgeFunctionNoDataError when result.data is null', async () => {
    invokeSpy.mockResolvedValue({ data: null, error: null });

    await expect(client.invoke('my-fn')).rejects.toBeInstanceOf(EdgeFunctionNoDataError);
  });

  it('throws EdgeFunctionNoDataError when result.data is undefined', async () => {
    invokeSpy.mockResolvedValue({ data: undefined, error: null });

    await expect(client.invoke('my-fn')).rejects.toBeInstanceOf(EdgeFunctionNoDataError);
  });

  // ── FunctionsHttpError paths ─────────────────────────────────────────────

  it('uses "error" field from JSON body for EdgeFunctionError message', async () => {
    const response = mockResponse({
      error: 'Custom error msg',
      code: 'E001',
      details: { x: 1 },
    });
    const httpError = makeFunctionsHttpError(response);
    invokeSpy.mockResolvedValue({ data: null, error: httpError });

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toBe('Custom error msg');
    expect(thrown.code).toBe('E001');
    expect(thrown.details).toEqual({ x: 1 });
    expect(thrown.functionName).toBe('my-fn');
  });

  it('falls back to "message" field when "error" is absent', async () => {
    const response = mockResponse({ message: 'Fallback message' });
    const httpError = makeFunctionsHttpError(response);
    invokeSpy.mockResolvedValue({ data: null, error: httpError });

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toBe('Fallback message');
  });

  it('uses FunctionsHttpError.message when both "error" and "message" are absent', async () => {
    const response = mockResponse({});
    const httpError = makeFunctionsHttpError(response, 'http error message');
    invokeSpy.mockResolvedValue({ data: null, error: httpError });

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toBe('http error message');
  });

  it('falls back to FunctionsHttpError.message when json() rejects', async () => {
    const response = mockBrokenResponse();
    const httpError = makeFunctionsHttpError(response, 'original http msg');
    invokeSpy.mockResolvedValue({ data: null, error: httpError });

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toBe('original http msg');
    expect(thrown.functionName).toBe('my-fn');
  });

  // ── non-FunctionsHttpError error paths ───────────────────────────────────

  it('throws EdgeFunctionError for other error objects that have a message', async () => {
    const genericError = new Error('network failure');
    invokeSpy.mockResolvedValue({ data: null, error: genericError });

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toBe('network failure');
  });

  it('throws EdgeFunctionError with fallback message for errors without message', async () => {
    const weirdError = { code: 'NO_MESSAGE' }; // no "message" property
    invokeSpy.mockResolvedValue({ data: null, error: weirdError });

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toBe('An unknown error occurred.');
  });

  // ── unexpected-throw paths ───────────────────────────────────────────────

  it('re-throws EdgeFunctionError caught in the outer catch', async () => {
    const original = new EdgeFunctionError('already wrapped', 'my-fn');
    invokeSpy.mockRejectedValue(original);

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBe(original);
  });

  it('wraps unexpected Error in EdgeFunctionError', async () => {
    invokeSpy.mockRejectedValue(new Error('unexpected boom'));

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toBe('unexpected boom');
  });

  it('wraps unexpected non-Error in EdgeFunctionError with a generic message', async () => {
    invokeSpy.mockRejectedValue('string error');

    const thrown = await client.invoke('my-fn').catch((e) => e);

    expect(thrown).toBeInstanceOf(EdgeFunctionError);
    expect(thrown.message).toContain(`invoking 'my-fn'`);
  });
});

// ---------------------------------------------------------------------------
// FunctionsClient – handleInvoke
// ---------------------------------------------------------------------------

describe('functionsClient.handleInvoke', () => {
  let client: FunctionsClient;
  let invokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockSupabase();
    client = new FunctionsClient(mock.supabase);
    invokeSpy = mock.invokeSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onSuccess with the resolved data', async () => {
    invokeSpy.mockResolvedValue({ data: { id: 1 }, error: null });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await client.handleInvoke(async () => client.invoke('my-fn'), onSuccess, onError);

    expect(onSuccess).toHaveBeenCalledWith({ id: 1 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when invoke throws EdgeFunctionError', async () => {
    invokeSpy.mockResolvedValue({ data: null, error: null }); // triggers NoDataError
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await client.handleInvoke(async () => client.invoke('my-fn'), onSuccess, onError);

    expect(onError).toHaveBeenCalledWith(expect.any(EdgeFunctionNoDataError));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('logs the context string when provided', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    invokeSpy.mockResolvedValue({ data: null, error: null });

    await client.handleInvoke(
      async () => client.invoke('my-fn'),
      vi.fn(),
      vi.fn(),
      'MyContext',
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('(MyContext)'),
      expect.any(String),
    );
  });

  it('logs the error code when the EdgeFunctionError has one', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const httpError = new EdgeFunctionError('err', 'my-fn', 'CODE_123');
    invokeSpy.mockRejectedValue(httpError);

    await client.handleInvoke(async () => client.invoke('my-fn'), vi.fn(), vi.fn());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error code'),
      'CODE_123',
    );
  });

  it('calls onError when invoke wraps a TypeError in EdgeFunctionError', async () => {
    const unexpected = new TypeError('Totally unexpected');
    invokeSpy.mockRejectedValue(unexpected);
    const onError = vi.fn();

    /*
     * invoke() catches the TypeError and wraps it into an EdgeFunctionError;
     * handleInvoke then handles it via onError rather than re-throwing.
     */
    await client.handleInvoke(async () => client.invoke('my-fn'), vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith(expect.any(EdgeFunctionError));
  });

  it('re-throws truly non-EdgeFunctionError from the invokeCall itself', async () => {
    const unexpected = new TypeError('Totally unexpected');

    await expect(
      client.handleInvoke(
        async () => {
          throw unexpected;
        },
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toBe(unexpected);
  });
});

// ---------------------------------------------------------------------------
// FunctionsClient – handleResponse (deprecated)
// ---------------------------------------------------------------------------

describe('functionsClient.handleResponse', () => {
  let client: FunctionsClient;

  beforeEach(() => {
    const { supabase } = createMockSupabase();
    client = new FunctionsClient(supabase);
  });

  it('calls onSuccess when result has data and no error', async () => {
    const result: FunctionsResponse<{ id: number }> = { data: { id: 5 }, error: null };
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await client.handleResponse(result, onSuccess, onError);

    expect(onSuccess).toHaveBeenCalledWith({ id: 5 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when result has an error string', async () => {
    const result: FunctionsResponse<{ id: number }> = {
      data: null,
      error: 'Something went wrong',
      code: 'ERR_CODE',
      details: { hint: 'check logs' },
    };
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await client.handleResponse(result, onSuccess, onError);

    expect(onError).toHaveBeenCalledWith('Something went wrong', 'ERR_CODE', {
      hint: 'check logs',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('logs error code when it is non-empty', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result: FunctionsResponse<unknown> = {
      data: null,
      error: 'err',
      code: 'CODE_XYZ',
    };

    await client.handleResponse(result, vi.fn(), vi.fn());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error code'),
      'CODE_XYZ',
    );
  });

  it('calls onError with fallback when both data and error are null', async () => {
    const result: FunctionsResponse<unknown> = { data: null, error: null };
    const onError = vi.fn();

    await client.handleResponse(result, vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith(
      'Unexpected response: no data or error received.',
    );
  });

  it('passes context to logging when provided', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result: FunctionsResponse<unknown> = { data: null, error: 'oops' };

    await client.handleResponse(result, vi.fn(), vi.fn(), 'TestCtx');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('(TestCtx)'), 'oops');
  });

  it('handles async onSuccess callback', async () => {
    const result: FunctionsResponse<string> = { data: 'hello', error: null };
    const onSuccess = vi.fn().mockResolvedValue(undefined);

    await client.handleResponse(result, onSuccess, vi.fn());

    expect(onSuccess).toHaveBeenCalledWith('hello');
  });
});
