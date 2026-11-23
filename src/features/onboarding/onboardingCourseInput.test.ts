import { describe, expect, it } from 'vitest';
import { normalizeCreateCourseInput } from '../courses/courseModel';
import { onboardingCourseInput } from './OnboardingJourney';

const input = (goalKind: string, goalLevel: string) => onboardingCourseInput({
  targetLanguage: 'ja', nativeLanguage: 'vi', goalKind, goalLevel, goalTargetDate: '', zhScript: null,
});

describe('the goal level a learner types during onboarding', () => {
  it('is sent in its canonical form, so a level typed with an IME is accepted by the course contract', () => {
    for (const [typed, canonical] of [['Ｎ３', 'N3'], ['TOPIK Ⅱ', 'TOPIK II'], ['  N3   upper  ', 'N3 upper']] as const) {
      const course = input('jlpt', typed);
      expect(course.goals?.[0]?.level).toBe(canonical);
      expect(() => normalizeCreateCourseInput(course)).not.toThrow();
    }
  });

  it('is left empty when only blanks were typed', () => {
    expect(input('jlpt', '  　 ').goals?.[0]?.level).toBeNull();
  });
});
