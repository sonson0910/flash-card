import { lingui } from '@lingui/vite-plugin';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }), lingui()],
  test: {
    exclude: [
      ...configDefaults.exclude,
      '**/.worktrees/**',
      'e2e/**',
      'functions/**',
      'firestore.rules.test.ts',
      'firestore.gamification-diagnostic.rules.test.ts',
    ],
  },
});
