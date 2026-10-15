import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS, clearOnboardingInProgress, clearOnboardingResumeStep, firstOnboardingStep,
  hasOnboardingInProgress, isOnboardingStepId, markOnboardingInProgress,
  nextOnboardingStep, previousOnboardingStep, readOnboardingResumeStep, writeOnboardingResumeStep,
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
