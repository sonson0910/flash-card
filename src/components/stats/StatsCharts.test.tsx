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
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).not.toContain('overflow-y-auto');
    expect(html.match(/role="img"/g)).toHaveLength(3);
  });

  it('shows an honest empty XP state when no XP entries exist', () => {
    const html = renderToStaticMarkup(
      <StatsCharts
        darkMode={false}
        data={{
          xpChartData: [],
          difficultyChart: [{ name: 'Not reviewed', value: 2, color: '#94a3b8' }],
          categoryChart: [],
          categoryChartIsPartial: false,
        }}
      />,
    );

    expect(html).toContain('No XP history yet');
    expect(html).not.toMatch(/>0 XP</);
  });

  it('renders dependency-free chart primitives for every visualization', () => {
    const html = renderToStaticMarkup(
      <StatsCharts
        darkMode={false}
        data={{
          xpChartData: [
            { date: 'Aug 9', XP: 10 },
            { date: 'Aug 10', XP: 25 },
          ],
          difficultyChart: [
            { name: 'Mastered', value: 3, color: '#10b981' },
            { name: 'Learning', value: 1, color: '#f59e0b' },
          ],
          categoryChart: [{ name: 'Travel', value: 4 }],
          categoryChartIsPartial: false,
        }}
      />,
    );

    expect(html.match(/data-native-chart=/g)).toHaveLength(3);
    expect(html).toContain('data-native-chart="xp"');
    expect(html).toContain('data-native-chart="memory"');
    expect(html).toContain('data-native-chart="category"');
  });

  it('keeps XP hover on a fixed hit area without moving the visible point', () => {
    const html = renderToStaticMarkup(
      <StatsCharts
        darkMode={false}
        data={{
          xpChartData: [
            { date: 'Aug 9', XP: 10 },
            { date: 'Aug 10', XP: 25 },
          ],
          difficultyChart: [],
          categoryChart: [],
          categoryChartIsPartial: false,
        }}
      />,
    );

    expect(html.match(/data-xp-hit-area=/g)).toHaveLength(2);
    expect(html.match(/data-xp-point=/g)).toHaveLength(2);
    expect(html).toContain('r="14"');
    expect(html).toContain('pointer-events="none"');
  });

  it('reveals chart data without moving interactive hit targets', () => {
    const html = renderToStaticMarkup(
      <StatsCharts
        darkMode={false}
        data={{
          xpChartData: [
            { date: 'Aug 9', XP: 10 },
            { date: 'Aug 10', XP: 25 },
          ],
          difficultyChart: [{ name: 'Mastered', value: 3, color: '#10b981' }],
          categoryChart: [{ name: 'Travel', value: 4 }],
          categoryChartIsPartial: false,
        }}
      />,
    );

    expect(html).toContain('data-chart-motion="line"');
    expect(html).toContain('data-chart-motion="area"');
    expect(html).toContain('data-chart-motion="ring"');
    expect(html).toContain('data-chart-motion="bar"');
  });
});
