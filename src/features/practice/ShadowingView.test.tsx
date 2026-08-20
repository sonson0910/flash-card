import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShadowingView } from './ShadowingView';
import type { CardData } from '../../types/card';

const sampleCards: CardData[] = [
  {
    id: '1',
    word: 'resilient',
    phonetic: '/rɪˈzɪl.jənt/',
    translation: 'kiên cường',
    exampleSentence: 'She remained resilient in the face of adversity.',
    exampleTranslation: 'Cô ấy vẫn kiên cường trước mọi nghịch cảnh.',
  } as CardData,
];

describe('ShadowingView', () => {
  it('renders target word and sentence for pronunciation practice', () => {
    const html = renderToStaticMarkup(
      <ShadowingView cards={sampleCards} onClose={vi.fn()} onAddXp={vi.fn()} />
    );

    expect(html).toContain('Shadowing Arena');
    expect(html).toContain('resilient');
    expect(html).toContain('/rɪˈzɪl.jənt/');
    expect(html).toContain('adversity.');
    expect(html).toContain('Cô ấy vẫn kiên cường trước mọi nghịch cảnh.');
  });
});
