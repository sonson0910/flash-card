import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatNumber } from '../../lib/format';
import { ActivityHeatmap, dayInTimeZone, formatHeatmapDate } from './ActivityHeatmap';
import type { ReviewActivity, ReviewActivityDay } from '../../features/gamification/verifiedGamificationClient';

interface StatsChartsProps {
  darkMode: boolean;
  section?: 'primary' | 'secondary' | 'all';
  data: {
    xpChartData: Array<{ date: string; XP: number }>;
    difficultyChart: Array<{ name: string; value: number }>;
    categoryChart: Array<{ name: string; value: number }>;
    categoryChartIsPartial: boolean;
    reviewActivity?: ReviewActivity;
    rewardTimeZone?: string;
  };
}

const chartDate = (value: string, locale: string): string => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, { month: 'short', day: 'numeric' }).format(date);
};

function AccessibleChartTable({ caption, firstColumn, rows, emptyMessage, valueLabel }: { caption: string; firstColumn: string; rows: Array<{ label: string; value: number }>; emptyMessage: string; valueLabel: string }) {
  return <div className="sr-only"><table><caption>{caption}</caption><thead><tr><th scope="col">{firstColumn}</th><th scope="col">{valueLabel}</th></tr></thead><tbody>{rows.length > 0 ? rows.map(row => <tr key={row.label}><td>{row.label}</td><td>{formatNumber(row.value)}</td></tr>) : <tr><td colSpan={2}>{emptyMessage}</td></tr>}</tbody></table></div>;
}

const XP_CHART = { width: 640, height: 240, left: 44, right: 18, top: 16, bottom: 42 } as const;
const emptyReviewDay: ReviewActivityDay = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };
const emptyChartClass = 'flex h-full w-full items-center justify-center font-bold text-[var(--sf-text-muted)]';
const chartGridClass = 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)]';
const primaryChartPanelClass = 'liquid-glass rounded-[28px] border border-[var(--sf-border)] p-4 text-[var(--sf-text)] sm:p-5 shadow-[0_28px_70px_-52px_var(--sf-shadow)]';
const secondaryChartPanelClass = 'liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 text-[var(--sf-text)] sm:p-7 shadow-[0_28px_70px_-52px_var(--sf-shadow)]';
const chartKickerClass = 'premium-kicker uppercase tracking-[0.14em]';
const mutedTextClass = 'text-[var(--sf-text-muted)]';

export function reviewDayInRange(activity: ReviewActivity, date: string, rangeStart: string, today: string): ReviewActivityDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < rangeStart || date < activity.coverageStartedOn || date > today) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return activity.days[date] ?? emptyReviewDay;
}

const text = {
  noHistory: msg({ id: 'stats.no-xp-history', message: 'No XP history yet' }), noData: msg({ id: 'stats.no-data', message: 'No data yet' }),
  learningActivity: msg({ id: 'stats.learning-activity', message: 'Learning activity' }), dailyXp: msg({ id: 'stats.daily-xp', message: 'Account-wide XP and consistency' }), activityDescription: msg({ id: 'stats.activity-description', message: 'XP from completed learning activity across your account.' }), heatmapTitle: msg({ id: 'stats.heatmap-title', message: 'Review activity' }), activityUnavailable: msg({ id: 'stats.review-activity-unavailable', message: 'Review activity is unavailable until coverage begins.' }), again: msg({ id: 'stats.recall-again', message: 'Again' }), hard: msg({ id: 'stats.recall-hard', message: 'Hard' }), good: msg({ id: 'stats.recall-good', message: 'Good' }), easy: msg({ id: 'stats.recall-easy', message: 'Easy' }), dailyXpData: msg({ id: 'stats.daily-xp-data', message: 'Daily XP data' }), date: msg({ id: 'stats.date', message: 'Date' }), value: msg({ id: 'stats.value', message: 'Value' }), dailyXpChart: msg({ id: 'stats.daily-xp-chart', message: 'Daily XP chart' }), currentState: msg({ id: 'stats.current-state', message: 'Current state' }), memoryStrength: msg({ id: 'stats.memory-strength', message: 'Memory strength' }), memoryData: msg({ id: 'stats.memory-data', message: 'Memory strength data' }), memoryStatus: msg({ id: 'stats.memory-status', message: 'Memory status' }), memoryChart: msg({ id: 'stats.memory-chart', message: 'Memory strength chart' }), cards: msg({ id: 'stats.cards', message: 'cards' }), libraryBreakdown: msg({ id: 'stats.library-breakdown', message: 'Library breakdown' }), categoryDistribution: msg({ id: 'stats.category-distribution', message: 'Category distribution' }), partialCategories: msg({ id: 'stats.partial-categories', message: 'Current-page data only; the full library is not scanned.' }), categoryData: msg({ id: 'stats.category-data', message: 'Category distribution data' }), category: msg({ id: 'stats.category', message: 'Category' }), categoryChart: msg({ id: 'stats.category-chart', message: 'Category distribution chart' }), showTop: msg({ id: 'stats.show-top-categories', message: 'Show top 5 categories' }), showAll: msg({ id: 'stats.show-all-categories', message: 'Show all categories' }),
  mastered: msg({ id: 'stats.mastered', message: 'Mastered' }), learning: msg({ id: 'stats.learning', message: 'Learning' }), notReviewed: msg({ id: 'stats.not-reviewed', message: 'Not reviewed' }),
  inspectDay: msg({ id: 'stats.inspect-day', message: 'Inspect a day' }), showRangeTotals: msg({ id: 'stats.show-range-totals', message: 'Show range totals' }), reviews: msg({ id: 'stats.reviews', message: 'reviews' }),
};

