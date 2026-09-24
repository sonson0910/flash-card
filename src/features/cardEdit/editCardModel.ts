import type { CardData } from '../../types/card';

export type EditableCardField = 'translation' | 'explanation' | 'explanationTranslation' | 'exampleSentence' | 'exampleTranslation';
export type EditCardDraft = Record<EditableCardField, string>;

export const EDIT_CARD_FIELDS: ReadonlyArray<{ key: EditableCardField; label: string; maxLength: number }> = [
  { key: 'translation', label: 'Nghĩa tiếng Việt', maxLength: 256 },
  { key: 'explanation', label: 'Giải thích', maxLength: 2_048 },
  { key: 'explanationTranslation', label: 'Giải thích tiếng Việt', maxLength: 2_048 },
  { key: 'exampleSentence', label: 'Câu ví dụ', maxLength: 2_048 },
  { key: 'exampleTranslation', label: 'Dịch câu ví dụ', maxLength: 2_048 },
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
