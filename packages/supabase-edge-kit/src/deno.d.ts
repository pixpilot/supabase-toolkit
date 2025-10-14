/**
 * Type declarations for Deno HTTP imports used in Supabase Functions
 */

declare namespace Deno {
  export namespace env {
    export function get(key: string): string | undefined;
  }
  /** Connection information about a request. */
  export interface ConnInfo {
    readonly localAddr: Deno.Addr;
    readonly remoteAddr: Deno.Addr;
  }

  /** Handler for HTTP requests. */
  export type Handler = (
    request: Request,
    connInfo: ConnInfo,
  ) => Response | Promise<Response>;

  /** Options for constructing a server. */
  export interface ServerInit extends Partial<Deno.ListenOptions> {
    handler: Handler;
    onError?: (error: unknown) => Response | Promise<Response>;
  }

  /** Options for serve function. */
  export interface ServeInit extends Partial<Deno.ListenOptions> {
    signal?: AbortSignal;
    onError?: (error: unknown) => Response | Promise<Response>;
    onListen?: (params: { hostname: string; port: number }) => void;
  }

  /** TLS-specific options for HTTPS server. */
  export interface ServeTlsInit extends ServeInit {
    key?: string;
    cert?: string;
    keyFile?: string;
    certFile?: string;
  }

  /** The HTTP server class. */
  export class Server {
    constructor(serverInit: ServerInit);
    readonly closed: boolean;
    readonly addrs: Deno.Addr[];
    listenAndServe(): Promise<void>;
    listenAndServeTls(certFile: string, keyFile: string): Promise<void>;
    serve(listener: Deno.Listener): Promise<void>;
    close(): void;
  }

  /** Functions to serve HTTP/HTTPS */
  export function serve(handler: Handler, options?: ServeInit): Promise<void>;
  export function serveTls(handler: Handler, options: ServeTlsInit): Promise<void>;
  export function serveListener(
    listener: Deno.Listener,
    handler: Handler,
    options?: Omit<ServeInit, 'port' | 'hostname'>,
  ): Promise<void>;
}

declare module 'npm:@supabase/supabase-js@^2' {
  export * from '@supabase/supabase-js';
}

declare module 'npm:zod@^3' {
  export * from 'zod';
}

// Extend the global scope to include Deno
declare global {
  const Deno: typeof Deno;
}
