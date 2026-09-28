import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { CardData } from '../../types/card';
import { getLibraryCardTier, type LibraryCardTier } from '../library/libraryViewModel';
import { promoteCardsToActiveSessionNewStage } from '../dailyLearning/webWordsSessionPriority';
import { fetchWebWordsPage } from './webWordsQuery';
import { groupWebWordsByArticle, webWordsDayFromCard, webWordsSiteFromUrl, type WebWordsArticleGroup } from './webWordsGrouping';

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
  readonly addAllFilteredToToday: () => void;
  readonly loadMore: () => void;
  readonly addSelectedToToday: () => void;
  readonly retry: () => void;
}

export interface UseWebWordsPageOptions {
  readonly ownerId: string | null;
  readonly targetLanguage: string | null;
}

export function useWebWordsPage({ ownerId, targetLanguage }: UseWebWordsPageOptions): { readonly state: WebWordsPageState; readonly actions: WebWordsPageActions } {
  const scopeKey = `${ownerId ?? ''}\u0000${targetLanguage ?? ''}`;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
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
    setItems([]);
    setCursor(null);
    setHasNext(false);
    setIsLoadingMore(false);
    setFilters(emptyFilters);
    setSelectedCardIds(new Set());
    setAddToTodayStatus('idle');
    if (ownerId === null) {
      setStatus('signed-out');
      return;
    }
    if (!targetLanguage || !db) {
      setStatus('error');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetchWebWordsPage({ db, ownerId, targetLanguage })
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
  }, [ownerId, targetLanguage, reloadToken]);

  const loadMore = useCallback(() => {
    if (!ownerId || !targetLanguage || !db || !hasNext || isLoadingMore) return;
    setIsLoadingMore(true);
    const scope = scopeKey;
    fetchWebWordsPage({ db, ownerId, targetLanguage, cursor })
      .then(page => {
        if (scope !== activeScopeRef.current) return;
        setItems(previous => [...previous, ...page.items]);
        setCursor(page.cursor);
        setHasNext(page.hasNext);
      })
      .catch(() => {
        /* Leave the already-loaded page visible; hasNext/isLoadingMore reset below lets the learner retry. */
      })
      .finally(() => {
        if (scope === activeScopeRef.current) setIsLoadingMore(false);
      });
  }, [ownerId, targetLanguage, scopeKey, cursor, hasNext, isLoadingMore]);

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

  const addCardsToToday = useCallback((cards: readonly CardData[]) => {
    if (!ownerId || cards.length === 0) return;
    const outcome = promoteCardsToActiveSessionNewStage(ownerId, cards);
    setAddToTodayStatus(
      outcome === 'no-active-session' ? 'added-session-not-started'
        : outcome === 'new-stage-already-passed' ? 'added-after-new-stage'
          : 'added',
    );
    clearSelection();
  }, [ownerId, clearSelection]);

  const addSelectedToToday = useCallback(() => {
    addCardsToToday(items.filter(card => selectedCardIds.has(card.id)));
  }, [addCardsToToday, items, selectedCardIds]);

  const addAllFilteredToToday = useCallback(() => {
    addCardsToToday(filteredItems);
  }, [addCardsToToday, filteredItems]);

  return {
    state: { status, groups, filters, availableSites, availableDays, hasNext, isLoadingMore, selectedCardIds, addToTodayStatus },
    actions: {
      setSiteFilter: site => setFilters(previous => ({ ...previous, site })),
      setDayFilter: day => setFilters(previous => ({ ...previous, day })),
      setTierFilter: tier => setFilters(previous => ({ ...previous, tier })),
      toggleSelected,
      clearSelection,
      addAllFilteredToToday,
      loadMore,
      addSelectedToToday,
      retry,
    },
  };
}
