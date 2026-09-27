import { i18n } from '@lingui/core';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Loader2,
  Play,
  Share2,
  Star,
  Trash2,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { Trans, useLingui } from '@lingui/react';
import type { CardData } from '../../types/card';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { BulkCardFieldPatchRequest } from '../learning/learningPersistencePort';
import type { LegacyMigrationIssue } from '../librarySession/ownerLibrarySessionController';
import { formatNumber, formatRelativeTime } from '../../lib/format';
import { getLibraryCardTier, isLibraryCardDue, sortLibraryCards, type LibrarySortOrder } from './libraryViewModel';
import { getLibraryGridLoadingLabel } from './libraryLoading';
import { getRelativeReviewDays } from './libraryPresentation';

const EditCardDialog = lazy(() => import('../cardEdit/EditCardDialog').then(module => ({ default: module.EditCardDialog })));
const Flashcard = lazy(() => import('../../components/Flashcard').then(module => ({ default: module.Flashcard })));

export type LibraryViewMode = 'grid' | 'list';

interface LibraryCardGridProps {
  user?: unknown;
  isAuthenticated?: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  legacyCardsPending: number;
  legacyIssue: LegacyMigrationIssue | null;
  migrateLegacyCards: () => Promise<void>;
  isMigratingLegacy: boolean;
  libraryHeadingRef: RefObject<HTMLHeadingElement | null>;
  activeCategory: string;
  filteredCards: CardData[];
  shareCategory: () => Promise<void>;
  isSharing: boolean;
  startStudy: () => Promise<void>;
  currentPage: number;
  paginatedCards: CardData[];
  isPageLoading: boolean;
  cloudReadUnavailable: boolean;
  importProgress: { current: number; total: number; word: string } | null;
  groupedCards: Record<string, CardData[]>;
  deleteCard: (cardId: string) => Promise<void>;
  toggleBookmark: (cardId: string) => Promise<void>;
  customDecks: string[];
  assignDeck: (cardId: string, deckName: string | null) => Promise<void>;
  bulkPatchCards: (patches: readonly BulkCardFieldPatchRequest[]) => Promise<void>;
  updateCard: (cardId: string, fields: Partial<CardData>) => Promise<LearningStateOutcome>;
  totalPages: number;
  setCurrentPage?: (value: number | ((previous: number) => number)) => void;
  onPageChange?: (page: number) => void;
  hasNextCloudPage: boolean;
  onClearFilters: () => void;
  libraryCount: number;
  isGenerating?: boolean;
  viewMode?: LibraryViewMode;
  onViewModeChange?: (value: LibraryViewMode) => void;
}

/** One patch per selected card, all targeting the same deck (or unassigned). */
export function buildBulkDeckAssignPatches(
  cards: readonly Pick<CardData, 'id'>[],
  targetDeck: string | null,
): BulkCardFieldPatchRequest[] {
  return cards.map(card => ({ cardId: card.id, fields: { customDeck: targetDeck } }));
}

/** Each card toggles from its own current bookmark state, not a shared value. */
export function buildBulkBookmarkPatches(
  cards: readonly Pick<CardData, 'id' | 'bookmarked'>[],
): BulkCardFieldPatchRequest[] {
  return cards.map(card => ({ cardId: card.id, fields: { bookmarked: !card.bookmarked } }));
}

