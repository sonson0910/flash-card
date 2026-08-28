import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CountUp } from './CountUp';

describe('CountUp', () => {
  it('keeps the final value readable while marking only the visual number as animated', () => {
    const html = renderToStaticMarkup(<CountUp to={1_250} suffix=" reviewed" />);

    expect(html).toContain('data-count-up="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('1,250');
    expect(html).toContain('<span class="sr-only">1,250 reviewed</span>');
  });

  it('continues an interrupted count from the last painted value', () => {
    const source = readFileSync(new URL('./CountUp.tsx', import.meta.url), 'utf8');

    expect(source).toContain('previousValueRef.current = counter.value');
    expect(source).not.toContain('previousValueRef.current = to;\n    return () => { tween.kill(); };');
  });
});
