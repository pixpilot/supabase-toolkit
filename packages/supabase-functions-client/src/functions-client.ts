import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EdgeFunctionErrorResponse,
  FunctionInvokeOptions,
  FunctionsResponse,
  RequiredKeys,
} from './types';

import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * Custom error class for Edge Function errors
 * Allows for instanceof checks and provides structured error information
 */
export class EdgeFunctionError extends Error {
  public readonly code?: string | undefined;
  public readonly details?: unknown;
  public readonly functionName: string;

  constructor(message: string, functionName: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.functionName = functionName;
    this.code = code;
    this.details = details;
  }
}

/**
 * Error thrown when Edge Function returns no data
 */
export class EdgeFunctionNoDataError extends EdgeFunctionError {
  constructor(functionName: string) {
    super('No data received from Edge Function.', functionName);
    this.name = 'EdgeFunctionNoDataError';
  }
}

/**
 * Enhanced Supabase Functions client with better error handling
 * Provides a wrapper around Supabase Edge Functions with:
 * - Automatic custom error message extraction
 * - Type-safe responses
 * - Consistent error handling
 * - Generic typing support
 */
export class FunctionsClient {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Invoke a Supabase Edge Function with enhanced error handling
   * Throws EdgeFunctionError on failure, returns data on success
   *
   * @param functionName - The name of the Edge Function to invoke
   * @param args - Function invocation options (optional if RequestBody has no required properties)
   * @returns Promise<ResponseData> - The response data on success
   * @throws {EdgeFunctionError} When the function fails or returns an error
   * @throws {EdgeFunctionNoDataError} When the function succeeds but returns no data
   */
  async invoke<RequestBody = void, ResponseData = any>(
    functionName: string,
    ...args: RequiredKeys<RequestBody> extends never
      ? [options?: FunctionInvokeOptions<RequestBody>]
      : [options: FunctionInvokeOptions<RequestBody>]
  ): Promise<ResponseData> {
    const options = args[0];
    try {
      const result = await this.supabase.functions.invoke<ResponseData>(
        functionName,

        // eslint-disable-next-line ts/no-unsafe-argument
        options as any,
      );

      // Handle error cases
      if (result.error != null) {
        console.error(`Edge Function '${functionName}' error:`, result.error);

        // Handle FunctionsHttpError to extract custom error message
        if (result.error instanceof FunctionsHttpError) {
          try {
            // The context property contains the Response object
            const response = result.error.context as Response;
            const errorResponse = (await response.json()) as EdgeFunctionErrorResponse;

            const customErrorMessage =
              errorResponse.error ?? errorResponse.message ?? result.error.message;

            throw new EdgeFunctionError(
              customErrorMessage,
              functionName,
              errorResponse.code,
              errorResponse.details,
            );
          } catch (parseError) {
            if (parseError instanceof EdgeFunctionError) {
              throw parseError;
            }
            console.error(
              `Failed to parse error response from '${functionName}':`,
              parseError,
            );
            throw new EdgeFunctionError(result.error.message, functionName);
          }
        } else {
          // Handle other error types
          const errorMessage =
            'message' in result.error
              ? (result.error as { message: string }).message
              : 'An unknown error occurred.';

          throw new EdgeFunctionError(errorMessage, functionName);
        }
      }

      // Handle success case
      if (result.data == null) {
        throw new EdgeFunctionNoDataError(functionName);
      }

      // Check if the response follows the ApiResponse structure with nested data
      if (
        typeof result.data === 'object' &&
        result.data !== null &&
        'data' in result.data &&
        'message' in result.data
      ) {
        // Extract the actual data from the nested structure
        const apiResponse = result.data as { data: ResponseData; message: string };
        return apiResponse.data;
      }

      // If it's not nested, return as is
      return result.data;
    } catch (error) {
      // Re-throw EdgeFunctionError instances
      if (error instanceof EdgeFunctionError) {
        throw error;
      }

      console.error(`Unexpected error invoking Edge Function '${functionName}':`, error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : `An unexpected error occurred while invoking '${functionName}'.`;

      throw new EdgeFunctionError(errorMessage, functionName);
    }
  }

  /**
   * Helper method for handling function invocations with UI feedback
   * Use this to wrap invoke calls and handle errors gracefully
   *
   * @param invokeCall - A function that calls invoke and returns the result
   * @param onSuccess - Callback for successful responses
   * @param onError - Callback for error responses
   * @param context - Additional context for logging
   *
   * @example
   * ```typescript
   * await functionsClient.handleInvoke(
   *   () => functionsClient.invoke<JobData>('process-job', options),
   *   (data) => {
   *     // Handle success
   *     console.log('Job processed:', data);
   *   },
   *   (error) => {
   *     // Handle error
   *     showErrorMessage(error.message);
   *   }
   * );
   * ```
   */
  async handleInvoke<T>(
    invokeCall: () => Promise<T>,
    onSuccess: (data: T) => Promise<void> | void,
    onError: (error: EdgeFunctionError) => Promise<void> | void,
    context?: string,
  ): Promise<void> {
    try {
      const data = await invokeCall();
      await onSuccess(data);
    } catch (error) {
      if (error instanceof EdgeFunctionError) {
        const contextStr = context != null && context.length > 0 ? ` (${context})` : '';
        console.error(`Function error${contextStr}:`, error.message);

        if (error.code != null && error.code.length > 0) {
          console.error(`Error code${contextStr}:`, error.code);
        }

        await onError(error);
      } else {
        // Re-throw unexpected errors
        throw error;
      }
    }
  }

  /**
   * @deprecated Use handleInvoke instead. This method is kept for backward compatibility.
   * Helper method for handling function responses with UI feedback
   */
  async handleResponse<T>(
    result: FunctionsResponse<T>,
    onSuccess: (data: T) => Promise<void> | void,
    onError: (error: string, code?: string, details?: unknown) => Promise<void> | void,
    context?: string,
  ): Promise<void> {
    if (result.error != null) {
      const contextStr = context != null && context.length > 0 ? ` (${context})` : '';
      console.error(`Function error${contextStr}:`, result.error);

      if (result.code != null && result.code.length > 0) {
        console.error(`Error code${contextStr}:`, result.code);
      }

      await onError(result.error, result.code, result.details);
    } else if (result.data != null) {
      await onSuccess(result.data);
    } else {
      // This shouldn't happen with our implementation, but just in case
      await onError('Unexpected response: no data or error received.');
    }
  }
}
