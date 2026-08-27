import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FloatingMobileNav } from './FloatingMobileNav';

describe('FloatingMobileNav', () => {
  it('keeps every primary destination available below the desktop breakpoint', () => {
    const html = renderToStaticMarkup(
      <FloatingMobileNav
        activeView="today"
        onSelectView={vi.fn()}
      />
    );

    expect(html).toContain('Today');
    expect(html).toContain('Paths');
    expect(html).toContain('Library');
    expect(html).toContain('Progress');
    expect(html).toContain('data-shell-layer="mobile"');
    expect(html).toContain('data-shell-grammar="cold-mineral"');
    expect(html).toContain('data-shell-identity="memory-atelier"');
    expect(html).toContain('app-mobile-nav');
    expect(html).toContain('data-shell-active="true"');
    expect(html).toContain('env(safe-area-inset-bottom)');
    expect(html).toContain('lg:hidden');
    expect(html).not.toContain('>Home<');
    expect(html).not.toContain('aria-label="Open Practice Mode"');
  });
});
