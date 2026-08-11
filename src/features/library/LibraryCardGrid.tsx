import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ArrowRight, BookOpen, Calendar, ChevronLeft, ChevronRight, Filter, Image, Layers3, Loader2, Play, RotateCcw, Search, Share2, Sparkles } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CardData } from '../../types/card';
import type { LegacyMigrationIssue } from '../librarySession/ownerLibrarySessionController';
import { getLibraryGridLoadingLabel } from './libraryLoading';
import { Flashcard } from '../../components/Flashcard';
import { getReducedMotionScrollBehavior } from '../../lib/motion';

gsap.registerPlugin(useGSAP);

interface LibraryCardGridProps {
  /** Transitional compatibility for the current composition root. */
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
  updateCard: (cardId: string, fields: Partial<CardData>) => Promise<void>;
  totalPages: number;
  setCurrentPage?: (value: number | ((previous: number) => number)) => void;
  onPageChange?: (page: number) => void;
  hasNextCloudPage: boolean;
  onClearFilters: () => void;
  libraryCount: number;
}

export function getLegacyUpgradePresentation({
  pending,
  migrating,
  issue,
}: {
  pending: number;
  migrating: boolean;
  issue: LegacyMigrationIssue | null;
}): { title: string; message: string; actionLabel: string | null } | null {
  const safePending = Math.max(0, Math.floor(pending));
  if (safePending === 0 && !issue) return null;
  if (issue) {
    return {
      title: issue.retryable ? 'Library upgrade paused' : 'Library upgrade needs administrator help',
      message: issue.message,
      actionLabel: issue.retryable ? (migrating ? 'Upgrading…' : 'Retry upgrade') : null,
    };
  }
  return {
    title: `${safePending} older ${safePending === 1 ? 'card needs' : 'cards need'} a one-time library upgrade`,
    message: 'Upgrade up to 100 cards at a time without loading your entire library.',
    actionLabel: migrating ? 'Upgrading…' : 'Upgrade next 100',
  };
}

