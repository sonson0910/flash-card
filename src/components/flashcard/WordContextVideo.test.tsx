import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WordContextVideo, contextForWord } from './WordContextVideo';

describe('reviewed word context excerpts', () => {
  it('uses source-verified video windows rather than the audio cue offsets', () => {
    expect(contextForWord('news')).toMatchObject({ startMs: 6_000, endMs: 11_400 });
    expect(contextForWord('work')).toMatchObject({ startMs: 15_600, endMs: 21_600 });
    expect(contextForWord('travel')).toMatchObject({ startMs: 21_600, endMs: 27_600 });
    expect(contextForWord('work')).toBe(contextForWord('work'));
    expect(contextForWord('work')?.text).toContain('work');
    expect(contextForWord('__proto__')).toBeUndefined();
    expect(contextForWord('unknown')).toBeUndefined();
    for (const word of ['news', 'information', 'new', 'ready', 'work', 'trip', 'travel', 'shirt', 'sunglasses', 'guidebook']) {
      const cue = contextForWord(word)!;
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
      expect(cue.text.toLowerCase()).toContain(word);
    }
  });
  it('does not load video until chosen and always provides the source and transcript', () => {
    const html = renderToStaticMarkup(<WordContextVideo word="work" />);
    expect(html).not.toContain('<video');
    expect(html).toContain('Load context clip');
    expect(html).toContain('Voice of America');
    expect(html).toContain('<mark>work</mark>');
  });
});
