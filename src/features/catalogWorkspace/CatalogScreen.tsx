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
import { formatNumber } from '../../lib/format';
import './catalog-workspace.css';
import { catalogTierMessages, catalogTrackMessages } from './catalogPresentation';
import type {
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

interface CatalogScreenProps {
  model: CatalogScreenModel;
  actions: CatalogScreenActions;
}

const tierStatePresentation: Record<CatalogTierState, { label: ReturnType<typeof msg>; Icon: LucideIcon }> = {
  available: { label: msg({ id: 'paths.tier-state.available', message: 'Available' }), Icon: Circle },
  'in-progress': { label: msg({ id: 'paths.tier-state.in-progress', message: 'In progress' }), Icon: BookOpen },
  completed: { label: msg({ id: 'paths.tier-state.completed', message: 'Completed' }), Icon: CheckCircle2 },
  locked: { label: msg({ id: 'paths.tier-state.locked', message: 'Locked' }), Icon: LockKeyhole },
};

function Metric({ value, label }: { value: number; label: string }) {
  return <span><strong className="text-[var(--sf-text)]">{formatNumber(value)}</strong> {label}</span>;
}

function evidenceLabel(value: string, fallback: string) {
  return value.trim() || fallback;
}

function languageOptionLabel(label: string, nativeLabel: string, isAvailable: boolean) {
  const names = label === nativeLabel ? label : `${label} (${nativeLabel})`;
  return isAvailable ? names : i18n._(msg({ id: 'catalog.language.coming-soon', message: '{names} — coming soon' }).id, { names });
}

function AvailabilityPanel({ status, actions }: { status: CatalogAvailabilityStatus; actions: CatalogScreenActions }) {
  if (status.kind === 'ready') {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite" aria-atomic="true">
        <span className="flex items-start gap-2 font-semibold"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />{status.message}</span>
      </div>
    );
  }

  if (status.kind === 'checking') {
    return (
      <div className="skeleton-sheen flex min-h-24 items-center gap-3 rounded-2xl border border-[var(--sf-border)] p-4" role="status" aria-live="polite" aria-atomic="true">
        <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span className="font-semibold">{status.message}</span>
      </div>
    );
  }

  if (status.kind === 'personal') {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-cyan-300 bg-cyan-50 p-5 text-cyan-950 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100" aria-labelledby="personal-path-status-title" aria-live="polite">
        <BookOpen className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div><h2 id="personal-path-status-title" className="font-black"><Trans id="catalog.personal.status-title" message="Personal learning mode" /></h2><p className="mt-1 text-sm">{status.message}</p></div>
      </section>
    );
  }

  if (status.kind === 'downloading') {
    const progressPercent = Math.min(100, Math.max(0, status.progressPercent));
    return (
      <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4" role="status" aria-live="polite" aria-atomic="true" aria-busy="true">
        <div className="flex items-center justify-between gap-3 text-sm font-semibold"><span>{status.message}</span><span>{progressPercent}%</span></div>
        <progress className="mt-3 h-3 w-full accent-[var(--sf-brand)]" max={100} value={progressPercent}>{progressPercent}%</progress>
      </div>
    );
  }

  if (status.kind === 'unavailable') {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" aria-labelledby="catalog-unavailable-title" aria-live="polite">
        <div className="flex items-start gap-3">
          <WifiOff className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div><h2 id="catalog-unavailable-title" className="font-black"><Trans id="catalog.status.unavailable-title" message="Catalog unavailable" /></h2><p className="mt-1 text-sm">{status.message}</p><p className="mt-2 text-sm font-semibold"><Trans id="catalog.status.no-drafts" message="Draft vocabulary is never shown here." /></p></div>
        </div>
        {status.canDownload && status.isOnline ? (
          <button type="button" onClick={actions.download} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 motion-reduce:transition-none"><Download className="size-4" aria-hidden="true" /><Trans id="catalog.status.check-reviewed" message="Check for reviewed catalog" /></button>
        ) : status.canDownload ? (
          <p className="mt-4 text-sm font-semibold"><Trans id="catalog.status.connect-first-download" message="Connect to the internet for the first verified download." /></p>
        ) : (
          <p className="mt-4 text-sm font-semibold"><Trans id="catalog.status.release-pending" message="A download will appear after a reviewed release is published." /></p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-rose-300 bg-rose-50 p-5 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100" aria-labelledby="catalog-error-title" aria-live="assertive" role="alert">
      <h2 id="catalog-error-title" className="font-black"><Trans id="catalog.status.error-title" message="Catalog needs attention" /></h2>
      <p className="mt-1 text-sm">{status.message}</p>
      {status.detail && (
        <details className="group mt-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 font-semibold [&::-webkit-details-marker]:hidden">
            <span><Trans id="catalog.status.technical-detail" message="Technical detail" /></span>
            <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <p className="mt-1 break-words rounded-xl bg-white/60 p-3 font-mono text-xs text-rose-900 dark:bg-black/30 dark:text-rose-200">
            {status.detail}
          </p>
        </details>
      )}
      <button type="button" onClick={actions.retry} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-4 py-2 font-bold text-white transition-colors hover:bg-rose-800 focus-visible:outline-2 motion-reduce:transition-none"><RefreshCw className="size-4" aria-hidden="true" /><Trans id="catalog.action.retry" message="Try again" /></button>
    </section>
  );
}

function PersonalLibraryPaths({
  library,
  actions,
}: {
  library: NonNullable<CatalogScreenModel['personalLibrary']>;
  actions: CatalogScreenActions;
}) {
  const paths = [
    { label: msg({ id: 'catalog.personal.review-due', message: 'Review due' }), value: library.dueToday, copy: msg({ id: 'catalog.personal.review-due-description', message: 'Cards scheduled for review now.' }) },
    { label: msg({ id: 'catalog.personal.keep-learning', message: 'Keep learning' }), value: library.learning, copy: msg({ id: 'catalog.personal.keep-learning-description', message: 'Cards still building toward mastery.' }) },
    { label: msg({ id: 'catalog.personal.mastered', message: 'Mastered' }), value: library.learned, copy: msg({ id: 'catalog.personal.mastered-description', message: 'Cards already retained with confidence.' }) },
  ];
  return (
    <section aria-labelledby="personal-paths-heading" className="catalog-personal-paths overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-[0_28px_70px_-52px_var(--sf-shadow)]">
      <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0"><p className="premium-kicker uppercase tracking-[0.16em]"><Trans id="catalog.personal.kicker" message="Built from your library" /></p><h2 id="personal-paths-heading" className="mt-2 text-balance text-2xl font-black tracking-tight sm:text-3xl"><Trans id="catalog.personal.title" message="Your personal paths" /></h2><p className="mt-2 max-w-3xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="catalog.personal.description" message="Use your {count} saved cards now. No draft catalog vocabulary is mixed into these paths." values={{ count: formatNumber(library.total) }} /></p></div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          {library.total > 0 && <button type="button" onClick={actions.continueReview} className="brand-action min-h-11 rounded-full bg-[var(--sf-brand)] px-6 py-2.5 text-sm font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all duration-300 hover:scale-[1.03] hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 motion-reduce:transition-none cursor-pointer"><Trans id="catalog.action.continue-review" message="Continue review" /></button>}
          <button type="button" onClick={actions.openVocabulary} className="min-h-11 rounded-full border border-slate-200 bg-slate-100/90 dark:border-white/15 dark:bg-white/5 px-5 py-2.5 text-sm font-bold text-slate-800 dark:text-white/90 transition-all duration-200 hover:border-cyan-400/50 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 motion-reduce:transition-none cursor-pointer"><Trans id="catalog.action.open-vocabulary" message="Open vocabulary" /></button>
        </div>
      </div>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-[2.375rem] top-[2.375rem] bottom-[2.375rem] w-px bg-[var(--sf-border)] sm:left-[2.875rem] sm:top-[2.875rem] sm:bottom-[2.875rem] md:left-[16.666%] md:right-[16.666%] md:top-[2.875rem] md:bottom-auto md:h-px md:w-auto" />
        <ol className="grid border-t border-[var(--sf-border)] p-5 sm:p-7 md:grid-cols-3 md:gap-0 md:px-0" aria-label={i18n._(msg({ id: 'catalog.personal.path-label', message: 'Personal learning path: Review due → Keep learning → Mastered' }))}>
          {paths.map((path, index) => <li key={path.label.id} className="relative flex min-w-0 gap-3 py-4 first:pt-0 last:pb-0 md:flex-col md:items-center md:gap-3 md:px-3 md:py-0 md:text-center"><span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-4 border-[var(--sf-surface)] bg-[var(--sf-brand)] text-sm font-black tabular-nums text-[var(--sf-on-brand)]" aria-hidden="true">{index + 1}</span><div className="min-w-0 md:max-w-[16rem]"><p className="text-sm font-bold text-[var(--sf-text-muted)]">{i18n._(path.label)}</p><p className="mt-1 text-2xl font-black tabular-nums">{formatNumber(path.value)}</p><p className="mt-2 text-pretty text-sm leading-5 text-[var(--sf-text-muted)]">{i18n._(path.copy)}</p></div></li>)}
        </ol>
      </div>
    </section>
  );
}

function TrackCard({ track, selected, progressAvailable, onSelect }: { track: CatalogTrackPresentation; selected: boolean; progressAvailable: boolean; onSelect: () => void }) {
  const copy = catalogTrackMessages[track.id];
  const progress = track.total === 0 ? 0 : Math.round((track.mastered / track.total) * 100);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`catalog-track-card group relative min-h-52 overflow-hidden rounded-[22px] border p-5 text-left shadow-[0_18px_48px_-38px_var(--sf-shadow)] transition-all hover:-translate-y-1 hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transform-none motion-reduce:transition-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm ${selected ? 'border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] ring-1 ring-[var(--sf-brand)]/30' : 'border-[var(--sf-border)] bg-[var(--sf-surface)]'}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-2 ${selected ? 'bg-[var(--sf-brand)]' : 'bg-[var(--sf-border)] group-hover:bg-[var(--sf-brand)]'}`} />
      <span className="relative flex items-center justify-between gap-3"><span className="text-xl font-black tracking-tight">{i18n._(copy.label)}</span>{selected && <span className="inline-flex items-center gap-1 rounded-full border border-[var(--sf-brand)]/30 bg-[var(--sf-brand)]/10 px-2 py-1 text-[11px] font-black text-[var(--sf-brand-text)]"><Check aria-hidden="true" className="size-3.5" /><Trans id="paths.selected" message="Selected" /></span>}</span>
      <span className="relative mt-2 block text-sm leading-6 text-[var(--sf-text-muted)]">{i18n._(copy.description)}</span>
      <span className="relative mt-5 block h-1.5 overflow-hidden rounded-full bg-[var(--sf-border)]"><span className="block h-full rounded-full bg-[var(--sf-brand)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} /></span>
      <span className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--sf-text-muted)]"><Metric value={track.total} label={i18n._(msg({ id: 'paths.metric.words', message: 'words' }))} />{progressAvailable ? <><Metric value={track.started} label={i18n._(msg({ id: 'paths.metric.started', message: 'started' }))} /><Metric value={track.mastered} label={i18n._(msg({ id: 'paths.metric.mastered', message: 'mastered' }))} /></> : <span><Trans id="paths.unit.status.unavailable" message="Progress unavailable" /></span>}</span>
    </button>
  );
}

