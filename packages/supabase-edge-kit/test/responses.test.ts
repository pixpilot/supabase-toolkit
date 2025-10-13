import type { ApiError } from '../src/types';

import { describe, expect, it } from 'vitest';
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
} from '../src';

describe('createSuccessResponse', () => {
  it('should create a success response with data', () => {
    const data = { id: 1, name: 'test' };
    const result = createSuccessResponse(data);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('application/json');
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should create a success response with custom message and status', () => {
    const data = 'test data';
    const result = createSuccessResponse(data, 'Custom message', 201);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(201);
  });

  it('should use default message when not provided', async () => {
    const data = { test: true };
    const result = createSuccessResponse(data);

    const body = (await result.json()) as { message: string; data: any };
    expect(body.message).toBe('Success');
    expect(body.data).toEqual(data);
  });
});

describe('createOkResponse', () => {
  it('should create an OK response with data', () => {
    const data = { id: 1, name: 'test' };
    const result = createOkResponse(data);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('application/json');
  });

  it('should create an OK response with custom message', async () => {
    const data = 'test data';
    const result = createOkResponse(data, 'Custom message');

    expect(result.status).toBe(200);
    const body = (await result.json()) as { message: string; data: any };
    expect(body.message).toBe('Custom message');
    expect(body.data).toBe('test data');
  });
});

describe('createErrorResponse', () => {
  it('should create an error response with string error', () => {
    const error = 'Test error';
    const result = createErrorResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(400);
    expect(result.headers.get('Content-Type')).toBe('application/json');
  });

  it('should create an error response with ApiError object', () => {
    const error: ApiError = {
      message: 'Test error',
      code: 'TEST_ERROR',
      details: { field: 'test' },
    };
    const result = createErrorResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(400);
  });

  it('should create an error response with custom status', () => {
    const error = 'Not found';
    const result = createErrorResponse(error, 404);

    expect(result.status).toBe(404);
  });

  it('should handle ApiError with empty code', async () => {
    const error: ApiError = {
      message: 'Test error',
      code: '   ',
    };
    const result = createErrorResponse(error);

    const body = (await result.json()) as { error: string; code?: string };
    expect(body.error).toBe('Test error');
    expect(body.code).toBeUndefined();
  });
});

describe('createBadRequestResponse', () => {
  it('should create a bad request response with string error', () => {
    const error = 'Invalid input';
    const result = createBadRequestResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(400);
    expect(result.headers.get('Content-Type')).toBe('application/json');
  });

  it('should create a bad request response with ApiError object', async () => {
    const error: ApiError = {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
    };
    const result = createBadRequestResponse(error);

    expect(result.status).toBe(400);
    const body = (await result.json()) as { error: string; code: string };
    expect(body.error).toBe('Validation failed');
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

describe('createUnauthorizedResponse', () => {
  it('should create an unauthorized response', () => {
    const error = 'Authentication required';
    const result = createUnauthorizedResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(401);
  });
});

describe('createForbiddenResponse', () => {
  it('should create a forbidden response', () => {
    const error = 'Access denied';
    const result = createForbiddenResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(403);
  });
});

describe('createNotFoundResponse', () => {
  it('should create a not found response', () => {
    const error = 'Resource not found';
    const result = createNotFoundResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(404);
  });
});

describe('createMethodNotAllowedResponse', () => {
  it('should create a method not allowed response', () => {
    const error = 'Method not allowed';
    const result = createMethodNotAllowedResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(405);
  });
});

describe('createRequestTimeoutResponse', () => {
  it('should create a request timeout response', () => {
    const error = 'Request timed out';
    const result = createRequestTimeoutResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(408);
  });
});

describe('createConflictResponse', () => {
  it('should create a conflict response', () => {
    const error = 'Resource conflict';
    const result = createConflictResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(409);
  });
});

describe('createUnprocessableEntityResponse', () => {
  it('should create an unprocessable entity response', () => {
    const error = 'Validation failed';
    const result = createUnprocessableEntityResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(422);
  });
});

describe('createTooManyRequestsResponse', () => {
  it('should create a too many requests response', () => {
    const error = 'Rate limit exceeded';
    const result = createTooManyRequestsResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(429);
  });
});

describe('createInternalServerErrorResponse', () => {
  it('should create an internal server error response', () => {
    const error = 'Internal server error';
    const result = createInternalServerErrorResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(500);
  });
});

describe('createServiceUnavailableResponse', () => {
  it('should create a service unavailable response', () => {
    const error = 'Service temporarily unavailable';
    const result = createServiceUnavailableResponse(error);

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(503);
  });
});
