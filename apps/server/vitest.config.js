import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.js'],
    include: ['test/**/*.test.js'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