const memoryColors: Record<string, string> = {
  Mastered: 'var(--sf-heat-4)',
  Learning: 'var(--sf-heat-3)',
  'Not reviewed': 'var(--sf-heat-1)',
};

function XpChart({ entries, locale, noHistory }: { entries: Array<{ date: string; XP: number }>; locale: string; noHistory: string }) {
  if (entries.length === 0) return <div className={emptyChartClass}>{noHistory}</div>;
  const plotWidth = XP_CHART.width - XP_CHART.left - XP_CHART.right;
  const plotHeight = XP_CHART.height - XP_CHART.top - XP_CHART.bottom;
  const baseline = XP_CHART.top + plotHeight;
  const maximum = Math.max(1, ...entries.map(entry => entry.XP));
  const points = entries.map((entry, index) => ({ ...entry, x: entries.length === 1 ? XP_CHART.left + plotWidth / 2 : XP_CHART.left + (index / (entries.length - 1)) * plotWidth, y: XP_CHART.top + (1 - entry.XP / maximum) * plotHeight }));
  const linePoints = points.map(point => `${point.x},${point.y}`).join(' ');
  const areaPoints = `${XP_CHART.left},${baseline} ${linePoints} ${XP_CHART.left + plotWidth},${baseline}`;
  const labelStride = Math.max(1, Math.ceil(entries.length / 5));
  return <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${XP_CHART.width} ${XP_CHART.height}`} role="presentation" focusable="false">
    <defs><linearGradient id="xp-area-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--sf-brand)" stopOpacity="0.28" /><stop offset="100%" stopColor="var(--sf-brand)" stopOpacity="0" /></linearGradient></defs>
    {[0, 0.25, 0.5, 0.75, 1].map(fraction => { const y = XP_CHART.top + fraction * plotHeight; return <g key={fraction}><line x1={XP_CHART.left} x2={XP_CHART.left + plotWidth} y1={y} y2={y} stroke="var(--sf-border)" strokeDasharray="4 5" /><text x={XP_CHART.left - 8} y={y + 4} textAnchor="end" fill="var(--sf-text-muted)" fontSize="11" fontWeight="600">{formatNumber(Math.round(maximum * (1 - fraction)))}</text></g>; })}
    <polygon data-chart-motion="area" className="chart-area-reveal" points={areaPoints} fill="url(#xp-area-gradient)" />
    <polyline data-chart-motion="line" className="chart-line-reveal" pathLength="1" points={linePoints} fill="none" stroke="var(--sf-brand)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    {points.map((point, index) => <g key={`${point.date}-${index}`}><circle data-xp-hit-area cx={point.x} cy={point.y} r="14" fill="transparent" pointerEvents="all"><title>{`${chartDate(point.date, locale)}: ${formatNumber(point.XP)} XP`}</title></circle><circle data-xp-point cx={point.x} cy={point.y} r="4.5" fill="var(--sf-surface-raised)" stroke="var(--sf-brand)" strokeWidth="3" pointerEvents="none" />{(index % labelStride === 0 || index === points.length - 1) && <text x={point.x} y={XP_CHART.height - 12} textAnchor="middle" fill="var(--sf-text-muted)" fontSize="11" fontWeight="600">{chartDate(point.date, locale)}</text>}</g>)}
  </svg>;
}

function MemoryChart({ entries, noData, cards }: { entries: Array<{ name: string; value: number; color: string }>; noData: string; cards: string }) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
  if (total === 0) return <div className={emptyChartClass}>{noData}</div>;
  let consumed = 0;
  return <div className="grid h-full grid-cols-[minmax(8rem,1fr)_minmax(7rem,auto)] items-center gap-4"><svg className="mx-auto aspect-square h-auto max-h-52 w-full max-w-52" viewBox="0 0 120 120" role="presentation" focusable="false"><circle cx="60" cy="60" r="42" fill="none" stroke="var(--sf-surface-muted)" strokeWidth="18" />{entries.map((entry, index) => { const percentage = Math.max(0, entry.value) / total * 100; const offset = -consumed; consumed += percentage; return <circle key={`${entry.name}-${index}`} data-chart-motion="ring" className="chart-ring-reveal" cx="60" cy="60" r="42" fill="none" pathLength="100" stroke={entry.color} strokeDasharray={`${percentage} ${100 - percentage}`} strokeDashoffset={offset} strokeWidth="18" transform="rotate(-90 60 60)"><title>{`${entry.name}: ${formatNumber(entry.value)}`}</title></circle>; })}<text x="60" y="57" textAnchor="middle" fill="var(--sf-text)" fontSize="18" fontWeight="800">{formatNumber(total)}</text><text x="60" y="72" textAnchor="middle" fill="var(--sf-text-muted)" fontSize="8" fontWeight="600">{cards}</text></svg><ul className="space-y-2 text-xs font-semibold text-[var(--sf-text-muted)]">{entries.map((entry, index) => <li key={`${entry.name}-${index}`} className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} /><span className="min-w-0 break-words">{entry.name}</span><span className="ml-auto tabular-nums text-[var(--sf-text)]">{formatNumber(entry.value)}</span></li>)}</ul></div>;
}

function CategoryChart({ entries, noData, showAll, showTop }: { entries: Array<{ name: string; value: number }>; noData: string; showAll: (count: number) => string; showTop: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (entries.length === 0) return <div className={emptyChartClass}>{noData}</div>;
  const sortedEntries = [...entries].sort((a, b) => b.value - a.value);
  const visibleEntries = isExpanded ? sortedEntries : sortedEntries.slice(0, 5);
  const maximum = Math.max(1, ...sortedEntries.map(entry => entry.value));
  return <div className="flex flex-col justify-center gap-3 py-2">{visibleEntries.map((entry, index) => <div key={`${entry.name}-${index}`} className="grid grid-cols-[minmax(5rem,8rem)_1fr_auto] items-center gap-3 text-xs"><span className="break-words text-right font-semibold text-[var(--sf-text-muted)]">{entry.name}</span><span className="h-5 overflow-hidden rounded-r-md bg-[var(--sf-surface-muted)]"><span data-chart-motion="bar" className="chart-bar-reveal block h-full min-w-0 rounded-r-md bg-[var(--sf-brand)]" style={{ width: `${entry.value > 0 ? Math.max(2, (entry.value / maximum) * 100) : 0}%` }} /></span><span className="min-w-8 text-right font-bold tabular-nums text-[var(--sf-text)]">{formatNumber(entry.value)}</span></div>)}{sortedEntries.length > 5 && <div className="mt-2 flex justify-center border-t border-[var(--sf-border)] pt-3"><button type="button" onClick={() => setIsExpanded(prev => !prev)} className="flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2 text-xs font-bold text-[var(--sf-text)] shadow-xs transition-all hover:border-[var(--sf-brand)] hover:text-[var(--sf-brand-text)] active:scale-95" aria-expanded={isExpanded}><span>{isExpanded ? showTop : showAll(sortedEntries.length)}</span><ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} /></button></div>}</div>;
}

export default function StatsCharts({ data, section = 'all' }: StatsChartsProps) {
  const { _, i18n } = useLingui();
  const locale = i18n.locale || 'en';
  const [reviewRangeDays, setReviewRangeDays] = useState<30 | 182>(182);
  const [selectedReviewDate, setSelectedReviewDate] = useState('');
  const noHistory = _(text.noHistory); const noData = _(text.noData);
  const memoryLabels: Record<string, string> = { Mastered: _(text.mastered), Learning: _(text.learning), 'Not reviewed': _(text.notReviewed) };
  const memoryEntries = data.difficultyChart.map(entry => ({ ...entry, name: memoryLabels[entry.name] ?? entry.name, color: memoryColors[entry.name] ?? 'var(--sf-heat-2)' }));
  let todayKey: string | undefined;
  try { if (data.reviewActivity && data.rewardTimeZone) todayKey = dayInTimeZone(new Date(), data.rewardTimeZone); } catch { /* Activity remains unavailable without the server time zone. */ }
  const rangeStart = todayKey ? new Date(`${todayKey}T12:00:00`) : new Date();
  rangeStart.setHours(0, 0, 0, 0);
  rangeStart.setDate(rangeStart.getDate() - reviewRangeDays + 1);
  const rangeStartKey = [rangeStart.getFullYear(), String(rangeStart.getMonth() + 1).padStart(2, '0'), String(rangeStart.getDate()).padStart(2, '0')].join('-');
  const reviewActivity = data.reviewActivity && todayKey ? data.reviewActivity : undefined;
  const availableStartKey = reviewActivity && reviewActivity.coverageStartedOn > rangeStartKey ? reviewActivity.coverageStartedOn : rangeStartKey;
  const selectedReviewDay = reviewActivity && selectedReviewDate && todayKey ? reviewDayInRange(reviewActivity, selectedReviewDate, rangeStartKey, todayKey) : null;
  const partialCoverage = reviewActivity && reviewActivity.coverageStartedOn > rangeStartKey;
  const recallTotals = Object.entries(reviewActivity?.days ?? {}).filter(([date]) => date >= rangeStartKey && date <= (todayKey ?? '')).reduce((totals, [, day]) => ({ again: totals.again + day.again, hard: totals.hard + day.hard, good: totals.good + day.good, easy: totals.easy + day.easy }), { again: 0, hard: 0, good: 0, easy: 0 });
  const showPrimary = section !== 'secondary';
  const showSecondary = section !== 'primary';
  return <div className={`stats-canvas${section === 'primary' ? ' stats-canvas--primary' : ''}`}>
    {showPrimary && <div className={chartGridClass}>
      <section className={primaryChartPanelClass} aria-labelledby="review-activity-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="review-activity-title" className="text-balance text-xl font-black tracking-tight">{_(text.heatmapTitle)}</h2>{reviewActivity && <div className="inline-flex rounded-xl border border-[var(--sf-border)] p-1" role="group" aria-label={_(text.heatmapTitle)}><button type="button" onClick={() => { setReviewRangeDays(30); setSelectedReviewDate(''); }} aria-pressed={reviewRangeDays === 30} className={`min-h-11 rounded-lg px-3 text-xs font-bold ${reviewRangeDays === 30 ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : ''}`}><span><Trans id="stats.review-range-30-days" message="30 days" /></span></button><button type="button" onClick={() => { setReviewRangeDays(182); setSelectedReviewDate(''); }} aria-pressed={reviewRangeDays === 182} className={`min-h-11 rounded-lg px-3 text-xs font-bold ${reviewRangeDays === 182 ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : ''}`}><span><Trans id="stats.review-range-26-weeks" message="26 weeks" /></span></button></div>}</div>{reviewActivity ? <><ActivityHeatmap entries={[]} reviewActivity={reviewActivity} rangeDays={reviewRangeDays} todayKey={todayKey ?? ''} selectedDate={selectedReviewDate} onDaySelect={setSelectedReviewDate} /><div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs font-semibold text-[var(--sf-text-muted)]"><span className="block">{_(text.inspectDay)}</span><input type="date" min={availableStartKey} max={todayKey} value={selectedReviewDay ? selectedReviewDate : ''} disabled={availableStartKey > (todayKey ?? '')} onChange={event => { const date = event.target.value; setSelectedReviewDate(date && todayKey && reviewDayInRange(reviewActivity, date, rangeStartKey, todayKey) ? date : ''); }} className="mt-1 min-h-11 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-sm text-[var(--sf-text)]" /></label>{selectedReviewDay && <button type="button" onClick={() => setSelectedReviewDate('')} className="min-h-11 rounded-lg border border-[var(--sf-border)] px-3 text-xs font-bold">{_(text.showRangeTotals)}</button>}</div>{selectedReviewDay && <p className="mt-2 text-sm font-semibold" role="status">{formatHeatmapDate(selectedReviewDate, locale)}: {formatNumber(selectedReviewDay.reviewed)} {_(text.reviews)}</p>}<dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><div><dt className={mutedTextClass}>{_(text.again)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).again)}</dd></div><div><dt className={mutedTextClass}>{_(text.hard)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).hard)}</dd></div><div><dt className={mutedTextClass}>{_(text.good)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).good)}</dd></div><div><dt className={mutedTextClass}>{_(text.easy)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).easy)}</dd></div></dl>{partialCoverage && <p className="mt-2 text-xs text-[var(--sf-text-muted)]"><Trans id="stats.review-activity-partial" message="Coverage begins {date}; this range is partial." values={{ date: reviewActivity.coverageStartedOn }} /></p>}</> : <p className="text-sm text-[var(--sf-text-muted)]">{_(text.activityUnavailable)}</p>}</section>
      <section className={primaryChartPanelClass} aria-labelledby="mastery-chart-title"><p className={chartKickerClass}>{_(text.currentState)}</p><h2 id="mastery-chart-title" className="mt-1 text-xl font-black tracking-tight">{_(text.memoryStrength)}</h2><AccessibleChartTable caption={_(text.memoryData)} firstColumn={_(text.memoryStatus)} valueLabel={_(text.value)} rows={memoryEntries.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage={noData} /><div className="mt-2 min-h-44 w-full" role="img" aria-label={_(text.memoryChart)} data-native-chart="memory"><MemoryChart entries={memoryEntries} noData={noData} cards={_(text.cards)} /></div></section>
    </div>}
    {showSecondary && <div className={chartGridClass}>
    <section className={secondaryChartPanelClass} aria-labelledby="xp-chart-title">
      <div className="mb-5"><p className={chartKickerClass}>{_(text.learningActivity)}</p><h2 id="xp-chart-title" className="mt-2 text-balance text-xl font-black tracking-tight">{_(text.dailyXp)}</h2><p className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]">{_(text.activityDescription)}</p></div>
      <AccessibleChartTable caption={_(text.dailyXpData)} firstColumn={_(text.date)} valueLabel={_(text.value)} rows={data.xpChartData.map(entry => ({ label: chartDate(entry.date, locale), value: entry.XP }))} emptyMessage={noHistory} />
      <div className="h-56 w-full sm:h-64" role="img" aria-label={_(text.dailyXpChart)} data-native-chart="xp"><XpChart entries={data.xpChartData} locale={locale} noHistory={noHistory} /></div>
    </section>
      <section className={secondaryChartPanelClass} aria-labelledby="category-chart-title"><p className={chartKickerClass}>{_(text.libraryBreakdown)}</p><h2 id="category-chart-title" className="mt-2 text-xl font-black tracking-tight">{_(text.categoryDistribution)}</h2>{data.categoryChartIsPartial && <p className="mt-1 text-xs leading-5 text-[var(--sf-text-muted)]">{_(text.partialCategories)}</p>}<AccessibleChartTable caption={_(text.categoryData)} firstColumn={_(text.category)} valueLabel={_(text.value)} rows={data.categoryChart.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage={noData} /><div className="mt-4 min-h-52 w-full" role="img" aria-label={_(text.categoryChart)} data-native-chart="category"><CategoryChart entries={data.categoryChart} noData={noData} showTop={_(text.showTop)} showAll={count => `${_(text.showAll)} (${formatNumber(count)})`} /></div></section>
    </div>
    }
  </div>;
}
