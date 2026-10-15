import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';

export const LEARNING_WORKSPACE_ID = 'learning-workspace';

export function SkipToContentLink() {
  return (
    <a
      href={`#${LEARNING_WORKSPACE_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-xl focus:border focus:border-[var(--sf-brand)] focus:bg-[var(--sf-surface)] focus:px-4 focus:py-2.5 focus:font-bold focus:text-[var(--sf-text)] focus:shadow-xl"
    >
      <Trans {...msg({ context: 'shell.skip-content', message: 'Skip to content' })} />
    </a>
  );
}
