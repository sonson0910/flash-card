import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../courses/courseModel';
import { buildIeltsGoalModel, type IeltsGoalModelInput, type IeltsPathCounts } from './ieltsGoalModel';

const theme = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: theme.family, mode: 'light' }) }));

import { IeltsGoalPanel, IeltsGoalPanelView } from './IeltsGoalPanel';

i18n.load('en', {});
i18n.activate('en');

const FORBIDDEN_CLAIMS = /projected|predict|typical IELTS Reading passage|you will (get|score)/i;
/** The required disclaimers; the classic one names "a prediction" only to rule it out. */
const DISCLAIMERS = [
  "Based on words you've mastered in SonFlash. Not an IELTS score or a prediction.",
  'Vocabulary progress, not an IELTS score.',
];

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
const text = (html: string) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();
const attributes = (html: string) => [...html.matchAll(/aria-(?:label|valuetext)="([^"]*)"/g)].map(match => match[1]).join(' ');

const counts = (overrides: Partial<IeltsPathCounts> = {}): IeltsPathCounts => ({
  total: 100, started: 40, mastered: 30, masteredLast7: 4, masteredLast28: 12, ...overrides,
});
const model = (overrides: Partial<IeltsGoalModelInput> = {}) => buildIeltsGoalModel({
  counts: counts(),
  goal: { kind: 'ielts', level: '7.0', targetDate: '2026-12-19' },
  latestScore: '6.5',
  today: '2026-11-19',
  verifiedHistoryStartedOn: '2026-10-01',
  ...overrides,
})!;

const actions = { onOpenPath: vi.fn(), onSetTargetBand: vi.fn(), onEditLatestScore: vi.fn() };

const states: Record<string, Partial<IeltsGoalModelInput>> = {
  'with a latest score': {},
  'without a latest score': { latestScore: null },
  'without a target band': { goal: { kind: 'ielts', level: null, targetDate: null } },
  'with a latest score above the target': { latestScore: '8.0' },
  'before any path word is started': { counts: counts({ started: 0, mastered: 0, masteredLast7: 0, masteredLast28: 0 }) },
  'with words started but none mastered': { counts: counts({ started: 4, mastered: 0, masteredLast7: 0, masteredLast28: 0 }) },
  'with the path complete': { counts: counts({ started: 100, mastered: 100 }) },
};

