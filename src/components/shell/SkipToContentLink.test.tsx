import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it } from 'vitest';
import { LEARNING_WORKSPACE_ID, SkipToContentLink } from './SkipToContentLink';

describe('SkipToContentLink', () => {
  it('stays out of sight until focused and targets the learning workspace', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><SkipToContentLink /></I18nProvider>);

    expect(html).toContain(`href="#${LEARNING_WORKSPACE_ID}"`);
    expect(html).toContain('sr-only focus:not-sr-only');
    expect(html).toContain('focus:fixed');
    expect(html).toContain('Skip to content');
  });
});
