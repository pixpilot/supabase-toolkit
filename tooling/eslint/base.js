import makeConfig from '@pixpilot/eslint-config';

const composer = makeConfig({
  pnpm: false,
  turbo: true,
});

// eslint-disable-next-line antfu/no-top-level-await
const baseConfig = await composer;

export default baseConfig;
