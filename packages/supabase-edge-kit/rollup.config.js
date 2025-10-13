import rollupConfig from '@internal/rollup-config';
import copy from 'rollup-plugin-copy';

const config = rollupConfig();
config.plugins = [
  copy({
    targets: [{ src: 'src/*.d.ts', dest: 'dist' }],
  }),
  ...(Array.isArray(config.plugins) ? config.plugins : []),
];

export default config;
