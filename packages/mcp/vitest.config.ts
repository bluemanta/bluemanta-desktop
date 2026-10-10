import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@bluemanta/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@bluemanta/cli/idea-tools': fileURLToPath(new URL('../cli/src/idea-tools.ts', import.meta.url)),
    },
  },
});
