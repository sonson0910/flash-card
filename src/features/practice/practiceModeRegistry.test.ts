import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { getPracticeModes, languageDrillEligibleCardCount } from './practiceModeRegistry';

const card = (language?: string): CardData => ({
  id: language ?? 'legacy', language, word: 'word', translation: 'meaning', explanation: '', phonetic: '', emoji: '', category: '', audioUrl: null, imageUrl: null,
});

describe('language drill practice mode', () => {
  it('is selectable only when the current library has a wave-one language card', () => {
    const drill = getPracticeModes().find(mode => mode.id === 'language-drill');
    expect(drill).toBeDefined();
    expect(languageDrillEligibleCardCount([card('ko'), card('de')])).toBe(1);
    expect(drill?.isAvailable([card('de')], { visibleLibraryCount: 1 })).toBe(false);
    expect(drill?.isAvailable([card('zh-Hans')], { visibleLibraryCount: 1 })).toBe(true);
  });
});
