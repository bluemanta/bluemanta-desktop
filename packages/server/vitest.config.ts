import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@bluemanta/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@bluemanta/cli/data-dir': fileURLToPath(new URL('../cli/src/data-dir.ts', import.meta.url)),
    },
  },
});
