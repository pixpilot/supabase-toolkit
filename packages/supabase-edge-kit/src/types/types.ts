export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: any;
}

export interface ResponseHeaders {
  'Access-Control-Allow-Origin': string;
  'Access-Control-Allow-Headers': string;
  'Access-Control-Allow-Methods'?: string;
}

/**
 * Response helper function type with default headers
 */
export type ResponseHelperWithData<T = any> = (
  data: T,
  message?: string,
  headers?: Partial<ResponseHeaders>,
) => Response;

/**
 * Response helper function type for errors with default headers
 */
export type ResponseHelperWithError = (
  error: string | ApiError,
  headers?: Partial<ResponseHeaders>,
) => Response;

/**
 * Response helper function type for success with optional status
 */
export type SuccessResponseHelper = <T>(
  data: T,
  message?: string,
  status?: number,
  headers?: Partial<ResponseHeaders>,
) => Response;

/**
 * Response helper function type for errors with optional status
 */
export type ErrorResponseHelper = (
  error: string | ApiError,
  status?: number,
  headers?: Partial<ResponseHeaders>,
) => Response;

/**
 * Collection of response helper methods with default headers
 */
export interface RespondHelpers {
  success: SuccessResponseHelper;
  error: ErrorResponseHelper;
  ok: ResponseHelperWithData;
  badRequest: ResponseHelperWithError;
  unauthorized: ResponseHelperWithError;
  forbidden: ResponseHelperWithError;
  notFound: ResponseHelperWithError;
  methodNotAllowed: ResponseHelperWithError;
  requestTimeout: ResponseHelperWithError;
  conflict: ResponseHelperWithError;
  unprocessableEntity: ResponseHelperWithError;
  tooManyRequests: ResponseHelperWithError;
  internalServerError: ResponseHelperWithError;
  serviceUnavailable: ResponseHelperWithError;
}
