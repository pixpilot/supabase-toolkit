import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { MockedFunction } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createServer } from '../src/create-server';
import { createErrorResponse } from '../src/responses';
import {
  createSupabaseAdminClient,
  createSupabaseClient,
  getUser,
  handleCors,
  validateEnvironment,
  validateMethod,
} from '../src/utils';

// Mock Deno
vi.mock('deno', () => ({
  env: {
    get: vi.fn(),
  },
  serve: vi.fn(),
}));

// Mock utils
vi.mock('../src/utils', () => ({
  createSupabaseClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  getUser: vi.fn(),
  handleCors: vi.fn(),
  validateEnvironment: vi.fn(),
  validateMethod: vi.fn(),
}));

// Mock responses
vi.mock('../src/responses', () => ({
  createErrorResponse: vi.fn(),
}));

// Mock Supabase client
const mockSupabaseClient = {
  auth: {
    getUser: vi.fn(),
  },
} as unknown as SupabaseClient<unknown, never, never, never, never>;

const mockSupabaseAdminClient = {} as SupabaseClient<unknown, never, never, never, never>;

const mockUser: User = {
  id: 'test-user-id',
  email: 'test@example.com',
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
};

describe('createServer', () => {
  let mockRequest: Request;
  let mockResponse: Response;
  let mockCallback: MockedFunction<any>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = new Request('http://localhost/test', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });

    mockResponse = new Response('test response');

    mockCallback = vi.fn().mockResolvedValue(mockResponse);

    // Default mocks
    (globalThis as any).Deno = {
      env: {
        get: vi.fn((key: string) => {
          const envVars: Record<string, string> = {
            SUPABASE_URL: 'https://test.supabase.co',
            SUPABASE_ANON_KEY: 'test-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
          };
          return envVars[key];
        }),
      },
      serve: vi.fn((handler) => {
        // Store handler for testing
        (globalThis as any).__testHandler = handler;
      }),
    };

    // Use type casting instead of vi.mocked for inline mocks
    (createSupabaseClient as any).mockReturnValue(mockSupabaseClient);
    (createSupabaseAdminClient as any).mockReturnValue(mockSupabaseAdminClient);
    (getUser as any).mockResolvedValue(mockUser);
    (validateEnvironment as any).mockReturnValue([]);
    (validateMethod as any).mockReturnValue(true);
    (handleCors as any).mockReturnValue(new Response('ok', { status: 200 }));
    (createErrorResponse as any).mockImplementation(
      (error: any, status = 400) => new Response(JSON.stringify({ error }), { status }),
    );
  });

  it('should create a server with default options', async () => {
    createServer(mockCallback);

    expect((globalThis as any).Deno.serve).toHaveBeenCalledTimes(1);
    const handler = (globalThis as any).__testHandler;

    const _response = await handler(mockRequest);
    expect(_response).toBe(mockResponse);
    expect(mockCallback).toHaveBeenCalledWith({
      request: mockRequest,
      user: mockUser,
      supabaseClient: mockSupabaseClient,
      supabaseAdminClient: mockSupabaseAdminClient,
    });
  });

  it('should handle CORS preflight requests', async () => {
    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const corsRequest = new Request('http://localhost/test', { method: 'OPTIONS' });

    const _response = await handler(corsRequest);

    expect(handleCors).toHaveBeenCalled();
    expect(_response.status).toBe(200);
  });

  it('should reject invalid HTTP methods', async () => {
    (validateMethod as any).mockReturnValue(false);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['POST']);
    expect(createErrorResponse).toHaveBeenCalledWith('Method not allowed', 405);
  });

  it('should validate environment variables', async () => {
    (validateEnvironment as any).mockReturnValue(['MISSING_VAR']);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith([
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
    expect(createErrorResponse).toHaveBeenCalledWith(
      'Missing required environment variables: MISSING_VAR',
      500,
    );
  });

  it('should handle authentication when enabled', async () => {
    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(getUser).toHaveBeenCalledWith(mockSupabaseClient);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({ user: mockUser }),
    );
  });

  it('should handle authentication failure', async () => {
    (getUser as any).mockResolvedValue(null);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Unauthorized', 401);
  });

  it('should skip authentication when disabled', async () => {
    createServer(mockCallback, { authenticate: false });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(getUser).not.toHaveBeenCalled();
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({ user: undefined }),
    );
  });

  it('should handle request timeout', async () => {
    // Mock a slow callback that exceeds timeout
    mockCallback.mockImplementation(async () => {
      await new Promise((resolve) => {
        setTimeout(() => resolve(undefined), 100);
      });
      return mockResponse;
    });

    createServer(mockCallback, { timeoutMs: 50 });

    const handler = (globalThis as any).__testHandler;

    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Request timed out', 408);
  });

  it('should handle Zod validation errors in callback', async () => {
    const zodError = new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['field'],
        message: 'Expected string, received number',
      },
    ]);

    mockCallback.mockRejectedValue(zodError);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith(
      {
        message: 'Invalid data provided.',
        code: 'VALIDATION_ERROR',
        details: expect.any(Object),
      },
      400,
    );
  });

  it('should handle JSON parsing errors in callback', async () => {
    const jsonError = new SyntaxError('Unexpected token in JSON');

    mockCallback.mockRejectedValue(jsonError);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Invalid JSON in request body', 400);
  });

  it('should handle general errors', async () => {
    const generalError = new Error('Something went wrong');

    mockCallback.mockRejectedValue(generalError);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Something went wrong', 500);
  });

  it('should handle non-Error exceptions', async () => {
    mockCallback.mockRejectedValue('string error');

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Internal server error', 500);
  });

  it('should support custom allowed methods', async () => {
    createServer(mockCallback, { allowedMethods: ['GET', 'POST', 'PUT'] });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['GET', 'POST', 'PUT']);
  });

  it('should support custom required environment variables', async () => {
    createServer(mockCallback, {
      requiredEnvVars: ['CUSTOM_VAR'],
    });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith(['CUSTOM_VAR']);
  });

  it('should support custom timeout', async () => {
    createServer(mockCallback, { timeoutMs: 30000 });

    // Test that timeout is passed correctly by checking error message
    mockCallback.mockImplementation(async () => {
      await new Promise((resolve) => {
        setTimeout(() => resolve(undefined), 100);
      });
      return mockResponse;
    });

    createServer(mockCallback, { timeoutMs: 50 });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Request timed out', 408);
  });

  it('should disable CORS handling when configured', async () => {
    createServer(mockCallback, { handleCors: false });

    const handler = (globalThis as any).__testHandler;
    const corsRequest = new Request('http://localhost/test', { method: 'OPTIONS' });

    const _response = await handler(corsRequest);

    expect(handleCors).not.toHaveBeenCalled();
    // Should proceed to method validation
    expect(validateMethod).toHaveBeenCalled();
  });

  it('should handle multiple requests concurrently', async () => {
    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;

    const requests = [
      new Request('http://localhost/test1', { method: 'POST' }),
      new Request('http://localhost/test2', { method: 'POST' }),
      new Request('http://localhost/test3', { method: 'POST' }),
    ];

    const _responses = await Promise.all(requests.map((req) => handler(req)));

    expect(_responses).toHaveLength(3);
    _responses.forEach((response) => {
      expect(response).toBe(mockResponse);
    });
    expect(mockCallback).toHaveBeenCalledTimes(3);
  });

  it('should pass correct context to callback', async () => {
    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(mockCallback).toHaveBeenCalledWith({
      request: mockRequest,
      user: mockUser,
      supabaseClient: mockSupabaseClient,
      supabaseAdminClient: mockSupabaseAdminClient,
    });
  });

  it('should handle callback that throws synchronously', async () => {
    mockCallback.mockImplementation(() => {
      throw new Error('Sync error');
    });

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Sync error', 500);
  });

  it('should handle empty requiredEnvVars array', async () => {
    createServer(mockCallback, { requiredEnvVars: [] });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith([]);
  });

  it('should handle empty allowedMethods array', async () => {
    (validateMethod as any).mockReturnValue(false);

    createServer(mockCallback, { allowedMethods: [] });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(validateMethod).toHaveBeenCalledWith(mockRequest, []);
  });

  it('should handle timeout of 0 (immediate timeout)', async () => {
    mockCallback.mockImplementation(async () => {
      await new Promise((resolve) => {
        setTimeout(() => resolve(undefined), 100);
      });
      return mockResponse;
    });

    createServer(mockCallback, { timeoutMs: 0 });

    const handler = (globalThis as any).__testHandler;

    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Request timed out', 408);
  });

  it('should handle getUser throwing an error as server error', async () => {
    (getUser as any).mockRejectedValue(new Error('Auth service error'));

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Auth service error', 500);
  });

  it('should handle callback returning non-Response value', async () => {
    mockCallback.mockResolvedValue('not a response' as any);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const response = await handler(mockRequest);

    expect(response).toBe('not a response');
  });

  it('should handle multiple environment variables missing', async () => {
    (validateEnvironment as any).mockReturnValue(['VAR1', 'VAR2', 'VAR3']);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith(
      'Missing required environment variables: VAR1, VAR2, VAR3',
      500,
    );
  });

  it('should handle all default options', async () => {
    createServer(mockCallback, {});

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith([
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['POST']);
    expect(getUser).toHaveBeenCalled();
  });

  it('should handle server creation with minimal config', async () => {
    createServer(mockCallback, {
      authenticate: false,
      handleCors: false,
      allowedMethods: ['GET'],
      requiredEnvVars: [],
      timeoutMs: 1000,
    });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(getUser).not.toHaveBeenCalled();
    expect(validateEnvironment).toHaveBeenCalledWith([]);
    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['GET']);
  });

  it('should handle race condition between timeout and successful response', async () => {
    mockCallback.mockResolvedValue(mockResponse);

    createServer(mockCallback, { timeoutMs: 1000 });

    const handler = (globalThis as any).__testHandler;
    const response = await handler(mockRequest);

    expect(response).toBe(mockResponse);
    expect(createErrorResponse).not.toHaveBeenCalledWith('Request timed out', 408);
  });

  it('should handle callback that resolves immediately', async () => {
    mockCallback.mockResolvedValue(mockResponse);

    createServer(mockCallback);

    const handler = (globalThis as any).__testHandler;
    const response = await handler(mockRequest);

    expect(response).toBe(mockResponse);
  });

  it('should handle different request methods with custom allowed methods', async () => {
    const getRequest = new Request('http://localhost/test', { method: 'GET' });
    const putRequest = new Request('http://localhost/test', { method: 'PUT' });
    const deleteRequest = new Request('http://localhost/test', { method: 'DELETE' });

    createServer(mockCallback, { allowedMethods: ['GET', 'PUT', 'DELETE'] });

    const handler = (globalThis as any).__testHandler;

    await handler(getRequest);
    await handler(putRequest);
    await handler(deleteRequest);

    expect(validateMethod).toHaveBeenCalledWith(getRequest, ['GET', 'PUT', 'DELETE']);
    expect(validateMethod).toHaveBeenCalledWith(putRequest, ['GET', 'PUT', 'DELETE']);
    expect(validateMethod).toHaveBeenCalledWith(deleteRequest, ['GET', 'PUT', 'DELETE']);
  });

  it('should handle PATCH method', async () => {
    const patchRequest = new Request('http://localhost/test', { method: 'PATCH' });

    createServer(mockCallback, { allowedMethods: ['PATCH'] });

    const handler = (globalThis as any).__testHandler;
    await handler(patchRequest);

    expect(validateMethod).toHaveBeenCalledWith(patchRequest, ['PATCH']);
  });

  it('should handle HEAD method', async () => {
    const headRequest = new Request('http://localhost/test', { method: 'HEAD' });

    createServer(mockCallback, { allowedMethods: ['HEAD'] });

    const handler = (globalThis as any).__testHandler;
    await handler(headRequest);

    expect(validateMethod).toHaveBeenCalledWith(headRequest, ['HEAD']);
  });
});
