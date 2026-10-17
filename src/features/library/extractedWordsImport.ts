import type { LanguageProfile } from '../language/languageProfile';
import type { ExtractedWordItem } from './WordExtractorModal';

const quoteCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const createExtractedWordsCsv = (items: readonly ExtractedWordItem[], languageProfile: LanguageProfile) => [
  ['Word', 'Translation', 'Part of Speech', 'Example Sentence', 'CEFR Level', 'Language', 'Translation Language'],
  ...items.map(item => [item.word, item.translation, item.partOfSpeech, item.example, item.cefrLevel, languageProfile.source.code, languageProfile.target.code]),
].map(row => row.map(quoteCsvCell).join(',')).join('\n');
