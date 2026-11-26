import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildWeeklyRecapCardContent } from './weeklyRecapCard';
import type { WeeklyRecapData, WeeklyRecapStats } from './weeklyRecapModel';
import { defaultWeeklyRecapSelection } from './weeklyRecapSelection';
import { WeeklyRecapScreen, type WeeklyRecapScreenProps } from './WeeklyRecapScreen';
import { ThemeProvider } from '../theme/ThemeProvider';

i18n.load('en', {});
i18n.activate('en');

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const data = (overrides: Partial<WeeklyRecapData> = {}): WeeklyRecapData => ({
  rangeStart: '2026-11-16',
  rangeEnd: '2026-11-22',
  days: Array.from({ length: 7 }, (_, index) => ({ dateKey: `2026-11-${16 + index}`, xp: index === 1 ? 90 : 0, ...(index > 3 ? { future: true } : {}) })),
  totalXp: 90,
  activeDays: 1,
  bestDay: { dateKey: '2026-11-17', xp: 90 },
  reviewedCount: null,
  hasActivity: true,
  ...overrides,
});

const verified: WeeklyRecapStats = {
  weekStart: '2026-11-16',
  words: { started: 146, mastered: 10, since: null },
  bestWeek: null,
  aheadOfLastWeek: null,
  streakDays: 12,
  recall: { percent: 91, since: null },
  studied: { activeMs: 9_600_000, since: null },
  wordOfWeek: null,
};

const props = (overrides: Partial<WeeklyRecapScreenProps> & { stats?: WeeklyRecapStats | null; recap?: WeeklyRecapData } = {}): WeeklyRecapScreenProps => {
  const { stats = verified, recap = data(), ...rest } = overrides;
  const selection = rest.selection ?? defaultWeeklyRecapSelection();
  return {
    content: buildWeeklyRecapCardContent({ data: recap, stats, selection, wordOfWeek: null, locale: 'en' }),
    intro: { bestWeek: null, aheadOfLastWeek: null, countedSince: null },
    dateRangeLabel: '16 – 22 Nov',
    selection,
    selectionKeys: ['words', 'streak', 'recall', 'heatmap'],
    heroIsXp: stats?.words == null,
    caption: 'Great week!',
    isBusy: false,
    lastOutcome: null,
    exportError: false,
    actions: { toggleSelection: vi.fn(), setCaption: vi.fn(), share: vi.fn(), download: vi.fn() },
    ...rest,
  };
};

const cardOf = (html: string) => html.split('<section class="weekly-recap-controls"')[0];

