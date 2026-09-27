import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { CardTierBadge } from '../../components/flashcard/CardFront';
import { displayCardDate } from '../library/libraryPresentation';
import { useWebWordsPage } from './useWebWordsPage';
import { getLibraryCardTier } from '../library/libraryViewModel';
import type { WebWordsArticleGroup } from './webWordsGrouping';

export interface WebWordsPageProps {
  readonly onClose: () => void;
}

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
    <li className="rounded-[22px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-black text-[var(--sf-text)]">
            {isDisplayableSourceUrl(group.url) ? (
              <a href={group.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">{heading}</a>
            ) : (
              <span>{heading}</span>
            )}
          </p>
          {group.site && <p className="text-xs font-semibold text-[var(--sf-text-muted)]">{group.site}</p>}
        </div>
        <span className="shrink-0 text-xs font-bold text-[var(--sf-text-muted)]">{displayCardDate(group.day)}</span>
      </div>
      <ul className="mt-3">
        {group.cards.map(card => (
          <li key={card.id} className="flex items-center gap-3 border-b border-[var(--sf-border)] py-2 last:border-b-0">
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input
                type="checkbox"
                checked={selectedCardIds.has(card.id)}
                onChange={() => onToggleSelected(card.id)}
                aria-label={_(msg({ id: 'webWords.card.select-label', message: 'Select {word}' }).id, { word: card.word })}
                className="size-4 shrink-0 accent-[var(--sf-brand)]"
              />
              <span className="min-w-0 truncate font-bold text-[var(--sf-text)]">{card.word}</span>
              {card.translation && <span className="min-w-0 truncate text-sm text-[var(--sf-text-muted)]">{card.translation}</span>}
            </label>
            <CardTierBadge tier={getLibraryCardTier(card)} />
          </li>
        ))}
      </ul>
    </li>
  );
}

export function WebWordsPage({ onClose }: WebWordsPageProps) {
  const { state, actions } = useWebWordsPage();
  const { _ } = useLingui();

  const tierOptions = [
    { value: 'new' as const, label: _(msg({ id: 'flashcard.tier.new', message: 'New' })) },
    { value: 'learning' as const, label: _(msg({ id: 'flashcard.tier.learning', message: 'Learning' })) },
    { value: 'mastered' as const, label: _(msg({ id: 'flashcard.tier.mastered', message: 'Mastered' })) },
  ];

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-sm motion-reduce:backdrop-blur-none" />
        <Dialog.Content className="liquid-glass crystal-chamfer fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-[var(--sf-border)] shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] p-5 sm:p-6">
            <div className="min-w-0">
              <Dialog.Title className="text-balance text-2xl font-black tracking-tight"><Trans id="webWords.page.title" message="Web words" /></Dialog.Title>
              <Dialog.Description className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]"><Trans id="webWords.page.subtitle" message="Words captured while reading the web." /></Dialog.Description>
            </div>
            <Dialog.Close
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={_(msg({ id: 'webWords.page.close-label', message: 'Close web words' }))}
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </header>

          {state.status === 'ready' && (
            <div className="flex flex-wrap gap-3 border-b border-[var(--sf-border)] px-5 py-3 sm:px-6">
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
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
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
                <ul className="space-y-4">
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

          {state.selectedCardIds.size > 0 && (
            <footer className="flex items-center justify-between gap-3 border-t border-[var(--sf-border)] p-4 sm:p-5">
              <p className="text-sm font-bold text-[var(--sf-text)]">
                <Trans id="webWords.selection.count" message="{count, plural, one {# word selected} other {# words selected}}" values={{ count: state.selectedCardIds.size }} />
              </p>
              <button type="button" onClick={actions.addSelectedToToday} className="brand-action min-h-11 rounded-full bg-[var(--sf-brand)] px-5 font-extrabold text-[var(--sf-on-brand)]">
                <Trans id="webWords.actions.add-to-today" message="Add to today" />
              </button>
            </footer>
          )}

          {state.addToTodayStatus !== 'idle' && (
            <p role="status" aria-live="polite" className="border-t border-[var(--sf-border)] px-5 py-3 text-sm font-semibold text-[var(--sf-brand-text)] sm:px-6">
              {state.addToTodayStatus === 'added' && <Trans id="webWords.feedback.added" message="Added to today's new words." />}
              {state.addToTodayStatus === 'added-session-not-started' && <Trans id="webWords.feedback.added-session-not-started" message="Saved — these words will appear once you start today's session." />}
              {state.addToTodayStatus === 'added-after-new-stage' && <Trans id="webWords.feedback.added-after-new-stage" message="Saved — you already finished today's new words, so they'll appear in tomorrow's plan." />}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
