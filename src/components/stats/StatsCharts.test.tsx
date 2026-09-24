import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup as renderReactToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import StatsCharts from './StatsCharts';

const renderToStaticMarkup = (node: React.ReactNode) => renderReactToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

describe('StatsCharts accessible data equivalents', () => {
  beforeEach(() => { i18n.load('en', {}); i18n.activate('en'); });
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
            { name: 'Mastered', value: 8 },
            { name: 'Learning', value: 4 },
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
    expect(html).toContain('<td>Jul 14</td><td>15</td>');
    expect(html).toContain('<td>Jul 15</td><td>30</td>');
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
          difficultyChart: [{ name: 'Not reviewed', value: 2 }],
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
            { name: 'Mastered', value: 3 },
            { name: 'Learning', value: 1 },
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
          difficultyChart: [{ name: 'Mastered', value: 3 }],
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

  it('uses translated memory labels and theme heat tokens instead of model colors', () => {
    i18n.load('vi', {
      'stats.mastered': 'Đã thuộc',
      'stats.learning': 'Đang học',
      'stats.not-reviewed': 'Chưa ôn',
    });
    i18n.activate('vi');
    const html = renderToStaticMarkup(
      <StatsCharts darkMode={false} data={{
        xpChartData: [],
        difficultyChart: [
          { name: 'Mastered', value: 3 },
          { name: 'Learning', value: 2 },
          { name: 'Not reviewed', value: 1 },
        ],
        categoryChart: [],
        categoryChartIsPartial: false,
      }} />,
    );

    expect(html).toContain('<td>Đã thuộc</td><td>3</td>');
    expect(html).toContain('<td>Đang học</td><td>2</td>');
    expect(html).toContain('<td>Chưa ôn</td><td>1</td>');
    expect(html).toContain('stroke="var(--sf-heat-4)"');
    expect(html).toContain('stroke="var(--sf-heat-3)"');
    expect(html).toContain('stroke="var(--sf-heat-1)"');
    expect(html).not.toContain('#10b981');
  });

  it('keeps the category expansion target at least 44px high', () => {
    const html = renderToStaticMarkup(
      <StatsCharts darkMode={false} data={{
        xpChartData: [],
        difficultyChart: [],
        categoryChart: Array.from({ length: 6 }, (_, index) => ({ name: `Category ${index}`, value: index + 1 })),
        categoryChartIsPartial: false,
      }} />,
    );

    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11/);
  });
});
