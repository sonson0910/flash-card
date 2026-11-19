import { describe, expect, it } from 'vitest';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { CardData } from '../../types/card';
import {
  addTags,
  buildCategoryFacetDelta,
  canEditPartOfSpeech,
  createEditCardDraft,
  editCardPatch,
  EditCardDraftError,
  isEditCardDraftDirty,
  isSuccessfulEditCardSave,
  meaningChipLabel,
  meaningSuggestions,
  previewEditCard,
  tagSuggestions,
} from './editCardModel';

const card = { id: 'card-1', word: 'lead', translation: 'chì', explanation: 'A metal.', origin: 'ai', nextReviewDate: '2026-09-24' } as CardData;

describe('card text editing', () => {
  it('patches only changed text and preserves AI origin and scheduling', () => {
    const draft = createEditCardDraft(card);
    draft.translation = 'dẫn đầu';
    draft.exampleSentence = 'She leads the team.';
    expect(editCardPatch(card, draft)).toEqual({ translation: 'dẫn đầu', exampleSentence: 'She leads the team.' });
  });

  it('patches IPA and memory hook through the verified card mutation fields', () => {
    const openedCard = { ...card, phonetic: '/liːd/', mnemonic: 'Lead the team.' };
    const draft = createEditCardDraft(openedCard);
    draft.phonetic = '/lɛd/';
    draft.mnemonic = 'A lead weight is heavy.';

    expect(editCardPatch(openedCard, draft)).toEqual({
      phonetic: '/lɛd/',
      mnemonic: 'A lead weight is heavy.',
    });
  });

  it('requires a meaning and enforces normalized card text bounds', () => {
    const draft = createEditCardDraft(card);
    draft.translation = '   ';
    expect(() => editCardPatch(card, draft)).toThrow('Nghĩa tiếng Việt');
    draft.translation = 'x'.repeat(257);
    expect(() => editCardPatch(card, draft)).toThrow('256');
  });

  it('diffs a draft against the snapshot captured when the dialog opened, not a newer live card', () => {
    const openedCard = { ...card, exampleSentence: 'Old example.' };
    const draft = createEditCardDraft(openedCard);
    draft.translation = 'dẫn đầu';
    // A remote sync changed exampleSentence after the dialog opened; the learner never touched that field.
    const liveCard = { ...openedCard, exampleSentence: 'Synced example.' };

    expect(editCardPatch(openedCard, draft)).toEqual({ translation: 'dẫn đầu' });
    // Diffing against the live card instead would wrongly reintroduce the pre-sync exampleSentence.
    expect(editCardPatch(liveCard, draft)).toEqual({ translation: 'dẫn đầu', exampleSentence: 'Old example.' });
  });

  it('marks only normalized draft changes dirty and previews them without touching review state', () => {
    const openedCard = {
      ...card,
      phonetic: '/liːd/',
      mnemonic: 'Lead the team.',
      revision: 4,
      fsrs: {
        due: '2026-09-24', stability: 2, difficulty: 4, elapsedDays: 1,
        scheduledDays: 2, learningSteps: 0, reps: 3, lapses: 0, state: 2,
      },
      reviewHistory: [{ rating: 'good' as const, reviewedAt: '2026-09-20', scheduledDays: 2, elapsedDays: 1 }],
    };
    const draft = createEditCardDraft(openedCard);
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(false);

    draft.mnemonic = '  A lead weight is heavy.  ';
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(true);

    const preview = previewEditCard(openedCard, draft);
    expect(preview.mnemonic).toBe('  A lead weight is heavy.  ');
    expect(preview.phonetic).toBe('/liːd/');
    expect(preview.revision).toBe(4);
    expect(preview.fsrs).toEqual(openedCard.fsrs);
    expect(preview.reviewHistory).toEqual(openedCard.reviewHistory);
  });
});

