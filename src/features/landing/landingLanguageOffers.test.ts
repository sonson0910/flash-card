import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COURSE_TARGET_LANGUAGES } from '../courses/courseModel';
import { landingLanguageOffers } from './landingLanguageOffers';

describe('landing language list', () => {
  it('lists exactly the languages a learner can start a course in', () => {
    expect(landingLanguageOffers).toEqual([...COURSE_TARGET_LANGUAGES]);
  });

  it('does not describe any listed language as unavailable', () => {
    const page = readFileSync(new URL('./LandingPage.tsx', import.meta.url), 'utf8');
    expect(page).not.toContain('landing.languages.status.in-progress');
    expect(page).not.toMatch(/not yet available to switch to/);
  });
});
