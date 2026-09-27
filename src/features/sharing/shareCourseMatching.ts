import { COURSE_NATIVE_LANGUAGES, COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage } from '../courses/courseModel';
import type { CourseSessionActions, CourseSessionSnapshot } from '../courses/courseSessionController';
import type { SharedDeckIncomingPreview } from './sharedDeckSessionController';

export type ShareCourseAction = 'none' | 'switch' | 'reopen' | 'create';

export interface ShareCourseDecision {
  readonly action: ShareCourseAction;
  readonly targetLanguage: CourseTargetLanguage;
  readonly nativeLanguage: CourseNativeLanguage;
}

const asCourseTargetLanguage = (value: string): CourseTargetLanguage | null =>
  (COURSE_TARGET_LANGUAGES as readonly string[]).includes(value) ? value as CourseTargetLanguage : null;
const asCourseNativeLanguage = (value: string): CourseNativeLanguage | null =>
  (COURSE_NATIVE_LANGUAGES as readonly string[]).includes(value) ? value as CourseNativeLanguage : null;

/**
 * Read-only: never mutates anything. A share whose language pair is missing,
 * mixed, or outside the four supported course target languages resolves to
 * `null` — the accept flow then proceeds exactly as it did before this
 * feature existed, which is always the safe default.
 */
export function resolveShareCourseAction(
  preview: Pick<SharedDeckIncomingPreview, 'languagePairs'>,
  profile: Pick<NonNullable<CourseSessionSnapshot['profile']>, 'courses' | 'activeCourseId'> | null,
): ShareCourseDecision | null {
  const pairs = preview.languagePairs ?? [];
  if (pairs.length !== 1) return null;
  const [pair] = pairs;
  const targetLanguage = pair.targetLanguage ? asCourseTargetLanguage(pair.targetLanguage) : null;
  const nativeLanguage = pair.translationLanguage ? asCourseNativeLanguage(pair.translationLanguage) : null;
  if (!targetLanguage || !nativeLanguage) return null;
  if (!profile) return { action: 'create', targetLanguage, nativeLanguage };
  const matching = profile.courses.find(course => course.targetLanguage === targetLanguage);
  if (!matching) return { action: 'create', targetLanguage, nativeLanguage };
  if (matching.status === 'archived') return { action: 'reopen', targetLanguage, nativeLanguage };
  if (profile.activeCourseId !== matching.id) return { action: 'switch', targetLanguage, nativeLanguage };
  return { action: 'none', targetLanguage, nativeLanguage };
}

/** The optional dependency `sharedDeckSessionController.acceptShared()` calls before importing cards. */
export interface SharedDeckCoursePort {
  ensureCourseForIncomingShare(preview: SharedDeckIncomingPreview): Promise<void>;
}

/**
 * Wraps the real `useCourseSession()` value into the small port
 * `sharedDeckSessionController` depends on. Never throws: a course-matching
 * failure must not block the deck's cards from being imported, since the
 * cards themselves are already language-tagged and remain correct even if
 * the course they'd naturally belong to isn't ready yet.
 */
export function createSharedDeckCoursePort(courseSession: {
  readonly model: CourseSessionSnapshot;
  readonly actions: CourseSessionActions;
}): SharedDeckCoursePort {
  return {
    async ensureCourseForIncomingShare(preview) {
      const decision = resolveShareCourseAction(preview, courseSession.model.profile);
      if (!decision || decision.action === 'none') return;
      try {
        if (decision.action === 'create') {
          await courseSession.actions.createCourse({
            targetLanguage: decision.targetLanguage,
            nativeLanguage: decision.nativeLanguage,
            activateOnCreate: true,
          });
          return;
        }
        const matching = courseSession.model.profile?.courses.find(
          course => course.targetLanguage === decision.targetLanguage,
        );
        if (!matching) return;
        if (decision.action === 'reopen') await courseSession.actions.reopenCourse(matching.id);
        else if (decision.action === 'switch') await courseSession.actions.switchCourse(matching.id);
      } catch {
        // Best-effort: the shared cards still import under whatever course is active.
      }
    },
  };
}
