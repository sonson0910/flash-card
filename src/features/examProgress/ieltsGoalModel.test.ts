import { describe, expect, it } from 'vitest';
import { buildIeltsGoalModel, daysBetween, type IeltsGoalModelInput, type IeltsPathCounts } from './ieltsGoalModel';

const counts = (overrides: Partial<IeltsPathCounts> = {}): IeltsPathCounts => ({
  total: 100, started: 40, mastered: 30, masteredLast7: 4, masteredLast28: 12, ...overrides,
});

const input = (overrides: Partial<IeltsGoalModelInput> = {}): IeltsGoalModelInput => ({
  counts: counts(),
  goal: { kind: 'ielts', level: '7.0', targetDate: '2026-12-19' },
  latestScore: '6.5',
  today: '2026-11-19',
  verifiedHistoryStartedOn: '2026-10-01',
  ...overrides,
});

describe('IELTS goal model', () => {
  it('derives the percent from the same mastered and total counts the sentence uses', () => {
    const model = buildIeltsGoalModel(input({ counts: counts({ total: 7, mastered: 2 }) }))!;
    expect(model).toMatchObject({ total: 7, mastered: 2, percent: Math.round((100 * 2) / 7), state: 'in-progress' });
  });

  it('names each progress state', () => {
    expect(buildIeltsGoalModel(input({ counts: counts({ started: 0, mastered: 0 }) }))?.state).toBe('not-started');
    expect(buildIeltsGoalModel(input({ counts: counts({ started: 5, mastered: 0 }) }))?.state).toBe('started');
    expect(buildIeltsGoalModel(input({ counts: counts({ started: 100, mastered: 100 }) }))?.state).toBe('complete');
  });

  it('is omitted for a goal that is not IELTS or a path without words', () => {
    expect(buildIeltsGoalModel(input({ goal: { kind: 'toeic', level: '800', targetDate: null } }))).toBeNull();
    expect(buildIeltsGoalModel(input({ counts: counts({ total: 0, started: 0, mastered: 0 }) }))).toBeNull();
  });

  it('reads the target band from the goal level and treats free text as no target', () => {
    expect(buildIeltsGoalModel(input({ goal: { kind: 'ielts', level: 'band 7', targetDate: null } }))?.targetBand).toBe('7.0');
    const freeText = buildIeltsGoalModel(input({ goal: { kind: 'ielts', level: 'about seven', targetDate: null } }))!;
    expect(freeText.targetBand).toBeNull();
    expect(freeText.latestScore).toBeNull();
  });

  it('keeps the latest score beside a target, even at or above it', () => {
    expect(buildIeltsGoalModel(input({ latestScore: '7.5' }))).toMatchObject({ latestScore: '7.5', targetBand: '7.0' });
    expect(buildIeltsGoalModel(input({ latestScore: null }))?.latestScore).toBeNull();
    expect(buildIeltsGoalModel(input({ latestScore: '10' }))?.latestScore).toBeNull();
  });

  it('estimates the pace only from enough verified history and recent mastery', () => {
    expect(buildIeltsGoalModel(input())?.weeksLeft).toBe(Math.ceil(70 / (12 / 4)));
    expect(buildIeltsGoalModel(input({ verifiedHistoryStartedOn: '2026-11-07' }))?.weeksLeft).toBeNull();
    expect(buildIeltsGoalModel(input({ verifiedHistoryStartedOn: '2026-11-06' }))?.weeksLeft).not.toBeNull();
    expect(buildIeltsGoalModel(input({ verifiedHistoryStartedOn: null }))?.weeksLeft).toBeNull();
    expect(buildIeltsGoalModel(input({ counts: counts({ masteredLast28: 2 }) }))?.weeksLeft).toBeNull();
    expect(buildIeltsGoalModel(input({ counts: counts({ masteredLast28: null }) }))?.weeksLeft).toBeNull();
    expect(buildIeltsGoalModel(input({ counts: counts({ total: 2_000, mastered: 10, started: 20, masteredLast28: 3 }) }))?.weeksLeft).toBeNull();
    expect(buildIeltsGoalModel(input({ counts: counts({ started: 100, mastered: 100 }) }))?.weeksLeft).toBeNull();
  });

  it('shows the exam date only while it is ahead', () => {
    expect(buildIeltsGoalModel(input())).toMatchObject({ examDate: '2026-12-19', daysToExam: 30, examThisYear: true });
    expect(buildIeltsGoalModel(input({ goal: { kind: 'ielts', level: '7.0', targetDate: '2027-01-05' } }))).toMatchObject({ daysToExam: 47, examThisYear: false });
    expect(buildIeltsGoalModel(input({ goal: { kind: 'ielts', level: '7.0', targetDate: '2026-11-19' } }))).toMatchObject({ examDate: null, daysToExam: null });
    expect(buildIeltsGoalModel(input({ goal: { kind: 'ielts', level: '7.0', targetDate: null } }))).toMatchObject({ examDate: null, daysToExam: null });
  });

  it('keeps an unknown week count unknown', () => {
    expect(buildIeltsGoalModel(input({ counts: counts({ masteredLast7: null }) }))?.masteredThisWeek).toBeNull();
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
    expect(daysBetween('2026-12-31', 'soon')).toBeNull();
  });
});
