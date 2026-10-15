import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { X } from 'lucide-react';
import { CardTierBadge } from '../../components/flashcard/CardFront';
import { displayCardDate } from '../library/libraryPresentation';
import { useWebWordsPage } from './useWebWordsPage';
import { getLibraryCardTier } from '../library/libraryViewModel';
import type { WebWordsArticleGroup } from './webWordsGrouping';

export interface WebWordsPageProps {
  readonly ownerId: string | null;
  readonly targetLanguage: string | null;
  readonly translationLanguage: string | null;
  readonly onClose: () => void;
}

export const closeWebWordsWorkspaceOnEscape = (
  event: Pick<ReactKeyboardEvent, 'key' | 'preventDefault'>,
  onClose: () => void,
) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  onClose();
};

/**
 * A source URL is private user data (contract-card-source-metadata.md): it is
 * never logged, only rendered as plain text, and only turned into a link
 * when it is a plain http/https URL, with `rel="noopener noreferrer"`.
 */
const isDisplayableSourceUrl = (value: string | undefined | null): value is string => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

function ArticleGroupCard({
  group,
  selectedCardIds,
  onToggleSelected,
}: {
  readonly group: WebWordsArticleGroup;
  readonly selectedCardIds: ReadonlySet<string>;
  readonly onToggleSelected: (cardId: string) => void;
}) {
  const { _ } = useLingui();
  const heading = group.title || group.site || _(msg({ id: 'webWords.group.untitled', message: 'Untitled capture' }));
  return (
    <li className="overflow-hidden rounded-[22px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--sf-border)] px-4 py-3 sm:px-5 sm:py-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--sf-brand)] font-black text-[var(--sf-on-brand)]" aria-hidden="true">
          {heading.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-black text-[var(--sf-text)]">
            {isDisplayableSourceUrl(group.url) ? (
              <a href={group.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">{heading}</a>
            ) : (
              <span>{heading}</span>
            )}
          </p>
          <p className="text-xs font-semibold text-[var(--sf-text-muted)]">
            {[group.site, displayCardDate(group.day)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <ul>
        {group.cards.map(card => (
          <li key={card.id} className="grid gap-3 border-b border-[var(--sf-border)] px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(9rem,11rem)_minmax(0,1fr)] sm:gap-4 sm:px-5">
            <label className="flex min-w-0 items-start gap-3">
              <input
                type="checkbox"
                checked={selectedCardIds.has(card.id)}
                onChange={() => onToggleSelected(card.id)}
                aria-label={_(msg({ id: 'webWords.card.select-label', message: 'Select {word}' }).id, { word: card.word })}
                className="size-4 shrink-0 accent-[var(--sf-brand)]"
              />
              <span className="min-w-0">
                <span className="block break-words font-black text-[var(--sf-text)]">{card.word}</span>
                {card.translation && <span className="mt-1 block break-words text-sm text-[var(--sf-text-muted)]">{card.translation}</span>}
              </span>
            </label>
            <div className="min-w-0">
              {card.source?.context && <p className="text-sm leading-6 text-[var(--sf-text-muted)]">{card.source.context}</p>}
              <div className="mt-2"><CardTierBadge tier={getLibraryCardTier(card)} /></div>
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function WebWordsPage({ ownerId, targetLanguage, translationLanguage, onClose }: WebWordsPageProps) {
  const { state, actions } = useWebWordsPage({ ownerId, targetLanguage, translationLanguage });
  const { _ } = useLingui();
  const openerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('root');
    const isPortaled = appRoot && !appRoot.contains(closeButtonRef.current);
    const wasInert = appRoot?.inert ?? false;
    if (isPortaled) appRoot.inert = true;
    closeButtonRef.current?.focus();
    return () => {
      if (isPortaled) appRoot.inert = wasInert;
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, []);

  const tierOptions = [
    { value: 'new' as const, label: _(msg({ id: 'flashcard.tier.new', message: 'Bud' })) },
    { value: 'learning' as const, label: _(msg({ id: 'flashcard.tier.learning', message: 'Bloom' })) },
    { value: 'mastered' as const, label: _(msg({ id: 'flashcard.tier.mastered', message: 'Star' })) },
  ];

  return (
    <section aria-label={_(msg({ id: 'webWords.page.title', message: 'Web words' }))} onKeyDown={event => closeWebWordsWorkspaceOnEscape(event, onClose)} className="fixed inset-0 z-50 flex min-h-dvh flex-col overflow-hidden text-[var(--sf-text)]" style={{ background: 'var(--sf-canvas)' }}>
      <header className="shrink-0 border-b border-[var(--sf-border)] bg-[var(--sf-surface)] px-5 py-5 sm:px-8 lg:px-14 lg:pt-7">
        <div className="mx-auto flex w-full max-w-[1328px] items-start justify-between gap-4">
            <div className="min-w-0">
              <button type="button" onClick={onClose} className="mb-2 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]"><Trans id="webWords.page.close-label" message="Close web words" /></button>
              <h1 className="text-balance font-serif text-3xl font-black tracking-tight sm:text-4xl"><Trans id="webWords.page.title" message="Web words" /></h1>
              <p className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]"><Trans id="webWords.page.subtitle" message="Words captured while reading the web." /></p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={_(msg({ id: 'webWords.page.close-label', message: 'Close web words' }))}
            >
              <X size={18} aria-hidden="true" />
            </button>
        </div>
      </header>

      {state.status === 'ready' && (
        <div className="shrink-0 border-b border-[var(--sf-border)] px-5 py-3 sm:px-8 lg:px-14">
          <div className="mx-auto flex w-full max-w-[1328px] flex-wrap gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans id="webWords.filter.site.label" message="Site" />
                <select
                  value={state.filters.site ?? ''}
                  onChange={event => actions.setSiteFilter(event.target.value || null)}
                  className="liquid-control min-h-9 rounded-full px-3 text-sm font-semibold text-[var(--sf-text)]"
                >
                  <option value="">{_(msg({ id: 'webWords.filter.site.all', message: 'All sites' }))}</option>
                  {state.availableSites.map(site => <option key={site} value={site}>{site}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans id="webWords.filter.day.label" message="Day" />
                <select
                  value={state.filters.day ?? ''}
                  onChange={event => actions.setDayFilter(event.target.value || null)}
                  className="liquid-control min-h-9 rounded-full px-3 text-sm font-semibold text-[var(--sf-text)]"
                >
                  <option value="">{_(msg({ id: 'webWords.filter.day.all', message: 'All days' }))}</option>
                  {state.availableDays.map(day => <option key={day} value={day}>{displayCardDate(day)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans id="webWords.filter.status.label" message="Status" />
                <select
                  value={state.filters.tier ?? ''}
                  onChange={event => actions.setTierFilter((event.target.value || null) as typeof state.filters.tier)}
                  className="liquid-control min-h-9 rounded-full px-3 text-sm font-semibold text-[var(--sf-text)]"
                >
                  <option value="">{_(msg({ id: 'webWords.filter.status.all', message: 'All statuses' }))}</option>
                  {tierOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 lg:px-14 lg:py-6">
        <div className="mx-auto w-full max-w-[1328px]">
            {state.status === 'loading' && (
              <p role="status" aria-live="polite" className="py-10 text-center text-sm font-semibold text-[var(--sf-text-muted)]">
                <Trans id="webWords.status.loading" message="Loading your web words…" />
              </p>
            )}
            {state.status === 'signed-out' && (
              <p className="py-10 text-center text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="webWords.status.signed-out" message="Sign in to see words you saved from the web." /></p>
            )}
            {state.status === 'error' && (
              <div className="py-10 text-center">
                <p className="text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="webWords.status.error" message="Web words could not load. Try again." /></p>
                <button type="button" onClick={actions.retry} className="mt-3 min-h-9 rounded-full border border-[var(--sf-border)] px-4 text-sm font-bold text-[var(--sf-text)]"><Trans id="today.error.retry" message="Try again" /></button>
              </div>
            )}
            {state.status === 'empty' && (
              <div className="py-10 text-center">
                <p className="font-black text-[var(--sf-text)]"><Trans id="webWords.status.empty.title" message="No web words yet" /></p>
                <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="webWords.status.empty.description" message="Save a word while reading on the web, and it will show up here." /></p>
              </div>
            )}
            {state.status === 'ready' && (
              <>
                {state.groups.length === 0 && state.hasNext && (
                  <p role="status" className="py-10 text-center text-sm font-semibold text-[var(--sf-text-muted)]">
                    <Trans id="webWords.status.empty-batch" message="No web words for this course are in this batch. Load more to keep looking." />
                  </p>
                )}
                <ul className="grid gap-4 xl:grid-cols-2">
                  {state.groups.map(group => (
                    <ArticleGroupCard key={group.key} group={group} selectedCardIds={state.selectedCardIds} onToggleSelected={actions.toggleSelected} />
                  ))}
                </ul>
                {state.hasNext && (
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={actions.loadMore}
                      disabled={state.isLoadingMore}
                      className="min-h-9 rounded-full border border-[var(--sf-border)] px-4 text-sm font-bold text-[var(--sf-text)] disabled:opacity-50"
                    >
                      <Trans id="webWords.actions.load-more" message="Load more" />
                    </button>
                  </div>
                )}
              </>
            )}
        </div>
      </div>

      {state.status === 'ready' && state.groups.length > 0 && (
        <footer className="shrink-0 border-t border-[var(--sf-border)] bg-[var(--sf-surface)] px-5 py-4 sm:px-8 lg:px-14">
          <div className="mx-auto flex w-full max-w-[1328px] items-center justify-between gap-3">
              {state.selectedCardIds.size > 0 && <p className="text-sm font-bold text-[var(--sf-text)]">
                <Trans id="webWords.selection.count" message="{count, plural, one {# word selected} other {# words selected}}" values={{ count: state.selectedCardIds.size }} />
              </p>}
              <button type="button" onClick={state.selectedCardIds.size > 0 ? actions.addSelectedToToday : actions.addAllFilteredToToday} className="brand-action min-h-11 rounded-full bg-[var(--sf-brand)] px-5 font-extrabold text-[var(--sf-on-brand)]">
                {state.selectedCardIds.size > 0
                  ? <Trans id="webWords.actions.add-to-today" message="Add to today" />
                  : <Trans id="webWords.actions.add-all-to-today" message="Add all {count} to today" values={{ count: state.groups.flatMap(group => group.cards).length }} />}
              </button>
          </div>
        </footer>
      )}

      {state.addToTodayStatus !== 'idle' && (
        <p role="status" aria-live="polite" className="shrink-0 border-t border-[var(--sf-border)] px-5 py-3 text-sm font-semibold text-[var(--sf-brand-text)] sm:px-8 lg:px-14">
              {state.addToTodayStatus === 'added' && <Trans id="webWords.feedback.added" message="Added to today's new words." />}
              {state.addToTodayStatus === 'added-partial' && <Trans id="webWords.feedback.added-partial" message="Added the words that fit today; the rest are queued for a later session." />}
              {['added-capped', 'added-unloaded', 'added-session-not-started', 'added-after-new-stage'].includes(state.addToTodayStatus) && <Trans id="webWords.feedback.not-added" message="These cards were not added to today's new-word stage. You can study them elsewhere or try again later." />}
              {state.addToTodayStatus === 'scheduled-normal-review' && <Trans id="webWords.feedback.scheduled-normal-review" message="These cards already follow their normal review schedule." />}
              {state.addToTodayHasNormallyScheduledCards && state.addToTodayStatus !== 'scheduled-normal-review' && <span className="ml-1"><Trans id="webWords.feedback.some-scheduled-normal-review" message="Other selected cards follow their normal review schedule." /></span>}
        </p>
      )}
    </section>
  );
}
