import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('release static endpoints return machine-readable content', async ({ request }) => {
  const health = await request.get('/health.json');
  const robots = await request.get('/robots.txt');

  expect(health.ok()).toBe(true);
  expect(health.headers()['content-type']).toContain('application/json');
  expect(robots.ok()).toBe(true);
  await expect(robots.text()).resolves.toContain('User-agent: *');
});

test('release health identifies the exact built artifact', async ({ request }) => {
  // Same directory the preview server serves (see vite.config.ts build.outDir).
  const buildDir = process.env.SONFLASH_BUILD_OUT_DIR || 'dist';
  const expected = JSON.parse(readFileSync(new URL(`../${buildDir}/health.json`, import.meta.url), 'utf8')) as {
    artifactId: string;
  };
  const health = await request.get('/health.json');

  expect(health.ok()).toBe(true);
  expect((await health.json()).artifactId).toBe(expected.artifactId);
  expect(expected.artifactId).toMatch(/^[a-f0-9]{64}$/);
});
