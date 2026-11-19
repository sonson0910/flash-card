import { describe, expect, it } from 'vitest';
import {
  MAX_COUNTDOWN_WEEKS, ONBOARDING_STEPS, clearOnboardingInProgress, clearOnboardingResumeStep, countdownWeeks,
  daysUntilGoalDate, firstOnboardingStep, hasOnboardingInProgress, isOnboardingStepId, markOnboardingInProgress,
  nextOnboardingStep, onboardingStepsFor, previousOnboardingStep, readOnboardingResumeStep, writeOnboardingResumeStep,
} from './onboardingModel';

class FakeStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
}

describe('onboarding step order', () => {
  it('starts at the first step and walks forward through every step exactly once', () => {
    let step = firstOnboardingStep();
    const seen = [step];
    for (let guard = 0; guard < ONBOARDING_STEPS.length + 1; guard += 1) {
      const next = nextOnboardingStep(step);
      if (!next) break;
      seen.push(next);
      step = next;
    }
    expect(seen).toEqual([...ONBOARDING_STEPS]);
  });

  it('has no next step after reminder and no previous step before language', () => {
    expect(nextOnboardingStep('reminder')).toBeNull();
    expect(previousOnboardingStep('language')).toBeNull();
  });

  it('follows the goal with the exam step, then pace, the card trial and reminders', () => {
    expect([...ONBOARDING_STEPS]).toEqual(['language', 'target', 'goal', 'exam', 'pace', 'aha', 'reminder']);
    expect(onboardingStepsFor(true)).toEqual(ONBOARDING_STEPS);
  });

  it('drops the exam step when the learner has no goal', () => {
    const steps = onboardingStepsFor(false);
    expect(steps).toEqual(['language', 'target', 'goal', 'pace', 'aha', 'reminder']);
    expect(nextOnboardingStep('goal', steps)).toBe('pace');
    expect(previousOnboardingStep('pace', steps)).toBe('goal');
    expect(nextOnboardingStep('goal', onboardingStepsFor(true))).toBe('exam');
    expect(previousOnboardingStep('pace', onboardingStepsFor(true))).toBe('exam');
  });

  it('rejects an unknown step id', () => {
    expect(isOnboardingStepId('not-a-step')).toBe(false);
    expect(isOnboardingStepId('goal')).toBe(true);
  });
});

describe('onboarding resume position', () => {
  it('resumes at the first step when nothing was saved', () => {
    const storage = new FakeStorage();
    expect(readOnboardingResumeStep('owner-1', storage)).toBe('language');
  });

  it('round-trips a saved step for its own owner only', () => {
    const storage = new FakeStorage();
    writeOnboardingResumeStep('owner-1', 'pace', storage);
    expect(readOnboardingResumeStep('owner-1', storage)).toBe('pace');
    expect(readOnboardingResumeStep('owner-2', storage)).toBe('language');
    expect(hasOnboardingInProgress('owner-1', storage)).toBe(false);
  });

  it('clears back to the first step', () => {
    const storage = new FakeStorage();
    writeOnboardingResumeStep('owner-1', 'aha', storage);
    clearOnboardingResumeStep('owner-1', storage);
    expect(readOnboardingResumeStep('owner-1', storage)).toBe('language');
  });

  it('marks an in-progress owner separately from a saved step', () => {
    const storage = new FakeStorage();
    writeOnboardingResumeStep('owner-1', 'reminder', storage);
    expect(hasOnboardingInProgress('owner-1', storage)).toBe(false);
    markOnboardingInProgress('owner-1', storage);
    expect(hasOnboardingInProgress('owner-1', storage)).toBe(true);
    expect(hasOnboardingInProgress('owner-2', storage)).toBe(false);
    clearOnboardingInProgress('owner-1', storage);
    expect(hasOnboardingInProgress('owner-1', storage)).toBe(false);
  });
});

describe('goal countdown', () => {
  const today = new Date(2026, 10, 19, 23, 30);

  it('counts whole local calendar days to the goal date', () => {
    expect(daysUntilGoalDate('2026-11-19', today)).toBe(0);
    expect(daysUntilGoalDate('2026-11-20', today)).toBe(1);
    expect(daysUntilGoalDate('2027-02-13', today)).toBe(86);
    expect(daysUntilGoalDate('2026-11-01', today)).toBe(-18);
  });

  it('counts across a daylight-saving change without drifting a day', () => {
    expect(daysUntilGoalDate('2027-04-01', new Date(2027, 2, 1))).toBe(31);
  });

  it('ignores a missing, malformed or impossible date', () => {
    expect(daysUntilGoalDate('', today)).toBeNull();
    expect(daysUntilGoalDate('19/12/2026', today)).toBeNull();
    expect(daysUntilGoalDate('2027-02-30', today)).toBeNull();
  });

  it('turns days into countdown weeks, with exam week as the last one', () => {
    expect(countdownWeeks(0)).toBe(1);
    expect(countdownWeeks(7)).toBe(1);
    expect(countdownWeeks(8)).toBe(2);
    expect(countdownWeeks(86)).toBe(13);
    expect(MAX_COUNTDOWN_WEEKS).toBe(12);
  });
});