describe('WeeklyRecapScreen', () => {
  it('draws the board card: words hero, streak, recall and studied chips, Monday to Sunday heat', () => {
    const card = cardOf(render(<WeeklyRecapScreen {...props()} />));
    expect(card).toContain('My week');
    expect(card).toContain('<strong>146</strong><span>words <em>this week</em></span>');
    expect(card).toContain('<div data-chip="streak"><dt>streak</dt><dd>12 d</dd></div>');
    expect(card).toContain('<div data-chip="recall"><dt>recall</dt><dd>91%</dd></div>');
    expect(card).toContain('<div data-chip="studied"><dt>studied</dt><dd>2 h 40</dd></div>');
    expect(card.match(/weekly-recap-card__heatmap-day/g)).toHaveLength(7);
    expect(card.match(/data-future="true"/g)).toHaveLength(3);
    expect(card).not.toContain('weekly-recap-card__bloom');
  });

  it('sets the Crystal card on a stage of decorative wing shards and a tilted panel, and keeps the Classic card bare', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'false' })[key] ?? null,
      setItem: () => undefined,
    });
    try {
      const crystal = render(<ThemeProvider><WeeklyRecapScreen {...props()} /></ThemeProvider>);
      expect(crystal).toMatch(/<div class="weekly-recap-stage"><span class="weekly-recap-stage__wings crystal-wing-art" aria-hidden="true"><\/span><span class="weekly-recap-stage__back" aria-hidden="true"><\/span><section class="weekly-recap-card weekly-recap-card--crystal"/);
      // The board's figure: a conic rim layer behind a chamfered face that holds the beam, header and content.
      expect(crystal).toContain('<span class="weekly-recap-card__rim" aria-hidden="true"><span class="weekly-recap-card__rim-spin"></span></span><div class="weekly-recap-card__face"><span class="weekly-recap-card__beam" aria-hidden="true"></span><header class="weekly-recap-card__header">');
      expect(crystal).toContain('<span class="weekly-recap-card__kicker">My week</span> <span class="weekly-recap-card__heading-sep" aria-hidden="true">//</span> <span class="weekly-recap-card__range">16 – 22 Nov</span>');
      // The headline is two runs on two lines, and still reads as one sentence.
      expect(crystal).toContain('<h1><span class="weekly-recap-controls__headline-metal">Your week </span><br/><em>so far.</em></h1>');
      expect(crystal).toContain('<span class="weekly-recap-controls__action-label">Share</span>');
    } finally {
      vi.unstubAllGlobals();
    }
    const classic = render(<WeeklyRecapScreen {...props()} />);
    expect(classic).not.toContain('weekly-recap-stage');
    expect(classic).toMatch(/^<div class="weekly-recap-screen" data-family="classic"><div class="weekly-recap-card-deck"><section class="weekly-recap-card sf-deal-1"/);
  });

  it('shows an honest empty state instead of zero metrics', () => {
    const html = render(<WeeklyRecapScreen {...props({ stats: null, recap: data({ totalXp: 0, activeDays: 0, bestDay: null, hasActivity: false }), caption: '' })} />);
    expect(html).toContain('No study activity yet this week. Come back after a review to see your recap.');
    expect(cardOf(html)).not.toContain('weekly-recap-card__metrics');
  });

  it('keeps the XP hero and its toggle until words are counted for the course', () => {
    const html = render(<WeeklyRecapScreen {...props({ stats: null, selectionKeys: ['words', 'heatmap'] })} />);
    expect(cardOf(html)).toContain('<strong>90</strong><span>XP <em>this week</em></span>');
    expect(html).toContain('data-selection-key="words" checked=""/><svg');
    expect(html).toContain('Total XP</label>');
  });

  it('writes the headline, the gain on last week and the counting note from the week', () => {
    const best = render(<WeeklyRecapScreen {...props({ intro: { bestWeek: { since: null }, aheadOfLastWeek: 38, countedSince: null } })} />);
    expect(best).toContain('Your best week <em>so far.</em>');
    expect(best).toContain('<strong>+38 words</strong> compared with last week.');

    const since = render(<WeeklyRecapScreen {...props({ intro: { bestWeek: { since: '2026-11-26' }, aheadOfLastWeek: null, countedSince: '2026-11-26' } })} />);
    expect(since).toContain('Your best week <em>since 26 Nov.</em>');
    expect(since).toContain('Weekly word counts started on 26 Nov.');
    expect(since).not.toContain('compared with last week');

    const plain = render(<WeeklyRecapScreen {...props()} />);
    expect(plain).toContain('Your week <em>so far.</em>');
    expect(plain).not.toContain('Weekly word counts started on');
  });

  it('lists only the toggles that have something to show', () => {
    const html = render(<WeeklyRecapScreen {...props({ selectionKeys: ['words', 'heatmap'] })} />);
    expect(html).toContain('data-selection-key="words"');
    expect(html).toContain('data-selection-key="heatmap"');
    expect(html).not.toContain('data-selection-key="streak"');
    expect(html).not.toContain('data-selection-key="wordOfWeek"');
  });

  it('shows the caption character budget and the trimmed caption on the card', () => {
    const html = render(<WeeklyRecapScreen {...props({ caption: '  Great week!  ' })} />);
    expect(html).toContain('15 / 220');
    expect(cardOf(html)).toContain('<p class="weekly-recap-card__range weekly-recap-card__caption">Great week!</p>');
    expect(cardOf(render(<WeeklyRecapScreen {...props({ caption: '   ' })} />))).not.toContain('weekly-recap-card__caption');
  });

  it('disables both share actions while an export is in flight', () => {
    const html = render(<WeeklyRecapScreen {...props({ isBusy: true })} />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('surfaces the last share outcome and a distinct export error', () => {
    expect(render(<WeeklyRecapScreen {...props({ lastOutcome: 'copied' })} />)).toContain('Copied to your clipboard.');
    const error = render(<WeeklyRecapScreen {...props({ exportError: true, lastOutcome: 'shared' })} />);
    expect(error).toContain('Could not create the image. Please try again.');
    expect(error).not.toContain('Shared.');
  });
});
