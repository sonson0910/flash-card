import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { FloatingMobileNav } from './FloatingMobileNav';

i18n.load('en', { 'shell.nav.today': 'Today', 'shell.nav.paths': 'Paths', 'shell.nav.vocabulary': 'Vocabulary', 'shell.nav.progress': 'Progress' });
i18n.activate('en');

describe('FloatingMobileNav', () => {
  it('renders navigation tabs without a dead practice button', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <FloatingMobileNav
        activeView="today"
        onSelectView={vi.fn()}
      />
    </I18nProvider>);

    expect(html).toContain('Today');
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
    expect(html).toContain('>Vocabulary</span>');
    expect(html).not.toContain('>Library</span>');
    expect(html).toContain('Paths');
    expect(html).toContain('data-shell-layer="mobile"');
    expect(html).toContain('premium-surface');
    expect(html).toContain('lg:hidden');
    expect(html).not.toContain('md:hidden');
    expect(html).toContain('data-shell-active="true"');
    expect(html).not.toContain('>Home</span>');
  });
});
