import {
  BookOpen,
  Check,
  CheckCircle2,
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

interface CatalogScreenProps {
  model: CatalogScreenModel;
  actions: CatalogScreenActions;
}

const tierStatePresentation: Record<CatalogTierState, { label: string; Icon: LucideIcon }> = {
  available: { label: 'Available', Icon: Circle },
  'in-progress': { label: 'In progress', Icon: BookOpen },
  completed: { label: 'Completed', Icon: CheckCircle2 },
  locked: { label: 'Locked', Icon: LockKeyhole },
};

const countFormatter = new Intl.NumberFormat('en-US');

function Metric({ value, label }: { value: number; label: string }) {
  return <span><strong className="text-[var(--sf-text)]">{value}</strong> {label}</span>;
}

function evidenceLabel(value: string, fallback: string) {
  return value.trim() || fallback;
}

function languageOptionLabel(label: string, nativeLabel: string, isAvailable: boolean) {
  const names = label === nativeLabel ? label : `${label} (${nativeLabel})`;
  return `${names}${isAvailable ? '' : ' — coming soon'}`;
}

function AvailabilityPanel({ status, actions }: { status: CatalogAvailabilityStatus; actions: CatalogScreenActions }) {
  if (status.kind === 'ready') {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite" aria-atomic="true">
        <span className="flex items-start gap-2 font-semibold"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />{status.message}</span>
        {status.isAvailableOffline && <span className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-emerald-500 px-3 py-2 font-bold sm:self-auto"><Check aria-hidden="true" className="size-4" />Available offline</span>}
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
        <div><h2 id="personal-path-status-title" className="font-black">Personal learning mode</h2><p className="mt-1 text-sm">{status.message}</p></div>
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
          <div><h2 id="catalog-unavailable-title" className="font-black">Catalog unavailable</h2><p className="mt-1 text-sm">{status.message}</p><p className="mt-2 text-sm font-semibold">Draft vocabulary is never shown here.</p></div>
        </div>
        {status.canDownload && status.isOnline ? (
          <button type="button" onClick={actions.download} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 motion-reduce:transition-none"><Download className="size-4" aria-hidden="true" />Check for reviewed catalog</button>
        ) : status.canDownload ? (
          <p className="mt-4 text-sm font-semibold">Connect to the internet for the first verified download.</p>
        ) : (
          <p className="mt-4 text-sm font-semibold">A download will appear after a reviewed release is published.</p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-rose-300 bg-rose-50 p-5 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100" aria-labelledby="catalog-error-title" aria-live="assertive" role="alert">
      <h2 id="catalog-error-title" className="font-black">Catalog needs attention</h2>
      <p className="mt-1 text-sm">{status.message}</p>
      {status.detail && <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Technical detail</summary><p className="break-words rounded-lg bg-white/50 p-3 dark:bg-black/20">{status.detail}</p></details>}
      <button type="button" onClick={actions.retry} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-4 py-2 font-bold text-white transition-colors hover:bg-rose-800 focus-visible:outline-2 motion-reduce:transition-none"><RefreshCw className="size-4" aria-hidden="true" />Try again</button>
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
    { label: 'Review due', value: library.dueToday, copy: 'Cards scheduled for review now.' },
    { label: 'Keep learning', value: library.learning, copy: 'Cards still building toward mastery.' },
    { label: 'Mastered', value: library.learned, copy: 'Cards already retained with confidence.' },
  ];
  return (
    <section aria-labelledby="personal-paths-heading" className="overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-[0_28px_70px_-52px_var(--sf-shadow)]">
      <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0"><p className="premium-kicker uppercase tracking-[0.16em]">Built from your library</p><h2 id="personal-paths-heading" className="mt-2 text-balance text-2xl font-black tracking-tight sm:text-3xl">Your personal paths</h2><p className="mt-2 max-w-3xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">Use your {countFormatter.format(library.total)} saved cards now. No draft catalog vocabulary is mixed into these paths.</p></div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          {library.total > 0 && <button type="button" onClick={actions.continueReview} className="brand-action min-h-12 rounded-xl bg-[var(--sf-brand)] px-5 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-[0_14px_30px_-20px_var(--sf-shadow)] hover:bg-[var(--sf-brand-hover)] hover:text-[var(--sf-on-brand-hover)] focus-visible:outline-2 motion-reduce:transition-none">Continue review</button>}
          <button type="button" onClick={actions.openVocabulary} className="min-h-12 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3 font-bold transition-colors hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 motion-reduce:transition-none">Open vocabulary</button>
        </div>
      </div>
      <ol className="grid border-t border-[var(--sf-border)] md:grid-cols-3" aria-label="Personal learning path">
        {paths.map((path, index) => <li key={path.label} className="flex min-w-0 gap-3 border-b border-[var(--sf-border)] p-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 sm:p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--sf-surface-muted)] text-sm font-black tabular-nums text-[var(--sf-brand-text)]" aria-hidden="true">{index + 1}</span><div className="min-w-0"><p className="text-sm font-bold text-[var(--sf-text-muted)]">{path.label}</p><p className="mt-1 text-2xl font-black tabular-nums">{countFormatter.format(path.value)}</p><p className="mt-2 text-pretty text-sm leading-5 text-[var(--sf-text-muted)]">{path.copy}</p></div></li>)}
      </ol>
    </section>
  );
}

function TrackCard({ track, selected, onSelect }: { track: CatalogTrackPresentation; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`min-h-12 rounded-xl border px-4 py-3 text-left transition-[border-color,background-color] hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none ${selected ? 'border-[var(--sf-brand)] bg-cyan-50 shadow-[inset_4px_0_0_var(--sf-brand)] dark:bg-cyan-950/30' : 'border-[var(--sf-border)] bg-[var(--sf-surface)]'}`}>
      <span className="flex items-center justify-between gap-3"><span className="text-lg font-black">{track.label}</span>{selected && <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--sf-brand-text)]"><Check aria-hidden="true" className="size-4" />Selected</span>}</span>
      <span className="mt-1 block text-sm text-[var(--sf-text-muted)]">{track.description}</span>
      <span className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--sf-text-muted)]"><Metric value={track.total} label="words" /><Metric value={track.started} label="started" /><Metric value={track.mastered} label="mastered" /></span>
    </button>
  );
}

