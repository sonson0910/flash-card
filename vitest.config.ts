import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      'e2e/**',
      'functions/**',
      'firestore.rules.test.ts',
    ],
    testTimeout: 15_000,
  },
});
