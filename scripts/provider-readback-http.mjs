export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const SITE_ID = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
export const DATABASE_ID = /^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
export const REGION = /^[a-z][a-z0-9-]{0,62}$/;
export const FUNCTION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
export const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const SHA256 = /^[a-f0-9]{64}$/;

const MAX_RESPONSE_BYTES = 512 * 1024;
const ALLOWED_HOSTS = new Set([
  'cloudfunctions.googleapis.com',
  'firebasehosting.googleapis.com',
  'firebaserules.googleapis.com',
  'run.googleapis.com',
]);
const LABELS = Object.freeze({
  schema: 'sonflash-provenance',
  revisionFirst: 'sonflash-revision-1',
  revisionSecond: 'sonflash-revision-2',
  candidateFirst: 'sonflash-candidate-1',
  candidateSecond: 'sonflash-candidate-2',
});

export const requirePattern = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
};

export const requireAccessToken = accessToken => {
  if (typeof accessToken !== 'string' || accessToken.length < 16 || accessToken.length > 16_384) {
    throw new Error('Google OAuth access token is invalid.');
  }
};

export const exactLabelMatch = (labels, revision, candidateSha256) => Boolean(labels)
  && labels[LABELS.schema] === 'v1'
  && labels[LABELS.revisionFirst] === revision.slice(0, 32)
  && labels[LABELS.revisionSecond] === revision.slice(32)
  && labels[LABELS.candidateFirst] === candidateSha256.slice(0, 32)
  && labels[LABELS.candidateSecond] === candidateSha256.slice(32);

const cancelQuietly = async body => {
  try {
    await body?.cancel();
  } catch {
    // Provider transport failures must never surface raw network details.
  }
};

const readBoundedResponse = async (response, label) => {
  if (!response || !response.ok) {
    await cancelQuietly(response?.body);
    throw new Error(`${label} could not be read.`);
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await cancelQuietly(response.body);
    throw new Error(`${label} exceeded the response limit.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label} returned an empty response.`);
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await cancelQuietly(reader);
        throw new Error(`${label} exceeded the response limit.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await cancelQuietly(reader);
    if (error instanceof Error && error.message === `${label} exceeded the response limit.`) {
      throw error;
    }
    throw new Error(`${label} could not be read.`);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
};

export const createProviderReader = (accessToken, fetchImpl) => async (
  url,
  label,
  authenticated = true,
) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} endpoint is invalid.`);
  }
  const isHealth = parsed.hostname.endsWith('.web.app') && parsed.pathname === '/health.json';
  if (parsed.protocol !== 'https:' || (!ALLOWED_HOSTS.has(parsed.hostname) && !isHealth)) {
    throw new Error(`${label} endpoint is invalid.`);
  }
  let response;
  try {
    response = await fetchImpl(parsed, {
      method: 'GET',
      redirect: 'error',
      headers: authenticated ? { Authorization: `Bearer ${accessToken}` } : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`${label} could not be read.`);
  }
  return readBoundedResponse(response, label);
};
