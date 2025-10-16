import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { MockedFunction } from 'vitest';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoHandlePreflight,
  getUser,
  RateLimiter,
  validateEnvironment,
  validateMethod,
} from '../src';
import { defaultResponseHeaders } from '../src/constants';

// Mock Deno
vi.mock('deno', () => ({
  env: {
    get: vi.fn(),
  },
}));

// Mock Supabase client
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

describe('utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up global Deno mock
    (globalThis as any).Deno = {
      env: {
        get: vi.fn(),
      },
    };
  });

  describe('autoHandlePreflight', () => {
    it('should return a CORS response', () => {
      const result = autoHandlePreflight(defaultResponseHeaders);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(200);
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(result.headers.get('Access-Control-Allow-Headers')).toBe(
        'authorization, x-client-info, apikey, content-type',
      );
      expect(result.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
    });

    it('should handle custom CORS headers', () => {
      const customCors = {
        ...defaultResponseHeaders,
        'Access-Control-Allow-Origin': 'https://example.com',
        'Access-Control-Allow-Headers': 'custom-header',
      };
      const result = autoHandlePreflight(customCors);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(200);
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://example.com',
      );
      expect(result.headers.get('Access-Control-Allow-Headers')).toBe('custom-header');
      expect(result.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
    });
  });

  describe('validateMethod', () => {
    it('should return true for allowed method', () => {
      const req = new Request('http://localhost', { method: 'POST' });
      const result = validateMethod(req, ['GET', 'POST', 'PUT']);

      expect(result).toBe(true);
    });

    it('should return false for disallowed method', () => {
      const req = new Request('http://localhost', { method: 'DELETE' });
      const result = validateMethod(req, ['GET', 'POST']);

      expect(result).toBe(false);
    });

    it('should handle empty allowed methods array', () => {
      const req = new Request('http://localhost', { method: 'GET' });
      const result = validateMethod(req, []);

      expect(result).toBe(false);
    });
  });

  describe('getUser', () => {
    let mockSupabaseClient: SupabaseClient;

    beforeEach(() => {
      mockSupabaseClient = {
        auth: {
          getUser: vi.fn(),
        },
      } as unknown as SupabaseClient;
    });

    it('should return user when getUser succeeds', async () => {
      const mockUser: User = {
        id: 'test-id',
        email: 'test@example.com',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
      };

      (mockSupabaseClient.auth.getUser as MockedFunction<any>).mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const result = await getUser(mockSupabaseClient);

      expect(result).toEqual(mockUser);
      expect(mockSupabaseClient.auth.getUser).toHaveBeenCalled();
    });

    it('should return null when getUser fails', async () => {
      (mockSupabaseClient.auth.getUser as MockedFunction<any>).mockResolvedValue({
        data: { user: null },
        error: new Error('Auth error'),
      });

      const result = await getUser(mockSupabaseClient);

      expect(result).toBeNull();
    });

    it('should return null when an exception occurs', async () => {
      (mockSupabaseClient.auth.getUser as MockedFunction<any>).mockRejectedValue(
        new Error('Network error'),
      );

      const result = await getUser(mockSupabaseClient);

      expect(result).toBeNull();
    });
  });

  describe('validateEnvironment', () => {
    it('should return empty array when all variables are present', () => {
      (globalThis as any).Deno.env.get.mockImplementation((key: string) => {
        if (key === 'VAR1') return 'value1';
        if (key === 'VAR2') return 'value2';
        return undefined;
      });

      const result = validateEnvironment(['VAR1', 'VAR2']);

      expect(result).toEqual([]);
    });

    it('should return missing variables', () => {
      (globalThis as any).Deno.env.get.mockImplementation((key: string) => {
        if (key === 'VAR1') return 'value1';
        return undefined;
      });

      const result = validateEnvironment(['VAR1', 'VAR2', 'VAR3']);

      expect(result).toEqual(['VAR2', 'VAR3']);
    });

    it('should handle empty required vars array', () => {
      const result = validateEnvironment([]);

      expect(result).toEqual([]);
    });
  });

  describe('rateLimiter', () => {
    let rateLimiter: RateLimiter;

    beforeEach(() => {
      rateLimiter = new RateLimiter(3, 1000); // 3 requests per 1000ms
    });

    it('should allow requests within the limit', () => {
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
    });

    it('should block requests exceeding the limit', () => {
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user1');

      expect(rateLimiter.isAllowed('user1')).toBe(false);
    });

    it('should allow requests after window expires', () => {
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user1');

      // Simulate time passing
      vi.useFakeTimers();
      vi.advanceTimersByTime(1001);

      expect(rateLimiter.isAllowed('user1')).toBe(true);
      vi.useRealTimers();
    });

    it('should handle different identifiers independently', () => {
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user1');

      expect(rateLimiter.isAllowed('user2')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(false);
    });

    it('should clean up old requests outside the window', () => {
      vi.useFakeTimers();

      rateLimiter.isAllowed('user1'); // t=0
      vi.advanceTimersByTime(500);
      rateLimiter.isAllowed('user1'); // t=500
      vi.advanceTimersByTime(600);
      rateLimiter.isAllowed('user1'); // t=1100 (first request should be cleaned up)

      // Should allow one more request since first one is outside window
      expect(rateLimiter.isAllowed('user1')).toBe(true);

      vi.useRealTimers();
    });
  });
});
