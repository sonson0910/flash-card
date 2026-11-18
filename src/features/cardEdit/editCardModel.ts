import type { LearningStateOutcome } from '../learning/learningStateController';
import type { CardData } from '../../types/card';

export type EditableCardField =
  | 'translation'
  | 'explanation'
  | 'explanationTranslation'
  | 'exampleSentence'
  | 'exampleTranslation'
  | 'phonetic'
  | 'mnemonic';

/**
 * Word (headword) is intentionally not part of this draft: Rules lock
 * `word`/`normalizedWord` on any card that already has an identity, so a
 * headword correction never goes through this plain-patch draft — it always
 * goes through the dedicated `renameCardHeadword` callable (see
 * `EditCardDialog.tsx`), independently of the fields below.
 */
export type EditCardDraft = Record<EditableCardField, string> & {
  partOfSpeech: string;
  category: string;
  imageUrl: string;
  imageSearchQuery: string;
};

export const EDIT_CARD_FIELDS: ReadonlyArray<{ key: EditableCardField; label: string; maxLength: number }> = [
  { key: 'translation', label: 'Nghĩa tiếng Việt', maxLength: 256 },
  { key: 'explanation', label: 'Giải thích', maxLength: 2_048 },
  { key: 'explanationTranslation', label: 'Giải thích tiếng Việt', maxLength: 2_048 },
  { key: 'exampleSentence', label: 'Câu ví dụ', maxLength: 2_048 },
  { key: 'exampleTranslation', label: 'Dịch câu ví dụ', maxLength: 2_048 },
  { key: 'phonetic', label: 'IPA', maxLength: 256 },
  { key: 'mnemonic', label: 'Liên tưởng ghi nhớ', maxLength: 2_048 },
];

export const MAX_HEADWORD_LENGTH = 256;
export const MAX_PART_OF_SPEECH_LENGTH = 64;
export const MAX_CATEGORY_LENGTH = 128;

/**
 * A canonical (V3, lexeme-identified) card names a published lexeme through
 * its language/normalizedLemma/partOfSpeech/senseKey tuple
 * (`hasValidCanonicalLexemeMetadata` in firestore.rules). Changing
 * partOfSpeech there means pointing at a different lexeme, not editing text —
 * Rules keep `data.partOfSpeech == resource.data.partOfSpeech` for any card
 * that already carries that tuple. Only a legacy card (no `lexemeId`) is a
 * free bounded string with no identity coupling, so only it gets a live
 * part-of-speech control here.
 */
export function canEditPartOfSpeech(card: CardData): boolean {
  return !card.lexemeId;
}

export const createEditCardDraft = (card: CardData): EditCardDraft => ({
  ...Object.fromEntries(EDIT_CARD_FIELDS.map(({ key }) => [key, card[key] ?? ''])),
  partOfSpeech: card.partOfSpeech ?? '',
  category: card.category ?? '',
  imageUrl: card.imageUrl ?? '',
  imageSearchQuery: card.imageSearchQuery ?? '',
}) as EditCardDraft;

export function editCardPatch(card: CardData, draft: EditCardDraft): Partial<CardData> {
  const patch: Partial<CardData> = {};
  for (const { key, maxLength } of EDIT_CARD_FIELDS) {
    const value = draft[key].trim();
    if (value.length > maxLength) throw new Error(`Trường ${key} vượt giới hạn ${maxLength} ký tự.`);
    if (key === 'translation' && !value) throw new Error('Nghĩa tiếng Việt không được để trống.');
    if (value !== (card[key] ?? '')) Object.assign(patch, { [key]: value });
  }
  if (canEditPartOfSpeech(card)) {
    const partOfSpeech = draft.partOfSpeech.trim();
    if (partOfSpeech.length > MAX_PART_OF_SPEECH_LENGTH) {
      throw new Error(`Từ loại vượt giới hạn ${MAX_PART_OF_SPEECH_LENGTH} ký tự.`);
    }
    if (partOfSpeech !== (card.partOfSpeech ?? '')) patch.partOfSpeech = partOfSpeech;
  }
  const category = draft.category.trim();
  if (category.length > MAX_CATEGORY_LENGTH) throw new Error(`Danh mục vượt giới hạn ${MAX_CATEGORY_LENGTH} ký tự.`);
  if (category !== (card.category ?? '')) {
    if (!category) throw new Error('Danh mục không được để trống.');
    patch.category = category;
  }
  const imageUrl = draft.imageUrl.trim();
  if (imageUrl !== (card.imageUrl ?? '')) {
    patch.imageUrl = imageUrl || null;
    // Removing the image drops its search context too; replacing it keeps
    // whatever context the caller set on the new draft (see "find another
    // photo" in EditCardDialog.tsx), and manual text editing of this field is
    // never exposed, so no separate bound check is needed here.
    patch.imageSearchQuery = imageUrl ? draft.imageSearchQuery.trim() : '';
  }
  return patch;
}

/**
 * Dirty state follows the same field-level normalization as a save. It is
 * deliberately independent from the live card so a remote update to an
 * untouched field never turns into a draft write. The headword field is
 * excluded (see `EditCardDraft`): it commits immediately through its own
 * action and is never part of this draft's dirty/discard lifecycle.
 */
export function isEditCardDraftDirty(card: CardData, draft: EditCardDraft): boolean {
  return EDIT_CARD_FIELDS.some(({ key }) => draft[key].trim() !== (card[key] ?? ''))
    || (canEditPartOfSpeech(card) && draft.partOfSpeech.trim() !== (card.partOfSpeech ?? ''))
    || draft.category.trim() !== (card.category ?? '')
    || draft.imageUrl.trim() !== (card.imageUrl ?? '');
}

/**
 * Build the card shown by the sheet preview without changing scheduling,
 * review history, identity, or any field outside the editable draft.
 */
export function previewEditCard(card: CardData, draft: EditCardDraft): CardData {
  return {
    ...card,
    ...Object.fromEntries(EDIT_CARD_FIELDS.map(({ key }) => [key, draft[key]])),
    ...(canEditPartOfSpeech(card) ? { partOfSpeech: draft.partOfSpeech } : {}),
    category: draft.category,
    imageUrl: draft.imageUrl || null,
  } as CardData;
}

/**
 * The category→count mirror at `users/{uid}/profile/library_facets` is kept
 * in sync from the delete path today (`useLearningStatePersistence.ts`); an
 * edit that changes `category` must add the same shape of delta
 * (`{ [old]: -1, [new]: 1 }`) in one call, and only when the value actually
 * changed — an unrelated field edit must never touch the mirror.
 */
export function buildCategoryFacetDelta(
  previousCategory: string | undefined,
  nextCategory: string | undefined,
): Record<string, number> | null {
  const previous = previousCategory || 'Other';
  const next = nextCategory || 'Other';
  return previous === next ? null : { [previous]: -1, [next]: 1 };
}

// A patch that reaches Firestore ('published') will reach the card.
// 'noop' means the live card already matches the requested values, so the user's intent is already satisfied.
// Anything else (a missing card, no active owner, or a lifecycle that moved under the dialog) did not save.
const SUCCESSFUL_EDIT_CARD_SAVE_STATUSES: ReadonlySet<LearningStateOutcome['status']> =
  new Set(['published', 'noop']);

export function isSuccessfulEditCardSave(outcome: LearningStateOutcome | void): boolean {
  return !outcome || SUCCESSFUL_EDIT_CARD_SAVE_STATUSES.has(outcome.status);
}
