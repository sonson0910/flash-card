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
export type EditCardDraft = Record<EditableCardField, string>;

export const EDIT_CARD_FIELDS: ReadonlyArray<{ key: EditableCardField; label: string; maxLength: number }> = [
  { key: 'translation', label: 'Nghĩa tiếng Việt', maxLength: 256 },
  { key: 'explanation', label: 'Giải thích', maxLength: 2_048 },
  { key: 'explanationTranslation', label: 'Giải thích tiếng Việt', maxLength: 2_048 },
  { key: 'exampleSentence', label: 'Câu ví dụ', maxLength: 2_048 },
  { key: 'exampleTranslation', label: 'Dịch câu ví dụ', maxLength: 2_048 },
  { key: 'phonetic', label: 'IPA', maxLength: 256 },
  { key: 'mnemonic', label: 'Liên tưởng ghi nhớ', maxLength: 2_048 },
];

export const createEditCardDraft = (card: CardData): EditCardDraft => Object.fromEntries(
  EDIT_CARD_FIELDS.map(({ key }) => [key, card[key] ?? '']),
) as EditCardDraft;

export function editCardPatch(card: CardData, draft: EditCardDraft): Partial<CardData> {
  const patch: Partial<CardData> = {};
  for (const { key, maxLength } of EDIT_CARD_FIELDS) {
    const value = draft[key].trim();
    if (value.length > maxLength) throw new Error(`Trường ${key} vượt giới hạn ${maxLength} ký tự.`);
    if (key === 'translation' && !value) throw new Error('Nghĩa tiếng Việt không được để trống.');
    if (value !== (card[key] ?? '')) Object.assign(patch, { [key]: value });
  }
  return patch;
}

/**
 * Dirty state follows the same field-level normalization as a save. It is
 * deliberately independent from the live card so a remote update to an
 * untouched field never turns into a draft write.
 */
export function isEditCardDraftDirty(card: CardData, draft: EditCardDraft): boolean {
  return EDIT_CARD_FIELDS.some(({ key }) => draft[key].trim() !== (card[key] ?? ''));
}

/**
 * Build the card shown by the sheet preview without changing scheduling,
 * review history, identity, or any field outside the editable draft.
 */
export function previewEditCard(card: CardData, draft: EditCardDraft): CardData {
  return {
    ...card,
    ...Object.fromEntries(EDIT_CARD_FIELDS.map(({ key }) => [key, draft[key]])),
  } as CardData;
}

// A patch that reaches Firestore ('published') or the offline queue ('durably-queued') will reach the card.
// 'noop' means the live card already matches the requested values, so the user's intent is already satisfied.
// Anything else (a missing card, no active owner, or a lifecycle that moved under the dialog) did not save.
const SUCCESSFUL_EDIT_CARD_SAVE_STATUSES: ReadonlySet<LearningStateOutcome['status']> =
  new Set(['published', 'durably-queued', 'noop']);

export function isSuccessfulEditCardSave(outcome: LearningStateOutcome | void): boolean {
  return !outcome || SUCCESSFUL_EDIT_CARD_SAVE_STATUSES.has(outcome.status);
}
