import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 15_000,
    include: [
      'firestore.rules.test.ts',
      'firestore.gamification-diagnostic.rules.test.ts',
    ],
    // The diagnostic branch intentionally removed per-entry sequence-map
    // validation to confirm the Firebase Rules expression-limit hypothesis.
    // Keep the permanent-schema test out of this temporary gate and replace it
    // with the focused diagnostic contract above. Restore the permanent test
    // when per-entry validation returns with an expression-safe implementation.
    testNamePattern: /^(?!.*allows only owner writes that match the bounded gamification stats schema).*$/,
    testTimeout: 15_000,
  },
});
