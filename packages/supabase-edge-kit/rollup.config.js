import rollupConfig from '@internal/rollup-config';

const config = rollupConfig({
  copy: {
    targets: [{ src: 'src/*.d.ts', dest: 'dist' }],
  },
  // minify: false,
  bundleDependencies: true,
});

export default config;
