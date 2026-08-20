import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 15_000,
    include: [
      'firestore.rules.test.ts',
      'firestore.gamification-diagnostic.rules.test.ts',
    ],
    testTimeout: 15_000,
  },
});