describe('canEditPartOfSpeech', () => {
  it('allows a legacy card with no lexeme identity to change its part of speech', () => {
    expect(canEditPartOfSpeech(card)).toBe(true);
  });

  it('locks a canonical (lexemeId) card, whose part of speech names a published sense', () => {
    expect(canEditPartOfSpeech({ ...card, lexemeId: 'lex-1' })).toBe(false);
  });
});

describe('editCardPatch for part of speech, category, and image', () => {
  it('patches a legacy card part of speech only when it changed', () => {
    const openedCard = { ...card, partOfSpeech: 'noun' };
    const draft = createEditCardDraft(openedCard);
    draft.partOfSpeech = 'verb';
    expect(editCardPatch(openedCard, draft)).toEqual({ partOfSpeech: 'verb' });
  });

  it('never patches part of speech for a canonical card even if the draft was mutated', () => {
    const openedCard = { ...card, lexemeId: 'lex-1', partOfSpeech: 'noun' };
    const draft = createEditCardDraft(openedCard);
    draft.partOfSpeech = 'verb';
    expect(editCardPatch(openedCard, draft)).toEqual({});
  });

  it('enforces the part of speech bound', () => {
    const draft = createEditCardDraft(card);
    draft.partOfSpeech = 'x'.repeat(65);
    expect(() => editCardPatch(card, draft)).toThrow('64');
  });

  it('patches category and rejects clearing it to empty', () => {
    const openedCard = { ...card, category: 'Nature' };
    const draft = createEditCardDraft(openedCard);
    draft.category = 'Business';
    expect(editCardPatch(openedCard, draft)).toEqual({ category: 'Business' });

    draft.category = '   ';
    expect(() => editCardPatch(openedCard, draft)).toThrow('Danh mục');
  });

  it('enforces the category bound', () => {
    const draft = createEditCardDraft(card);
    draft.category = 'x'.repeat(129);
    expect(() => editCardPatch(card, draft)).toThrow('128');
  });

  it('patches a replaced image together with its search context', () => {
    const openedCard = { ...card, imageUrl: 'https://images.pexels.com/old.jpg', imageSearchQuery: 'old query' };
    const draft = createEditCardDraft(openedCard);
    draft.imageUrl = 'https://images.unsplash.com/new.jpg';
    draft.imageSearchQuery = 'new query';
    expect(editCardPatch(openedCard, draft)).toEqual({
      imageUrl: 'https://images.unsplash.com/new.jpg',
      imageSearchQuery: 'new query',
    });
  });

  it('patches a removed image to null and clears its search context', () => {
    const openedCard = { ...card, imageUrl: 'https://images.pexels.com/old.jpg', imageSearchQuery: 'old query' };
    const draft = createEditCardDraft(openedCard);
    draft.imageUrl = '';
    expect(editCardPatch(openedCard, draft)).toEqual({ imageUrl: null, imageSearchQuery: '' });
  });

  it('leaves the patch untouched when the image is never touched', () => {
    const openedCard = { ...card, imageUrl: 'https://images.pexels.com/old.jpg', imageSearchQuery: 'old query' };
    const draft = createEditCardDraft(openedCard);
    expect(editCardPatch(openedCard, draft)).toEqual({});
  });
});

describe('isEditCardDraftDirty and previewEditCard for the extended fields', () => {
  it('marks a canonical card dirty from category and image but never from part of speech', () => {
    const openedCard = { ...card, lexemeId: 'lex-1', partOfSpeech: 'noun', category: 'Nature' };
    const draft = createEditCardDraft(openedCard);
    draft.partOfSpeech = 'verb';
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(false);

    draft.category = 'Business';
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(true);
  });

  it('previews an in-progress category and image edit without leaking into part of speech on a canonical card', () => {
    const openedCard = { ...card, lexemeId: 'lex-1', partOfSpeech: 'noun', category: 'Nature', imageUrl: null };
    const draft = createEditCardDraft(openedCard);
    draft.partOfSpeech = 'verb';
    draft.category = 'Business';
    draft.imageUrl = 'https://images.pexels.com/new.jpg';

    const preview = previewEditCard(openedCard, draft);
    expect(preview.partOfSpeech).toBe('noun');
    expect(preview.category).toBe('Business');
    expect(preview.imageUrl).toBe('https://images.pexels.com/new.jpg');
  });
});

