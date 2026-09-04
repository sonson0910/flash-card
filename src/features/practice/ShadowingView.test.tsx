import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  it('renders the target word and sentence for speech matching', () => {
    const html = renderToStaticMarkup(
      <ShadowingView cards={sampleCards} onClose={vi.fn()} onAddXp={vi.fn()} />
    );

    expect(html).toContain('Shadowing Arena');
    expect(html).toContain('resilient');
    expect(html).toContain('/rɪˈzɪl.jənt/');
    expect(html).toContain('adversity.');
    expect(html).toContain('Cô ấy vẫn kiên cường trước mọi nghịch cảnh.');
    expect(html).toContain('checks whether the intended words were recognised');
    expect(html).toContain('does not assess individual sounds, phonemes, or accent');
    expect(html).toContain('Pronunciation assessment is unavailable in this build');
    expect(html).toContain('browser transcript matching remains available');

    const source = readFileSync(fileURLToPath(new URL('./ShadowingView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Sentence match: {matchResult.score}%');
    expect(source).toContain('Excellent speech match!');
    expect(source).not.toContain('Native-like Pronunciation');
  });
});