function TierStep({ tier, selected, onSelect }: { tier: CatalogTierPresentation; selected: boolean; onSelect: () => void }) {
  const { label: stateLabel, Icon } = tierStatePresentation[tier.state];
  const isLocked = tier.state === 'locked';
  return (
    <li className="min-w-0 flex-1">
      <button type="button" onClick={onSelect} disabled={isLocked} aria-pressed={selected} className={`h-full min-h-12 w-full rounded-xl border p-4 text-left transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-70 ${selected ? 'border-[var(--sf-brand)] bg-cyan-50 shadow-[inset_4px_0_0_var(--sf-brand)] dark:bg-cyan-950/30' : 'border-[var(--sf-border)] bg-[var(--sf-surface)]'}`}>
        <span className="flex items-center gap-2 text-sm font-bold"><Icon className="size-4 shrink-0" aria-hidden="true" />{stateLabel}</span>
        <span className="mt-2 block text-lg font-black">{tier.label}{selected ? ' · Selected' : ''}</span>
        <span className="mt-1 block text-sm text-[var(--sf-text-muted)]">{tier.description}</span>
        <span className="mt-3 block text-xs text-[var(--sf-text-muted)]">{tier.mastered} of {tier.total} mastered · {tier.started} started</span>
      </button>
    </li>
  );
}

