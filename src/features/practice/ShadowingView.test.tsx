import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShadowingView } from './ShadowingView';
import type { CardData } from '../../types/card';

const sampleCards: CardData[] = [
  {
    id: '1',
    language: 'en',
    translationLanguage: 'vi',
    word: 'resilient',
    phonetic: '/rɪˈzɪl.jənt/',
    translation: 'kiên cường',
    exampleSentence: 'She remained resilient in the face of adversity.',
    exampleTranslation: 'Cô ấy vẫn kiên cường trước mọi nghịch cảnh.',
  } as CardData,
];

describe('ShadowingView', () => {
  i18n.load('en', {});
  i18n.activate('en');

  it('renders target word and sentence for pronunciation practice', () => {
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}><ShadowingView cards={sampleCards} onClose={vi.fn()} onAddXp={vi.fn()} /></I18nProvider>
    );

    expect(html).toContain('Shadowing');
    expect(html).toContain('resilient');
    expect(html).toContain('/rɪˈzɪl.jənt/');
    expect(html).toContain('adversity.');
    expect(html).toContain('Cô ấy vẫn kiên cường trước mọi nghịch cảnh.');
    expect(html).toContain('lang="en"');
    expect(html).toContain('lang="vi"');
  });
});
