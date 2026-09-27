import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { LEGACY_CARD_LANGUAGE } from '../../types/card';
import type { CardData } from '../../types/card';
import { getLibraryCardTier, type LibraryCardTier } from '../library/libraryViewModel';
import { promoteCardsToActiveSessionNewStage } from '../dailyLearning/webWordsSessionPriority';
import { fetchWebWordsPage } from './webWordsQuery';
import { groupWebWordsByArticle, webWordsDayFromCard, webWordsSiteFromUrl, type WebWordsArticleGroup } from './webWordsGrouping';

/**
 * Every current card already carries an explicit `language` (`canonicalCard`
 * always writes one); the real multi-course selector is phase-10 work in
 * progress (`CourseSwitcherSlot`, not touched here). Matches the same
 * "single-course today" seam `DailySessionPointer.targetLanguage` documents.
 */
const DEFAULT_TARGET_LANGUAGE = LEGACY_CARD_LANGUAGE;

export type WebWordsPageStatus = 'loading' | 'ready' | 'empty' | 'signed-out' | 'error';
export type AddToTodayStatus = 'idle' | 'added' | 'added-session-not-started' | 'added-after-new-stage';

export interface WebWordsFilters {
  readonly site: string | null;
  readonly day: string | null;
  readonly tier: LibraryCardTier | null;
}

const emptyFilters: WebWordsFilters = { site: null, day: null, tier: null };

export interface WebWordsPageState {
  readonly status: WebWordsPageStatus;
  readonly groups: readonly WebWordsArticleGroup[];
  readonly filters: WebWordsFilters;
  readonly availableSites: readonly string[];
  readonly availableDays: readonly string[];
  readonly hasNext: boolean;
  readonly isLoadingMore: boolean;
  readonly selectedCardIds: ReadonlySet<string>;
  readonly addToTodayStatus: AddToTodayStatus;
}

export interface WebWordsPageActions {
  readonly setSiteFilter: (site: string | null) => void;
  readonly setDayFilter: (day: string | null) => void;
  readonly setTierFilter: (tier: LibraryCardTier | null) => void;
  readonly toggleSelected: (cardId: string) => void;
  readonly clearSelection: () => void;
  readonly loadMore: () => void;
  readonly addSelectedToToday: () => void;
  readonly retry: () => void;
}

export function useWebWordsPage(): { readonly state: WebWordsPageState; readonly actions: WebWordsPageActions } {
  const [ownerId, setOwnerId] = useState<string | null | undefined>(undefined);
  const [items, setItems] = useState<readonly CardData[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [status, setStatus] = useState<WebWordsPageStatus>('loading');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filters, setFilters] = useState<WebWordsFilters>(emptyFilters);
  const [selectedCardIds, setSelectedCardIds] = useState<ReadonlySet<string>>(new Set());
  const [addToTodayStatus, setAddToTodayStatus] = useState<AddToTodayStatus>('idle');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!auth) {
      setOwnerId(null);
      return;
    }
    return onAuthStateChanged(auth, user => setOwnerId(user?.uid ?? null));
  }, []);

  useEffect(() => {
    if (ownerId === undefined) return;
    if (ownerId === null || !db) {
      setStatus(ownerId === null ? 'signed-out' : 'error');
      setItems([]);
      setCursor(null);
      setHasNext(false);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetchWebWordsPage({ db, ownerId, targetLanguage: DEFAULT_TARGET_LANGUAGE })
      .then(page => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.cursor);
        setHasNext(page.hasNext);
        setStatus(page.items.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, reloadToken]);

  const loadMore = useCallback(() => {
    if (!ownerId || !db || !hasNext || isLoadingMore) return;
    setIsLoadingMore(true);
    fetchWebWordsPage({ db, ownerId, targetLanguage: DEFAULT_TARGET_LANGUAGE, cursor })
      .then(page => {
        setItems(previous => [...previous, ...page.items]);
        setCursor(page.cursor);
        setHasNext(page.hasNext);
      })
      .catch(() => {
        /* Leave the already-loaded page visible; hasNext/isLoadingMore reset below lets the learner retry. */
      })
      .finally(() => setIsLoadingMore(false));
  }, [ownerId, cursor, hasNext, isLoadingMore]);

  const retry = useCallback(() => setReloadToken(token => token + 1), []);

  const filteredItems = useMemo(() => items.filter(card => (
    (!filters.site || webWordsSiteFromUrl(card.source?.url) === filters.site)
    && (!filters.day || webWordsDayFromCard(card) === filters.day)
    && (!filters.tier || getLibraryCardTier(card) === filters.tier)
  )), [items, filters]);

  const groups = useMemo(() => groupWebWordsByArticle(filteredItems), [filteredItems]);

  const availableSites = useMemo(() => {
    const sites = new Set<string>();
    for (const card of items) {
      const site = webWordsSiteFromUrl(card.source?.url);
      if (site) sites.add(site);
    }
    return [...sites].sort();
  }, [items]);

  const availableDays = useMemo(() => {
    const days = new Set<string>();
    for (const card of items) {
      const day = webWordsDayFromCard(card);
      if (day) days.add(day);
    }
    return [...days].sort().reverse();
  }, [items]);

  const toggleSelected = useCallback((cardId: string) => {
    setSelectedCardIds(previous => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedCardIds(new Set()), []);

  const addSelectedToToday = useCallback(() => {
    if (!ownerId || selectedCardIds.size === 0) return;
    const selectedCards = items.filter(card => selectedCardIds.has(card.id));
    if (selectedCards.length === 0) return;
    const outcome = promoteCardsToActiveSessionNewStage(ownerId, selectedCards);
    setAddToTodayStatus(
      outcome === 'no-active-session' ? 'added-session-not-started'
        : outcome === 'new-stage-already-passed' ? 'added-after-new-stage'
          : 'added',
    );
    clearSelection();
  }, [ownerId, items, selectedCardIds, clearSelection]);

  return {
    state: { status, groups, filters, availableSites, availableDays, hasNext, isLoadingMore, selectedCardIds, addToTodayStatus },
    actions: {
      setSiteFilter: site => setFilters(previous => ({ ...previous, site })),
      setDayFilter: day => setFilters(previous => ({ ...previous, day })),
      setTierFilter: tier => setFilters(previous => ({ ...previous, tier })),
      toggleSelected,
      clearSelection,
      loadMore,
      addSelectedToToday,
      retry,
    },
  };
}
