import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const shellSources = [
  './AppFeedback.tsx',
  './AppFooter.tsx',
  './DesktopNavigation.tsx',
  './MobileNavigation.tsx',
  './SkipToContentLink.tsx',
  './shellTypes.ts',
];

describe('app shell presentation boundary', () => {
  it.each(shellSources)('%s stays independent from Firebase and repositories', relativePath => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

    expect(source).not.toMatch(/from\s+['"]firebase(?:\/|['"])/);
    expect(source).not.toMatch(/from\s+['"][^'"]*(?:Repository|\/firebase)['"]/i);
  });
});
