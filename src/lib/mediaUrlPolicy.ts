const TRUSTED_AUDIO_HOSTS = new Set([
  'api.dictionaryapi.dev',
  'ssl.gstatic.com',
]);

const TRUSTED_IMAGE_HOSTS = new Set([
  'images.pexels.com',
  'images.unsplash.com',
  'upload.wikimedia.org',
]);

const isTrustedHttpsUrl = (
  value: string | null | undefined,
  trustedHosts: ReadonlySet<string>,
): value is string => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && trustedHosts.has(parsed.hostname);
  } catch {
    return false;
  }
};

export const isSupportedAudioUrl = (url: string | null | undefined): url is string =>
  isTrustedHttpsUrl(url, TRUSTED_AUDIO_HOSTS);

export const isSupportedImageUrl = (url: string | null | undefined): url is string =>
  isTrustedHttpsUrl(url, TRUSTED_IMAGE_HOSTS);
