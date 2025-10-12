import type { RollupOptions } from 'rollup';

export interface RollupConfigOptions extends RollupOptions {
  /**
   * Whether to include all TypeScript files in src/ or just index.ts
   */
  includeAllFiles?: boolean;
}
