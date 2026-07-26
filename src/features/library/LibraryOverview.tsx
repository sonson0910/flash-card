import type { ReactNode } from 'react';
import { ArrowRight, BookMarked, Brain, Flame, Play, Plus, Trophy } from 'lucide-react';

interface LibraryOverviewProps {
  total: number;
  due: number;
  mastered: number;
  streak: number;
  level: number;
  xp: number;
  canStudy: boolean;
  onStartStudy: () => Promise<void>;
  onCreateCard: () => void;
}

export function LibraryOverview({ total, due, mastered, streak, level, xp, canStudy, onStartStudy, onCreateCard }: LibraryOverviewProps) {
  const mastery = total > 0 ? Math.round((mastered / total) * 100) : 0;

  return (
    <section className="liquid-glass liquid-hero relative min-h-[300px] overflow-hidden rounded-[32px]" aria-labelledby="learning-home-heading">
      <div className="pointer-events-none absolute -right-16 -top-28 size-80 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] opacity-55" aria-hidden="true" />
      <div className="relative grid min-h-[300px] items-center gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)] lg:p-10">
        <div className="max-w-2xl">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl border border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-lg shadow-slate-950/10"><Brain size={18} /></span>
            <p className="text-sm font-bold text-cyan-700 dark:text-cyan-300">Ready when your memory is</p>
          </div>
          <h1 id="learning-home-heading" className="text-balance text-4xl font-black tracking-[-0.055em] text-[var(--sf-text)] sm:text-5xl lg:text-[3.35rem] lg:leading-[0.98]">
            Make every word unforgettable.
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-[var(--sf-text-muted)]">
            Build a vivid memory, then review it at exactly the right moment.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" data-color-role="primary" onClick={() => void onStartStudy()} disabled={!canStudy} className="group inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[var(--sf-brand)] px-5 py-3 text-sm font-bold text-[var(--sf-on-brand)] shadow-xl shadow-slate-950/15 transition-[transform,background-color,color] hover:-translate-y-px hover:bg-[var(--sf-brand-hover)] hover:text-white active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100">
              <Play size={16} fill="currentColor" /> {due > 0 ? `Review ${due} due` : 'Start a review'} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
            <button type="button" onClick={onCreateCard} className="liquid-control inline-flex min-h-12 items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-[var(--sf-text)] transition-transform hover:-translate-y-px active:translate-y-0 active:scale-[0.98]">
              <Plus size={16} /> Create card
            </button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 lg:grid-rows-2">
          <Metric icon={<Brain size={17} />} label="Due today" value={due} featured />
          <Metric icon={<BookMarked size={17} />} label="Library" value={total} />
          <Metric icon={<Trophy size={17} />} label="Mastered" value={`${mastery}%`} />
          <Metric icon={<Flame size={17} />} label={`${xp} XP, Level ${level}`} value={`${streak} days`} accent />
        </dl>
      </div>
    </section>
  );
}

function Metric({ icon, label, value, accent = false, featured = false }: { icon: ReactNode; label: string; value: number | string; accent?: boolean; featured?: boolean }) {
  return <div className={`liquid-control flex min-h-[112px] flex-col justify-between rounded-[22px] p-4 transition-transform hover:-translate-y-0.5 ${featured ? 'featured-learning-metric' : ''}`}><dt className={`flex items-center gap-2 text-xs font-semibold ${featured ? 'text-current' : 'text-[var(--sf-text-muted)]'}`}><span className={featured ? 'text-current' : accent ? 'text-[var(--sf-reward)]' : 'text-[var(--sf-text-muted)]'}>{icon}</span>{label}</dt><dd className={`text-2xl font-black tabular-nums tracking-[-0.04em] ${featured ? 'text-current' : 'text-[var(--sf-text)]'}`}>{value}</dd></div>;
}