describe('deck and starred in the card draft', () => {
  const decks = ['IELTS', 'Work'];

  it('starts from the card deck and star, with Unassigned as an empty deck', () => {
    expect(createEditCardDraft({ ...card, customDeck: 'IELTS', bookmarked: true })).toMatchObject({ deck: 'IELTS', starred: true });
    expect(createEditCardDraft({ ...card, customDeck: null })).toMatchObject({ deck: '', starred: false });
    expect(createEditCardDraft(card)).toMatchObject({ deck: '', starred: false });
  });

  it('patches the deck only when it changed and maps Unassigned to null', () => {
    const openedCard = { ...card, customDeck: 'IELTS' };
    const draft = createEditCardDraft(openedCard);
    expect(editCardPatch(openedCard, draft, { customDecks: decks })).toEqual({});

    draft.deck = 'Work';
    expect(editCardPatch(openedCard, draft, { customDecks: decks })).toEqual({ customDeck: 'Work' });

    draft.deck = '';
    expect(editCardPatch(openedCard, draft, { customDecks: decks })).toEqual({ customDeck: null });
  });

  it('refuses a picked deck that left the live deck list before saving', () => {
    const draft = createEditCardDraft(card);
    draft.deck = 'Work';
    let thrown: unknown;
    try {
      editCardPatch(card, draft, { customDecks: ['IELTS'] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EditCardDraftError);
    expect((thrown as EditCardDraftError).reason).toBe('deck-missing');
  });

  it('keeps a deck deleted elsewhere when only another field changes', () => {
    const openedCard = { ...card, customDeck: 'Old deck' };
    const draft = createEditCardDraft(openedCard);
    draft.translation = 'dẫn đầu';
    expect(editCardPatch(openedCard, draft, { customDecks: decks })).toEqual({ translation: 'dẫn đầu' });
  });

  it('patches the star only when it flipped and never touches scheduling', () => {
    const openedCard = {
      ...card,
      bookmarked: false,
      difficulty: 'hard' as const,
      fsrs: {
        due: '2026-09-24', stability: 2, difficulty: 4, elapsedDays: 1,
        scheduledDays: 2, learningSteps: 0, reps: 3, lapses: 0, state: 2,
      },
    };
    const draft = createEditCardDraft(openedCard);
    draft.starred = true;
    draft.deck = 'IELTS';
    const patch = editCardPatch(openedCard, draft, { customDecks: decks });
    expect(patch).toEqual({ bookmarked: true, customDeck: 'IELTS' });
    for (const field of ['fsrs', 'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor', 'reviewHistory']) {
      expect(patch).not.toHaveProperty(field);
    }
  });

  it('marks deck and star changes dirty and previews them', () => {
    const openedCard = { ...card, customDeck: 'IELTS', bookmarked: false };
    const draft = createEditCardDraft(openedCard);
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(false);
    draft.starred = true;
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(true);
    draft.starred = false;
    draft.deck = '';
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(true);

    draft.starred = true;
    expect(previewEditCard(openedCard, draft)).toMatchObject({ customDeck: null, bookmarked: true });
  });
});

describe('tags and difficulty label in the card draft', () => {
  it('starts from the stored tags and label, with no label as an empty choice', () => {
    expect(createEditCardDraft({ ...card, tags: ['news', 'B2'], learnerDifficulty: 'hard' }))
      .toMatchObject({ tags: ['news', 'B2'], learnerDifficulty: 'hard' });
    expect(createEditCardDraft({ ...card, learnerDifficulty: null })).toMatchObject({ tags: [], learnerDifficulty: '' });
    expect(createEditCardDraft(card)).toMatchObject({ tags: [], learnerDifficulty: '' });
  });

  it('never reads the review rating as the learner label', () => {
    expect(createEditCardDraft({ ...card, difficulty: 'hard' })).toMatchObject({ learnerDifficulty: '' });
  });

  it('patches tags only when the stored list changed, keeping the learner order', () => {
    const openedCard = { ...card, tags: ['news', 'B2'] };
    const draft = createEditCardDraft(openedCard);
    expect(editCardPatch(openedCard, draft)).toEqual({});

    draft.tags = ['news', 'B2', 'travel'];
    expect(editCardPatch(openedCard, draft)).toEqual({ tags: ['news', 'B2', 'travel'] });

    draft.tags = ['B2', 'news'];
    expect(editCardPatch(openedCard, draft)).toEqual({ tags: ['B2', 'news'] });

    draft.tags = [];
    expect(editCardPatch(openedCard, draft)).toEqual({ tags: [] });
  });

  it('treats a card without tags and an empty draft list as unchanged', () => {
    const draft = createEditCardDraft(card);
    expect(editCardPatch(card, draft)).toEqual({});
    expect(isEditCardDraftDirty(card, draft)).toBe(false);
  });

  it('patches the label as the chosen value and clears it to null', () => {
    const openedCard = { ...card, learnerDifficulty: 'easy' as const };
    const draft = createEditCardDraft(openedCard);
    draft.learnerDifficulty = 'medium';
    expect(editCardPatch(openedCard, draft)).toEqual({ learnerDifficulty: 'medium' });
    draft.learnerDifficulty = '';
    expect(editCardPatch(openedCard, draft)).toEqual({ learnerDifficulty: null });

    const unlabelled = createEditCardDraft(card);
    expect(editCardPatch(card, unlabelled)).toEqual({});
  });

  it('never touches scheduling when the label changes', () => {
    const openedCard = { ...card, difficulty: 'easy' as const, reviews: 4 };
    const draft = createEditCardDraft(openedCard);
    draft.learnerDifficulty = 'hard';
    const patch = editCardPatch(openedCard, draft);
    expect(patch).toEqual({ learnerDifficulty: 'hard' });
    for (const field of ['fsrs', 'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor', 'reviewHistory']) {
      expect(patch).not.toHaveProperty(field);
    }
  });

  it('marks tag and label changes dirty and previews them', () => {
    const openedCard = { ...card, tags: ['news'] };
    const draft = createEditCardDraft(openedCard);
    draft.tags = ['news', 'B2'];
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(true);
    draft.tags = ['news'];
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(false);
    draft.learnerDifficulty = 'medium';
    expect(isEditCardDraftDirty(openedCard, draft)).toBe(true);
    expect(previewEditCard(openedCard, draft)).toMatchObject({ tags: ['news'], learnerDifficulty: 'medium' });
  });
});

describe('addTags', () => {
  it('adds a typed tag in its stored form', () => {
    expect(addTags(['news'], '  phrasal   verbs ')).toEqual({ tags: ['news', 'phrasal verbs'], rejected: null, leftover: '' });
  });

  it('splits pasted text on commas and skips empty pieces', () => {
    expect(addTags([], 'news, B2,, travel ,')).toEqual({ tags: ['news', 'B2', 'travel'], rejected: null, leftover: '' });
  });

  it('refuses a tag the card already has in any letter case', () => {
    expect(addTags(['News'], 'news')).toEqual({ tags: ['News'], rejected: 'duplicate', leftover: '' });
  });

  it('stops at 8 tags', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(addTags(full, 'h, i')).toEqual({ tags: [...full, 'h'], rejected: 'limit', leftover: '' });
  });

  it('counts the 32-character bound in characters and keeps a longer tag for editing', () => {
    expect(addTags([], '📚'.repeat(32)).tags).toEqual(['📚'.repeat(32)]);
    expect(addTags(['news'], `${'x'.repeat(33)}, B2`)).toEqual({ tags: ['news', 'B2'], rejected: 'too-long', leftover: 'x'.repeat(33) });
  });
});

describe('tagSuggestions', () => {
  it('offers the card category and CEFR level that are not tags yet', () => {
    expect(tagSuggestions({ category: 'Travel', cefrLevel: 'B2' }, [])).toEqual(['Travel', 'B2']);
    expect(tagSuggestions({ category: 'Travel', cefrLevel: 'B2' }, ['travel'])).toEqual(['B2']);
  });

  it('offers nothing for the empty-category fallback, a missing level, or a full tag list', () => {
    expect(tagSuggestions({ category: 'Other', cefrLevel: undefined }, [])).toEqual([]);
    expect(tagSuggestions({ category: '', cefrLevel: '' }, [])).toEqual([]);
    expect(tagSuggestions({ category: 'Travel', cefrLevel: 'B2' }, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toEqual([]);
  });

  it('offers one suggestion when category and level match each other', () => {
    expect(tagSuggestions({ category: 'B2', cefrLevel: 'b2' }, [])).toEqual(['B2']);
  });
});

describe('meaningSuggestions', () => {
  it('lists the AI alternatives that differ from the draft meaning', () => {
    const aiCard = { translationAlternatives: ['dẫn dắt', 'chì; kim loại nặng', 'Dẫn đầu'] };
    expect(meaningSuggestions(aiCard, 'dẫn đầu')).toEqual(['dẫn dắt', 'chì; kim loại nặng']);
    expect(meaningSuggestions(aiCard, '  DẪN DẮT ')).toEqual(['chì; kim loại nặng', 'Dẫn đầu']);
  });

  it('offers nothing for a card without alternatives', () => {
    expect(meaningSuggestions({}, 'chì')).toEqual([]);
    expect(meaningSuggestions({ translationAlternatives: ['chì'] }, 'chì')).toEqual([]);
  });

  it('labels a chip with the text up to its first semicolon', () => {
    expect(meaningChipLabel('chì; kim loại nặng')).toBe('chì');
    expect(meaningChipLabel('dẫn dắt')).toBe('dẫn dắt');
    expect(meaningChipLabel('; only detail')).toBe('; only detail');
  });
});

describe('buildCategoryFacetDelta', () => {
  it('returns a -1/+1 delta pair when the category actually changed', () => {
    expect(buildCategoryFacetDelta('Nature', 'Business')).toEqual({ Nature: -1, Business: 1 });
  });

  it('returns null when the category is unchanged', () => {
    expect(buildCategoryFacetDelta('Nature', 'Nature')).toBeNull();
  });

  it('defaults a missing category to "Other" on both sides', () => {
    expect(buildCategoryFacetDelta(undefined, 'Nature')).toEqual({ Other: -1, Nature: 1 });
    expect(buildCategoryFacetDelta('Nature', undefined)).toEqual({ Nature: -1, Other: 1 });
    expect(buildCategoryFacetDelta(undefined, undefined)).toBeNull();
  });
});

describe('isSuccessfulEditCardSave', () => {
  const outcome = (status: LearningStateOutcome['status']): LearningStateOutcome =>
    ({ status, result: {} } as LearningStateOutcome);

  it('treats a published patch as a successful save', () => {
    expect(isSuccessfulEditCardSave(outcome('published'))).toBe(true);
  });

  it('treats a noop as successful because the live card already matches the request', () => {
    expect(isSuccessfulEditCardSave(outcome('noop'))).toBe(true);
  });

  it('treats a missing card, absent owner, or stale lifecycle as a failed save', () => {
    expect(isSuccessfulEditCardSave(outcome('missing-card'))).toBe(false);
    expect(isSuccessfulEditCardSave(outcome('no-active-owner'))).toBe(false);
    expect(isSuccessfulEditCardSave(outcome('stale-owner'))).toBe(false);
  });

  it('treats an absent outcome as successful, matching a caller that does not report one', () => {
    expect(isSuccessfulEditCardSave(undefined)).toBe(true);
  });
});
