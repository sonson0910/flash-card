import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatNumber } from '../../lib/format';
import { useTheme } from '../../features/theme/ThemeProvider';
import { ActivityHeatmap, dayInTimeZone, formatHeatmapDate } from './ActivityHeatmap';
import './stats-board.css';
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
const chartGridClass = 'stats-grid grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]';
const primaryChartPanelClass = 'stats-panel crystal-chamfer min-w-0 p-4 sm:px-[26px] sm:py-6';
const secondaryChartPanelClass = 'stats-panel crystal-chamfer min-w-0 p-5 sm:px-[26px] sm:py-6';
const panelTitleClass = 'stats-panel-title text-balance';
const panelNoteClass = 'stats-panel-note';
const mutedTextClass = 'text-[var(--sf-text-muted)]';

export function reviewDayInRange(activity: ReviewActivity, date: string, rangeStart: string, today: string): ReviewActivityDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < rangeStart || date < activity.coverageStartedOn || date > today) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return activity.days[date] ?? emptyReviewDay;
}

const text = {
  noHistory: msg({ id: 'stats.no-xp-history', message: 'No XP history yet' }), noData: msg({ id: 'stats.no-data', message: 'No data yet' }),
  activityTitle: msg({ id: 'stats.activity-title', message: 'Activity' }), activityNote26: msg({ id: 'stats.activity-note-26-weeks', message: 'Reviews per day, last 26 weeks' }), activityNote30: msg({ id: 'stats.activity-note-30-days', message: 'Reviews per day, last 30 days' }), masteryTitle: msg({ id: 'stats.mastery-title', message: 'Mastery' }), ringMastered: msg({ id: 'stats.ring-mastered', message: 'mastered' }), recallRate: msg({ id: 'stats.recall-rate', message: 'Recall rate' }), recallRateHint: msg({ id: 'stats.recall-rate-hint', message: 'Share of reviews in this range not marked Again.' }),
  gradeMastered: msg({ id: 'stats.grade-mastered', message: 'Star' }), gradeLearning: msg({ id: 'stats.grade-learning', message: 'Bloom' }), gradeNew: msg({ id: 'stats.grade-new', message: 'Bud' }),
  dailyXp: msg({ id: 'stats.daily-xp', message: 'Account-wide XP and consistency' }), activityDescription: msg({ id: 'stats.activity-description', message: 'XP from completed learning activity across your account.' }), heatmapTitle: msg({ id: 'stats.heatmap-title', message: 'Review activity' }), activityUnavailable: msg({ id: 'stats.review-activity-unavailable', message: 'Review activity is unavailable until coverage begins.' }), again: msg({ id: 'stats.recall-again', message: 'Again' }), hard: msg({ id: 'stats.recall-hard', message: 'Hard' }), good: msg({ id: 'stats.recall-good', message: 'Good' }), easy: msg({ id: 'stats.recall-easy', message: 'Easy' }), dailyXpData: msg({ id: 'stats.daily-xp-data', message: 'Daily XP data' }), date: msg({ id: 'stats.date', message: 'Date' }), value: msg({ id: 'stats.value', message: 'Value' }), dailyXpChart: msg({ id: 'stats.daily-xp-chart', message: 'Daily XP chart' }), memoryData: msg({ id: 'stats.memory-data', message: 'Memory strength data' }), memoryStatus: msg({ id: 'stats.memory-status', message: 'Memory status' }), memoryChart: msg({ id: 'stats.memory-chart', message: 'Memory strength chart' }), libraryBreakdown: msg({ id: 'stats.library-breakdown', message: 'Library breakdown' }), categoryDistribution: msg({ id: 'stats.category-distribution', message: 'Category distribution' }), partialCategories: msg({ id: 'stats.partial-categories', message: 'Current-page data only; the full library is not scanned.' }), categoryData: msg({ id: 'stats.category-data', message: 'Category distribution data' }), category: msg({ id: 'stats.category', message: 'Category' }), categoryChart: msg({ id: 'stats.category-chart', message: 'Category distribution chart' }), showTop: msg({ id: 'stats.show-top-categories', message: 'Show top 5 categories' }), showAll: msg({ id: 'stats.show-all-categories', message: 'Show all categories' }),
  mastered: msg({ id: 'stats.mastered', message: 'Mastered' }), learning: msg({ id: 'stats.learning', message: 'Learning' }), notReviewed: msg({ id: 'stats.not-reviewed', message: 'Not reviewed' }),
  inspectDay: msg({ id: 'stats.inspect-day', message: 'Inspect a day' }), showRangeTotals: msg({ id: 'stats.show-range-totals', message: 'Show range totals' }), reviews: msg({ id: 'stats.reviews', message: 'reviews' }),
};

