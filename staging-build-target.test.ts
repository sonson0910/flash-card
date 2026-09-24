import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBuildTarget } from './vite.config';

afterEach(() => vi.unstubAllEnvs());

describe('staging Firebase build target', () => {
  it('includes the app ID required to exchange App Check tokens', () => {
    vi.stubEnv('SONFLASH_TARGET', 'staging');

    const { firebaseConfig, appCheckSiteKey } = resolveBuildTarget('production');

    expect(firebaseConfig.appId).toBe('1:890120640842:web:f8a858029dc582fc7e49b3');
    expect(firebaseConfig.projectId).toBe('sonflash-staging-20260906');
    expect(appCheckSiteKey).toBeTruthy();
  });
});
