import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stateFromFixture, streakFixtures, studyTimeFixture } from '../../features/gamification/testing/verifiedStatsFixtures';
import type { VerifiedGamificationState } from '../../features/gamification/verifiedGamificationClient';
import { ProgressLearningSince, ProgressStudiedTime, StudyPaceFact } from './ProgressStudyFacts';
import { VerifiedStatsProvider } from './VerifiedStatsContext';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});
afterEach(() => vi.useRealTimers());

const render = (state: VerifiedGamificationState | null, node: ReactNode) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>
    <VerifiedStatsProvider source={state ? { state, language: 'en' } : null}>{node}</VerifiedStatsProvider>
  </I18nProvider>,
);

const studied = (): VerifiedGamificationState => {
  vi.useFakeTimers();
  vi.setSystemTime(studyTimeFixture.now);
  return { ...stateFromFixture(studyTimeFixture), xpHistory: { '2026-06-02': 15, '2026-11-19': 40 } };
};

describe('Progress study facts', () => {
  it('writes Learning since in the classic subtitle and after the Crystal kicker', () => {
    const state = studied();
    expect(render(state, <ProgressLearningSince variant="subtitle" />)).toContain('Learning since 2 June 2026');
    expect(render(state, <ProgressLearningSince variant="kicker" />)).toContain('since 2 Jun 2026');
  });

  it('writes the studied time since the day counting began', () => {
    expect(render(studied(), <ProgressStudiedTime />)).toContain('<strong class="progress-studied-value">25 m</strong> studied since 12 Nov');
  });

  it('writes the own pace instead of a ranking', () => {
    const html = render(studied(), <dl><StudyPaceFact /></dl>);
    expect(html).toContain('<dt>Study pace</dt><dd>5 min a day</dd>');
    expect(html).toContain('title="Average on days you studied, last 4 weeks"');
    expect(html).not.toMatch(/Top \d+%/);
  });

  it('leaves each segment out before its value exists, never a zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(streakFixtures.frozenOneDay.now);
    const noStudyTime = stateFromFixture(streakFixtures.frozenOneDay);
    expect(render(noStudyTime, <ProgressLearningSince variant="subtitle" />)).toBe('');
    expect(render(noStudyTime, <ProgressStudiedTime />)).toBe('');
    expect(render(noStudyTime, <dl><StudyPaceFact /></dl>)).toBe('<dl></dl>');
    expect(render(null, <ProgressStudiedTime />)).toBe('');
  });
});