export function getLegacyUpgradePresentation({ pending, migrating, issue }: { pending: number; migrating: boolean; issue: LegacyMigrationIssue | null }) {
  const safePending = Math.max(0, Math.floor(pending));
  if (!safePending && !issue) return null;
  if (issue) {
    const message = issue.kind === 'trusted-migration'
      ? i18n._(msg({ id: 'library.upgrade.trusted-migration-description', message: 'Some older cards need a secure one-time migration. Your cards are safe; an administrator must complete this repair.' }).id)
      : issue.kind === 'cloud-access' && issue.retryable
        ? i18n._(msg({ id: 'library.upgrade.sign-in-description', message: 'Sign in again, then retry the library upgrade. Your cards remain safe.' }).id)
        : i18n._(msg({ id: 'library.upgrade.temporary-description', message: 'The library upgrade is temporarily unavailable. Your cards remain safe; check your connection and retry.' }).id);
    return {
      title: issue.retryable
        ? i18n._(msg({ id: 'library.upgrade.paused-title', message: 'Library upgrade paused' }).id)
        : i18n._(msg({ id: 'library.upgrade.help-title', message: 'Library upgrade needs administrator help' }).id),
      message,
      actionLabel: issue.retryable
        ? (migrating ? i18n._(msg({ id: 'library.upgrade.upgrading', message: 'Upgrading…' }).id) : i18n._(msg({ id: 'library.upgrade.retry', message: 'Retry upgrade' }).id))
        : null,
    };
  }
  return {
    title: i18n._(msg({ id: 'library.upgrade.pending-title', message: '{count, plural, one {# older card needs} other {# older cards need}} a one-time library upgrade' }).id, { count: safePending }),
    message: i18n._(msg({ id: 'library.upgrade.pending-description', message: 'Securely upgrades the library in resumable batches while preserving study progress.' }).id),
    actionLabel: migrating ? i18n._(msg({ id: 'library.upgrade.upgrading', message: 'Upgrading…' }).id) : i18n._(msg({ id: 'library.upgrade.start', message: 'Upgrade library' }).id),
  };
}