const memoryColors: Record<string, string> = {
  Mastered: 'var(--st-mastered)',
  Learning: 'var(--st-learning)',
  'Not reviewed': 'var(--st-new)',
};
const memoryKinds: Record<string, 'mastered' | 'learning' | 'new'> = { Mastered: 'mastered', Learning: 'learning', 'Not reviewed': 'new' };

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

interface MemoryEntry { name: string; value: number; color: string; kind?: 'mastered' | 'learning' | 'new'; grade?: string }

const RING = { classic: { size: 150, radius: 62, stroke: 14 }, crystal: { size: 160, radius: 58, stroke: 16 } } as const;

function MemoryChart({ entries, noData, masteredLabel, isCrystal }: { entries: MemoryEntry[]; noData: string; masteredLabel: string; isCrystal: boolean }) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
  if (total === 0) return <div className={emptyChartClass}>{noData}</div>;
  const ring = isCrystal ? RING.crystal : RING.classic;
  const center = ring.size / 2;
  const mastered = Math.max(0, entries.find(entry => entry.kind === 'mastered')?.value ?? 0);
  const masteredPercent = Math.round(mastered / total * 100);
  let consumed = 0;
  return <div className="stats-mastery-body">
    <div className="stats-ring" style={{ width: ring.size, height: ring.size }}>
      <svg className="stats-ring-svg" width={ring.size} height={ring.size} viewBox={`0 0 ${ring.size} ${ring.size}`} role="presentation" focusable="false">
        {isCrystal && <defs><linearGradient id="stats-ring-mastered" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--st-ring-stop-a)' }} /><stop offset="0.5" style={{ stopColor: 'var(--st-ring-stop-b)' }} /><stop offset="1" style={{ stopColor: 'var(--st-ring-stop-c)' }} /></linearGradient></defs>}
        {isCrystal && <polygon className="stats-ring-hex" points={`${center},6 ${ring.size - 16},${center - 37} ${ring.size - 16},${center + 37} ${center},${ring.size - 6} 16,${center + 37} 16,${center - 37}`} fill="none" strokeWidth="1.5" />}
        <circle className="stats-ring-track" cx={center} cy={center} r={ring.radius} fill="none" strokeWidth={ring.stroke} />
        {entries.map((entry, index) => {
          const percentage = Math.max(0, entry.value) / total * 100;
          const offset = -consumed;
          consumed += percentage;
          if (entry.kind === 'new') return null;
          const stroke = isCrystal && entry.kind === 'mastered' ? 'url(#stats-ring-mastered)' : entry.color;
          return <circle key={`${entry.name}-${index}`} data-chart-motion="ring" className="chart-ring-reveal" cx={center} cy={center} r={ring.radius} fill="none" pathLength="100" stroke={stroke} strokeDasharray={`${percentage} ${100 - percentage}`} strokeDashoffset={offset} strokeWidth={ring.stroke} transform={`rotate(-90 ${center} ${center})`}><title>{`${entry.name}: ${formatNumber(entry.value)}`}</title></circle>;
        })}
      </svg>
      <div className="stats-ring-center"><span className="stats-ring-value">{formatNumber(masteredPercent)}<span className="stats-ring-unit">%</span></span><span className="stats-ring-label">{masteredLabel}</span></div>
    </div>
    <ul className="stats-mastery-legend">{entries.map((entry, index) => <li key={`${entry.name}-${index}`} data-kind={entry.kind}>{isCrystal && entry.grade ? <span className="stats-grade-chip">{entry.grade}</span> : <span className="stats-legend-swatch" style={{ backgroundColor: entry.color }} />}<span className="stats-legend-label">{entry.name}</span><span className="stats-legend-value">{formatNumber(entry.value)}</span></li>)}</ul>
  </div>;
}

