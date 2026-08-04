import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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

export default function StatsCharts({ data }: StatsChartsProps) {
  return (
    <>
      <section className="mb-6 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="xp-chart-title">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
          <div>
            <h2 id="xp-chart-title" className="text-balance text-sm font-bold text-center sm:text-left">Daily XP rhythm</h2>
            <p className="mt-1 text-pretty text-xs text-[var(--sf-text-muted)]">See your consistent learning days and the gaps between them.</p>
          </div>
          <div className="mt-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-1 text-center text-xs font-bold text-[var(--sf-brand-text)] sm:mt-0">
            Active learning
          </div>
        </div>
        <AccessibleChartTable caption="Daily XP data" firstColumn="Date" rows={data.xpChartData.map(entry => ({ label: entry.date, value: entry.XP }))} emptyMessage="No XP history yet" />
        <div className="h-64 w-full" role="img" aria-label="Daily XP chart">
          {data.xpChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.xpChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--sf-border)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: 'var(--sf-text-muted)', fontSize: 11, fontWeight: 'bold' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--sf-text-muted)', fontSize: 11, fontWeight: 'bold' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--sf-surface)', borderColor: 'var(--sf-border)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
                  labelStyle={{ fontWeight: 'bold', color: 'var(--sf-text)' }}
                  itemStyle={{ fontWeight: 'bold', color: 'var(--sf-brand)' }}
                />
                <Area type="monotone" dataKey="XP" stroke="var(--sf-brand)" strokeWidth={3} fill="var(--sf-brand)" fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-[var(--sf-text-muted)] font-bold">No XP history yet</div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="mastery-chart-title">
          <h2 id="mastery-chart-title" className="mb-6 text-center text-sm font-bold">Memory strength</h2>
          <AccessibleChartTable caption="Memory strength data" firstColumn="Memory status" rows={data.difficultyChart.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage="No memory strength data yet" />
          <div className="h-64 w-full" role="img" aria-label="Memory strength chart">
            {data.difficultyChart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.difficultyChart} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {data.difficultyChart.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--sf-surface)', border: '1px solid var(--sf-border)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} itemStyle={{ fontWeight: 'bold' }} />
                  <Legend wrapperStyle={{ color: 'var(--sf-text-muted)', fontSize: '12px', fontWeight: 'bold' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[var(--sf-text-muted)] font-bold">No data yet</div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-[var(--sf-text)] sm:p-6" aria-labelledby="category-chart-title">
          <h2 id="category-chart-title" className="mb-6 text-center text-sm font-bold">Category distribution</h2>
          {data.categoryChartIsPartial && <p className="-mt-4 mb-3 text-center text-[11px] text-[var(--sf-text-muted)]">Current-page data only; the full library is not scanned.</p>}
          <AccessibleChartTable caption="Category distribution data" firstColumn="Category" rows={data.categoryChart.map(entry => ({ label: entry.name, value: entry.value }))} emptyMessage="No category data yet" />
          <div className="h-64 w-full" role="img" aria-label="Category distribution chart">
            {data.categoryChart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.categoryChart} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--sf-border)" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: 'var(--sf-text-muted)', fontSize: 12, fontWeight: 'bold' }} width={100} />
                  <Tooltip cursor={{ fill: 'var(--sf-surface)' }} contentStyle={{ backgroundColor: 'var(--sf-surface)', border: '1px solid var(--sf-border)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} />
                  <Bar dataKey="value" fill="var(--sf-brand)" radius={[0, 4, 4, 0]} barSize={20}>
                    {data.categoryChart.map((_, index) => <Cell key={`cell-${index}`} fill="var(--sf-brand)" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[var(--sf-text-muted)] font-bold">No data yet</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
