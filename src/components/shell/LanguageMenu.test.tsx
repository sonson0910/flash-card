import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LanguageMenu } from './LanguageMenu';

i18n.load('en', { 'shell.language.open': 'Choose language' });
i18n.activate('en');

describe('LanguageMenu', () => {
  it('keeps its 44px trigger present on narrow viewports', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><LanguageMenu /></I18nProvider>);
    expect(html).toContain('size-11');
    expect(html).not.toContain('hidden sm:block');
    expect(html).toContain('aria-label="Choose language"');
  });
});
