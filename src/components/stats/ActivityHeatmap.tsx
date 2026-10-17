import { useMemo } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatNumber } from '../../lib/format';
import type { ReviewActivity } from '../../features/gamification/verifiedGamificationClient';

interface ActivityHeatmapProps {
  entries: Array<{ date: string; XP: number }>;
  reviewActivity?: ReviewActivity;
  rangeDays?: 30 | 182;
  todayKey?: string;
  selectedDate?: string;
  onDaySelect?: (date: string) => void;
}
interface DayCell { dateStr: string; xp: number; available: boolean; outsideRange: boolean; level: 0 | 1 | 2 | 3 | 4; }

const WEEKS_TO_SHOW = 20;
const heatColor = (level: DayCell['level']) => `var(--sf-heat-${level})`;

/** Shared intensity thresholds so every heatmap (this grid, the weekly recap card) paints the same day the same color. */
export const heatmapLevelForXp = (xp: number): DayCell['level'] => (xp === 0 ? 0 : xp < 30 ? 1 : xp < 70 ? 2 : xp < 150 ? 3 : 4);
const heatmapLevelForReviews = (reviews: number): DayCell['level'] => (reviews === 0 ? 0 : reviews < 2 ? 1 : reviews < 4 ? 2 : reviews < 7 ? 3 : 4);

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

