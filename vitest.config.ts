import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      'functions/**',
      'firestore.rules.test.ts',
      'firestore.gamification-diagnostic.rules.test.ts',
    ],
  },
});
