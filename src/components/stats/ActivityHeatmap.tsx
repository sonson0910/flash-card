import { useMemo } from 'react';

interface ActivityHeatmapProps {
  entries: Array<{ date: string; XP: number }>;
}

interface DayCell {
  dateStr: string;
  xp: number;
  level: 0 | 1 | 2 | 3 | 4;
}

const WEEKS_TO_SHOW = 20; // Last 20 weeks (~5 months)

export function ActivityHeatmap({ entries }: ActivityHeatmapProps) {
  const { weeks, totalYearXp, maxDailyXp, activeDaysCount } = useMemo(() => {
    const xpByDate = new Map<string, number>();
    let total = 0;
    let max = 0;

    entries.forEach(entry => {
      // Normalize date format if needed (e.g. YYYY-MM-DD)
      xpByDate.set(entry.date, (xpByDate.get(entry.date) ?? 0) + entry.XP);
      total += entry.XP;
      if (entry.XP > max) max = entry.XP;
    });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Find the end of the current week (Saturday = 6 or Sunday = 0)
    const dayOfWeek = today.getDay(); // 0 is Sun, 1 is Mon...
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + (6 - dayOfWeek));

    const totalDays = WEEKS_TO_SHOW * 7;
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - totalDays + 1);

    const generatedWeeks: DayCell[][] = [];
    let currentWeek: DayCell[] = [];
    let activeDays = 0;

    for (let i = 0; i < totalDays; i++) {
      const current = new Date(startDate);
      current.setDate(startDate.getDate() + i);

      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;

      const xp = xpByDate.get(dateKey) || 0;
      if (xp > 0) activeDays++;

      let level: 0 | 1 | 2 | 3 | 4 = 0;
      if (xp > 0) {
        if (xp < 30) level = 1;
        else if (xp < 70) level = 2;
        else if (xp < 150) level = 3;
        else level = 4;
      }

      currentWeek.push({
        dateStr: dateKey,
        xp,
        level,
      });

      if (currentWeek.length === 7) {
        generatedWeeks.push(currentWeek);
        currentWeek = [];
      }
    }

    return {
      weeks: generatedWeeks,
      totalYearXp: total,
      maxDailyXp: max,
      activeDaysCount: activeDays,
    };
  }, [entries]);

  const levelClasses: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: 'bg-[var(--sf-surface-muted)] border-transparent',
    1: 'bg-cyan-500/25 border-cyan-400/20 dark:bg-cyan-900/40',
    2: 'bg-cyan-500/50 border-cyan-400/30 dark:bg-cyan-700/60',
    3: 'bg-cyan-500 border-cyan-300/40 text-white shadow-xs',
    4: 'bg-[var(--sf-brand)] border-cyan-200 text-white shadow-sm shadow-cyan-500/30 ring-1 ring-cyan-400/30',
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 text-[var(--sf-text-muted)] font-medium">
          <span><strong className="font-bold text-[var(--sf-text)]">{activeDaysCount}</strong> active days</span>
          <span><strong className="font-bold text-[var(--sf-text)]">{totalYearXp.toLocaleString()}</strong> total XP</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--sf-text-muted)]">
          <span>Less</span>
          <span className="inline-block size-3 rounded-xs bg-[var(--sf-surface-muted)]" />
          <span className="inline-block size-3 rounded-xs bg-cyan-500/25 dark:bg-cyan-900/40" />
          <span className="inline-block size-3 rounded-xs bg-cyan-500/50 dark:bg-cyan-700/60" />
          <span className="inline-block size-3 rounded-xs bg-cyan-500" />
          <span className="inline-block size-3 rounded-xs bg-[var(--sf-brand)] shadow-xs" />
          <span>More</span>
        </div>
      </div>

      <div className="w-full overflow-x-auto pb-2 scrollbar-none">
        <div className="flex gap-1.5 min-w-max">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1.5">
              {week.map(day => (
                <div
                  key={day.dateStr}
                  className={`size-3.5 rounded-[4px] border transition-transform hover:scale-125 cursor-pointer ${levelClasses[day.level]}`}
                  title={`${day.dateStr}: ${day.xp} XP earned`}
                  aria-label={`${day.dateStr}: ${day.xp} XP`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
