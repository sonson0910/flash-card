import firebaseAppletConfig from '../../firebase-applet-config.json';

const TRUSTED_AUDIO_HOSTS = new Set([
  'api.dictionaryapi.dev',
  'ssl.gstatic.com',
]);

const TRUSTED_IMAGE_HOSTS = new Set([
  'images.pexels.com',
  'images.unsplash.com',
  'upload.wikimedia.org',
]);

/**
 * The project's own Cloud Storage buckets (production and staging). A card
 * photo the learner uploaded is a download URL for an object in one of these,
 * never any other bucket on the storage host.
 */
export const OWN_STORAGE_BUCKETS: ReadonlySet<string> = new Set(
  Object.values(firebaseAppletConfig.targets).map(target => target.storageBucket).filter(Boolean),
);

const STORAGE_DOWNLOAD_HOST = 'firebasestorage.googleapis.com';
// `users/{uid}/files/{fileId}`, the learner file service's object name, percent-encoded as one path segment.
const OWN_FILE_DOWNLOAD_PATH = /^\/v0\/b\/([^/]+)\/o\/users%2F([A-Za-z0-9_-]{1,128})%2Ffiles%2F([A-Za-z0-9_-]{20,64})$/;
const DOWNLOAD_QUERY = /^\?alt=media&token=[A-Za-z0-9-]{16,64}$/;

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

/** A photo from one of the stock-photo providers the image search uses. */
export const isStockImageUrl = (url: string | null | undefined): url is string =>
  isTrustedHttpsUrl(url, TRUSTED_IMAGE_HOSTS);

/**
 * The uid in a download URL for a learner's own uploaded file, or null when
 * the value is anything else. Only the exact shape Cloud Storage returns is
 * accepted: HTTPS, the storage download host with no port or credentials, a
 * project bucket, an object under `users/{uid}/files/`, and `alt=media` with a
 * download token as the whole query. Firestore Rules and the card functions
 * apply the same shape and also require the uid to be the card's owner.
 */
export const ownStorageImageOwner = (url: string | null | undefined): string | null => {
  if (!url || url.length > 2_048) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== STORAGE_DOWNLOAD_HOST
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || !DOWNLOAD_QUERY.test(parsed.search)
  ) return null;
  const match = OWN_FILE_DOWNLOAD_PATH.exec(parsed.pathname);
  if (!match || !OWN_STORAGE_BUCKETS.has(match[1]!)) return null;
  // The serialized form must be the stored form, so no other spelling of the same object passes.
  if (parsed.toString() !== url) return null;
  return match[2]!;
};

/** A card image: a stock photo, or a photo the learner uploaded to their own files. */
export const isSupportedImageUrl = (url: string | null | undefined): url is string =>
  isStockImageUrl(url) || ownStorageImageOwner(url) !== null;
