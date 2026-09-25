import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts'],
    fileParallelism: false,
    // Colyseus talks to its parent over process IPC when present, which clashes with the forks pool.
    pool: 'threads',
    testTimeout: 20000,
  },
});
