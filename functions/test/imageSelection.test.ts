import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isImageProviderUnavailable,
  selectRelevantPexelsImage,
  selectRelevantUnsplashImage,
} from '../src/imageSelection.js';

describe('server vocabulary image selection', () => {
  it('charges the aggregate budget again when Pexels has no usable result before Unsplash', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const handler = source.slice(
      source.indexOf('export const findVocabularyImage'),
      source.indexOf('export const createSharedDeck'),
    );
    const pexelsCall = handler.slice(
      handler.indexOf('const pexelsResponse'),
      handler.indexOf('if (pexelsResponse?.ok)'),
    );
    const unsplashCall = handler.slice(
      handler.indexOf('const unsplashResponse'),
      handler.indexOf('if (unsplashResponse?.ok)'),
    );
    const wikipediaCall = handler.slice(
      handler.indexOf('const wikipediaResponse'),
      handler.indexOf('if (wikipediaResponse?.ok)'),
    );

    expect(pexelsCall).toMatch(/fetchProvider[\s\S]*\}, true\);/);
    expect(unsplashCall).toMatch(/fetchProvider[\s\S]*\}, true\);/);
    expect(wikipediaCall).not.toContain('true');
  });

  it('treats every non-success provider response as unavailable', () => {
    expect(isImageProviderUnavailable({ ok: false, status: 401 })).toBe(true);
    expect(isImageProviderUnavailable({ ok: false, status: 403 })).toBe(true);
    expect(isImageProviderUnavailable({ ok: false, status: 429 })).toBe(true);
    expect(isImageProviderUnavailable({ ok: true, status: 200 })).toBe(false);
  });

  it('uses the provider-ranked fallback for an abstract word with several trusted candidates', () => {
    expect(selectRelevantPexelsImage([
      { alt: 'A person expressing confidence', src: { large2x: 'https://images.pexels.com/quite-1.jpeg' } },
      { alt: 'A thoughtful person indoors', src: { large2x: 'https://images.pexels.com/quite-2.jpeg' } },
      { alt: 'People reacting positively', src: { large2x: 'https://images.pexels.com/quite-3.jpeg' } },
    ], 'quite considerable degree intensity')).toBe('https://images.pexels.com/quite-1.jpeg');
  });

  it('still rejects an isolated unrelated or untrusted result', () => {
    expect(selectRelevantPexelsImage([
      { alt: 'A plate of pasta', src: { large2x: 'https://images.pexels.com/pasta.jpeg' } },
    ], 'serendipity happy discovery')).toBeNull();
    expect(selectRelevantPexelsImage([
      { alt: 'Quite considerable degree', src: { large2x: 'https://tracker.example/quite.jpeg' } },
    ], 'quite considerable degree')).toBeNull();
  });

  it('selects the most relevant trusted Unsplash result', () => {
    expect(selectRelevantUnsplashImage([
      { alt_description: 'A river bank with trees', urls: { regular: 'https://images.unsplash.com/river' } },
      { alt_description: 'A customer at a financial institution', urls: { regular: 'https://images.unsplash.com/finance' } },
    ], 'bank financial institution')).toBe('https://images.unsplash.com/finance');
  });

  it('uses a healthy Unsplash result set when descriptions are sparse', () => {
    expect(selectRelevantUnsplashImage([
      { alt_description: null, urls: { regular: 'https://images.unsplash.com/one' } },
      { alt_description: null, urls: { regular: 'https://images.unsplash.com/two' } },
      { alt_description: null, urls: { regular: 'https://images.unsplash.com/three' } },
    ], 'abstract vocabulary')).toBe('https://images.unsplash.com/one');
  });
});
