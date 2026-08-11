interface StatsChartsProps {
  darkMode: boolean;
  data: {
    xpChartData: Array<{ date: string; XP: number }>;
    difficultyChart: Array<{ name: string; value: number; color: string }>;
    categoryChart: Array<{ name: string; value: number }>;
    categoryChartIsPartial: boolean;
  };
}

function AccessibleChartTable({
  caption,
  firstColumn,
  rows,
  emptyMessage,
}: {
  caption: string;
  firstColumn: string;
  rows: Array<{ label: string; value: number }>;
  emptyMessage: string;
}) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead><tr><th scope="col">{firstColumn}</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {rows.length > 0
            ? rows.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.value}</td></tr>)
            : <tr><td colSpan={2}>{emptyMessage}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const XP_CHART = {
  width: 640,
  height: 240,
  left: 44,
  right: 18,
  top: 16,
  bottom: 42,
} as const;

function XpChart({ entries }: { entries: Array<{ date: string; XP: number }> }) {
  if (entries.length === 0) {
    return <div className="flex h-full w-full items-center justify-center font-bold text-[var(--sf-text-muted)]">No XP history yet</div>;
  }

  const plotWidth = XP_CHART.width - XP_CHART.left - XP_CHART.right;
  const plotHeight = XP_CHART.height - XP_CHART.top - XP_CHART.bottom;
  const baseline = XP_CHART.top + plotHeight;
  const maximum = Math.max(1, ...entries.map(entry => entry.XP));
  const points = entries.map((entry, index) => {
    const x = entries.length === 1
      ? XP_CHART.left + plotWidth / 2
      : XP_CHART.left + (index / (entries.length - 1)) * plotWidth;
    const y = XP_CHART.top + (1 - entry.XP / maximum) * plotHeight;
    return { ...entry, x, y };
  });
  const linePoints = points.map(point => `${point.x},${point.y}`).join(' ');
  const areaPoints = `${XP_CHART.left},${baseline} ${linePoints} ${XP_CHART.left + plotWidth},${baseline}`;
  const labelStride = Math.max(1, Math.ceil(entries.length / 5));

  return (
    <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${XP_CHART.width} ${XP_CHART.height}`} role="presentation" focusable="false">
      {[0, 0.25, 0.5, 0.75, 1].map(fraction => {
        const y = XP_CHART.top + fraction * plotHeight;
        const value = Math.round(maximum * (1 - fraction));
        return (
          <g key={fraction}>
            <line x1={XP_CHART.left} x2={XP_CHART.left + plotWidth} y1={y} y2={y} stroke="var(--sf-border)" strokeDasharray="4 5" />
            <text x={XP_CHART.left - 8} y={y + 4} textAnchor="end" fill="var(--sf-text-muted)" fontSize="11">{value}</text>
          </g>
        );
      })}
      <polygon points={areaPoints} fill="var(--sf-brand)" opacity="0.12" />
      <polyline points={linePoints} fill="none" stroke="var(--sf-brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {points.map((point, index) => (
        <g key={`${point.date}-${index}`}>
          <circle cx={point.x} cy={point.y} r="4" fill="var(--sf-surface-raised)" stroke="var(--sf-brand)" strokeWidth="3">
            <title>{`${point.date}: ${point.XP} XP`}</title>
          </circle>
          {(index % labelStride === 0 || index === points.length - 1) && (
            <text x={point.x} y={XP_CHART.height - 12} textAnchor="middle" fill="var(--sf-text-muted)" fontSize="11" fontWeight="600">{point.date}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function MemoryChart({ entries }: { entries: Array<{ name: string; value: number; color: string }> }) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
  if (total === 0) {
    return <div className="flex h-full w-full items-center justify-center font-bold text-[var(--sf-text-muted)]">No data yet</div>;
  }

  let consumed = 0;
  return (
    <div className="grid h-full grid-cols-[minmax(8rem,1fr)_minmax(7rem,auto)] items-center gap-4">
      <svg className="mx-auto aspect-square h-auto max-h-52 w-full max-w-52" viewBox="0 0 120 120" role="presentation" focusable="false">
        <circle cx="60" cy="60" r="42" fill="none" stroke="var(--sf-surface-muted)" strokeWidth="18" />
        {entries.map((entry, index) => {
          const percentage = Math.max(0, entry.value) / total * 100;
          const offset = -consumed;
          consumed += percentage;
          return (
            <circle
              key={`${entry.name}-${index}`}
              cx="60"
              cy="60"
              r="42"
              fill="none"
              pathLength="100"
              stroke={entry.color}
              strokeDasharray={`${percentage} ${100 - percentage}`}
              strokeDashoffset={offset}
              strokeWidth="18"
              transform="rotate(-90 60 60)"
            >
              <title>{`${entry.name}: ${entry.value}`}</title>
            </circle>
          );
        })}
        <text x="60" y="57" textAnchor="middle" fill="var(--sf-text)" fontSize="18" fontWeight="800">{total}</text>
        <text x="60" y="72" textAnchor="middle" fill="var(--sf-text-muted)" fontSize="8" fontWeight="600">cards</text>
      </svg>
      <ul className="space-y-2 text-xs font-semibold text-[var(--sf-text-muted)]">
        {entries.map((entry, index) => (
          <li key={`${entry.name}-${index}`} className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="min-w-0 break-words">{entry.name}</span>
            <span className="ml-auto tabular-nums text-[var(--sf-text)]">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryChart({ entries }: { entries: Array<{ name: string; value: number }> }) {
  if (entries.length === 0) {
    return <div className="flex h-full w-full items-center justify-center font-bold text-[var(--sf-text-muted)]">No data yet</div>;
  }

  const maximum = Math.max(1, ...entries.map(entry => entry.value));
  return (
    <div className="flex h-full flex-col justify-center gap-3 overflow-y-auto py-2">
      {entries.map((entry, index) => (
        <div key={`${entry.name}-${index}`} className="grid grid-cols-[minmax(5rem,8rem)_1fr_auto] items-center gap-3 text-xs">
          <span className="break-words text-right font-semibold text-[var(--sf-text-muted)]">{entry.name}</span>
          <span className="h-5 overflow-hidden rounded-r-md bg-[var(--sf-surface-muted)]">
            <span
              className="block h-full min-w-0 rounded-r-md bg-[var(--sf-brand)]"
              style={{ width: `${entry.value > 0 ? Math.max(2, entry.value / maximum * 100) : 0}%` }}
            />
          </span>
          <span className="min-w-8 text-right font-bold tabular-nums text-[var(--sf-text)]">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function StatsCharts({ data }: StatsChartsProps) {
  return (
    <>
      <section className="mb-6 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="xp-chart-title">
        <div className="mb-6 flex flex-col justify-between sm:flex-row sm:items-center">
          <div>
            <h2 id="xp-chart-title" className="text-balance text-center text-sm font-bold sm:text-left">Daily XP rhythm</h2>
            <p className="mt-1 text-pretty text-xs text-[var(--sf-text-muted)]">See your consistent learning days and the gaps between them.</p>
          </div>
          <div className="mt-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-1 text-center text-xs font-bold text-[var(--sf-brand-text)] sm:mt-0">
            Active learning
          </div>
        </div>
        <AccessibleChartTable caption="Daily XP data" firstColumn="Date" rows={data.xpChartData.map(entry => ({ label: entry.date, value: entry.XP }))} emptyMessage="No XP history yet" />
        <div className="h-64 w-full" role="img" aria-label="Daily XP chart" data-native-chart="xp">
          <XpChart entries={data.xpChartData} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <section className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="mastery-chart-title">
          <h2 id="mastery-chart-title" className="mb-6 text-center text-sm font-bold">Memory strength</h2>
          <AccessibleChartTable caption="Memory strength data" firstColumn="Memory status" rows={data.difficultyChart.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage="No memory strength data yet" />
          <div className="h-64 w-full" role="img" aria-label="Memory strength chart" data-native-chart="memory">
            <MemoryChart entries={data.difficultyChart} />
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="category-chart-title">
          <h2 id="category-chart-title" className="mb-6 text-center text-sm font-bold">Category distribution</h2>
          {data.categoryChartIsPartial && <p className="-mt-4 mb-3 text-center text-[11px] text-[var(--sf-text-muted)]">Current-page data only; the full library is not scanned.</p>}
          <AccessibleChartTable caption="Category distribution data" firstColumn="Category" rows={data.categoryChart.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage="No category data yet" />
          <div className="h-64 w-full" role="img" aria-label="Category distribution chart" data-native-chart="category">
            <CategoryChart entries={data.categoryChart} />
          </div>
        </section>
      </div>
    </>
  );
}
