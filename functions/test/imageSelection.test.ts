import { describe, expect, it } from 'vitest';
import { selectRelevantPexelsImage } from '../src/imageSelection.js';

describe('server vocabulary image selection', () => {
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
});
