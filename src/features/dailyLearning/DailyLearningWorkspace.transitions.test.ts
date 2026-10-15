import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { cardsForLanguagePair } from '../practice/practiceModel';
import { buildDailyPlan } from './dailyPlan';
import { dailyTodayStatus, didDailyPracticePoolScopeChange, freshItemsForResume, hasMatchOnlySession } from './DailyLearningWorkspace';
import { getEligibleExerciseModes } from './exerciseEngine';
import { buildPlacementCheck } from './placementEngine';

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

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `meaning ${id}`,
  language: 'en',
  createdAt: '2026-10-01T00:00:00.000Z',
  difficulty: 'unrated',
  reviews: 0,
  ...overrides,
} as CardData);

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

  it('marks Daily Match as an immersive shell without changing standalone Match', () => {
    const matchRender = source.slice(source.indexOf("if (activeMultiStage?.phase.kind === 'match'"), source.indexOf("if (routeLesson === 'placement')"));
    expect(matchRender).toContain('data-active-daily-match="true"');
  });

  it('never delays the non-optimistic rate → advance commit with a haptic or sound call', () => {
    // `session.rate` is the only path that calls the reviewCardV2 callable (via
    // dailySessionController); this proves none of the transition cues above were added
    // inside that call itself, which stays a plain, un-gated `session.rate(rating)`.
    expect(source).toContain('const rate = session.rate(rating);');
    const rateCallSite = source.slice(source.indexOf('rate: rating =>'), source.indexOf('retryRating:'));
    expect(rateCallSite).not.toContain('triggerHaptic');
    expect(rateCallSite).not.toContain('playRewardSound');
  });

  it('clears the outgoing owner or course pointer before resetting session state, without clearing on mount', () => {
    expect(source).toContain('const previousSessionScopeRef = useRef({ ownerId, targetLanguage, translationLanguage });');
    const switchEffect = source.slice(source.indexOf('const previousScope = previousSessionScopeRef.current;'), source.indexOf('if (lastPoolLoaderRef.current'));
    expect(switchEffect).toContain('const previousScope = previousSessionScopeRef.current;');
    expect(switchEffect).toContain('previousScope.ownerId !== ownerId || previousScope.targetLanguage !== targetLanguage');
    expect(switchEffect).toContain('if (previousScope.ownerId) clearDailySessionPointer(previousScope.ownerId);');
    expect(switchEffect).toContain('previousSessionScopeRef.current = { ownerId, targetLanguage, translationLanguage };');
  });

  it('does not let a stale pre-switch session overwrite the incoming owner pointer', () => {
    const scopeGuard = source.slice(source.indexOf('const isCurrentSession'), source.indexOf('const isCurrentMatch'));
    expect(scopeGuard).toContain('targetLanguageRef.current === targetLanguage');
    expect(scopeGuard).toContain('translationLanguageRef.current === translationLanguage');
    expect(scopeGuard).toContain('state.ownerId === ownerRef.current');
    expect(scopeGuard).toContain('state.targetLanguage === targetLanguage');
    expect(scopeGuard).toContain('state.translationLanguage === translationLanguage');
    const persistEffect = source.slice(source.indexOf('if (!isCurrentSession(multiStage)) return;'), source.indexOf('const activePool:'));
    expect(persistEffect).toContain('if (!isCurrentSession(multiStage)) return;');
  });

  it('subscribes to same-owner, same-pair WebWords promotions, reopens completed new lessons, and redirects a review bridge to new', () => {
    expect(source).toContain("import { subscribeToActiveSessionNewStagePromotions } from './webWordsSessionPriority'");
    const promotionEffect = source.slice(source.indexOf('useEffect(() => subscribeToActiveSessionNewStagePromotions'), source.indexOf('const plan: DailyPlan'));
    expect(promotionEffect).toContain('flushSync(() => {');
    expect(source).toContain('useLayoutEffect(() => {\n    multiStageRef.current = multiStage;\n  }, [multiStage]);');
    expect(promotionEffect).toContain('state.ownerId !== promotion.ownerId');
    expect(promotionEffect).toContain('state.targetLanguage !== promotion.languagePair.targetLanguage');
    expect(promotionEffect).toContain('state.translationLanguage !== promotion.languagePair.translationLanguage');
    expect(promotionEffect).toContain('freshItemsForResume(promotion.logicalIds, dailyCardsRef.current, new Date())');
    expect(promotionEffect).toContain('fresh: [...admitted, ...state.stagePlan.fresh]');
    expect(promotionEffect).toContain('const committed = multiStageRef.current;');
    expect(promotionEffect).toContain('pointerForSession(committed)');
    expect(promotionEffect).toContain('session.append(exercisesFor(admitted, currentPairCards));');
    expect(promotionEffect).toContain("nextStage: 'new' as const");
    expect(promotionEffect).toContain('return admitted.map(item => item.logicalId);');
  });

  it('hides every multi-stage render branch until its owner and course scope match the current props', () => {
    expect(source).toContain('const activeMultiStage = isCurrentSession(multiStage) ? multiStage : null;');
    expect(source).toContain('const activeLesson = lessonScope.ownerId === ownerId && lessonScope.targetLanguage === targetLanguage && lessonScope.translationLanguage === translationLanguage && (!multiStage || activeMultiStage) ? lesson : null;');
    const renderedStages = source.slice(source.indexOf('const activeMultiStage'), source.indexOf("if (routeLesson === 'placement')"));
    expect(renderedStages).toContain("if (activeMultiStage?.phase.kind === 'bridge')");
    expect(renderedStages).toContain("if (activeMultiStage?.phase.kind === 'match')");
    expect(renderedStages).not.toContain("if (multiStage?.phase.kind === 'bridge')");
    expect(renderedStages).not.toContain("if (multiStage?.phase.kind === 'match')");
    expect(source).toContain("{activeMultiStage?.phase.kind === 'recap' && (");
  });

  it('hides standalone lessons from another course and prevents their retained rating action', () => {
    expect(source).toContain('const lessonScopeRef = useRef({ ownerId, targetLanguage, translationLanguage });');
    expect(source).toContain('lessonScopeRef.current = { ownerId: ownerRef.current, targetLanguage, translationLanguage };');
    const lessonRender = source.slice(source.indexOf('if (activeLesson && currentExercise)'), source.indexOf('const weakCards:'));
    expect(lessonRender).toContain('const isCurrentLessonScope = () => lessonScopeRef.current === lessonScope');
    expect(lessonRender).toContain('if (!isCurrentLessonScope()) return;');
    expect(lessonRender).toContain('retryRating: () => {');
    expect(lessonRender).toContain('if (!isCurrentLessonScope()) return;');
    expect(lessonRender).toContain('session.retry().then(result => recordReview(result, pending.operationId, pending.itemId, pending.rating))');
  });

  it('uses the full language pair when resuming a session and restores only matching Word Match cards', () => {
    const resumeEffect = source.slice(source.indexOf('const pointer = readDailySessionPointer'), source.indexOf('const activeMultiStage'));
    expect(resumeEffect).toContain('pointer.translationLanguage !== translationLanguage');
    expect(resumeEffect).toContain('restoredSessionMatchStage(activePool.cards, pointer.matchCardIds, { targetLanguage, translationLanguage }, Boolean(pointer.matchStartOpId))');
    expect(resumeEffect).toContain('sessionStageItemCount(stagePlan, pointer.stage) === 0');
    expect(resumeEffect).toContain('translationLanguage, stagePlan, stats: pointer.stats');
    expect(resumeEffect).toContain('pointer.bridgeCompletedStage');
    expect(resumeEffect).toContain("{ kind: 'bridge', completedStage: pointer.bridgeCompletedStage, nextStage: resumeStage }");
  });

  it('builds review and new stages from the active language pair while retaining the full pool only for Match filtering', () => {
    expect(source).toContain('const currentPairCards = useMemo(');
    expect(source).toContain('cardsForLanguagePair(activePool.cards, targetLanguage, translationLanguage)');
    expect(source).toContain('buildDailyPlan(currentPairCards, { now: new Date() })');
    expect(source).toContain('buildSessionStagePlan(sessionPlan, activePool.cards, Math.random');
  });

  it('keeps Placement eligibility and recognition options inside the active language pair', () => {
    const activePair = Array.from({ length: 4 }, (_, index) => card(`ko-en-${index}`, {
      word: `한국어 ${index}`, translation: `English ${index}`, language: 'ko', translationLanguage: 'en', cefrLevel: 'A1',
    }));
    const foreignPair = Array.from({ length: 2 }, (_, index) => card(`ko-vi-${index}`, {
      word: `한국어 외국어 ${index}`, translation: `Tiếng Việt ${index}`, language: 'ko', translationLanguage: 'vi', cefrLevel: 'A1',
    }));
    const currentPairCards = cardsForLanguagePair([...activePair, ...foreignPair], 'ko', 'en');
    const placementCandidates = currentPairCards.filter(candidate => (
      getEligibleExerciseModes(candidate, currentPairCards).includes('recognition')
    ));

    expect(buildPlacementCheck(placementCandidates)).toEqual({ status: 'insufficient', eligibleCount: 4, requiredCount: 6 });
    expect(source).toContain('getEligibleExerciseModes(card, currentPairCards).includes(\'recognition\')');
    expect(source).toContain('buildExercise(item.card, currentPairCards, \'recognition\')');
    expect(source).toContain('card, currentPairCards, mode, inferScriptScoringPolicy(card.word)');
    expect(source).toContain('session.start(exercisesFor(items, currentPairCards));');
  });

  it('does not call Match services while offline, including completion replay', () => {
    const startEffect = source.slice(source.indexOf("activeMultiStage.phase.kind !== 'match' || activeMultiStage.matchStatus !== 'idle'"), source.indexOf('const completeDailyMatch'));
    const completionStart = source.indexOf('const completeDailyMatch');
    const completion = source.slice(completionStart, source.indexOf('const lessonScope =', completionStart));
    expect(startEffect).toContain('if (isOffline)');
    expect(startEffect.indexOf('if (isOffline)')).toBeLessThan(startEffect.indexOf('firebasePracticeSessionService.start'));
    expect(completion).toContain('if (isOffline)');
    expect(completion.indexOf('if (isOffline)')).toBeLessThan(completion.indexOf('firebasePracticeSessionService.complete'));
  });

  it('persists an offline Match completion, keeps Back from clearing it, and offers an explicit Abandon path', () => {
    const completionStart = source.indexOf('const completeDailyMatch');
    const completion = source.slice(completionStart, source.indexOf('const lessonScope =', completionStart));
    expect(completion.indexOf('writeDailySessionPointer(pointer)')).toBeLessThan(completion.indexOf('if (isOffline) return null;'));
    const matchError = source.slice(source.indexOf("if (activeMultiStage?.phase.kind === 'match')"), source.indexOf("if (routeLesson === 'placement')"));
    expect(matchError).toContain('const hasRetainedCompletion = completionFailed || activeMultiStage.matchCompletionPending;');
    expect(matchError).toContain('onClick={hasRetainedCompletion ? finishMatchStage : exitMultiStageSession}');
    expect(matchError).toContain('hasRetainedCompletion && <button type="button" onClick={exitMultiStageSession}');
  });

  it('restores a queued new word after reload even when fifteen reviews fill the daily cap', () => {
    const now = new Date('2026-10-02T08:00:00.000Z');
    const reviews = Array.from({ length: 15 }, (_, index) => card(`due-${index}`, {
      reviews: 1,
      difficulty: 'good',
      nextReviewDate: '2026-10-01T00:00:00.000Z',
    }));
    const selectedWebWord = card('web-word');
    const learnedWord = card('learned-word', {
      reviews: 3,
      difficulty: 'good',
      nextReviewDate: '2026-10-03T00:00:00.000Z',
    });
    const pool = [...reviews, selectedWebWord, learnedWord];

    expect(buildDailyPlan(pool, { now, freshPriorityLogicalIds: ['web-word'] }).items).not.toContainEqual(expect.objectContaining({ logicalId: 'web-word' }));
    expect(freshItemsForResume(['web-word', 'learned-word', 'web-word'], pool, now)).toEqual([
      expect.objectContaining({ logicalId: 'web-word', reason: 'new' }),
    ]);
  });

  it('does not reload the target practice pool for a native-only switch', () => {
    const loadPracticePool = vi.fn();
    let previousScope: { ownerId: string | null; targetLanguage: string } | null = null;
    const updateScope = (nextScope: { ownerId: string | null; targetLanguage: string }) => {
      if (!didDailyPracticePoolScopeChange(previousScope, nextScope)) return;
      previousScope = nextScope;
      loadPracticePool();
    };

    updateScope({ ownerId: 'owner-1', targetLanguage: 'ko' }); // ko→vi
    updateScope({ ownerId: 'owner-1', targetLanguage: 'ko' }); // ko→en
    expect(loadPracticePool).toHaveBeenCalledTimes(1);

    updateScope({ ownerId: 'owner-1', targetLanguage: 'en' });
    expect(loadPracticePool).toHaveBeenCalledTimes(2);
  });

  it('keeps Start available for a Match-only session without inventing daily-plan cards', () => {
    const plan = buildDailyPlan([], { now: new Date('2026-10-02T08:00:00.000Z') });
    const pool = [card('pair-1'), card('pair-2'), card('pair-3'), card('pair-4')];

    expect(plan.items).toEqual([]);
    expect(hasMatchOnlySession(plan, pool, 'en', 'vi')).toBe(true);
    expect(dailyTodayStatus('ready', plan, true, true, false)).toBe('ready');
    expect(source).toContain("if (!plan) { void continueReview(); return; }");
    expect(source).toContain('status: dailyTodayStatus(activePool.status, plan, currentPairCards.length > 0, matchOnlySession, isOffline)');
    expect(source).toContain('const caughtUp = isCaughtUpDailyPlan(plan, currentPairCards.length > 0, matchOnlySession);');
  });

  it('passes the unavailable Match skip reason to the recap bridge', () => {
    expect(source).toContain('skippedUnavailableMatchStage(activeMultiStage.stagePlan, completedStage, nextStage)');
  });
});
