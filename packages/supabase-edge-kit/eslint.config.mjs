import baseConfig from '@internal/eslint-config/base';
import denoImportRule from '@internal/eslint-config/deno-import-rule';

// Uncomment to use the internal ESLint config if available
// /** @type {import('@internal/eslint-config').Config} */
/** @type {import('typescript-eslint').Config} */
export default [
  ...baseConfig,
  {
    files: ['src/**/*.{js,ts}'],
    plugins: {
      '@internal': {
        rules: {
          'deno-import-rule': denoImportRule,
        },
      },
    },
    rules: {
      '@internal/deno-import-rule': 'error',
    },
  },
];
