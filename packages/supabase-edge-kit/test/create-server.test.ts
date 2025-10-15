import type { SupabaseClient, SupabaseClientOptions, User } from '@supabase/supabase-js';
import type { MockedFunction } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultResponseHeaders } from '../src/constants';
import { createServer } from '../src/create-server';
import { createErrorResponse, createSuccessResponse } from '../src/responses';
import { autoHandlePreflight, validateEnvironment, validateMethod } from '../src/utils';

// Mock Deno
vi.mock('deno', () => ({
  env: {
    get: vi.fn(),
  },
  serve: vi.fn(),
}));

// Mock utils
vi.mock('../src/utils', () => ({
  autoHandlePreflight: vi.fn(),
  validateEnvironment: vi.fn(),
  validateMethod: vi.fn(),
}));

// Mock responses
vi.mock('../src/responses', () => ({
  createErrorResponse: vi.fn(),
  createSuccessResponse: vi.fn(),
  createOkResponse: vi.fn(),
  createBadRequestResponse: vi.fn(),
  createUnauthorizedResponse: vi.fn(),
  createForbiddenResponse: vi.fn(),
  createNotFoundResponse: vi.fn(),
  createMethodNotAllowedResponse: vi.fn(),
  createRequestTimeoutResponse: vi.fn(),
  createConflictResponse: vi.fn(),
  createUnprocessableEntityResponse: vi.fn(),
  createTooManyRequestsResponse: vi.fn(),
  createInternalServerErrorResponse: vi.fn(),
  createServiceUnavailableResponse: vi.fn(),
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
  let mockCreateClient: MockedFunction<any>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = new Request('http://localhost/test', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });

    mockResponse = new Response('test response');

    mockCallback = vi.fn().mockResolvedValue(mockResponse);

    // Mock createClient function
    mockCreateClient = vi.fn(
      (url: string, key: string, options?: SupabaseClientOptions<string>) => {
        // Return user client or admin client based on the key
        if (key === 'test-anon-key' || options != null) {
          return mockSupabaseClient;
        }
        return mockSupabaseAdminClient;
      },
    );

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

    // Mock Supabase client methods
    mockSupabaseClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    (validateEnvironment as any).mockReturnValue([]);
    (validateMethod as any).mockReturnValue(true);
    (autoHandlePreflight as any).mockReturnValue(new Response('ok', { status: 200 }));
    (createErrorResponse as any).mockImplementation(
      (error: any, status = 400, cors?: any) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(cors || {}),
        };
        return new Response(JSON.stringify({ error }), { status, headers });
      },
    );
    (createSuccessResponse as any).mockImplementation(
      (data: any, message?: string, status = 200, cors?: any) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(cors || {}),
        };
        return new Response(JSON.stringify({ data }), { status, headers });
      },
    );
  });

  it('should create a server with default options', async () => {
    createServer(mockCallback, { createClient: mockCreateClient });

    expect((globalThis as any).Deno.serve).toHaveBeenCalledTimes(1);
    const handler = (globalThis as any).__testHandler;

    const _response = await handler(mockRequest);
    expect(_response).toBe(mockResponse);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        request: mockRequest,
        user: mockUser,
        supabaseClient: mockSupabaseClient,
        supabaseAdminClient: mockSupabaseAdminClient,
        headers: {
          ...defaultResponseHeaders,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
        respond: expect.objectContaining({
          success: expect.any(Function),
          error: expect.any(Function),
          ok: expect.any(Function),
          badRequest: expect.any(Function),
          unauthorized: expect.any(Function),
          forbidden: expect.any(Function),
          notFound: expect.any(Function),
          methodNotAllowed: expect.any(Function),
          requestTimeout: expect.any(Function),
          conflict: expect.any(Function),
          unprocessableEntity: expect.any(Function),
          tooManyRequests: expect.any(Function),
          internalServerError: expect.any(Function),
          serviceUnavailable: expect.any(Function),
        }),
      }),
    );
  });

  it('should handle CORS preflight requests', async () => {
    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const corsRequest = new Request('http://localhost/test', { method: 'OPTIONS' });

    const _response = await handler(corsRequest);

    expect(autoHandlePreflight).toHaveBeenCalledWith({
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    expect(_response.status).toBe(200);
  });

  it('should reject invalid HTTP methods', async () => {
    (validateMethod as any).mockReturnValue(false);

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['POST']);
    expect(createErrorResponse).toHaveBeenCalledWith('Method not allowed', 405, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should validate environment variables', async () => {
    (validateEnvironment as any).mockReturnValue(['MISSING_VAR']);

    createServer(mockCallback, { createClient: mockCreateClient });

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
      {
        ...defaultResponseHeaders,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    );
  });

  it('should handle authentication when enabled', async () => {
    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(mockSupabaseClient.auth.getUser).toHaveBeenCalled();
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({ user: mockUser }),
    );
  });

  it('should handle authentication failure', async () => {
    mockSupabaseClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: null,
    });

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Unauthorized', 401, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should skip authentication when disabled', async () => {
    createServer(mockCallback, { authenticate: false, createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(mockSupabaseClient.auth.getUser).not.toHaveBeenCalled();
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

    createServer(mockCallback, { createClient: mockCreateClient, timeoutMs: 50 });

    const handler = (globalThis as any).__testHandler;

    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Request timed out', 408, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should handle JSON parsing errors in callback', async () => {
    const jsonError = new SyntaxError('Unexpected token in JSON');

    mockCallback.mockRejectedValue(jsonError);

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith(
      'Invalid JSON in request body',
      400,
      {
        ...defaultResponseHeaders,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    );
  });

  it('should handle general errors', async () => {
    const generalError = new Error('Something went wrong');

    mockCallback.mockRejectedValue(generalError);

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Something went wrong', 500, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should handle non-Error exceptions', async () => {
    mockCallback.mockRejectedValue('string error');

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Internal server error', 500, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should support custom allowed methods', async () => {
    createServer(mockCallback, {
      createClient: mockCreateClient,
      allowedMethods: ['GET', 'POST', 'PUT'],
    });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['GET', 'POST', 'PUT']);
  });

  it('should support custom required environment variables', async () => {
    createServer(mockCallback, {
      createClient: mockCreateClient,
      requiredEnvVars: ['CUSTOM_VAR'],
    });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith(['CUSTOM_VAR']);
  });

  it('should support custom timeout', async () => {
    createServer(mockCallback, { createClient: mockCreateClient, timeoutMs: 30000 });

    // Test that timeout is passed correctly by checking error message
    mockCallback.mockImplementation(async () => {
      await new Promise((resolve) => {
        setTimeout(() => resolve(undefined), 100);
      });
      return mockResponse;
    });

    createServer(mockCallback, { createClient: mockCreateClient, timeoutMs: 50 });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Request timed out', 408, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should disable CORS handling when configured', async () => {
    createServer(mockCallback, {
      createClient: mockCreateClient,
      autoHandlePreflight: false,
    });

    const handler = (globalThis as any).__testHandler;
    const corsRequest = new Request('http://localhost/test', { method: 'OPTIONS' });

    const _response = await handler(corsRequest);

    expect(autoHandlePreflight).not.toHaveBeenCalled();
    // Should proceed to method validation
    expect(validateMethod).toHaveBeenCalled();
  });

  it('should handle multiple requests concurrently', async () => {
    createServer(mockCallback, { createClient: mockCreateClient });

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
    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        request: mockRequest,
        user: mockUser,
        supabaseClient: mockSupabaseClient,
        supabaseAdminClient: mockSupabaseAdminClient,
        headers: {
          ...defaultResponseHeaders,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
        respond: expect.any(Object),
      }),
    );
  });

  it('should handle callback that throws synchronously', async () => {
    mockCallback.mockImplementation(() => {
      throw new Error('Sync error');
    });

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Sync error', 500, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should handle empty requiredEnvVars array', async () => {
    createServer(mockCallback, { createClient: mockCreateClient, requiredEnvVars: [] });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith([]);
  });

  it('should handle empty allowedMethods array', async () => {
    (validateMethod as any).mockReturnValue(false);

    createServer(mockCallback, { createClient: mockCreateClient, allowedMethods: [] });

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

    createServer(mockCallback, { createClient: mockCreateClient, timeoutMs: 0 });

    const handler = (globalThis as any).__testHandler;

    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Request timed out', 408, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should handle getUser throwing an error as unauthorized', async () => {
    // Mock auth.getUser to throw an error
    mockSupabaseClient.auth.getUser = vi
      .fn()
      .mockRejectedValue(new Error('Auth service error'));

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith('Unauthorized', 401, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  it('should handle callback returning non-Response value', async () => {
    mockCallback.mockResolvedValue('not a response' as any);

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const response = await handler(mockRequest);

    expect(response).toBe('not a response');
  });

  it('should handle multiple environment variables missing', async () => {
    (validateEnvironment as any).mockReturnValue(['VAR1', 'VAR2', 'VAR3']);

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(createErrorResponse).toHaveBeenCalledWith(
      'Missing required environment variables: VAR1, VAR2, VAR3',
      500,
      {
        ...defaultResponseHeaders,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    );
  });

  it('should handle all default options', async () => {
    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith([
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['POST']);
  });

  it('should handle server creation with minimal config', async () => {
    createServer(mockCallback, {
      createClient: mockCreateClient,
      authenticate: false,
      autoHandlePreflight: false,
      allowedMethods: ['GET'],
      requiredEnvVars: [],
      timeoutMs: 1000,
    });

    const handler = (globalThis as any).__testHandler;
    await handler(mockRequest);

    expect(validateEnvironment).toHaveBeenCalledWith([]);
    expect(validateMethod).toHaveBeenCalledWith(mockRequest, ['GET']);
  });

  it('should handle race condition between timeout and successful response', async () => {
    mockCallback.mockResolvedValue(mockResponse);

    createServer(mockCallback, { createClient: mockCreateClient, timeoutMs: 1000 });

    const handler = (globalThis as any).__testHandler;
    const response = await handler(mockRequest);

    expect(response).toBe(mockResponse);
    expect(createErrorResponse).not.toHaveBeenCalledWith('Request timed out', 408);
  });

  it('should handle callback that resolves immediately', async () => {
    mockCallback.mockResolvedValue(mockResponse);

    createServer(mockCallback, { createClient: mockCreateClient });

    const handler = (globalThis as any).__testHandler;
    const response = await handler(mockRequest);

    expect(response).toBe(mockResponse);
  });

  it('should handle different request methods with custom allowed methods', async () => {
    const getRequest = new Request('http://localhost/test', { method: 'GET' });
    const putRequest = new Request('http://localhost/test', { method: 'PUT' });
    const deleteRequest = new Request('http://localhost/test', { method: 'DELETE' });

    createServer(mockCallback, {
      createClient: mockCreateClient,
      allowedMethods: ['GET', 'PUT', 'DELETE'],
    });

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

    createServer(mockCallback, {
      createClient: mockCreateClient,
      allowedMethods: ['PATCH'],
    });

    const handler = (globalThis as any).__testHandler;
    await handler(patchRequest);

    expect(validateMethod).toHaveBeenCalledWith(patchRequest, ['PATCH']);
  });

  it('should handle HEAD method', async () => {
    const headRequest = new Request('http://localhost/test', { method: 'HEAD' });

    createServer(mockCallback, {
      createClient: mockCreateClient,
      allowedMethods: ['HEAD'],
    });

    const handler = (globalThis as any).__testHandler;
    await handler(headRequest);

    expect(validateMethod).toHaveBeenCalledWith(headRequest, ['HEAD']);
  });

  it('should handle custom onError callback for validation errors', async () => {
    const customError = new Error('Custom validation error');
    (customError as any).isValidation = true;

    mockCallback.mockRejectedValue(customError);

    const onError = vi.fn((error: any) => {
      if (error.isValidation) {
        return {
          message: 'Custom validation failed',
          code: 'CUSTOM_VALIDATION_ERROR',
          details: { field: 'test' },
        };
      }
      return null;
    });

    createServer(mockCallback, {
      createClient: mockCreateClient,
      onError,
    });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(onError).toHaveBeenCalledWith(customError);
    expect(createErrorResponse).toHaveBeenCalledWith(
      {
        message: 'Custom validation failed',
        code: 'CUSTOM_VALIDATION_ERROR',
        details: { field: 'test' },
      },
      400,
      {
        ...defaultResponseHeaders,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    );
  });

  it('should fall back to default error handling when onError returns null', async () => {
    const generalError = new Error('General error');
    mockCallback.mockRejectedValue(generalError);

    const onError = vi.fn(() => null);

    createServer(mockCallback, {
      createClient: mockCreateClient,
      onError,
    });

    const handler = (globalThis as any).__testHandler;
    const _response = await handler(mockRequest);

    expect(onError).toHaveBeenCalledWith(generalError);
    expect(createErrorResponse).toHaveBeenCalledWith('General error', 500, {
      ...defaultResponseHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
  });

  describe('respond helpers', () => {
    it('should provide respond.success with default CORS', async () => {
      const testData = { message: 'test' };
      let capturedContext: any;

      mockCallback.mockImplementation((context: any) => {
        capturedContext = context;
        return context.respond.success(testData, 'Success message');
      });

      createServer(mockCallback, { createClient: mockCreateClient });

      const handler = (globalThis as any).__testHandler;
      await handler(mockRequest);

      expect(capturedContext.respond.success).toBeDefined();
      const response = capturedContext.respond.success(testData, 'Success message');
      expect(response).toBeInstanceOf(Response);
    });

    it('should provide respond.error with default CORS', async () => {
      let capturedContext: any;

      mockCallback.mockImplementation((context: any) => {
        capturedContext = context;
        return context.respond.error('Error message');
      });

      createServer(mockCallback, { createClient: mockCreateClient });

      const handler = (globalThis as any).__testHandler;
      await handler(mockRequest);

      expect(capturedContext.respond.error).toBeDefined();
      const response = capturedContext.respond.error('Error message');
      expect(response).toBeInstanceOf(Response);
    });

    it('should allow CORS override in respond helpers', async () => {
      const customCors = { 'Access-Control-Allow-Origin': 'https://custom.com' };
      let capturedContext: any;

      mockCallback.mockImplementation((context: any) => {
        capturedContext = context;
        return context.respond.success({ test: 'data' }, 'Success', 200, customCors);
      });

      createServer(mockCallback, { createClient: mockCreateClient });

      const handler = (globalThis as any).__testHandler;
      await handler(mockRequest);

      const response = capturedContext.respond.success(
        { test: 'data' },
        'Success',
        200,
        customCors,
      );
      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://custom.com',
      );
    });

    it('should provide all respond helper methods', async () => {
      let capturedContext: any;

      mockCallback.mockImplementation((context: any) => {
        capturedContext = context;
        return context.respond.success({ ok: true });
      });

      createServer(mockCallback, { createClient: mockCreateClient });

      const handler = (globalThis as any).__testHandler;
      await handler(mockRequest);

      expect(capturedContext.respond).toMatchObject({
        success: expect.any(Function),
        error: expect.any(Function),
        ok: expect.any(Function),
        badRequest: expect.any(Function),
        unauthorized: expect.any(Function),
        forbidden: expect.any(Function),
        notFound: expect.any(Function),
        methodNotAllowed: expect.any(Function),
        requestTimeout: expect.any(Function),
        conflict: expect.any(Function),
        unprocessableEntity: expect.any(Function),
        tooManyRequests: expect.any(Function),
        internalServerError: expect.any(Function),
        serviceUnavailable: expect.any(Function),
      });
    });
  });
});
