import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../features/theme/ThemeProvider';
import { nextThemeMode, ThemeMenu } from './ThemeMenu';

i18n.load('en', { 'shell.theme.quick-toggle': 'Switch light and dark mode', 'shell.theme.open': 'Choose theme' });
i18n.activate('en');

describe('ThemeMenu', () => {
  it('flips only the mode within the selected family', () => {
    expect(nextThemeMode('dark')).toBe('light');
    expect(nextThemeMode('light')).toBe('dark');
  });

  it('gives both theme controls a 44px target', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ThemeProvider><ThemeMenu /></ThemeProvider></I18nProvider>);
    expect(html.match(/size-11/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Switch light and dark mode"');
    expect(html).toContain('aria-label="Choose theme"');
  });
});