function CategoryChart({ entries, noData, showAll, showTop }: { entries: Array<{ name: string; value: number }>; noData: string; showAll: (count: number) => string; showTop: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (entries.length === 0) return <div className={emptyChartClass}>{noData}</div>;
  const sortedEntries = [...entries].sort((a, b) => b.value - a.value);
  const visibleEntries = isExpanded ? sortedEntries : sortedEntries.slice(0, 5);
  const maximum = Math.max(1, ...sortedEntries.map(entry => entry.value));
  return <div className="flex flex-col justify-center gap-3 py-2">{visibleEntries.map((entry, index) => <div key={`${entry.name}-${index}`} className="grid grid-cols-[minmax(5rem,8rem)_1fr_auto] items-center gap-3 text-xs"><span className="break-words text-right font-semibold text-[var(--sf-text-muted)]">{entry.name}</span><span className="h-5 overflow-hidden rounded-r-md bg-[var(--sf-surface-muted)]"><span data-chart-motion="bar" className="chart-bar-reveal block h-full min-w-0 rounded-r-md bg-[var(--sf-brand)]" style={{ width: `${entry.value > 0 ? Math.max(2, (entry.value / maximum) * 100) : 0}%` }} /></span><span className="min-w-8 text-right font-bold tabular-nums text-[var(--sf-text)]">{formatNumber(entry.value)}</span></div>)}{sortedEntries.length > 5 && <div className="mt-2 flex justify-center border-t border-[var(--sf-border)] pt-3"><button type="button" onClick={() => setIsExpanded(prev => !prev)} className="flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2 text-xs font-bold text-[var(--sf-text)] shadow-xs transition-colors hover:border-[var(--sf-brand)] hover:text-[var(--sf-brand-text)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none" aria-expanded={isExpanded}><span>{isExpanded ? showTop : showAll(sortedEntries.length)}</span><ChevronDown size={14} className={`transition-transform duration-200 motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`} /></button></div>}</div>;
}

export default function StatsCharts({ data, section = 'all' }: StatsChartsProps) {
  const { _, i18n } = useLingui();
  const { family } = useTheme();
  const isCrystal = family === 'crystal';
  const locale = i18n.locale || 'en';
  const [reviewRangeDays, setReviewRangeDays] = useState<30 | 182>(182);
  const [selectedReviewDate, setSelectedReviewDate] = useState('');
  const noHistory = _(text.noHistory); const noData = _(text.noData);
  const memoryLabels: Record<string, string> = { Mastered: _(text.mastered), Learning: _(text.learning), 'Not reviewed': _(text.notReviewed) };
  const memoryGrades: Record<string, string> = { Mastered: _(text.gradeMastered), Learning: _(text.gradeLearning), 'Not reviewed': _(text.gradeNew) };
  const memoryEntries = data.difficultyChart.map(entry => ({ ...entry, name: memoryLabels[entry.name] ?? entry.name, color: memoryColors[entry.name] ?? 'var(--st-new)', kind: memoryKinds[entry.name], grade: memoryGrades[entry.name] }));
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
  const gradedReviews = recallTotals.again + recallTotals.hard + recallTotals.good + recallTotals.easy;
  const recallPercent = gradedReviews > 0 ? Math.round((gradedReviews - recallTotals.again) / gradedReviews * 100) : null;
  const showPrimary = section !== 'secondary';
  const showSecondary = section !== 'primary';
  const rangeButtonClass = 'stats-range-button min-h-11 px-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
  return <div className={`stats-canvas${section === 'primary' ? ' stats-canvas--primary' : ''}`}>
    {showPrimary && <div className={chartGridClass}>
      <section className={`${primaryChartPanelClass} stats-activity`} aria-labelledby="review-activity-title">
        <div className="stats-panel-head"><h2 id="review-activity-title" className={panelTitleClass}>{_(text.activityTitle)}</h2>{reviewActivity && <span className={panelNoteClass}>{_(reviewRangeDays === 30 ? text.activityNote30 : text.activityNote26)}</span>}{reviewActivity && <div className="stats-range" role="group" aria-label={_(text.heatmapTitle)}><button type="button" onClick={() => { setReviewRangeDays(30); setSelectedReviewDate(''); }} aria-pressed={reviewRangeDays === 30} className={rangeButtonClass}><span><Trans {...msg({ context: 'stats.review-range-30-days', message: '30 days' })} /></span></button><button type="button" onClick={() => { setReviewRangeDays(182); setSelectedReviewDate(''); }} aria-pressed={reviewRangeDays === 182} className={rangeButtonClass}><span><Trans {...msg({ context: 'stats.review-range-26-weeks', message: '26 weeks' })} /></span></button></div>}</div>
        {reviewActivity ? <><ActivityHeatmap entries={[]} reviewActivity={reviewActivity} rangeDays={reviewRangeDays} todayKey={todayKey ?? ''} selectedDate={selectedReviewDate} onDaySelect={setSelectedReviewDate} /><div className="stats-inspect"><label className="stats-inspect-label"><span className="block">{_(text.inspectDay)}</span><input type="date" min={availableStartKey} max={todayKey} value={selectedReviewDay ? selectedReviewDate : ''} disabled={availableStartKey > (todayKey ?? '')} onChange={event => { const date = event.target.value; setSelectedReviewDate(date && todayKey && reviewDayInRange(reviewActivity, date, rangeStartKey, todayKey) ? date : ''); }} className="glass-field stats-inspect-input mt-1 min-h-11 px-3 focus-visible:outline-2 focus-visible:outline-offset-2" /></label>{selectedReviewDay && <button type="button" onClick={() => setSelectedReviewDate('')} className="stats-quiet-button min-h-11 px-3 focus-visible:outline-2 focus-visible:outline-offset-2">{_(text.showRangeTotals)}</button>}<dl className="stats-recall grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className={mutedTextClass}>{_(text.again)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).again)}</dd></div><div><dt className={mutedTextClass}>{_(text.hard)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).hard)}</dd></div><div><dt className={mutedTextClass}>{_(text.good)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).good)}</dd></div><div><dt className={mutedTextClass}>{_(text.easy)}</dt><dd className="font-bold tabular-nums">{formatNumber((selectedReviewDay ?? recallTotals).easy)}</dd></div></dl></div>{selectedReviewDay && <p className="stats-selected-day" role="status">{formatHeatmapDate(selectedReviewDate, locale)}: {formatNumber(selectedReviewDay.reviewed)} {_(text.reviews)}</p>}{partialCoverage && <p className="stats-footnote"><Trans {...msg({ context: 'stats.review-activity-partial', message: 'Coverage begins {date}; this range is partial.' })} values={{ date: reviewActivity.coverageStartedOn }} /></p>}</> : <p className="stats-footnote">{_(text.activityUnavailable)}</p>}</section>
      <section className={`${primaryChartPanelClass} stats-mastery`} aria-labelledby="mastery-chart-title"><h2 id="mastery-chart-title" className={panelTitleClass}>{_(text.masteryTitle)}</h2><AccessibleChartTable caption={_(text.memoryData)} firstColumn={_(text.memoryStatus)} valueLabel={_(text.value)} rows={memoryEntries.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage={noData} /><div className="stats-mastery-chart min-h-44 w-full" role="img" aria-label={_(text.memoryChart)} data-native-chart="memory"><MemoryChart entries={memoryEntries} noData={noData} masteredLabel={_(text.ringMastered)} isCrystal={isCrystal} /></div>{recallPercent !== null && <dl className="stats-mastery-foot"><div className="stats-mastery-fact crystal-chamfer-sm" title={_(text.recallRateHint)}><dt>{_(text.recallRate)}</dt><dd>{formatNumber(recallPercent)}%</dd></div></dl>}</section>
    </div>}
    {showSecondary && <div className={chartGridClass}>
    <section className={secondaryChartPanelClass} aria-labelledby="xp-chart-title">
      <div className="stats-panel-head stats-panel-head--stack"><h2 id="xp-chart-title" className={panelTitleClass}>{_(text.dailyXp)}</h2><p className={panelNoteClass}>{_(text.activityDescription)}</p></div>
      <AccessibleChartTable caption={_(text.dailyXpData)} firstColumn={_(text.date)} valueLabel={_(text.value)} rows={data.xpChartData.map(entry => ({ label: chartDate(entry.date, locale), value: entry.XP }))} emptyMessage={noHistory} />
      <div className="mt-4 h-56 w-full sm:h-64" role="img" aria-label={_(text.dailyXpChart)} data-native-chart="xp"><XpChart entries={data.xpChartData} locale={locale} noHistory={noHistory} /></div>
    </section>
      <section className={secondaryChartPanelClass} aria-labelledby="category-chart-title"><div className="stats-panel-head stats-panel-head--stack"><h2 id="category-chart-title" className={panelTitleClass}>{_(text.categoryDistribution)}</h2><p className={panelNoteClass}>{_(text.libraryBreakdown)}</p></div>{data.categoryChartIsPartial && <p className="stats-footnote">{_(text.partialCategories)}</p>}<AccessibleChartTable caption={_(text.categoryData)} firstColumn={_(text.category)} valueLabel={_(text.value)} rows={data.categoryChart.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage={noData} /><div className="mt-4 min-h-52 w-full" role="img" aria-label={_(text.categoryChart)} data-native-chart="category"><CategoryChart entries={data.categoryChart} noData={noData} showTop={_(text.showTop)} showAll={count => `${_(text.showAll)} (${formatNumber(count)})`} /></div></section>
    </div>
    }
  </div>;
}
