import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WordContextVideo, contextForWord } from './WordContextVideo';

describe('reviewed word context excerpts', () => {
  it('reuses reviewed transcript timing rather than guessing new offsets', () => {
    expect(contextForWord('work')).toMatchObject({ startMs: 14_000, endMs: 20_000 });
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
