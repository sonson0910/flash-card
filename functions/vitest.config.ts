import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Callable imports can exceed their test deadlines when workers compete for CPU.
    maxWorkers: 1,
    pool: 'forks',
  },
});
