import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '../../src/index.css';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { AppOverlays } from '../../src/components/AppOverlays';
import { EditCardDialog } from '../../src/features/cardEdit/EditCardDialog';
import { DeckCreationForm, DeckDeletionDialog, SpreadsheetImportStatus } from '../../src/features/library/LibraryTools';
import { LibraryScreen, type LibraryScreenActions, type LibraryScreenModel } from '../../src/features/library/LibraryScreen';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import type { CardData } from '../../src/types/card';

const cards: CardData[] = [
  ['adapt', 'thích nghi', 'IELTS', 'B2'],
  ['benefit', 'lợi ích', 'IELTS', 'B1'],
  ['context', 'bối cảnh', 'Work', 'B2'],
  ['develop', 'phát triển', 'Work', 'B1'],
].map(([word, translation, category, cefrLevel], index) => ({
  id: `library-visual-${index}`,
  word,
  normalizedWord: word,
  translation,
  explanation: `A deterministic ${word} explanation for visual review.`,
  phonetic: '',
  emoji: '📚',
  category,
  audioUrl: null,
  imageUrl: null,
  language: 'en',
  translationLanguage: 'vi',
  cefrLevel,
  partOfSpeech: index % 2 ? 'noun' : 'verb',
  createdAt: `2026-09-${String(20 + index).padStart(2, '0')}T12:00:00.000Z`,
  difficulty: index % 2 ? 'good' : 'easy',
  customDeck: index < 2 ? 'IELTS' : 'Work',
  exampleSentence: `We ${word} this library visual fixture carefully.`,
  exampleTranslation: `Ví dụ ${index + 1}`,
}));

const noOp = () => undefined;
const asyncNoOp = async () => undefined;
const published = { status: 'published' as const, result: { ownerKey: 'fixture', operationId: 'fixture', publication: { kind: 'patch' as const, cardId: cards[0]!.id, fields: {} } } };

