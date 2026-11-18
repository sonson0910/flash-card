import { defineConfig, devices } from '@playwright/test';

const origin = 'http://127.0.0.1:4176';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'shell-share-workflow.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/shell-share-workflow',
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4176 --strictPort --outDir artifacts/ui-fixtures/shell-share-workflow',
    url: `${origin}/e2e/fixtures/shell-share-workflow.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
