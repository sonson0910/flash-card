import type { ChangeEvent, FormEvent, ReactNode, RefObject } from 'react';
import { Award, BookOpen, Calendar, FileUp, Filter, Folder, Layers3, Loader2, Plus, Search, Sparkles, Star, Tags, X } from 'lucide-react';
import type { CardData } from '../../types/card';
import { PART_OF_SPEECH_OPTIONS } from '../../lib/cardQuery';
import { dateLabelToQueryDate } from './libraryPresentation';

interface LibraryToolsProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onGenerate: (event: FormEvent) => Promise<void>;
  wordInput: string;
  setWordInput: (value: string) => void;
  isLoading: boolean;
  importProgress: { current: number; total: number; word: string } | null;
  libraryCount: number;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  showStarredOnly: boolean;
  setShowStarredOnly: (value: boolean) => void;
  activeDifficulty: string;
  setActiveDifficulty: (value: string) => void;
  activePartOfSpeech: string;
  setActivePartOfSpeech: (value: string) => void;
  /** Transitional compatibility for the current composition root. */
  user?: unknown;
  isAuthenticated?: boolean;
  activeDate: string;
  setActiveDate: (value: string) => void;
  availableDates: string[];
  customDecks: string[];
  newDeckInput: string;
  setNewDeckInput: (value: string) => void;
  createCustomDeck: (name: string) => Promise<void>;
  activeCustomDeck: string;
  setActiveCustomDeck: (value: string) => void;
  cards: CardData[];
  deleteCustomDeck: (name: string) => Promise<void>;
  cloudFacetsComplete: boolean;
  sortedCategories: string[];
  categoryCounts: Record<string, number>;
  activeCategory: string;
  setActiveCategory: (value: string) => void;
}

