import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Keep multi-browser local runs deterministic on shared developer machines.
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    // `vite preview` serves the configured build.outDir, so an emulator run
    // that builds with SONFLASH_BUILD_OUT_DIR serves that same artifact.
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/health.json',
    // A passing health endpoint alone cannot prove which build owns port 4173.
    // Always start the configured artifact and fail if that port is occupied.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /pilot-mobile-review\.spec\.ts|shell-share-workflow\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /pilot-mobile-review\.spec\.ts|shell-share-workflow\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /pilot-mobile-review\.spec\.ts|shell-share-workflow\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      testMatch: /pilot-mobile-review\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      testMatch: /pilot-mobile-review\.spec\.ts/,
      use: { ...devices['iPhone 14'] },
    },
  ],
});
