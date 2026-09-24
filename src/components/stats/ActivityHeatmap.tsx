import { useMemo } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatNumber } from '../../lib/format';

interface ActivityHeatmapProps { entries: Array<{ date: string; XP: number }>; }
interface DayCell { dateStr: string; xp: number; level: 0 | 1 | 2 | 3 | 4; }

const WEEKS_TO_SHOW = 20;
const heatColor = (level: DayCell['level']) => `var(--sf-heat-${level})`;

const activityDateKey = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const localDate = (dateKey: string): Date => new Date(`${dateKey}T12:00:00`);

export const firstDayOfWeek = (locale: string): number => {
  const supportedLocale = locale === 'pseudo' ? 'en' : locale;
  try {
    const weekInfo = (new Intl.Locale(supportedLocale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } }).getWeekInfo?.();
    if (weekInfo) return weekInfo.firstDay % 7;
  } catch { /* Use the documented fallback for invalid or unavailable locales. */ }
  return supportedLocale === 'en-US' || /^(ja|ko)(-|$)/i.test(supportedLocale) ? 0 : 1;
};

export const weekdayLabels = (locale: string): string[] => {
  const firstDay = firstDayOfWeek(locale);
  const sunday = new Date(2026, 0, 4);
  const formatter = new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + ((firstDay + index) % 7));
    return formatter.format(date);
  });
};

export const formatHeatmapDate = (dateKey: string, locale: string): string => new Intl.DateTimeFormat(
  locale === 'pseudo' ? 'en' : locale,
  { dateStyle: 'medium' },
).format(localDate(dateKey));

export function ActivityHeatmap({ entries }: ActivityHeatmapProps) {
  const { _, i18n } = useLingui();
  const locale = i18n.locale || 'en';
  const labels = useMemo(() => weekdayLabels(locale), [locale]);
  const { weeks, totalYearXp, activeDaysCount, monthLabels } = useMemo(() => {
    const xpByDate = new Map<string, number>();
    let total = 0;
    entries.forEach(entry => {
      const dateKey = activityDateKey(entry.date);
      xpByDate.set(dateKey, (xpByDate.get(dateKey) ?? 0) + entry.XP);
      total += entry.XP;
    });
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const firstDay = firstDayOfWeek(locale);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + ((firstDay + 6 - today.getDay()) % 7));
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - WEEKS_TO_SHOW * 7 + 1);
    const generatedWeeks: DayCell[][] = [];
    const months: Array<string | null> = [];
    const monthFormatter = new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, { month: 'short' });
    let currentWeek: DayCell[] = [];
    let activeDays = 0;
    let previousMonth = -1;
    for (let i = 0; i < WEEKS_TO_SHOW * 7; i++) {
      const current = new Date(startDate);
      current.setDate(startDate.getDate() + i);
      const dateKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const xp = xpByDate.get(dateKey) || 0;
      if (xp > 0) activeDays++;
      currentWeek.push({ dateStr: dateKey, xp, level: xp === 0 ? 0 : xp < 30 ? 1 : xp < 70 ? 2 : xp < 150 ? 3 : 4 });
      if (currentWeek.length === 7) {
        generatedWeeks.push(currentWeek);
        months.push(current.getMonth() !== previousMonth ? monthFormatter.format(current) : null);
        previousMonth = current.getMonth();
        currentWeek = [];
      }
    }
    return { weeks: generatedWeeks, totalYearXp: total, activeDaysCount: activeDays, monthLabels: months };
  }, [entries, locale]);

  return <div className="w-full space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-4 text-[var(--sf-text-muted)] font-medium">
        <span><strong className="font-bold text-[var(--sf-text)]">{formatNumber(activeDaysCount)}</strong> {_(msg({ id: 'stats.active-days', message: 'active days' }))}</span>
        <span><strong className="font-bold text-[var(--sf-text)]">{formatNumber(totalYearXp)}</strong> {_(msg({ id: 'stats.total-xp', message: 'total XP' }))}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--sf-text-muted)]" aria-label={_(msg({ id: 'stats.heatmap-legend', message: 'Less to more study activity' }))}>
        <span>{_(msg({ id: 'stats.less', message: 'Less' }))}</span>
        {([0, 1, 2, 3, 4] as const).map(level => <span key={level} className="inline-block size-3 rounded-xs border border-[var(--sf-border)]" style={{ backgroundColor: heatColor(level) }} />)}
        <span>{_(msg({ id: 'stats.more', message: 'More' }))}</span>
      </div>
    </div>
    <div className="w-full overflow-x-auto pb-2 scrollbar-none" tabIndex={0} aria-label={_(msg({ id: 'stats.study-activity', message: 'Study activity' }))}>
      <section className="grid min-w-max grid-cols-[auto_1fr] gap-2" aria-label={_(msg({ id: 'stats.study-activity', message: 'Study activity' }))}>
        <div className="mt-5 flex flex-col gap-1.5 pr-1 text-right text-[10px] font-semibold text-[var(--sf-text-muted)]">
          {labels.map(label => <span key={label} className="flex h-3.5 items-center justify-end">{label}</span>)}
        </div>
        <div>
          <div className="mb-1 flex gap-1.5 text-[10px] font-semibold text-[var(--sf-text-muted)]">
            {monthLabels.map((label, index) => <span key={`${label}-${index}`} className="w-3.5 shrink-0 overflow-visible whitespace-nowrap">{label}</span>)}
          </div>
          <div className="flex gap-1.5">
            {weeks.map((week, weekIndex) => <div key={weekIndex} className="flex flex-col gap-1.5">
              {week.map(day => <div key={day.dateStr} className="size-3.5 rounded-[4px] border border-[var(--sf-border)] transition-transform hover:scale-125" style={{ backgroundColor: heatColor(day.level) }} title={`${formatHeatmapDate(day.dateStr, locale)}: ${formatNumber(day.xp)} XP`}><span className="sr-only">{`${formatHeatmapDate(day.dateStr, locale)}: ${formatNumber(day.xp)} XP`}</span></div>)}
            </div>)}
          </div>
        </div>
      </section>
    </div>
  </div>;
}
