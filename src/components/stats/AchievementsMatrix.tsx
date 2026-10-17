import { ArrowLeft, Award, Flame, Moon, Sparkles, Star, Target, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { formatNumber } from '../../lib/format';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';

interface AchievementsMatrixProps {
  stats: LibraryStatsViewModel;
  readonly onBackToProgress?: () => void;
}

/** Visual/eligibility state of a badge, derived only from real progress numbers — no invented gating conditions. */
export type AchievementBadgeVisualState = 'earned' | 'in-progress' | 'locked';

/** Stable, locale-independent grouping key for the "nhóm tier" (tier grouping) requirement. */
export type AchievementBadgeTierKey = 'bud' | 'bloom' | 'star';

interface Badge { id: string; title: string; description: string; tier: string; tierKey: AchievementBadgeTierKey; icon: typeof Trophy; unlocked: boolean; progress: number; current: number; target: number; unit: string; state: AchievementBadgeVisualState; }

/**
 * A badge is `earned` once unlocked, `in-progress` once the learner has made any real progress
 * toward it, and `locked` only when there is no progress signal yet (current === 0). This never
 * invents a prerequisite/gate — every badge here is always achievable — it just distinguishes
 * "not started" from "actively working on it" so the grid can show three distinct Canvas states.
 */
export function resolveAchievementBadgeState(stat: Pick<AchievementBadgeStat, 'unlocked' | 'current'>): AchievementBadgeVisualState {
  if (stat.unlocked) return 'earned';
  return stat.current > 0 ? 'in-progress' : 'locked';
}

/** Numeric identity of every milestone badge, stable across locales and callers. */
export type AchievementBadgeId = 'streak_3' | 'mastery_10' | 'mastery_50' | 'xp_100' | 'xp_total_500' | 'night_owl';

export interface AchievementBadgeStat {
  readonly id: AchievementBadgeId;
  readonly unlocked: boolean;
  readonly progress: number;
  readonly current: number;
  readonly target: number;
}

/**
 * Locale-independent badge math shared by the Progress achievements grid and
 * the weekly recap milestones strip, so both read the exact same thresholds
 * from the exact same `LibraryStatsViewModel` instead of drifting apart.
 */
export function computeAchievementBadgeStats(stats: LibraryStatsViewModel): AchievementBadgeStat[] {
  const totalXp = stats.xpChartData.reduce((sum, item) => sum + item.XP, 0);
  const maxSingleDayXp = Math.max(0, ...stats.xpChartData.map(item => item.XP));
  const activeDays = stats.xpChartData.filter(item => item.XP > 0).length;
  return [
    { id: 'streak_3', unlocked: activeDays >= 3, progress: Math.min(100, Math.round(activeDays / 3 * 100)), current: activeDays, target: 3 },
    { id: 'mastery_10', unlocked: stats.reviewed >= 10, progress: Math.min(100, Math.round(stats.reviewed / 10 * 100)), current: stats.reviewed, target: 10 },
    { id: 'mastery_50', unlocked: stats.learned >= 50, progress: Math.min(100, Math.round(stats.learned / 50 * 100)), current: stats.learned, target: 50 },
    { id: 'xp_100', unlocked: maxSingleDayXp >= 100, progress: Math.min(100, Math.round(maxSingleDayXp / 100 * 100)), current: maxSingleDayXp, target: 100 },
    { id: 'xp_total_500', unlocked: totalXp >= 500, progress: Math.min(100, Math.round(totalXp / 500 * 100)), current: totalXp, target: 500 },
    { id: 'night_owl', unlocked: activeDays >= 5, progress: Math.min(100, Math.round(activeDays / 5 * 100)), current: activeDays, target: 5 },
  ];
}

const text = {
  bud: msg({ id: 'stats.tier-bud', message: 'Bud' }), bloom: msg({ id: 'stats.tier-bloom', message: 'Bloom' }), star: msg({ id: 'stats.tier-star', message: 'Star' }),
  days: msg({ id: 'stats.days', message: 'days' }), words: msg({ id: 'stats.words', message: 'words' }), unlocked: msg({ id: 'stats.unlocked', message: 'unlocked' }), progress: msg({ id: 'stats.progress', message: 'Progress' }),
  cards: msg({ id: 'stats.summary-cards', message: 'Cards' }), reviewed: msg({ id: 'stats.reviewed', message: 'Reviewed' }), learned: msg({ id: 'stats.learned', message: 'Learned' }),
  inProgress: msg({ id: 'stats.badge-state.in-progress', message: 'In progress' }), locked: msg({ id: 'stats.badge-state.locked', message: 'Not started yet' }), legendLabel: msg({ id: 'stats.legend.label', message: 'Badge status legend' }),
  budRoutine: msg({ id: 'stats.bud-routine', message: 'Bud routine' }), budRoutineDescription: msg({ id: 'stats.bud-routine-description', message: 'Give your study habit three active days.' }),
  bloomingRecall: msg({ id: 'stats.blooming-recall', message: 'Blooming recall' }), bloomingRecallDescription: msg({ id: 'stats.blooming-recall-description', message: 'Help ten words settle into memory.' }),
  starKeeper: msg({ id: 'stats.star-keeper', message: 'Star keeper' }), starKeeperDescription: msg({ id: 'stats.star-keeper-description', message: 'Help fifty words shine as mastered.' }),
  brightStudyDay: msg({ id: 'stats.bloom-day', message: 'Bright study day' }), brightStudyDayDescription: msg({ id: 'stats.bloom-day-description', message: 'Gather 100 XP in one day of practice.' }),
  growingCollection: msg({ id: 'stats.star-collection', message: 'Growing collection' }), growingCollectionDescription: msg({ id: 'stats.star-collection-description', message: 'Collect 500 XP from your study sessions.' }),
  gentleNightStudy: msg({ id: 'stats.bud-night-study', message: 'Gentle night study' }), gentleNightStudyDescription: msg({ id: 'stats.bud-night-study-description', message: 'Return for five active study days.' }),
  studyMilestones: msg({ id: 'stats.study-milestones', message: 'Study milestones' }), wordGarden: msg({ id: 'stats.word-garden', message: 'Your word garden' }), wordGardenDescription: msg({ id: 'stats.word-garden-description', message: 'Small study sessions grow into lasting memory.' }),
  achievements: msg({ id: 'stats.achievements', message: 'Achievements' }), backToProgress: msg({ id: 'stats.back-to-progress', message: 'Back to Progress' }),
};

export function findNewlyUnlockedBadgeIds(previous: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  return [...current].filter(id => !previous.has(id));
}

/** Localized copy for each badge, keyed by the same id `computeAchievementBadgeStats` returns. */
export const achievementBadgeCopy: Record<AchievementBadgeId, {
  title: ReturnType<typeof msg>; description: ReturnType<typeof msg>; tier: ReturnType<typeof msg>; tierKey: AchievementBadgeTierKey; icon: typeof Trophy; unit: ReturnType<typeof msg> | 'XP';
}> = {
  streak_3: { title: text.budRoutine, description: text.budRoutineDescription, tier: text.bud, tierKey: 'bud', icon: Flame, unit: text.days },
  mastery_10: { title: text.bloomingRecall, description: text.bloomingRecallDescription, tier: text.bloom, tierKey: 'bloom', icon: Sparkles, unit: text.words },
  mastery_50: { title: text.starKeeper, description: text.starKeeperDescription, tier: text.star, tierKey: 'star', icon: Trophy, unit: text.words },
  xp_100: { title: text.brightStudyDay, description: text.brightStudyDayDescription, tier: text.bloom, tierKey: 'bloom', icon: Target, unit: 'XP' },
  xp_total_500: { title: text.growingCollection, description: text.growingCollectionDescription, tier: text.star, tierKey: 'star', icon: Award, unit: 'XP' },
  night_owl: { title: text.gentleNightStudy, description: text.gentleNightStudyDescription, tier: text.bud, tierKey: 'bud', icon: Moon, unit: text.days },
};

export function AchievementsMatrix({ stats, onBackToProgress }: AchievementsMatrixProps) {
  const { _ } = useLingui();
  const badgeStats = computeAchievementBadgeStats(stats);
  const badges: Badge[] = badgeStats.map(stat => {
    const copy = achievementBadgeCopy[stat.id];
    return {
      id: stat.id,
      title: _(copy.title),
      description: _(copy.description),
      tier: _(copy.tier),
      tierKey: copy.tierKey,
      icon: copy.icon,
      unlocked: stat.unlocked,
      progress: stat.progress,
      current: stat.current,
      target: stat.target,
      unit: copy.unit === 'XP' ? 'XP' : _(copy.unit),
      state: resolveAchievementBadgeState(stat),
    };
  });
  const unlockedIds = new Set(badges.filter(badge => badge.unlocked).map(badge => badge.id));
  const featuredBadge = badges.find(badge => badge.state === 'in-progress') ?? badges[0];
  const FeaturedIcon = featuredBadge.icon;
  const unlockedSignature = [...unlockedIds].join('|');
  const previousUnlockedRef = useRef<Set<string> | null>(null);
  const [celebratingIds, setCelebratingIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const previous = previousUnlockedRef.current;
    const current = new Set(unlockedSignature ? unlockedSignature.split('|') : []);
    previousUnlockedRef.current = current;
    if (!previous) return;
    const newlyUnlocked = findNewlyUnlockedBadgeIds(previous, current);
    setCelebratingIds(new Set(newlyUnlocked));
    if (newlyUnlocked.length === 0) return;
    const timeout = globalThis.setTimeout(() => setCelebratingIds(new Set()), 900);
    return () => globalThis.clearTimeout(timeout);
  }, [unlockedSignature]);
  const celebrationMessage = badges.filter(badge => celebratingIds.has(badge.id)).map(badge => `${badge.title} ${_(text.unlocked)}`).join('. ');
  return <section className="achievements-canvas liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-7" aria-labelledby="achievements-heading">
    <span className="sr-only" aria-live="polite">{celebrationMessage}</span>
    <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>{onBackToProgress && <button type="button" onClick={onBackToProgress} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"><ArrowLeft size={16} aria-hidden="true" />{_(text.backToProgress)}</button>}<p className="premium-kicker uppercase tracking-[0.14em]">{onBackToProgress ? _(text.achievements) : _(text.studyMilestones)} · {formatNumber(unlockedIds.size)} / {formatNumber(badges.length)} {_(text.unlocked)}</p><h2 id="achievements-heading" className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">{_(text.wordGarden)}</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--sf-text-muted)]">{_(text.wordGardenDescription)}</p></div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-[var(--sf-text-muted)]" aria-label={_(text.legendLabel)}>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--sf-brand)]" />{_(text.unlocked)}</li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full border border-current" />{_(text.inProgress)}</li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true">🔒</span>{_(text.locked)}</li>
      </ul>
    </div>
    <div className="flex items-center justify-between gap-3 border-b border-[var(--sf-border)] pb-3"><h3 className="text-xl font-black tracking-tight">{_(text.achievements)}</h3><span className="inline-flex items-center gap-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-1.5 text-xs font-bold text-[var(--sf-text)]"><Star size={14} className="text-[var(--sf-brand-text)]" aria-hidden="true" />{formatNumber(unlockedIds.size)} / {formatNumber(badges.length)}</span></div>
    <div data-achievements-board className="mt-4">
      <aside data-achievement-summary className="crystal-chamfer hidden min-h-72 flex-col gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4">
        <p className="text-xs font-black uppercase tracking-wider text-[var(--sf-brand-text)]">{_(text.achievements)}</p>
        {[[_(text.cards), stats.total], [_(text.reviewed), stats.reviewed], [_(text.learned), stats.learned]].map(([label, value]) => <div key={label as string} className="border-b border-[var(--sf-border)] pb-3"><p className="text-xs text-[var(--sf-text-muted)]">{label}</p><strong className="mt-1 block text-2xl font-black tabular-nums">{formatNumber(value as number)}</strong></div>)}
        <p className="mt-auto text-xs leading-relaxed text-[var(--sf-text-muted)]">{formatNumber(unlockedIds.size)} / {formatNumber(badges.length)} {_(text.unlocked)}</p>
      </aside>
      <article data-featured-achievement data-badge-id={featuredBadge.id} className="crystal-chamfer hidden min-h-72 flex-col overflow-hidden rounded-2xl border border-[var(--sf-brand)]/50 bg-[var(--sf-surface-raised)] p-5 text-center shadow-sm">
        <span className="self-start text-xs font-black uppercase tracking-wider text-[var(--sf-brand-text)]">{featuredBadge.tier}</span><div className="crystal-chamfer-sm mx-auto mt-6 flex size-20 items-center justify-center rounded-full border border-[var(--sf-brand)]/40 bg-[var(--sf-brand)]/15 text-[var(--sf-brand-text)]"><FeaturedIcon size={34} aria-hidden="true" /></div><h4 className="mt-4 text-xl font-black">{featuredBadge.title}</h4><p className="mt-2 text-sm leading-relaxed text-[var(--sf-text-muted)]">{featuredBadge.description}</p>
        <div className="mt-auto pt-6"><div className="flex justify-between text-xs font-bold text-[var(--sf-text-muted)]"><span>{_(text.progress)}</span><span>{formatNumber(featuredBadge.current)} / {formatNumber(featuredBadge.target)} {featuredBadge.unit}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sf-surface-muted)]"><div className="h-full rounded-full bg-[var(--sf-brand)]" style={{ width: `${featuredBadge.progress}%` }} /></div></div>
      </article>
      <div data-achievement-grid className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{badges.map(badge => {
        const Icon = badge.icon;
        const isNewlyUnlocked = celebratingIds.has(badge.id);
        const cardStateClass = badge.state === 'earned'
          ? 'border-[var(--sf-brand)]/50 bg-[var(--sf-surface-raised)] shadow-sm'
          : badge.state === 'locked'
            ? 'border-[var(--sf-border)] bg-[var(--sf-surface)] opacity-70'
            : 'border-[var(--sf-border)] bg-[var(--sf-surface)]';
        return <article key={badge.id} data-badge-id={badge.id} data-newly-unlocked={isNewlyUnlocked || undefined} data-badge-state={badge.state} data-badge-tier={badge.tierKey} className={`crystal-chamfer-sm relative flex flex-col overflow-hidden rounded-2xl border p-4 text-center transition-[border-color,background-color,box-shadow] duration-200 ${isNewlyUnlocked ? 'achievement-newly-unlocked' : ''} ${cardStateClass}`}>
          <div className={`crystal-chamfer-sm mx-auto flex size-14 shrink-0 items-center justify-center rounded-full border ${badge.unlocked ? 'border-[var(--sf-brand)]/40 bg-[var(--sf-brand)]/15 text-[var(--sf-brand-text)]' : 'border-dashed border-[var(--sf-border)] bg-[var(--sf-surface-muted)] text-[var(--sf-text-muted)]'}`}><Icon size={24} aria-hidden="true" /></div>
          <div className="mt-3 min-w-0"><h4 className="truncate text-sm font-black text-[var(--sf-text)]">{badge.title}</h4><span className="mt-1 inline-block text-[10px] font-black uppercase tracking-wide text-[var(--sf-brand-text)]">{badge.tier}</span><p className="mt-2 text-xs leading-relaxed text-[var(--sf-text-muted)]">{badge.description}</p></div>
          <div className="mt-auto pt-4">
            {badge.state === 'earned'
              ? <p className="flex justify-center gap-1.5 text-xs font-bold text-[var(--sf-brand-text)]"><span aria-hidden="true">✓</span>{_(text.unlocked)}</p>
              : badge.state === 'locked'
                ? <p className="flex justify-center gap-1.5 text-[11px] font-bold text-[var(--sf-text-muted)]"><span aria-hidden="true">🔒</span>{_(text.locked)}</p>
                : <>
                    <div className="flex justify-between gap-3 text-[10px] font-bold text-[var(--sf-text-muted)]"><span>{_(text.progress)}</span><span className="tabular-nums">{formatNumber(badge.current)} / {formatNumber(badge.target)} {badge.unit}</span></div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sf-surface-muted)]"><div className="h-full rounded-full bg-[var(--sf-brand)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${badge.progress}%` }} /></div>
                  </>}
          </div>
        </article>;
      })}</div>
    </div>
  </section>;
}
