import type { LanguageProfile } from '../language/languageProfile';
import type { ExtractedWordItem } from './WordExtractorModal';

const quoteCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export interface ExtractedWordsImportOptions {
  /** The deck new cards join; null or absent means Unassigned. */
  deck?: string | null;
}

export const createExtractedWordsCsv = (
  items: readonly ExtractedWordItem[],
  languageProfile: LanguageProfile,
  { deck = null }: ExtractedWordsImportOptions = {},
) => [
  ['Word', 'Translation', 'Part of Speech', 'Example Sentence', 'CEFR Level', 'Language', 'Translation Language', 'Deck'],
  ...items.map(item => [
    item.word, item.translation, item.partOfSpeech, item.example, item.cefrLevel,
    languageProfile.source.code, languageProfile.target.code, deck ?? '',
  ]),
].map(row => row.map(quoteCsvCell).join(',')).join('\n');
