import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `DailyLearningWorkspace.tsx` has no render harness in this repo's toolchain (no jsdom or
// testing-library; see AppShellMotion.test.ts for the same source-based pattern used across
// this codebase), and it is too large an integration surface — pool loading, the review
// callable, session-pointer persistence — to mount just to prove five one-line haptic calls
// are wired correctly. This instead proves each transition routes through the shared, already
// -gated `triggerHaptic` helper (never a raw `navigator.vibrate`), and that the rate → advance
// commit path through `session.rate` is untouched by any of these additions. The gating itself
// (haptics-off, reduced-motion, page-hidden) is covered where `triggerHaptic` lives, in
// `src/lib/haptics.test.ts`.
const source = readFileSync(fileURLToPath(new URL('./DailyLearningWorkspace.tsx', import.meta.url)), 'utf8');

describe('DailyLearningWorkspace session transitions', () => {
  it('imports the gated haptics helper and never touches navigator.vibrate directly', () => {
    expect(source).toContain("import { triggerHaptic } from '../../lib/haptics'");
    expect(source).not.toContain('navigator.vibrate');
  });

  it('gives the Today → review/new session start a light cue', () => {
    const fn = source.slice(source.indexOf('const beginMultiStageSession'), source.indexOf('const advanceMultiStage'));
    expect(fn).toContain("triggerHaptic('light')");
  });

  it('gives a completed review/new stage arriving at the bridge a stronger cue', () => {
    const fn = source.slice(source.indexOf('const advanceMultiStage'), source.indexOf('const continueToNextStage'));
    expect(fn).toContain("triggerHaptic('success')");
  });

  it('gives the bridge Continue and Skip actions a forward-navigation cue', () => {
    const continueFn = source.slice(source.indexOf('const continueToNextStage'), source.indexOf('const skipUpcomingStage'));
    const skipFn = source.slice(source.indexOf('const skipUpcomingStage'), source.indexOf('const finishMatchStage'));
    expect(continueFn).toContain("triggerHaptic('light')");
    expect(skipFn).toContain("triggerHaptic('light')");
  });

  it('gives the match stage closing into recap a forward-navigation cue', () => {
    const fn = source.slice(source.indexOf('const finishMatchStage'), source.indexOf('const retryWeakCards'));
    expect(fn).toContain("triggerHaptic('light')");
  });

  it('never delays the non-optimistic rate → advance commit with a haptic or sound call', () => {
    // `session.rate` is the only path that calls the reviewCardV2 callable (via
    // dailySessionController); this proves none of the transition cues above were added
    // inside that call itself, which stays a plain, un-gated `session.rate(rating)`.
    expect(source).toContain('void session.rate(rating).then(result =>');
    const rateCallSite = source.slice(source.indexOf('rate: rating =>'), source.indexOf('retryRating:'));
    expect(rateCallSite).not.toContain('triggerHaptic');
    expect(rateCallSite).not.toContain('playRewardSound');
  });
});
