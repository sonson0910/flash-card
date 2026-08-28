import { Award, Flame, Moon, Sparkles, Target, Trophy, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';

interface AchievementsMatrixProps {
  stats: LibraryStatsViewModel;
}

interface Badge {
  id: string;
  title: string;
  description: string;
  icon: typeof Trophy;
  color: string;
  unlocked: boolean;
  progress: number; // 0 to 100
  currentText: string;
}

export function findNewlyUnlockedBadgeIds(
  previous: ReadonlySet<string>,
  current: ReadonlySet<string>,
): string[] {
  return [...current].filter(id => !previous.has(id));
}

export function AchievementsMatrix({ stats }: AchievementsMatrixProps) {
  const totalXp = stats.xpChartData.reduce((sum, item) => sum + item.XP, 0);
  const maxSingleDayXp = Math.max(0, ...stats.xpChartData.map(item => item.XP));
  const totalReviewed = stats.reviewed;
  const totalMastered = stats.learned;
  const activeDays = stats.xpChartData.filter(item => item.XP > 0).length;

  const badges: Badge[] = [
    {
      id: 'streak_3',
      title: 'Streak Starter',
      description: 'Complete study sessions on 3 active days',
      icon: Flame,
      color: 'from-amber-500 to-orange-500',
      unlocked: activeDays >= 3,
      progress: Math.min(100, Math.round((activeDays / 3) * 100)),
      currentText: `${activeDays} / 3 days`,
    },
    {
      id: 'mastery_10',
      title: 'Speed Apprentice',
      description: 'Practice and memorize your first 10 words',
      icon: Zap,
      color: 'from-cyan-500 to-blue-500',
      unlocked: totalReviewed >= 10,
      progress: Math.min(100, Math.round((totalReviewed / 10) * 100)),
      currentText: `${totalReviewed} / 10 words`,
    },
    {
      id: 'mastery_50',
      title: 'Erudite Scholar',
      description: 'Reach Mastered status for 50 vocabulary words',
      icon: Trophy,
      color: 'from-emerald-500 to-teal-500',
      unlocked: totalMastered >= 50,
      progress: Math.min(100, Math.round((totalMastered / 50) * 100)),
      currentText: `${totalMastered} / 50 words`,
    },
    {
      id: 'xp_100',
      title: 'Record Breaker',
      description: 'Earn over 100 XP in a single day',
      icon: Target,
      color: 'from-purple-500 to-pink-500',
      unlocked: maxSingleDayXp >= 100,
      progress: Math.min(100, Math.round((maxSingleDayXp / 100) * 100)),
      currentText: `${maxSingleDayXp} / 100 XP`,
    },
    {
      id: 'xp_total_500',
      title: 'Cumulative Master',
      description: 'Accumulate a total of 500 XP from all activities',
      icon: Award,
      color: 'from-yellow-400 to-amber-600',
      unlocked: totalXp >= 500,
      progress: Math.min(100, Math.round((totalXp / 500) * 100)),
      currentText: `${totalXp} / 500 XP`,
    },
    {
      id: 'night_owl',
      title: 'Night Owl Learner',
      description: 'Maintain consistent learning across 5+ active days',
      icon: Moon,
      color: 'from-indigo-500 to-violet-600',
      unlocked: activeDays >= 5,
      progress: Math.min(100, Math.round((activeDays / 5) * 100)),
      currentText: `${activeDays} / 5 days`,
    },
  ];

  const unlockedCount = badges.filter(b => b.unlocked).length;
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
    if (newlyUnlocked.length === 0) return;
    setCelebratingIds(new Set(newlyUnlocked));
    const timeout = globalThis.setTimeout(() => setCelebratingIds(new Set()), 900);
    return () => globalThis.clearTimeout(timeout);
  }, [unlockedSignature]);

  const celebrationMessage = badges
    .filter(badge => celebratingIds.has(badge.id))
    .map(badge => `${badge.title} unlocked`)
    .join('. ');

  return (
    <section className="rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="achievements-heading">
      <span className="sr-only" aria-live="polite">{celebrationMessage}</span>
      <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="premium-kicker uppercase tracking-[0.14em]">Gamification &amp; Milestones</p>
          <h2 id="achievements-heading" className="mt-2 text-balance text-xl font-black tracking-tight">
            Achievement Badges
          </h2>
          <p className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]">
            Unlock prestigious milestones on your vocabulary mastery journey.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-bold text-cyan-600 dark:text-cyan-300">
          <Sparkles size={14} className="text-cyan-500" />
          <span>{unlockedCount} / {badges.length} Unlocked</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {badges.map(badge => {
          const Icon = badge.icon;
          const isNewlyUnlocked = celebratingIds.has(badge.id);
          return (
            <div
              key={badge.id}
              data-newly-unlocked={isNewlyUnlocked || undefined}
              className={`relative overflow-hidden rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] duration-200 ${isNewlyUnlocked ? 'achievement-newly-unlocked' : ''} ${
                badge.unlocked
                  ? 'border-[var(--sf-brand)]/40 bg-[var(--sf-surface-raised)] shadow-sm'
                  : 'border-[var(--sf-border)] bg-[var(--sf-surface)] opacity-75'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-md ${
                    badge.unlocked
                      ? `bg-gradient-to-br ${badge.color} text-white shadow-cyan-500/20`
                      : 'bg-[var(--sf-surface-muted)] text-[var(--sf-text-muted)]'
                  }`}
                >
                  <Icon size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-black text-[var(--sf-text)]">{badge.title}</h3>
                    {badge.unlocked && (
                      <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black text-emerald-600 dark:text-emerald-400">
                        DONE
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--sf-text-muted)] line-clamp-2">
                    {badge.description}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-3.5 space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-[var(--sf-text-muted)]">
                  <span>Progress</span>
                  <span>{badge.currentText}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sf-surface-muted)]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      badge.unlocked
                        ? 'bg-[var(--sf-brand)]'
                        : 'bg-slate-400 dark:bg-slate-600'
                    }`}
                    style={{ width: `${badge.progress}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
