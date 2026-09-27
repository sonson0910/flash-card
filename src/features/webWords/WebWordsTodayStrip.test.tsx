import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it } from 'vitest';
import { STRIP_PREVIEW_COUNT, WebWordsTodayStripView } from './WebWordsTodayStrip';

i18n.load('en', {});
i18n.activate('en');

const render = (previewCount: number) =>
  renderToStaticMarkup(<I18nProvider i18n={i18n}><WebWordsTodayStripView previewCount={previewCount} /></I18nProvider>);

describe('WebWordsTodayStripView', () => {
  it('renders nothing when there is nothing to show, adding no layout at all', () => {
    expect(render(0)).toBe('');
  });

  it('shows an exact count below the request cap', () => {
    const html = render(3);
    expect(html).toContain('3 words saved from the web');
    expect(html).toContain('Review web words');
  });

  it('uses a singular label for exactly one word', () => {
    expect(render(1)).toContain('1 word saved from the web');
  });

  it('shows a "N+" count instead of an exact number once the bounded page is full, since a fuller count was never fetched', () => {
    const html = render(STRIP_PREVIEW_COUNT);
    expect(html).toContain(`${STRIP_PREVIEW_COUNT}+ words saved from the web`);
    expect(html).not.toContain(`${STRIP_PREVIEW_COUNT} words saved`);
  });
});
