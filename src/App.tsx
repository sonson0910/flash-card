import React, { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fetchAudioUrl } from './lib/audio';
import { fetchImageUrl, isSupportedImageUrl } from './lib/images';
import { hydrateMissingCardImage } from './lib/cardImageHydration';
import {
  applyCardPatchWithConflictRecovery,
  deleteCardWithConflictRecovery,
} from './lib/cardConflictRecovery';
import { selectMutableCardPatch } from './lib/cardMutationProtocol';
import { isCardDue } from './lib/srs';
import { scheduleReview, type ReviewRating } from './lib/reviewScheduler';
import { CLOUD_PAGE_SIZE, calculateTotalPages, createLocalCardPage, normalizePartOfSpeech, queryStateKey, sortCardsByActivity, type CardQueryState } from './lib/cardQuery';
import { mapWithConcurrency } from './lib/asyncPool';
import { OperationTimeoutError, withTimeout } from './lib/async';
import { acknowledgeDevicePending as acknowledgeStoredDevicePending, acquireDevicePendingFlush, clearDevicePending, loadDeviceCards, loadDevicePending, mergeDeviceCards, mergePendingOperations, queueDeviceDeletes, queueDevicePatches, queueDeviceUpserts, releaseDevicePendingFlush, saveDeviceCards, subscribeToDeviceCards, type DevicePendingOperation } from './lib/deviceSync';
import { shouldRefreshCloudCount, shouldRefreshCloudStats } from './lib/cloudReadPolicy';
import { getReducedMotionScrollBehavior, motionDurations } from './lib/motion';
import {
  countCards,
  countPageableCards,
  clearCustomDeckAssignments,
  applyCardPatchIfCurrent,
  createCardIfAbsent,
  deleteCardWithTombstone,
  applyCategoryDeltas,
  deleteAllCards,
  fetchAllCardsOnDemand,
  fetchCardPage,
  fetchLibraryStats,
  fetchPracticeCards,
  findCardByNormalizedWord,
  findCardsByNormalizedWords,
  getLibraryEpoch,
  incrementLibraryEpoch,
  migrateLegacyCardQueryFields,
  streamAllCardsInBatches,
  subscribeCardPage,
  type RealtimeCardPage,
} from './lib/cardRepository';
import {
  beginCardMirrorSync,
  clearMirroredCards,
  deleteMirroredCard,
  findMirroredCardByWord,
  finishCardMirrorSync,
  getCardMirrorStatus,
  isCardMirrorFresh,
  patchMirroredCardBatch,
  queryMirroredCardPage,
  upsertMirroredCardBatch,
} from './lib/cardMirror';
import type { CardData } from './types/card';
import { CardUniquenessCheckError, resolveExistingCard } from './lib/cardUniqueness';
import {
  canDeferRemoteUniquenessFailure,
  applySuccessfulPatchMetadata,
  partitionPendingOperationsByLibraryEpoch,
  partitionPendingOperationsForFlush,
  persistCardWithMirrorFallback,
  shouldAttemptRemoteUniquenessCheck,
  shouldRequireRemoteUniquenessCheck,
  verifyPendingCardOperations,
} from './lib/cardCreation';
import { cardWordKey, createWordCardId as createStableWordCardId, dedupeCardsByNormalizedWord, normalizeCardWord } from './lib/cardIdentity';
import {
  isActiveUserSession,
  isCardUpdateLifecycleCurrent,
  resolveCardUpdateSource,
} from './lib/cardUpdates';
import type { RecallMode } from './lib/recall';
import { shouldRefreshCountForRealtimeChanges } from './lib/realtimeSync';
import { overlayPendingCardsOnPage } from './lib/pendingCardOverlay';
import { canUseDeviceBackupForSession, planCardsForSignedInSession, retainCardsForSession, selectCardsVisibleForSession } from './lib/sessionCards';
import { resolvePracticeLibraryCount } from './lib/practiceAvailability';
import { dateLabelToQueryDate, existingCardRevealState, formatCardDate, groupCardsByDate, overlayRecentlyPromotedCards, promoteExistingCard, shouldResetLibraryPageAfterSync } from './features/library/libraryPresentation';
import { SyncHealth } from './features/sync/SyncHealth';
import { countPendingSyncOperations, getSyncErrorMessage } from './features/sync/syncHealthModel';
import { normalizeAssignedDeckName, normalizeCustomDeckCollection, planCustomDeckCreation } from './features/library/customDecks';
import {
  canStartLibraryClear,
  planClearFailureRecovery,
  planDeckDeletionFailureRecovery,
  runEpochProtectedLibraryClear,
} from './features/library/libraryMutationRecovery';
import { useGamification } from './features/gamification/useGamification';
import { usePracticeGames } from './features/practice/usePracticeGames';
import { LibraryOverview } from './features/library/LibraryOverview';
import { cardsToSpreadsheetRows } from './features/importExport/spreadsheetModel';
import { useSpreadsheetImport } from './features/importExport/useSpreadsheetImport';
import { createSharedDeckShare, revokeSharedDeckShare } from './features/sharing/sharedDeckService';
import {
  cloudBackoffCacheKey,
  cloudFacetsCacheKey,
  cloudMigrationCacheKey,
  cloudPageCacheKey,
  cloudStatsCacheKey,
  getBoundedCloudFallback,
  isCloudBackoffActive,
  isQuotaError,
  isRetryableSyncError,
  localCardsOwnerKey,
  localDecksOwnerKey,
  normalizeCardForStorage,
  normalizeLocalCards,
  persistLocalCardBackup,
  readCachedCloudStats,
  readCachedCloudTotal,
  readLocalJson,
  waitForInitialMedia,
  type CachedCloudPage,
  type CachedCloudStats,
} from './features/library/libraryStorage';
import { Loader2, AlertCircle, CheckCircle2, Trash2, Play, Download, X, Sun, Moon, Gamepad2, BarChart3, BookOpen, CloudUpload } from 'lucide-react';

// Firebase imports
import { 
  app,
  auth, 
  db, 
  googleProvider, 
  isFirebaseConfigured, 
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signInWithRedirect,
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc,
  onSnapshot,
  arrayRemove,
  arrayUnion,
} from 'firebase/firestore';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

const QuizView = lazy(() => import('./features/practice/QuizView').then(module => ({ default: module.QuizView })));
const SpellingView = lazy(() => import('./features/practice/SpellingView').then(module => ({ default: module.SpellingView })));
const StoryView = lazy(() => import('./features/practice/StoryView').then(module => ({ default: module.StoryView })));
const StudyView = lazy(() => import('./features/practice/StudyView').then(module => ({ default: module.StudyView })));
const LibraryCardGrid = lazy(() => import('./features/library/LibraryCardGrid').then(module => ({ default: module.LibraryCardGrid })));
const LibraryTools = lazy(() => import('./features/library/LibraryTools').then(module => ({ default: module.LibraryTools })));
const AppOverlays = lazy(() => import('./components/AppOverlays').then(module => ({ default: module.AppOverlays })));
const AppShellMotion = lazy(() => import('./components/motion/AppShellMotion').then(module => ({ default: module.AppShellMotion })));

function DeferredViewFallback({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={`skeleton-sheen min-h-40 rounded-[26px] border border-[var(--sf-border)] ${className}`} role="status">
      <span className="sr-only">{label}</span>
    </div>
  );
}

interface LibraryUrlState {
  search: string;
  category: string;
  deck: string;
  difficulty: string;
  partOfSpeech: string;
  starred: boolean;
  date: string;
  page: number;
}

const libraryUrlKeys = ['q', 'category', 'deck', 'difficulty', 'pos', 'starred', 'date', 'page'] as const;
const allowedDifficulties = new Set(['All', 'due', 'easy', 'good', 'hard', 'unrated']);

interface SaveDataConnection {
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

function readLibraryUrlState(): LibraryUrlState {
  const params = new URLSearchParams(window.location.search);
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  const difficulty = params.get('difficulty') ?? 'All';
  return {
    search: (params.get('q') ?? '').slice(0, 256),
    category: (params.get('category') ?? 'All').slice(0, 128),
    deck: (params.get('deck') ?? 'All').slice(0, 128),
    difficulty: allowedDifficulties.has(difficulty) ? difficulty : 'All',
    partOfSpeech: (params.get('pos') ?? 'All').slice(0, 64),
    starred: params.get('starred') === '1',
    date: (params.get('date') ?? 'All').slice(0, 64),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function setOptionalUrlParam(params: URLSearchParams, key: string, value: string, defaultValue: string) {
  if (value && value !== defaultValue) params.set(key, value);
  else params.delete(key);
}

function removeUrlParam(key: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(key);
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
}

const libraryEpochCacheKey = (userId: string) =>
  `lingoflash_library_epoch_${encodeURIComponent(userId)}`;

function readCachedLibraryEpoch(userId: string): number | null {
  try {
    const value = Number(localStorage.getItem(libraryEpochCacheKey(userId)));
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function cacheLibraryEpoch(userId: string, epoch: number): void {
  try {
    localStorage.setItem(libraryEpochCacheKey(userId), String(epoch));
  } catch {
    // The verified in-memory epoch remains authoritative for this session.
  }
}

export default function App() {
  const initialLibraryUrlState = useRef<LibraryUrlState>(readLibraryUrlState()).current;
  const [wordInput, setWordInput] = useState(() => {
    try {
      return sessionStorage.getItem('lingoflash_word_draft') ?? '';
    } catch {
      return '';
    }
  });
  const [cards, setCards] = useState<CardData[]>([]);

  // Auth & Cloud Sync States
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isDeviceSyncing, setIsDeviceSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncHealthError, setSyncHealthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(initialLibraryUrlState.category);
  const [searchQuery, setSearchQuery] = useState(initialLibraryUrlState.search);
  const [activeDate, setActiveDate] = useState(initialLibraryUrlState.date);
  
  // Custom Decks States
  const [customDecks, setCustomDecks] = useState<string[]>(() => {
    const saved = readLocalJson<unknown>('lingoflash_custom_decks', []);
    return normalizeCustomDeckCollection(saved);
  });
  const [activeCustomDeck, setActiveCustomDeck] = useState<string>(initialLibraryUrlState.deck);
  const [newDeckInput, setNewDeckInput] = useState<string>('');

  // New Filter States
  const [activeDifficulty, setActiveDifficulty] = useState<string>(initialLibraryUrlState.difficulty);
  const [activePartOfSpeech, setActivePartOfSpeech] = useState<string>(initialLibraryUrlState.partOfSpeech);
  const [showStarredOnly, setShowStarredOnly] = useState<boolean>(initialLibraryUrlState.starred);
  const [debouncedSearch, setDebouncedSearch] = useState(initialLibraryUrlState.search);

  // Pagination
  const [currentPage, setCurrentPage] = useState(initialLibraryUrlState.page);
  const [libraryFocusRequest, setLibraryFocusRequest] = useState(0);
  const [cloudTotal, setCloudTotal] = useState(0);
  const [cloudStats, setCloudStats] = useState({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
  const [cloudCategoryCounts, setCloudCategoryCounts] = useState<Record<string, number>>({});
  const [cloudFacetsComplete, setCloudFacetsComplete] = useState(false);
  const [legacyCardsPending, setLegacyCardsPending] = useState(0);
  const [isMigratingLegacy, setIsMigratingLegacy] = useState(false);
  const [hasNextCloudPage, setHasNextCloudPage] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [cloudReadUnavailable, setCloudReadUnavailable] = useState(false);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() => navigator.onLine);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const [libraryEpochState, setLibraryEpochState] = useState<{ userId: string; value: number } | null>(null);
  const pageCursorsRef = useRef<Array<QueryDocumentSnapshot | null>>([null]);
  const lastCloudQueryKeyRef = useRef('');
  const libraryHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const lastFocusedPageRef = useRef(1);
  const statsLoadedUserRef = useRef<string | null>(null);
  const cardsRef = useRef(cards);
  const imageHydrationAttemptedRef = useRef(new Set<string>());
  const imageHydrationInFlightRef = useRef(new Map<string, Promise<Partial<CardData> | null>>());
  const cardLifecycleVersionRef = useRef(new Map<string, number>());
  const hydrationSessionVersionRef = useRef(0);
  const generationInFlightRef = useRef(false);
  const mirrorSyncInFlightRef = useRef<{ userId: string; promise: Promise<number> } | null>(null);
  const libraryClearInFlightUserRef = useRef<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const recentlyPromotedCardsRef = useRef(new Map<string, CardData>());
  const hasObservedCloudQueryRef = useRef(false);
  const restoringHistoryRef = useRef(false);
  const skipNextUrlSyncRef = useRef(false);
  const viewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const practiceOpenerRef = useRef<HTMLElement | null>(null);
  const statsOpenerRef = useRef<HTMLElement | null>(null);
  const clearOpenerRef = useRef<HTMLElement | null>(null);
  const shareOpenerRef = useRef<HTMLElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const viewStageRef = useRef<HTMLDivElement | null>(null);
  const cardsPerPage = CLOUD_PAGE_SIZE;
  const knownLibraryTotal = user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length;
  const knownLibraryTotalRef = useRef(knownLibraryTotal);
  cardsRef.current = cards;
  knownLibraryTotalRef.current = knownLibraryTotal;
  activeUserIdRef.current = user?.uid ?? null;

  useEffect(() => {
    hydrationSessionVersionRef.current += 1;
    recentlyPromotedCardsRef.current.clear();
  }, [user?.uid]);

  useEffect(() => {
    try {
      if (wordInput) sessionStorage.setItem('lingoflash_word_draft', wordInput);
      else sessionStorage.removeItem('lingoflash_word_draft');
    } catch {
      // A private browser session may deny storage; generation still works in memory.
    }
  }, [wordInput]);

  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: SaveDataConnection }).connection;
    const syncSaveDataPreference = () => {
      if (connection?.saveData) document.documentElement.dataset.saveData = 'true';
      else delete document.documentElement.dataset.saveData;
    };

    syncSaveDataPreference();
    connection?.addEventListener?.('change', syncSaveDataPreference);

    return () => {
      connection?.removeEventListener?.('change', syncSaveDataPreference);
      delete document.documentElement.dataset.saveData;
    };
  }, []);

  useEffect(() => {
    if (isPageLoading || currentPage === lastFocusedPageRef.current) return;
    lastFocusedPageRef.current = currentPage;
    window.requestAnimationFrame(() => {
      libraryHeadingRef.current?.scrollIntoView({ behavior: getReducedMotionScrollBehavior(), block: 'start' });
      libraryHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [currentPage, isPageLoading]);

  const [viewMode, setViewMode] = useState<'library' | 'study' | 'quiz' | 'story' | 'spelling'>('library');
  const viewHeading = {
    library: 'Vocabulary library',
    study: 'Study session',
    quiz: 'Vocabulary quiz',
    spelling: 'Spelling practice',
    story: 'Context story',
  }[viewMode];

  useEffect(() => {
    if (libraryFocusRequest === 0 || viewMode !== 'library' || isLoading) return;
    const heading = libraryHeadingRef.current;
    if (!heading) return;

    const focusHeading = () => {
      if (!heading.isConnected || window.getComputedStyle(heading).visibility === 'hidden') return false;
      heading.focus({ preventScroll: true });
      return document.activeElement === heading;
    };

    if (focusHeading()) return;

    // GSAP briefly hides this container when the promoted card reorders the grid;
    // WebKit ignores focus() while an ancestor has visibility: hidden.
    const animatedHeading = heading.closest('[data-gsap-library-heading]') ?? heading;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(animatedHeading, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, [isLoading, libraryFocusRequest, viewMode]);

  const [studyIndex, setStudyIndex] = useState(0);
  const [studyCards, setStudyCards] = useState<CardData[]>([]);
  const studyCardsRef = useRef(studyCards);
  studyCardsRef.current = studyCards;
  const [recallMode, setRecallMode] = useState<RecallMode>('adaptive');
  const [isRecallRevealed, setIsRecallRevealed] = useState(false);
  const [reviewedCardId, setReviewedCardId] = useState<string | null>(null);
  const pendingReviewIdsRef = useRef(new Set<string>());
  const reviewedCardIdsRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState<{current: number, total: number, word: string} | null>(null);

  useEffect(() => {
    const focusViewHeading = () => viewHeadingRef.current?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(focusViewHeading);
    const settleTimeout = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body || activeElement === practiceOpenerRef.current) {
        focusViewHeading();
      }
    }, motionDurations.emphasis * 1000 + 20);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimeout);
    };
  }, [viewMode]);

  const { streak, xp, xpHistory, level, addXp: handleAddXp } = useGamification(
    user,
    Boolean(user && isCloudBackoffActive(user.uid)),
  );

  // Confirmation state
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Practice Menu
  const [isPracticeMenuOpen, setIsPracticeMenuOpen] = useState(false);

  // Stats Modal
  const [isStatsOpen, setIsStatsOpen] = useState(false);

  // Sharing
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [hasMountedOverlays, setHasMountedOverlays] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('lingoflash_theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    localStorage.setItem('lingoflash_theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  const rememberOpener = (
    ref: React.MutableRefObject<HTMLElement | null>,
    explicitOpener?: HTMLElement | null,
  ) => {
    ref.current = explicitOpener
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setHasMountedOverlays(true);
  };

  const openPracticeMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Safari does not consistently focus buttons on pointer activation, so the
    // event target—not document.activeElement—is the stable return target.
    rememberOpener(practiceOpenerRef, event.currentTarget);
    setIsPracticeMenuOpen(true);
  };

  const openStats = (event: React.MouseEvent<HTMLButtonElement>) => {
    rememberOpener(statsOpenerRef, event.currentTarget);
    setIsStatsOpen(true);
  };

  const openClearConfirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!canStartLibraryClear(isLoading)) return;
    rememberOpener(clearOpenerRef, event.currentTarget);
    setShowClearConfirm(true);
  };

