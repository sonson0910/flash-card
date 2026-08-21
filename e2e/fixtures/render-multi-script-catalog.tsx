import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogScreen } from '../../src/features/catalogWorkspace/CatalogScreen';
import type {
  CatalogScreenActions,
  CatalogScreenModel,
} from '../../src/features/catalogWorkspace/catalogPresentation';

const actions: CatalogScreenActions = {
  selectLanguage: () => undefined,
  selectTrack: () => undefined,
  selectTier: () => undefined,
  changeTerm: () => undefined,
  changeCefr: () => undefined,
  changeTopic: () => undefined,
  changePartOfSpeech: () => undefined,
  changeSkill: () => undefined,
  resetFilters: () => undefined,
  download: () => undefined,
  retry: () => undefined,
  loadMore: () => undefined,
  addToLibrary: () => undefined,
  openVocabulary: () => undefined,
  continueReview: () => undefined,
};

const model: CatalogScreenModel = {
  status: { kind: 'ready', isOnline: true, isAvailableOffline: true, message: 'Fixture ready.' },
  selectedLanguage: 'ar',
  languages: [{ code: 'ar', label: 'Arabic', nativeLabel: 'العربية', isAvailable: true }],
  selectedTrack: 'general',
  tracks: [],
  selectedTier: 'foundation',
  tiers: [],
  filters: {
    term: '', cefr: '', topic: '', partOfSpeech: '', skill: '',
    cefrOptions: [], topicOptions: [], partOfSpeechOptions: [], skillOptions: [], hasActiveFilters: false,
  },
  cards: [{
    id: 'phase10-catalog-ar',
    lemma: 'تحليل',
    language: 'ar-eg',
    partOfSpeech: 'noun',
    cefr: 'B2',
    tier: 'Core',
    topics: ['Research'],
    skills: ['Reading'],
    meaning: 'دراسة دقيقة لشيء ما',
    meaningLanguage: 'ar-eg',
    translation: 'analysis',
    translationLanguage: 'en',
    example: 'يقدم التقرير تحليلاً مفصلاً.',
    exampleTranslation: 'The report provides a detailed analysis.',
    collocations: ['تحليل البيانات'],
    provenance: {
      sourceLabel: 'Phase 10 fixture', licenseLabel: 'Test fixture', reviewerLabel: 'Automated fixture',
    },
  }],
  resultSummary: 'Showing one RTL vocabulary item.',
  hasMore: false,
  isLoadingPage: false,
  isLoadingMore: false,
};

process.stdout.write(renderToStaticMarkup(<CatalogScreen model={model} actions={actions} />));
