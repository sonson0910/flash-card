import { useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BookMarked, Brain, Flame, Loader2, Play, Plus, Trophy } from 'lucide-react';

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
  const [isStartingStudy, setIsStartingStudy] = useState(false);
  const startingStudyRef = useRef(false);
  const startStudy = async () => {
    if (startingStudyRef.current) return;
    startingStudyRef.current = true;
    setIsStartingStudy(true);
    try {
      await onStartStudy();
    } finally {
      startingStudyRef.current = false;
      setIsStartingStudy(false);
    }
  };

  return (
    <section data-library-region="overview" className="liquid-glass liquid-hero relative min-h-0 overflow-hidden rounded-[32px] sm:min-h-[260px]" aria-labelledby="learning-home-heading">
      <div className="pointer-events-none absolute -right-16 -top-28 size-80 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] opacity-55" aria-hidden="true" />
      <div className="relative grid min-h-0 items-center gap-2 p-4 sm:min-h-[260px] sm:gap-8 sm:p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:p-10">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-3 sm:mb-5">
            <span className="flex size-10 items-center justify-center rounded-2xl border border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-lg shadow-slate-950/10"><Brain size={18} /></span>
            <p className="premium-kicker">Ready when your memory is</p>
          </div>
          <h2 id="learning-home-heading" className="text-balance text-3xl font-black tracking-[-0.055em] text-[var(--sf-text)] sm:text-5xl lg:text-[3rem] lg:leading-[0.98]">
            Make every word unforgettable.
          </h2>
          <p className="mt-3 max-w-xl text-pretty text-base leading-6 text-[var(--sf-text-muted)] sm:mt-5 sm:leading-7">
            Build a vivid memory, then review it at exactly the right moment.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 sm:mt-7 sm:gap-3">
            <button type="button" data-color-role="primary" data-primary-learning-action="true" onClick={() => void startStudy()} disabled={!canStudy || isStartingStudy} aria-busy={isStartingStudy} className="group inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[var(--sf-brand)] px-3 py-2.5 text-sm font-bold text-[var(--sf-on-brand)] shadow-xl shadow-slate-950/15 transition-[transform,background-color,color] hover:-translate-y-px hover:bg-[var(--sf-brand-hover)] hover:text-white active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 sm:min-h-12 sm:px-5 sm:py-3">
              {isStartingStudy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />} {isStartingStudy ? 'Preparing review…' : due > 0 ? `Review ${due} due` : 'Start a review'} {!isStartingStudy && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
            </button>
            <button type="button" onClick={onCreateCard} className="liquid-control inline-flex min-h-11 items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-bold text-[var(--sf-text)] transition-transform hover:-translate-y-px active:translate-y-0 active:scale-[0.98] sm:min-h-12 sm:px-5 sm:py-3">
              <Plus size={16} /> Create card
            </button>
          </div>
        </div>

        <div data-library-evidence="true" className="border-t border-[var(--sf-border)] pt-3 sm:pt-5 lg:border-l lg:border-t-0 lg:pl-8">
          <p className="premium-kicker uppercase tracking-[0.14em]">Supporting evidence</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:mt-4 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-4 lg:grid-cols-2 lg:gap-x-6">
          <Metric icon={<Brain size={17} />} label="Due today" value={due} />
          <Metric icon={<BookMarked size={17} />} label="Library" value={total} />
          <Metric icon={<Trophy size={17} />} label="Mastered" value={`${mastery}%`} />
          <Metric icon={<Flame size={17} />} label={`${xp} XP, Level ${level}`} value={`${streak} days`} accent />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value, accent = false }: { icon: ReactNode; label: string; value: number | string; accent?: boolean }) {
  return <div className="flex min-w-0 flex-col gap-1"><dt className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[var(--sf-text-muted)]"><span className={accent ? 'text-[var(--sf-reward)]' : 'text-[var(--sf-text-muted)]'}>{icon}</span><span className="truncate">{label}</span></dt><dd className="text-xl font-black tabular-nums tracking-[-0.04em] text-[var(--sf-text)]">{value}</dd></div>;
}
