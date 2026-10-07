import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The simulation is tested directly rather than through a browser: the arena,
 * the enemy AI and every damage rule are plain TypeScript that only need
 * Three.js maths, and driving a real WebGL context headlessly costs minutes
 * per run for no extra coverage.
 *
 * A separate config from `vite.config.ts` on purpose -- the app config demands
 * PORT and BASE_PATH from the workflow and throws without them.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Wave invariant runs step thousands of frames across three arenas.
    testTimeout: 60_000,
  },
});
