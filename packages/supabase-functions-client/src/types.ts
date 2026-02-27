/**
 * Custom error response interface from Edge Functions
 */
export interface EdgeFunctionErrorResponse {
  error?: string;
  message?: string;
  code?: string;
  details?: any;
}

/**
 * Enhanced function response with better error handling
 */
export interface FunctionsResponse<T> {
  data: T | null;
  error: string | null;
  code?: string;
  details?: any;
  message?: string;
}

/**
 * Utility to extract required keys from a type
 */
export type RequiredKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends { [P in K]: T[K] } ? never : K;
}[keyof T];

/**
 * Check if type has required keys
 */
export type HasRequiredProperties<T> = RequiredKeys<T> extends never ? false : true;

/**
 * Function invocation options with conditional body requirement.
 *
 * - When `RequestBody` is `void | undefined`, the body option is not present.
 * - When `RequestBody` has all-optional properties, `body` is optional.
 * - When `RequestBody` has at least one required property, `body` is required.
 */
export type FunctionInvokeOptions<RequestBody> = RequestBody extends void | undefined
  ? {
      headers?: Record<string, string>;
      method?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';
      signal?: AbortSignal;
    }
  : HasRequiredProperties<RequestBody> extends true
    ? {
        headers?: Record<string, string>;
        method?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';
        body: RequestBody;
        signal?: AbortSignal;
      }
    : {
        headers?: Record<string, string>;
        method?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';
        body?: RequestBody;
        signal?: AbortSignal;
      };

/**
 * Determines whether the `options` parameter to `invoke()` is required or
 * optional based on the shape of `RequestBody`.
 *
 * - If `RequestBody` is `void | undefined`, options are optional.
 * - If `RequestBody` has no required properties, options are optional.
 * - If `RequestBody` has required properties, options are required.
 */
export type InvokeOptions<RequestBody> = RequestBody extends void | undefined
  ? FunctionInvokeOptions<RequestBody> | undefined
  : RequiredKeys<RequestBody> extends never
    ? FunctionInvokeOptions<RequestBody> | undefined
    : FunctionInvokeOptions<RequestBody>;
