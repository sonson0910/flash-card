import { useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { ExternalLink, Plus } from 'lucide-react';
import { Lumi } from '../../components/lumi/Lumi';
import { displayCardDate } from '../library/libraryPresentation';
import type { WebWordsReturnView } from '../navigation/useAppNavigation';
import { useWebWordsPage } from './useWebWordsPage';
import { getLibraryCardTier, type LibraryCardTier } from '../library/libraryViewModel';
import type { WebWordsArticleGroup } from './webWordsGrouping';
import './web-words.css';

export interface WebWordsPageProps {
  readonly ownerId: string | null;
  readonly targetLanguage: string | null;
  readonly translationLanguage: string | null;
  /** Returns to `returnView`; the app runtime hosts the page as the `web-words` view. */
  readonly onClose: () => void;
  /** Where the back link leads; web words is a sub-view of Vocabulary. */
  readonly returnView?: WebWordsReturnView;
  /** Receives focus when the learner navigates to the view, like every other view heading. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
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

const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * Splits a saved sentence around the first place the word occurs, widening a
 * Latin match to the whole token ("embankment" marks "embankments"). Returns
 * null when the word is not in the sentence, so nothing is marked by guess.
 */
export function splitContextAtWord(context: string, word: string): readonly [string, string, string] | null {
  const needle = word.trim().toLowerCase();
  const haystack = context.toLowerCase();
  if (!needle || haystack.length !== context.length) return null;
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  let start = index;
  let end = index + needle.length;
  while (start > 0 && LATIN_LETTER.test(context[start - 1])) start -= 1;
  while (end < context.length && LATIN_LETTER.test(context[end])) end += 1;
  return [context.slice(0, start), context.slice(start, end), context.slice(end)];
}

function SavedSentence({ context, word }: { readonly context: string; readonly word: string }) {
  const parts = splitContextAtWord(context, word);
  return (
    <q className="ww-row__quote">
      {parts ? <>{parts[0]}<mark className="ww-row__hit">{parts[1]}</mark>{parts[2]}</> : context}
    </q>
  );
}

function StatusChip({ tier }: { readonly tier: LibraryCardTier }) {
  const { _ } = useLingui();
  const grade = tier === 'new' ? _(msg({ id: 'flashcard.tier.new', message: 'Bud' }))
    : tier === 'learning' ? _(msg({ id: 'flashcard.tier.learning', message: 'Bloom' }))
      : _(msg({ id: 'flashcard.tier.mastered', message: 'Star' }));
  return (
    <span className="ww-chip" data-tier={tier}>
      <span className="ww-chip__dot" aria-hidden="true" />
      <span className="ww-chip__grade" aria-hidden="true">{grade}</span>
      <span className="ww-chip__label">
        {tier === 'new' && <Trans {...msg({ context: 'webWords.chip.new', message: 'New' })} />}
        {tier === 'learning' && <Trans {...msg({ context: 'webWords.chip.learning', message: 'Learning' })} />}
        {tier === 'mastered' && <Trans {...msg({ context: 'webWords.chip.known', message: 'Known' })} />}
      </span>
    </span>
  );
}

function ArticleGroupCard({
  group,
  edge,
  selectedCardIds,
  onToggleSelected,
}: {
  readonly group: WebWordsArticleGroup;
  readonly edge: 'crimson' | 'holo';
  readonly selectedCardIds: ReadonlySet<string>;
  readonly onToggleSelected: (cardId: string) => void;
}) {
  const { _ } = useLingui();
  const heading = group.title || group.site || _(msg({ id: 'webWords.group.untitled', message: 'Untitled capture' }));
  const link = isDisplayableSourceUrl(group.url) ? group.url : null;
  return (
    <li className="ww-article crystal-chamfer" data-edge={edge}>
      <div className="ww-article__head">
        <span className="ww-article__mark crystal-chamfer-sm" aria-hidden="true">{(group.site || heading).slice(0, 1).toUpperCase()}</span>
        <div className="ww-article__text">
          <p className="ww-article__title">
            {link ? <a href={link} target="_blank" rel="noopener noreferrer">{heading}</a> : <span>{heading}</span>}
          </p>
          <p className="ww-article__meta">
            {[group.site, displayCardDate(group.day)].filter(Boolean).join(' · ')}
            {' · '}
            <Trans {...msg({ context: 'webWords.group.word-count', message: '{count, plural, one {# word} other {# words}}' })} values={{ count: group.cards.length }} />
          </p>
        </div>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="ww-article__open" aria-label={_(msg({ context: 'webWords.group.open', message: 'Open {title} in a new tab' }).id, { title: heading })}>
            <span className="ww-article__open-face crystal-chamfer-sm"><ExternalLink size={13} aria-hidden="true" /></span>
          </a>
        )}
      </div>
      <ul className="ww-article__rows">
        {group.cards.map(card => {
          const tier = getLibraryCardTier(card);
          return (
            <li key={card.id} className="ww-row" data-tier={tier}>
              <div className="ww-row__word">
                <span className="ww-row__term">{card.word}</span>
                {card.translation && <span className="ww-row__meaning">{card.translation}</span>}
              </div>
              <div className="ww-row__context">
                {card.source?.context && <SavedSentence context={card.source.context} word={card.word} />}
                <StatusChip tier={tier} />
              </div>
              <label className="ww-row__select">
                <input
                  type="checkbox"
                  checked={selectedCardIds.has(card.id)}
                  onChange={() => onToggleSelected(card.id)}
                  aria-label={_(msg({ id: 'webWords.card.select-label', message: 'Select {word}' }).id, { word: card.word })}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function StateMessage({ children }: { readonly children: ReactNode }) {
  return <div className="ww-state crystal-chamfer">{children}</div>;
}

export function WebWordsPage({ ownerId, targetLanguage, translationLanguage, onClose, returnView = 'library', headingRef, focusIntent = 0 }: WebWordsPageProps) {
  const { state, actions } = useWebWordsPage({ ownerId, targetLanguage, translationLanguage });
  const { _ } = useLingui();

  useLayoutEffect(() => {
    if (focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingRef]);

  const backLabel = returnView === 'library' ? _(msg({ context: 'webWords.back.library', message: 'Vocabulary' }))
    : returnView === 'today' ? _(msg({ context: 'webWords.back.today', message: 'Today' }))
      : returnView === 'progress' ? _(msg({ context: 'webWords.back.progress', message: 'Progress' }))
        : returnView === 'settings' ? _(msg({ context: 'webWords.back.settings', message: 'Settings' }))
          : _(msg({ context: 'webWords.back.paths', message: 'Paths' }));

  const statusTabs: readonly { readonly value: LibraryCardTier | null; readonly label: ReactNode }[] = [
    { value: null, label: <Trans {...msg({ context: 'webWords.tab.all', message: 'All {count}' })} values={{ count: state.statusScopeCount }} /> },
    { value: 'new', label: <Trans {...msg({ context: 'webWords.chip.new', message: 'New' })} /> },
    { value: 'learning', label: <Trans {...msg({ context: 'webWords.chip.learning', message: 'Learning' })} /> },
    { value: 'mastered', label: <Trans {...msg({ context: 'webWords.chip.known', message: 'Known' })} /> },
  ];
  const visibleCount = state.groups.reduce((total, group) => total + group.cards.length, 0);
  const isReady = state.status === 'ready';

  return (
    <section
      data-web-words-page
      aria-label={_(msg({ id: 'webWords.page.title', message: 'Web words' }))}
      onKeyDown={event => closeWebWordsWorkspaceOnEscape(event, onClose)}
      className="ww-page"
    >
      <div className="ww-inner">
        <header className="ww-head">
          <div className="ww-head__text">
            <button type="button" onClick={onClose} className="ww-back">
              <span aria-hidden="true">←</span> {backLabel}
              <span className="sr-only"> · <Trans {...msg({ id: 'webWords.page.close-label', message: 'Close web words' })} /></span>
            </button>
            <h1 ref={headingRef} tabIndex={-1} className="ww-title"><Trans {...msg({ context: 'webWords.page.heading', message: '<0>Words you met</0> <1>on the web</1>' })} components={{ 0: <span className="ww-title__lead" />, 1: <em /> }} /></h1>
            <p className="ww-subtitle"><Trans {...msg({ context: 'webWords.page.description', message: 'Saved with the SonFlash extension — each one keeps the sentence you found it in.' })} /></p>
          </div>
          <div className="ww-lumi" data-web-words-lumi>
            <Lumi pose="hint" size={92} />
            <div className="ww-lumi__bubble crystal-chamfer-sm">
              <p className="ww-lumi__tag"><Trans {...msg({ context: 'webWords.lumi.tag', message: 'Lumi · Link' })} /></p>
              <p className="ww-lumi__text"><Trans {...msg({ context: 'webWords.lumi.text', message: 'I keep the whole sentence, so you remember the context.' })} /></p>
            </div>
          </div>
          {isReady && (
            <div className="ww-toolbar">
              <div className="ww-filters">
                <div role="radiogroup" aria-label={_(msg({ context: 'webWords.filter.status.label', message: 'Status' }))} className="ww-tabs">
                  {statusTabs.map(tab => {
                    const checked = state.filters.tier === tab.value;
                    return (
                      <label key={tab.value ?? 'all'} className="ww-tab" data-checked={checked}>
                        <input type="radio" name="web-words-status" className="sr-only" checked={checked} onChange={() => actions.setTierFilter(tab.value)} />
                        <span className="ww-tab__face">{tab.label}</span>
                      </label>
                    );
                  })}
                </div>
                <label className="ww-select">
                  <span className="sr-only"><Trans {...msg({ context: 'webWords.filter.site.label', message: 'Site' })} /></span>
                  <select value={state.filters.site ?? ''} onChange={event => actions.setSiteFilter(event.target.value || null)}>
                    <option value="">{_(msg({ id: 'webWords.filter.site.all', message: 'All sites' }))}</option>
                    {state.availableSites.map(site => <option key={site} value={site}>{site}</option>)}
                  </select>
                </label>
                <label className="ww-select">
                  <span className="sr-only"><Trans {...msg({ context: 'webWords.filter.day.label', message: 'Day' })} /></span>
                  <select value={state.filters.day ?? ''} onChange={event => actions.setDayFilter(event.target.value || null)}>
                    <option value="">{_(msg({ id: 'webWords.filter.day.all', message: 'All days' }))}</option>
                    {state.availableDays.map(day => <option key={day} value={day}>{displayCardDate(day)}</option>)}
                  </select>
                </label>
              </div>
              {state.groups.length > 0 && (
                <div className="ww-cta">
                  {state.selectedCardIds.size > 0 && <p className="ww-cta__count">
                    <Trans {...msg({ context: 'webWords.selection.count', message: '{count, plural, one {# word selected} other {# words selected}}' })} values={{ count: state.selectedCardIds.size }} />
                  </p>}
                  <button type="button" onClick={state.selectedCardIds.size > 0 ? actions.addSelectedToToday : actions.addAllFilteredToToday} className="ww-primary">
                    <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
                    <span className="ww-primary__label">
                      {state.selectedCardIds.size > 0
                        ? <Trans {...msg({ context: 'webWords.actions.add-selected-to-session', message: 'Add to today’s session' })} />
                        : <Trans {...msg({ context: 'webWords.actions.add-all-to-session', message: 'Add all {count} to today’s session' })} values={{ count: visibleCount }} />}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        {state.addToTodayStatus !== 'idle' && (
          <p role="status" aria-live="polite" className="ww-feedback">
            {state.addToTodayStatus === 'added' && <Trans {...msg({ context: 'webWords.feedback.added', message: 'Added to today\'s new words.' })} />}
            {state.addToTodayStatus === 'added-partial' && <Trans {...msg({ context: 'webWords.feedback.added-partial', message: 'Added the words that fit today; the rest are queued for a later session.' })} />}
            {['added-capped', 'added-unloaded', 'added-session-not-started'].includes(state.addToTodayStatus) && <Trans {...msg({ context: 'webWords.feedback.queued', message: 'These words are queued and get priority in your next new-word session.' })} />}
            {state.addToTodayStatus === 'added-after-new-stage' && <Trans {...msg({ context: 'webWords.feedback.not-added', message: 'These cards were not added to today\'s new-word stage. You can study them elsewhere or try again later.' })} />}
            {state.addToTodayStatus === 'scheduled-normal-review' && <Trans {...msg({ context: 'webWords.feedback.scheduled-normal-review', message: 'These cards already follow their normal review schedule.' })} />}
            {state.addToTodayHasNormallyScheduledCards && state.addToTodayStatus !== 'scheduled-normal-review' && <span className="ww-feedback__extra"><Trans {...msg({ context: 'webWords.feedback.some-scheduled-normal-review', message: 'Other selected cards follow their normal review schedule.' })} /></span>}
          </p>
        )}

        {state.status === 'loading' && (
          <StateMessage>
            <p role="status" aria-live="polite" className="ww-state__text">
              <Trans {...msg({ context: 'webWords.status.loading', message: 'Loading your web words…' })} />
            </p>
          </StateMessage>
        )}
        {state.status === 'signed-out' && (
          <StateMessage><p className="ww-state__text"><Trans {...msg({ context: 'webWords.status.signed-out', message: 'Sign in to see words you saved from the web.' })} /></p></StateMessage>
        )}
        {state.status === 'error' && (
          <StateMessage>
            <p className="ww-state__text"><Trans {...msg({ context: 'webWords.status.error', message: 'Web words could not load. Try again.' })} /></p>
            <button type="button" onClick={actions.retry} className="ww-secondary crystal-chamfer-sm"><Trans {...msg({ id: 'today.error.retry', message: 'Try again' })} /></button>
          </StateMessage>
        )}
        {state.status === 'empty' && (
          <StateMessage>
            <p className="ww-state__title"><Trans {...msg({ context: 'webWords.status.empty.title', message: 'No web words yet' })} /></p>
            <p className="ww-state__text"><Trans {...msg({ context: 'webWords.status.empty.description', message: 'Save a word while reading on the web, and it will show up here.' })} /></p>
          </StateMessage>
        )}
        {isReady && (
          <>
            {state.groups.length === 0 && state.hasNext && (
              <StateMessage>
                <p role="status" className="ww-state__text">
                  <Trans {...msg({ context: 'webWords.status.empty-batch', message: 'No web words for this course are in this batch. Load more to keep looking.' })} />
                </p>
              </StateMessage>
            )}
            <ul className="ww-articles">
              {state.groups.map((group, index) => (
                <ArticleGroupCard key={group.key} group={group} edge={index % 2 === 0 ? 'crimson' : 'holo'} selectedCardIds={state.selectedCardIds} onToggleSelected={actions.toggleSelected} />
              ))}
            </ul>
            {state.hasNext && (
              <div className="ww-more">
                <button type="button" onClick={actions.loadMore} disabled={state.isLoadingMore} className="ww-secondary crystal-chamfer-sm">
                  <Trans {...msg({ context: 'webWords.actions.load-more', message: 'Load more' })} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