export function LibraryCardGrid({
  user,
  isAuthenticated,
  filteredCards,
  shareCategory,
  isSharing,
  startStudy,
  deleteCard,
  toggleBookmark,
  updateCard,
  customDecks,
  assignDeck,
  bulkPatchCards,
  currentPage,
  totalPages,
  onPageChange,
  setCurrentPage,
  paginatedCards,
  isPageLoading,
  hasNextCloudPage,
  onClearFilters,
  libraryCount,
  legacyCardsPending,
  legacyIssue,
  migrateLegacyCards,
  isMigratingLegacy,
  importProgress,
  cloudReadUnavailable,
  libraryHeadingRef,
  activeCategory,
  isGenerating = false,
  viewMode = 'grid',
}: LibraryCardGridProps) {
  const { i18n: catalog } = useLingui();
  const authenticated = isAuthenticated ?? Boolean(user);
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>('recent');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeck, setBulkDeck] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(false);
  const [editingCard, setEditingCard] = useState<CardData | null>(null);
  const [deletingCard, setDeletingCard] = useState<CardData | null>(null);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const deleteConfirmedRef = useRef(false);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const loadingLabel = getLibraryGridLoadingLabel({ currentPage, isPageLoading, importProgress });
  const loadingStatus = importProgress
    ? <Trans id="library.grid.import-progress" message="Creating {current} of {total}" values={{ current: formatNumber(importProgress.current), total: formatNumber(importProgress.total) }} />
    : isPageLoading
      ? <Trans id="library.grid.loading-page" message="Loading page {page}" values={{ page: formatNumber(currentPage) }} />
      : null;
  const legacy = getLegacyUpgradePresentation({ pending: legacyCardsPending, migrating: isMigratingLegacy, issue: legacyIssue });
  const cards = useMemo(() => sortLibraryCards(paginatedCards, sortOrder), [paginatedCards, sortOrder]);
  const selectedCards = useMemo(() => cards.filter(card => selectedIds.has(card.id)), [cards, selectedIds]);
  const allVisibleSelected = cards.length > 0 && cards.every(card => selectedIds.has(card.id));
  const changePage = (page: number) => onPageChange ? onPageChange(page) : setCurrentPage?.(page);

  const study = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      await startStudy();
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const afterDelete = useCallback(async (id: string) => {
    await deleteCard(id);
    globalThis.requestAnimationFrame?.(() => libraryHeadingRef.current?.focus({ preventScroll: true }));
  }, [deleteCard, libraryHeadingRef]);

  const openCard = (card: CardData, trigger: HTMLElement) => {
    detailTriggerRef.current = trigger;
    setDetailCardId(card.id);
  };
  // Resolved from the live, sorted `cards` array (not a snapshot captured at
  // open time) so a bookmark toggle, deck reassignment, or other in-place
  // edit made from the detail dialog is reflected immediately instead of
  // requiring the dialog to be closed and reopened to see its own effect.
  const detailCard = detailCardId ? cards.find(card => card.id === detailCardId) ?? null : null;

  // The opened card can drop out of `cards` while the dialog is still open
  // (unbookmarking under the Starred filter, a page change, or a live query
  // update). Clear the id — not just hide the dialog — so a card that later
  // reappears (e.g. re-bookmarked) doesn't pop the stale dialog back open.
  useEffect(() => {
    if (!detailCardId || detailCard) return;
    setDetailCardId(null);
    globalThis.requestAnimationFrame?.(() => {
      const trigger = detailTriggerRef.current;
      if (trigger && trigger.isConnected) trigger.focus();
      else libraryHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [detailCardId, detailCard, libraryHeadingRef]);

  const toggleSelected = (cardId: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (allVisibleSelected) cards.forEach(card => next.delete(card.id));
      else cards.forEach(card => next.add(card.id));
      return next;
    });
  };

  const runBulk = async (operation: () => Promise<void>) => {
    if (!selectedCards.length || bulkBusy) return;
    setBulkBusy(true);
    setBulkError(false);
    try {
      await operation();
      setSelectedIds(new Set());
      setBulkDeck('');
    } catch {
      setBulkError(true);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkAssign = () => {
    if (!bulkDeck) return;
    void runBulk(async () => {
      const target = bulkDeck === '__unassigned__' ? null : bulkDeck;
      await bulkPatchCards(buildBulkDeckAssignPatches(selectedCards, target));
    });
  };

  const bulkBookmark = () => {
    void runBulk(async () => {
      await bulkPatchCards(buildBulkBookmarkPatches(selectedCards));
    });
  };

  const tierLabel = (tier: ReturnType<typeof getLibraryCardTier>) => tier === 'new'
    ? catalog._(msg({ id: 'library.card.tier.new', message: 'New' }))
    : tier === 'learning'
      ? catalog._(msg({ id: 'library.card.tier.learning', message: 'Learning' }))
      : catalog._(msg({ id: 'library.card.tier.mastered', message: 'Mastered' }));
  const gradeLabel = (tier: ReturnType<typeof getLibraryCardTier>) => tier === 'new'
    ? catalog._(msg({ id: 'library.card.grade.new', message: 'Bud' }))
    : tier === 'learning'
      ? catalog._(msg({ id: 'library.card.grade.learning', message: 'Bloom' }))
      : catalog._(msg({ id: 'library.card.grade.mastered', message: 'Star' }));
  const nextLabel = (card: CardData) => {
    const due = card.nextReviewDate ?? card.fsrs?.due;
    if (!due) return catalog._(msg({ id: 'library.card.unseen', message: 'Unseen' }));
    if (isLibraryCardDue(card)) return catalog._(msg({ id: 'library.card.due-now', message: 'Due now' }));
    const days = getRelativeReviewDays(due);
    return days === null
      ? catalog._(msg({ id: 'library.card.unseen', message: 'Unseen' }))
      : formatRelativeTime(days, 'day', { numeric: 'always', style: 'narrow' });
  };
  const cardIsInteractive = (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    return target instanceof Element && Boolean(target.closest('button, input, select, a, [role="dialog"]'));
  };

  return (
    <section id="library-card-grid" data-library-card-collection="true" className={`library-canvas-collection library-canvas-collection--${viewMode}`} aria-busy={Boolean(loadingLabel || isGenerating)}>
      {legacy && <div className="library-canvas-notice" role="status"><div><strong>{legacy.title}</strong><p>{legacy.message}</p></div>{legacy.actionLabel && <button type="button" onClick={() => void migrateLegacyCards()} disabled={isMigratingLegacy}>{legacy.actionLabel}</button>}</div>}
      <div className="library-canvas-collection-head">
        <div><h2 ref={libraryHeadingRef} tabIndex={-1} className="sr-only">{activeCategory === 'All' ? <Trans id="library.grid.title" message="Your library" /> : activeCategory}</h2><p className="library-canvas-collection-caption"><Trans id="library.grid.collection-caption" message="Your words, ready when you are." /></p></div>
        {filteredCards.length > 0 && <div className="library-canvas-actions"><button type="button" onClick={() => void shareCategory()} disabled={isSharing || !authenticated}><Share2 size={15} aria-hidden="true"/><Trans id="library.grid.share" message="Share" /></button><button type="button" className="library-canvas-study" onClick={() => void study()} disabled={starting}>{starting ? <Loader2 className="animate-spin" size={15} aria-hidden="true"/> : <Play size={15} aria-hidden="true"/>}<Trans id="library.grid.study-now" message="Study now" /></button></div>}
      </div>
      <div className="library-canvas-collection-tools">
        <label className="library-canvas-sort"><span><Trans id="library.sort.label" message="Sort" /></span><select value={sortOrder} onChange={event => setSortOrder(event.target.value as LibrarySortOrder)}><option value="recent">{catalog._(msg({ id: 'library.sort.recent', message: 'Recently active' }))}</option><option value="alphabetical">{catalog._(msg({ id: 'library.sort.alphabetical', message: 'A to Z' }))}</option><option value="due">{catalog._(msg({ id: 'library.sort.due', message: 'Due first' }))}</option></select><ChevronDown size={14} aria-hidden="true" /></label>
        {cards.length > 0 && <label className="library-canvas-select-page"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /><span><Trans id="library.bulk.select-page" message="Select page" /></span></label>}
      </div>
      {selectedCards.length > 0 && <div className="library-canvas-bulk" role="toolbar" aria-label={catalog._(msg({ id: 'library.bulk.label', message: 'Bulk card tools' }))}>
        <strong><Trans id="library.bulk.selected" message="{count} selected" values={{ count: formatNumber(selectedCards.length) }} /></strong>
        <label><span className="sr-only"><Trans id="library.bulk.deck-label" message="Move selected cards to deck" /></span><select value={bulkDeck} onChange={event => setBulkDeck(event.target.value)} disabled={bulkBusy}><option value="">{catalog._(msg({ id: 'library.bulk.choose-deck', message: 'Choose deck' }))}</option>{customDecks.map(deck => <option key={deck} value={deck}>{deck}</option>)}<option value="__unassigned__">{catalog._(msg({ id: 'library.bulk.unassigned', message: 'Unassigned' }))}</option></select></label>
        <button type="button" onClick={bulkAssign} disabled={!bulkDeck || bulkBusy}>{bulkBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true"/> : <Check size={14} aria-hidden="true"/>}<Trans id="library.bulk.assign" message="Assign" /></button>
        <button type="button" onClick={bulkBookmark} disabled={bulkBusy}><Star size={14} aria-hidden="true"/><Trans id="library.bulk.bookmark" message="Bookmark" /></button>
        <button type="button" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy}><Trans id="library.bulk.clear" message="Clear" /></button>
      </div>}
      {bulkError && <p className="library-canvas-bulk-error" role="alert"><Trans id="library.bulk.error" message="Some cards could not be updated. Try again." /></p>}
      {loadingLabel && <p className="library-canvas-loading" role="status">{loadingStatus}</p>}
      {isGenerating && !loadingLabel && <p className="library-canvas-loading" role="status"><Trans id="library.grid.generating" message="Creating new flashcard with AI…" /></p>}
      {!cards.length && !loadingLabel && !isGenerating ? (
        <div className="library-canvas-empty">
          <BookOpen size={24} aria-hidden="true" />
          <h3>{cloudReadUnavailable ? <Trans id="library.grid.cloud-unavailable-title" message="Cloud is taking a short break" /> : libraryCount ? <Trans id="library.grid.no-match-title" message="No cards match this view" /> : <Trans id="library.grid.empty-title" message="Your first word starts here" />}</h3>
          <p>{cloudReadUnavailable ? <Trans id="library.grid.cloud-unavailable-description" message="Your cloud cards are safe. Try again after the read quota resets, or create a card now and keep learning from this device." /> : libraryCount ? <Trans id="library.grid.no-match-description" message="Clear the active filters to return to your complete vocabulary library." /> : <Trans id="library.grid.empty-description" message="Add a word and SonFlash will turn it into a vivid card." />}</p>
          {!cloudReadUnavailable && <button type="button" onClick={onClearFilters}>{libraryCount ? <Trans id="library.grid.clear-filters" message="Clear filters" /> : <Trans id="library.grid.create-first" message="Create your first card" />}</button>}
        </div>
      ) : <div className="library-canvas-card-grid" data-library-view={viewMode}>
        {cards.map(card => {
          const cardTier = getLibraryCardTier(card);
          const due = isLibraryCardDue(card);
          const openFromRow = (event: MouseEvent<HTMLElement>) => {
            if (!cardIsInteractive(event)) openCard(card, event.currentTarget);
          };
          const onRowKeyDown = (event: KeyboardEvent<HTMLElement>) => {
            if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
              event.preventDefault();
              openCard(card, event.currentTarget);
            }
          };
          return <article key={card.id} className={`library-word-card library-word-card--${cardTier}`} data-library-card-row="true" data-library-card-id={card.id} tabIndex={0} onClick={openFromRow} onKeyDown={onRowKeyDown}>
            <div className="library-word-cover">
              {card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" /> : <><span aria-hidden="true">{card.word.charAt(0).toUpperCase() || '·'}</span><small>{card.category}</small></>}
              <b className="library-word-grade">{gradeLabel(cardTier)}</b>
              {due && <b className="library-word-due"><span aria-hidden="true">!</span><Trans id="library.filters.due-short" message="Due" /></b>}
              {card.bookmarked && (
                <Star className="library-word-star" size={15} fill="currentColor" aria-label={catalog._(msg({ id: 'library.card.starred', message: 'Starred' }))}/>
              )}
            </div>
            <div className="library-word-body">
              <p className="library-word-meta"><i aria-hidden="true"/> {tierLabel(cardTier)} <span aria-hidden="true">·</span> {card.partOfSpeech ?? <Trans id="library.card.word" message="word" />}</p>
              <h3 lang={card.language}>{card.word}</h3>
              {card.phonetic && <code>{card.phonetic}</code>}
              <div className="library-word-translation-row"><p className="library-word-translation">{card.translation}</p><span>{nextLabel(card)}</span></div>
              <button type="button" ref={node => { if (node && detailCardId === card.id) detailTriggerRef.current = node; }} className="library-word-open" onClick={event => { event.stopPropagation(); openCard(card, event.currentTarget); }}><Trans id="library.card.open-details" message="Open card" /></button>
            </div>
            <div className="library-word-controls" onClick={event => event.stopPropagation()}>
              <label className="library-word-select"><input type="checkbox" checked={selectedIds.has(card.id)} onChange={() => toggleSelected(card.id)} aria-label={catalog._(msg({ id: 'library.card.select', message: 'Select card' }))}/><span className="sr-only"><Trans id="library.card.select" message="Select card" /></span></label>
              <button type="button" aria-label={catalog._(msg({ id: 'flashcard.edit', message: 'Edit card' }))} onClick={() => setEditingCard(card)}><Edit3 size={14} aria-hidden="true"/></button>
              <button type="button" aria-label={catalog._(msg({ id: 'library.card.bookmark', message: 'Bookmark card' }))} onClick={() => void toggleBookmark(card.id)}><Star size={14} fill={card.bookmarked ? 'currentColor' : 'none'} aria-hidden="true"/></button>
              <button type="button" aria-label={catalog._(msg({ id: 'library.card.delete', message: 'Delete card' }))} onClick={event => { deleteConfirmedRef.current = false; deleteTriggerRef.current = event.currentTarget; setDeletingCard(card); }}><Trash2 size={14} aria-hidden="true"/></button>
            </div>
          </article>;
        })}
      </div>}
      <p className="sr-only" aria-live="polite"><Trans id="library.grid.page-loaded" message="Page {page} loaded with {count, plural, one {# card} other {# cards}}." values={{ page: formatNumber(currentPage), count: cards.length }} /></p>
      {totalPages > 1 && <nav className="library-canvas-pages" aria-label={catalog._(msg({ id: 'library.grid.pages-nav', message: 'Library pages' }))}><button type="button" onClick={() => changePage(Math.max(1, currentPage - 1))} disabled={currentPage === 1 || isPageLoading} aria-label={catalog._(msg({ id: 'library.grid.previous-page', message: 'Previous library page' }))}><ChevronLeft size={18} aria-hidden="true" /></button><span><Trans id="library.grid.page" message="Page {current} / {total}" values={{ current: formatNumber(currentPage), total: formatNumber(totalPages) }}/></span><button type="button" onClick={() => changePage(Math.min(totalPages, currentPage + 1))} disabled={isPageLoading || (authenticated ? !hasNextCloudPage : currentPage === totalPages)} aria-label={catalog._(msg({ id: 'library.grid.next-page', message: 'Next library page' }))}><ChevronRight size={18} aria-hidden="true" /></button></nav>}

      {editingCard && <Suspense fallback={null}><EditCardDialog card={editingCard} open onOpenChange={open => !open && setEditingCard(null)} onSave={updateCard}/></Suspense>}
      <Dialog.Root open={Boolean(detailCard)} onOpenChange={open => { if (!open) { setDetailCardId(null); globalThis.requestAnimationFrame?.(() => detailTriggerRef.current?.focus()); } }}><Dialog.Portal><Dialog.Overlay className="library-card-detail-overlay"/><Dialog.Content className="library-card-detail-dialog"><Dialog.Title className="sr-only"><Trans id="library.card.detail-title" message="Card details" /></Dialog.Title>{detailCard && <Suspense fallback={<div className="library-canvas-loading" role="status"><Trans id="library.loading.cards" message="Loading library cards" /></div>}><Flashcard data={detailCard} onDelete={async id => { await afterDelete(id); setDetailCardId(null); }} onToggleBookmark={id => void toggleBookmark(id)} customDecks={customDecks} onAssignDeck={(id, deck) => void assignDeck(id, deck)} onUpdateCard={updateCard}/></Suspense>}<Dialog.Close className="library-card-detail-close" aria-label={catalog._(msg({ id: 'common.close', message: 'Close' }))}>×</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
      <AlertDialog.Root open={Boolean(deletingCard)} onOpenChange={open => {
        if (open) return;
        setDeletingCard(null);
        // Cancelling should return focus to the row's own delete trigger;
        // confirming lets afterDelete's own focus move (to the library
        // heading) win instead, matching Flashcard.tsx's equivalent dialog.
        if (!deleteConfirmedRef.current) globalThis.requestAnimationFrame?.(() => deleteTriggerRef.current?.focus());
        deleteConfirmedRef.current = false;
      }}><AlertDialog.Portal><AlertDialog.Overlay className="library-delete-overlay"/><AlertDialog.Content className="library-delete-dialog"><AlertDialog.Title><Trans id="library.delete.title" message="Delete card?" /></AlertDialog.Title><AlertDialog.Description><Trans id="library.delete.description" message="This will permanently remove {word} from your library." values={{ word: deletingCard?.word ?? '' }} /></AlertDialog.Description><div><AlertDialog.Cancel><Trans id="common.cancel" message="Cancel" /></AlertDialog.Cancel><AlertDialog.Action onClick={() => { deleteConfirmedRef.current = true; if (deletingCard) void afterDelete(deletingCard.id); setDeletingCard(null); }}><Trans id="library.delete.confirm" message="Delete card" /></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    </section>
  );
}
