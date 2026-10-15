import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { FloatingMobileNav } from './FloatingMobileNav';

const themeState = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));

vi.mock('../../features/theme/ThemeProvider', () => ({
  useTheme: () => ({ family: themeState.family }),
}));

i18n.load('en', { 'shell.nav.today': 'Today', 'shell.nav.paths': 'Paths', 'shell.nav.words': 'Words', 'shell.nav.vocabulary': 'Vocabulary', 'shell.nav.progress': 'Progress' });
i18n.activate('en');

describe('FloatingMobileNav', () => {
  it('renders the full-width four-tab shell rail without a dead practice button', () => {
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
    expect(html).toContain('claude-mobile-nav');
    expect(html).not.toContain('premium-surface');
    expect(html).toContain('lg:hidden');
    expect(html).not.toContain('md:hidden');
    expect(html).toContain('data-shell-active="true"');
    expect(html).not.toContain('>Home</span>');
  });

  it('uses the Canvas Words label only for the Crystal library tab', () => {
    themeState.family = 'crystal';
    const crystal = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <FloatingMobileNav activeView="library" onSelectView={vi.fn()} />
    </I18nProvider>);
    themeState.family = 'classic';
    const classic = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <FloatingMobileNav activeView="library" onSelectView={vi.fn()} />
    </I18nProvider>);

    expect(crystal).toContain('>Collection</span>');
    expect(crystal).not.toContain('>Words</span>');
    expect(crystal).not.toContain('>Vocabulary</span>');
    expect(classic).toContain('>Vocabulary</span>');
    expect(classic).not.toContain('>Words</span>');
  });

  it('keeps progress as the real route while crystal Friends navigation is pending', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <FloatingMobileNav activeView="progress" onSelectView={vi.fn()} />
    </I18nProvider>);

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Progress');
    expect(html).not.toContain('Friends');
  });
});
