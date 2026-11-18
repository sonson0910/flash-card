import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HangulBreakdown } from './HangulBreakdown';

describe('HangulBreakdown', () => {
  it('renders a labelled, responsive Korean syllable panel only when Hangul exists', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const render = (word: string) => renderToStaticMarkup(<I18nProvider i18n={i18n}><HangulBreakdown word={word} /></I18nProvider>);
    const markup = render('결심하다');

    expect(markup).toContain('data-hangul-breakdown');
    expect(markup).toContain('aria-labelledby="hangul-breakdown-title"');
    expect(markup).toContain('Hangul breakdown');
    expect(markup).toContain('hangul-breakdown__grid');
    expect(markup).toContain('>결<');
    expect(markup).toContain('>ㄱ<');
    expect(markup).toContain('>yeo<');
    expect(render('hello')).toBe('');
  });
});