describe('IELTS goal panel', () => {
  beforeEach(() => { theme.family = 'classic'; });

  describe.each(['classic', 'crystal'] as const)('%s', family => {
    beforeEach(() => { theme.family = family; });

    it.each(Object.entries(states))('never claims a projected or predicted band %s', (_name, overrides) => {
      const html = render(<IeltsGoalPanelView model={model(overrides)} {...actions} />);
      let visible = `${text(html)} ${attributes(html)}`;
      const disclaimer = family === 'classic' ? DISCLAIMERS[0] : DISCLAIMERS[1];
      expect(visible).toContain(disclaimer);
      DISCLAIMERS.forEach(line => { visible = visible.split(line).join(' '); });
      expect(visible).not.toMatch(FORBIDDEN_CLAIMS);
      expect(visible).not.toMatch(/congrat|well done|you did it|reached your target/i);
    });

    it('shows the latest score and the target with a spoken form of the arrow', () => {
      const html = render(<IeltsGoalPanelView model={model()} {...actions} />);
      const visible = text(html);
      expect(visible).toContain('Your score to your target');
      expect(visible).toContain('from 6.5 to 7.0');
      expect(html).toMatch(/aria-hidden="true"><span class="ielts-goal-band__latest">6.5<\/span><svg[^>]*aria-hidden="true"[\s\S]*?<span class="ielts-goal-band__target">7.0<\/span>/);
      expect(visible).not.toContain('Add your latest score');
    });

    it('shows the target alone with a link to add the latest score', () => {
      const html = render(<IeltsGoalPanelView model={model({ latestScore: null })} {...actions} />);
      const visible = text(html);
      expect(visible).toContain(family === 'classic' ? 'Your target' : 'Target 7.0');
      if (family === 'classic') expect(visible).toContain('Band 7.0');
      expect(visible).toContain('Add your latest score');
      expect(visible).not.toContain('Your score to your target');
      expect(visible).not.toContain('from ');
    });

    it('asks for a target band when the goal has none', () => {
      const visible = text(render(<IeltsGoalPanelView model={model({ goal: { kind: 'ielts', level: 'about seven', targetDate: null } })} {...actions} />));
      expect(visible).toContain('Set a target band');
      expect(visible).not.toContain('Add your latest score');
    });

    it('leaves out links whose actions the caller did not supply', () => {
      const visible = text(render(<IeltsGoalPanelView model={model({ latestScore: null })} onOpenPath={vi.fn()} />));
      expect(visible).not.toContain('Add your latest score');
      const noTarget = render(<IeltsGoalPanelView model={model({ goal: { kind: 'ielts', level: null, targetDate: null } })} onOpenPath={vi.fn()} />);
      expect(noTarget).not.toContain('ielts-goal-band');
    });

    it('prompts to open the path before any word is started', () => {
      const visible = text(render(<IeltsGoalPanelView model={model(states['before any path word is started'])} {...actions} />));
      expect(visible).toContain('Start the SonFlash IELTS path to see your progress here.');
      expect(visible).toContain('Open the IELTS path');
    });
  });

  it('draws the classic ring percent from the same counts as the sentence', () => {
    const cases = [counts({ total: 100, mastered: 30 }), counts({ total: 7, mastered: 2, masteredLast7: 0 }), counts({ total: 3, mastered: 3, started: 3 })];
    for (const value of cases) {
      const current = model({ counts: value });
      const html = render(<IeltsGoalPanelView model={current} {...actions} />);
      const percent = Number(/data-percent="(\d+)"/.exec(html)?.[1]);
      const sentence = /You've mastered (\d+) of the (\d+) words? in the SonFlash IELTS path\./.exec(text(html));
      expect(sentence).not.toBeNull();
      const [mastered, total] = [Number(sentence![1]), Number(sentence![2])];
      expect(percent).toBe(Math.round((100 * mastered) / total));
      expect(text(html)).toContain(`${percent}%`);
      expect(html).toContain(`aria-label="${percent}% of the SonFlash IELTS path mastered"`);
    }
  });

  it('writes the classic copy with the week count and the exam date', () => {
    const visible = text(render(<IeltsGoalPanelView model={model()} {...actions} />));
    expect(visible).toContain('Toward your IELTS goal');
    expect(visible).toContain("You've mastered 30 of the 100 words in the SonFlash IELTS path. +4 words this week.");
    expect(visible).toContain('by Dec 19');
    const nextYear = text(render(<IeltsGoalPanelView model={model({ goal: { kind: 'ielts', level: '7.0', targetDate: '2027-03-02' } })} {...actions} />));
    expect(nextYear).toContain('by Mar 2, 2027');
    const noWeek = text(render(<IeltsGoalPanelView model={model({ counts: counts({ masteredLast7: 0 }) })} {...actions} />));
    expect(noWeek).not.toContain('this week');
  });

  it('writes the Crystal copy with the pace and the days to the exam', () => {
    theme.family = 'crystal';
    const html = render(<IeltsGoalPanelView model={model()} {...actions} />);
    const visible = text(html);
    expect(visible).toContain('IELTS goal');
    expect(visible).toContain('30 of 100 IELTS path words are mastered in your deck. At this pace, the rest takes about 24 weeks. Exam in 30 days.');
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toContain('style="width:30%"');
    const unknownPace = text(render(<IeltsGoalPanelView model={model({ verifiedHistoryStartedOn: '2026-11-15' })} {...actions} />));
    expect(unknownPace).not.toContain('At this pace');
  });

  it('renders nothing when the goal is not IELTS or the app is offline', () => {
    const course = (kind: string): Course => ({
      id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active',
      goals: [{ id: 'goal-1', kind, level: '7.0', targetDate: null, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
      preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const base = { ownerId: 'owner-1', database: {} as never, libraryEpoch: 1, isOffline: false, onOpenPath: vi.fn() };
    expect(render(<IeltsGoalPanel {...base} course={course('toeic')} />)).toBe('');
    expect(render(<IeltsGoalPanel {...base} course={course('ielts')} isOffline />)).toBe('');
    expect(render(<IeltsGoalPanel {...base} course={null} />)).toBe('');
  });
});