function SelectFilter({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: CatalogFilterOption[]; onChange: (value: string) => void }) {
  return (
    <label htmlFor={id} className="min-w-0 text-sm font-bold text-[var(--sf-text)]">
      {label}
      <select id={id} name={id} value={value} onChange={event => onChange(event.target.value)} className="glass-field mt-2 min-h-11 w-full rounded-xl px-3 text-sm font-medium focus-visible:outline-2">
        <option value="">All</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function VocabularyCard({ card, onAdd }: { card: CatalogVocabularyPresentation; onAdd: () => void }) {
  const libraryState = card.libraryState ?? 'available';
  const addFailed = libraryState === 'failed';
  const addErrorId = `catalog-add-error-${card.id}`;
  return (
    <article className="min-w-0 break-words rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-sm" aria-labelledby={`catalog-word-${card.id}`}>
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h3 id={`catalog-word-${card.id}`} lang={card.language} className="break-words text-2xl font-black">{card.lemma}</h3>{card.phonetic && <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{card.phonetic}</p>}</div>
        <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-cyan-100 px-2.5 py-1 text-cyan-950 dark:bg-cyan-900 dark:text-cyan-50">CEFR {card.cefr}</span><span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-900 dark:bg-slate-700 dark:text-slate-50">{card.tier}</span><span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-900 dark:bg-slate-700 dark:text-slate-50">{card.partOfSpeech}</span></div>
      </header>
      <div className="mt-5 space-y-4 text-sm leading-relaxed">
        <section aria-label="Meaning"><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]">Meaning</h4><p lang={card.meaningLanguage} className="mt-1 font-semibold">{card.meaning}</p>{card.translation && <p lang={card.translationLanguage} className="mt-1 text-[var(--sf-text-muted)]">{card.translation}</p>}</section>
        {card.example && <section aria-label="Example"><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]">Example</h4><p lang={card.language} className="mt-1">{card.example}</p>{card.exampleTranslation && <p lang={card.translationLanguage} className="mt-1 text-[var(--sf-text-muted)]">{card.exampleTranslation}</p>}</section>}
        {card.collocations.length > 0 && <section aria-label="Collocations"><h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]">Collocations</h4><ul className="mt-2 flex flex-wrap gap-2">{card.collocations.map(collocation => <li key={collocation} className="rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 py-1">{collocation}</li>)}</ul></section>}
      </div>
      <footer className="mt-5 break-words border-t border-[var(--sf-border)] pt-4 text-xs text-[var(--sf-text-muted)]">
        <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span><strong className="text-[var(--sf-text)]">Source:</strong> {evidenceLabel(card.provenance.sourceLabel, 'Source not provided')}</span></p>
        <p className="mt-2"><strong className="text-[var(--sf-text)]">License:</strong> {evidenceLabel(card.provenance.licenseLabel, 'License not provided')}</p>
        <p className="mt-2"><strong className="text-[var(--sf-text)]">Review:</strong> {evidenceLabel(card.provenance.reviewerLabel, 'Human review not recorded')}</p>
        {(card.topics.length > 0 || card.skills.length > 0) && <p className="mt-2"><strong className="text-[var(--sf-text)]">Learning context:</strong> {[...card.topics, ...card.skills].join(' · ')}</p>}
        {addFailed && <p id={addErrorId} className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/35 dark:text-rose-200" role="alert">Could not add “{card.lemma}” to your library. Check your connection or sign in, then try again.</p>}
        <button type="button" onClick={onAdd} disabled={libraryState === 'adding' || libraryState === 'added'} aria-describedby={addFailed ? addErrorId : undefined} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-2 text-sm font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-65 motion-reduce:transition-none" aria-label={`${libraryState === 'added' ? 'In your library' : libraryState === 'adding' ? 'Adding' : addFailed ? 'Try adding again' : 'Add'} ${card.lemma} ${libraryState === 'available' ? 'to library' : ''}`.trim()}>
          {libraryState === 'adding' ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : libraryState === 'added' ? <Check className="size-4" aria-hidden="true" /> : addFailed ? <RefreshCw className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
          {libraryState === 'added' ? 'In your library' : libraryState === 'adding' ? 'Adding…' : addFailed ? 'Try adding again' : 'Add to library'}
        </button>
      </footer>
    </article>
  );
}

export function CatalogScreen({ model, actions }: CatalogScreenProps) {
  const isReady = model.status.kind === 'ready';
  const isPersonal = model.status.kind === 'personal' && Boolean(model.personalLibrary);
  const isEmpty = isReady && !model.isLoadingPage && model.cards.length === 0;

  return (
    <section className="mx-auto w-full min-w-0 max-w-7xl space-y-6 sm:space-y-8" aria-labelledby="catalog-heading">
      <header className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.32fr)] lg:items-end">
        <div><p className="premium-kicker uppercase tracking-[0.16em]">{isPersonal ? 'Personal learning paths' : 'Reviewed catalog'}</p>
        <h1 id="catalog-heading" ref={model.headingRef} tabIndex={-1} className="mt-2 text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">Language paths</h1>
        <p className="mt-3 max-w-3xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)] sm:text-base">{isPersonal ? 'Follow practical paths built from cards you already own. Reviewed shared catalogs can be added later without blocking your learning.' : 'Choose a reviewed language catalog, follow a level-by-level path, and keep downloaded words available offline.'}</p></div>
        {!isPersonal && <label htmlFor="catalog-language" className="block text-sm font-bold">Language
          <select id="catalog-language" name="catalog-language" value={model.selectedLanguage} onChange={event => actions.selectLanguage(event.target.value)} className="glass-field mt-2 min-h-12 w-full rounded-xl px-3 font-semibold focus-visible:outline-2">
            {model.languages.map(language => <option key={language.code} value={language.code} disabled={!language.isAvailable}>{languageOptionLabel(language.label, language.nativeLabel, language.isAvailable)}</option>)}
          </select>
        </label>}
      </header>

      <AvailabilityPanel status={model.status} actions={actions} />

      {isPersonal && model.personalLibrary && <PersonalLibraryPaths library={model.personalLibrary} actions={actions} />}

      {isReady && <>
        <section aria-labelledby="catalog-tracks-heading" className="rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 sm:p-5">
          <div className="mb-4"><p className="premium-kicker uppercase tracking-[0.14em]">Choose your goal</p><h2 id="catalog-tracks-heading" className="mt-1 text-xl font-black tracking-tight">IELTS, TOEIC or everyday English</h2></div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{model.tracks.map(track => <TrackCard key={track.id} track={track} selected={track.id === model.selectedTrack} onSelect={() => actions.selectTrack(track.id)} />)}</div>
        </section>

        <section aria-labelledby="catalog-roadmap-heading">
          <div className="mb-4"><p className="premium-kicker uppercase tracking-[0.14em]">Your roadmap</p><h2 id="catalog-roadmap-heading" className="mt-1 text-2xl font-black tracking-tight">Foundation to Advanced</h2></div>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">{model.tiers.map(tier => <TierStep key={tier.id} tier={tier} selected={tier.id === model.selectedTier} onSelect={() => actions.selectTier(tier.id)} />)}</ol>
        </section>

        <section aria-labelledby="catalog-vocabulary-heading" aria-busy={model.isLoadingPage || model.isLoadingMore}>
          <div className="rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5">
            <div className="flex items-center gap-2"><Layers3 className="size-5" aria-hidden="true" /><h2 id="catalog-vocabulary-heading" className="text-xl font-black tracking-tight">Vocabulary explorer</h2></div>
            <details className="group mt-3" open>
              <summary className="flex min-h-11 cursor-pointer list-none items-center font-bold text-[var(--sf-brand-text)] focus-visible:outline-2 [&::-webkit-details-marker]:hidden">Filters <span className="ml-2 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true">⌄</span></summary>
            <form className="mt-3" onSubmit={event => event.preventDefault()} role="search">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <label htmlFor="catalog-term" className="min-w-0 text-sm font-bold">Search vocabulary<div className="glass-field mt-2 flex min-h-11 items-center rounded-xl px-3"><Search className="mr-2 size-4 shrink-0 text-[var(--sf-text-muted)]" aria-hidden="true" /><input id="catalog-term" name="catalog-term" type="search" autoComplete="off" value={model.filters.term} onChange={event => actions.changeTerm(event.target.value)} className="min-h-11 min-w-0 flex-1 bg-transparent py-2" placeholder="e.g. analysis…" /></div></label>
                <SelectFilter id="catalog-cefr" label="CEFR level" value={model.filters.cefr} options={model.filters.cefrOptions} onChange={actions.changeCefr} />
                <SelectFilter id="catalog-topic" label="Topic" value={model.filters.topic} options={model.filters.topicOptions} onChange={actions.changeTopic} />
                <SelectFilter id="catalog-pos" label="Part of speech" value={model.filters.partOfSpeech} options={model.filters.partOfSpeechOptions} onChange={actions.changePartOfSpeech} />
                <SelectFilter id="catalog-skill" label="Skill" value={model.filters.skill} options={model.filters.skillOptions} onChange={actions.changeSkill} />
              </div>
              {model.filters.hasActiveFilters && <button type="button" onClick={actions.resetFilters} className="mt-4 min-h-11 rounded-xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none">Clear all filters</button>}
            </form>
            </details>
          </div>

          <p className="mt-4 text-sm font-semibold text-[var(--sf-text-muted)]" role="status" aria-live="polite" aria-atomic="true">{model.resultSummary}</p>

          {model.isLoadingPage && model.cards.length === 0 ? (
            <div className="skeleton-sheen mt-4 flex min-h-40 items-center justify-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-8 font-semibold text-[var(--sf-text-muted)]" role="status">
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Loading matching vocabulary…
            </div>
          ) : isEmpty ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[var(--sf-border)] bg-[var(--sf-surface)] p-8 text-center"><Search className="mx-auto size-8 text-[var(--sf-text-muted)]" aria-hidden="true" /><h3 className="mt-3 text-lg font-black">No vocabulary found</h3><p className="mt-2 text-sm text-[var(--sf-text-muted)]">{model.filters.hasActiveFilters ? 'Try fewer filters or clear them to see this path again.' : 'This reviewed catalog does not contain words for the selected path yet.'}</p>{model.filters.hasActiveFilters && <button type="button" onClick={actions.resetFilters} className="mt-4 min-h-11 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] focus-visible:outline-2">Clear all filters</button>}</div>
          ) : (
            <div className={`mt-4 grid min-w-0 grid-cols-1 gap-4 transition-opacity motion-reduce:transition-none xl:grid-cols-2 ${model.isLoadingPage ? 'opacity-60' : ''}`}>{model.cards.map(card => <VocabularyCard key={card.id} card={card} onAdd={() => actions.addToLibrary(card.id)} />)}</div>
          )}

          {model.hasMore && !model.isLoadingPage && <div className="mt-6 text-center"><button type="button" onClick={actions.loadMore} disabled={model.isLoadingMore} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-5 py-2 font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none disabled:cursor-wait disabled:opacity-70">{model.isLoadingMore && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{model.isLoadingMore ? 'Loading more words…' : 'Load more words'}</button>{model.isLoadingMore && <span className="sr-only" role="status" aria-live="polite">Loading the next vocabulary page.</span>}</div>}
        </section>
      </>}
    </section>
  );
}

export type { CatalogScreenProps };
