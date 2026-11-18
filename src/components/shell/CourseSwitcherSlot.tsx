import { lazy, Suspense } from 'react';
import { useCourseSession } from '../../features/courses/CourseGate';

const CourseSwitcherControl = lazy(() => import('./CourseSwitcherControl').then(module => ({ default: module.CourseSwitcherControl })));

export interface CourseSwitcherSlotProps {
  readonly signedIn: boolean;
}

/**
 * The real course switcher: a desktop popover / mobile bottom sheet driven
 * by `CourseGate`. Its own module stays a thin lazy-mount wrapper so the
 * icons, forms and goal panel inside `CourseSwitcherControl` never enter the
 * initial bundle; they load once, the first time a signed-in owner renders it.
 */
export function CourseSwitcherSlot({ signedIn }: CourseSwitcherSlotProps) {
  const { model } = useCourseSession();
  if (!signedIn || (model.status !== 'ready' && model.status !== 'error')) return null;
  return <div className="claude-course-switcher-slot flex min-w-0 items-center">
    <Suspense fallback={null}><CourseSwitcherControl /></Suspense>
  </div>;
}
