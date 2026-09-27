import { Award, Flame, Moon, Sparkles, Star, Target, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { formatNumber } from '../../lib/format';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';

interface AchievementsMatrixProps { stats: LibraryStatsViewModel; }
interface Badge { id: string; title: string; description: string; tier: string; icon: typeof Trophy; unlocked: boolean; progress: number; current: number; target: number; unit: string; }

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
  budRoutine: msg({ id: 'stats.bud-routine', message: 'Bud routine' }), budRoutineDescription: msg({ id: 'stats.bud-routine-description', message: 'Give your study habit three active days.' }),
  bloomingRecall: msg({ id: 'stats.blooming-recall', message: 'Blooming recall' }), bloomingRecallDescription: msg({ id: 'stats.blooming-recall-description', message: 'Help ten words settle into memory.' }),
  starKeeper: msg({ id: 'stats.star-keeper', message: 'Star keeper' }), starKeeperDescription: msg({ id: 'stats.star-keeper-description', message: 'Help fifty words shine as mastered.' }),
  brightStudyDay: msg({ id: 'stats.bloom-day', message: 'Bright study day' }), brightStudyDayDescription: msg({ id: 'stats.bloom-day-description', message: 'Gather 100 XP in one day of practice.' }),
  growingCollection: msg({ id: 'stats.star-collection', message: 'Growing collection' }), growingCollectionDescription: msg({ id: 'stats.star-collection-description', message: 'Collect 500 XP from your study sessions.' }),
  gentleNightStudy: msg({ id: 'stats.bud-night-study', message: 'Gentle night study' }), gentleNightStudyDescription: msg({ id: 'stats.bud-night-study-description', message: 'Return for five active study days.' }),
  studyMilestones: msg({ id: 'stats.study-milestones', message: 'Study milestones' }), wordGarden: msg({ id: 'stats.word-garden', message: 'Your word garden' }), wordGardenDescription: msg({ id: 'stats.word-garden-description', message: 'Small study sessions grow into lasting memory.' }),
};

export function findNewlyUnlockedBadgeIds(previous: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  return [...current].filter(id => !previous.has(id));
}

/** Localized copy for each badge, keyed by the same id `computeAchievementBadgeStats` returns. */
export const achievementBadgeCopy: Record<AchievementBadgeId, {
  title: ReturnType<typeof msg>; description: ReturnType<typeof msg>; tier: ReturnType<typeof msg>; icon: typeof Trophy; unit: ReturnType<typeof msg> | 'XP';
}> = {
  streak_3: { title: text.budRoutine, description: text.budRoutineDescription, tier: text.bud, icon: Flame, unit: text.days },
  mastery_10: { title: text.bloomingRecall, description: text.bloomingRecallDescription, tier: text.bloom, icon: Sparkles, unit: text.words },
  mastery_50: { title: text.starKeeper, description: text.starKeeperDescription, tier: text.star, icon: Trophy, unit: text.words },
  xp_100: { title: text.brightStudyDay, description: text.brightStudyDayDescription, tier: text.bloom, icon: Target, unit: 'XP' },
  xp_total_500: { title: text.growingCollection, description: text.growingCollectionDescription, tier: text.star, icon: Award, unit: 'XP' },
  night_owl: { title: text.gentleNightStudy, description: text.gentleNightStudyDescription, tier: text.bud, icon: Moon, unit: text.days },
};

export function AchievementsMatrix({ stats }: AchievementsMatrixProps) {
  const { _ } = useLingui();
  const badgeStats = computeAchievementBadgeStats(stats);
  const badges: Badge[] = badgeStats.map(stat => {
    const copy = achievementBadgeCopy[stat.id];
    return {
      id: stat.id,
      title: _(copy.title),
      description: _(copy.description),
      tier: _(copy.tier),
      icon: copy.icon,
      unlocked: stat.unlocked,
      progress: stat.progress,
      current: stat.current,
      target: stat.target,
      unit: copy.unit === 'XP' ? 'XP' : _(copy.unit),
    };
  });
  const unlockedIds = new Set(badges.filter(badge => badge.unlocked).map(badge => badge.id));
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
  return <section className="achievements-canvas liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 text-[var(--sf-text)] sm:p-7 shadow-[0_28px_70px_-52px_var(--sf-shadow)]" aria-labelledby="achievements-heading">
    <span className="sr-only" aria-live="polite">{celebrationMessage}</span>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="premium-kicker uppercase tracking-[0.14em]">{_(text.studyMilestones)}</p><h2 id="achievements-heading" className="mt-2 text-balance text-2xl font-black tracking-tight">{_(text.wordGarden)}</h2><p className="mt-1 max-w-2xl text-sm text-[var(--sf-text-muted)]">{_(text.wordGardenDescription)}</p></div><div className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-1.5 text-xs font-bold text-[var(--sf-text)] sm:self-auto"><Star size={14} className="text-[var(--sf-brand-text)]" aria-hidden="true" /><span>{formatNumber(unlockedIds.size)} / {formatNumber(badges.length)} {_(text.unlocked)}</span></div></div>
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">{badges.map(badge => { const Icon = badge.icon; const isNewlyUnlocked = celebratingIds.has(badge.id); return <article key={badge.id} data-newly-unlocked={isNewlyUnlocked || undefined} className={`relative overflow-hidden rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] duration-200 ${isNewlyUnlocked ? 'achievement-newly-unlocked' : ''} ${badge.unlocked ? 'border-[var(--sf-brand)]/50 bg-[var(--sf-surface-raised)] shadow-sm' : 'border-[var(--sf-border)] bg-[var(--sf-surface)]'}`}><div className="flex items-start gap-3.5"><div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border ${badge.unlocked ? 'border-[var(--sf-brand)]/40 bg-[var(--sf-brand)]/15 text-[var(--sf-brand-text)]' : 'border-[var(--sf-border)] bg-[var(--sf-surface-muted)] text-[var(--sf-text-muted)]'}`}><Icon size={23} aria-hidden="true" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black text-[var(--sf-text)]">{badge.title}</h3><span className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[var(--sf-text-muted)]">{badge.tier}</span></div><p className="mt-1 text-xs leading-relaxed text-[var(--sf-text-muted)]">{badge.description}</p></div></div><div className="mt-4 space-y-1.5"><div className="flex justify-between gap-3 text-[10px] font-bold text-[var(--sf-text-muted)]"><span>{_(text.progress)}</span><span className="tabular-nums">{formatNumber(badge.current)} / {formatNumber(badge.target)} {badge.unit}</span></div><div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sf-surface-muted)]"><div className="h-full rounded-full bg-[var(--sf-brand)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${badge.progress}%` }} /></div></div></article>; })}</div>
  </section>;
}
