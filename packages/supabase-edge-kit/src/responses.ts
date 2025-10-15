import type { ApiError, ApiResponse, ResponseHeaders } from './types/types.ts';
import { defaultResponseHeaders } from './constants.ts';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CONFLICT,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_METHOD_NOT_ALLOWED,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_OK,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_SERVICE_UNAVAILABLE,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
  HTTP_STATUS_UNPROCESSABLE_ENTITY,
} from './http-status.ts';

/**
 * Create a success response
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string,
  status = HTTP_STATUS_OK,
  headers?: Partial<ResponseHeaders>,
): Response {
  const response: ApiResponse<T> = {
    data,
    message: message != null ? message : 'Success',
  };

  const mergedHeaders = { ...defaultResponseHeaders, ...headers };

  return new Response(JSON.stringify(response), {
    headers: { ...mergedHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

/**
 * Create an error response
 */
export function createErrorResponse(
  error: string | ApiError,
  status = HTTP_STATUS_BAD_REQUEST,
  headers?: Partial<ResponseHeaders>,
): Response {
  const response: ApiResponse = {};

  if (typeof error === 'string') {
    response.error = error;
  } else {
    response.error = error.message;
    if (error.code != null && error.code.trim() !== '') {
      response.code = error.code;
    }
  }

  const mergedHeaders = { ...defaultResponseHeaders, ...headers };

  return new Response(JSON.stringify(response), {
    headers: { ...mergedHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

/**
 * Create an OK response (200)
 */
export function createOkResponse<T>(
  data: T,
  message?: string,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createSuccessResponse(data, message, HTTP_STATUS_OK, headers);
}

/**
 * Create a Bad Request response (400)
 */
export function createBadRequestResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_BAD_REQUEST, headers);
}

/**
 * Create an Unauthorized response (401)
 */
export function createUnauthorizedResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_UNAUTHORIZED, headers);
}

/**
 * Create a Forbidden response (403)
 */
export function createForbiddenResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_FORBIDDEN, headers);
}

/**
 * Create a Not Found response (404)
 */
export function createNotFoundResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_NOT_FOUND, headers);
}

/**
 * Create a Method Not Allowed response (405)
 */
export function createMethodNotAllowedResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_METHOD_NOT_ALLOWED, headers);
}

/**
 * Create a Request Timeout response (408)
 */
export function createRequestTimeoutResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_REQUEST_TIMEOUT, headers);
}

/**
 * Create a Conflict response (409)
 */
export function createConflictResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_CONFLICT, headers);
}

/**
 * Create an Unprocessable Entity response (422)
 */
export function createUnprocessableEntityResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_UNPROCESSABLE_ENTITY, headers);
}

/**
 * Create a Too Many Requests response (429)
 */
export function createTooManyRequestsResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_TOO_MANY_REQUESTS, headers);
}

/**
 * Create an Internal Server Error response (500)
 */
export function createInternalServerErrorResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_INTERNAL_SERVER_ERROR, headers);
}

/**
 * Create a Service Unavailable response (503)
 */
export function createServiceUnavailableResponse(
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
): Response {
  return createErrorResponse(error, HTTP_STATUS_SERVICE_UNAVAILABLE, headers);
}
