import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { TextConversationPanel } from './TextConversationPanel';

const cards: CardData[] = [
  { id: '1', word: 'menu', translation: 'thực đơn', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
  { id: '2', word: 'coffee', translation: 'cà phê', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
];

describe('TextConversationPanel', () => {
  it('renders a bounded, accessible text mission without speech controls', () => {
    const html = renderToStaticMarkup(<TextConversationPanel cards={cards} onBack={() => undefined} onClose={() => undefined} />);

    expect(html).toContain('Text practice mission');
    expect(html).toContain('Mission vocabulary');
    expect(html).toContain('Write your reply');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('0/6 turns');
    expect(html).toContain('Close text practice');
    expect(html).not.toContain('microphone');
    expect(html).not.toContain('pronunciation');
  });

  it('renders the session mission snapshot when library cards change', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./TextConversationPanel.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).toContain('const activeMission = session.mission;');
    expect(source).toMatch(/activeMission\.cards\.map/);
  });
});
