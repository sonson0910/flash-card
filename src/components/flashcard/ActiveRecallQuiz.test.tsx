import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { ActiveRecallQuiz } from './ActiveRecallQuiz';

vi.mock('@lingui/react', () => ({ Trans: ({ message }: { message: string }) => message }));
vi.mock('../../lib/interactionSounds', () => ({ playRewardSound: vi.fn() }));
vi.mock('../../lib/haptics', () => ({ triggerHaptic: vi.fn() }));

const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/;
const labels = (card: Partial<CardData>) =>
  [...renderToStaticMarkup(<ActiveRecallQuiz card={card as CardData} onRevealMeaning={() => undefined} />)
    .matchAll(/<span lang="[a-z]+"[^>]*>([^<]*)<\/span>/g)].map(match => match[1]);

describe('ActiveRecallQuiz options', () => {
  it('offers distractors in the card translation language, not Vietnamese', () => {
    const options = labels({ id: 'c1', word: '幸運', translation: 'good luck', translationLanguage: 'en', language: 'ja' });
    expect(options).toHaveLength(3);
    expect(options).toContain('good luck');
    expect(options.some(label => VIETNAMESE.test(label ?? ''))).toBe(false);
  });

  it('keeps Vietnamese distractors for a Vietnamese translation', () => {
    expect(labels({ id: 'c2', word: 'luck', translation: 'may mắn', translationLanguage: 'vi', language: 'en' })).toHaveLength(3);
  });

  it('shows no quiz when the translation language has no distractors', () => {
    expect(labels({ id: 'c3', word: 'luck', translation: 'Glück', translationLanguage: 'de', language: 'en' })).toHaveLength(0);
  });
});
