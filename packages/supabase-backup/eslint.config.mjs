import baseConfig from '@internal/eslint-config/base';

// Uncomment to use the internal ESLint config if available
// /** @type {import('@internal/eslint-config').Config} */
/** @type {import('typescript-eslint').Config} */
export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // The CLI intentionally executes ordered dump/restore/R2 operations.
      'no-await-in-loop': 'off',
      'no-continue': 'off',
      'no-magic-numbers': 'off',
      'node/prefer-global/buffer': 'off',
      'node/prefer-global/process': 'off',
      'prefer-named-capture-group': 'off',
      'regexp/no-unused-capturing-group': 'off',
      'regexp/no-useless-dollar-replacements': 'off',
      'ts/strict-boolean-expressions': 'off',
    },
  },
];
