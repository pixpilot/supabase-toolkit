import rollupConfig from '@internal/rollup-config';

const config = rollupConfig({
  copy: {
    targets: [{ src: 'src/*.d.ts', dest: 'dist' }],
  },
});

export default config;