function LibraryFixture() {
  const locale = useUiLocale();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);
  const [wordInput, setWordInput] = useState('serendipity');
  const [generationCount, setGenerationCount] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const dialog = new URLSearchParams(location.search).get('dialog');

  useEffect(() => { void Promise.all([loadCatalog(locale, 'library'), loadCatalog(locale, 'shell'), loadCatalog(locale, 'progress')]).then(() => setReady(true)); }, [locale]);
  if (!ready) return null;

  const filteredCards = cards.filter(card =>
    (category === 'All' || card.category === category)
    && card.word.includes(search.toLowerCase()),
  );
  const model: LibraryScreenModel = {
    isAuthenticated: false,
    overview: { total: cards.length, due: 2, mastered: 1, streak: 4, level: 3, xp: 480, canStudy: true },
    grid: {
      searchQuery: search, legacyCardsPending: 0, legacyIssue: null, isMigratingLegacy: false, activeCategory: category,
      filteredCards, isSharing: false, currentPage: 1, paginatedCards: filteredCards,
      isPageLoading: false, cloudReadUnavailable: false, importProgress: null,
      groupedCards: { 'Sep 24, 2026': filteredCards }, customDecks: ['IELTS', 'Work'], totalPages: 1,
      hasNextCloudPage: false, libraryCount: cards.length,
    },
    tools: {
      fileInputRef, wordInput, isLoading: false, isGenerating: false, isImporting: false,
      generationAccess: { available: true }, importProgress: null, importResult: null, libraryCount: cards.length,
      searchQuery: search, showStarredOnly: false, activeDifficulty: 'All', activePartOfSpeech: 'All', activeDate: 'All',
      availableDates: ['All', 'Sep 24, 2026'], customDecks: ['IELTS', 'Work'], newDeckInput: '', activeCustomDeck: 'All', cards,
      cloudFacetsComplete: true, sortedCategories: ['All', 'IELTS', 'Work'], categoryCounts: { All: cards.length, IELTS: 2, Work: 2 }, activeCategory: category,
    },
  };
  const actions: LibraryScreenActions = {
    startStudy: asyncNoOp, openCardCreator: () => document.getElementById('new-word')?.focus(),
    grid: { changeSearch: setSearch, migrateLegacyCards: asyncNoOp, shareCategory: asyncNoOp, deleteCard: asyncNoOp, toggleBookmark: asyncNoOp, assignDeck: asyncNoOp, updateCard: async () => published, changePage: noOp, clearFilters: () => { setSearch(''); setCategory('All'); } },
    tools: {
      importCards: noOp, importFile: noOp, generateCard: event => {
        event.preventDefault();
        setGenerationCount(count => count + 1);
        return Promise.resolve();
      }, changeWordInput: setWordInput,
      changeSearch: setSearch, changeStarredOnly: noOp, changeDifficulty: noOp, changePartOfSpeech: noOp,
      changeDate: noOp, changeNewDeckInput: noOp, createCustomDeck: asyncNoOp, changeCustomDeck: noOp,
      deleteCustomDeck: asyncNoOp, changeCategory: setCategory,
    },
  };

  const incomingSharePreview = dialog === 'share-in'
    ? { shareId: 'fixture-share', category: 'IELTS', cardCount: 12, sampleWords: [{ value: 'adapt', language: 'en' }, { value: 'benefit', language: 'en' }, { value: 'context', language: 'en' }, { value: 'develop', language: 'en' }], languagePairs: [{ targetLanguage: 'en', translationLanguage: 'vi' }, { targetLanguage: null, translationLanguage: null }] }
    : null;
  const stats = { total: 128, learned: 42, learning: 64, dueToday: 8, categoryChart: [{ name: 'IELTS', value: 64 }, { name: 'Work', value: 40 }, { name: 'Travel', value: 24 }], categoryChartIsPartial: false, difficultyChart: [{ name: 'Easy', value: 42 }, { name: 'Good', value: 64 }, { name: 'Hard', value: 22 }], xpChartData: [{ date: 'Sep 20', XP: 28 }, { date: 'Sep 21', XP: 44 }, { date: 'Sep 22', XP: 36 }, { date: 'Sep 23', XP: 62 }, { date: 'Sep 24', XP: 48 }] };
  const overlayProps = {
    shareDialogOpen: dialog === 'share' || dialog === 'share-in', shareLink: dialog === 'share' ? 'https://sonflash.example/share/fixture' : null, shareWarning: null, outgoingSharePreview: dialog === 'share' ? { category: 'IELTS', cardCount: 12, languagePairs: [{ targetLanguage: 'en', translationLanguage: 'vi' }] } : null, incomingSharePreview,
    dismissShareDialog: noOp, showShareDialog: noOp, acceptSharedDeck: asyncNoOp, cancelSharedDeck: noOp, canRevokeShare: dialog === 'share', revokeShare: asyncNoOp, isSharing: false,
    isPracticeMenuOpen: false, setIsPracticeMenuOpen: noOp, startQuiz: asyncNoOp, startSpelling: asyncNoOp, startMatch: asyncNoOp, startShadowing: asyncNoOp, practiceCards: cards, visibleLibraryCount: cards.length, generateStory: asyncNoOp,
    isStatsOpen: dialog === 'insights', setIsStatsOpen: noOp, statsData: stats, isDarkMode: matchMedia('(prefers-color-scheme: dark)').matches,
    showClearConfirm: dialog === 'clear', setShowClearConfirm: noOp, clearAll: asyncNoOp, isLoading: false,
    shareOpenerRef: { current: null }, practiceOpenerRef: { current: null }, statsOpenerRef: { current: null }, clearOpenerRef: { current: null },
  };
  return <main data-library-visual-view className="min-h-screen px-4 py-5 sm:px-8 sm:py-8">
    <LibraryScreen model={model} actions={actions} />
    {dialog === 'deck-new' && <section data-library-inline-visual className="mx-auto mt-8 max-w-md rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-[var(--sf-text)] shadow-xl">
      <h2 className="mb-4 font-display text-2xl font-bold">Create a deck</h2>
      <DeckCreationForm value="Academic words" onChange={noOp} onSubmit={noOp} isCreating={false} error={false} />
    </section>}
    {dialog === 'import' && <section data-library-inline-visual className="mx-auto mt-8 max-w-md rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-[var(--sf-text)] shadow-xl">
      <h2 className="mb-4 font-display text-2xl font-bold">Import cards</h2>
      <SpreadsheetImportStatus progress={null} result={{ status: 'partial', summary: { total: 12, created: 8, reused: 2, failed: 1, skipped: 1 }, message: 'Import partly finished. You can retry the remaining cards later.' }} />
    </section>}
    {dialog === 'edit' && <EditCardDialog card={cards[0]!} open onOpenChange={noOp} onSave={async () => published} />}
    {dialog === 'deck-delete' && <DeckDeletionDialog deckName="IELTS" assignedCardCount={2} open onOpenChange={noOp} onConfirm={noOp} isDeleting={false} error={false} />}
    <AppOverlays {...overlayProps} />
    <output data-library-generate-count hidden>{generationCount}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><LibraryFixture /></I18nProvider></ThemeProvider>);
