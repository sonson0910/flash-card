import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Lumi, lumiPoses } from './Lumi';

describe('Lumi', () => {
  it('maps every approved pose to a local sprite', () => {
    expect(lumiPoses).toEqual(['hero', 'idle', 'happy', 'hint', 'oops', 'proud', 'chibi', 'sleepy', 'thinking', 'sad']);

    for (const pose of lumiPoses) {
      expect(renderToStaticMarkup(<Lumi pose={pose} size={48} />)).toContain(`data-lumi-pose="${pose}"`);
    }
  });

  it('is decorative and lazy by default, with an explicit eager option', () => {
    expect(renderToStaticMarkup(<Lumi pose="idle" size="3rem" />)).toContain('alt="" aria-hidden="true" loading="lazy"');
    expect(renderToStaticMarkup(<Lumi pose="hero" size={64} eager />)).toContain('loading="eager"');
  });

  it('supports meaningful image text and per-use dimensions', () => {
    const html = renderToStaticMarkup(<Lumi pose="happy" size={72} meaningful alt="A smiling study companion" />);

    expect(html).toContain('alt="A smiling study companion"');
    expect(html).not.toContain('aria-hidden');
    expect(html).toContain('width:72px;height:72px');
  });
});
