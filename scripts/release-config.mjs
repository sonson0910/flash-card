const PLACEHOLDER_PATTERN = /^(your_|replace|example|changeme)/i;
const BROWSER_SECRET_NAMES = [
  'VITE_GEMINI_API_KEY',
  'VITE_PEXELS_API_KEY',
  'VITE_UNSPLASH_API_KEY',
];

export function validateProductionEnvironment(environment) {
  const errors = [];
  if (environment.SONFLASH_TARGET?.trim() && environment.SONFLASH_TARGET.trim() !== 'production') {
    errors.push('SONFLASH_TARGET must be production for a production release');
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

export function validateFirebaseAppCheckTargets(config) {
  const errors = [];
  const seen = new Set();
  for (const [name, target] of Object.entries(config?.targets ?? {})) {
    const siteKey = target?.appCheckSiteKey?.trim() ?? '';
    if (siteKey.length < 20 || PLACEHOLDER_PATTERN.test(siteKey)) {
      errors.push(`Firebase target ${name} requires a real App Check site key`);
    } else if (seen.has(siteKey)) {
      errors.push('Firebase target App Check site keys must be unique');
    }
    seen.add(siteKey);
  }
  if (seen.size === 0) errors.push('Firebase deployment targets are required');
  return errors;
}

export function buildReleaseMetadata({ version, revision, builtAt, target, projectId }) {
  return {
    status: 'ok',
    service: 'lingoflash',
    version,
    revision,
    builtAt,
    target,
    projectId,
  };
}

export const RELEASE_TARGETS = {
  production: { configPath: 'firebase-applet-config.json' },
  staging: { configPath: 'firebase-targets/staging.json' },
};

// The build target comes only from the process environment. Dotenv files are ignored so a
// local file cannot silently switch a production build to another Firebase project.
export function resolveReleaseTarget(environment) {
  const target = environment.SONFLASH_TARGET?.trim() || 'production';
  if (!Object.hasOwn(RELEASE_TARGETS, target)) throw new Error(`Unsupported SONFLASH_TARGET: ${target}`);
  return target;
}

export function validateDistTarget(metadata, expectedTarget, expectedProjectId) {
  const errors = [];
  if (metadata?.target !== expectedTarget) {
    errors.push(`dist was built for target ${metadata?.target ?? 'unknown'}, expected ${expectedTarget}`);
  }
  if (metadata?.projectId !== expectedProjectId) {
    errors.push(`dist was built for project ${metadata?.projectId ?? 'unknown'}, expected ${expectedProjectId}`);
  }
  return errors;
}