export function LibraryTools({
  fileInputRef, onImport, onGenerate, wordInput, setWordInput, isLoading, importProgress,
  libraryCount, searchQuery, setSearchQuery, showStarredOnly, setShowStarredOnly,
  activeDifficulty, setActiveDifficulty, activePartOfSpeech, setActivePartOfSpeech,
  user, isAuthenticated, activeDate, setActiveDate, availableDates,
  customDecks, newDeckInput, setNewDeckInput, createCustomDeck, activeCustomDeck,
  setActiveCustomDeck, cards, deleteCustomDeck, cloudFacetsComplete, sortedCategories,
  categoryCounts, activeCategory, setActiveCategory,
}: LibraryToolsProps) {
  const authenticated = isAuthenticated ?? Boolean(user);
  return (
    <aside id="library-tools" className="flex scroll-mt-4 flex-col gap-4 lg:col-span-4 lg:sticky lg:top-4 lg:self-start xl:col-span-3">
      <section className="liquid-glass rounded-[26px] p-5 sm:p-6" aria-labelledby="create-card-heading">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <span className="mb-3 flex size-10 items-center justify-center rounded-2xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-lg shadow-slate-950/10"><Sparkles size={18} aria-hidden="true" /></span>
            <h2 id="create-card-heading" className="text-xl font-black tracking-tight text-[var(--sf-text)]">Create a card</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--sf-text-muted)]">Turn one word into a complete learning moment.</p>
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="liquid-control flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--sf-brand)] transition-transform hover:-translate-y-px active:scale-[0.98]" title="Import cards from Excel or CSV" aria-label="Import cards from Excel or CSV">
            <FileUp size={19} />
            <input type="file" name="card-import" aria-label="Choose an Excel or CSV file" ref={fileInputRef} onChange={onImport} className="hidden" accept=".xlsx, .xls, .csv" />
          </button>
        </div>
        <form onSubmit={onGenerate} className="space-y-4">
          <div>
            <label htmlFor="new-word" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">English word</label>
            <input id="new-word" type="text" value={wordInput} onChange={event => setWordInput(event.target.value)} placeholder="e.g. serendipity" disabled={isLoading} className={`glass-field w-full rounded-xl px-4 py-3 text-base font-medium text-[var(--sf-text)] transition-colors placeholder:text-[var(--sf-text-muted)] disabled:cursor-wait sm:text-sm ${isLoading ? 'border-[var(--sf-brand)]' : 'focus:border-[var(--sf-brand)]'}`} />
            {isLoading ? <div role="status" aria-live="polite" className="mt-2 flex justify-between overflow-hidden px-1 text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300"><span>AI is analysing</span><span>Building your card</span></div> : null}
          </div>
          <button type="submit" data-color-role="primary" disabled={isLoading || !wordInput.trim()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--sf-brand)] py-3.5 font-bold text-[var(--sf-on-brand)] shadow-xl shadow-slate-950/15 transition-[transform,background-color,color] hover:-translate-y-px hover:bg-[var(--sf-brand-hover)] hover:text-white active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100">
            {isLoading ? <Loader2 size={22} className="animate-spin" /> : <Plus size={22} />}
            <span>{importProgress ? `Importing ${importProgress.current}/${importProgress.total}…` : isLoading ? 'Creating card…' : 'Generate smart card'}</span>
          </button>
          <p className="text-center text-[11px] font-medium leading-relaxed text-[var(--sf-text-muted)]">Meaning, context, pronunciation, and a relevant image, prepared automatically.</p>
        </form>
      </section>

      {libraryCount > 0 && (
        <section className="liquid-glass rounded-[26px] p-5 sm:p-6" aria-labelledby="library-filters-heading">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 id="library-filters-heading" className="text-lg font-black text-[var(--sf-text)]">Library filters</h2>
            </div>
            <Filter size={18} className="text-[var(--sf-text-muted)]" />
          </div>

          <div className="space-y-4">
            <div className="hidden lg:block">
              <label htmlFor="library-search" className="mb-2 flex items-center gap-2 text-xs font-bold text-[var(--sf-text-muted)]"><Search size={14} /> Search</label>
              <input id="library-search" name="library-search" type="search" autoComplete="off" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search English words…" className="glass-field min-h-11 w-full rounded-xl px-4 py-2.5 text-base font-medium text-[var(--sf-text)] transition-colors placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] sm:text-sm" />
            </div>

            <button
              type="button"
              data-color-role="reward"
              onClick={() => setShowStarredOnly(!showStarredOnly)}
              className={`group/star-filter flex min-h-[62px] w-full items-center gap-3 rounded-[18px] border px-3 py-2.5 text-left shadow-sm outline-none transition-[transform,border-color,background-color,box-shadow] hover:-translate-y-px active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-[var(--sf-reward)] focus-visible:ring-offset-2 ${showStarredOnly ? 'border-amber-300/80 bg-amber-50/90 dark:border-amber-300/30 dark:bg-amber-300/10' : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] hover:border-amber-300/60 hover:bg-amber-50/55 dark:hover:border-amber-300/25 dark:hover:bg-amber-300/[0.07]'}`}
              role="switch"
              aria-checked={showStarredOnly}
              aria-label="Show starred cards only"
            >
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-[14px] border transition-colors ${showStarredOnly ? 'border-amber-400 bg-[var(--sf-reward)] text-slate-950' : 'border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text-muted)] group-hover/star-filter:border-amber-300 group-hover/star-filter:text-amber-600'}`}>
                <Star size={17} className={showStarredOnly ? 'fill-current' : ''} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-black ${showStarredOnly ? 'text-amber-950 dark:text-amber-100' : 'text-[var(--sf-text)]'}`}>Starred only</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold text-[var(--sf-text-muted)]">{showStarredOnly ? 'Showing your saved favourites' : 'Include every card in the library'}</span>
              </span>
              <span className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${showStarredOnly ? 'border-amber-300/70 bg-amber-100 text-amber-800 dark:border-amber-300/25 dark:bg-amber-300/12 dark:text-amber-200' : 'border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text-muted)]'}`}>
                <span className={`size-1.5 rounded-full ${showStarredOnly ? 'bg-[var(--sf-reward)]' : 'bg-slate-400'}`} />
                {showStarredOnly ? 'On' : 'All'}
              </span>
            </button>

            <FieldLabel icon={<Tags size={14} />} label="Part of speech">
              <select
                aria-label="Filter by part of speech"
                value={activePartOfSpeech}
                onChange={event => setActivePartOfSpeech(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-sm font-bold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)]"
              >
                <option value="All">All word types</option>
                {PART_OF_SPEECH_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FieldLabel>

            <FieldLabel icon={<Award size={14} />} label="Memory status">
              <select aria-label="Filter by memory status" value={activeDifficulty} onChange={event => setActiveDifficulty(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-sm font-bold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)]">
                <option value="All">All statuses</option><option value="due">Due for review</option><option value="easy">Mastered</option><option value="good">Learning</option><option value="hard">Needs practice</option><option value="unrated">Not reviewed</option>
              </select>
            </FieldLabel>

            <FieldLabel icon={<Calendar size={14} />} label="Date created">
              {authenticated ? <div className="flex gap-2"><input type="date" aria-label="Filter cloud cards by date created" value={activeDate === 'All' ? '' : dateLabelToQueryDate(activeDate) || ''} onChange={event => setActiveDate(event.target.value || 'All')} className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-base font-bold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)] sm:text-sm" /><button type="button" onClick={() => setActiveDate('All')} disabled={activeDate === 'All'} className="min-h-11 min-w-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] disabled:opacity-40" aria-label="Clear date filter"><X size={16} className="mx-auto" /></button></div> : <select aria-label="Filter cards by date created" value={activeDate} onChange={event => setActiveDate(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-sm font-bold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)]">{availableDates.map(date => <option key={date} value={date}>{date}</option>)}</select>}
              <p className="mt-2 text-xs leading-relaxed text-[var(--sf-text-muted)]">Searching or viewing due cards clears the date filter to keep cloud queries efficient.</p>
            </FieldLabel>

            <FieldLabel icon={<BookOpen size={14} />} label={`Custom decks (${customDecks.length})`}>
              <form onSubmit={event => { event.preventDefault(); if (newDeckInput.trim()) { void createCustomDeck(newDeckInput); setNewDeckInput(''); } }} className="mb-3 flex gap-2">
                <input type="text" aria-label="New deck name" value={newDeckInput} onChange={event => setNewDeckInput(event.target.value)} placeholder="IELTS, Travel…" className="min-w-0 flex-1 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2.5 text-base font-semibold text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] sm:text-sm" />
                <button type="submit" disabled={!newDeckInput.trim()} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] disabled:opacity-50" aria-label="Create deck"><Plus size={16} /></button>
              </form>
              <div className="flex max-h-[180px] flex-wrap gap-2 overflow-y-auto pr-1 scrollbar-thin">
                <DeckButton active={activeCustomDeck === 'All'} onClick={() => setActiveCustomDeck('All')} icon={<Layers3 size={14} />} label="All decks" />
                <DeckButton active={activeCustomDeck === 'Unassigned'} onClick={() => setActiveCustomDeck('Unassigned')} icon={<Folder size={14} />} label="Unassigned" count={!authenticated || activeCustomDeck === 'Unassigned' ? `${cards.filter(card => !card.customDeck).length}${authenticated ? '+' : ''}` : undefined} />
                {customDecks.map(deck => <div key={deck} className={`flex min-h-11 items-center rounded-xl border pl-3 ${activeCustomDeck === deck ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]'}`}><button type="button" aria-pressed={activeCustomDeck === deck} onClick={() => setActiveCustomDeck(deck)} className="flex min-h-11 items-center gap-1.5 text-xs font-bold"><Folder size={14} /><span>{deck}</span>{(!authenticated || activeCustomDeck === deck) && <span className="text-[10px] opacity-70">{cards.filter(card => card.customDeck === deck).length}{authenticated ? '+' : ''}</span>}</button><button type="button" onClick={() => void deleteCustomDeck(deck)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-rose-600 hover:text-white" title="Delete this deck" aria-label={`Delete ${deck} deck`}><X size={12} /></button></div>)}
              </div>
            </FieldLabel>

            <FieldLabel icon={<Filter size={14} />} label="Categories">
              {authenticated && !cloudFacetsComplete && <p className="mb-3 text-xs leading-relaxed text-[var(--sf-text-muted)]">Showing saved categories and categories from this page to avoid scanning your full library.</p>}
              <div className="flex max-h-[220px] flex-wrap gap-2 overflow-y-auto pr-1 scrollbar-thin">
                {sortedCategories.map(category => <button key={category} type="button" aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)} className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${activeCategory === category ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'}`}><span>{category}</span><span className="text-[10px] opacity-70">{authenticated && category !== 'All' && !cloudFacetsComplete ? `${categoryCounts[category] || 0}+` : categoryCounts[category] || 0}</span></button>)}
              </div>
            </FieldLabel>
          </div>
        </section>
      )}
    </aside>
  );
}

function FieldLabel({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <div><h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-[var(--sf-text-muted)]">{icon}{label}</h3>{children}</div>;
}

function DeckButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count?: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`flex min-h-11 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${active ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'}`}>{icon}<span>{label}</span>{count && <span className="text-[10px] opacity-70">{count}</span>}</button>;
}
