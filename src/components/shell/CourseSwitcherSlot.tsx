import type { ReactNode } from 'react';

export interface CourseSwitcherSlotProps {
  readonly signedIn: boolean;
  readonly children?: ReactNode;
}

/** Holds real course-switcher UI once its data and action contract lands. */
export function CourseSwitcherSlot({ signedIn, children }: CourseSwitcherSlotProps) {
  if (!signedIn || !children) return null;
  return <div className="claude-course-switcher-slot hidden min-w-0 items-center xl:flex">{children}</div>;
}
