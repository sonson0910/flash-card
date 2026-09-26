import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatNumber } from '../../lib/format';
import { ActivityHeatmap } from './ActivityHeatmap';

interface StatsChartsProps {
  darkMode: boolean;
  data: {
    xpChartData: Array<{ date: string; XP: number }>;
    difficultyChart: Array<{ name: string; value: number }>;
    categoryChart: Array<{ name: string; value: number }>;
    categoryChartIsPartial: boolean;
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
const text = {
  noHistory: msg({ id: 'stats.no-xp-history', message: 'No XP history yet' }), noData: msg({ id: 'stats.no-data', message: 'No data yet' }),
  learningActivity: msg({ id: 'stats.learning-activity', message: 'Learning activity' }), dailyXp: msg({ id: 'stats.daily-xp', message: 'Daily XP and consistency' }), activityDescription: msg({ id: 'stats.activity-description', message: 'XP from completed learning activity.' }), heatmapTitle: msg({ id: 'stats.heatmap-title', message: 'Study heatmap · recent 20 weeks' }), dailyXpData: msg({ id: 'stats.daily-xp-data', message: 'Daily XP data' }), date: msg({ id: 'stats.date', message: 'Date' }), value: msg({ id: 'stats.value', message: 'Value' }), dailyXpChart: msg({ id: 'stats.daily-xp-chart', message: 'Daily XP chart' }), currentState: msg({ id: 'stats.current-state', message: 'Current state' }), memoryStrength: msg({ id: 'stats.memory-strength', message: 'Memory strength' }), memoryData: msg({ id: 'stats.memory-data', message: 'Memory strength data' }), memoryStatus: msg({ id: 'stats.memory-status', message: 'Memory status' }), memoryChart: msg({ id: 'stats.memory-chart', message: 'Memory strength chart' }), cards: msg({ id: 'stats.cards', message: 'cards' }), libraryBreakdown: msg({ id: 'stats.library-breakdown', message: 'Library breakdown' }), categoryDistribution: msg({ id: 'stats.category-distribution', message: 'Category distribution' }), partialCategories: msg({ id: 'stats.partial-categories', message: 'Current-page data only; the full library is not scanned.' }), categoryData: msg({ id: 'stats.category-data', message: 'Category distribution data' }), category: msg({ id: 'stats.category', message: 'Category' }), categoryChart: msg({ id: 'stats.category-chart', message: 'Category distribution chart' }), showTop: msg({ id: 'stats.show-top-categories', message: 'Show top 5 categories' }), showAll: msg({ id: 'stats.show-all-categories', message: 'Show all categories' }),
  mastered: msg({ id: 'stats.mastered', message: 'Mastered' }), learning: msg({ id: 'stats.learning', message: 'Learning' }), notReviewed: msg({ id: 'stats.not-reviewed', message: 'Not reviewed' }),
};

const memoryColors: Record<string, string> = {
  Mastered: 'var(--sf-heat-4)',
  Learning: 'var(--sf-heat-3)',
  'Not reviewed': 'var(--sf-heat-1)',
};

function XpChart({ entries, locale, noHistory }: { entries: Array<{ date: string; XP: number }>; locale: string; noHistory: string }) {
  if (entries.length === 0) return <div className="flex h-full w-full items-center justify-center font-bold text-[var(--sf-text-muted)]">{noHistory}</div>;
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
  if (total === 0) return <div className="flex h-full w-full items-center justify-center font-bold text-[var(--sf-text-muted)]">{noData}</div>;
  let consumed = 0;
  return <div className="grid h-full grid-cols-[minmax(8rem,1fr)_minmax(7rem,auto)] items-center gap-4"><svg className="mx-auto aspect-square h-auto max-h-52 w-full max-w-52" viewBox="0 0 120 120" role="presentation" focusable="false"><circle cx="60" cy="60" r="42" fill="none" stroke="var(--sf-surface-muted)" strokeWidth="18" />{entries.map((entry, index) => { const percentage = Math.max(0, entry.value) / total * 100; const offset = -consumed; consumed += percentage; return <circle key={`${entry.name}-${index}`} data-chart-motion="ring" className="chart-ring-reveal" cx="60" cy="60" r="42" fill="none" pathLength="100" stroke={entry.color} strokeDasharray={`${percentage} ${100 - percentage}`} strokeDashoffset={offset} strokeWidth="18" transform="rotate(-90 60 60)"><title>{`${entry.name}: ${formatNumber(entry.value)}`}</title></circle>; })}<text x="60" y="57" textAnchor="middle" fill="var(--sf-text)" fontSize="18" fontWeight="800">{formatNumber(total)}</text><text x="60" y="72" textAnchor="middle" fill="var(--sf-text-muted)" fontSize="8" fontWeight="600">{cards}</text></svg><ul className="space-y-2 text-xs font-semibold text-[var(--sf-text-muted)]">{entries.map((entry, index) => <li key={`${entry.name}-${index}`} className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} /><span className="min-w-0 break-words">{entry.name}</span><span className="ml-auto tabular-nums text-[var(--sf-text)]">{formatNumber(entry.value)}</span></li>)}</ul></div>;
}

function CategoryChart({ entries, noData, showAll, showTop }: { entries: Array<{ name: string; value: number }>; noData: string; showAll: (count: number) => string; showTop: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (entries.length === 0) return <div className="flex h-full w-full items-center justify-center font-bold text-[var(--sf-text-muted)]">{noData}</div>;
  const sortedEntries = [...entries].sort((a, b) => b.value - a.value);
  const visibleEntries = isExpanded ? sortedEntries : sortedEntries.slice(0, 5);
  const maximum = Math.max(1, ...sortedEntries.map(entry => entry.value));
  return <div className="flex flex-col justify-center gap-3 py-2">{visibleEntries.map((entry, index) => <div key={`${entry.name}-${index}`} className="grid grid-cols-[minmax(5rem,8rem)_1fr_auto] items-center gap-3 text-xs"><span className="break-words text-right font-semibold text-[var(--sf-text-muted)]">{entry.name}</span><span className="h-5 overflow-hidden rounded-r-md bg-[var(--sf-surface-muted)]"><span data-chart-motion="bar" className="chart-bar-reveal block h-full min-w-0 rounded-r-md bg-[var(--sf-brand)]" style={{ width: `${entry.value > 0 ? Math.max(2, (entry.value / maximum) * 100) : 0}%` }} /></span><span className="min-w-8 text-right font-bold tabular-nums text-[var(--sf-text)]">{formatNumber(entry.value)}</span></div>)}{sortedEntries.length > 5 && <div className="mt-2 flex justify-center border-t border-[var(--sf-border)] pt-3"><button type="button" onClick={() => setIsExpanded(prev => !prev)} className="flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2 text-xs font-bold text-[var(--sf-text)] shadow-xs transition-all hover:border-[var(--sf-brand)] hover:text-[var(--sf-brand-text)] active:scale-95" aria-expanded={isExpanded}><span>{isExpanded ? showTop : showAll(sortedEntries.length)}</span><ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} /></button></div>}</div>;
}

export default function StatsCharts({ data }: StatsChartsProps) {
  const { _, i18n } = useLingui();
  const locale = i18n.locale || 'en';
  const noHistory = _(text.noHistory); const noData = _(text.noData);
  const memoryLabels: Record<string, string> = { Mastered: _(text.mastered), Learning: _(text.learning), 'Not reviewed': _(text.notReviewed) };
  const memoryEntries = data.difficultyChart.map(entry => ({ ...entry, name: memoryLabels[entry.name] ?? entry.name, color: memoryColors[entry.name] ?? 'var(--sf-heat-2)' }));
  return <div className="stats-canvas">
    <section className="liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 text-[var(--sf-text)] sm:p-7 shadow-[0_28px_70px_-52px_var(--sf-shadow)]" aria-labelledby="xp-chart-title">
      <div className="mb-5"><p className="premium-kicker uppercase tracking-[0.14em]">{_(text.learningActivity)}</p><h2 id="xp-chart-title" className="mt-2 text-balance text-xl font-black tracking-tight">{_(text.dailyXp)}</h2><p className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]">{_(text.activityDescription)}</p></div>
      <div className="mb-6 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 shadow-xs"><p className="mb-3 text-xs font-black uppercase tracking-[0.12em] text-[var(--sf-text-muted)]">{_(text.heatmapTitle)}</p><ActivityHeatmap entries={data.xpChartData} /></div>
      <AccessibleChartTable caption={_(text.dailyXpData)} firstColumn={_(text.date)} valueLabel={_(text.value)} rows={data.xpChartData.map(entry => ({ label: chartDate(entry.date, locale), value: entry.XP }))} emptyMessage={noHistory} />
      <div className="h-56 w-full sm:h-64" role="img" aria-label={_(text.dailyXpChart)} data-native-chart="xp"><XpChart entries={data.xpChartData} locale={locale} noHistory={noHistory} /></div>
    </section>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)]">
      <section className="liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 text-[var(--sf-text)] sm:p-7 shadow-[0_28px_70px_-52px_var(--sf-shadow)]" aria-labelledby="mastery-chart-title"><p className="premium-kicker uppercase tracking-[0.14em]">{_(text.currentState)}</p><h2 id="mastery-chart-title" className="mt-2 text-xl font-black tracking-tight">{_(text.memoryStrength)}</h2><AccessibleChartTable caption={_(text.memoryData)} firstColumn={_(text.memoryStatus)} valueLabel={_(text.value)} rows={memoryEntries.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage={noData} /><div className="mt-3 min-h-52 w-full" role="img" aria-label={_(text.memoryChart)} data-native-chart="memory"><MemoryChart entries={memoryEntries} noData={noData} cards={_(text.cards)} /></div></section>
      <section className="liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 text-[var(--sf-text)] sm:p-7 shadow-[0_28px_70px_-52px_var(--sf-shadow)]" aria-labelledby="category-chart-title"><p className="premium-kicker uppercase tracking-[0.14em]">{_(text.libraryBreakdown)}</p><h2 id="category-chart-title" className="mt-2 text-xl font-black tracking-tight">{_(text.categoryDistribution)}</h2>{data.categoryChartIsPartial && <p className="mt-1 text-xs leading-5 text-[var(--sf-text-muted)]">{_(text.partialCategories)}</p>}<AccessibleChartTable caption={_(text.categoryData)} firstColumn={_(text.category)} valueLabel={_(text.value)} rows={data.categoryChart.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage={noData} /><div className="mt-4 min-h-52 w-full" role="img" aria-label={_(text.categoryChart)} data-native-chart="category"><CategoryChart entries={data.categoryChart} noData={noData} showTop={_(text.showTop)} showAll={count => `${_(text.showAll)} (${formatNumber(count)})`} /></div></section>
    </div>
  </div>;
}
