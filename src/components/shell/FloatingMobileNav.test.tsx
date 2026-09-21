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
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
    expect(html).toContain('>Vocabulary</span>');
    expect(html).not.toContain('>Library</span>');
    expect(html).toContain('aria-label="Today"');
    expect(html).toContain('aria-label="Vocabulary"');
    expect(html).toContain('aria-label="Progress"');
    expect(html).toContain('data-shell-layer="mobile"');
    expect(html).toContain('premium-surface');
    expect(html).toContain('lg:hidden');
    expect(html).not.toContain('md:hidden');
    expect(html).toContain('data-shell-active="true"');
    expect(html).not.toContain('aria-label="Open Practice Mode"');
  });
});
