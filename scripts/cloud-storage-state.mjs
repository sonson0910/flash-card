import { pathToFileURL } from 'node:url';

// Reports whether a Firebase project has Cloud Storage set up, using the default-bucket endpoint
// the pinned Firebase CLI reads before a Storage Rules deploy. Only an answer that proves Storage
// is absent on the target project lets a release skip the Storage Rules; anything else fails
// closed. The request names the target as its user project, so a SERVICE_DISABLED answer is about
// the target project and not about the project that owns the deploy identity.
const FIREBASE_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DEFAULT_BUCKET_ORIGIN = 'https://firebasestorage.googleapis.com/v1alpha';
const FIREBASE_STORAGE_SERVICE = 'firebasestorage.googleapis.com';

const isStorageServiceDisabled = body => Array.isArray(body?.error?.details)
  && body.error.details.some(detail => detail?.reason === 'SERVICE_DISABLED'
    && detail?.metadata?.service === FIREBASE_STORAGE_SERVICE);

export function classifyDefaultBucketResponse(status, body) {
  if (status === 200) {
    const bucket = typeof body?.bucket?.name === 'string' ? body.bucket.name.split('/').pop() : '';
    if (!bucket) throw new Error('Cloud Storage default-bucket lookup returned no default bucket name.');
    return { state: 'enabled', bucket };
  }
  if (status === 404 || (status === 403 && isStorageServiceDisabled(body))) return { state: 'not-enabled' };
  throw new Error(`Cloud Storage default-bucket lookup failed with HTTP ${status}.`);
}

export async function readCloudStorageState(projectId, accessToken) {
  if (!FIREBASE_PROJECT_ID.test(projectId ?? '')) throw new Error('A valid Firebase project ID is required.');
  if (!accessToken) throw new Error('ACCESS_TOKEN is required.');
  const response = await fetch(`${DEFAULT_BUCKET_ORIGIN}/projects/${projectId}/defaultBucket`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'x-goog-user-project': projectId },
    signal: AbortSignal.timeout(30_000),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyDefaultBucketResponse(response.status, body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [flag, projectId, ...rest] = process.argv.slice(2);
  if (flag !== '--project' || rest.length > 0) {
    throw new Error('Usage: cloud-storage-state.mjs --project <firebase-project-id>');
  }
  const result = await readCloudStorageState(projectId, process.env.ACCESS_TOKEN);
  if (result.bucket) console.error(`Cloud Storage default bucket: ${result.bucket}`);
  console.log(result.state);
}