function TierStep({ tier, selected, progressAvailable, onSelect }: { tier: CatalogTierPresentation; selected: boolean; progressAvailable: boolean; onSelect: () => void }) {
  const { label: stateLabel, Icon } = tierStatePresentation[tier.state];
  const copy = catalogTierMessages[tier.id];
  const isLocked = progressAvailable && tier.state === 'locked';
  return (
    <li className="min-w-0 flex-1">
      <button type="button" onClick={onSelect} disabled={isLocked} aria-pressed={selected} className={`catalog-tier-step h-full min-h-12 w-full rounded-2xl border p-4 text-left transition-all hover:border-cyan-400 focus-visible:outline-2 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-70 ${selected ? 'border-cyan-400 bg-cyan-50 shadow-[inset_4px_0_0_#0891B2] dark:bg-cyan-950/30' : 'border-[var(--sf-border)] bg-[var(--sf-surface)]'}`}>
        <span className="flex items-center gap-2 text-sm font-bold"><Icon className="size-4 shrink-0" aria-hidden="true" />{progressAvailable ? i18n._(stateLabel) : <Trans id="paths.unit.status.unavailable" message="Progress unavailable" />}</span>
        <span className="mt-2 block text-lg font-black">{i18n._(copy.label)}{tier.cefrRange && ` · ${tier.cefrRange}`}{selected && <> · <Trans id="paths.selected" message="Selected" /></>}</span>
        <span className="mt-1 block text-sm text-[var(--sf-text-muted)]">{i18n._(copy.description)}</span>
        {progressAvailable && <span className="mt-3 block text-xs text-[var(--sf-text-muted)]"><Trans id="paths.tier.progress" message="{mastered} of {total} mastered · {started} started" values={{ mastered: formatNumber(tier.mastered), total: formatNumber(tier.total), started: formatNumber(tier.started) }} /></span>}
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
    <section aria-labelledby="catalog-units-heading" className="catalog-shelf rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 sm:p-5">
      <div className="mb-4"><p className="premium-kicker uppercase tracking-[0.14em]"><Trans id="paths.units.kicker" message="Catalog units" /></p><h2 id="catalog-units-heading" className="mt-1 text-xl font-black tracking-tight"><Trans id="paths.units.title" message="Choose a unit" /></h2></div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={i18n._(msg({ id: 'paths.units.list-label', message: 'Catalog units' }))}>
        {units.map(progress => {
          const unit = progress.unit;
          const isSelected = progress === selected;
          return <li key={`${unit.trackId}:${unit.unitId}`}><button type="button" onClick={() => actions.selectPathUnit(unit.trackId, unit.unitId)} aria-pressed={isSelected} className={`min-h-11 w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 motion-reduce:transition-none ${isSelected ? 'border-[var(--sf-brand)] bg-[var(--sf-surface)]' : 'border-[var(--sf-border)] bg-[var(--sf-surface)] hover:border-[var(--sf-brand)]'}`}>
            <span className="flex flex-col gap-1"><span className="font-black"><Trans id="paths.unit.ordinal" message="Unit {ordinal}" values={{ ordinal: unit.ordinal }} /> · {pathUnitTitle(unit, language)}</span><span className="text-xs font-bold text-[var(--sf-text-muted)]">{i18n._(status(progress))}</span></span>
            <span className="mt-2 block text-sm text-[var(--sf-text-muted)]"><Trans id="paths.unit.count" message="{count} words" values={{ count: formatNumber(unit.total) }} /></span>
          </button></li>;
        })}
      </ol>
      <aside id="catalog-unit-preview" tabIndex={-1} className="mt-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 focus-visible:outline-2" aria-live="polite">
        <h3 className="font-black"><Trans id="paths.unit.preview" message="Preview: {title}" values={{ title: pathUnitTitle(selected.unit, language) }} /></h3>
        {selected.introduced === null || selected.mastered === null
          ? <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="paths.unit.progress-unavailable" message="Progress is unavailable until your library can be verified." /></p>
          : <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="paths.unit.progress" message="{introduced} introduced · {mastered} mastered" values={{ introduced: formatNumber(selected.introduced), mastered: formatNumber(selected.mastered) }} /></p>}
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {selected.unit.preview.map((lexeme, index) => <li key={`${lexeme.lexemeId}:${index}`} lang={language} className="rounded-lg bg-[var(--sf-surface-raised)] px-3 py-2 font-semibold">{lexeme.lemma}</li>)}
        </ol>
        {continueState?.etaDays !== null && continueState?.etaDays !== undefined && <p className="mt-3 text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="paths.unit.eta" message="Estimated {days, plural, one {# day} other {# days}} left at your pace." values={{ days: continueState.etaDays }} /></p>}
        {continueState && (selected.status === 'unavailable'
          ? <p className="mt-3 text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="paths.unit.continue-unavailable" message="Continue is unavailable until progress can be verified." /></p>
          : selected.status === 'complete'
            ? <p className="mt-3 text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="paths.unit.complete-message" message="This unit is complete." /></p>
          : continueState?.allComplete
            ? <p className="mt-3 text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="paths.unit.all-complete" message="All units in this path are complete." /></p>
            : <div className="mt-4">
              {confirmationArmed && <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="paths.unit.confirm-disclosure" message="Any missing unit words will be added to your Library before study." /></p>}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={confirmationArmed ? actions.confirmSelectedUnit : actions.prepareSelectedUnit} disabled={continueState?.busy} className="brand-action min-h-11 rounded-full bg-[var(--sf-brand)] px-5 py-2.5 text-sm font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all duration-300 hover:scale-[1.03] hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-65 cursor-pointer">
                  {continueState?.busy ? <Trans id="paths.unit.continuing" message="Starting unit…" /> : confirmationArmed ? hasUnintroducedWords ? <Trans id="paths.unit.add-and-study" message="Add missing words and study" /> : <Trans id="paths.unit.study" message="Study this unit" /> : <Trans id="paths.unit.prepare-continue" message="Continue with this unit" />}
                </button>
                {continueState?.error && <p className="text-sm font-semibold text-rose-700 dark:text-rose-200" role="alert">{continueState.error}</p>}
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
      <select id={id} name={id} value={value} onChange={event => onChange(event.target.value)} className="glass-field mt-2 min-h-11 w-full rounded-xl px-3 text-sm font-medium focus-visible:outline-2">
        <option value=""><Trans id="catalog.filter.all" message="All" /></option>
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
      className="catalog-vocabulary-card min-w-0 break-words rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-sm"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 320px' }}
      aria-labelledby={`catalog-word-${card.id}`}
    >
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h3 id={`catalog-word-${card.id}`} lang={card.language} className="break-words text-2xl font-black">{card.lemma}</h3>{card.phonetic && <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{card.phonetic}</p>}</div>
        <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-cyan-100 px-2.5 py-1 text-cyan-950 dark:bg-cyan-900 dark:text-cyan-50"><Trans id="catalog.card.cefr" message="CEFR {level}" values={{ level: card.cefr }} /></span><span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-900 dark:bg-slate-700 dark:text-slate-50">{card.tier}</span><span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-900 dark:bg-slate-700 dark:text-slate-50">{card.partOfSpeech}</span></div>
      </header>
      <div className="mt-5 space-y-4 text-sm leading-relaxed">
        <section aria-label={i18n._(msg({ id: 'catalog.card.meaning', message: 'Meaning' }))}><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]"><Trans id="catalog.card.meaning" message="Meaning" /></h4><p lang={card.meaningLanguage} className="mt-1 font-semibold">{card.meaning}</p>{card.translation && <p lang={card.translationLanguage} className="mt-1 text-[var(--sf-text-muted)]">{card.translation}</p>}</section>
        {card.example && <section aria-label={i18n._(msg({ id: 'catalog.card.example', message: 'Example' }))}><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]"><Trans id="catalog.card.example" message="Example" /></h4><p lang={card.language} className="mt-1">{card.example}</p>{card.exampleTranslation && <p lang={card.translationLanguage} className="mt-1 text-[var(--sf-text-muted)]">{card.exampleTranslation}</p>}</section>}
        {card.collocations.length > 0 && <section aria-label={i18n._(msg({ id: 'catalog.card.collocations', message: 'Collocations' }))}><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]"><Trans id="catalog.card.collocations" message="Collocations" /></h4><ul className="mt-2 flex flex-wrap gap-2">{card.collocations.map(collocation => <li key={collocation} className="rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 py-1">{collocation}</li>)}</ul></section>}
      </div>
      <footer className="mt-5 break-words border-t border-[var(--sf-border)] pt-4 text-xs text-[var(--sf-text-muted)]">
        <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span><strong className="text-[var(--sf-text)]"><Trans id="catalog.card.source" message="Source:" /></strong> {evidenceLabel(card.provenance.sourceLabel, i18n._(msg({ id: 'catalog.card.source-missing', message: 'Source not provided' })))}</span></p>
        <p className="mt-2"><strong className="text-[var(--sf-text)]"><Trans id="catalog.card.license" message="License:" /></strong> {evidenceLabel(card.provenance.licenseLabel, i18n._(msg({ id: 'catalog.card.license-missing', message: 'License not provided' })))}</p>
        <p className="mt-2"><strong className="text-[var(--sf-text)]"><Trans id="catalog.card.review" message="Review:" /></strong> {evidenceLabel(card.provenance.reviewerLabel, i18n._(msg({ id: 'catalog.card.review-missing', message: 'Human review not recorded' })))}</p>
        {(card.topics.length > 0 || card.skills.length > 0) && <p className="mt-2"><strong className="text-[var(--sf-text)]"><Trans id="catalog.card.learning-context" message="Learning context:" /></strong> {[...card.topics, ...card.skills].join(' · ')}</p>}
        {addFailed && <p id={addErrorId} className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/35 dark:text-rose-200" role="alert"><Trans id="catalog.card.add-failed" message="Could not add “{lemma}” to your library. Check your connection or sign in, then try again." values={{ lemma: card.lemma }} /></p>}
        <button type="button" onClick={onAdd} disabled={libraryState === 'adding' || libraryState === 'added'} aria-describedby={addFailed ? addErrorId : undefined} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-[#071014] shadow-lg shadow-cyan-500/25 transition-all duration-300 hover:scale-[1.02] hover:bg-cyan-300 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-65 motion-reduce:transition-none" aria-label={i18n._(msg({ id: 'catalog.card.add-action', message: '{action} {lemma}' }).id, { action: addLabel, lemma: card.lemma })}>
          {libraryState === 'adding' ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : libraryState === 'added' ? <Check className="size-4" aria-hidden="true" /> : addFailed ? <RefreshCw className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          {addLabel}
        </button>
      </footer>
    </article>
  );
}

export function CatalogScreen({ model, actions }: CatalogScreenProps) {
  const isCrystal = globalThis.document?.documentElement.dataset.themeFamily === 'crystal';
  const isReady = model.status.kind === 'ready';
  const isPersonal = model.status.kind === 'personal' && Boolean(model.personalLibrary);
  const isEmpty = isReady && !model.isLoadingPage && model.cards.length === 0;
  const activeTrack = model.tracks.find(track => track.id === model.selectedTrack);
  const activeTrackCopy = activeTrack ? catalogTrackMessages[activeTrack.id] : null;
  const progressAvailable = model.progressAvailable ?? true;
  const pathUnits = model.pathUnits?.filter(unit => unit.unit.trackId === model.selectedTrack);
  const pathUnitContinue = model.pathUnitContinue;
  const continueDisabled = !progressAvailable || !pathUnitContinue?.selectedUnitId || pathUnitContinue.allComplete || pathUnitContinue.busy;
  const kicker = isPersonal
    ? i18n._(msg({ id: 'paths.personal.kicker', message: 'Personal learning paths' }))
    : i18n._(msg({ id: 'paths.catalog.kicker', message: 'Reviewed catalog' }));
  const description = isPersonal
    ? i18n._(msg({ id: 'paths.personal.description', message: 'Follow practical paths built from cards you already own. Reviewed shared catalogs can be added later without blocking your learning.' }))
    : i18n._(msg({ id: 'paths.catalog.description', message: 'Choose a reviewed language catalog and follow its ordered learning units.' }));

  return (
    <section className="catalog-canvas mx-auto w-full min-w-0 max-w-7xl space-y-6 sm:space-y-8" aria-labelledby="catalog-heading">
      <header className="catalog-heading grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.32fr)] lg:items-end">
        <div><p className="premium-kicker uppercase tracking-[0.16em]">{kicker}</p>
        <h1 id="catalog-heading" ref={model.headingRef} tabIndex={-1} className="mt-2 break-words text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl"><Trans id="paths.title" message="Language paths" /></h1>
        <p className="mt-3 max-w-3xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)] sm:text-base">{description}</p></div>
        {!isPersonal && <label htmlFor="catalog-language" className="block text-sm font-bold"><Trans id="paths.language.label" message="Language" />
          <select id="catalog-language" name="catalog-language" value={model.selectedLanguage} onChange={event => actions.selectLanguage(event.target.value)} className="glass-field mt-2 min-h-12 w-full rounded-xl px-3 font-semibold focus-visible:outline-2">
            {model.languages.map(language => <option key={language.code} value={language.code} disabled={!language.isAvailable}>{languageOptionLabel(language.label, language.nativeLabel, language.isAvailable)}</option>)}
          </select>
        </label>}
      </header>

      <AvailabilityPanel status={model.status} actions={actions} />

      {isPersonal && model.personalLibrary && <PersonalLibraryPaths library={model.personalLibrary} actions={actions} />}

      {isReady && <>
        {activeTrack && activeTrackCopy && <section aria-labelledby="catalog-current-path-heading" className="catalog-current-path liquid-glass crystal-chamfer relative overflow-hidden rounded-[28px] border border-[var(--sf-border)] p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8">
          {isCrystal && <span aria-hidden="true" className="crystal-starfield pointer-events-none absolute inset-0 opacity-70 motion-reduce:animate-none" />}
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.46fr)] lg:items-end">
            <div className="min-w-0">
              <p className="premium-kicker uppercase tracking-[0.16em]"><Trans id="paths.current.kicker" message="Your current path" /></p>
              <h2 id="catalog-current-path-heading" className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-5xl">{i18n._(activeTrackCopy.label)}</h2>
              <p className="mt-3 max-w-xl text-pretty leading-7 text-[var(--sf-text-muted)]">{i18n._(activeTrackCopy.description)}</p>
              {progressAvailable ? <p className="mt-5 text-sm font-bold text-[var(--sf-brand-text)]"><Trans id="paths.current.progress" message="{started} started · {mastered} mastered" values={{ started: formatNumber(activeTrack.started), mastered: formatNumber(activeTrack.mastered) }} /></p> : <p className="mt-5 text-sm font-bold text-[var(--sf-brand-text)]"><Trans id="paths.unit.status.unavailable" message="Progress unavailable" /></p>}
              {pathUnitContinue && pathUnits && pathUnits.length > 0 && (pathUnitContinue.allComplete ? <p className="mt-5 text-sm font-bold text-[var(--sf-brand-text)]"><Trans id="paths.unit.all-complete" message="All units in this path are complete." /></p> : <button type="button" onClick={actions.openNextUnitPreview} disabled={continueDisabled} className="brand-action mt-5 min-h-11 rounded-full bg-[var(--sf-brand)] px-6 py-2.5 text-sm font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all duration-300 hover:scale-[1.03] hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-65 cursor-pointer"><Trans id="paths.action.continue" message="Continue" /></button>)}
            </div>
            <div className="catalog-roadmap-panel rounded-[22px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--sf-text-muted)]"><Trans id="paths.current.roadmap" message="Roadmap" /></p>
              <ol className="mt-4 space-y-3" aria-label={i18n._(msg({ id: 'paths.current.roadmap-label', message: 'Current path roadmap' }))}>
                {model.tiers.map((tier, index) => <li key={tier.id} className="flex items-center gap-3 text-sm"><span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${tier.id === model.selectedTier ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]'}`}>{index + 1}</span><span className={tier.id === model.selectedTier ? 'font-black text-[var(--sf-text)]' : 'font-semibold text-[var(--sf-text-muted)]'}>{i18n._(catalogTierMessages[tier.id].label)}</span></li>)}
              </ol>
            </div>
          </div>
        </section>}

        {pathUnits && pathUnits.length > 0 && <PathUnitShelf units={pathUnits} selectedUnitId={pathUnitContinue?.selectedUnitId ?? model.selectedPathUnitId} language={model.uiLocale ?? model.selectedLanguage} continueState={pathUnitContinue} actions={actions} />}

        <section aria-labelledby="catalog-tracks-heading" className="catalog-shelf rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 sm:p-5">
          <div className="mb-4"><p className="premium-kicker uppercase tracking-[0.14em]"><Trans id="paths.goal.kicker" message="Choose your goal" /></p><h2 id="catalog-tracks-heading" className="mt-1 text-xl font-black tracking-tight"><Trans id="paths.goal.title" message="Choose the path that fits your next goal" /></h2></div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{model.tracks.map(track => <TrackCard key={track.id} track={track} selected={track.id === model.selectedTrack} progressAvailable={progressAvailable} onSelect={() => actions.selectTrack(track.id)} />)}</div>
        </section>

        <section aria-labelledby="catalog-roadmap-heading" className="catalog-roadmap">
          <div className="mb-4"><p className="premium-kicker uppercase tracking-[0.14em]"><Trans id="paths.roadmap.kicker" message="Your roadmap" /></p><h2 id="catalog-roadmap-heading" className="mt-1 text-2xl font-black tracking-tight"><Trans id="paths.roadmap.title" message="Your learning level" /></h2></div>
          <ol className={model.tiers.length > 1 ? 'grid grid-cols-1 gap-3 md:grid-cols-3' : 'grid grid-cols-1 gap-3'}>{model.tiers.map(tier => <TierStep key={tier.id} tier={tier} selected={tier.id === model.selectedTier} progressAvailable={progressAvailable} onSelect={() => actions.selectTier(tier.id)} />)}</ol>
        </section>

        <section aria-labelledby="catalog-vocabulary-heading" className="catalog-explorer" aria-busy={model.isLoadingPage || model.isLoadingMore}>
          <div className="rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5">
            <div className="flex items-center gap-2"><Layers3 className="size-5" aria-hidden="true" /><h2 id="catalog-vocabulary-heading" className="text-xl font-black tracking-tight"><Trans id="catalog.explorer.title" message="Vocabulary explorer" /></h2></div>
            <details className="group mt-3" open>
              <summary className="flex min-h-11 cursor-pointer list-none items-center font-bold text-[var(--sf-brand-text)] focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                <span><Trans id="catalog.filters.title" message="Filters" /></span>
                <span className="ml-2 flex size-6 items-center justify-center rounded-full bg-[var(--sf-surface-muted)] text-[var(--sf-brand-text)] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true">
                  <ChevronDown size={14} />
                </span>
              </summary>
            <form className="mt-3" onSubmit={event => event.preventDefault()} role="search">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <label htmlFor="catalog-term" className="min-w-0 text-sm font-bold"><Trans id="catalog.filters.search" message="Search vocabulary" /><div className="glass-field mt-2 flex min-h-11 items-center rounded-xl px-3"><Search className="mr-2 size-4 shrink-0 text-[var(--sf-text-muted)]" aria-hidden="true" /><input id="catalog-term" name="catalog-term" type="search" autoComplete="off" value={model.filters.term} onChange={event => actions.changeTerm(event.target.value)} className="min-h-11 min-w-0 flex-1 bg-transparent py-2" placeholder={i18n._(msg({ id: 'catalog.filters.search-placeholder', message: 'e.g. analysis…' }))} /></div></label>
                <SelectFilter id="catalog-cefr" label={i18n._(msg({ id: 'catalog.filters.cefr', message: 'CEFR level' }))} value={model.filters.cefr} options={model.filters.cefrOptions} onChange={actions.changeCefr} />
                <SelectFilter id="catalog-topic" label={i18n._(msg({ id: 'catalog.filters.topic', message: 'Topic' }))} value={model.filters.topic} options={model.filters.topicOptions} onChange={actions.changeTopic} />
                <SelectFilter id="catalog-pos" label={i18n._(msg({ id: 'catalog.filters.part-of-speech', message: 'Part of speech' }))} value={model.filters.partOfSpeech} options={model.filters.partOfSpeechOptions} onChange={actions.changePartOfSpeech} />
                <SelectFilter id="catalog-skill" label={i18n._(msg({ id: 'catalog.filters.skill', message: 'Skill' }))} value={model.filters.skill} options={model.filters.skillOptions} onChange={actions.changeSkill} />
              </div>
              {model.filters.hasActiveFilters && <button type="button" onClick={actions.resetFilters} className="mt-4 min-h-11 rounded-xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none"><Trans id="catalog.filters.clear" message="Clear all filters" /></button>}
            </form>
            </details>
          </div>

          <p className="mt-4 text-sm font-semibold text-[var(--sf-text-muted)]" role="status" aria-live="polite" aria-atomic="true">{model.resultSummary}</p>

          {model.isLoadingPage && model.cards.length === 0 ? (
            <div className="skeleton-sheen mt-4 flex min-h-40 items-center justify-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-8 font-semibold text-[var(--sf-text-muted)]" role="status">
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <Trans id="catalog.loading.matches" message="Loading matching vocabulary…" />
            </div>
          ) : isEmpty ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[var(--sf-border)] bg-[var(--sf-surface)] p-8 text-center"><Search className="mx-auto size-8 text-[var(--sf-text-muted)]" aria-hidden="true" /><h3 className="mt-3 text-lg font-black"><Trans id="catalog.empty.title" message="No vocabulary found" /></h3><p className="mt-2 text-sm text-[var(--sf-text-muted)]">{model.filters.hasActiveFilters ? <Trans id="catalog.empty.filtered" message="Try fewer filters or clear them to see this path again." /> : <Trans id="catalog.empty.path" message="This reviewed catalog does not contain words for the selected path yet." />}</p>{model.filters.hasActiveFilters && <button type="button" onClick={actions.resetFilters} className="mt-4 min-h-11 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] focus-visible:outline-2"><Trans id="catalog.filters.clear" message="Clear all filters" /></button>}</div>
          ) : (
            <div className={`mt-4 grid min-w-0 grid-cols-1 gap-4 transition-opacity motion-reduce:transition-none xl:grid-cols-2 ${model.isLoadingPage ? 'opacity-60' : ''}`}>{model.cards.map(card => <VocabularyCard key={card.id} card={card} onAdd={() => actions.addToLibrary(card.id)} />)}</div>
          )}

          {model.hasMore && !model.isLoadingPage && <div className="mt-6 text-center"><button type="button" onClick={actions.loadMore} disabled={model.isLoadingMore} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-5 py-2 font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none disabled:cursor-wait disabled:opacity-70">{model.isLoadingMore && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{model.isLoadingMore ? <Trans id="catalog.loading.more" message="Loading more words…" /> : <Trans id="catalog.action.load-more" message="Load more words" />}</button>{model.isLoadingMore && <span className="sr-only" role="status" aria-live="polite"><Trans id="catalog.loading.next-page" message="Loading the next vocabulary page." /></span>}</div>}
        </section>
      </>}
    </section>
  );
}

export type { CatalogScreenProps };
