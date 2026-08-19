import { Award, Flame, Moon, Sparkles, Target, Trophy, Zap } from 'lucide-react';
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
      description: 'Hoàn thành bài học 3 ngày tích cực',
      icon: Flame,
      color: 'from-amber-500 to-orange-500',
      unlocked: activeDays >= 3,
      progress: Math.min(100, Math.round((activeDays / 3) * 100)),
      currentText: `${activeDays} / 3 ngày`,
    },
    {
      id: 'mastery_10',
      title: 'Tập sự Siêu tốc',
      description: 'Luyện tập và ghi nhớ 10 từ vựng đầu tiên',
      icon: Zap,
      color: 'from-cyan-500 to-blue-500',
      unlocked: totalReviewed >= 10,
      progress: Math.min(100, Math.round((totalReviewed / 10) * 100)),
      currentText: `${totalReviewed} / 10 từ`,
    },
    {
      id: 'mastery_50',
      title: 'Học giả Uyên bác',
      description: 'Đạt cấp độ Mastered (Đã thuộc) cho 50 từ vựng',
      icon: Trophy,
      color: 'from-emerald-500 to-teal-500',
      unlocked: totalMastered >= 50,
      progress: Math.min(100, Math.round((totalMastered / 50) * 100)),
      currentText: `${totalMastered} / 50 từ`,
    },
    {
      id: 'xp_100',
      title: 'Kỷ lục Gia',
      description: 'Kiếm được hơn 100 XP trong 1 ngày duy nhất',
      icon: Target,
      color: 'from-purple-500 to-pink-500',
      unlocked: maxSingleDayXp >= 100,
      progress: Math.min(100, Math.round((maxSingleDayXp / 100) * 100)),
      currentText: `${maxSingleDayXp} / 100 XP`,
    },
    {
      id: 'xp_total_500',
      title: 'Bậc thầy Tích lũy',
      description: 'Tích lũy tổng cộng 500 XP từ các hoạt động',
      icon: Award,
      color: 'from-yellow-400 to-amber-600',
      unlocked: totalXp >= 500,
      progress: Math.min(100, Math.round((totalXp / 500) * 100)),
      currentText: `${totalXp} / 500 XP`,
    },
    {
      id: 'night_owl',
      title: 'Cú đêm Học tập',
      description: 'Duy trì học tập và vượt qua các thử thách',
      icon: Moon,
      color: 'from-indigo-500 to-violet-600',
      unlocked: activeDays >= 5,
      progress: Math.min(100, Math.round((activeDays / 5) * 100)),
      currentText: `${activeDays} / 5 ngày`,
    },
  ];

  const unlockedCount = badges.filter(b => b.unlocked).length;

  return (
    <section className="rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="achievements-heading">
      <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="premium-kicker uppercase tracking-[0.14em]">Gamification &amp; Milestones</p>
          <h2 id="achievements-heading" className="mt-2 text-balance text-xl font-black tracking-tight">
            Huy hiệu Thành tựu
          </h2>
          <p className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]">
            Mở khóa các cột mốc danh giá trong quá trình chinh phục từ vựng.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-bold text-cyan-600 dark:text-cyan-300">
          <Sparkles size={14} className="text-cyan-500" />
          <span>{unlockedCount} / {badges.length} Đã mở khóa</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {badges.map(badge => {
          const Icon = badge.icon;
          return (
            <div
              key={badge.id}
              className={`relative overflow-hidden rounded-2xl border p-4 transition-all ${
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
                        ĐẠT
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
                  <span>Tiến độ</span>
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
