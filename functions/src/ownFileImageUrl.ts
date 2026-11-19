/**
 * A photo the learner uploaded is a Cloud Storage download URL for an object
 * under `users/{uid}/files/` in one of the project's buckets (the production
 * and staging targets of firebase-applet-config.json). The client media
 * policy and the Firestore Rules accept exactly this shape too.
 */
export const OWN_STORAGE_BUCKETS: ReadonlySet<string> = new Set([
  'encoded-hangout-433912-h2.firebasestorage.app',
  'sonflash-staging-20260906.firebasestorage.app',
]);

const OWN_FILE_DOWNLOAD_PATH = /^\/v0\/b\/([^/]+)\/o\/users%2F([A-Za-z0-9_-]{1,128})%2Ffiles%2F([A-Za-z0-9_-]{20,64})$/;
const OWN_FILE_DOWNLOAD_QUERY = /^\?alt=media&token=[A-Za-z0-9-]{16,64}$/;

/**
 * The uid named by an own-file download URL, or null for any other value:
 * HTTPS, the storage download host with no port, credentials or fragment, a
 * project bucket, an object under `users/{uid}/files/`, `alt=media` with a
 * download token as the whole query, and no other spelling of the same URL.
 */
export const ownStorageImageOwner = (text: string): string | null => {
  if (text.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'firebasestorage.googleapis.com'
    || url.port
    || url.username
    || url.password
    || url.hash
    || !OWN_FILE_DOWNLOAD_QUERY.test(url.search)
    || url.toString() !== text
  ) return null;
  const match = OWN_FILE_DOWNLOAD_PATH.exec(url.pathname);
  return match && OWN_STORAGE_BUCKETS.has(match[1]!) ? match[2]! : null;
};
