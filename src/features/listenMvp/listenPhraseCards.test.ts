import { describe, expect, it } from 'vitest';
import {
  LISTEN_PHRASE_CARDS,
  listenPhraseCardToLibraryCard,
} from './listenPhraseCards';

describe('listen phrase cards', () => {
  it('provides the three editorial phrases with canonical identities and bilingual examples', () => {
    expect(LISTEN_PHRASE_CARDS.map(card => ({ id: card.id, lemma: card.lemma }))).toEqual([
      {
        id: 'lexeme-5b22656e222c22627265616b20746865206e657773222c22706872617365222c22627265616b2d7468652d6e65-d146b943fa604420dac43b0a',
        lemma: 'break the news',
      },
      {
        id: 'lexeme-5b22656e222c226f6e207468652062616c6c222c22706872617365222c226f6e2d7468652d62616c6c225d-20c7740a169a1c6d10033429',
        lemma: 'on the ball',
      },
      {
        id: 'lexeme-5b22656e222c226661697220616e6420737175617265222c22706872617365222c22666169722d616e642d7371-badc00e3cc7c73fed8ce474d',
        lemma: 'fair and square',
      },
    ]);
    for (const card of LISTEN_PHRASE_CARDS) {
      expect(card).toMatchObject({
        language: 'en',
        meaningLanguage: 'en',
        translationLanguage: 'vi',
        partOfSpeech: 'idiom',
        skills: ['listening'],
        provenance: {
          sourceLabel: expect.any(String),
          licenseLabel: expect.any(String),
          reviewerLabel: expect.any(String),
        },
      });
      expect(card.meaning.trim()).not.toBe('');
      expect(card.translation?.trim()).not.toBe('');
      expect(card.example?.trim()).not.toBe('');
      expect(card.exampleTranslation?.trim()).not.toBe('');
    }
  });

  it('maps editorial presentations through the existing library-card converter without media claims', () => {
    const cards = LISTEN_PHRASE_CARDS.map((entry, index) =>
      listenPhraseCardToLibraryCard(entry, `2026-09-05T00:0${index}:00.000Z`));

    expect(cards).toHaveLength(3);
    expect(cards.map(card => card.id)).toEqual([
      'word-break-the-news-8cf1bbbc36168e996c96e549',
      'word-on-the-ball-d79c411ea8560569bdac1d8f',
      'word-fair-and-square-802d4ef7a7bce76fc7cc610d',
    ]);
    expect(cards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        word: 'break the news',
        translation: 'báo tin xấu cho ai đó',
        explanation: 'to tell someone bad or upsetting news',
        exampleSentence: 'I hate to break the news, but the trip is canceled.',
        exampleTranslation: 'Tôi rất tiếc phải báo tin, nhưng chuyến đi đã bị hủy.',
        audioUrl: null,
        imageUrl: null,
      }),
    ]));
  });
});
