import { useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BookMarked, Flame, Loader2, Play, Plus, Trophy } from 'lucide-react';
import { Trans } from '@lingui/react';
import { formatNumber } from '../../lib/format';

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
    <section data-library-region="overview" className="premium-surface rounded-[28px] p-5 sm:p-6" aria-labelledby="learning-home-heading">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="premium-kicker"><Trans id="library.overview.kicker" message="Vocabulary" /></p>
          <h2 id="learning-home-heading" className="mt-1 text-balance text-3xl font-black tracking-tight text-[var(--sf-text)] sm:text-4xl">
            <Trans id="library.overview.title" message="Your library" />
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="library.overview.description" message="Keep each word ready for its next review." /></p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {total > 0 && <button type="button" data-color-role="primary" data-primary-learning-action="true" onClick={() => void startStudy()} disabled={!canStudy || isStartingStudy} aria-busy={isStartingStudy} className="group inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-2.5 text-sm font-bold text-[var(--sf-on-brand)] shadow-lg shadow-slate-950/15 transition-[transform,background-color,color] hover:-translate-y-px hover:bg-[var(--sf-brand-hover)] hover:text-white active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100">
            {isStartingStudy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />} {isStartingStudy ? <Trans id="library.overview.preparing" message="Preparing review…" /> : due > 0 ? <Trans id="library.overview.review-due" message="Review {count, plural, one {# due} other {# due}}" values={{ count: due }} /> : <Trans id="library.overview.start-review" message="Start a review" />} {!isStartingStudy && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
          </button>}
          <button type="button" data-library-create-action="true" onClick={onCreateCard} className="liquid-control inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--sf-text)] transition-transform hover:-translate-y-px active:translate-y-0 active:scale-[0.98]">
            <Plus size={16} /> <Trans id="library.overview.create-card" message="Create card" />
          </button>
        </div>
      </div>
      <dl data-library-evidence="true" className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] sm:grid-cols-4">
        <Metric icon={<BookMarked size={16} />} label={<Trans id="library.overview.library" message="Library" />} value={formatNumber(total)} />
        <Metric icon={<Trophy size={16} />} label={<Trans id="library.overview.due-today" message="Due today" />} value={formatNumber(due)} accent />
        <Metric icon={<Trophy size={16} />} label={<Trans id="library.overview.mastered" message="Mastered" />} value={`${formatNumber(mastery)}%`} />
        <Metric icon={<Flame size={16} />} label={<Trans id="library.overview.level" message="{xp} XP, Level {level}" values={{ xp: formatNumber(xp), level: formatNumber(level) }} />} value={<Trans id="library.overview.streak" message="{count, plural, one {# day} other {# days}}" values={{ count: streak }} />} accent />
      </dl>
    </section>
  );
}

function Metric({ icon, label, value, accent = false }: { icon: ReactNode; label: ReactNode; value: ReactNode; accent?: boolean }) {
  return <div className="min-w-0 border-b border-[var(--sf-border)] p-3.5 last:border-b-0 even:border-l sm:border-b-0 sm:border-l sm:first:border-l-0"><dt className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[var(--sf-text-muted)]"><span className={accent ? 'text-[var(--sf-reward)]' : 'text-[var(--sf-text-muted)]'}>{icon}</span><span className="truncate">{label}</span></dt><dd className="mt-1 text-xl font-black tabular-nums tracking-[-0.04em] text-[var(--sf-text)]">{value}</dd></div>;
}