export function LibraryCardGrid({
  user, isAuthenticated, searchQuery, setSearchQuery, legacyCardsPending, legacyIssue, migrateLegacyCards, isMigratingLegacy,
  libraryHeadingRef, activeCategory, filteredCards, shareCategory, isSharing, startStudy,
  currentPage, paginatedCards, isPageLoading, cloudReadUnavailable, importProgress,
  groupedCards, deleteCard, toggleBookmark, customDecks, assignDeck, updateCard, totalPages,
  setCurrentPage, onPageChange, hasNextCloudPage, onClearFilters, libraryCount,
}: LibraryCardGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const startingStudyRef = useRef(false);
  const [isStartingStudy, setIsStartingStudy] = useState(false);
  const handleMigrateLegacyCards = migrateLegacyCards;
  const handleShareCategory = shareCategory;
  const handleAssignDeck = assignDeck;
  const handleUpdateCard = updateCard;
  const handleDelete = useCallback(async (cardId: string) => {
    await deleteCard(cardId);
    globalThis.requestAnimationFrame(() => {
      libraryHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [deleteCard, libraryHeadingRef]);
  const handleStartStudy = useCallback(async () => {
    if (startingStudyRef.current) return;
    startingStudyRef.current = true;
    setIsStartingStudy(true);
    try {
      await startStudy();
    } finally {
      startingStudyRef.current = false;
      setIsStartingStudy(false);
    }
  }, [startStudy]);
  const loadingLabel = getLibraryGridLoadingLabel({ currentPage, isPageLoading, importProgress });
  const authenticated = isAuthenticated ?? Boolean(user);
  const legacyUpgrade = getLegacyUpgradePresentation({
    pending: legacyCardsPending,
    migrating: isMigratingLegacy,
    issue: legacyIssue,
  });
  const changePage = (page: number) => {
    if (onPageChange) onPageChange(page);
    else setCurrentPage?.(page);
  };
  const cardSequenceKey = paginatedCards.map(card => card.id).join('|');
  let libraryCardIndex = 0;

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add(
      {
        reduced: '(prefers-reduced-motion: reduce)',
        expressive: '(prefers-reduced-motion: no-preference)',
      },
      context => {
        const cards = gsap.utils.toArray<HTMLElement>('[data-library-intro-index]', gridRef.current);
        const heading = gridRef.current?.querySelector('[data-gsap-library-heading]');
        if (context.conditions?.reduced) {
          gsap.set([heading, ...cards], { clearProps: 'transform,opacity,visibility' });
          return;
        }
        const timeline = gsap.timeline({ defaults: { ease: 'expo.out' } });
        if (heading) {
          timeline.fromTo(heading, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.24 });
        }
        if (cards.length > 0) {
          timeline.fromTo(
            cards,
            { autoAlpha: 0 },
            {
              autoAlpha: 1,
              duration: 0.3,
              stagger: 0.055,
              clearProps: 'opacity,visibility',
            },
            heading ? '<0.05' : 0,
          );
        }
      },
    );
    return () => media.revert();
  }, { scope: gridRef, dependencies: [cardSequenceKey], revertOnUpdate: true });

  return (
          <div ref={gridRef} id="library-card-grid" className="flex flex-col gap-5 sm:gap-7 lg:col-span-8 xl:col-span-9" aria-busy={Boolean(loadingLabel)}>
            <div className="liquid-glass lg:hidden flex items-center gap-2 rounded-2xl p-2">
              <Search size={18} className="ml-2 text-[var(--sf-text-muted)]" aria-hidden="true" />
              <label htmlFor="mobile-library-search" className="sr-only">Search English words</label>
              <input
                id="mobile-library-search"
                name="mobile-library-search"
                type="search"
                autoComplete="off"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search English words…"
                className="min-h-12 min-w-0 flex-1 bg-transparent px-1 py-2 text-base text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => document.getElementById('library-tools')?.scrollIntoView({ behavior: getReducedMotionScrollBehavior(), block: 'start' })}
                className="min-h-11 min-w-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
                aria-label="Open library filters"
              >
                <Filter size={18} />
              </button>
            </div>
            {authenticated && legacyUpgrade && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4" role="status">
                <div>
                  <p className="text-sm font-black text-amber-900 dark:text-amber-100">{legacyUpgrade.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">{legacyUpgrade.message}</p>
                </div>
                {legacyUpgrade.actionLabel ? (
                  <button
                    type="button"
                    onClick={() => void handleMigrateLegacyCards()}
                    disabled={isMigratingLegacy}
                    className="min-h-11 shrink-0 rounded-xl bg-amber-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-amber-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {legacyUpgrade.actionLabel}
                  </button>
                ) : null}
              </div>
            )}
            <div data-gsap-library-heading className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
               <div>
                 <h2 ref={libraryHeadingRef} tabIndex={-1} className="scroll-mt-4 text-2xl sm:text-3xl font-black tracking-tight text-[var(--sf-text)] focus:outline-none text-balance">
                   {activeCategory === 'All' ? 'Your library' : activeCategory}
                 </h2>
                 <p className="mt-1 text-sm text-[var(--sf-text-muted)] text-pretty">Review at the right time, remember for longer, and always resume where you left off.</p>
               </div>
               {filteredCards.length > 0 && (
                 <div className="flex gap-2">
                   <button 
                     onClick={handleShareCategory}
                     disabled={isSharing || !authenticated}
                     className="min-h-11 flex items-center gap-2 bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] px-4 py-2 rounded-xl text-xs font-bold hover:text-[var(--sf-text)] transition-colors uppercase tracking-widest border border-[var(--sf-border)] disabled:opacity-50"
                     title={!authenticated ? "Sign in to share" : "Share this deck"}
                   >
                     {isSharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} strokeWidth={2} />} Share
                   </button>
                   <button
                     onClick={() => void handleStartStudy()}
                     disabled={isStartingStudy}
                     aria-busy={isStartingStudy}
                     data-color-role="primary"
                     className="min-h-11 flex items-center gap-2 bg-[var(--sf-brand)] text-[var(--sf-on-brand)] px-4 py-2 rounded-xl text-sm font-bold hover:bg-[var(--sf-brand-hover)] hover:text-white transition-colors border border-[var(--sf-brand)] active:scale-[0.98]"
                   >
                     {isStartingStudy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Play size={15} strokeWidth={2} aria-hidden="true" />} {isStartingStudy ? 'Preparing…' : 'Study now'} {!isStartingStudy && <ArrowRight size={15} aria-hidden="true" />}
                   </button>
                 </div>
               )}
            </div>
            <p className="sr-only" aria-live="polite">Page {currentPage} loaded with {paginatedCards.length} cards.</p>
  
            <div className="relative flex-1 overflow-visible pb-8">
              {filteredCards.length === 0 && !loadingLabel ? (
                 <div className="premium-surface grid min-h-[360px] overflow-hidden rounded-[32px] lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                   <div className="flex flex-col justify-center p-7 sm:p-10">
                     <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand)]"><BookOpen size={22} /></div>
                     <p className="max-w-xl text-balance text-2xl font-black tracking-tight text-[var(--sf-text)] sm:text-3xl">
                       {authenticated && cloudReadUnavailable ? 'Cloud is taking a short break' : libraryCount > 0 ? 'No cards match this view' : 'Your first word starts here'}
                     </p>
                     <p className="mt-3 max-w-xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)] sm:text-base">
                       {authenticated && cloudReadUnavailable ? 'Your cloud cards are safe. Try again after the read quota resets, or create a card now and keep learning from this device.' : libraryCount > 0 ? 'Clear the active filters to return to your complete vocabulary library.' : 'Add a word and SonFlash will turn it into a vivid card with meaning, context, pronunciation, and a relevant image.'}
                     </p>
                     <button type="button" onClick={libraryCount > 0 ? onClearFilters : () => { document.getElementById('library-tools')?.scrollIntoView({ behavior: getReducedMotionScrollBehavior() }); document.getElementById('new-word')?.focus(); }} className="mt-6 inline-flex min-h-11 w-fit items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-2.5 text-sm font-bold text-[var(--sf-on-brand)] transition-[transform,background-color,color] hover:bg-[var(--sf-brand-hover)] hover:text-white active:scale-[0.98]">
                       {libraryCount > 0 ? <><RotateCcw size={16} /> Clear filters</> : <>Create your first card <ArrowRight size={16} /></>}
                     </button>
                   </div>
                   <div className="border-t border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-7 sm:p-10 lg:border-l lg:border-t-0">
                     <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--sf-text-muted)]">How learning flows</p>
                     <ol className="mt-6 space-y-5">
                       <LearningStep number="01" icon={<Sparkles size={18} />} title="Capture the word" copy="AI builds a complete card in seconds." />
                       <LearningStep number="02" icon={<Image size={18} />} title="Connect it to context" copy="Meaning, imagery, and examples make it memorable." />
                       <LearningStep number="03" icon={<Layers3 size={18} />} title="Review at the right time" copy="Adaptive repetition turns recall into a habit." />
                     </ol>
                   </div>
                 </div>
              ) : (
                 <div className="space-y-10">
                    <div className="space-y-10">
                   {loadingLabel && <LibrarySkeleton label={loadingLabel} />}
                   
                   {Object.entries(groupedCards).map(([dateLabel, groupCards]) => (
                     <div key={dateLabel} className="space-y-4">
                       <div className="flex w-fit items-center gap-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-1.5 text-xs font-bold text-[var(--sf-text-muted)] shadow-sm backdrop-blur-lg">
                         <Calendar size={14} /> {dateLabel}
                       </div>
                       <div className="mx-auto grid max-w-[1220px] grid-cols-1 gap-7 md:grid-cols-2 xl:gap-9">
                         {(groupCards as CardData[]).map(card => {
                           const introIndex = libraryCardIndex++;
                           const isIntroCard = introIndex < 6;
                           return (
                             <div
                               key={card.id}
                               data-library-intro-index={isIntroCard ? introIndex : undefined}
                             >
                               <Flashcard
                                 data={card}
                                 onDelete={handleDelete}
                                 onToggleBookmark={toggleBookmark}
                                 customDecks={customDecks}
                                 onAssignDeck={handleAssignDeck}
                                 onUpdateCard={handleUpdateCard}
                               />
                             </div>
                           );
                         })}
                       </div>
                     </div>
                   ))}
  
                    </div>
  
                    {totalPages > 1 && (
                     <div className="liquid-glass mx-auto mt-10 flex w-fit items-center justify-center gap-4 rounded-2xl p-2">
                       <button
                         onClick={() => changePage(Math.max(1, currentPage - 1))}
                         disabled={currentPage === 1 || isPageLoading}
                         className="liquid-control min-h-11 min-w-11 rounded-xl p-3 text-[var(--sf-text)] transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                         aria-label="Previous library page"
                       >
                         <ChevronLeft size={20} />
                       </button>
                       <span className="text-sm font-bold text-[var(--sf-text-muted)] uppercase tracking-widest">
                         Page {currentPage} / {totalPages}
                       </span>
                       <button
                         onClick={() => changePage(Math.min(totalPages, currentPage + 1))}
                         disabled={isPageLoading || (authenticated ? !hasNextCloudPage : currentPage === totalPages)}
                         className="liquid-control min-h-11 min-w-11 rounded-xl p-3 text-[var(--sf-text)] transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                         aria-label="Next library page"
                       >
                         <ChevronRight size={20} />
                       </button>
                     </div>
                   )}
                 </div>
              )}
            </div>
          </div>
  );
}

function LearningStep({ number, icon, title, copy }: { number: string; icon: ReactNode; title: string; copy: string }) {
  return <li className="grid grid-cols-[auto_1fr] gap-3"><div className="flex size-10 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text-muted)]">{icon}</div><div><p className="flex items-center gap-2 text-sm font-black text-[var(--sf-text)]"><span className="text-[10px] tabular-nums text-cyan-700 dark:text-cyan-300">{number}</span>{title}</p><p className="mt-1 text-xs leading-relaxed text-[var(--sf-text-muted)]">{copy}</p></div></li>;
}

function LibrarySkeleton({ label }: { label: string }) {
  return (
    <div className="mb-10" role="status" aria-live="polite">
      <p className="mb-4 text-sm font-semibold text-[var(--sf-text-muted)]">{label}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {[0, 1, 2, 3].map(index => <div key={index} className="skeleton-sheen h-[560px] rounded-[30px] border border-[var(--sf-border)]" />)}
      </div>
    </div>
  );
}
