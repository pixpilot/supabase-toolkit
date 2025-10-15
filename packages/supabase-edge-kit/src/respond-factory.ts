import type { RespondHelpers, ResponseHeaders } from './types/types.ts';
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
} from './responses.ts';

/**
 * Creates a respond helpers object with default headers settings
 *
 * @param defaultHeaders - The default response headers to use for all responses
 * @returns An object with all response helper methods
 */
export function createRespondHelpers(
  defaultHeaders: ResponseHeaders | Partial<ResponseHeaders>,
): RespondHelpers {
  return {
    success: (data, message, status, headers) =>
      createSuccessResponse(data, message, status, headers ?? defaultHeaders),
    error: (error, status, headers) =>
      createErrorResponse(error, status, headers ?? defaultHeaders),
    ok: (data, message, headers) =>
      createOkResponse(data, message, headers ?? defaultHeaders),
    badRequest: (error, headers) =>
      createBadRequestResponse(error, headers ?? defaultHeaders),
    unauthorized: (error, headers) =>
      createUnauthorizedResponse(error, headers ?? defaultHeaders),
    forbidden: (error, headers) =>
      createForbiddenResponse(error, headers ?? defaultHeaders),
    notFound: (error, headers) =>
      createNotFoundResponse(error, headers ?? defaultHeaders),
    methodNotAllowed: (error, headers) =>
      createMethodNotAllowedResponse(error, headers ?? defaultHeaders),
    requestTimeout: (error, headers) =>
      createRequestTimeoutResponse(error, headers ?? defaultHeaders),
    conflict: (error, headers) =>
      createConflictResponse(error, headers ?? defaultHeaders),
    unprocessableEntity: (error, headers) =>
      createUnprocessableEntityResponse(error, headers ?? defaultHeaders),
    tooManyRequests: (error, headers) =>
      createTooManyRequestsResponse(error, headers ?? defaultHeaders),
    internalServerError: (error, headers) =>
      createInternalServerErrorResponse(error, headers ?? defaultHeaders),
    serviceUnavailable: (error, headers) =>
      createServiceUnavailableResponse(error, headers ?? defaultHeaders),
  };
}
