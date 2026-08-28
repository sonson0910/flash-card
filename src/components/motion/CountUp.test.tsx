import { renderToStaticMarkup } from 'react-dom/server';
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
});
