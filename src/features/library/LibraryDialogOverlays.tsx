import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { AlertTriangle, Check, Download, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import './library-dialog-overlays.css';

export type LibraryDialogPhase = 'idle' | 'working' | 'success' | 'failure';

const deckSuggestions = [
  msg({ id: 'library.deck.suggestion.ielts-writing', message: 'IELTS Writing' }),
  msg({ id: 'library.deck.suggestion.travel', message: 'Travel' }),
  msg({ id: 'library.deck.suggestion.toeic-600', message: 'TOEIC 600' }),
];

export function restoreLibraryDialogFocus(
  event: { preventDefault: () => void },
  restoreFocusRef?: RefObject<HTMLElement | null>,
) {
  event.preventDefault();
  restoreFocusRef?.current?.focus();
}

export interface LibraryDialogChromeProps {
  restoreFocusRef?: RefObject<HTMLElement | null>;
  status: LibraryDialogPhase;
}

export interface DeckCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  status?: LibraryDialogPhase;
  errorMessage?: string | null;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function DeckCreationDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onSubmit,
  status = 'idle',
  errorMessage,
  restoreFocusRef,
}: DeckCreationDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { i18n } = useLingui();
  const isWorking = status === 'working';
  const isSuccess = status === 'success';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && isWorking) return;
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="library-dialog-overlay" />
        <Dialog.Content
          className="library-dialog-frame library-dialog-frame--manage"
          onOpenAutoFocus={event => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={event => restoreLibraryDialogFocus(event, restoreFocusRef)}
          onEscapeKeyDown={event => {
            if (isWorking) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (isWorking) event.preventDefault();
          }}
        >
          <header className="library-dialog-header">
            <div>
              <p className="library-dialog-kicker"><Trans id="library.deck.dialog-kicker" message="Deck studio" /></p>
              <Dialog.Title className="library-dialog-title"><Trans id="library.deck.dialog-title" message="New deck" /></Dialog.Title>
              <Dialog.Description className="library-dialog-description">
                <Trans id="library.deck.dialog-description" message="Group words by exam, trip, book — anything you like." />
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="library-dialog-icon-button"
              aria-label={i18n._(msg({ id: 'library.close', message: 'Close' }))}
              disabled={isWorking}
            >
              <X size={17} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <form
            id="library-deck-create-form"
            className="library-dialog-body library-dialog-body--manage"
            onSubmit={event => {
              event.preventDefault();
              if (!isWorking && !isSuccess && value.trim()) onSubmit();
            }}
          >
            <label className="library-dialog-field" htmlFor="library-deck-name">
              <span><Trans id="library.deck.creation-name-label" message="Deck name" /></span>
              <input
                ref={inputRef}
                id="library-deck-name"
                name="deck-name"
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={i18n._(msg({ id: 'library.deck.name-placeholder', message: 'IELTS, Travel…' }))}
                aria-invalid={status === 'failure'}
                aria-describedby={status === 'failure' ? 'library-deck-create-error' : undefined}
                disabled={isWorking || isSuccess}
                autoComplete="off"
              />
              {status === 'failure' ? (
                <span id="library-deck-create-error" className="library-dialog-error" role="alert">
                  <AlertTriangle size={15} aria-hidden="true" />
                  {errorMessage ?? <Trans id="library.deck.create-error" message="Could not create this deck. Check your connection and try again." />}
                </span>
              ) : null}
            </label>

            <div className="library-dialog-suggestions" aria-label={i18n._(msg({ id: 'library.deck.suggestions', message: 'Deck name suggestions' }))}>
              <span><Trans id="library.deck.try" message="Try" /></span>
              {deckSuggestions.map(suggestion => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => onChange(suggestion.message ?? '')}
                  disabled={isWorking || isSuccess}
                  className="library-dialog-chip"
                >
                  {i18n._(suggestion)}
                </button>
              ))}
            </div>

            {isWorking ? (
              <p className="library-dialog-status" role="status" aria-live="polite">
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <Trans id="library.deck.creating" message="Creating…" />
              </p>
            ) : isSuccess ? (
              <p className="library-dialog-status library-dialog-status--success" role="status" aria-live="polite">
                <Check size={16} aria-hidden="true" />
                <Trans id="library.deck.created" message="Deck created. Your cards can be assigned to it from the library." />
              </p>
            ) : null}
          </form>

          <footer className="library-dialog-footer">
            <Dialog.Close asChild>
              <button type="button" className="library-dialog-button library-dialog-button--secondary" disabled={isWorking}>
                {isSuccess ? <Trans id="common.done" message="Done" /> : <Trans id="common.cancel" message="Cancel" />}
              </button>
            </Dialog.Close>
            {!isSuccess ? (
              <button
                type="submit"
                form="library-deck-create-form"
                className="library-dialog-button library-dialog-button--primary"
                disabled={isWorking || !value.trim()}
                aria-busy={isWorking}
              >
                {isWorking ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {status === 'failure' ? <Trans id="library.deck.create-again" message="Try again" /> : <Trans id="library.deck.creation-submit" message="Create deck" />}
              </button>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface LibraryClearDialogProps extends LibraryDialogChromeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  cardCount?: number;
  deckCount?: number;
  masteredCount?: number;
  errorMessage?: string | null;
  onExport?: () => void;
  confirmationToken?: string;
}

export function LibraryClearDialog({
  open,
  onOpenChange,
  onConfirm,
  status,
  restoreFocusRef,
  cardCount,
  deckCount,
  masteredCount,
  errorMessage,
  onExport,
  confirmationToken = 'DELETE',
}: LibraryClearDialogProps) {
  const [confirmation, setConfirmation] = useState('');
  const { i18n } = useLingui();
  const isWorking = status === 'working';
  const isSuccess = status === 'success';
  const canConfirm = confirmation.trim().toUpperCase() === confirmationToken.toUpperCase();
  const counts: Array<{ id: string; label: ReactNode; value: number }> = [];
  if (typeof cardCount === 'number') counts.push({ id: 'cards', label: <Trans id="library.clear.cards" message="cards" />, value: cardCount });
  if (typeof deckCount === 'number') counts.push({ id: 'decks', label: <Trans id="library.clear.decks" message="decks" />, value: deckCount });
  if (typeof masteredCount === 'number') counts.push({ id: 'mastered', label: <Trans id="library.clear.mastered" message="mastered words" />, value: masteredCount });

  useEffect(() => {
    if (!open || isSuccess) setConfirmation('');
  }, [isSuccess, open]);

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && isWorking) return;
        if (!nextOpen) setConfirmation('');
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="library-dialog-overlay library-dialog-overlay--danger" />
        <AlertDialog.Content
          className="library-dialog-frame library-dialog-frame--danger"
          onCloseAutoFocus={event => restoreLibraryDialogFocus(event, restoreFocusRef)}
          onEscapeKeyDown={event => {
            if (isWorking) event.preventDefault();
          }}
        >
          <header className="library-dialog-header">
            <div className="library-dialog-heading-with-icon">
              <span className="library-dialog-danger-icon" aria-hidden="true"><AlertTriangle size={22} /></span>
              <div>
                <p className="library-dialog-kicker library-dialog-kicker--danger"><Trans id="library.clear.kicker" message="Danger zone" /></p>
                <AlertDialog.Title className="library-dialog-title"><Trans id="library.clear.title" message="Clear the entire library?" /></AlertDialog.Title>
              </div>
            </div>
            <AlertDialog.Cancel
              className="library-dialog-icon-button"
              aria-label={i18n._(msg({ id: 'library.clear.close', message: 'Close clear library dialog' }))}
              disabled={isWorking}
            >
              <X size={17} aria-hidden="true" />
            </AlertDialog.Cancel>
          </header>

          <div className="library-dialog-body library-dialog-body--danger">
            <AlertDialog.Description className="library-dialog-description library-dialog-description--body">
              <Trans id="library.clear.description" message="This permanently deletes every card, deck and review history on all your synced devices. It can’t be undone." />
            </AlertDialog.Description>

            {counts.length > 0 ? (
              <div className="library-dialog-stat-grid">
                {counts.map(count => <div key={count.id} className="library-dialog-stat"><strong>{count.value.toLocaleString()}</strong><span>{count.label}</span></div>)}
              </div>
            ) : null}

            {onExport ? (
              <div className="library-dialog-export-row">
                <span><Trans id="library.clear.export-copy" message="Keep a copy first — export everything." /></span>
                <button type="button" onClick={onExport} disabled={isWorking || isSuccess} className="library-dialog-button library-dialog-button--secondary">
                  <Download size={15} aria-hidden="true" />
                  <Trans id="library.clear.export" message="Export" />
                </button>
              </div>
            ) : null}

            {isSuccess ? (
              <p className="library-dialog-status library-dialog-status--success" role="status" aria-live="polite">
                <Check size={16} aria-hidden="true" />
                <Trans id="library.clear.success" message="Your library was cleared." />
              </p>
            ) : (
              <label className="library-dialog-field" htmlFor="library-clear-confirmation">
                <span><Trans id="library.clear.confirm-label" message="Type {token} to confirm" values={{ token: confirmationToken }} /></span>
                <input
                  id="library-clear-confirmation"
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  disabled={isWorking}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={status === 'failure'}
                />
              </label>
            )}

            {isWorking ? (
              <p className="library-dialog-status" role="status" aria-live="polite">
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <Trans id="library.clear.working" message="Clearing your library…" />
              </p>
            ) : status === 'failure' ? (
              <p className="library-dialog-error" role="alert">
                <AlertTriangle size={15} aria-hidden="true" />
                {errorMessage ?? <Trans id="library.clear.failure" message="Could not clear the library. Check your connection and try again." />}
              </p>
            ) : null}
          </div>

          <footer className="library-dialog-footer">
            {isSuccess ? (
              <AlertDialog.Cancel asChild>
                <button type="button" className="library-dialog-button library-dialog-button--primary"><Trans id="common.done" message="Done" /></button>
              </AlertDialog.Cancel>
            ) : (
              <>
                <AlertDialog.Cancel className="library-dialog-button library-dialog-button--secondary" disabled={isWorking}>
                  <Trans id="library.clear.keep" message="Keep library" />
                </AlertDialog.Cancel>
                <AlertDialog.Action
                  className="library-dialog-button library-dialog-button--danger"
                  disabled={isWorking || !canConfirm}
                  aria-busy={isWorking}
                  onClick={event => {
                    event.preventDefault();
                    if (!isWorking && canConfirm) onConfirm();
                  }}
                >
                  {isWorking ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                  {status === 'failure' ? <Trans id="library.clear.try-again" message="Try again" /> : <Trans id="library.clear.confirm" message="Delete everything" />}
                </AlertDialog.Action>
              </>
            )}
          </footer>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export interface LibraryInsightsStats {
  total: number;
  learned: number;
  learning: number;
  dueToday: number;
  categoryChart: readonly { name: string; value: number }[];
  categoryChartIsPartial?: boolean;
  difficultyChart: readonly { name: string; value: number }[];
  xpChartData: readonly { date: string; XP: number }[];
}

export type LibraryInsightsPhase = 'loading' | 'ready' | 'failure';

export interface LibraryInsightsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: LibraryInsightsStats | null;
  phase?: LibraryInsightsPhase;
  errorMessage?: string | null;
  onRetry?: () => void;
  onOpenProgress?: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function LibraryInsightsDialog({
  open,
  onOpenChange,
  stats,
  phase = 'ready',
  errorMessage,
  onRetry,
  onOpenProgress,
  restoreFocusRef,
}: LibraryInsightsDialogProps) {
  const { i18n } = useLingui();
  const isLoading = phase === 'loading';
  const hasStats = phase === 'ready' && stats !== null;
  const maxCategory = hasStats ? Math.max(1, ...stats.categoryChart.map(item => item.value)) : 1;
  const maxDifficulty = hasStats ? Math.max(1, ...stats.difficultyChart.map(item => item.value)) : 1;
  const maxXp = hasStats ? Math.max(1, ...stats.xpChartData.map(item => item.XP)) : 1;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="library-dialog-overlay" />
        <Dialog.Content className="library-dialog-frame library-dialog-frame--insights" onCloseAutoFocus={event => restoreLibraryDialogFocus(event, restoreFocusRef)}>
          <header className="library-dialog-header">
            <div>
              <p className="library-dialog-kicker"><Trans id="library.insights.kicker" message="Stats · last 30 days" /></p>
              <Dialog.Title className="library-dialog-title"><Trans id="library.insights.title" message="Learning insights" /></Dialog.Title>
              <Dialog.Description className="library-dialog-description"><Trans id="library.insights.description" message="A truthful view of your memory strength and review momentum." /></Dialog.Description>
            </div>
            <Dialog.Close className="library-dialog-icon-button" aria-label={i18n._(msg({ id: 'library.insights.close', message: 'Close learning insights' }))}>
              <X size={17} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <div className="library-dialog-body library-dialog-body--insights">
            {isLoading ? (
              <div className="library-dialog-loading" role="status" aria-live="polite">
                <Loader2 size={24} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <Trans id="library.insights.loading" message="Loading your learning data…" />
              </div>
            ) : phase === 'failure' ? (
              <div className="library-dialog-empty" role="alert">
                <AlertTriangle size={24} aria-hidden="true" />
                <p>{errorMessage ?? <Trans id="library.insights.failure" message="Could not load learning insights. Try again." />}</p>
                {onRetry ? <button type="button" onClick={onRetry} className="library-dialog-button library-dialog-button--secondary"><RotateCcw size={15} aria-hidden="true" /><Trans id="common.retry" message="Retry" /></button> : null}
              </div>
            ) : !hasStats ? (
              <div className="library-dialog-empty" role="status"><Trans id="library.insights.empty" message="There is not enough learning data to show insights yet." /></div>
            ) : (
              <>
                <div className="library-dialog-stat-grid library-dialog-stat-grid--four">
                  <InsightMetric label={<Trans id="library.insights.total" message="Total cards" />} value={stats.total} />
                  <InsightMetric label={<Trans id="library.insights.mastered" message="Mastered" />} value={stats.learned} />
                  <InsightMetric label={<Trans id="library.insights.learning" message="Learning" />} value={stats.learning} />
                  <InsightMetric label={<Trans id="library.insights.due" message="Due today" />} value={stats.dueToday} accent />
                </div>

                <div className="library-insights-grid">
                  <section className="library-insights-panel" aria-labelledby="library-insights-category-title">
                    <h3 id="library-insights-category-title"><Trans id="library.insights.category" message="By category" /></h3>
                    {stats.categoryChart.length === 0 ? <p className="library-dialog-muted"><Trans id="library.insights.no-category" message="No category data yet." /></p> : (
                      <ul className="library-insights-bars">
                        {stats.categoryChart.map(item => <li key={item.name}><div><span>{item.name}</span><strong>{item.value.toLocaleString()}</strong></div><span className="library-insights-track"><span style={{ width: `${Math.round((item.value / maxCategory) * 100)}%` }} /></span></li>)}
                      </ul>
                    )}
                    {stats.categoryChartIsPartial ? <p className="library-dialog-note"><Trans id="library.insights.category-partial" message="Some cloud categories are still loading." /></p> : null}
                  </section>

                  <section className="library-insights-panel" aria-labelledby="library-insights-difficulty-title">
                    <h3 id="library-insights-difficulty-title"><Trans id="library.insights.difficulty" message="Difficulty" /></h3>
                    {stats.difficultyChart.length === 0 ? <p className="library-dialog-muted"><Trans id="library.insights.no-difficulty" message="No review ratings yet." /></p> : (
                      <ul className="library-insights-bars">
                        {stats.difficultyChart.map(item => <li key={item.name}><div><span>{item.name}</span><strong>{item.value.toLocaleString()}</strong></div><span className="library-insights-track library-insights-track--warm"><span style={{ width: `${Math.round((item.value / maxDifficulty) * 100)}%` }} /></span></li>)}
                      </ul>
                    )}
                  </section>
                </div>

                <section className="library-insights-panel" aria-labelledby="library-insights-xp-title">
                  <div className="library-insights-panel-heading"><h3 id="library-insights-xp-title"><Trans id="library.insights.xp" message="XP · recent activity" /></h3><span><Trans id="library.insights.xp-total" message="{count, number} XP" values={{ count: stats.xpChartData.reduce((sum, point) => sum + point.XP, 0) }} /></span></div>
                  {stats.xpChartData.length === 0 ? <p className="library-dialog-muted"><Trans id="library.insights.no-xp" message="Complete a review to start your activity chart." /></p> : (
                    <div className="library-insights-xp" role="img" aria-label={i18n._(msg({ id: 'library.insights.xp-chart', message: 'Recent XP activity' }))}>
                      {stats.xpChartData.map(point => <span key={point.date} title={i18n._(msg({ id: 'library.insights.xp-point', message: '{date}: {xp, number} XP' }).id, { date: point.date, xp: point.XP })} style={{ height: `${Math.max(8, Math.round((point.XP / maxXp) * 100))}%` }} />)}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          <footer className="library-dialog-footer">
            {onOpenProgress ? <button type="button" onClick={onOpenProgress} className="library-dialog-link"><Trans id="library.insights.open-progress" message="Open full Progress →" /></button> : <span />}
            <Dialog.Close asChild>
              <button type="button" className="library-dialog-button library-dialog-button--secondary"><Trans id="common.close" message="Close" /></button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InsightMetric({ label, value, accent = false }: { label: ReactNode; value: number; accent?: boolean }) {
  return <div className={`library-dialog-stat${accent ? ' library-dialog-stat--accent' : ''}`}><span>{label}</span><strong>{value.toLocaleString()}</strong></div>;
}