export const dayInTimeZone = (now: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export function ActivityHeatmap({ entries, reviewActivity, rangeDays, todayKey, selectedDate, onDaySelect }: ActivityHeatmapProps) {
  const { _, i18n } = useLingui();
  const locale = i18n.locale || 'en';
  const labels = useMemo(() => weekdayLabels(locale), [locale]);
  const { weeks, total, activeDaysCount, monthLabels } = useMemo(() => {
    const xpByDate = new Map<string, number>();
    let total = 0;
    (reviewActivity ? Object.entries(reviewActivity.days).map(([date, day]) => ({ date, XP: day.reviewed })) : entries).forEach(entry => {
      const dateKey = activityDateKey(entry.date);
      xpByDate.set(dateKey, (xpByDate.get(dateKey) ?? 0) + entry.XP);
      if (!reviewActivity) total += entry.XP;
    });
    const now = new Date();
    const today = reviewActivity && todayKey && /^\d{4}-\d{2}-\d{2}$/.test(todayKey)
      ? localDate(todayKey)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const firstDay = firstDayOfWeek(locale);
    const isReviewActivity = Boolean(reviewActivity);
    const endDate = isReviewActivity ? today : new Date(today);
    if (!isReviewActivity) endDate.setDate(today.getDate() + ((firstDay + 6 - today.getDay()) % 7));
    const days = isReviewActivity ? rangeDays ?? 30 : WEEKS_TO_SHOW * 7;
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - days + 1);
    const gridStart = new Date(startDate);
    if (isReviewActivity) gridStart.setDate(startDate.getDate() - ((startDate.getDay() - firstDay + 7) % 7));
    const gridEnd = new Date(endDate);
    if (isReviewActivity) gridEnd.setDate(endDate.getDate() + ((firstDay + 6 - endDate.getDay()) % 7));
    const coverageStartedOn = reviewActivity?.coverageStartedOn;
    const generatedWeeks: DayCell[][] = [];
    const months: Array<string | null> = [];
    const monthFormatter = new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, { month: 'short' });
    let currentWeek: DayCell[] = [];
    let activeDays = 0;
    let previousMonth = -1;
    for (let i = 0; i <= Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000); i++) {
      const current = new Date(gridStart);
      current.setDate(gridStart.getDate() + i);
      const dateKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const inRange = !isReviewActivity || (dateKey >= `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}` && dateKey <= `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`);
      const available = inRange && (!coverageStartedOn || dateKey >= coverageStartedOn);
      const xp = xpByDate.get(dateKey) || 0;
      if (isReviewActivity && available) total += xp;
      if (available && xp > 0) activeDays++;
      currentWeek.push({ dateStr: dateKey, xp, available, outsideRange: !inRange, level: isReviewActivity ? heatmapLevelForReviews(xp) : heatmapLevelForXp(xp) });
      if (currentWeek.length === 7) {
        generatedWeeks.push(currentWeek);
        months.push(current.getMonth() !== previousMonth ? monthFormatter.format(current) : null);
        previousMonth = current.getMonth();
        currentWeek = [];
      }
    }
    if (currentWeek.length) {
      generatedWeeks.push(currentWeek);
      months.push(monthFormatter.format(currentWeek.length ? new Date(`${currentWeek[0].dateStr}T12:00:00`) : startDate));
    }
    const nextMonthLabel = months.findIndex((label, index) => index > 0 && label !== null);
    if (months[0] && nextMonthLabel > 0 && nextMonthLabel <= 2) months[0] = null;
    return { weeks: generatedWeeks, total, activeDaysCount: activeDays, monthLabels: months };
  }, [entries, locale, rangeDays, reviewActivity, todayKey]);
  const isReviewActivity = Boolean(reviewActivity);
  const interactive = Boolean(onDaySelect);

  return <div className="w-full space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-4 text-[var(--sf-text-muted)] font-medium">
        <span><strong className="font-bold text-[var(--sf-text)]">{formatNumber(activeDaysCount)}</strong> {_(msg({ id: 'stats.active-days', message: 'active days' }))}</span>
        <span><strong className="font-bold text-[var(--sf-text)]">{formatNumber(total)}</strong> {isReviewActivity ? _(msg({ id: 'stats.total-reviews', message: 'reviews' })) : _(msg({ id: 'stats.total-xp', message: 'total XP' }))}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--sf-text-muted)]" aria-label={_(msg({ id: 'stats.heatmap-legend', message: 'Less to more study activity' }))}>
        <span>{_(msg({ id: 'stats.less', message: 'Less' }))}</span>
        {([0, 1, 2, 3, 4] as const).map(level => <span key={level} className="inline-block size-3 rounded-[4px] border border-[var(--sf-border)]" style={{ backgroundColor: heatColor(level) }} />)}
        <span>{_(msg({ id: 'stats.more', message: 'More' }))}</span>
      </div>
    </div>
    <div className="w-full overflow-x-auto pb-2 scrollbar-none" tabIndex={0} aria-label={_(msg({ id: 'stats.study-activity', message: 'Study activity' }))}>
      <section className="grid min-w-max grid-cols-[auto_1fr] gap-2" aria-label={_(msg({ id: 'stats.study-activity', message: 'Study activity' }))}>
        <div className="mt-5 flex flex-col gap-1.5 pr-1 text-right text-[10px] font-semibold text-[var(--sf-text-muted)]">
          {labels.map(label => <span key={label} className={`flex items-center justify-end ${interactive ? 'h-6' : 'h-3.5'}`}>{label}</span>)}
        </div>
        <div>
          <div className="mb-1 flex gap-1.5 text-[10px] font-semibold text-[var(--sf-text-muted)]">
            {monthLabels.map((label, index) => <span key={`${label}-${index}`} className="w-3.5 shrink-0 overflow-visible whitespace-nowrap" style={interactive ? { width: 24 } : undefined}>{label}</span>)}
          </div>
          <div className="flex gap-1.5">
            {weeks.map((week, weekIndex) => <div key={weekIndex} className="flex flex-col gap-1.5">
              {week.map(day => {
                const description = day.available ? `${formatHeatmapDate(day.dateStr, locale)}: ${formatNumber(day.xp)} ${isReviewActivity ? _(msg({ id: 'stats.reviews', message: 'reviews' })) : 'XP'}` : `${formatHeatmapDate(day.dateStr, locale)}: ${day.outsideRange ? _(msg({ id: 'stats.outside-selected-range', message: 'Outside selected range' })) : _(msg({ id: 'stats.activity-unavailable', message: 'Activity unavailable before coverage began' }))}`;
                return onDaySelect ? <button key={day.dateStr} type="button" disabled={!day.available} aria-pressed={day.available ? selectedDate === day.dateStr : undefined} aria-label={description} className="flex size-6 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]" title={description} onClick={() => onDaySelect(day.dateStr)}><span className="size-3.5 rounded-[4px] border border-[var(--sf-border)] transition-transform hover:scale-125" style={{ backgroundColor: day.available ? heatColor(day.level) : 'var(--sf-surface-muted)' }} /></button> : <div key={day.dateStr} className="size-3.5 rounded-[4px] border border-[var(--sf-border)] transition-transform hover:scale-125" style={{ backgroundColor: day.available ? heatColor(day.level) : 'var(--sf-surface-muted)' }} title={description}><span className="sr-only">{description}</span></div>;
              })}
            </div>)}
          </div>
        </div>
      </section>
    </div>
  </div>;
}
