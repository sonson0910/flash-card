import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { Lumi } from '../../components/lumi/Lumi';
import { formatNumber } from '../../lib/format';
import { isoWeekNumber } from '../dailyLearning/todayScreenFacts';
import { readLumiEnabled } from '../settings/lumi-preference';
import './catalog-workspace.css';
import { catalogTierMessages, catalogTrackMessages } from './catalogPresentation';
import type {
  AvailableCatalogTrackId,
  CatalogAvailabilityStatus,
  CatalogFilterOption,
  CatalogScreenActions,
  CatalogScreenModel,
  CatalogTierPresentation,
  CatalogTierState,
  CatalogTrackPresentation,
  CatalogVocabularyPresentation,
} from './catalogPresentation';
import type { CatalogPathUnitProgress } from './catalogProgressProjectionService';
import { CrystalPathWings } from './CrystalPathWings';

interface CatalogScreenProps {
  model: CatalogScreenModel;
  actions: CatalogScreenActions;
}

const compactStatusClass = 'mt-3 text-sm font-semibold text-[var(--sf-text-muted)]';
const sectionHeadingClass = 'paths-section-title';
const shelfClass = 'catalog-shelf paths-section';
const ctaClass = 'paths-cta brand-action';
const quietButtonClass = 'paths-quiet-button';
const metadataBadgeClass = 'paths-badge';

type BookHue = 'terracotta' | 'ink' | 'ochre';
const trackBookHue: Record<AvailableCatalogTrackId, BookHue> = { ielts: 'terracotta', toeic: 'ink', general: 'ochre' };
const personalBookHues: readonly BookHue[] = ['terracotta', 'ink', 'ochre'];
const trackKindMessages: Record<AvailableCatalogTrackId, ReturnType<typeof msg>> = {
  ielts: msg({ id: 'paths.book.kind.exam', message: 'Exam' }),
  toeic: msg({ id: 'paths.book.kind.exam', message: 'Exam' }),
  general: msg({ id: 'paths.book.kind.everyday', message: 'Everyday' }),
};

const tierStatePresentation: Record<CatalogTierState, { label: ReturnType<typeof msg>; Icon: LucideIcon }> = {
  available: { label: msg({ id: 'paths.tier-state.available', message: 'Available' }), Icon: Circle },
  'in-progress': { label: msg({ id: 'paths.tier-state.in-progress', message: 'In progress' }), Icon: BookOpen },
  completed: { label: msg({ id: 'paths.tier-state.completed', message: 'Completed' }), Icon: CheckCircle2 },
  locked: { label: msg({ id: 'paths.tier-state.locked', message: 'Locked' }), Icon: LockKeyhole },
};

function evidenceLabel(value: string, fallback: string) {
  return value.trim() || fallback;
}

function languageOptionLabel(label: string, nativeLabel: string, isAvailable: boolean) {
  const names = label === nativeLabel ? label : `${label} (${nativeLabel})`;
  return isAvailable ? names : i18n._(msg({ id: 'catalog.language.coming-soon', message: '{names} — coming soon' }).id, { names });
}

const percentOf = (part: number, total: number): number => total > 0 ? Math.min(100, Math.max(0, Math.round((part / total) * 100))) : 0;

/** Moves keyboard and screen-reader focus to a section heading further down the page. */
function revealSection(headingId: string) {
  const heading = globalThis.document?.getElementById(headingId);
  if (!heading) return;
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  heading.focus({ preventScroll: true });
}

function AvailabilityPanel({ status, actions, hasPersonalLibrary = true }: { status: CatalogAvailabilityStatus; actions: CatalogScreenActions; hasPersonalLibrary?: boolean }) {
  if (status.kind === 'ready') {
    return (
      <div className="catalog-note catalog-note--success" role="status" aria-live="polite" aria-atomic="true">
        <CheckCircle2 className="catalog-note-icon" aria-hidden="true" /><span>{status.message}</span>
      </div>
    );
  }

  if (status.kind === 'checking') {
    return (
      <div className="catalog-note skeleton-sheen min-h-24" role="status" aria-live="polite" aria-atomic="true">
        <LoaderCircle className="catalog-note-icon animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span>{status.message}</span>
      </div>
    );
  }

  if (status.kind === 'personal') {
    return (
      <section className="catalog-note catalog-note--info" aria-labelledby="personal-path-status-title" aria-live="polite">
        <BookOpen className="catalog-note-icon" aria-hidden="true" />
        <div className="min-w-0"><h2 id="personal-path-status-title" className="catalog-note-title"><Trans {...msg({ context: 'catalog.personal.status-title', message: 'Personal learning mode' })} /></h2><p className="catalog-note-copy">{status.message}</p>{!hasPersonalLibrary && <button type="button" onClick={actions.openVocabulary} className={`${quietButtonClass} mt-3`}><Trans {...msg({ context: 'catalog.action.open-vocabulary', message: 'Open vocabulary' })} /></button>}</div>
      </section>
    );
  }

  if (status.kind === 'downloading') {
    const progressPercent = Math.min(100, Math.max(0, status.progressPercent));
    return (
      <div className="catalog-note flex-col items-stretch" role="status" aria-live="polite" aria-atomic="true" aria-busy="true">
        <div className="flex items-center justify-between gap-3"><span>{status.message}</span><span className="paths-mono">{progressPercent}%</span></div>
        <progress className="mt-3 h-3 w-full accent-[var(--sf-brand)]" max={100} value={progressPercent}>{progressPercent}%</progress>
      </div>
    );
  }

  if (status.kind === 'unavailable') {
    return (
      <section className="catalog-note catalog-note--warning flex-col items-stretch" aria-labelledby="catalog-unavailable-title" aria-live="polite">
        <div className="flex items-start gap-3">
          <WifiOff className="catalog-note-icon" aria-hidden="true" />
          <div className="min-w-0"><h2 id="catalog-unavailable-title" className="catalog-note-title"><Trans {...msg({ context: 'catalog.status.unavailable-title', message: 'Catalog unavailable' })} /></h2><p className="catalog-note-copy">{status.message}</p><p className="catalog-note-copy font-semibold"><Trans {...msg({ context: 'catalog.status.no-drafts', message: 'Draft vocabulary is never shown here.' })} /></p></div>
        </div>
        {status.canDownload && status.isOnline ? (
          <button type="button" onClick={actions.download} className={`${ctaClass} mt-4 self-start`}><Download className="size-4" aria-hidden="true" /><Trans {...msg({ context: 'catalog.status.check-reviewed', message: 'Check for reviewed catalog' })} /></button>
        ) : status.canDownload ? (
          <p className="catalog-note-copy mt-4 font-semibold"><Trans {...msg({ context: 'catalog.status.connect-first-download', message: 'Connect to the internet for the first verified download.' })} /></p>
        ) : (
          <p className="catalog-note-copy mt-4 font-semibold"><Trans {...msg({ context: 'catalog.status.release-pending', message: 'A download will appear after a reviewed release is published.' })} /></p>
        )}
      </section>
    );
  }

  return (
    <section className="catalog-note catalog-note--danger flex-col items-stretch" aria-labelledby="catalog-error-title" aria-live="assertive" role="alert">
      <h2 id="catalog-error-title" className="catalog-note-title"><Trans {...msg({ context: 'catalog.status.error-title', message: 'Catalog needs attention' })} /></h2>
      <p className="catalog-note-copy">{status.message}</p>
      {status.detail && (
        <details className="group mt-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 font-semibold focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
            <span><Trans {...msg({ context: 'catalog.status.technical-detail', message: 'Technical detail' })} /></span>
            <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <p className="catalog-note-detail paths-mono">
            {status.detail}
          </p>
        </details>
      )}
      <button type="button" onClick={actions.retry} className="catalog-danger-action mt-4 self-start"><RefreshCw className="size-4" aria-hidden="true" /><Trans {...msg({ context: 'catalog.action.retry', message: 'Try again' })} /></button>
    </section>
  );
}

