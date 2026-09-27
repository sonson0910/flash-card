import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveStaticJapanesePitchAccent } from '../../features/languagePacks/japanesePitch';
import { jaLanguagePack } from '../../features/languagePacks/packs/ja';
import { JapanesePitchContour, ReadingValue } from './ReadingToggle';

describe('JapanesePitchContour', () => {
  it('renders only the contour encoded by a verified accent record', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const accent = resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' });
    expect(accent).toBeDefined();

    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><JapanesePitchContour accent={accent!} /></I18nProvider>);

    expect(html).toContain('aria-label="Verified Japanese pitch contour"');
    expect(html.match(/<circle/g)).toHaveLength(4);
    expect(html).toContain('points="12,24 32,8 52,8 72,24"');
  });

  it('keeps the kana visible alongside the verified contour', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const card = { word: '日本', phonetic: 'にっぽん', japanesePitchAccent: resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' }) };
    const plan = jaLanguagePack.rendering.buildReadingPlan(card);

    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ReadingValue plan={plan} /></I18nProvider>);

    expect(html).toContain('にっぽん');
    expect(html).toContain('class="japanese-pitch-contour');
  });
});
