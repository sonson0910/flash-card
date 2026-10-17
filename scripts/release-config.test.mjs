import { describe, expect, it } from 'vitest';
import {
  buildReleaseMetadata,
  resolveReleaseTarget,
  validateDistTarget,
  validateFirebaseAppCheckTargets,
  validateProductionEnvironment,
} from './release-config.mjs';

describe('production release configuration', () => {
  it('refuses to build a staging target through production release validation', () => {
    expect(validateProductionEnvironment({
      SONFLASH_TARGET: 'staging',
      VITE_FIREBASE_APP_CHECK_SITE_KEY: '6Lc_real-looking-public-site-key',
      RELEASE_REVISION: 'a'.repeat(40),
    })).toContain('SONFLASH_TARGET must be production for a production release');
  });

  it('requires a distinct real App Check site key for every sealed target', () => {
    expect(validateFirebaseAppCheckTargets({ targets: {
      production: { appCheckSiteKey: 'your_recaptcha_enterprise_site_key' },
      staging: { appCheckSiteKey: '6Lc_real-looking-public-site-key' },
    } }).join('\n')).toContain('production');
    expect(validateFirebaseAppCheckTargets({ targets: {
      production: { appCheckSiteKey: '6Lc_shared-public-site-key' },
      staging: { appCheckSiteKey: '6Lc_shared-public-site-key' },
    } }).join('\n')).toContain('unique');
  });

  it('rejects debug App Check and browser provider secrets', () => {
    const errors = validateProductionEnvironment({
      VITE_FIREBASE_APP_CHECK_DEBUG: 'true',
      VITE_PEXELS_API_KEY: 'provider-secret',
    });

    expect(errors).toContain('VITE_FIREBASE_APP_CHECK_DEBUG must not be true in production');
    expect(errors).toContain('VITE_PEXELS_API_KEY must not be present in a production build');
  });

  it('creates deterministic metadata from immutable build inputs', () => {
    expect(buildReleaseMetadata({
      version: '1.2.3',
      revision: '0123456789abcdef',
      builtAt: '2026-07-26T12:00:00.000Z',
      target: 'staging',
      projectId: 'sonflash-staging-20260906',
    })).toEqual({
      status: 'ok',
      service: 'lingoflash',
      version: '1.2.3',
      revision: '0123456789abcdef',
      builtAt: '2026-07-26T12:00:00.000Z',
      target: 'staging',
      projectId: 'sonflash-staging-20260906',
    });
  });

  it('resolves the build target only from the given environment', () => {
    expect(resolveReleaseTarget({})).toBe('production');
    expect(resolveReleaseTarget({ SONFLASH_TARGET: ' staging ' })).toBe('staging');
    expect(() => resolveReleaseTarget({ SONFLASH_TARGET: 'preview' })).toThrow(/Unsupported/);
  });

  it('refuses to deploy a dist built for another target or project', () => {
    const staging = { target: 'staging', projectId: 'sonflash-staging-20260906' };
    expect(validateDistTarget(staging, 'staging', 'sonflash-staging-20260906')).toEqual([]);
    expect(validateDistTarget(staging, 'production', 'encoded-hangout-433912-h2')).toHaveLength(2);
    expect(validateDistTarget({ target: 'staging', projectId: 'other' }, 'staging', 'sonflash-staging-20260906'))
      .toEqual(['dist was built for project other, expected sonflash-staging-20260906']);
    expect(validateDistTarget({}, 'production', 'encoded-hangout-433912-h2')).toHaveLength(2);
  });

  it.each([
    '0123456',
    '0123456789abcdef',
    'g'.repeat(40),
    'a'.repeat(41),
  ])('rejects non-immutable release revision %s', (revision) => {
    expect(validateProductionEnvironment({
      RELEASE_REVISION: revision,
    })).toContain('RELEASE_REVISION or GITHUB_SHA must contain a full 40- or 64-character commit revision');
  });

  it.each(['a'.repeat(40), 'B'.repeat(64)])(
    'accepts a full immutable release revision %s',
    (revision) => {
      expect(validateProductionEnvironment({
        RELEASE_REVISION: revision,
      })).toEqual([]);
    },
  );
});
