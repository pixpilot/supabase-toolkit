import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { globSync } from 'glob';

// Ensure output directory is relative to the current working directory (package being built)
const outputDir = path.resolve(process.cwd(), 'dist');

/**
 * @param {import('./types').RollupConfigOptions} [options]
 * @returns {import('rollup').RollupOptions} The Rollup configuration object
 */
export function defineConfig(options = {}) {
  const { multiEntry, bundleDependencies, minify = true, ...restOfOptions } = options;

  // Read package.json to get peerDependencies
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const peerDeps = Object.keys(packageJson.peerDependencies || {});

  // For all TypeScript files in 'src', excluding declaration files.
  let entryPoints;
  if (options.multiEntry) {
    entryPoints = globSync('src/**/*.ts', {
      ignore: ['src/**/*.d.ts', 'src/**/__tests__/**'], // Ignore declaration files and all __tests__ folders
    });
  } else {
    entryPoints = 'src/index.ts';
  }

  /** @type {import('rollup').RollupOptions} */
  const config = {
    input: entryPoints,
    external: peerDeps,
    ...restOfOptions,
    output: [
      {
        dir: outputDir,
        entryFileNames: '[name].cjs',
        format: 'cjs',
        exports: 'named',
        // Preserve the original module structure.
        preserveModules: !bundleDependencies,
        // Set 'src' as the root. This strips 'src/' from the output path.
        // e.g., 'src/configs/main.ts' becomes 'dist/configs/main.cjs'
        preserveModulesRoot: 'src',
      },
      {
        dir: outputDir,
        entryFileNames: '[name].js',
        format: 'es',
        preserveModules: !bundleDependencies,
        preserveModulesRoot: 'src',
      },
      ...(restOfOptions.output ? [restOfOptions.output].flat() : []),
    ],
    plugins: [
      typescript({
        tsconfig: './tsconfig.build.json',
        /*
         * Enabling incremental compilation may cause errors and sometimes prevent .d.ts file generation.
         * It can also cause the creation of a .rollup.cache folder, which sometimes results in .d.ts files not being copied.
         */
        incremental: false,
      }),

      ...(minify ? [terser()] : []),
      ...(bundleDependencies ? [nodeResolve()] : []),
      ...(restOfOptions.plugins ? [restOfOptions.plugins].flat() : []),
    ],
  };

  return config;
}

export default defineConfig;
