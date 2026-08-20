import { describe, expect, it, vi } from 'vitest';
import {
  buildVocabularyImageQuery,
  classifyImageSearchResponse,
  fetchImageUrl,
  getDisplayImageUrl,
  ImageSearchTransientError,
  isRetryableImageSearchError,
  isSupportedImageUrl,
  selectBestPexelsImage,
  selectBestUnsplashImage,
} from './images';

describe('semantic vocabulary image search', () => {
  it('keeps legacy callable responses retryable when status is absent', () => {
    expect(classifyImageSearchResponse({ imageUrl: null })).toBe('transient');
    expect(classifyImageSearchResponse({ imageUrl: null, status: 'no-result' })).toBe('no-result');
    expect(classifyImageSearchResponse({ imageUrl: 'https://images.pexels.com/photo.jpeg' })).toBe('success');
  });

  it('identifies transient search failures for the hydration retry path', () => {
    expect(isRetryableImageSearchError(new ImageSearchTransientError())).toBe(true);
    expect(isRetryableImageSearchError(new Error('provider unavailable'))).toBe(false);
  });

  it('disambiguates the headword with the visual meaning selected by the dictionary model', () => {
    expect(buildVocabularyImageQuery({
      word: 'bank',
      searchQuery: 'money financial institution building',
      category: 'Finance',
      partOfSpeech: 'noun',
    })).toBe('bank money financial institution building');
  });

  it('chooses the candidate whose description matches the intended meaning', () => {
    const image = selectBestPexelsImage([
      { alt: 'A river bank with trees', src: { large2x: 'https://images.pexels.com/river.jpeg' } },
      { alt: 'Customer withdrawing money inside a financial institution', src: { large2x: 'https://images.pexels.com/finance.jpeg' } },
    ], 'bank money financial institution building');

    expect(image).toBe('https://images.pexels.com/finance.jpeg');
  });

  it('uses the saved definition to repair images on older cards', () => {
    expect(buildVocabularyImageQuery({
      word: 'bank',
      explanation: 'A financial institution that accepts money deposits.',
      category: 'Finance',
    })).toBe('bank financial institution accepts money deposits');
  });

  it('rejects unrelated stock results so the card can use its icon instead', () => {
    expect(selectBestPexelsImage([
      { alt: 'A plate of pasta on a table', src: { large2x: 'https://images.pexels.com/pasta.jpeg' } },
    ], 'serendipity unexpected happy discovery')).toBeNull();
  });

  it('uses provider ranking for abstract words when several safe results have sparse alt text', () => {
    expect(selectBestPexelsImage([
      { alt: 'A person expressing confidence', src: { large2x: 'https://images.pexels.com/quite-1.jpeg' } },
      { alt: 'A thoughtful person indoors', src: { large2x: 'https://images.pexels.com/quite-2.jpeg' } },
      { alt: 'People reacting positively', src: { large2x: 'https://images.pexels.com/quite-3.jpeg' } },
    ], 'quite considerable degree intensity')).toBe('https://images.pexels.com/quite-1.jpeg');
  });

  it('falls back to a relevant Unsplash candidate when Pexels is unavailable', () => {
    expect(selectBestUnsplashImage([
      { alt_description: 'A river bank with trees', urls: { regular: 'https://images.unsplash.com/river' } },
      { alt_description: 'A customer at a financial institution', urls: { regular: 'https://images.unsplash.com/finance' } },
    ], 'bank financial institution')).toBe('https://images.unsplash.com/finance');
  });

  it('accepts provider-ranked Unsplash results with sparse descriptions', () => {
    expect(selectBestUnsplashImage([
      { urls: { regular: 'https://images.unsplash.com/one' } },
      { urls: { regular: 'https://images.unsplash.com/two' } },
      { urls: { regular: 'https://images.unsplash.com/three' } },
    ], 'abstract vocabulary')).toBe('https://images.unsplash.com/one');
  });

  it('treats unauthorized development provider responses as transient', async () => {
    vi.stubEnv('VITE_PEXELS_API_KEY', 'invalid-key');
    vi.stubEnv('VITE_UNSPLASH_API_KEY', '');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ query: { pages: { '1': {} } } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(fetchImageUrl({ word: 'bank' })).rejects.toBeInstanceOf(ImageSearchTransientError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe('isSupportedImageUrl', () => {
  it('accepts HTTPS images served by configured providers', () => {
    expect(isSupportedImageUrl('https://images.pexels.com/photos/123/example.jpeg')).toBe(true);
    expect(isSupportedImageUrl('https://images.unsplash.com/photo-123')).toBe(true);
    expect(isSupportedImageUrl('https://upload.wikimedia.org/example.jpg')).toBe(true);
  });

  it('rejects unsupported, insecure, and invalid image URLs', () => {
    expect(isSupportedImageUrl('https://example.com/tracker.jpg')).toBe(false);
    expect(isSupportedImageUrl('http://images.pexels.com/example.jpg')).toBe(false);
    expect(isSupportedImageUrl('not-a-url')).toBe(false);
    expect(isSupportedImageUrl(null)).toBe(false);
  });

  it('upgrades trusted provider URLs for sharper display', () => {
    const pexels = getDisplayImageUrl('https://images.pexels.com/photos/123/example.jpeg?auto=compress&cs=tinysrgb&h=350');
    expect(pexels).toContain('w=1200');
    expect(pexels).toContain('dpr=2');
    expect(pexels).not.toContain('h=350');

    const unsplash = getDisplayImageUrl('https://images.unsplash.com/photo-123?w=400&q=60');
    expect(unsplash).toContain('w=1200');
    expect(unsplash).toContain('q=85');
  });
});
