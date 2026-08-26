import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FloatingMobileNav } from './FloatingMobileNav';

describe('FloatingMobileNav', () => {
  it('renders navigation tabs without a dead practice button', () => {
    const html = renderToStaticMarkup(
      <FloatingMobileNav
        activeView="today"
        onSelectView={vi.fn()}
      />
    );

    expect(html).toContain('Today');
    expect(html).toContain('Library');
    expect(html).toContain('Progress');
    expect(html).toContain('data-shell-layer="mobile"');
    expect(html).toContain('data-shell-active="true"');
    expect(html).not.toContain('aria-label="Open Practice Mode"');
  });
});
