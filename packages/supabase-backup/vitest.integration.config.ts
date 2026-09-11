import baseConfig from '@internal/vitest-config';

const config: typeof baseConfig = {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['test/recovery.integration.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
};

export default config;
