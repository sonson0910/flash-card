import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Trans } from '@lingui/react';

export interface CourseSwitcherSlotProps {
  readonly signedIn: boolean;
  readonly courseLabel?: ReactNode;
  readonly children?: ReactNode;
}

/** Keeps the shell geometry stable until the course picker is delivered. */
export function CourseSwitcherSlot({ signedIn, courseLabel, children }: CourseSwitcherSlotProps) {
  if (!signedIn) return null;
  return <div className="hidden min-w-0 items-center xl:flex max-[479px]:order-3 max-[479px]:flex max-[479px]:basis-full max-[479px]:justify-center">{children ?? <span className="flex h-10 max-w-56 items-center gap-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-xs font-semibold text-[var(--sf-text)] max-[479px]:max-w-full"><span className="truncate">{courseLabel ?? <Trans id="shell.course.current" message="English ← Tiếng Việt" />}</span><ChevronDown size={14} aria-hidden="true" className="shrink-0 text-[var(--sf-text-muted)]" /></span>}</div>;
}
