import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBuildTarget } from './vite.config';

const originalCwd = process.cwd();
afterEach(() => {
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
});

const withDotenv = (contents: string) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-target-'));
  fs.writeFileSync(path.join(directory, '.env.local'), contents);
  process.chdir(directory);
};

describe('staging Firebase build target', () => {
  it('includes the app ID required to exchange App Check tokens', () => {
    vi.stubEnv('SONFLASH_TARGET', 'staging');

    const { firebaseConfig, appCheckSiteKey } = resolveBuildTarget('production');

    expect(firebaseConfig.appId).toBe('1:890120640842:web:f8a858029dc582fc7e49b3');
    expect(firebaseConfig.projectId).toBe('sonflash-staging-20260906');
    expect(appCheckSiteKey).toBeTruthy();
  });

  it('ignores a dotenv target when the process environment does not set one', () => {
    withDotenv('SONFLASH_TARGET=staging\n');
    vi.stubEnv('SONFLASH_TARGET', undefined);

    expect(() => resolveBuildTarget('production')).toThrow(/conflicts with the production build target/);
  });

  it('accepts a dotenv target that matches the process environment', () => {
    withDotenv('SONFLASH_TARGET=staging\n');
    vi.stubEnv('SONFLASH_TARGET', 'staging');

    expect(resolveBuildTarget('production').firebaseConfig.projectId).toBe('sonflash-staging-20260906');
  });
});
