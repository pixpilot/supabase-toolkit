import baseConfig from '@internal/vitest-config';
import { defineConfig, mergeConfig } from 'vitest/config';

export default defineConfig(
  mergeConfig(baseConfig, {
    resolve: {
      alias: {
        'npm:zod': 'zod',
        'npm:@supabase/supabase-js': '@supabase/supabase-js',
      },
    },
  }),
);
