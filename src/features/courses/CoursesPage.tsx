import { useEffect, useState, type RefObject } from 'react';
import { useUiLocale } from '../../i18n/I18nProvider';
import { useAccountProfileNativeLanguage } from '../profileCompletion/AccountProfileContext';
import { AddCourseDialog, defaultCourseNativeLanguage } from './AddCourseDialog';
import { useCourseSession } from './CourseGate';
import { CoursesSurface, type CourseSwitch } from './CoursesSurface';
import type { Course, CourseTargetLanguage } from './courseModel';
import type { CourseCardCountReader } from './useCourseCardCounts';
import { useCourseDueCounts, type CourseDueCountReader } from './useCourseDueCounts';

export interface CoursesPageProps {
  /** Starts today's study for the active course. */
  readonly onStudy: () => void;
  /** A course whose goals the page opens on, as a goals link names it. */
  readonly initialGoalsCourseId?: string | null;
  /** The view heading the app focuses after a navigation; the page title takes it. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  /** Grows on each navigation that moves focus to the view heading. */
  readonly focusIntent?: number;
  /** Count readers; the app's Firestore aggregate counts by default. */
  readonly readDueCount?: CourseDueCountReader;
  readonly readCardCount?: CourseCardCountReader;
}

/**
 * The courses surface as the `?view=courses` page under the app navigation. Each time the page
 * opens it reads what the dialog reads: one aggregate due count per open course here, and two
 * aggregate card counts per open course in the surface. Switching, goals, archive and reopen go
 * through the shared course session; adding a language opens the switcher's add dialog.
 */
export function CoursesPage({ onStudy, initialGoalsCourseId = null, headingRef, focusIntent = 0, readDueCount, readCardCount }: CoursesPageProps) {
  const uiLocale = useUiLocale();
  const profileNativeLanguage = useAccountProfileNativeLanguage();
  const { model, actions } = useCourseSession();
  const [switched, setSwitched] = useState<CourseSwitch | null>(null);
  const [adding, setAdding] = useState<{ readonly language: CourseTargetLanguage | null } | null>(null);
  const profile = model.status === 'ready' ? model.profile : null;
  const openLanguages = (profile?.courses ?? []).filter(course => course.status === 'active').map(course => course.targetLanguage);
  const ready = profile !== null;
  const dueCounts = useCourseDueCounts(model.ownerId, openLanguages, ready, readDueCount);

  // The heading mounts with the profile; later profile updates do not pull focus back to it.
  useEffect(() => {
    if (ready && focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingRef, ready]);

  if (!profile) return null;
  const switchTo = async (course: Course) => {
    const from = model.activeCourse;
    setSwitched(null);
    if ((await actions.switchCourse(course.id)).ok) setSwitched({ from: from?.targetLanguage ?? null, to: course.targetLanguage });
  };
  return <div className="course-manage-page" data-courses-page="">
    <CoursesSurface dueCounts={dueCounts} switched={switched} initialGoalsCourseId={initialGoalsCourseId}
      onSwitch={course => void switchTo(course)}
      onAddLanguage={language => setAdding({ language: language ?? null })}
      onStudy={onStudy}
      readCardCount={readCardCount}
      renderTitle={title => <h1 ref={headingRef} tabIndex={-1} className="course-manage__title">{title}</h1>} />
    <AddCourseDialog open={adding !== null} onOpenChange={open => { if (!open) setAdding(null); }}
      courses={profile.courses} pending={model.pending} initialTarget={adding?.language ?? null}
      defaultNativeLanguage={defaultCourseNativeLanguage(profileNativeLanguage, model.activeCourse, uiLocale)}
      profileNativeLanguage={profileNativeLanguage}
      onCreate={async input => (await actions.createCourse(input)).ok} />
  </div>;
}
