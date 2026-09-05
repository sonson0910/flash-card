import { catalogEntryToLibraryCard } from '../catalogWorkspace/catalogLearningFlow';
import type { CatalogVocabularyPresentation } from '../catalogWorkspace/catalogPresentation';

const BREAK_THE_NEWS_LEXEME_ID = 'lexeme-5b22656e222c22627265616b20746865206e657773222c22706872617365222c22627265616b2d7468652d6e65-d146b943fa604420dac43b0a';
const ON_THE_BALL_LEXEME_ID = 'lexeme-5b22656e222c226f6e207468652062616c6c222c22706872617365222c226f6e2d7468652d62616c6c225d-20c7740a169a1c6d10033429';
const FAIR_AND_SQUARE_LEXEME_ID = 'lexeme-5b22656e222c226661697220616e6420737175617265222c22706872617365222c22666169722d616e642d7371-badc00e3cc7c73fed8ce474d';

const phraseProvenance = {
  sourceLabel: 'SonFlash phrase editorial',
  licenseLabel: 'Project-authored',
  reviewerLabel: 'Editorial phrase seed',
} as const;

/**
 * Text-only phrase presentations for the Listen save flow. These entries do
 * not imply a reviewed/published audio release and intentionally carry no
 * candidate media or transcript data.
 */
export const LISTEN_PHRASE_CARDS = Object.freeze([
  {
    id: BREAK_THE_NEWS_LEXEME_ID,
    lemma: 'break the news',
    language: 'en',
    phonetic: '',
    partOfSpeech: 'idiom',
    cefr: 'B1',
    tier: 'foundation',
    topics: ['Communication'],
    skills: ['listening'],
    meaning: 'to tell someone bad or upsetting news',
    meaningLanguage: 'en',
    translation: 'báo tin xấu cho ai đó',
    translationLanguage: 'vi',
    example: 'I hate to break the news, but the trip is canceled.',
    exampleTranslation: 'Tôi rất tiếc phải báo tin, nhưng chuyến đi đã bị hủy.',
    collocations: [],
    provenance: phraseProvenance,
  },
  {
    id: ON_THE_BALL_LEXEME_ID,
    lemma: 'on the ball',
    language: 'en',
    phonetic: '',
    partOfSpeech: 'idiom',
    cefr: 'B1',
    tier: 'foundation',
    topics: ['Work'],
    skills: ['listening'],
    meaning: 'alert, capable, and working quickly',
    meaningLanguage: 'en',
    translation: 'nhạy bén, nhanh nhẹn và làm việc hiệu quả',
    translationLanguage: 'vi',
    example: 'Mai is on the ball and finished the report early.',
    exampleTranslation: 'Mai rất nhanh nhạy và đã hoàn thành báo cáo sớm.',
    collocations: [],
    provenance: phraseProvenance,
  },
  {
    id: FAIR_AND_SQUARE_LEXEME_ID,
    lemma: 'fair and square',
    language: 'en',
    phonetic: '',
    partOfSpeech: 'idiom',
    cefr: 'B1',
    tier: 'foundation',
    topics: ['Communication'],
    skills: ['listening'],
    meaning: 'honestly and without cheating',
    meaningLanguage: 'en',
    translation: 'một cách công bằng và trung thực',
    translationLanguage: 'vi',
    example: 'They won the match fair and square.',
    exampleTranslation: 'Họ đã thắng trận đấu một cách công bằng và trung thực.',
    collocations: [],
    provenance: phraseProvenance,
  },
] satisfies readonly CatalogVocabularyPresentation[]);

export function listenPhraseCardToLibraryCard(
  entry: CatalogVocabularyPresentation,
  createdAt?: string,
) {
  return catalogEntryToLibraryCard(entry, createdAt);
}