  const updateCategoryFacets = useCallback(async (deltas: Record<string, number>) => {
    if (!db || !user || !isFirebaseConfigured || Object.keys(deltas).length === 0) return;
    const facets = await applyCategoryDeltas(db, user.uid, deltas);
    setCloudCategoryCounts(facets.categories);
    setCloudFacetsComplete(facets.complete);
    localStorage.setItem(cloudFacetsCacheKey(user.uid), JSON.stringify(facets));
  }, [user]);

  const handleMigrateLegacyCards = useCallback(async () => {
    if (!db || !user || !isFirebaseConfigured || isMigratingLegacy) return;
    setIsMigratingLegacy(true);
    setError(null);
    try {
      const result = await migrateLegacyCardQueryFields(db, user.uid, 100);
      setLegacyCardsPending(previous => result.complete ? 0 : Math.max(0, previous - result.migrated));
      if (result.complete) {
        localStorage.setItem(cloudMigrationCacheKey(user.uid), 'true');
        pageCursorsRef.current = [null];
        setCurrentPage(1);
        setCloudRefresh(value => value + 1);
      }
    } catch (migrationError) {
      console.error('Legacy card migration failed', migrationError);
      setError('Could not optimise this legacy card batch. Please try again.');
    } finally {
      setIsMigratingLegacy(false);
    }
  }, [user, isMigratingLegacy]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    const restoreLibraryState = () => {
      const next = readLibraryUrlState();
      restoringHistoryRef.current = true;
      skipNextUrlSyncRef.current = true;
      setSearchQuery(next.search);
      setDebouncedSearch(next.search);
      setActiveCategory(next.category);
      setActiveCustomDeck(next.deck);
      setActiveDifficulty(next.difficulty);
      setActivePartOfSpeech(next.partOfSpeech);
      setShowStarredOnly(next.starred);
      setActiveDate(next.date);
      setCurrentPage(next.page);
      pageCursorsRef.current = [null];
      window.setTimeout(() => {
        restoringHistoryRef.current = false;
      }, 0);
    };
    window.addEventListener('popstate', restoreLibraryState);
    return () => window.removeEventListener('popstate', restoreLibraryState);
  }, []);

  useEffect(() => {
    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false;
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const url = new URL(window.location.href);
      libraryUrlKeys.forEach(key => url.searchParams.delete(key));
      setOptionalUrlParam(url.searchParams, 'q', searchQuery.trim(), '');
      setOptionalUrlParam(url.searchParams, 'category', activeCategory, 'All');
      setOptionalUrlParam(url.searchParams, 'deck', activeCustomDeck, 'All');
      setOptionalUrlParam(url.searchParams, 'difficulty', activeDifficulty, 'All');
      setOptionalUrlParam(url.searchParams, 'pos', activePartOfSpeech, 'All');
      if (showStarredOnly) url.searchParams.set('starred', '1');
      setOptionalUrlParam(url.searchParams, 'date', activeDate, 'All');
      if (currentPage > 1) url.searchParams.set('page', String(currentPage));

      const nextLocation = `${url.pathname}${url.search}${url.hash}`;
      const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextLocation !== currentLocation) {
        window.history.pushState({ ...window.history.state, sonflashLibrary: true }, document.title, nextLocation);
      }
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [searchQuery, activeCategory, activeCustomDeck, activeDifficulty, activePartOfSpeech, showStarredOnly, activeDate, currentPage]);

  useEffect(() => {
    if (!debouncedSearch && activeDifficulty !== 'due') return;
    if (activeDate !== 'All') setActiveDate('All');
    if (activeCategory !== 'All') setActiveCategory('All');
    if (activeCustomDeck !== 'All') setActiveCustomDeck('All');
    if (activePartOfSpeech !== 'All') setActivePartOfSpeech('All');
    if (showStarredOnly) setShowStarredOnly(false);
    if (debouncedSearch && activeDifficulty !== 'All') setActiveDifficulty('All');
  }, [debouncedSearch, activeDifficulty, activeDate, activeCategory, activeCustomDeck, activePartOfSpeech, showStarredOnly]);

  const cloudQueryState = useMemo<CardQueryState>(() => ({
    category: activeCategory === 'All' ? null : activeCategory,
    customDeck: activeCustomDeck === 'All'
      ? null
      : activeCustomDeck === 'Unassigned'
        ? 'unassigned'
        : activeCustomDeck,
    difficulty: activeDifficulty === 'All' ? null : activeDifficulty as CardQueryState['difficulty'],
    partOfSpeech: activePartOfSpeech === 'All' ? null : activePartOfSpeech,
    bookmarkedOnly: showStarredOnly,
    createdDate: dateLabelToQueryDate(activeDate),
    wordPrefix: debouncedSearch,
  }), [activeCategory, activeCustomDeck, activeDifficulty, activePartOfSpeech, showStarredOnly, activeDate, debouncedSearch]);
  const cloudQueryKey = useMemo(() => queryStateKey(cloudQueryState), [cloudQueryState]);

  const getDeviceFallback = useCallback(async (
    filters: CardQueryState,
    page: number,
  ): Promise<{ items: CardData[]; total: number; hasNext: boolean } | null> => {
    if (user) {
      try {
        const mirrorStatus = await getCardMirrorStatus(user.uid);
        if (mirrorStatus?.complete) {
          const mirroredPage = await queryMirroredCardPage(user.uid, filters, page, cardsPerPage);
          return mirroredPage ?? { items: [], total: 0, hasNext: false };
        }
      } catch (mirrorError) {
        console.warn('The IndexedDB card mirror is unavailable; trying the shared device backup.', mirrorError);
      }
    }
    const backup = await loadDeviceCards();
    if (backup?.ownerUserId === undefined
      || !canUseDeviceBackupForSession(backup.ownerUserId, user?.uid ?? null)) return null;
    const allCards = normalizeLocalCards(backup?.cards ?? []);
    if (allCards.length === 0) return null;
    return createLocalCardPage(allCards, filters, page, cardsPerPage);
  }, [cardsPerPage, user]);

  useEffect(() => {
    if (user && !cloudReadUnavailable) return;
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshFromSharedStore = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadDeviceCards().then(backup => {
          if (disposed || !backup) return;
          const sharedCards = normalizeLocalCards(backup.cards);
          if (!user) {
            if (backup.ownerUserId === undefined || !canUseDeviceBackupForSession(backup.ownerUserId, null)) return;
            const visibleCards = overlayRecentlyPromotedCards({
              pageCards: sharedCards,
              promotedCards: [...recentlyPromotedCardsRef.current.values()],
              filters: cloudQueryState,
              page: currentPage,
              pageSize: Math.max(cardsPerPage, sharedCards.length),
            });
            setCards(visibleCards);
            localStorage.setItem('lingoflash_cards', JSON.stringify(visibleCards));
            return;
          }

          if (!cloudReadUnavailable || backup.cloudSync?.userId !== user.uid) return;
          const sharedPage = createLocalCardPage(sharedCards, cloudQueryState, currentPage, cardsPerPage);
          if (sharedPage) {
            const visibleItems = overlayRecentlyPromotedCards({
              pageCards: sharedPage.items,
              promotedCards: [...recentlyPromotedCardsRef.current.values()],
              filters: cloudQueryState,
              page: currentPage,
              pageSize: cardsPerPage,
            });
            setCards(visibleItems);
            localStorage.setItem('lingoflash_cards', JSON.stringify(visibleItems));
            if (cloudReadUnavailable) {
              setCloudTotal(sharedPage.total);
              setHasNextCloudPage(sharedPage.hasNext);
            } else {
              setCloudTotal(previous => Math.max(previous, backup.total));
            }
          } else if (cloudReadUnavailable && currentPage > 1) {
            setCurrentPage(previous => Math.max(1, previous - 1));
          }
        });
      }, 80);
    };

    const unsubscribe = subscribeToDeviceCards(refreshFromSharedStore);
    refreshFromSharedStore();
    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [user, currentPage, cloudQueryKey, cloudReadUnavailable, cardsPerPage]);

  const refreshPendingSyncState = useCallback(async (userId: string): Promise<number> => {
    try {
      const pendingOperations = mergePendingOperations(await loadDevicePending(userId));
      const pendingCount = countPendingSyncOperations(pendingOperations, userId);
      if (activeUserIdRef.current === userId) {
        setPendingSyncCount(pendingCount);
      }
      return pendingCount;
    } catch (pendingError) {
      if (activeUserIdRef.current === userId) {
        setSyncHealthError(getSyncErrorMessage(pendingError));
      }
      return 0;
    }
  }, []);

  const acknowledgeDevicePending = useCallback(async (
    operations: readonly DevicePendingOperation[],
  ): Promise<void> => {
    await acknowledgeStoredDevicePending([...operations]);
    const activeUserId = activeUserIdRef.current;
    if (activeUserId && operations.some(operation => operation.ownerUserId === activeUserId)) {
      await refreshPendingSyncState(activeUserId);
    }
  }, [refreshPendingSyncState]);

  useEffect(() => {
    if (!user) {
      setPendingSyncCount(0);
      setSyncHealthError(null);
      return;
    }
    void refreshPendingSyncState(user.uid);
  }, [user, refreshPendingSyncState]);

  const upsertDeviceCards = useCallback(async (changedCards: CardData[], nextTotal?: number) => {
    if (user && libraryEpochState?.userId !== user.uid) {
      throw new Error('Cloud sync generation is not verified for this account.');
    }
    const activeEpoch = user && libraryEpochState?.userId === user.uid
      ? libraryEpochState.value
      : 0;
    const normalizedChangedCards = normalizeLocalCards(
      changedCards.map(card => ({ ...card, libraryEpoch: activeEpoch })),
    );
    if (normalizedChangedCards.length === 0) return [];
    if (user) {
      try {
        for (let offset = 0; offset < normalizedChangedCards.length; offset += 100) {
          await upsertMirroredCardBatch(user.uid, normalizedChangedCards.slice(offset, offset + 100));
        }
      } catch (mirrorError) {
        console.warn('Cards were queued safely, but the local IndexedDB mirror could not be updated.', mirrorError);
      }
    }
    const queued = await queueDeviceUpserts(
      normalizedChangedCards.map(normalizeCardForStorage),
      Math.max(nextTotal ?? 0, normalizedChangedCards.length),
      user?.uid,
    );
    if (user) void refreshPendingSyncState(user.uid);
    return queued;
  }, [user, libraryEpochState, refreshPendingSyncState]);

  const patchDeviceCards = useCallback(async (
    changes: readonly { card: CardData; fields: Partial<CardData> }[],
    nextTotal?: number,
  ) => {
    if (user && libraryEpochState?.userId !== user.uid) {
      throw new Error('Cloud sync generation is not verified for this account.');
    }
    const activeEpoch = user && libraryEpochState?.userId === user.uid
      ? libraryEpochState.value
      : 0;
    const normalizedChanges = changes.flatMap(({ card, fields }) => {
      const normalizedCard = normalizeCardForStorage({ ...card, libraryEpoch: activeEpoch });
      const normalizedFields = Object.fromEntries(
        (Object.keys(fields) as Array<keyof CardData>).flatMap(key =>
          normalizedCard[key] === undefined ? [] : [[key, normalizedCard[key]]]),
      ) as Partial<CardData>;
      return Object.keys(normalizedFields).length > 0
        ? [{ card: normalizedCard, fields: normalizedFields }]
        : [];
    });
    if (normalizedChanges.length === 0) return [];
    if (user) {
      try {
        for (let offset = 0; offset < normalizedChanges.length; offset += 100) {
          await patchMirroredCardBatch(
            user.uid,
            normalizedChanges.slice(offset, offset + 100).map(change => ({
              cardId: change.card.id,
              fields: change.fields,
            })),
          );
        }
      } catch (mirrorError) {
        console.warn('Card patches were queued safely, but the local IndexedDB mirror could not be updated.', mirrorError);
      }
    }
    const queued = await queueDevicePatches(
      normalizedChanges,
      Math.max(nextTotal ?? 0, normalizedChanges.length),
      user?.uid,
    );
    if (user) void refreshPendingSyncState(user.uid);
    return queued;
  }, [user, libraryEpochState, refreshPendingSyncState]);

  const removeDeviceCard = useCallback(async (cardId: string, _nextTotal?: number) => {
    if (user && libraryEpochState?.userId !== user.uid) {
      throw new Error('Cloud sync generation is not verified for this account.');
    }
    const activeEpoch = user && libraryEpochState?.userId === user.uid
      ? libraryEpochState.value
      : 0;
    const sourceCard = cardsRef.current.find(card => card.id === cardId)
      ?? studyCardsRef.current.find(card => card.id === cardId);
    const queued = await queueDeviceDeletes([cardId], user?.uid, {
      libraryEpoch: activeEpoch,
      baseRevisions: { [cardId]: sourceCard?.revision ?? 0 },
    });
    if (user) {
      try {
        await deleteMirroredCard(user.uid, cardId);
      } catch (mirrorError) {
        console.warn('The card delete was queued, but the local IndexedDB mirror could not be updated.', mirrorError);
      }
    }
    if (user) void refreshPendingSyncState(user.uid);
    return queued;
  }, [user, libraryEpochState, refreshPendingSyncState]);

  const flushDevicePendingToCloud = useCallback(async () => {
    if (
      !db
      || !user
      || !isFirebaseConfigured
      || isCloudBackoffActive(user.uid)
    ) return;
    if (libraryEpochState?.userId !== user.uid) {
      setSyncHealthError('Cloud generation could not be verified; changes remain safe on this device.');
      await refreshPendingSyncState(user.uid);
      return;
    }
    const database = db;
    const currentUser = user;
    const acquiredFlushLease = await acquireDevicePendingFlush(currentUser.uid);
    if (!acquiredFlushLease) {
      await refreshPendingSyncState(currentUser.uid);
      return;
    }
    setIsDeviceSyncing(true);
    setSyncHealthError(null);
    try {
      const pending = mergePendingOperations(await loadDevicePending(currentUser.uid))
        .filter(operation => operation.ownerUserId === currentUser.uid);
      const epochPlan = partitionPendingOperationsByLibraryEpoch(
        pending,
        libraryEpochState.value,
      );
      if (epochPlan.stale.length > 0) {
        await acknowledgeDevicePending(epochPlan.stale);
      }
      if (
        epochPlan.future.length > 0
        && isActiveUserSession(currentUser.uid, activeUserIdRef.current)
      ) {
        setSyncHealthError(
          'Some queued changes belong to a newer library generation. They remain on this device until cloud state is verified.',
        );
      }
      if (epochPlan.current.length === 0) return;
      const verification = await verifyPendingCardOperations(
        epochPlan.current,
        card => findCardByNormalizedWord(
          database,
          currentUser.uid,
          card.normalizedWord || card.word,
        ),
      );
      const flushedOperations = [...verification.operationsAlreadyExisting];
      for (let index = 0; index < verification.operationsAlreadyExisting.length; index += 1) {
        const operation = verification.operationsAlreadyExisting[index];
        const existingCard = verification.existingCards[index];
        if (operation.type !== 'upsert') continue;
        if (operation.card.id !== existingCard.id) {
          await deleteMirroredCard(currentUser.uid, operation.card.id);
        }
        await upsertMirroredCardBatch(currentUser.uid, [existingCard]);
      }
      const { creates, deletes, patches } = partitionPendingOperationsForFlush(verification.operationsToWrite);
      for (const create of creates) {
        const result = await createCardIfAbsent(
          database,
          currentUser.uid,
          create.card,
          {
            libraryEpoch: libraryEpochState.value,
            baseRevision: create.baseRevision,
            opId: create.opId,
          },
        );
        if (!result.created && create.card.id !== result.card.id) {
          await deleteMirroredCard(currentUser.uid, create.card.id);
        }
        await upsertMirroredCardBatch(currentUser.uid, [result.card]);
        flushedOperations.push(create);
      }
      for (const deletion of deletes) {
        const result = await deleteCardWithConflictRecovery({
          cardId: deletion.cardId,
          opId: deletion.opId ?? `legacy-delete-${deletion.cardId}-${deletion.updatedAt}`,
          libraryEpoch: deletion.libraryEpoch ?? 0,
          baseRevision: deletion.baseRevision ?? 0,
        }, command => deleteCardWithTombstone(database, currentUser.uid, command));
        if (result.deleted || result.reason === 'stale-library-epoch') {
          flushedOperations.push(deletion);
        } else if (isActiveUserSession(currentUser.uid, activeUserIdRef.current)) {
          setError(result.reason === 'future-library-epoch'
            ? 'Cloud library generation changed. Your delete is still queued while sync state refreshes.'
            : 'The card changed again while deletion was being recovered. The delete remains queued.');
        }
      }
      for (const patch of patches) {
        const fieldMask = patch.fieldMask
          ?? Object.keys(patch.fields) as Array<keyof CardData>;
        const maskedFields = selectMutableCardPatch(patch.fields, fieldMask);
        const result = await applyCardPatchWithConflictRecovery({
          cardId: patch.cardId,
          fields: patch.fields,
          fieldMask,
          baseRevision: patch.baseRevision ?? 0,
          libraryEpoch: patch.libraryEpoch ?? 0,
        }, command => applyCardPatchIfCurrent(database, currentUser.uid, command));
        if (result.applied) {
          const updatedAt = new Date().toISOString();
          const metadata = {
            revision: result.revision,
            libraryEpoch: patch.libraryEpoch ?? libraryEpochState.value,
            updatedAt,
          };
          const advanceCard = (card: CardData) => card.id === patch.cardId
            ? applySuccessfulPatchMetadata(card, patch.fields, metadata, fieldMask)
            : card;
          await patchMirroredCardBatch(currentUser.uid, [{
            cardId: patch.cardId,
            fields: {
              ...maskedFields,
              schemaVersion: 2,
              revision: result.revision,
              libraryEpoch: metadata.libraryEpoch,
              updatedAt,
            },
          }]);
          if (isActiveUserSession(currentUser.uid, activeUserIdRef.current)) {
            setCards(previous => previous.map(advanceCard));
            setStudyCards(previous => previous.map(advanceCard));
          }
          flushedOperations.push(patch);
        } else if (result.reason === 'stale-library-epoch') {
          flushedOperations.push(patch);
        } else if (result.reason === 'missing') {
          await deleteMirroredCard(currentUser.uid, patch.cardId);
          if (isActiveUserSession(currentUser.uid, activeUserIdRef.current)) {
            setCards(previous => previous.filter(card => card.id !== patch.cardId));
            setStudyCards(previous => previous.filter(card => card.id !== patch.cardId));
          }
          flushedOperations.push(patch);
        } else if (isActiveUserSession(currentUser.uid, activeUserIdRef.current)) {
          setError(result.reason === 'future-library-epoch'
            ? 'Cloud library generation changed. Your local change is still queued while sync state refreshes.'
            : 'The card changed again during conflict recovery. Your local change remains safely queued.');
        }
      }
      await acknowledgeDevicePending(flushedOperations);
      if (isActiveUserSession(currentUser.uid, activeUserIdRef.current)) {
        if (epochPlan.future.length === 0) setSyncHealthError(null);
        setCloudReadUnavailable(false);
        if (shouldResetLibraryPageAfterSync(flushedOperations)) {
          pageCursorsRef.current = [null];
          setCurrentPage(1);
        }
        setCloudRefresh(previous => previous + 1);
        if (verification.operationsAlreadyExisting.length > 0) {
          setNotice('An existing cloud card was restored instead of creating a duplicate.');
        }
      }
    } catch (syncError) {
      console.warn('Pending local changes could not be synced to Firebase yet.', syncError);
      if (isQuotaError(syncError)) {
        localStorage.setItem(cloudBackoffCacheKey(currentUser.uid), String(Date.now() + 5 * 60 * 1000));
      }
      if (isActiveUserSession(currentUser.uid, activeUserIdRef.current)) {
        setSyncHealthError(getSyncErrorMessage(syncError));
        setCloudReadUnavailable(true);
      }
    } finally {
      await releaseDevicePendingFlush(currentUser.uid);
      await refreshPendingSyncState(currentUser.uid);
      if (isActiveUserSession(currentUser.uid, activeUserIdRef.current)) {
        setIsDeviceSyncing(false);
      }
    }
  }, [user, libraryEpochState, acknowledgeDevicePending, refreshPendingSyncState]);

  useEffect(() => {
    if (!user || !db || !isFirebaseConfigured) return;
    const tryFlush = () => {
      void flushDevicePendingToCloud();
    };
    tryFlush();
    window.addEventListener('focus', tryFlush);
    const intervalId = window.setInterval(tryFlush, 60 * 1000);
    return () => {
      window.removeEventListener('focus', tryFlush);
      window.clearInterval(intervalId);
    };
  }, [user, flushDevicePendingToCloud]);

  const syncCardMirror = useCallback(async (force = false): Promise<number> => {
    if (!db || !user || !isFirebaseConfigured) return 0;
    const database = db;
    const userId = user.uid;
    if (libraryClearInFlightUserRef.current === userId) return 0;
    const existingSync = mirrorSyncInFlightRef.current;
    if (existingSync?.userId === userId) return existingSync.promise;

    const expectedTotal = Math.max(cloudTotal, cloudStats.total, cards.length);
    const syncPromise = (async () => {
      if (isCloudBackoffActive(userId)) {
        throw new Error('Cloud reads are temporarily paused.');
      }
      const currentStatus = await getCardMirrorStatus(userId);
      if (!force && isCardMirrorFresh(currentStatus, expectedTotal) && currentStatus) {
        return currentStatus.loaded;
      }

      const generation = await beginCardMirrorSync(userId, expectedTotal);
      const loaded = await streamAllCardsInBatches(
        database,
        userId,
        page => upsertMirroredCardBatch(userId, page, generation),
        100,
      );
      const pendingOperations = mergePendingOperations(await loadDevicePending(userId))
        .filter(operation => !operation.ownerUserId || operation.ownerUserId === userId);
      const pendingUpserts = pendingOperations.flatMap(operation => operation.type === 'upsert' ? [operation.card] : []);
      for (let offset = 0; offset < pendingUpserts.length; offset += 100) {
        await upsertMirroredCardBatch(userId, pendingUpserts.slice(offset, offset + 100), generation);
      }
      const pendingPatches = pendingOperations.flatMap(operation => operation.type === 'patch'
        ? [{ cardId: operation.cardId, fields: operation.fields }]
        : []);
      for (let offset = 0; offset < pendingPatches.length; offset += 100) {
        await patchMirroredCardBatch(userId, pendingPatches.slice(offset, offset + 100), generation);
      }
      for (const operation of pendingOperations) {
        if (operation.type === 'delete') await deleteMirroredCard(userId, operation.cardId);
      }
      await finishCardMirrorSync(userId, generation, loaded);
      if (activeUserIdRef.current === userId) {
        setCloudTotal(previous => Math.max(previous, loaded));
        setCloudRefresh(previous => previous + 1);
      }
      return loaded;
    })();

    mirrorSyncInFlightRef.current = { userId, promise: syncPromise };
    try {
      return await syncPromise;
    } finally {
      if (mirrorSyncInFlightRef.current?.promise === syncPromise) {
        mirrorSyncInFlightRef.current = null;
      }
    }
  }, [user, cloudTotal, cloudStats.total, cards.length]);

  useEffect(() => {
    if (!user || !isBrowserOnline || isCloudBackoffActive(user.uid)) return;
    void syncCardMirror(false).catch(mirrorError => {
      console.warn('The full IndexedDB card mirror will retry when cloud reads are available.', mirrorError);
    });
  }, [user, isBrowserOnline, syncCardMirror]);

  // Load and listen to user session
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      const localCards = normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
      setCards(selectCardsVisibleForSession(localCards, localStorage.getItem(localCardsOwnerKey), null));
      setIsAuthLoading(false);
      return;
    }
    
    const authTimeout = window.setTimeout(() => {
      setIsAuthLoading(false);
      setAuthError('Cloud authentication is taking longer than expected. You can keep using cached data and try signing in again.');
    }, 8000);
    let authSessionVersion = 0;
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      const sessionVersion = ++authSessionVersion;
      window.clearTimeout(authTimeout);
      if (activeUserIdRef.current !== (currentUser?.uid ?? null)) {
        setIsLoading(false);
        setIsDeviceSyncing(false);
        setPendingSyncCount(0);
        setSyncHealthError(null);
      }
      setAuthError(null);
      if (currentUser) {
        let currentLibraryEpoch: number | null = readCachedLibraryEpoch(currentUser.uid);
        if (db) {
          try {
            currentLibraryEpoch = await getLibraryEpoch(db, currentUser.uid);
            cacheLibraryEpoch(currentUser.uid, currentLibraryEpoch);
          } catch (epochError) {
            console.warn('The library generation could not be loaded; cloud writes remain paused unless a verified cached epoch exists.', epochError);
          }
        }
        if (sessionVersion !== authSessionVersion) return;
        setUser(currentUser);
        setLibraryEpochState(currentLibraryEpoch === null
          ? null
          : { userId: currentUser.uid, value: currentLibraryEpoch });
        if (currentLibraryEpoch === null) {
          setAuthError('Cloud sync safety could not be verified. Your library remains readable, but changes are paused until Firebase reconnects.');
        }
        const localCards = normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
        const sessionPlan = planCardsForSignedInSession(
          localCards,
          localStorage.getItem(localCardsOwnerKey),
          currentUser.uid,
        );
        const localDecks = normalizeCustomDeckCollection(readLocalJson<unknown>('lingoflash_custom_decks', []));
        const deckSessionPlan = planCardsForSignedInSession(
          localDecks,
          localStorage.getItem(localDecksOwnerKey),
          currentUser.uid,
        );
        if (sessionPlan.discardLocalCache) {
          localStorage.removeItem('lingoflash_cards');
        } else if (sessionPlan.visibleCards.length > 0) {
          localStorage.setItem('lingoflash_cards', JSON.stringify(sessionPlan.visibleCards));
        }
        localStorage.setItem(localCardsOwnerKey, currentUser.uid);
        setCards(sessionPlan.visibleCards);
        if (sessionPlan.cardsToMigrate.length > 0 && currentLibraryEpoch !== null) {
          await queueDeviceUpserts(
            sessionPlan.cardsToMigrate.map(card => normalizeCardForStorage({
              ...card,
              libraryEpoch: currentLibraryEpoch,
            })),
            sessionPlan.cardsToMigrate.length,
            currentUser.uid,
          );
          void refreshPendingSyncState(currentUser.uid);
          setNotice(`${sessionPlan.cardsToMigrate.length} local card${sessionPlan.cardsToMigrate.length === 1 ? '' : 's'} queued for secure cloud sync.`);
        }
        if (deckSessionPlan.discardLocalCache) {
          localStorage.removeItem('lingoflash_custom_decks');
        } else {
          localStorage.setItem('lingoflash_custom_decks', JSON.stringify(deckSessionPlan.visibleCards));
        }
        localStorage.setItem(localDecksOwnerKey, currentUser.uid);
        setCustomDecks(deckSessionPlan.visibleCards);
        if (db && deckSessionPlan.cardsToMigrate.length > 0) {
          void setDoc(
            doc(db, 'users', currentUser.uid, 'profile', 'custom_decks'),
            { decks: arrayUnion(...deckSessionPlan.cardsToMigrate) },
            { merge: true },
          ).catch(deckMigrationError => console.warn('Local deck migration is queued for retry.', deckMigrationError));
        }
        setCloudTotal(0);
        setCloudCategoryCounts({});
        setCloudFacetsComplete(false);
        setLegacyCardsPending(0);
        pageCursorsRef.current = [null];
        setCurrentPage(1);
      } else {
        setUser(null);
        setLibraryEpochState(null);
        const localCards = normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
        setCards(selectCardsVisibleForSession(localCards, localStorage.getItem(localCardsOwnerKey), null));
        setCustomDecks([]);
        setCloudCategoryCounts({});
        setCloudFacetsComplete(false);
        setLegacyCardsPending(0);
      }
      if (sessionVersion === authSessionVersion) setIsAuthLoading(false);
      
    }, authStateError => {
      window.clearTimeout(authTimeout);
      setIsAuthLoading(false);
      setAuthError(authStateError.message || 'Could not restore your cloud session.');
    });

    return () => {
      window.clearTimeout(authTimeout);
      unsubscribeAuth();
    };
  }, [refreshPendingSyncState]);

  // Subscribe to exactly one bounded Firestore page. This keeps browsers in sync
  // without attaching a listener to the entire library.
  useEffect(() => {
    if (!db || !user || !isFirebaseConfigured) return;
    const database = db;
    if (lastCloudQueryKeyRef.current !== cloudQueryKey) {
      lastCloudQueryKeyRef.current = cloudQueryKey;
      pageCursorsRef.current = [null];
      if (currentPage !== 1) {
        setCurrentPage(1);
        return;
      }
    }
    let cancelled = false;
    let unsubscribePage: (() => void) | null = null;
    let initialPageResolved = false;
    let initialLoadComplete = false;
    let pendingRealtimePage: RealtimeCardPage | null = null;
    let activeTotal = cloudTotal;
    let countRefreshInFlight = false;
    const sessionStillActive = () => !cancelled && activeUserIdRef.current === user.uid;

    const isDefaultLibraryQuery = currentPage === 1 && cloudQueryState.wordPrefix === '' &&
      !cloudQueryState.category && !cloudQueryState.customDeck && !cloudQueryState.difficulty &&
      !cloudQueryState.partOfSpeech && !cloudQueryState.bookmarkedOnly && !cloudQueryState.createdDate;

    const applyCloudPage = async (page: RealtimeCardPage, total: number, countedAt: string | null) => {
      if (!sessionStillActive()) return;
      const pendingOperations = mergePendingOperations(await loadDevicePending(user.uid))
        .filter(operation => operation.ownerUserId === user.uid);
      if (!sessionStillActive()) return;
      const visibleItems = overlayRecentlyPromotedCards({
        pageCards: overlayPendingCardsOnPage({
          cloudCards: page.items,
          pendingOperations,
          filters: cloudQueryState,
          page: currentPage,
          pageSize: cardsPerPage,
        }),
        promotedCards: [...recentlyPromotedCardsRef.current.values()],
        filters: cloudQueryState,
        page: currentPage,
        pageSize: cardsPerPage,
      });
      const inferredMinimum = ((currentPage - 1) * cardsPerPage) + visibleItems.length + (page.hasNext ? 1 : 0);
      const safeTotal = Math.max(total, activeTotal, inferredMinimum);
      activeTotal = safeTotal;
      setCards(visibleItems);
      void upsertMirroredCardBatch(user.uid, visibleItems).catch(mirrorError => {
        console.warn('The visible cloud page could not be written to the IndexedDB mirror.', mirrorError);
      });
      persistLocalCardBackup(visibleItems, cardsPerPage, safeTotal, user.uid);
      localStorage.removeItem(cloudBackoffCacheKey(user.uid));
      setCloudReadUnavailable(false);
      setCloudTotal(safeTotal);
      setHasNextCloudPage(page.hasNext);
      localStorage.setItem(cloudPageCacheKey(user.uid), JSON.stringify({
        queryKey: cloudQueryKey,
        page: currentPage,
        total: safeTotal,
        hasNext: page.hasNext,
        items: visibleItems,
        updatedAt: new Date().toISOString(),
        countedAt,
      } satisfies CachedCloudPage));
      if (isDefaultLibraryQuery) {
        setCloudStats(previous => previous.total > 0
          ? { ...previous, total: safeTotal }
          : { ...previous, total: safeTotal, unrated: safeTotal });
      }
      if (page.hasNext && page.lastCursor) {
        pageCursorsRef.current[currentPage] = page.lastCursor;
      } else {
        pageCursorsRef.current.length = currentPage;
      }
    };

    const applyRealtimePage = async (page: RealtimeCardPage) => {
      if (!sessionStillActive()) return;
      let total = activeTotal;
      const cachedRealtimeCount = readCachedCloudTotal(user.uid, cloudQueryKey);
      let countedAt: string | null = cachedRealtimeCount?.cachedAt
        ? new Date(cachedRealtimeCount.cachedAt).toISOString()
        : null;
      const needsCountRefresh = !page.fromCache && !page.hasPendingWrites &&
        shouldRefreshCountForRealtimeChanges(false, page.changeTypes);
      if (needsCountRefresh && !countRefreshInFlight) {
        countRefreshInFlight = true;
        try {
          total = await countCards(database, user.uid, cloudQueryState);
          countedAt = new Date().toISOString();
        } catch (countError) {
          console.warn('Realtime count refresh unavailable; retaining the bounded page.', countError);
        } finally {
          countRefreshInFlight = false;
        }
      }
      await applyCloudPage(page, total, countedAt);
    };

    const loadPage = async () => {
      let mirroredPage: Awaited<ReturnType<typeof queryMirroredCardPage>> = null;
      let mirrorIsComplete = false;
      try {
        const mirrorStatus = await getCardMirrorStatus(user.uid);
        mirrorIsComplete = Boolean(mirrorStatus?.complete);
        if (mirrorIsComplete) {
          mirroredPage = await queryMirroredCardPage(user.uid, cloudQueryState, currentPage, cardsPerPage);
          if (mirroredPage && !cancelled) {
            activeTotal = Math.max(activeTotal, mirroredPage.total);
            setCards(mirroredPage.items);
            setCloudTotal(mirroredPage.total);
            setHasNextCloudPage(mirroredPage.hasNext);
            setIsPageLoading(false);
          }
        }
      } catch (mirrorError) {
        console.warn('The local IndexedDB page is unavailable; loading the visible cloud page.', mirrorError);
      }

      if (isCloudBackoffActive(user.uid)) {
        setIsPageLoading(false);
        setCloudReadUnavailable(true);
        const deviceFallback = mirroredPage
          ?? await getDeviceFallback(cloudQueryState, currentPage)
          ?? getBoundedCloudFallback(user.uid, cloudQueryKey, currentPage, cloudQueryState, cardsPerPage);
        if (!sessionStillActive()) return;
        if (deviceFallback) {
          setCards(deviceFallback.items);
          persistLocalCardBackup(deviceFallback.items, cardsPerPage, deviceFallback.total, user.uid);
          setCloudTotal(deviceFallback.total);
          setHasNextCloudPage(deviceFallback.hasNext);
          localStorage.setItem(cloudPageCacheKey(user.uid), JSON.stringify({
            queryKey: cloudQueryKey,
            page: currentPage,
            ...deviceFallback,
            updatedAt: new Date().toISOString(),
            countedAt: null,
          } satisfies CachedCloudPage));
          setCloudStats(previous => previous.total > 0 ? previous : { ...previous, total: deviceFallback.total, unrated: deviceFallback.total });
          setError('Firebase has reached today’s read quota. Showing the shared local copy on this device.');
        } else {
          if (currentPage > 1) {
            setCurrentPage(previous => Math.max(1, previous - 1));
            return;
          }
          setCards([]);
          setHasNextCloudPage(false);
          setError('Firebase has reached today’s read quota and this device has no local copy for the current filter.');
        }
        return;
      }
      const cursor = pageCursorsRef.current[currentPage - 1];
      if (currentPage > 1 && cursor === undefined) {
        setIsPageLoading(false);
        if (mirrorIsComplete && mirroredPage) return;
        setCurrentPage(previous => Math.max(1, previous - 1));
        return;
      }
      setIsPageLoading(!mirroredPage);
      setError(null);
      try {
        const cachedCount = readCachedCloudTotal(user.uid, cloudQueryKey);
        const refreshCount = shouldRefreshCloudCount({
          page: currentPage,
          cachedAt: cachedCount?.cachedAt ?? null,
        });
        const initialPagePromise = new Promise<RealtimeCardPage>((resolve, reject) => {
          unsubscribePage = subscribeCardPage(
            { db: database, userId: user.uid, filters: cloudQueryState, cursor },
            page => {
              if (!initialPageResolved) {
                initialPageResolved = true;
                resolve(page);
                return;
              }
              if (!initialLoadComplete) {
                pendingRealtimePage = page;
                return;
              }
              void applyRealtimePage(page);
            },
            listenerError => {
              if (!initialPageResolved) {
                reject(listenerError);
                return;
              }
              console.warn('Realtime page listener paused.', listenerError);
              if (isQuotaError(listenerError)) {
                localStorage.setItem(cloudBackoffCacheKey(user.uid), String(Date.now() + 5 * 60 * 1000));
                setCloudReadUnavailable(true);
              }
            },
          );
        });
        const [pageResult, totalResult] = await Promise.allSettled([
          initialPagePromise,
          refreshCount
            ? countCards(database, user.uid, cloudQueryState)
            : Promise.resolve(cachedCount?.total ?? cloudTotal),
        ]);
        if (pageResult.status === 'rejected') throw pageResult.reason;
        const page = pageResult.value;
        const fallbackTotal = cachedCount?.total ?? cloudTotal;
        const total = totalResult.status === 'fulfilled'
          ? totalResult.value
          : fallbackTotal > 0
            ? fallbackTotal
            : ((currentPage - 1) * cardsPerPage) + page.items.length + (page.hasNext ? 1 : 0);

        if (!sessionStillActive()) return;
        if (page.items.length === 0 && currentPage > 1 && !page.hasNext) {
          setCurrentPage(previous => Math.max(1, previous - 1));
          return;
        }
        await applyCloudPage(page, total, refreshCount
          ? new Date().toISOString()
          : cachedCount?.cachedAt
            ? new Date(cachedCount.cachedAt).toISOString()
            : null);
        initialLoadComplete = true;
        if (pendingRealtimePage) {
          const queuedPage = pendingRealtimePage;
          pendingRealtimePage = null;
          void applyRealtimePage(queuedPage);
        }
        if (isDefaultLibraryQuery && total > 0 && localStorage.getItem(cloudMigrationCacheKey(user.uid)) !== 'true') {
          const pageableCount = await countPageableCards(database, user.uid);
          if (cancelled) return;
          setLegacyCardsPending(current => Math.max(current, total - pageableCount));
          if (pageableCount === total) localStorage.setItem(cloudMigrationCacheKey(user.uid), 'true');
        }
      } catch (pageError) {
        if (cancelled) return;
        console.warn('Cloud page unavailable; trying the bounded local cache.', pageError);
        if (isQuotaError(pageError)) {
          localStorage.setItem(cloudBackoffCacheKey(user.uid), String(Date.now() + 5 * 60 * 1000));
        }
        setCloudReadUnavailable(true);
        const deviceFallback = await getDeviceFallback(cloudQueryState, currentPage)
          ?? getBoundedCloudFallback(user.uid, cloudQueryKey, currentPage, cloudQueryState, cardsPerPage);
        if (!sessionStillActive()) return;

        if (deviceFallback) {
          setCards(deviceFallback.items);
          persistLocalCardBackup(deviceFallback.items, cardsPerPage, deviceFallback.total, user.uid);
          setCloudTotal(deviceFallback.total);
          setHasNextCloudPage(deviceFallback.hasNext);
          localStorage.setItem(cloudPageCacheKey(user.uid), JSON.stringify({
            queryKey: cloudQueryKey,
            page: currentPage,
            ...deviceFallback,
            updatedAt: new Date().toISOString(),
            countedAt: null,
          } satisfies CachedCloudPage));
          setCloudStats(previous => previous.total > 0 ? previous : { ...previous, total: deviceFallback.total, unrated: deviceFallback.total });
          const fallbackCategories = deviceFallback.items.reduce<Record<string, number>>((counts, card) => {
            const category = card.category || 'Other';
            counts[category] = (counts[category] || 0) + 1;
            return counts;
          }, {});
          setCloudCategoryCounts(previous => Object.keys(previous).length > 0 ? previous : fallbackCategories);
          setError(isQuotaError(pageError)
            ? 'Firebase has reached today’s read quota. Showing the shared local copy on this device.'
            : 'The network or Firebase is temporarily unavailable. Showing the shared local copy on this device.');
        } else {
          if (currentPage > 1) {
            setCurrentPage(previous => Math.max(1, previous - 1));
            return;
          }
          setCards([]);
          setHasNextCloudPage(false);
          setError(isQuotaError(pageError)
            ? 'Firebase has reached today’s read quota and this page is not cached on the device.'
            : 'Could not load this card page. The filter may need a Firestore index or a working network connection.');
        }
      } finally {
        if (!cancelled) setIsPageLoading(false);
      }
    };

    void loadPage();
    return () => {
      cancelled = true;
      unsubscribePage?.();
    };
  }, [user, currentPage, cloudQueryKey, cloudRefresh, getDeviceFallback]);

  useEffect(() => {
    statsLoadedUserRef.current = null;
    if (!user) return;
    const cachedStats = readCachedCloudStats(user.uid);
    if (cachedStats) {
      setCloudStats(cachedStats.stats);
      setLegacyCardsPending(current => Math.max(current, cachedStats.stats.legacyUnindexed));
      if (!shouldRefreshCloudStats(cachedStats.cachedAt)) statsLoadedUserRef.current = user.uid;
    }
  }, [user]);

  useEffect(() => {
    if (!db || !user || !isFirebaseConfigured || !isStatsOpen || statsLoadedUserRef.current === user.uid || isCloudBackoffActive(user.uid)) return;
    let cancelled = false;
    fetchLibraryStats(db, user.uid)
      .then(stats => {
        if (!cancelled) {
          statsLoadedUserRef.current = user.uid;
          setCloudStats(stats);
          setLegacyCardsPending(current => Math.max(current, stats.legacyUnindexed));
          localStorage.setItem(cloudStatsCacheKey(user.uid), JSON.stringify({
            stats,
            updatedAt: new Date().toISOString(),
          } satisfies CachedCloudStats));
        }
      })
      .catch(statsError => {
        if (!cancelled) {
          console.warn('Exact cloud statistics are temporarily unavailable.', statsError);
          setError(isQuotaError(statsError)
            ? 'Firebase has reached today’s read quota; Insights is using cached metrics.'
            : 'Could not refresh insights; cached metrics are being used.');
        }
      });
    return () => { cancelled = true; };
  }, [user, isStatsOpen]);

  useEffect(() => {
    if (!db || !user || !isFirebaseConfigured) return;
    const cachedFacets = readLocalJson<unknown>(cloudFacetsCacheKey(user.uid), null);
    if (cachedFacets && typeof cachedFacets === 'object' && !Array.isArray(cachedFacets)) {
      const source = cachedFacets as { categories?: unknown; complete?: unknown };
      if (source.categories && typeof source.categories === 'object' && !Array.isArray(source.categories)) {
        setCloudCategoryCounts(source.categories as Record<string, number>);
        setCloudFacetsComplete(source.complete === true);
      }
    }
    if (isCloudBackoffActive(user.uid)) return;
    return onSnapshot(
      doc(db, 'users', user.uid, 'profile', 'library_facets'),
      snapshot => {
        const data = snapshot.data();
        const rawCategories = data?.categories;
        const categories = rawCategories && typeof rawCategories === 'object' && !Array.isArray(rawCategories)
          ? rawCategories as Record<string, number>
          : {};
        const facets = { categories, complete: data?.complete === true };
        setCloudCategoryCounts(categories);
        setCloudFacetsComplete(facets.complete);
        localStorage.setItem(cloudFacetsCacheKey(user.uid), JSON.stringify(facets));
      },
      facetError => console.warn('Cloud category facets are temporarily unavailable; using cache.', facetError),
    );
  }, [user]);

  // Save custom decks local backup
  useEffect(() => {
    if (user && localStorage.getItem(localDecksOwnerKey) === user.uid) {
      localStorage.setItem('lingoflash_custom_decks', JSON.stringify(customDecks));
    }
  }, [customDecks, user]);

  // Sync custom decks from cloud
  useEffect(() => {
    if (!db || !user || !isFirebaseConfigured) return;
    if (isCloudBackoffActive(user.uid)) return;
    const decksRef = doc(db, 'users', user.uid, 'profile', 'custom_decks');
    return onSnapshot(decksRef, snapshot => {
      if (snapshot.exists()) {
        const rawDecks = snapshot.data()?.decks;
        const decks = normalizeCustomDeckCollection(rawDecks);
        setCustomDecks(decks);
        localStorage.setItem(localDecksOwnerKey, user.uid);
        return;
      }
      const localDecks = localStorage.getItem(localDecksOwnerKey) === user.uid
        ? readLocalJson<unknown>('lingoflash_custom_decks', [])
        : [];
      const normalizedLocalDecks = normalizeCustomDeckCollection(localDecks);
      if (normalizedLocalDecks.length > 0) {
        void setDoc(decksRef, { decks: normalizedLocalDecks });
      } else {
        setCustomDecks([]);
      }
    }, syncError => console.error('Failed to sync custom decks', syncError));
  }, [user]);

  // Keep local storage cards in sync as offline backup when working offline/online
  useEffect(() => {
    if (!isAuthLoading && !user && !authError) {
      localStorage.removeItem(localCardsOwnerKey);
      localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    }
  }, [cards, user, isAuthLoading, authError]);

  useEffect(() => {
    if (isAuthLoading || user || cards.length > 0) return;
    let cancelled = false;
    loadDeviceCards().then(backup => {
      if (cancelled || !backup || backup.cards.length === 0) return;
      if (backup.ownerUserId === undefined || !canUseDeviceBackupForSession(backup.ownerUserId, null)) return;
      const localCards = normalizeLocalCards(backup.cards);
      setCards(localCards);
      localStorage.setItem('lingoflash_cards', JSON.stringify(localCards));
    });
    return () => { cancelled = true; };
  }, [cards.length, isAuthLoading, user]);

  // Handle Share link logic
  useEffect(() => {
    const checkSharedDeck = async () => {
      const params = new URLSearchParams(window.location.search);
      const shareId = params.get('share');
      if (!shareId || !db) return;
      const database = db;

      try {
        const docRef = doc(database, 'shared_decks', shareId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          const sharedCards = Array.isArray(data.cards) ? data.cards.slice(0, 100) : [];
          const catName = typeof data.category === 'string' ? data.category.slice(0, 128) : 'Shared';
          
          if (window.confirm(`Do you want to download the deck "${catName}" with ${sharedCards.length} words?`)) {
            const candidateCards: CardData[] = dedupeCardsByNormalizedWord(sharedCards
              .filter((c: unknown): c is Partial<CardData> => Boolean(c && typeof c === 'object'))
              .filter(c => typeof c.word === 'string' && typeof c.translation === 'string')
              .map(c => {
                const normalizedWord = normalizeCardWord(c.word!).slice(0, 80);
                return normalizeCardForStorage({
              word: normalizedWord,
              normalizedWord,
              translation: c.translation!.slice(0, 256),
              explanation: typeof c.explanation === 'string' ? c.explanation.slice(0, 2048) : '',
              phonetic: typeof c.phonetic === 'string' ? c.phonetic.slice(0, 256) : '',
              category: typeof c.category === 'string' ? c.category.slice(0, 128) : 'Shared',
              partOfSpeech: normalizePartOfSpeech(c.partOfSpeech),
              emoji: typeof c.emoji === 'string' ? c.emoji.slice(0, 64) : '📝',
              audioUrl: typeof c.audioUrl === 'string' ? c.audioUrl : null,
              imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : null,
              id: createStableWordCardId(normalizedWord),
              createdAt: new Date().toISOString()
                });
              })
              .filter(card => Boolean(card.normalizedWord)));
            const knownWords = new Set(
              normalizeLocalCards([
                ...cards,
                ...readLocalJson<unknown[]>('lingoflash_cards', []),
              ]).map(cardWordKey),
            );
            if (user) {
              const cloudMatches = await findCardsByNormalizedWords(
                database,
                user.uid,
                candidateCards.map(card => card.word),
              );
              cloudMatches.forEach((_card, word) => knownWords.add(word));
            }
            const newCardsToSave = candidateCards.filter(card => !knownWords.has(cardWordKey(card)));
            const existingCount = candidateCards.length - newCardsToSave.length;

            if (newCardsToSave.length === 0) {
              setNotice(`All ${candidateCards.length} shared card${candidateCards.length === 1 ? ' is' : 's are'} already in your library. Nothing new was created.`);
              removeUrlParam('share');
              return;
            }

            const pendingOperations = await upsertDeviceCards(
              newCardsToSave,
              Math.max(knownLibraryTotal, cloudStats.total) + newCardsToSave.length,
            );

            // Sync to Firebase if logged in
            if (user) {
              const currentEpoch = libraryEpochState?.userId === user.uid
                ? libraryEpochState.value
                : 0;
              const creationResults = [];
              for (let index = 0; index < newCardsToSave.length; index += 1) {
                const result = await createCardIfAbsent(
                  database,
                  user.uid,
                  newCardsToSave[index],
                  { libraryEpoch: currentEpoch },
                );
                creationResults.push(result);
                const pending = pendingOperations[index];
                if (pending) await acknowledgeDevicePending([pending]);
              }
              const createdCards = creationResults.flatMap(result => result.created ? [result.card] : []);
              const categoryDeltas = createdCards.reduce<Record<string, number>>((deltas, card) => {
                const category = card.category || 'Other';
                deltas[category] = (deltas[category] || 0) + 1;
                return deltas;
              }, {});
              if (createdCards.length > 0) await updateCategoryFacets(categoryDeltas);
              setCloudStats(previous => ({
                ...previous,
                total: previous.total + createdCards.length,
                unrated: previous.unrated + createdCards.length,
              }));
              pageCursorsRef.current = [null];
              setCurrentPage(1);
              const reusedDuringCreate = creationResults.length - createdCards.length;
              setNotice(`Added ${createdCards.length} new card${createdCards.length === 1 ? '' : 's'} from the shared link${existingCount + reusedDuringCreate > 0 ? `; reused ${existingCount + reusedDuringCreate} already in your library` : ''}.`);
            } else {
              setCards(prev => [...newCardsToSave, ...prev]);
              setNotice(`Added ${newCardsToSave.length} new card${newCardsToSave.length === 1 ? '' : 's'} from the shared link${existingCount > 0 ? `; reused ${existingCount} already in your library` : ''}.`);
            }
            
            // Remove only the consumed share token; library filters and unrelated params remain intact.
            removeUrlParam('share');
          }
        }
      } catch (err) {
        console.error("Error fetching shared deck:", err);
        setError('Could not verify the complete library for this shared deck, so no cards were created.');
      }
    };
    checkSharedDeck();
  }, [db, user, updateCategoryFacets, upsertDeviceCards, knownLibraryTotal, cloudStats.total]);

  useEffect(() => {
    if (!hasObservedCloudQueryRef.current) {
      hasObservedCloudQueryRef.current = true;
      return;
    }
    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      return;
    }
    setCurrentPage(1);
    pageCursorsRef.current = [null];
  }, [cloudQueryKey]);

  const toggleBookmark = useCallback(async (id: string) => {
    const card = cardsRef.current.find(candidate => candidate.id === id)
      ?? studyCardsRef.current.find(candidate => candidate.id === id);
    if (!card) return;
    const newBookmarked = !card.bookmarked;
    const updatedCard = { ...card, bookmarked: newBookmarked };
    setCards(prev => prev.map(c => c.id === id ? { ...c, bookmarked: newBookmarked } : c));
    setStudyCards(prev => prev.map(c => c.id === id ? { ...c, bookmarked: newBookmarked } : c));
    await patchDeviceCards(
      [{ card: updatedCard, fields: { bookmarked: newBookmarked } }],
      knownLibraryTotalRef.current,
    );
    if (isFirebaseConfigured && db && user) {
      await flushDevicePendingToCloud();
      setCloudStats(previous => ({
        ...previous,
        bookmarked: Math.max(0, previous.bookmarked + (newBookmarked ? 1 : -1)),
      }));
    }
  }, [user, patchDeviceCards, flushDevicePendingToCloud]);

  const handleAssignDeck = useCallback(async (cardId: string, deckName: string | null) => {
    const normalizedDeckName = normalizeAssignedDeckName(deckName);
    const card = cardsRef.current.find(candidate => candidate.id === cardId)
      ?? studyCardsRef.current.find(candidate => candidate.id === cardId);
    setCards(prev => prev.map(card => card.id === cardId ? { ...card, customDeck: normalizedDeckName } : card));
    setStudyCards(prev => prev.map(card => card.id === cardId ? { ...card, customDeck: normalizedDeckName } : card));
    if (card) {
      await patchDeviceCards([{
        card: { ...card, customDeck: normalizedDeckName },
        fields: { customDeck: normalizedDeckName },
      }], knownLibraryTotalRef.current);
    }
    if (isFirebaseConfigured && db && user) {
      await flushDevicePendingToCloud();
    }
  }, [user, patchDeviceCards, flushDevicePendingToCloud]);

  const handleCreateCustomDeck = useCallback(async (deckName: string) => {
    const plan = planCustomDeckCreation(customDecks, deckName);
    if (plan.status === 'empty' || plan.status === 'duplicate') return;
    if (plan.status === 'limit') {
      setError('You can create up to 100 custom decks. Delete an existing deck before adding another.');
      return;
    }

    const updated = plan.decks;
    if (user) localStorage.setItem(localDecksOwnerKey, user.uid);
    else localStorage.removeItem(localDecksOwnerKey);
    setCustomDecks(updated);
    localStorage.setItem('lingoflash_custom_decks', JSON.stringify(updated));
    
    if (isFirebaseConfigured && db && user) {
      setDoc(doc(db, 'users', user.uid, 'profile', 'custom_decks'), { decks: arrayUnion(plan.name) }, { merge: true }).catch(console.error);
    }
  }, [customDecks, user]);

  const handleDeleteCustomDeck = useCallback(async (deckName: string) => {
    if (!window.confirm(`Are you sure you want to delete the collection "${deckName}"? All cards in this collection will be marked as unassigned.`)) return;
    
    const updated = customDecks.filter(d => d !== deckName);
    if (user) localStorage.setItem(localDecksOwnerKey, user.uid);
    const changedCards = cards
      .filter(card => card.customDeck === deckName)
      .map(card => ({ ...card, customDeck: null }));
    const changedIds = new Set(changedCards.map(card => card.id));

    let assignmentsCleared = false;
    let deckProfileRemoved = false;
    if (isFirebaseConfigured && db && user) {
      try {
        await clearCustomDeckAssignments(db, user.uid, deckName);
        assignmentsCleared = true;
        await setDoc(doc(db, 'users', user.uid, 'profile', 'custom_decks'), { decks: arrayRemove(deckName) }, { merge: true });
        deckProfileRemoved = true;
        const pendingOperations = await patchDeviceCards(
          changedCards.map(card => ({ card, fields: { customDeck: null } })),
          knownLibraryTotal,
        );
        await acknowledgeDevicePending(pendingOperations);
      } catch (err) {
        console.warn('Deck deletion could not complete atomically.', err);
        const recovery = planDeckDeletionFailureRecovery(assignmentsCleared, deckProfileRemoved);
        setCloudReadUnavailable(true);
        localStorage.removeItem(cloudPageCacheKey(user.uid));
        localStorage.removeItem(cloudStatsCacheKey(user.uid));
        localStorage.removeItem(cloudFacetsCacheKey(user.uid));
        pageCursorsRef.current = [null];
        setCurrentPage(1);
        setCloudRefresh(value => value + 1);
        setError(recovery.message);
        if (recovery.applyLocalResult) {
          setCustomDecks(updated);
          localStorage.setItem('lingoflash_custom_decks', JSON.stringify(updated));
          setCards(previous => previous.map(card => changedIds.has(card.id) ? { ...card, customDeck: null } : card));
          setStudyCards(previous => previous.map(card => changedIds.has(card.id) ? { ...card, customDeck: null } : card));
          if (activeCustomDeck === deckName) setActiveCustomDeck('All');
        }
        return;
      }
    }

    setCustomDecks(updated);
    localStorage.setItem('lingoflash_custom_decks', JSON.stringify(updated));
    setCards(previous => previous.map(card => changedIds.has(card.id) ? { ...card, customDeck: null } : card));
    setStudyCards(previous => previous.map(card => changedIds.has(card.id) ? { ...card, customDeck: null } : card));
    
    if (activeCustomDeck === deckName) {
      setActiveCustomDeck('All');
    }
  }, [customDecks, activeCustomDeck, user, cards, patchDeviceCards, knownLibraryTotal]);

  const updateCardDifficulty = useCallback(async (id: string, rating: ReviewRating) => {
    const card = cards.find(candidate => candidate.id === id) ?? studyCards.find(candidate => candidate.id === id);
    if (!card) return;
    const srsUpdates = scheduleReview(card, rating);
    const difficulty = srsUpdates.difficulty || 'hard';
    const previousDifficulty = card.difficulty && card.difficulty !== 'unrated' ? card.difficulty : 'unrated';
    const updatedCard = { ...card, ...srsUpdates };
    setCards(prev => prev.map(candidate => candidate.id === id ? { ...candidate, ...srsUpdates } : candidate));
    setStudyCards(prev => prev.map(candidate => candidate.id === id ? { ...candidate, ...srsUpdates } : candidate));
    await patchDeviceCards([{ card: updatedCard, fields: srsUpdates }], knownLibraryTotal);
    if (isFirebaseConfigured && db && user) {
      await flushDevicePendingToCloud();
      setCloudStats(previous => previousDifficulty === difficulty
        ? {
            ...previous,
            due: card.nextReviewDate && isCardDue(card) ? Math.max(0, previous.due - 1) : previous.due,
          }
        : {
            ...previous,
            [previousDifficulty]: Math.max(0, previous[previousDifficulty] - 1),
            [difficulty]: previous[difficulty] + 1,
            due: card.nextReviewDate && isCardDue(card) ? Math.max(0, previous.due - 1) : previous.due,
          });
    }
    handleAddXp(2);
  }, [user, cards, studyCards, handleAddXp, patchDeviceCards, knownLibraryTotal, flushDevicePendingToCloud]);

  const handleUpdateCard = useCallback(async (
    cardId: string,
    updatedFields: Partial<CardData>,
    explicitSource?: CardData,
    expectedLifecycle?: string,
  ) => {
    const currentLifecycle = () => `${hydrationSessionVersionRef.current}:${cardLifecycleVersionRef.current.get(cardId) ?? 0}`;
    if (!isCardUpdateLifecycleCurrent(expectedLifecycle, currentLifecycle())) return;
    const ownerUserId = user?.uid ?? null;
    const existingCard = resolveCardUpdateSource(
      cardId,
      explicitSource,
      cardsRef.current,
      studyCardsRef.current,
    );
    if (!existingCard) return;
    const updatedCard = { ...existingCard, ...updatedFields };
    const pendingOperations = await patchDeviceCards(
      [{ card: updatedCard, fields: updatedFields }],
      knownLibraryTotalRef.current,
    );
    if (!isCardUpdateLifecycleCurrent(expectedLifecycle, currentLifecycle())) return;
    if (activeUserIdRef.current !== ownerUserId) return;
    setCards(prev => {
      const updatedCards = prev.map(card => card.id === cardId ? { ...card, ...updatedFields } : card);
      localStorage.setItem('lingoflash_cards', JSON.stringify(
        retainCardsForSession(updatedCards, Boolean(user), cardsPerPage),
      ));
      return updatedCards;
    });
    setStudyCards(prev => prev.map(card => card.id === cardId ? { ...card, ...updatedFields } : card));
    if (isFirebaseConfigured && db && ownerUserId) {
      const database = db;
      try {
        const pendingPatch = pendingOperations.find(operation => operation.type === 'patch');
        if (!pendingPatch) throw new Error('The patch command could not be queued safely.');
        const fieldMask = pendingPatch.fieldMask
          ?? Object.keys(pendingPatch.fields) as Array<keyof CardData>;
        const maskedFields = selectMutableCardPatch(pendingPatch.fields, fieldMask);
        const result = await applyCardPatchWithConflictRecovery({
          cardId,
          fields: pendingPatch.fields,
          fieldMask,
          baseRevision: pendingPatch.baseRevision ?? 0,
          libraryEpoch: pendingPatch.libraryEpoch ?? 0,
        }, command => applyCardPatchIfCurrent(database, ownerUserId, command));
        if (result.applied) {
          const metadata = {
            revision: result.revision,
            libraryEpoch: pendingPatch.libraryEpoch ?? 0,
            updatedAt: new Date().toISOString(),
          };
          const advanceCard = (card: CardData) => card.id === cardId
            ? applySuccessfulPatchMetadata(card, pendingPatch.fields, metadata, fieldMask)
            : card;
          setCards(previous => previous.map(advanceCard));
          setStudyCards(previous => previous.map(advanceCard));
          await patchMirroredCardBatch(ownerUserId, [{
            cardId,
            fields: {
              ...maskedFields,
              schemaVersion: 2,
              revision: result.revision,
              libraryEpoch: metadata.libraryEpoch,
              updatedAt: metadata.updatedAt,
            },
          }]);
          await acknowledgeDevicePending([pendingPatch]);
        } else if (result.reason === 'stale-library-epoch' || result.reason === 'missing') {
          await acknowledgeDevicePending([pendingPatch]);
        } else {
          setError(result.reason === 'future-library-epoch'
            ? 'Cloud library generation changed. Your local update is still queued while sync state refreshes.'
            : 'The card changed again during conflict recovery. Your local update remains safely queued.');
        }
      } catch (err) {
        console.warn('Card update stayed local because cloud sync failed.', err);
        setCloudReadUnavailable(true);
      }
    }
  }, [user?.uid, patchDeviceCards, cardsPerPage]);

  const hydrateExistingCardImage = useCallback(async (card: CardData, force = false) => {
    const ownerUserId = user?.uid ?? null;
    const hydrationSessionVersion = hydrationSessionVersionRef.current;
    const lifecycleVersion = cardLifecycleVersionRef.current.get(card.id) ?? 0;
    const scopeKey = ownerUserId ?? 'guest';
    const canPersist = () => activeUserIdRef.current === ownerUserId
      && hydrationSessionVersionRef.current === hydrationSessionVersion
      && (cardLifecycleVersionRef.current.get(card.id) ?? 0) === lifecycleVersion;
    try {
      await hydrateMissingCardImage({
        card,
        force,
        scopeKey,
        attemptedCardIds: imageHydrationAttemptedRef.current,
        inFlightRequests: imageHydrationInFlightRef.current,
        fetchImage: fetchImageUrl,
        canPersist,
        persistUpdate: async (sourceCard, updatedFields) => {
          const updatedCard = { ...sourceCard, ...updatedFields };
          await patchDeviceCards(
            [{ card: updatedCard, fields: updatedFields }],
            knownLibraryTotalRef.current,
          );
          if (!canPersist()) return;
          const promotedKey = cardWordKey(sourceCard);
          const promotedCard = recentlyPromotedCardsRef.current.get(promotedKey);
          if (promotedCard) {
            recentlyPromotedCardsRef.current.set(promotedKey, { ...promotedCard, ...updatedFields });
          }
          setCards(previous => {
            const hasCard = previous.some(candidate => candidate.id === sourceCard.id);
            const updatedCards = hasCard
              ? previous.map(candidate => candidate.id === sourceCard.id
                ? { ...candidate, ...updatedFields }
                : candidate)
              : [updatedCard, ...previous.filter(candidate => cardWordKey(candidate) !== cardWordKey(sourceCard))]
                .slice(0, cardsPerPage);
            localStorage.setItem('lingoflash_cards', JSON.stringify(updatedCards));
            return updatedCards;
          });
          setStudyCards(previous => previous.map(candidate =>
            candidate.id === sourceCard.id ? { ...candidate, ...updatedFields } : candidate));
          if (isFirebaseConfigured && db && ownerUserId) {
            await flushDevicePendingToCloud();
          }
        },
      });
    } catch (imageHydrationError) {
      console.warn('The missing card image could not be saved locally yet.', imageHydrationError);
    }
  }, [user?.uid, patchDeviceCards, cardsPerPage, flushDevicePendingToCloud]);

  useEffect(() => {
    if (viewMode !== 'library' || cards.length === 0) return;
    const scopeKey = user?.uid ?? 'guest';
    const cardsMissingImages = cards
      .filter(card => !isSupportedImageUrl(card.imageUrl)
        && !imageHydrationAttemptedRef.current.has(`${scopeKey}:${card.id}`));
    if (cardsMissingImages.length === 0) return;

    void mapWithConcurrency(cardsMissingImages, 3, card => hydrateExistingCardImage(card));
  }, [cards, viewMode, user?.uid, hydrateExistingCardImage]);

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setAuthError(null);
    if (!isFirebaseConfigured || !auth || !googleProvider) {
      setAuthError('Cloud sync is not enabled. Check the Firebase configuration and reload the app.');
      return;
    }
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Authentication Error: ", err);
      if (err?.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      if (err?.code === 'auth/unauthorized-domain') {
        setAuthError(`Firebase does not allow ${window.location.hostname} yet. Add this domain under Authentication → Settings → Authorized domains.`);
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setAuthError('The sign-in window was closed before authentication finished.');
      } else {
        setAuthError(err.message || 'Could not sign in to Firebase.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!isFirebaseConfigured || !auth) return;
    try {
      await signOut(auth);
      localStorage.removeItem('lingoflash_cards');
      localStorage.removeItem(localCardsOwnerKey);
      setCards([]);
    } catch (err) {
      console.error("Sign out error", err);
    }
  };

  const handleDeviceSyncNow = async () => {
    if (isDeviceSyncing) return;
    setIsDeviceSyncing(true);
    setSyncHealthError(null);
    try {
      await flushDevicePendingToCloud();
      if (user) {
        const mirroredCount = await syncCardMirror(true);
        setNotice(`Đã đồng bộ ${mirroredCount} thẻ vào database cục bộ. App chỉ truy vấn và hiển thị từng trang khi cần.`);
        return;
      }
      if (cards.length === 0) {
        setError('There are no cards in this browser to save to the shared local copy.');
        return;
      }
      const totalToSync = Math.max(cards.length, knownLibraryTotal);
      await mergeDeviceCards(cards, totalToSync, null);
      persistLocalCardBackup(cards, cardsPerPage, totalToSync, null);
      const latestBackup = await loadDeviceCards();
      const availableCards = latestBackup?.cards.length ?? cards.length;
      setNotice(`Sync queue updated. ${availableCards} cards are available in the shared local library without rescanning Firebase.`);
    } catch (syncError) {
      console.warn('Device sync could not finish.', syncError);
      setSyncHealthError(getSyncErrorMessage(syncError));
      setError('Sync is temporarily unavailable. Your changes remain queued and will retry automatically.');
    } finally {
      if (user) await refreshPendingSyncState(user.uid);
      setIsDeviceSyncing(false);
    }
  };

  const handleSyncHealthRetry = async () => {
    if (!user || !db || isDeviceSyncing) return;
    setSyncHealthError(null);
    if (libraryEpochState?.userId !== user.uid) {
      setIsDeviceSyncing(true);
      try {
        const epoch = await getLibraryEpoch(db, user.uid);
        if (activeUserIdRef.current !== user.uid) return;
        setLibraryEpochState({ userId: user.uid, value: epoch });
        await refreshPendingSyncState(user.uid);
      } catch (epochError) {
        if (activeUserIdRef.current === user.uid) {
          setSyncHealthError(
            getSyncErrorMessage(epochError)
            || 'Cloud generation could not be verified; changes remain safe on this device.',
          );
        }
      } finally {
        if (activeUserIdRef.current === user.uid) setIsDeviceSyncing(false);
      }
      return;
    }
    await flushDevicePendingToCloud();
  };

  const loadPracticePool = useCallback(async (maximum = 50, includeFuture = true): Promise<CardData[]> => {
    if (isFirebaseConfigured && db && user && !isCloudBackoffActive(user.uid)) {
      try {
        return await fetchPracticeCards(db, user.uid, maximum, { includeFuture });
      } catch (practiceError) {
        console.warn('Cloud practice queue unavailable; using the visible cached page.', practiceError);
        setError(isQuotaError(practiceError)
          ? 'Firebase has reached today’s read quota. Practice is using cards cached on this device.'
          : 'Could not load the cloud queue. Practice is using cards cached on this device.');
      }
    }
    const candidates = includeFuture ? cards : cards.filter(card => isCardDue(card));
    return candidates.slice(0, maximum);
  }, [user, cards]);

  const {
    quizQuestions, currentQuizIndex, selectedAnswer, answeredCorrectly, quizScore, showQuizResults,
    spellingCards, currentSpellingIndex, spellingInput, setSpellingInput, spellingChecked, spellingCorrect,
    spellingScore, showSpellingResults, story, isGeneratingStory,
    startQuiz, selectQuizAnswer: handleSelectQuizAnswer, nextQuizQuestion: handleNextQuizQuestion,
    startSpelling, checkSpelling: handleCheckSpelling, nextSpelling: handleNextSpelling,
    generateStory: handleGenerateStory,
    clearQuiz, clearSpelling,
  } = usePracticeGames({
    loadPracticePool,
    addXp: handleAddXp,
    openView: view => {
      setIsPracticeMenuOpen(false);
      setViewMode(view);
    },
    reportError: setError,
  });

  const handleShareCategory = async () => {
    if (!isFirebaseConfigured || !app || !db || !user) {
      setError('Sign in and connect Firebase before sharing a deck.');
      return;
    }
    rememberOpener(shareOpenerRef);
    
    setIsSharing(true);
    try {
      const shareFilters: CardQueryState = {
        category: activeCategory === 'All' ? null : activeCategory,
        customDeck: null,
        difficulty: null,
        partOfSpeech: null,
        bookmarkedOnly: false,
        createdDate: null,
        wordPrefix: '',
      };
      const sharePage = await fetchCardPage({ db, userId: user.uid, filters: shareFilters, pageSize: 100 });
      const cardsToShare = sharePage.items;
      if (cardsToShare.length === 0) return;
      const { shareId } = await createSharedDeckShare(app, activeCategory, cardsToShare);
      const link = `${window.location.origin}?share=${shareId}`;
      setActiveShareId(shareId);
      setShareLink(link);
    } catch (err) {
      console.error("Error sharing deck:", err);
      setError('Could not create a share link right now. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!app || !activeShareId) return;
    setIsSharing(true);
    try {
      await revokeSharedDeckShare(app, activeShareId);
      setActiveShareId(null);
      setShareLink(null);
      setNotice('The shared deck link has been revoked.');
    } catch (shareError) {
      console.warn('Shared deck revocation failed.', shareError);
      setError('Could not revoke this share link right now. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  const categoryCounts = useMemo(() => {
    if (user) {
      const visibleCounts: Record<string, number> = {};
      cards.forEach(card => {
        const category = card.category || 'Other';
        visibleCounts[category] = (visibleCounts[category] || 0) + 1;
      });
      return { All: Math.max(cloudTotal, cloudStats.total, cards.length), ...visibleCounts, ...cloudCategoryCounts };
    }
    const counts: Record<string, number> = { All: user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length };
    cards.forEach(c => {
      const cat = c.category || 'Other';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [cards, user, cloudTotal, cloudStats.total, cloudCategoryCounts]);

  const sortedCategories = useMemo(() => {
    const uniqueCategories = (user
      ? Array.from(new Set([...Object.keys(cloudCategoryCounts), ...cards.map(card => card.category || 'Other')]))
      : Array.from(new Set(cards.map(c => c.category || 'Other'))))
      .filter(Boolean)
      .sort((a, b) => (a as string).localeCompare(b as string));
    return ['All', ...uniqueCategories];
  }, [cards, user, cloudCategoryCounts]);

  const availableDates = useMemo(() => {
    return ['All', ...new Set(cards.map(c => formatCardDate(c.createdAt)))];
  }, [cards]);

  const createCard = async (word: string): Promise<{
    card: CardData;
    mediaPromise: Promise<{ audioUrl: string | null; imageUrl: string | null }>;
  }> => {
    const queryWord = normalizeCardWord(word).slice(0, 80);
    const audioPromise = fetchAudioUrl(queryWord);
    const { generateWordInfo } = await import('./lib/gemini');
    const wordInfo = await generateWordInfo(queryWord);
    const mediaPromise = Promise.all([
      audioPromise,
      fetchImageUrl({
        word: queryWord,
        searchQuery: wordInfo.imageSearchQuery,
        category: wordInfo.category,
        partOfSpeech: wordInfo.partOfSpeech,
      }),
    ]).then(([audioUrl, imageUrl]) => ({ audioUrl, imageUrl }));
    const initialMedia = await waitForInitialMedia(mediaPromise);

    const card: CardData = {
      id: createStableWordCardId(queryWord),
      word: queryWord,
      normalizedWord: queryWord,
      translation: wordInfo.translation,
      explanation: wordInfo.explanation,
      explanationTranslation: wordInfo.explanationTranslation,
      phonetic: wordInfo.phonetic,
      emoji: wordInfo.emoji,
      category: wordInfo.category,
      audioUrl: initialMedia?.audioUrl ?? null,
      imageUrl: initialMedia?.imageUrl ?? null,
      imageSearchQuery: wordInfo.imageSearchQuery,
      createdAt: new Date().toISOString(),
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
      partOfSpeech: normalizePartOfSpeech(wordInfo.partOfSpeech),
      cefrLevel: wordInfo.cefrLevel,
      exampleSentence: wordInfo.exampleSentence,
      exampleTranslation: wordInfo.exampleTranslation,
      collocations: wordInfo.collocations,
      synonyms: wordInfo.synonyms,
      antonyms: wordInfo.antonyms,
      register: wordInfo.register,
      commonMistake: wordInfo.commonMistake,
      correctStreak: 0,
    };
    return { card, mediaPromise };
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wordInput.trim()) return;
    if (generationInFlightRef.current) return;
    if (wordInput.trim().length > 80) {
      setError('A word or phrase cannot be longer than 80 characters.');
      return;
    }
    if (user && libraryEpochState?.userId !== user.uid) {
      setError('Cloud sync safety is not verified yet. Your word is still here—try again after Firebase reconnects.');
      return;
    }

    generationInFlightRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const queryWord = normalizeCardWord(wordInput);
      let mirroredExistingCard: CardData | null = null;
      let mirrorStatus: Awaited<ReturnType<typeof getCardMirrorStatus>> = null;
      if (user) {
        try {
          mirrorStatus = await getCardMirrorStatus(user.uid);
          mirroredExistingCard = await findMirroredCardByWord(user.uid, queryWord);
        } catch (mirrorError) {
          mirrorStatus = null;
          console.warn('Exact lookup in the IndexedDB mirror is unavailable; verifying against Firebase.', mirrorError);
        }
      }
      const deviceBackup = user ? null : await loadDeviceCards();
      const deviceCachedCards = deviceBackup
        && deviceBackup.ownerUserId !== undefined
        && canUseDeviceBackupForSession(deviceBackup.ownerUserId, user?.uid ?? null)
        ? normalizeLocalCards(deviceBackup.cards)
        : [];
      // The create form can be submitted while the initial auth/cache effects are
      // still settling. Read the durable guest cache as an additional exact-match
      // source so an existing word is never sent to AI or duplicated in that gap.
      const sessionCachedCards = user
        ? []
        : normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
      const cachedCards = mirroredExistingCard
        ? [mirroredExistingCard, ...deviceCachedCards, ...sessionCachedCards]
        : [...deviceCachedCards, ...sessionCachedCards];
      const database = db;
      const currentUser = user;
      const verifyRemote = isFirebaseConfigured && database && currentUser
        ? () => findCardByNormalizedWord(database, currentUser.uid, queryWord)
        : undefined;
      const mirrorRequiresRemoteVerification = shouldRequireRemoteUniquenessCheck(mirrorStatus);
      const shouldAttemptRemoteVerification = shouldAttemptRemoteUniquenessCheck({
        mirrorStatus,
        cloudAvailable: Boolean(
          currentUser
          && isBrowserOnline
          && !cloudReadUnavailable
          && !isCloudBackoffActive(currentUser.uid),
        ),
        verifierAvailable: Boolean(verifyRemote),
      });
      let uniquenessVerified = !mirrorRequiresRemoteVerification;
      let existingCard: CardData | null = null;
      try {
        existingCard = await resolveExistingCard({
          word: queryWord,
          visibleCards: cards,
          cachedCards,
          requireRemoteVerification: shouldAttemptRemoteVerification,
          verifyRemote,
        });
        uniquenessVerified = Boolean(existingCard)
          || !mirrorRequiresRemoteVerification
          || shouldAttemptRemoteVerification;
      } catch (uniquenessError) {
        if (!canDeferRemoteUniquenessFailure(uniquenessError)) {
          throw uniquenessError;
        }
        uniquenessVerified = false;
      }

      const revealExistingCard = (card: CardData) => {
        const revealState = existingCardRevealState();
        const promotion = promoteExistingCard(card);
        const promotedCard = promotion.card;
        recentlyPromotedCardsRef.current.set(cardWordKey(promotedCard), promotedCard);
        if (user) {
          void upsertMirroredCardBatch(user.uid, [promotedCard]).catch(mirrorError => {
            console.warn('The existing card was opened, but its local mirror entry could not be refreshed.', mirrorError);
          });
        }
        setCards(previous => {
          const nextCards = retainCardsForSession(
            [promotedCard, ...previous.filter(candidate => cardWordKey(candidate) !== queryWord)],
            Boolean(user),
            cardsPerPage,
          );
          localStorage.setItem('lingoflash_cards', JSON.stringify(nextCards));
          return nextCards;
        });
        void mergeDeviceCards([promotedCard], knownLibraryTotalRef.current, user?.uid ?? null);
        pageCursorsRef.current = [null];
        setCurrentPage(revealState.page);
        setSearchQuery(revealState.search);
        setDebouncedSearch(revealState.search);
        setActiveCategory(revealState.category);
        setActiveDate(revealState.date);
        setActiveCustomDeck(revealState.deck);
        setActiveDifficulty(revealState.difficulty);
        setActivePartOfSpeech(revealState.partOfSpeech);
        setShowStarredOnly(revealState.starred);
        setNotice(`“${promotedCard.word}” is already in your library. It has been moved to the top of page 1.`);
        setWordInput('');
        setLibraryFocusRequest(previous => previous + 1);
        void handleUpdateCard(promotedCard.id, promotion.fields, promotedCard);
        void hydrateExistingCardImage(promotedCard, true);
      };

      // Existing learning content is surfaced without regeneration or rewriting it.
      if (existingCard) {
        revealExistingCard(existingCard);
        return;
      }

      if (!import.meta.env.DEV && !currentUser) {
        setError('Sign in to generate AI cards and sync them safely across devices.');
        return;
      }

      const { card: newCard, mediaPromise } = await withTimeout(
        createCard(wordInput),
        22_000,
        'Card generation took too long. Your word is still here, so please try again.',
      );
      let cardQueuedForCloud = false;
      let persistedCard = newCard;
      if (isFirebaseConfigured && db && user) {
        const creationDatabase = db;
        const creationUserId = user.uid;
        const creation = await persistCardWithMirrorFallback({
          card: newCard,
          uniquenessVerified,
          createInCloud: () => withTimeout(
            createCardIfAbsent(
              creationDatabase,
              creationUserId,
              newCard,
              {
                libraryEpoch: libraryEpochState?.userId === creationUserId
                  ? libraryEpochState.value
                  : 0,
              },
            ),
            8_000,
            'Saving the card took too long. It will remain queued on this device.',
          ),
        });
        if (!creation.created) {
          revealExistingCard(creation.card);
          return;
        }
        persistedCard = creation.card;
        cardQueuedForCloud = creation.queued;
        if (cardQueuedForCloud) {
          setCloudReadUnavailable(true);
          setNotice('Firebase is temporarily unavailable. The card was created locally and will sync automatically.');
        }
      }
      setCards((prev) => {
        const nextCards = retainCardsForSession(
          [persistedCard, ...prev.filter(card => card.id !== persistedCard.id)],
          Boolean(user),
          cardsPerPage,
        );
        localStorage.setItem('lingoflash_cards', JSON.stringify(nextCards));
        return nextCards;
      });
      const pendingOperations = await upsertDeviceCards([persistedCard], Math.max(knownLibraryTotal, cloudStats.total) + 1);
      if (isFirebaseConfigured && db && user) {
        if (!cardQueuedForCloud) {
          void acknowledgeDevicePending(pendingOperations);
          void updateCategoryFacets({ [persistedCard.category || 'Other']: 1 }).catch(facetError => {
            console.warn('Card synced, but category facets will update on the next refresh.', facetError);
          });
        }
        pageCursorsRef.current = [null];
        setCurrentPage(1);
      }
      handleAddXp(10); // Reward for creating a card
      setWordInput('');
      const mediaLifecycle = `${hydrationSessionVersionRef.current}:${cardLifecycleVersionRef.current.get(persistedCard.id) ?? 0}`;
      void mediaPromise.then(media => handleUpdateCard(persistedCard.id, media, persistedCard, mediaLifecycle));
      if (user) {
        setCloudStats(previous => ({ ...previous, total: previous.total + 1, unrated: previous.unrated + 1 }));
        setCloudTotal(previous => Math.max(previous, cards.length + 1));
      }
    } catch (err: unknown) {
      console.error(err);
      const source = typeof err === 'object' && err !== null ? err as { code?: unknown; status?: unknown } : null;
      const status = Number(source?.status ?? 0);
      const code = String(source?.code ?? '');
      const message = err instanceof CardUniquenessCheckError
        ? 'The card could not be queued safely on this device. Reload the app and try again.'
        : err instanceof OperationTimeoutError
        ? err.message
        : status === 429 || code.includes('resource-exhausted')
          ? 'The AI rate limit has been reached. Wait a moment and try again. Your word is still saved.'
          : err instanceof TypeError && err.message === 'Failed to fetch'
            ? 'Could not connect to the AI service. Check your network and try again.'
            : 'Failed to generate the flashcard. Your word is still here, so you can try again.';
      setError(message);
    } finally {
      generationInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const handleExcelImport = useSpreadsheetImport({
    user,
    libraryEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : 0,
    cards,
    knownLibraryTotal,
    cloudStats,
    setCloudStats,
    setCards,
    setCurrentPage,
    pageCursorsRef,
    fileInputRef,
    setError,
    setIsLoading,
    setImportProgress,
    upsertDeviceCards,
    updateCategoryFacets,
    createCard,
    updateCard: handleUpdateCard,
    getCardUpdateLifecycle: cardId => `${hydrationSessionVersionRef.current}:${cardLifecycleVersionRef.current.get(cardId) ?? 0}`,
    addXp: handleAddXp,
  });

  const clearAll = async () => {
    if (!canStartLibraryClear(isLoading)) {
      setError('Wait for the current card generation or import to finish before clearing the library.');
      return;
    }
    hydrationSessionVersionRef.current += 1;
    setShowClearConfirm(false);
    if (isFirebaseConfigured && db && user) {
      const clearDatabase = db;
      const clearUserId = user.uid;
      libraryClearInFlightUserRef.current = clearUserId;
      setIsLoading(true);
      const acquiredClearLease = await acquireDevicePendingFlush(clearUserId);
      if (!acquiredClearLease) {
        libraryClearInFlightUserRef.current = null;
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) {
          setIsLoading(false);
          setError('Cloud sync is finishing another operation. Try clearing the library again in a moment.');
        }
        return;
      }
      let cardDeletionCompleted = false;
      try {
        const activeMirrorSync = mirrorSyncInFlightRef.current;
        if (activeMirrorSync?.userId === clearUserId) {
          await activeMirrorSync.promise.catch(mirrorError => {
            console.warn('The active local mirror sync stopped before the library was cleared.', mirrorError);
          });
        }
        await runEpochProtectedLibraryClear({
          incrementEpoch: () => incrementLibraryEpoch(clearDatabase, clearUserId),
          onEpochAdvanced: nextLibraryEpoch => {
            cacheLibraryEpoch(clearUserId, nextLibraryEpoch);
            setLibraryEpochState({ userId: clearUserId, value: nextLibraryEpoch });
          },
          clearPending: () => clearDevicePending(clearUserId),
          deleteCards: () => deleteAllCards(clearDatabase, clearUserId),
        });
        cardDeletionCompleted = true;
        await clearMirroredCards(clearUserId).catch(mirrorError => {
          console.warn('Cloud cards were cleared, but the local IndexedDB mirror will be reset on the next sync.', mirrorError);
        });
        await setDoc(doc(db, 'users', clearUserId, 'profile', 'library_facets'), {
          categories: {},
          complete: true,
          version: 1,
          updatedAt: new Date().toISOString(),
        });
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) {
          setCloudCategoryCounts({});
          setCloudFacetsComplete(true);
          setLegacyCardsPending(0);
          setCloudStats({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
          setCloudTotal(0);
          setHasNextCloudPage(false);
          setCards([]);
          setStudyCards([]);
          localStorage.removeItem('lingoflash_cards');
          await saveDeviceCards([], 0, [], 'replace', clearUserId);
          pageCursorsRef.current = [null];
          setCurrentPage(1);
        }
      } catch (err) {
        const recovery = planClearFailureRecovery(cardDeletionCompleted);
        localStorage.removeItem(cloudPageCacheKey(clearUserId));
        localStorage.removeItem(cloudStatsCacheKey(clearUserId));
        localStorage.removeItem(cloudFacetsCacheKey(clearUserId));
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) {
          handleFirestoreError(err, OperationType.DELETE, `users/${clearUserId}/cards`);
          statsLoadedUserRef.current = null;
          pageCursorsRef.current = [null];
          setCurrentPage(1);
          if (recovery.clearLocalView) {
            setCloudCategoryCounts({});
            setCloudFacetsComplete(false);
            setLegacyCardsPending(0);
            setCloudStats({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
            setCloudTotal(0);
            setHasNextCloudPage(false);
            setCards([]);
            setStudyCards([]);
            localStorage.removeItem('lingoflash_cards');
            await saveDeviceCards([], 0, [], 'replace', clearUserId);
          }
          setCloudRefresh(value => value + 1);
          setError(recovery.message);
        }
      } finally {
        if (libraryClearInFlightUserRef.current === clearUserId) {
          libraryClearInFlightUserRef.current = null;
        }
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) setIsLoading(false);
        await releaseDevicePendingFlush(clearUserId);
      }
    } else {
      setCards([]);
      localStorage.removeItem('lingoflash_cards');
      void saveDeviceCards([], 0, [], 'replace', null);
    }
  };

  const exportToExcel = async () => {
    if (knownLibraryTotal === 0 || (user && cloudReadUnavailable && visibleLibraryCount === 0)) return;
    setIsLoading(true);
    try {
      const XLSX = await import('@e965/xlsx');
      const exportCards = isFirebaseConfigured && db && user
        ? await fetchAllCardsOnDemand(db, user.uid)
        : cards;
      const data = cardsToSpreadsheetRows(exportCards);
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Flashcards");
      XLSX.writeFile(wb, "SonFlash_Export.xlsx");
    } catch (exportError) {
      console.warn('Library export failed.', exportError);
      setError('Could not export the library. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteCard = useCallback(async (id: string) => {
    if (user && libraryEpochState?.userId !== user.uid) {
      setError('Cloud sync state is not verified yet. Try deleting the card again after synchronization reconnects.');
      return;
    }
    const deletedCard = cardsRef.current.find(card => card.id === id)
      ?? studyCardsRef.current.find(card => card.id === id);
    let pendingOperations: DevicePendingOperation[];
    try {
      pendingOperations = await removeDeviceCard(
        id,
        Math.max(0, knownLibraryTotalRef.current - 1),
      );
    } catch (queueError) {
      console.warn('The card was not removed because its delete command could not be stored safely.', queueError);
      setError('The delete could not be stored safely, so the card was left unchanged. Please try again.');
      return;
    }
    cardLifecycleVersionRef.current.set(id, (cardLifecycleVersionRef.current.get(id) ?? 0) + 1);
    setCards(prev => prev.filter(c => c.id !== id));
    setStudyCards(prev => prev.filter(c => c.id !== id));
    if (isFirebaseConfigured && db && user) {
      const database = db;
      try {
        const pendingDelete = pendingOperations.find(operation => operation.type === 'delete');
        if (!pendingDelete) throw new Error('The delete command could not be queued safely.');
        const deleteResult = await deleteCardWithConflictRecovery({
          cardId: id,
          opId: pendingDelete.opId ?? `legacy-delete-${id}-${pendingDelete.updatedAt}`,
          libraryEpoch: pendingDelete.libraryEpoch ?? 0,
          baseRevision: pendingDelete.baseRevision ?? 0,
        }, command => deleteCardWithTombstone(database, user.uid, command));
        if (!deleteResult.deleted && deleteResult.reason !== 'stale-library-epoch') {
          setError(deleteResult.reason === 'future-library-epoch'
            ? 'Cloud library generation changed. The delete is still queued while sync state refreshes.'
            : 'The card changed again during delete recovery. The delete remains safely queued.');
          return;
        }
        await deleteMirroredCard(user.uid, id).catch(mirrorError => {
          console.warn('The cloud delete succeeded, but the local IndexedDB mirror will catch up on the next sync.', mirrorError);
        });
        await acknowledgeDevicePending(pendingOperations);
        if (deletedCard) {
          const deletedDifficulty = deletedCard.difficulty && deletedCard.difficulty !== 'unrated'
            ? deletedCard.difficulty
            : 'unrated';
          setCloudStats(previous => ({
            ...previous,
            total: Math.max(0, previous.total - 1),
            [deletedDifficulty]: Math.max(0, previous[deletedDifficulty] - 1),
            bookmarked: deletedCard.bookmarked ? Math.max(0, previous.bookmarked - 1) : previous.bookmarked,
            due: deletedCard.nextReviewDate && isCardDue(deletedCard) ? Math.max(0, previous.due - 1) : previous.due,
          }));
          void updateCategoryFacets({ [deletedCard.category || 'Other']: -1 });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/cards/${id}`);
        if (isRetryableSyncError(err)) {
          setCloudReadUnavailable(true);
          if (isQuotaError(err)) {
            localStorage.setItem(cloudBackoffCacheKey(user.uid), String(Date.now() + 5 * 60 * 1000));
          }
          setError('The card was deleted locally and queued. It will sync automatically when Firebase is available.');
        } else {
          await acknowledgeDevicePending(pendingOperations);
          if (deletedCard) {
            setCards(previous => [deletedCard, ...previous.filter(card => card.id !== deletedCard.id)].slice(0, cardsPerPage));
            setStudyCards(previous => [deletedCard, ...previous.filter(card => card.id !== deletedCard.id)]);
          }
          setError('Firebase rejected the delete. The card has been restored on screen.');
        }
      }
    }
  }, [user, libraryEpochState, updateCategoryFacets, removeDeviceCard, cardsPerPage]);

  const filteredCards = useMemo(() => {
    if (user && db && isFirebaseConfigured) return cards;
    return cards.filter(c => {
      const matchCategory = activeCategory === 'All' || c.category === activeCategory;
      const matchCustomDeck = activeCustomDeck === 'All' ||
                              (activeCustomDeck === 'Unassigned' ? !c.customDeck : c.customDeck === activeCustomDeck);
      const matchDate = activeDate === 'All' || formatCardDate(c.createdAt) === activeDate;
      const matchDifficulty = activeDifficulty === 'All' || 
                              (activeDifficulty === 'unrated' ? !c.difficulty : 
                               (activeDifficulty === 'due' ? isCardDue(c) : c.difficulty === activeDifficulty));
      const matchPartOfSpeech = activePartOfSpeech === 'All' || normalizePartOfSpeech(c.partOfSpeech) === activePartOfSpeech;
      const matchStarred = !showStarredOnly || c.bookmarked === true;
      const searchLower = searchQuery.toLowerCase();
      const matchSearch = !searchQuery || 
                          c.word.toLowerCase().includes(searchLower) || 
                          c.translation.toLowerCase().includes(searchLower);
      return matchCategory && matchCustomDeck && matchDate && matchDifficulty && matchPartOfSpeech && matchStarred && matchSearch;
    });
  }, [cards, activeCategory, activeCustomDeck, activeDate, activeDifficulty, activePartOfSpeech, showStarredOnly, searchQuery, user]);
  const activeStudyCards = studyCards.length > 0 ? studyCards : filteredCards;
  const activeStudyCardId = activeStudyCards[studyIndex]?.id;

  useEffect(() => {
    setIsRecallRevealed(false);
    setReviewedCardId(activeStudyCardId && reviewedCardIdsRef.current.has(activeStudyCardId) ? activeStudyCardId : null);
  }, [studyIndex, recallMode, activeStudyCardId]);

  const submitStudyRating = useCallback(async (rating: ReviewRating) => {
    const activeCard = activeStudyCards[studyIndex];
    if (!activeCard || !isRecallRevealed || reviewedCardIdsRef.current.has(activeCard.id) || pendingReviewIdsRef.current.has(activeCard.id)) return;
    pendingReviewIdsRef.current.add(activeCard.id);
    reviewedCardIdsRef.current.add(activeCard.id);
    setReviewedCardId(activeCard.id);
    try {
      await updateCardDifficulty(activeCard.id, rating);
    } catch (reviewError) {
      reviewedCardIdsRef.current.delete(activeCard.id);
      setReviewedCardId(current => current === activeCard.id ? null : current);
      setError(reviewError instanceof Error ? reviewError.message : 'Could not save the review result.');
    } finally {
      pendingReviewIdsRef.current.delete(activeCard.id);
    }
  }, [activeStudyCards, studyIndex, isRecallRevealed, updateCardDifficulty]);

  // Keyboard shortcuts for study mode
  useEffect(() => {
    if (viewMode !== 'study' || activeStudyCards.length === 0) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      // Ignore key events on inputs, textareas, or content-editable elements
      if (
        (e.target as HTMLElement | null)?.closest('button, a, input, textarea, select, summary, [contenteditable="true"]')
      ) {
        return;
      }
      
      const activeCard = activeStudyCards[studyIndex];
      if (!activeCard) return;

      switch (e.key) {
        case ' ':
        case 'Enter': {
          if (e.altKey) break;
          e.preventDefault();
          if (!isRecallRevealed) {
            setIsRecallRevealed(true);
          } else {
            const flipButton = document.querySelector('[aria-hidden="false"] [data-flip-card]') as HTMLButtonElement | null;
            flipButton?.click();
          }
          break;
        }
        case 'ArrowRight': {
          if (e.altKey) break;
          e.preventDefault();
          setStudyIndex(prev => Math.min(activeStudyCards.length - 1, prev + 1));
          break;
        }
        case 'ArrowLeft': {
          if (e.altKey) break;
          e.preventDefault();
          setStudyIndex(prev => Math.max(0, prev - 1));
          break;
        }
        case '1': {
          if (!e.altKey) break;
          e.preventDefault();
          void submitStudyRating('again');
          break;
        }
        case '2': {
          if (!e.altKey) break;
          e.preventDefault();
          void submitStudyRating('hard');
          break;
        }
        case '3': {
          if (!e.altKey) break;
          e.preventDefault();
          void submitStudyRating('good');
          break;
        }
        case '4': {
          if (!e.altKey) break;
          e.preventDefault();
          void submitStudyRating('easy');
          break;
        }
        case 's':
        case 'S': {
          if (!e.altKey) break;
          e.preventDefault();
          toggleBookmark(activeCard.id);
          break;
        }
        case 'p':
        case 'P': {
          if (!e.altKey) break;
          e.preventDefault();
          const playBtn = document.querySelector('[aria-hidden="false"] [aria-label="Play pronunciation"]') as HTMLElement;
          if (playBtn) playBtn.click();
          break;
        }
        case 'r':
        case 'R': {
          if (!e.altKey) break;
          e.preventDefault();
          const micBtn = document.querySelector('[aria-hidden="false"] [aria-label="Check pronunciation"]') as HTMLElement;
          if (micBtn) micBtn.click();
          break;
        }
        default:
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewMode, studyIndex, activeStudyCards, submitStudyRating, toggleBookmark, isRecallRevealed]);

  const pageableLibraryCount = user ? Math.max(cloudTotal, filteredCards.length) : filteredCards.length;
  const totalPages = calculateTotalPages(
    pageableLibraryCount,
    cardsPerPage,
    currentPage,
    Boolean(user && hasNextCloudPage),
  );
  const paginatedCards = useMemo(() => {
    if (user && db && isFirebaseConfigured) return filteredCards;
    return filteredCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage);
  }, [filteredCards, currentPage, user]);
  const libraryCount = user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length;
  const visibleLibraryCount = filteredCards.length;
  const practiceLibraryCount = resolvePracticeLibraryCount(visibleLibraryCount, knownLibraryTotal);
  const canUseVisibleLibrary = visibleLibraryCount > 0;
  const libraryCountLabel = user && cloudReadUnavailable
    ? pageableLibraryCount > 0
      ? `${pageableLibraryCount} CACHED / ${libraryCount} CLOUD`
      : 'CLOUD PAUSED'
    : `${libraryCount} CARDS`;
  const effectiveSyncHealthError = user && libraryEpochState?.userId !== user.uid
    ? 'Cloud generation could not be verified; changes remain safe on this device.'
    : syncHealthError;
  const difficultySummary = useMemo(() => user ? cloudStats : {
    total: cards.length,
    easy: cards.filter(card => card.difficulty === 'easy').length,
    good: cards.filter(card => card.difficulty === 'good').length,
    hard: cards.filter(card => card.difficulty === 'hard').length,
    unrated: cards.filter(card => !card.difficulty || card.difficulty === 'unrated').length,
    bookmarked: cards.filter(card => card.bookmarked).length,
    due: cards.filter(card => isCardDue(card)).length,
  }, [cards, user, cloudStats]);

  // Reorder only the cards already present on this bounded page; cloud page membership stays unchanged.
  const presentationCards = useMemo(
    () => sortCardsByActivity(paginatedCards),
    [paginatedCards],
  );
  const groupedCards = useMemo(() => groupCardsByDate(presentationCards), [presentationCards]);

  const startStudy = async () => {
    const practiceCards = await loadPracticePool(50, false);
    if (practiceCards.length > 0) {
      setStudyCards(practiceCards);
      reviewedCardIdsRef.current.clear();
      pendingReviewIdsRef.current.clear();
      setIsRecallRevealed(false);
      setReviewedCardId(null);
      setStudyIndex(0);
      setViewMode('study');
    } else {
      setError('There are no new or due cards to review right now.');
    }
  };

  const statsData = useMemo(() => {
    const total = difficultySummary.total;
    const learned = difficultySummary.easy;
    const learning = difficultySummary.good + difficultySummary.hard + difficultySummary.unrated;
    const dueToday = difficultySummary.due;
    
    const categoryCounts = user && cloudFacetsComplete
      ? cloudCategoryCounts
      : cards.reduce((acc, c) => {
          const cat = c.category || 'Uncategorized';
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

    const categoryChart = Object.keys(categoryCounts).map(k => ({ name: k, value: categoryCounts[k] }));

    const difficultyCounts = {
      easy: difficultySummary.easy,
      good: difficultySummary.good,
      hard: difficultySummary.hard,
      unrated: difficultySummary.unrated,
    };

    const difficultyChart = [
      { name: 'Mastered', value: difficultyCounts.easy, color: '#10b981' },
      { name: 'Learning', value: difficultyCounts.good + difficultyCounts.hard, color: '#f59e0b' },
      { name: 'Not reviewed', value: difficultyCounts.unrated, color: '#94a3b8' },
    ].filter(d => d.value > 0);

    // Format XP History chronologically
    const historyDates = Object.keys(xpHistory);
    let xpChartData = historyDates.map(dateStr => {
      return {
        date: dateStr,
        XP: xpHistory[dateStr] || 0
      };
    });

    xpChartData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (xpChartData.length === 0) {
      const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      xpChartData = [{ date: todayStr, XP: 0 }];
    }

    return { total, learned, learning, dueToday, categoryChart, categoryChartIsPartial: Boolean(user && !cloudFacetsComplete), difficultyChart, xpChartData };
  }, [cards, xpHistory, difficultySummary, user, cloudFacetsComplete, cloudCategoryCounts]);

  return (
    <div ref={appShellRef} className={`app-canvas min-h-dvh h-dvh text-[var(--sf-text)] font-sans flex flex-col overflow-hidden selection:bg-cyan-500/20 transition-colors relative ${isDarkMode ? 'dark' : ''}`}>
      <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-c" aria-hidden="true" />
      
      <nav ref={navigationRef} className={`${viewMode === 'study' ? 'hidden' : 'flex'} liquid-glass mx-3 mt-3 min-h-16 relative rounded-[22px] px-3 md:mx-6 md:px-5 items-center justify-between flex-shrink-0 z-20 transition-colors`}>
        <div data-gsap-brand className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#071014]/95 py-1.5 pl-1.5 pr-2.5 shadow-lg shadow-slate-950/15 backdrop-blur-xl sm:pr-3">
          <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] shadow-inner shadow-white/10">
            <img src="/favicon.svg" alt="" className="size-10 max-w-none object-contain" aria-hidden="true" />
          </div>
          <span className="hidden text-xl font-black tracking-[-0.04em] text-white drop-shadow-sm sm:inline">
            Son<span className="text-cyan-300">Flash</span>
          </span>
        </div>
        
        <div className="liquid-control hidden lg:flex items-center gap-1 rounded-2xl p-1">
          <button 
            type="button"
            onClick={() => setViewMode('library')}
            className={`min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer ${viewMode === 'library' ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]'}`}
            aria-current={viewMode === 'library' ? 'page' : undefined}
          >
            Library
          </button>
          <button 
            type="button"
            onClick={startStudy}
            disabled={!canUseVisibleLibrary}
            className="min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]"
          >
            Study
          </button>
          <button 
            type="button"
            onClick={openPracticeMenu}
            disabled={practiceLibraryCount < 4}
            className={`min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story' ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]'}`}
            title={practiceLibraryCount < 4 ? "Please load or add at least 4 cards to unlock Practice modes!" : "Practice Menu"}
            aria-current={viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story' ? 'page' : undefined}
            aria-haspopup="dialog"
            aria-expanded={isPracticeMenuOpen}
          >
            <Gamepad2 size={14} className="stroke-2" />
            Practice
          </button>
          
          <button 
            type="button"
            onClick={openStats}
            className="min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer flex items-center gap-1.5 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]"
            title="View learning insights"
            aria-haspopup="dialog"
            aria-expanded={isStatsOpen}
          >
            <BarChart3 size={14} className="stroke-2" />
            Insights
          </button>
        </div>

        <div data-gsap-header-actions className="flex h-11 items-stretch gap-1.5 sm:gap-3">
          {/* Cloud Sync control */}
          <div className="relative">
            {isAuthLoading ? (
              <Loader2 className="animate-spin text-slate-400" size={16} />
            ) : user ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex flex-col items-end text-right">
                  <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-wider leading-none">Synced</span>
                  <span className="text-[11px] font-bold text-[var(--sf-text)] truncate max-w-[90px]" title={user.email || ''}>{user.displayName || 'Synced'}</span>
                </div>
                {import.meta.env.DEV && <button
                  type="button"
                  onClick={handleDeviceSyncNow}
                  disabled={isDeviceSyncing}
                  className="hidden sm:flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[var(--sf-text-muted)] transition-colors hover:border-[var(--sf-brand)] hover:text-cyan-700 disabled:cursor-wait disabled:opacity-60 dark:hover:text-cyan-300"
                  title="Copy cards to the shared library on this device"
                >
                  {isDeviceSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
                  Shared library
                </button>}
                <button 
                  onClick={handleSignOut}
                  className="flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-full border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-all cursor-pointer shadow-sm overflow-hidden"
                  title="Sign out of cloud sync"
                  aria-label="Sign out of cloud sync"
                >
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Avatar" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-extrabold text-xs uppercase">{user.email?.charAt(0) || 'U'}</span>
                  )}
                </button>
              </div>
            ) : isFirebaseConfigured ? (
              <button
                onClick={handleSignIn}
                disabled={isSigningIn}
                className="min-h-11 flex items-center gap-1.5 px-2.5 sm:px-3 py-2 bg-[var(--sf-brand)] hover:bg-[var(--sf-brand-hover)] text-[var(--sf-on-brand)] hover:text-white rounded-xl text-xs font-extrabold transition-colors shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait active:scale-[0.98]"
                title="Sign in to sync devices"
              >
                {isSigningIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                <span>{isSigningIn ? 'Connecting…' : <><span className="sm:hidden">Sync</span><span className="hidden sm:inline">Sign in & sync</span></>}</span>
              </button>
            ) : (
              <div className="min-h-11 flex items-center gap-1.5 px-3 py-2 bg-[var(--sf-surface-raised)] border border-[var(--sf-border)] text-[var(--sf-text-muted)] rounded-xl text-[11px] font-bold"
                   title="Cloud sync is unavailable. Data is saved on this device only.">
                <CloudUpload className="w-3.5 h-3.5" />
                <span>On device</span>
              </div>
            )}
          </div>

          <div className="flex h-11 shrink-0 items-center overflow-hidden rounded-[14px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] shadow-sm">
            <button onClick={toggleTheme} className="flex size-11 shrink-0 items-center justify-center text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface)] hover:text-[var(--sf-brand-text)]" aria-label={isDarkMode ? 'Use light theme' : 'Use dark theme'}>
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {canUseVisibleLibrary && viewMode === 'library' && (
              <>
              <button 
                onClick={exportToExcel}
                className="hidden size-11 shrink-0 items-center justify-center border-l border-[var(--sf-border)] text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface)] hover:text-emerald-700 xl:flex dark:hover:text-emerald-300"
                title="Export library to Excel"
                aria-label="Export library to Excel"
              >
                <Download size={16} />
              </button>
              <button 
                  onClick={openClearConfirm}
                disabled={isLoading}
                className="hidden size-11 shrink-0 items-center justify-center border-l border-[var(--sf-border)] text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface)] hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 xl:flex dark:hover:text-rose-300"
                title="Clear the entire library"
                aria-label="Clear the entire library"
              >
                <Trash2 size={16} />
              </button>
              </>
            )}
          </div>

          <div className="hidden h-11 items-center gap-1.5 rounded-[14px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 xl:flex">
            <div className="size-1.5 bg-[var(--sf-brand)] rounded-full"></div>
            <span className="text-[11px] font-black text-cyan-700 dark:text-cyan-300 uppercase tracking-wider">{libraryCountLabel}</span>
          </div>
        </div>
      </nav>

      {authError && (
        <div role="alert" className="mx-4 mt-3 sm:mx-8 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <span>{authError}</span>
          <button type="button" onClick={() => setAuthError(null)} className="min-h-11 min-w-11 shrink-0 rounded-lg p-2 hover:bg-rose-100 dark:hover:bg-rose-900/50" aria-label="Dismiss sign-in message">
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mx-4 mt-3 sm:mx-8 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="flex items-start gap-2"><AlertCircle size={18} className="mt-0.5 shrink-0" /> {error}</span>
          <button type="button" onClick={() => setError(null)} className="min-h-11 min-w-11 shrink-0 rounded-lg p-2 hover:bg-amber-100 dark:hover:bg-amber-900/50" aria-label="Dismiss system message">
            <X size={16} className="mx-auto" />
          </button>
        </div>
      )}

      {notice && (
        <div role="status" className="mx-4 mt-3 sm:mx-8 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span className="flex items-start gap-2"><CheckCircle2 size={18} className="mt-0.5 shrink-0" /> {notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="min-h-11 min-w-11 shrink-0 rounded-lg p-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/50" aria-label="Dismiss success message">
            <X size={16} className="mx-auto" />
          </button>
        </div>
      )}

      <main className="flex-1 relative w-full max-w-[1560px] mx-auto p-4 sm:px-6 sm:py-6 lg:px-8 pb-24 lg:pb-8 overflow-y-auto z-10 scrollbar-thin">
        <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">{viewHeading}</h1>
        <div ref={viewStageRef} data-app-view-stage className="min-h-full">
        {viewMode === 'study' ? (
          <Suspense fallback={<DeferredViewFallback label="Loading study session" className="mx-auto max-w-4xl" />}>
          <StudyView
            cards={activeStudyCards}
            index={studyIndex}
            recallMode={recallMode}
            revealed={isRecallRevealed}
            reviewedCardId={reviewedCardId}
            customDecks={customDecks}
            onClose={() => setViewMode('library')}
            onRecallMode={setRecallMode}
            onReveal={() => setIsRecallRevealed(true)}
            onBookmark={toggleBookmark}
            onAssignDeck={handleAssignDeck}
            onUpdateCard={handleUpdateCard}
            onRate={rating => void submitStudyRating(rating)}
            onIndex={setStudyIndex}
          />
          </Suspense>
        ) : viewMode === 'quiz' ? (
          <Suspense fallback={<DeferredViewFallback label="Loading quiz" className="mx-auto max-w-2xl" />}>
          <QuizView
            questions={quizQuestions}
            currentIndex={currentQuizIndex}
            selectedAnswer={selectedAnswer}
            answeredCorrectly={answeredCorrectly}
            score={quizScore}
            showResults={showQuizResults}
            onSelect={handleSelectQuizAnswer}
            onNext={handleNextQuizQuestion}
            onRestart={startQuiz}
            onClose={() => { setViewMode('library'); clearQuiz(); }}
          />
          </Suspense>
        ) : viewMode === 'spelling' ? (
          <Suspense fallback={<DeferredViewFallback label="Loading spelling practice" className="mx-auto max-w-2xl" />}>
          <SpellingView
            cards={spellingCards}
            currentIndex={currentSpellingIndex}
            input={spellingInput}
            checked={spellingChecked}
            correct={spellingCorrect}
            score={spellingScore}
            showResults={showSpellingResults}
            onInput={setSpellingInput}
            onCheck={handleCheckSpelling}
            onNext={handleNextSpelling}
            onRestart={startSpelling}
            onClose={() => { setViewMode('library'); clearSpelling(); }}
          />
          </Suspense>
        ) : viewMode === 'story' ? (
          <Suspense fallback={<DeferredViewFallback label="Loading story" className="mx-auto max-w-2xl" />}>
            <StoryView story={story} loading={isGeneratingStory} onGenerate={handleGenerateStory} onClose={() => setViewMode('library')} />
          </Suspense>
        ) : (
          <div className="space-y-6 sm:space-y-8">
        <SyncHealth
          isOnline={isBrowserOnline}
          isSyncing={Boolean(user && isDeviceSyncing)}
          pendingCount={user ? pendingSyncCount : 0}
          error={user ? effectiveSyncHealthError : null}
          onRetry={user ? () => void handleSyncHealthRetry() : undefined}
          className="max-w-xl sm:ml-auto"
        />
        <LibraryOverview
          total={libraryCount}
          due={difficultySummary.due}
          mastered={difficultySummary.easy}
          streak={streak}
          level={level}
          xp={xp}
          canStudy={canUseVisibleLibrary}
          onStartStudy={startStudy}
          onCreateCard={() => {
            document.getElementById('library-tools')?.scrollIntoView({ behavior: getReducedMotionScrollBehavior(), block: 'start' });
            window.setTimeout(() => document.getElementById('new-word')?.focus(), getReducedMotionScrollBehavior() === 'auto' ? 0 : 350);
          }}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 xl:gap-8">
            <div className="lg:order-2 lg:col-span-8 xl:col-span-9">
              <Suspense fallback={<DeferredViewFallback label="Loading library cards" />}>
                <LibraryCardGrid
                  user={user}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  legacyCardsPending={legacyCardsPending}
                  migrateLegacyCards={handleMigrateLegacyCards}
                  isMigratingLegacy={isMigratingLegacy}
                  libraryHeadingRef={libraryHeadingRef}
                  activeCategory={activeCategory}
                  filteredCards={filteredCards}
                  shareCategory={handleShareCategory}
                  isSharing={isSharing}
                  startStudy={startStudy}
                  currentPage={currentPage}
                  paginatedCards={paginatedCards}
                  isPageLoading={isPageLoading}
                  cloudReadUnavailable={cloudReadUnavailable}
                  importProgress={importProgress}
                  groupedCards={groupedCards}
                  deleteCard={deleteCard}
                  toggleBookmark={toggleBookmark}
                  customDecks={customDecks}
                  assignDeck={handleAssignDeck}
                  updateCard={handleUpdateCard}
                  totalPages={totalPages}
                  setCurrentPage={setCurrentPage}
                  hasNextCloudPage={hasNextCloudPage}
                  libraryCount={libraryCount}
                  onClearFilters={() => {
                    setSearchQuery('');
                    setActiveCategory('All');
                    setActiveDate('All');
                    setActiveCustomDeck('All');
                    setActiveDifficulty('All');
                    setActivePartOfSpeech('All');
                    setShowStarredOnly(false);
                  }}
                />
              </Suspense>
            </div>
            <div className="lg:order-1 lg:col-span-4 lg:self-start xl:col-span-3">
              <Suspense fallback={<DeferredViewFallback label="Loading library tools" />}>
                <LibraryTools
                  fileInputRef={fileInputRef}
                  onImport={handleExcelImport}
                  onGenerate={handleGenerate}
                  wordInput={wordInput}
                  setWordInput={setWordInput}
                  isLoading={isLoading}
                  importProgress={importProgress}
                  libraryCount={libraryCount}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  showStarredOnly={showStarredOnly}
                  setShowStarredOnly={setShowStarredOnly}
                  activeDifficulty={activeDifficulty}
                  setActiveDifficulty={setActiveDifficulty}
                  activePartOfSpeech={activePartOfSpeech}
                  setActivePartOfSpeech={setActivePartOfSpeech}
                  user={user}
                  activeDate={activeDate}
                  setActiveDate={setActiveDate}
                  availableDates={availableDates}
                  customDecks={customDecks}
                  newDeckInput={newDeckInput}
                  setNewDeckInput={setNewDeckInput}
                  createCustomDeck={handleCreateCustomDeck}
                  activeCustomDeck={activeCustomDeck}
                  setActiveCustomDeck={setActiveCustomDeck}
                  cards={cards}
                  deleteCustomDeck={handleDeleteCustomDeck}
                  cloudFacetsComplete={cloudFacetsComplete}
                  sortedCategories={sortedCategories}
                  categoryCounts={categoryCounts}
                  activeCategory={activeCategory}
                  setActiveCategory={setActiveCategory}
                />
              </Suspense>
            </div>
          </div>
        </div>
        )}
        </div>
      </main>

      <footer className={`${viewMode === 'study' ? 'hidden' : 'hidden lg:flex'} h-9 relative px-8 items-center justify-between text-[11px] font-bold text-[var(--sf-text-muted)] flex-shrink-0 z-10 transition-colors`}>
        <div className="flex gap-6 uppercase tracking-wider">
          <span>LIBRARY: {libraryCountLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider">STATUS:</span>
          <span className={`${isBrowserOnline && !cloudReadUnavailable ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} uppercase tracking-widest px-2`}>
            {!isBrowserOnline ? 'Offline, using cache' : cloudReadUnavailable ? 'Cloud paused, using cache' : 'Online'}
          </span>
          <div className={`size-1.5 rounded-full ${isBrowserOnline && !cloudReadUnavailable ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
        </div>
      </footer>

      {/* Mobile-Friendly Nav Tab Bar (fixed at bottom on iPhone/mobile only) */}
      <div className={`${viewMode === 'study' ? 'hidden' : 'flex'} lg:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-50 liquid-glass min-h-14 rounded-[22px] items-center justify-around px-2 transition-transform`}>
        <button
          type="button"
          onClick={() => setViewMode('library')}
          className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-colors rounded-xl ${
            viewMode === 'library' ? 'bg-[var(--sf-surface-raised)] text-cyan-700 dark:text-cyan-300 font-black' : 'text-[var(--sf-text-muted)]'
          }`}
          aria-current={viewMode === 'library' ? 'page' : undefined}
        >
          <BookOpen size={18} />
          <span className="text-[10px] font-extrabold">Library</span>
        </button>
        
        <button
          type="button"
          onClick={startStudy}
          disabled={!canUseVisibleLibrary}
          className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-colors rounded-xl disabled:opacity-40 disabled:cursor-not-allowed ${
            viewMode === 'study' ? 'text-cyan-700 dark:text-cyan-300 font-black scale-105' : 'text-[var(--sf-text-muted)]'
          }`}
        >
          <Play size={18} />
          <span className="text-[10px] font-extrabold">Study</span>
        </button>

        <button
          type="button"
          onClick={openPracticeMenu}
          disabled={practiceLibraryCount < 4}
          className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-colors rounded-xl disabled:opacity-40 disabled:cursor-not-allowed ${
            viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story' ? 'text-cyan-700 dark:text-cyan-300 font-black scale-105' : 'text-[var(--sf-text-muted)]'
          }`}
          aria-current={viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story' ? 'page' : undefined}
          aria-haspopup="dialog"
          aria-expanded={isPracticeMenuOpen}
        >
          <Gamepad2 size={18} />
          <span className="text-[10px] font-extrabold">Practice</span>
        </button>

        <button
          type="button"
          onClick={openStats}
          aria-pressed={isStatsOpen}
          aria-haspopup="dialog"
          className={`min-h-11 flex flex-col items-center justify-center gap-0.5 flex-1 py-1 cursor-pointer transition-all rounded-xl ${
            isStatsOpen ? 'text-cyan-700 dark:text-cyan-300 font-black scale-105' : 'text-[var(--sf-text-muted)]'
          }`}
        >
          <BarChart3 size={18} />
          <span className="text-[10px] font-extrabold">Insights</span>
        </button>
      </div>

      {hasMountedOverlays && (
        <Suspense fallback={<span className="sr-only" role="status">Opening dialog</span>}>
          <AppOverlays
            shareLink={shareLink}
            setShareLink={value => {
              setShareLink(value);
              if (!value) setActiveShareId(null);
            }}
            canRevokeShare={Boolean(activeShareId)}
            revokeShare={handleRevokeShare}
            isSharing={isSharing}
            isPracticeMenuOpen={isPracticeMenuOpen}
            setIsPracticeMenuOpen={setIsPracticeMenuOpen}
            startQuiz={startQuiz}
            startSpelling={startSpelling}
            visibleLibraryCount={practiceLibraryCount}
            generateStory={handleGenerateStory}
            isStatsOpen={isStatsOpen}
            setIsStatsOpen={setIsStatsOpen}
            statsData={statsData}
            isDarkMode={isDarkMode}
            showClearConfirm={showClearConfirm}
            setShowClearConfirm={setShowClearConfirm}
            clearAll={clearAll}
            isLoading={isLoading}
            shareOpenerRef={shareOpenerRef}
            practiceOpenerRef={practiceOpenerRef}
            statsOpenerRef={statsOpenerRef}
            clearOpenerRef={clearOpenerRef}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <AppShellMotion
          appShellRef={appShellRef}
          navigationRef={navigationRef}
          viewMode={viewMode}
          viewStageRef={viewStageRef}
        />
      </Suspense>
    </div>
  );
}