function LumiLink({ message }: { message: string | null }) {
  return (
    <div className="paths-lumi" aria-hidden={message ? undefined : true}>
      {message && <p className="paths-lumi-bubble"><span className="paths-lumi-label"><Trans {...msg({ id: 'paths.lumi.link', message: 'Lumi · Link' })} /></span><span className="paths-lumi-message">{message}</span></p>}
      <Lumi pose="happy" className="paths-lumi-figure" />
    </div>
  );
}

function PersonalLibraryPaths({
  library,
  actions,
  isCrystal,
  showLumi,
}: {
  library: NonNullable<CatalogScreenModel['personalLibrary']>;
  actions: CatalogScreenActions;
  isCrystal: boolean;
  showLumi: boolean;
}) {
  const paths = [
    { label: msg({ id: 'catalog.personal.review-due', message: 'Review due' }), value: library.dueToday, copy: msg({ id: 'catalog.personal.review-due-description', message: 'Cards scheduled for review now.' }) },
    { label: msg({ id: 'catalog.personal.keep-learning', message: 'Keep learning' }), value: library.learning, copy: msg({ id: 'catalog.personal.keep-learning-description', message: 'Cards still building toward mastery.' }) },
    { label: msg({ id: 'catalog.personal.mastered', message: 'Mastered' }), value: library.learned, copy: msg({ id: 'catalog.personal.mastered-description', message: 'Cards already retained with confidence.' }) },
  ];
  const masteredPercent = percentOf(library.learned, library.total);
  const lumiMessage = library.dueToday > 0
    ? i18n._(msg({ id: 'paths.lumi.review-due', message: '{count, plural, one {# card is} other {# cards are}} ready for review.' }).id, { count: library.dueToday })
    : null;
  return (
    <div className="catalog-feature-grid">
      <section aria-labelledby="personal-paths-heading" className="catalog-personal-paths paths-hero">
        {isCrystal && <span aria-hidden="true" className="paths-hero-art"><CrystalPathWings /></span>}
        <div className="paths-hero-main">
          <p className="paths-hero-kicker"><span className="paths-hero-dot" aria-hidden="true" /><span className="paths-hero-kicker-text"><Trans {...msg({ context: 'catalog.personal.kicker', message: 'Built from your library' })} /></span></p>
          <h2 id="personal-paths-heading" className="paths-hero-title"><Trans {...msg({ context: 'catalog.personal.title', message: 'Your personal paths' })} /></h2>
          <p className="paths-hero-copy"><Trans {...msg({ context: 'catalog.personal.description', message: 'Use your {count} saved cards now. No draft catalog vocabulary is mixed into these paths.' })} values={{ count: formatNumber(library.total) }} /></p>
        </div>
        <div className="paths-hero-foot">
          <div className="paths-hero-route">
            <div className="paths-hero-meter" aria-hidden="true"><span style={{ width: `${masteredPercent}%` }} /></div>
            <p className="catalog-feature-count">
              <span><Trans {...msg({ id: 'paths.personal.mastered-count', message: '<0>{mastered}</0> of {total} cards mastered' })} values={{ mastered: formatNumber(library.learned), total: formatNumber(library.total) }} components={{ 0: <span className="paths-mono paths-count-strong" /> }} /></span>
              <span><Trans {...msg({ id: 'paths.personal.due-count', message: '{count} due for review today' })} values={{ count: formatNumber(library.dueToday) }} /></span>
            </p>
            <div className="paths-hero-actions">
              {library.total > 0 && <button type="button" onClick={actions.continueReview} className="catalog-feature-continue paths-cta brand-action"><span className="paths-btn-label"><Trans {...msg({ context: 'catalog.action.continue-review', message: 'Continue review' })} /></span></button>}
              <button type="button" onClick={actions.openVocabulary} className="paths-ghost"><span className="paths-btn-label"><Trans {...msg({ context: 'catalog.action.open-vocabulary', message: 'Open vocabulary' })} /></span></button>
            </div>
          </div>
          {showLumi && <LumiLink message={lumiMessage} />}
        </div>
      </section>
      <section aria-labelledby="personal-shelf-heading" className="catalog-shelf paths-shelf">
        <div className="paths-shelf-head">
          <h2 id="personal-shelf-heading" className="paths-shelf-title"><Trans {...msg({ context: 'paths.shelf.title', message: 'Your shelf' })} /></h2>
          {isCrystal && <span className="paths-shelf-count"><Trans {...msg({ id: 'paths.shelf.steps', message: '// {count} steps' })} values={{ count: paths.length }} /></span>}
          <button type="button" className="paths-browse" onClick={() => actions.selectMode('reviewed')}><Trans {...msg({ id: 'paths.shelf.browse', message: 'Browse catalog →' })} /></button>
        </div>
        <ol className="paths-books" aria-label={i18n._(msg({ id: 'catalog.personal.path-label', message: 'Personal learning path: Review due → Keep learning → Mastered' }))}>
          {paths.map((path, index) => {
            const label = i18n._(path.label);
            return (
              <li key={path.label.id} className="paths-book" data-hue={personalBookHues[index]}>
                <span className="paths-book-spine" aria-hidden="true" />
                {isCrystal && <span className="paths-book-glyph" aria-hidden="true">{label.charAt(0)}</span>}
                <span className="paths-book-kind"><Trans {...msg({ id: 'paths.personal.step', message: 'Step {step}' })} values={{ step: index + 1 }} /></span>
                <span className="paths-book-name">{label}</span>
                <span className="paths-book-blurb">{i18n._(path.copy)}</span>
                <span className="paths-book-foot">
                  <span className="paths-book-track" aria-hidden="true"><span style={{ width: `${percentOf(path.value, library.total)}%` }} /></span>
                  <span className="paths-book-count paths-mono">{formatNumber(path.value)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function TrackCard({ track, selected, progressAvailable, isCrystal, onSelect }: { track: CatalogTrackPresentation; selected: boolean; progressAvailable: boolean; isCrystal: boolean; onSelect: () => void }) {
  const copy = catalogTrackMessages[track.id];
  const label = i18n._(copy.label);
  const progress = percentOf(track.mastered, track.total);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="catalog-track-card paths-book" data-hue={trackBookHue[track.id]}>
      <span className="paths-book-spine" aria-hidden="true" />
      {isCrystal && <span className="paths-book-glyph" aria-hidden="true">{label.charAt(0)}</span>}
      {/* The kind chip follows the name in the DOM so the button is announced by its track name first; CSS shows the chip above it. */}
      <span className="paths-book-name">{label}</span>
      <span className="paths-book-kind">{i18n._(trackKindMessages[track.id])}{selected && <Check className="paths-book-check" aria-hidden="true" />}</span>
      <span className="paths-book-blurb">{i18n._(copy.description)}</span>
      <span className="paths-book-foot">
        <span className="paths-book-track" aria-hidden="true"><span style={{ width: `${progressAvailable ? progress : 0}%` }} /></span>
        {progressAvailable
          ? <span className="paths-book-count paths-mono"><span aria-hidden="true">{formatNumber(track.mastered)} / {formatNumber(track.total)}</span><span className="sr-only"><Trans {...msg({ id: 'paths.book.progress', message: '{mastered} of {total} words mastered · {started} started' })} values={{ mastered: formatNumber(track.mastered), total: formatNumber(track.total), started: formatNumber(track.started) }} /></span></span>
          : <span className="paths-book-count"><Trans {...msg({ id: 'paths.unit.status.unavailable', message: 'Progress unavailable' })} /> · <Trans {...msg({ context: 'paths.unit.count', message: '{count} words' })} values={{ count: formatNumber(track.total) }} /></span>}
      </span>
    </button>
  );
}

function TierStep({ tier, selected, progressAvailable, onSelect }: { tier: CatalogTierPresentation; selected: boolean; progressAvailable: boolean; onSelect: () => void }) {
  const { label: stateLabel, Icon } = tierStatePresentation[tier.state];
  const copy = catalogTierMessages[tier.id];
  const isLocked = progressAvailable && tier.state === 'locked';
  return (
    <li className="min-w-0 flex-1">
      <button type="button" onClick={onSelect} disabled={isLocked} aria-pressed={selected} className="catalog-tier-step paths-card crystal-chamfer-sm h-full min-h-12 w-full text-left disabled:cursor-not-allowed disabled:opacity-70">
        <span className="flex items-center gap-2 text-sm font-bold"><Icon className="size-4 shrink-0" aria-hidden="true" />{progressAvailable ? i18n._(stateLabel) : <Trans {...msg({ id: 'paths.unit.status.unavailable', message: 'Progress unavailable' })} />}</span>
        <span className="paths-card-title mt-2 block">{i18n._(copy.label)}{selected && <> · <Trans {...msg({ context: 'paths.selected', message: 'Selected' })} /></>}</span>
        <span className="mt-1 block text-sm text-[var(--sf-text-muted)]">{i18n._(copy.description)}</span>
        {progressAvailable && <span className="mt-3 block text-xs text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'paths.tier.progress', message: '{mastered} of {total} mastered · {started} started' })} values={{ mastered: formatNumber(tier.mastered), total: formatNumber(tier.total), started: formatNumber(tier.started) }} /></span>}
      </button>
    </li>
  );
}

function pathUnitTitle(unit: CatalogPathUnitProgress['unit'], language: string): string {
  return unit.titles.find(title => title.language === language)?.text
    ?? unit.titles[0]?.text
    ?? unit.unitId;
}

const pathUnitKey = (unit: CatalogPathUnitProgress['unit']): string => `${unit.trackId}\u0000${unit.unitId}`;

function PathUnitShelf({
  units, selectedUnitId, language, continueState, actions,
}: {
  units: readonly CatalogPathUnitProgress[];
  selectedUnitId: string | null | undefined;
  language: string;
  continueState: CatalogScreenModel['pathUnitContinue'];
  actions: CatalogScreenActions;
}) {
  const selected = units.find(unit => pathUnitKey(unit.unit) === selectedUnitId) ?? units[0];
  const confirmationArmed = continueState?.confirmationUnitId === pathUnitKey(selected.unit);
  const hasUnintroducedWords = selected.introduced !== null && selected.introduced < selected.unit.total;
  const status = (unit: CatalogPathUnitProgress) => unit.status === 'complete'
    ? msg({ id: 'paths.unit.status.complete', message: 'Complete' })
    : unit.status === 'active'
      ? msg({ id: 'paths.unit.status.active', message: 'In progress' })
      : unit.status === 'unavailable'
        ? msg({ id: 'paths.unit.status.unavailable', message: 'Progress unavailable' })
      : msg({ id: 'paths.unit.status.not-started', message: 'Not started' });
  return (
    <section aria-labelledby="catalog-units-heading" className={shelfClass}>
      <div className="paths-section-head"><h2 id="catalog-units-heading" tabIndex={-1} className={sectionHeadingClass}><Trans {...msg({ context: 'paths.units.title', message: 'Choose a unit' })} /></h2><p className="paths-section-meta"><Trans {...msg({ context: 'paths.units.kicker', message: 'Catalog units' })} /> · <span className="paths-mono">{formatNumber(units.length)}</span></p></div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={i18n._(msg({ id: 'paths.units.list-label', message: 'Catalog units' }))}>
        {units.map(progress => {
          const unit = progress.unit;
          const isSelected = progress === selected;
          return <li key={`${unit.trackId}:${unit.unitId}`}><button type="button" onClick={() => actions.selectPathUnit(unit.trackId, unit.unitId)} aria-pressed={isSelected} className="paths-unit paths-card crystal-chamfer-sm min-h-11 w-full text-left">
            <span className="flex flex-col gap-1"><span className="paths-unit-title"><Trans {...msg({ context: 'paths.unit.ordinal', message: 'Unit {ordinal}' })} values={{ ordinal: unit.ordinal }} /> · {pathUnitTitle(unit, language)}</span><span className="paths-unit-status" data-status={progress.status}>{i18n._(status(progress))}</span></span>
            <span className="paths-unit-count paths-mono"><Trans {...msg({ context: 'paths.unit.count', message: '{count} words' })} values={{ count: formatNumber(unit.total) }} /></span>
          </button></li>;
        })}
      </ol>
      <aside id="catalog-unit-preview" tabIndex={-1} className="paths-unit-preview paths-card crystal-chamfer" aria-live="polite">
        <h3 className="paths-card-title"><Trans {...msg({ context: 'paths.unit.preview', message: 'Preview: {title}' })} values={{ title: pathUnitTitle(selected.unit, language) }} /></h3>
        {selected.introduced === null || selected.mastered === null
          ? <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'paths.unit.progress-unavailable', message: 'Progress is unavailable until your library can be verified.' })} /></p>
          : <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'paths.unit.progress', message: '{introduced} introduced · {mastered} mastered' })} values={{ introduced: formatNumber(selected.introduced), mastered: formatNumber(selected.mastered) }} /></p>}
        <ol className="paths-unit-words">
          {selected.unit.preview.map((lexeme, index) => <li key={`${lexeme.lexemeId}:${index}`} lang={language} className="paths-word-chip crystal-chamfer-sm"><span className="paths-word-dot" aria-hidden="true" />{lexeme.lemma}</li>)}
        </ol>
        {continueState?.etaDays !== null && continueState?.etaDays !== undefined && <p className="mt-3 text-sm font-semibold text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'paths.unit.eta', message: 'Estimated {days, plural, one {# day} other {# days}} left at your pace.' })} values={{ days: continueState.etaDays }} /></p>}
        {continueState && (selected.status === 'unavailable'
          ? <p className={compactStatusClass}><Trans {...msg({ context: 'paths.unit.continue-unavailable', message: 'Continue is unavailable until progress can be verified.' })} /></p>
          : selected.status === 'complete'
            ? <p className={compactStatusClass}><Trans {...msg({ context: 'paths.unit.complete-message', message: 'This unit is complete.' })} /></p>
          : continueState?.allComplete
            ? <p className={compactStatusClass}><Trans {...msg({ context: 'paths.unit.all-complete', message: 'All units in this path are complete.' })} /></p>
            : <div className="mt-4">
              {confirmationArmed && <p className="text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'paths.unit.confirm-disclosure', message: 'Any missing unit words will be added to your Library before study.' })} /></p>}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={confirmationArmed ? actions.confirmSelectedUnit : actions.prepareSelectedUnit} disabled={continueState?.busy} className={ctaClass}>
                  {continueState?.busy ? <Trans {...msg({ context: 'paths.unit.continuing', message: 'Starting unit…' })} /> : confirmationArmed ? hasUnintroducedWords ? <Trans {...msg({ context: 'paths.unit.add-and-study', message: 'Add missing words and study' })} /> : <Trans {...msg({ context: 'paths.unit.study', message: 'Study this unit' })} /> : <Trans {...msg({ context: 'paths.unit.prepare-continue', message: 'Continue with this unit' })} />}
                </button>
                {continueState?.error && <p className="text-sm font-semibold text-[var(--sf-danger)]" role="alert">{continueState.error}</p>}
              </div>
            </div>)}
      </aside>
    </section>
  );
}

function SelectFilter({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: CatalogFilterOption[]; onChange: (value: string) => void }) {
  return (
    <label htmlFor={id} className="min-w-0 text-sm font-bold text-[var(--sf-text)]">
      {label}
      <select id={id} name={id} value={value} onChange={event => onChange(event.target.value)} className="glass-field paths-select mt-2 w-full">
        <option value=""><Trans {...msg({ context: 'catalog.filter.all', message: 'All' })} /></option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function VocabularyCard({ card, onAdd }: { card: CatalogVocabularyPresentation; onAdd: () => void }) {
  const libraryState = card.libraryState ?? 'available';
  const addFailed = libraryState === 'failed';
  const addErrorId = `catalog-add-error-${card.id}`;
  const addLabel = libraryState === 'added'
    ? i18n._(msg({ id: 'catalog.card.in-library', message: 'In your library' }))
    : libraryState === 'adding'
      ? i18n._(msg({ id: 'catalog.card.adding', message: 'Adding…' }))
      : addFailed
        ? i18n._(msg({ id: 'catalog.card.try-adding-again', message: 'Try adding again' }))
        : i18n._(msg({ id: 'catalog.card.add-to-library', message: 'Add to library' }));
  return (
    <article
      className="catalog-vocabulary-card paths-card crystal-chamfer min-w-0 break-words"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 320px' }}
      aria-labelledby={`catalog-word-${card.id}`}
    >
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h3 id={`catalog-word-${card.id}`} lang={card.language} className="paths-word-title break-words">{card.lemma}</h3>{card.phonetic && <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{card.phonetic}</p>}</div>
        <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="paths-badge paths-badge--accent"><Trans {...msg({ context: 'catalog.card.cefr', message: 'CEFR {level}' })} values={{ level: card.cefr }} /></span><span className={metadataBadgeClass}>{card.tier}</span><span className={metadataBadgeClass}>{card.partOfSpeech}</span></div>
      </header>
      <div className="mt-5 space-y-4 text-sm leading-relaxed">
        <section aria-label={i18n._(msg({ id: 'catalog.card.meaning', message: 'Meaning' }))}><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]"><Trans {...msg({ id: 'catalog.card.meaning', message: 'Meaning' })} /></h4><p lang={card.meaningLanguage} className="mt-1 font-semibold">{card.meaning}</p>{card.translation && <p lang={card.translationLanguage} className="mt-1 text-[var(--sf-text-muted)]">{card.translation}</p>}</section>
        {card.example && <section aria-label={i18n._(msg({ id: 'catalog.card.example', message: 'Example' }))}><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]"><Trans {...msg({ id: 'catalog.card.example', message: 'Example' })} /></h4><p lang={card.language} className="mt-1">{card.example}</p>{card.exampleTranslation && <p lang={card.translationLanguage} className="mt-1 text-[var(--sf-text-muted)]">{card.exampleTranslation}</p>}</section>}
        {card.collocations.length > 0 && <section aria-label={i18n._(msg({ id: 'catalog.card.collocations', message: 'Collocations' }))}><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]"><Trans {...msg({ id: 'catalog.card.collocations', message: 'Collocations' })} /></h4><ul className="mt-2 flex flex-wrap gap-2">{card.collocations.map(collocation => <li key={collocation} className="paths-word-chip crystal-chamfer-sm">{collocation}</li>)}</ul></section>}
      </div>
      <footer className="mt-5 break-words border-t border-[var(--sf-border)] pt-4 text-xs text-[var(--sf-text-muted)]">
        <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span><strong className="text-[var(--sf-text)]"><Trans {...msg({ context: 'catalog.card.source', message: 'Source:' })} /></strong> {evidenceLabel(card.provenance.sourceLabel, i18n._(msg({ id: 'catalog.card.source-missing', message: 'Source not provided' })))}</span></p>
        <p className="mt-2"><strong className="text-[var(--sf-text)]"><Trans {...msg({ context: 'catalog.card.license', message: 'License:' })} /></strong> {evidenceLabel(card.provenance.licenseLabel, i18n._(msg({ id: 'catalog.card.license-missing', message: 'License not provided' })))}</p>
        <p className="mt-2"><strong className="text-[var(--sf-text)]"><Trans {...msg({ context: 'catalog.card.review', message: 'Review:' })} /></strong> {evidenceLabel(card.provenance.reviewerLabel, i18n._(msg({ id: 'catalog.card.review-missing', message: 'Human review not recorded' })))}</p>
        {(card.topics.length > 0 || card.skills.length > 0) && <p className="mt-2"><strong className="text-[var(--sf-text)]"><Trans {...msg({ context: 'catalog.card.learning-context', message: 'Learning context:' })} /></strong> {[...card.topics, ...card.skills].join(' · ')}</p>}
        {addFailed && <p id={addErrorId} className="catalog-note catalog-note--danger mt-4 font-semibold" role="alert"><Trans {...msg({ context: 'catalog.card.add-failed', message: 'Could not add “{lemma}” to your library. Check your connection or sign in, then try again.' })} values={{ lemma: card.lemma }} /></p>}
        <button type="button" onClick={onAdd} disabled={libraryState === 'adding' || libraryState === 'added'} aria-describedby={addFailed ? addErrorId : undefined} className={`${ctaClass} mt-4 w-full disabled:cursor-default`} aria-label={i18n._(msg({ id: 'catalog.card.add-action', message: '{action} {lemma}' }).id, { action: addLabel, lemma: card.lemma })}>
          {libraryState === 'adding' ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : libraryState === 'added' ? <Check className="size-4" aria-hidden="true" /> : addFailed ? <RefreshCw className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          {addLabel}
        </button>
      </footer>
    </article>
  );
}

export function CatalogScreen({ model, actions }: CatalogScreenProps) {
  const isCrystal = globalThis.document?.documentElement.dataset.themeFamily === 'crystal';
  const showLumi = isCrystal && readLumiEnabled();
  const isReady = model.status.kind === 'ready';
  const isPersonal = model.mode === 'personal' || (model.status.kind === 'personal' && Boolean(model.personalLibrary));
  const selectedMode = model.mode ?? (isPersonal ? 'personal' : 'reviewed');
  const isEmpty = isReady && !model.isLoadingPage && model.cards.length === 0;
  const activeTrack = model.tracks.find(track => track.id === model.selectedTrack);
  const activeTrackCopy = activeTrack ? catalogTrackMessages[activeTrack.id] : null;
  const activeTier = model.tiers.find(tier => tier.id === model.selectedTier);
  const progressAvailable = model.progressAvailable ?? true;
  const pathUnits = model.pathUnits?.filter(unit => unit.unit.trackId === model.selectedTrack);
  const pathUnitContinue = model.pathUnitContinue;
  const featuredUnit = pathUnits?.find(unit => pathUnitKey(unit.unit) === pathUnitContinue?.selectedUnitId) ?? pathUnits?.[0];
    const unitLanguage = model.uiLocale ?? model.selectedLanguage;
  const allUnitsComplete = pathUnitContinue?.allComplete
    ?? (pathUnits ? pathUnits.length > 0 && pathUnits.every(unit => unit.status === 'complete') : false);
  const continueDisabled = !progressAvailable || !featuredUnit || allUnitsComplete || Boolean(pathUnitContinue?.busy);
  const etaDays = pathUnitContinue?.trackEtaDays ?? null;
  const unitWordsLeft = featuredUnit && featuredUnit.mastered !== null && progressAvailable
    ? Math.max(0, featuredUnit.unit.total - featuredUnit.mastered)
    : null;
  const lumiMessage = featuredUnit && unitWordsLeft !== null && unitWordsLeft > 0 && !allUnitsComplete
    ? i18n._(msg({ id: 'paths.lumi.unit-remaining', message: '{count, plural, one {# more word} other {# more words}} to finish Unit {ordinal}!' }).id, { count: unitWordsLeft, ordinal: featuredUnit.unit.ordinal })
    : null;
  const shelfTracks = model.tracks.length;

  return (
    <section className="catalog-canvas mx-auto w-full min-w-0" aria-labelledby="catalog-heading">
      <header className="catalog-heading paths-header">
        <div className="paths-header-copy">
          {isCrystal && <p className="paths-header-kicker"><Trans {...msg({ id: 'paths.crystal.kicker', message: 'Journey <0>//</0> Week {week}' })} values={{ week: isoWeekNumber(new Date()) }} components={{ 0: <span className="paths-header-kicker-slash" /> }} /></p>}
          <div className="paths-header-titles">
            <h1 id="catalog-heading" ref={model.headingRef} tabIndex={-1} className="paths-title"><Trans {...msg({ context: 'paths.title', message: 'Paths' })} /></h1>
            <p className="paths-subtitle"><Trans {...msg({ id: 'paths.subtitle', message: 'Guided word sets, ordered so each word builds on the one before.' })} /></p>
          </div>
        </div>
        <div className="paths-controls">
          <div data-catalog-mode-switch role="group" aria-label={i18n._(msg({ id: 'paths.source.label', message: 'Path source' }))} className="paths-mode-switch">
            <button type="button" aria-pressed={selectedMode === 'personal'} onClick={() => actions.selectMode('personal')} className="paths-mode-button"><Trans {...msg({ context: 'paths.source.personal', message: 'My vocabulary' })} /></button>
            <button type="button" aria-pressed={selectedMode === 'reviewed'} onClick={() => actions.selectMode('reviewed')} className="paths-mode-button"><Trans {...msg({ context: 'paths.source.reviewed', message: 'Reviewed catalog' })} /></button>
          </div>
          {!isPersonal && <label htmlFor="catalog-language" className="paths-language"><span><Trans {...msg({ context: 'paths.language.label', message: 'Language' })} /></span>
            <select id="catalog-language" name="catalog-language" value={model.selectedLanguage} onChange={event => actions.selectLanguage(event.target.value)} className="glass-field paths-select">
              {model.languages.map(language => <option key={language.code} value={language.code} disabled={!language.isAvailable}>{languageOptionLabel(language.label, language.nativeLabel, language.isAvailable)}</option>)}
            </select>
          </label>}
        </div>
      </header>

      <AvailabilityPanel status={model.status} actions={actions} hasPersonalLibrary={Boolean(model.personalLibrary)} />

      {isPersonal && model.personalLibrary && <PersonalLibraryPaths library={model.personalLibrary} actions={actions} isCrystal={isCrystal} showLumi={showLumi} />}

      {isReady && <>
        <div className="catalog-feature-grid">
        {activeTrack && activeTrackCopy && <section aria-labelledby="catalog-current-path-heading" className="catalog-current-path paths-hero">
          {isCrystal && <span aria-hidden="true" className="paths-hero-art"><CrystalPathWings /></span>}
          <div className="paths-hero-main">
            <p className="paths-hero-kicker"><span className="paths-hero-dot" aria-hidden="true" /><span className="paths-hero-kicker-text">{featuredUnit && pathUnits
              ? <Trans {...msg({ id: 'paths.hero.kicker-unit', message: 'Continue · Unit {current} of {total}' })} values={{ current: featuredUnit.unit.ordinal, total: pathUnits.length }} />
              : <Trans {...msg({ context: 'paths.current.kicker', message: 'Your current path' })} />}</span></p>
            <h2 id="catalog-current-path-heading" className="paths-hero-title"><span className="paths-hero-title-main">{i18n._(activeTrackCopy.label)}</span>{activeTier && <> <em className="paths-hero-title-accent">{i18n._(catalogTierMessages[activeTier.id].label)}</em></>}</h2>
            <p className="paths-hero-copy">{i18n._(activeTrackCopy.description)}.{featuredUnit && <> <Trans {...msg({ id: 'paths.hero.this-unit', message: 'This unit: <0>{title}</0>.' })} values={{ title: pathUnitTitle(featuredUnit.unit, unitLanguage) }} components={{ 0: <strong className="paths-hero-unit" /> }} /></>}</p>
            {featuredUnit && featuredUnit.unit.preview.length > 0 && <ul className="catalog-feature-words">
              {featuredUnit.unit.preview.map((lexeme, index) => <li key={`${lexeme.lexemeId}:${index}`} lang={model.selectedLanguage} className="crystal-chamfer-sm"><span className="paths-chip-mark" aria-hidden="true" />{lexeme.lemma}</li>)}
            </ul>}
          </div>
          <div className="paths-hero-foot">
            <div className="paths-hero-route">
              {pathUnits && pathUnits.length > 0 && <>
                {isCrystal && <p className="paths-route-label" aria-hidden="true"><Trans {...msg({ id: 'paths.hero.route', message: 'Unit route' })} /> <span><Trans {...msg({ id: 'paths.hero.route-steps', message: '// {count} steps' })} values={{ count: pathUnits.length }} /></span></p>}
                <ol className="catalog-feature-segments" aria-label={i18n._(msg({ id: 'paths.current.roadmap-label', message: 'Current path roadmap' }))}>
                  {pathUnits.map(unit => <li key={pathUnitKey(unit.unit)} className={unit.status === 'complete' ? 'complete' : unit === featuredUnit ? 'current' : ''} />)}
                </ol>
              </>}
              {progressAvailable
                ? <p className="catalog-feature-count"><span><Trans {...msg({ id: 'paths.hero.words-mastered', message: '<0>{mastered}</0> of {total} words mastered' })} values={{ mastered: formatNumber(activeTrack.mastered), total: formatNumber(activeTrack.total) }} components={{ 0: <span className="paths-mono paths-count-strong" /> }} /></span><span>{etaDays !== null
                  ? <Trans {...msg({ id: 'paths.hero.eta', message: 'About {days, plural, one {# day} other {# days}} left at your pace' })} values={{ days: etaDays }} />
                  : <Trans {...msg({ id: 'paths.hero.started', message: '{started} started' })} values={{ started: formatNumber(activeTrack.started) }} />}</span></p>
                : <p className="catalog-feature-count"><Trans {...msg({ id: 'paths.unit.status.unavailable', message: 'Progress unavailable' })} /></p>}
              {pathUnits && pathUnits.length > 0 && <div className="paths-hero-actions">
                {allUnitsComplete
                  ? <p className="paths-hero-done"><Trans {...msg({ context: 'paths.unit.all-complete', message: 'All units in this path are complete.' })} /></p>
                  : <button type="button" onClick={actions.openNextUnitPreview} disabled={continueDisabled} className="catalog-feature-continue paths-cta brand-action"><span className="paths-btn-label">{featuredUnit
                    ? <Trans {...msg({ id: 'paths.hero.continue-unit', message: 'Continue unit {ordinal}' })} values={{ ordinal: featuredUnit.unit.ordinal }} />
                    : <Trans {...msg({ context: 'paths.action.continue', message: 'Continue' })} />}</span></button>}
                <button type="button" onClick={() => revealSection('catalog-units-heading')} className="paths-ghost"><span className="paths-btn-label"><Trans {...msg({ id: 'paths.hero.see-all-units', message: 'See all units' })} /></span></button>
              </div>}
            </div>
            {showLumi && <LumiLink message={lumiMessage} />}
          </div>
        </section>}
        <section aria-labelledby="catalog-tracks-heading" className="catalog-shelf paths-shelf">
          <div className="paths-shelf-head">
            <h2 id="catalog-tracks-heading" className="paths-shelf-title"><Trans {...msg({ context: 'paths.shelf.title', message: 'Your shelf' })} /></h2>
            {isCrystal && <span className="paths-shelf-count"><Trans {...msg({ id: 'paths.shelf.journeys', message: '// {count, plural, one {# journey} other {# journeys}}' })} values={{ count: shelfTracks }} /></span>}
            <a href="#catalog-vocabulary-heading" className="paths-browse" onClick={event => { event.preventDefault(); revealSection('catalog-vocabulary-heading'); }}><Trans {...msg({ id: 'paths.shelf.browse', message: 'Browse catalog →' })} /></a>
          </div>
          <div className="paths-books">{model.tracks.map(track => <TrackCard key={track.id} track={track} selected={track.id === model.selectedTrack} progressAvailable={progressAvailable} isCrystal={isCrystal} onSelect={() => actions.selectTrack(track.id)} />)}</div>
        </section>
        </div>

        {pathUnits && pathUnits.length > 0 && <PathUnitShelf units={pathUnits} selectedUnitId={pathUnitContinue?.selectedUnitId ?? model.selectedPathUnitId} language={unitLanguage} continueState={pathUnitContinue} actions={actions} />}

        <section aria-labelledby="catalog-roadmap-heading" className="catalog-roadmap paths-section">
          <div className="paths-section-head"><h2 id="catalog-roadmap-heading" className={sectionHeadingClass}><Trans {...msg({ context: 'paths.roadmap.title', message: 'Your learning level' })} /></h2><p className="paths-section-meta"><Trans {...msg({ context: 'paths.roadmap.kicker', message: 'Your roadmap' })} /></p></div>
          <ol className={model.tiers.length > 1 ? 'paths-tier-grid' : 'paths-tier-grid paths-tier-grid--single'}>{model.tiers.map(tier => <TierStep key={tier.id} tier={tier} selected={tier.id === model.selectedTier} progressAvailable={progressAvailable} onSelect={() => actions.selectTier(tier.id)} />)}</ol>
        </section>

        <section aria-labelledby="catalog-vocabulary-heading" className="catalog-explorer paths-section" aria-busy={model.isLoadingPage || model.isLoadingMore}>
          <div className="paths-explorer-panel paths-card crystal-chamfer">
            <div className="flex items-center gap-2"><Layers3 className="size-5 text-[var(--sf-brand-text)]" aria-hidden="true" /><h2 id="catalog-vocabulary-heading" tabIndex={-1} className={sectionHeadingClass}><Trans {...msg({ context: 'catalog.explorer.title', message: 'Vocabulary explorer' })} /></h2></div>
            <details className="group mt-3" open>
              <summary className="flex min-h-11 cursor-pointer list-none items-center font-bold text-[var(--sf-brand-text)] focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                <span><Trans {...msg({ context: 'catalog.filters.title', message: 'Filters' })} /></span>
                <span className="ml-2 flex size-6 items-center justify-center rounded-full bg-[var(--sf-surface-muted)] text-[var(--sf-brand-text)] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true">
                  <ChevronDown size={14} />
                </span>
              </summary>
            <form className="mt-3" onSubmit={event => event.preventDefault()} role="search">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <label htmlFor="catalog-term" className="min-w-0 text-sm font-bold"><Trans {...msg({ context: 'catalog.filters.search', message: 'Search vocabulary' })} /><div className="glass-field mt-2 flex min-h-11 items-center rounded-xl px-3"><Search className="mr-2 size-4 shrink-0 text-[var(--sf-text-muted)]" aria-hidden="true" /><input id="catalog-term" name="catalog-term" type="search" autoComplete="off" value={model.filters.term} onChange={event => actions.changeTerm(event.target.value)} className="min-h-11 min-w-0 flex-1 bg-transparent py-2" placeholder={i18n._(msg({ id: 'catalog.filters.search-placeholder', message: 'e.g. analysis…' }))} /></div></label>
                <SelectFilter id="catalog-cefr" label={i18n._(msg({ id: 'catalog.filters.cefr', message: 'CEFR level' }))} value={model.filters.cefr} options={model.filters.cefrOptions} onChange={actions.changeCefr} />
                <SelectFilter id="catalog-topic" label={i18n._(msg({ id: 'catalog.filters.topic', message: 'Topic' }))} value={model.filters.topic} options={model.filters.topicOptions} onChange={actions.changeTopic} />
                <SelectFilter id="catalog-pos" label={i18n._(msg({ id: 'catalog.filters.part-of-speech', message: 'Part of speech' }))} value={model.filters.partOfSpeech} options={model.filters.partOfSpeechOptions} onChange={actions.changePartOfSpeech} />
                <SelectFilter id="catalog-skill" label={i18n._(msg({ id: 'catalog.filters.skill', message: 'Skill' }))} value={model.filters.skill} options={model.filters.skillOptions} onChange={actions.changeSkill} />
              </div>
              {model.filters.hasActiveFilters && <button type="button" onClick={actions.resetFilters} className={`${quietButtonClass} mt-4`}><Trans {...msg({ context: 'catalog.filters.clear', message: 'Clear all filters' })} /></button>}
            </form>
            </details>
          </div>

          <p className="mt-4 text-sm font-semibold text-[var(--sf-text-muted)]" role="status" aria-live="polite" aria-atomic="true">{model.resultSummary}</p>

          {model.isLoadingPage && model.cards.length === 0 ? (
            <div className="paths-card skeleton-sheen mt-4 flex min-h-40 items-center justify-center gap-3 font-semibold text-[var(--sf-text-muted)]" role="status">
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <Trans {...msg({ context: 'catalog.loading.matches', message: 'Loading matching vocabulary…' })} />
            </div>
          ) : isEmpty ? (
            <div className="paths-card paths-empty mt-4 text-center"><Search className="mx-auto size-8 text-[var(--sf-text-muted)]" aria-hidden="true" /><h3 className="paths-card-title mt-3"><Trans {...msg({ context: 'catalog.empty.title', message: 'No vocabulary found' })} /></h3><p className="mt-2 text-sm text-[var(--sf-text-muted)]">{model.filters.hasActiveFilters ? <Trans {...msg({ context: 'catalog.empty.filtered', message: 'Try fewer filters or clear them to see this path again.' })} /> : <Trans {...msg({ context: 'catalog.empty.path', message: 'This reviewed catalog does not contain words for the selected path yet.' })} />}</p>{model.filters.hasActiveFilters && <button type="button" onClick={actions.resetFilters} className={`${ctaClass} mt-4`}><Trans {...msg({ context: 'catalog.filters.clear', message: 'Clear all filters' })} /></button>}</div>
          ) : (
            <div className={`mt-4 grid min-w-0 grid-cols-1 gap-4 transition-opacity motion-reduce:transition-none xl:grid-cols-2 ${model.isLoadingPage ? 'opacity-60' : ''}`}>{model.cards.map(card => <VocabularyCard key={card.id} card={card} onAdd={() => actions.addToLibrary(card.id)} />)}</div>
          )}

          {model.hasMore && !model.isLoadingPage && <div className="mt-6 text-center"><button type="button" onClick={actions.loadMore} disabled={model.isLoadingMore} className={`${quietButtonClass} disabled:cursor-wait disabled:opacity-70`}>{model.isLoadingMore && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{model.isLoadingMore ? <Trans {...msg({ context: 'catalog.loading.more', message: 'Loading more words…' })} /> : <Trans {...msg({ context: 'catalog.action.load-more', message: 'Load more words' })} />}</button>{model.isLoadingMore && <span className="sr-only" role="status" aria-live="polite"><Trans {...msg({ context: 'catalog.loading.next-page', message: 'Loading the next vocabulary page.' })} /></span>}</div>}
        </section>
      </>}
    </section>
  );
}

export type { CatalogScreenProps };
