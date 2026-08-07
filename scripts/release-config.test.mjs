import { describe, expect, it } from 'vitest';
import {
  buildReleaseMetadata,
  validateProductionEnvironment,
} from './release-config.mjs';

describe('production release configuration', () => {
  it('requires a real reCAPTCHA Enterprise App Check site key', () => {
    expect(validateProductionEnvironment({})).toContain(
      'VITE_FIREBASE_APP_CHECK_SITE_KEY is required',
    );
    expect(validateProductionEnvironment({
      VITE_FIREBASE_APP_CHECK_SITE_KEY: 'your_recaptcha_enterprise_site_key',
    }).join('\n')).toContain('placeholder');
  });

  it('rejects debug App Check and browser provider secrets', () => {
    const errors = validateProductionEnvironment({
      VITE_FIREBASE_APP_CHECK_SITE_KEY: '6Lc_real-looking-public-site-key',
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
    })).toEqual({
      status: 'ok',
      service: 'lingoflash',
      version: '1.2.3',
      revision: '0123456789abcdef',
      builtAt: '2026-07-26T12:00:00.000Z',
    });
  });
});
