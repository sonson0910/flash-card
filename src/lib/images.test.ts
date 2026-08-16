import { describe, expect, it } from 'vitest';
import {
  buildVocabularyImageQuery,
  getDisplayImageUrl,
  isSupportedImageUrl,
  matchesCurrentCardImage,
  matchesCurrentImageOwner,
  selectBestPexelsImage,
} from './images';

describe('semantic vocabulary image search', () => {
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
});

describe('runtime image recovery', () => {
  it('rejects a stale image callback after the active owner changes', () => {
    expect(matchesCurrentImageOwner('owner-a', 'owner-a')).toBe(true);
    expect(matchesCurrentImageOwner('owner-a', 'owner-b')).toBe(false);
    expect(matchesCurrentImageOwner(null, 'owner-b')).toBe(false);
  });

  it('clears only the exact image that reported a load failure', () => {
    const card = {
      id: 'card-bank',
      imageUrl: 'https://images.pexels.com/broken.jpeg',
    };

    expect(matchesCurrentCardImage(
      card,
      card.id,
      'https://images.pexels.com/broken.jpeg',
    )).toBe(true);
    expect(matchesCurrentCardImage(
      { ...card, imageUrl: 'https://images.pexels.com/replacement.jpeg' },
      card.id,
      'https://images.pexels.com/broken.jpeg',
    )).toBe(false);
    expect(matchesCurrentCardImage(card, 'another-card', card.imageUrl)).toBe(false);
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
