import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FloatingMobileNav } from './FloatingMobileNav';

const indexCssSource = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');

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
    expect(html).toContain('mobile-nav-dock');
    expect(html).toContain('data-shell-active="true"');
    expect(html).not.toContain('aria-label="Open Practice Mode"');
  });

  it('separates the dock from the canvas with a raised surface and edge', () => {
    expect(indexCssSource).toMatch(/\.mobile-nav-dock\s*\{[^}]*background:\s*linear-gradient/s);
    expect(indexCssSource).toMatch(/\.mobile-nav-dock\s*\{[^}]*box-shadow:/s);
  });
});
