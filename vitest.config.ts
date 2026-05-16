import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/helpers/setup.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Vitest 4: `test.poolOptions.forks.singleFork` was deprecated.
    // The serialise-test-files behaviour we need is `fileParallelism: false`
    // (combined with a single fork). Without this, tests across files
    // interleave and TRUNCATE-CASCADE in one file's beforeEach can hit
    // mid-INSERT of another file's test, producing FK violations.
    pool: 'forks',
    fileParallelism: false,
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/migrate.ts'],
    },
  },
});
