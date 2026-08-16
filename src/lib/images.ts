import { withTimeout } from './async';
import { app, auth } from './firebase';
import { isSupportedImageUrl } from './mediaUrlPolicy';

export { isSupportedImageUrl } from './mediaUrlPolicy';

export interface VocabularyImageContext {
  word: string;
  searchQuery?: string;
  category?: string;
  partOfSpeech?: string;
  explanation?: string;
}

export interface PexelsPhotoCandidate {
  alt?: unknown;
  src?: Record<string, unknown>;
}

const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'that', 'this', 'something', 'someone',
  'noun', 'verb', 'adjective', 'adverb', 'phrase', 'word',
]);

const cleanSearchText = (value: unknown, maximum: number) => typeof value === 'string'
  ? value.replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
  : '';

const semanticTokens = (value: string) => cleanSearchText(value, 200)
  .toLocaleLowerCase('en-US')
  .split(/\s+/)
  .filter(token => token.length > 2 && !SEARCH_STOP_WORDS.has(token));

export function buildVocabularyImageQuery(context: VocabularyImageContext): string {
  const word = cleanSearchText(context.word, 80);
  const meaning = cleanSearchText(context.searchQuery, 120);
  const explanation = semanticTokens(cleanSearchText(context.explanation, 240)).slice(0, 6).join(' ');
  const fallback = explanation || cleanSearchText(context.category, 40) || cleanSearchText(context.partOfSpeech, 24);
  const terms = [word, meaning || fallback].filter(Boolean).join(' ');
  return [...new Set(terms.split(/\s+/))].join(' ').slice(0, 160);
}

const candidateScore = (description: unknown, query: string) => {
  if (typeof description !== 'string') return 0;
  const descriptionTokens = new Set(semanticTokens(description));
  return semanticTokens(query).reduce((score, token) => score + (descriptionTokens.has(token) ? 1 : 0), 0);
};

const pexelsPhotoUrl = (photo: PexelsPhotoCandidate): string | null => {
  const value = photo.src?.large2x ?? photo.src?.large ?? photo.src?.original;
  return typeof value === 'string' && isSupportedImageUrl(value) ? value : null;
};

export function selectBestPexelsImage(photos: PexelsPhotoCandidate[], query: string): string | null {
  const ranked = photos
    .map((photo, index) => ({ url: pexelsPhotoUrl(photo), score: candidateScore(photo.alt, query), index }))
    .filter((candidate): candidate is { url: string; score: number; index: number } => Boolean(candidate.url))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (!ranked[0]) return null;
  return ranked[0].score > 0 || ranked.length >= 3 ? ranked[0].url : null;
}

export function matchesCurrentImageOwner(
  sourceOwnerKey: string | null,
  activeOwnerKey: string | null,
): boolean {
  return sourceOwnerKey === activeOwnerKey;
}

export function matchesCurrentCardImage(
  card: { id: string; imageUrl?: string | null } | null | undefined,
  cardId: string,
  imageUrl: string,
): boolean {
  return Boolean(card && card.id === cardId && card.imageUrl === imageUrl);
}

export function getDisplayImageUrl(url: string): string {
  if (!isSupportedImageUrl(url)) return url;
  const parsed = new URL(url);
  if (parsed.hostname === 'images.pexels.com') {
    parsed.searchParams.set('auto', 'compress');
    parsed.searchParams.set('cs', 'tinysrgb');
    parsed.searchParams.delete('h');
    parsed.searchParams.set('w', '1200');
    parsed.searchParams.set('dpr', '2');
    return parsed.toString();
  }
  if (parsed.hostname === 'images.unsplash.com') {
    parsed.searchParams.set('auto', 'format');
    parsed.searchParams.set('fit', 'crop');
    parsed.searchParams.set('w', '1200');
    parsed.searchParams.set('q', '85');
    return parsed.toString();
  }
  return url;
}

export async function fetchImageUrl(input: string | VocabularyImageContext): Promise<string | null> {
  const context = typeof input === 'string' ? { word: input } : input;
  const word = cleanSearchText(context.word, 80);
  const searchQuery = buildVocabularyImageQuery(context);
  if (!word || !searchQuery) return null;
  const fetchWithTimeout = async (url: string, init: RequestInit = {}) => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), 4000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    if (!import.meta.env.DEV) {
      try {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        if (!app || !auth?.currentUser) throw new Error('Sign in to search for images.');
        const functions = getFunctions(app, 'asia-southeast1');
        const callable = httpsCallable<{ word: string; query: string }, { imageUrl: string | null }>(functions, 'findVocabularyImage');
        const response = await withTimeout(
          callable({ word, query: searchQuery }),
          7_000,
          'Image search did not respond in time.',
        );
        return isSupportedImageUrl(response.data.imageUrl) ? response.data.imageUrl : null;
      } catch (error) {
        console.warn('Secure image search unavailable; trying Wikipedia.', error);
      }
    }

    const pexelsKey = import.meta.env.DEV ? import.meta.env.VITE_PEXELS_API_KEY : '';
    const unsplashKey = import.meta.env.DEV ? import.meta.env.VITE_UNSPLASH_API_KEY : '';

    if (import.meta.env.DEV && pexelsKey) {
      try {
        const response = await fetchWithTimeout(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=8&orientation=landscape`,
          { headers: { Authorization: pexelsKey } },
        );
        if (response.ok) {
          const data = await response.json() as { photos?: PexelsPhotoCandidate[] };
          const url = selectBestPexelsImage(Array.isArray(data.photos) ? data.photos : [], searchQuery);
          if (url) return url;
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Pexels image fetch failed', error);
        }
      }
    }

    if (import.meta.env.DEV && unsplashKey) {
      try {
        const response = await fetchWithTimeout(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=8&orientation=landscape&client_id=${unsplashKey}`,
        );
        if (response.ok) {
          const data = await response.json() as { results?: Array<{ alt_description?: unknown; description?: unknown; urls?: Record<string, unknown> }> };
          const ranked = (Array.isArray(data.results) ? data.results : [])
            .map((result, index) => ({
              url: result.urls?.regular ?? result.urls?.full ?? result.urls?.small,
              score: candidateScore(result.alt_description ?? result.description, searchQuery),
              index,
            }))
            .filter((candidate): candidate is { url: string; score: number; index: number } =>
              typeof candidate.url === 'string' && isSupportedImageUrl(candidate.url))
            .sort((left, right) => right.score - left.score || left.index - right.index);
          if (ranked[0]?.score > 0) return ranked[0].url;
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Unsplash image fetch failed', error);
        }
      }
    }

    try {
      const response = await fetchWithTimeout(
        `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=1200&titles=${encodeURIComponent(word)}&origin=*`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      const pages = data.query?.pages;
      const firstPage = pages ? pages[Object.keys(pages)[0]] : null;
      const url = firstPage?.thumbnail?.source;
      return isSupportedImageUrl(url) ? url : null;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Wikipedia image fetch failed', error);
      }
      return null;
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      console.warn('Pexels image fetch failed', error);
    }
    return null;
  }
}
