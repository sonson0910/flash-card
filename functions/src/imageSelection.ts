export type PexelsPhoto = { alt?: unknown; src?: Record<string, unknown> };

const imageSearchTokens = (value: string) => value.toLocaleLowerCase('en-US')
  .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
  .split(/\s+/)
  .filter(token => token.length > 2 && !['and', 'the', 'with', 'for', 'noun', 'verb', 'adjective', 'adverb'].includes(token));

const trustedPexelsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'images.pexels.com';
  } catch {
    return false;
  }
};

export const selectRelevantPexelsImage = (photos: PexelsPhoto[], query: string): string | null => {
  const queryTokens = imageSearchTokens(query);
  const ranked = photos.map((photo, index) => {
    const descriptionTokens = new Set(imageSearchTokens(typeof photo.alt === 'string' ? photo.alt : ''));
    const score = queryTokens.reduce((total, token) => total + (descriptionTokens.has(token) ? 1 : 0), 0);
    const candidate = photo.src?.large2x ?? photo.src?.large ?? photo.src?.original;
    return { url: trustedPexelsUrl(candidate) ? candidate : null, score, index };
  }).filter((candidate): candidate is { url: string; score: number; index: number } => Boolean(candidate.url))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  if (!ranked[0]) return null;
  // Pexels already ranks by the submitted semantic query. Sparse alt text is
  // common for abstract vocabulary, so a healthy result set is a safer
  // fallback than discarding every candidate and leaving the card blank.
  return ranked[0].score > 0 || ranked.length >= 3 ? ranked[0].url : null;
};
