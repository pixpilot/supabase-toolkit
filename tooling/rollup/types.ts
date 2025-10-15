import type { RollupOptions } from 'rollup';

export interface RollupConfigOptions extends RollupOptions {
  /** Whether to treat all .ts files in src/ as entry points (multi-entry mode). */
  multiEntry?: boolean;

  /** Whether to include external dependencies in the final bundle. */
  bundleDependencies?: boolean;

  /** Whether to minify the output bundle. Defaults to true. */
  minify?: boolean;
}
