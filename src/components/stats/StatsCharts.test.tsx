import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import StatsCharts from './StatsCharts';

describe('StatsCharts accessible data equivalents', () => {
  it('exposes every chart value once as structured text and hides the visual charts', () => {
    const html = renderToStaticMarkup(
      <StatsCharts
        darkMode={false}
        data={{
          xpChartData: [
            { date: 'Jul 14, 2026', XP: 15 },
            { date: 'Jul 15, 2026', XP: 30 },
          ],
          difficultyChart: [
            { name: 'Mastered', value: 8, color: '#10b981' },
            { name: 'Learning', value: 4, color: '#f59e0b' },
          ],
          categoryChart: [
            { name: 'Travel', value: 7 },
            { name: 'Work', value: 5 },
          ],
          categoryChartIsPartial: false,
        }}
      />,
    );

    expect(html).toContain('<caption>Daily XP data</caption>');
    expect(html).toContain('<td>Jul 14, 2026</td><td>15</td>');
    expect(html).toContain('<td>Jul 15, 2026</td><td>30</td>');
    expect(html).toContain('<caption>Memory strength data</caption>');
    expect(html).toContain('<td>Mastered</td><td>8</td>');
    expect(html).toContain('<caption>Category distribution data</caption>');
    expect(html).toContain('<td>Travel</td><td>7</td>');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(html).not.toContain('role="img"');
  });
});
