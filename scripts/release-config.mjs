const PLACEHOLDER_PATTERN = /^(your_|replace|example|changeme)/i;
const BROWSER_SECRET_NAMES = [
  'VITE_GEMINI_API_KEY',
  'VITE_PEXELS_API_KEY',
  'VITE_UNSPLASH_API_KEY',
];

export function validateProductionEnvironment(environment) {
  const errors = [];
  const siteKey = environment.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim() ?? '';
  if (!siteKey) {
    errors.push('VITE_FIREBASE_APP_CHECK_SITE_KEY is required');
  } else if (siteKey.length < 20 || PLACEHOLDER_PATTERN.test(siteKey)) {
    errors.push('VITE_FIREBASE_APP_CHECK_SITE_KEY must not be a placeholder');
  }
  if (environment.VITE_FIREBASE_APP_CHECK_DEBUG?.trim().toLowerCase() === 'true') {
    errors.push('VITE_FIREBASE_APP_CHECK_DEBUG must not be true in production');
  }
  for (const name of BROWSER_SECRET_NAMES) {
    if (environment[name]?.trim()) {
      errors.push(`${name} must not be present in a production build`);
    }
  }
  const revision = (environment.RELEASE_REVISION || environment.GITHUB_SHA || '').trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision)) {
    errors.push('RELEASE_REVISION or GITHUB_SHA must contain a full 40- or 64-character commit revision');
  }
  return errors;
}

export function buildReleaseMetadata({ version, revision, builtAt }) {
  return {
    status: 'ok',
    service: 'lingoflash',
    version,
    revision,
    builtAt,
  };
}
