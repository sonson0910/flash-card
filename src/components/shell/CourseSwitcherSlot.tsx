import { lazy, Suspense } from 'react';
import { useCourseSession } from '../../features/courses/CourseGate';
import type { CourseSwitcherControlProps } from './CourseSwitcherControl';

const CourseSwitcherControl = lazy(() => import('./CourseSwitcherControl').then(module => ({ default: module.CourseSwitcherControl })));

export interface CourseSwitcherSlotProps extends CourseSwitcherControlProps {
  readonly signedIn: boolean;
}

/**
 * The real course switcher: a desktop popover / mobile bottom sheet driven
 * by `CourseGate`, with the add-a-language dialog and the courses surface. Its own module stays a thin lazy-mount wrapper so the
 * icons, forms and goal panel inside `CourseSwitcherControl` never enter the
 * initial bundle; they load once, the first time a signed-in owner renders it.
 */
export function CourseSwitcherSlot({ signedIn, ...controlProps }: CourseSwitcherSlotProps) {
  const { model } = useCourseSession();
  if (!signedIn || (model.status !== 'ready' && model.status !== 'error')) return null;
  return <div className="claude-course-switcher-slot flex min-w-0 items-center">
    <Suspense fallback={null}><CourseSwitcherControl {...controlProps} /></Suspense>
  </div>;
}
