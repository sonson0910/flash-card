import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../theme/ThemeProvider';
import SettingsScreen from './settings-screen';

i18n.load('en', {}); i18n.activate('en');

describe('SettingsScreen', () => {
  it('offers accessible appearance controls and preserves 44px targets', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ThemeProvider><SettingsScreen /></ThemeProvider></I18nProvider>);
    expect(html).toContain('Midnight Aurora');
    expect(html).toContain('Ink &amp; Paper');
    expect(html).toContain('Crystal Star');
    expect(html).toContain('Study sounds');
    expect(html).toContain('Haptics');
    expect(html).toContain('role="switch"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('min-h-11');
    for (const preview of ['classic-dark', 'classic-light', 'crystal-dark', 'crystal-light']) {
      expect(html).toContain(`data-theme-preview="${preview}"`);
    }
  });
});
