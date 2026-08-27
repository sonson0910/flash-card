import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpotlightCard } from './SpotlightCard';

describe('SpotlightCard', () => {
  it('keeps the React Bits spotlight decorative and content accessible', () => {
    const html = renderToStaticMarkup(
      <SpotlightCard className="daily-focus" spotlightColor="rgba(8, 145, 178, 0.18)">
        <h2>Daily focus</h2>
      </SpotlightCard>,
    );

    expect(html).toContain('data-react-bits="spotlight-card"');
    expect(html).toContain('daily-focus');
    expect(html).toContain('<h2>Daily focus</h2>');
    expect(html).toContain('aria-hidden="true"');
  });
});
