import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { APPLICATION_SUPPORT_HREF, ApplicationErrorPanel } from '../components/ApplicationErrorPanel';

export default function AppRuntimeError({ onRetry }: { onRetry: () => void }) {
  const { _ } = useLingui();
  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto">
      <ApplicationErrorPanel
        title={_(msg({ id: 'shell.runtime-error.message', message: 'Workspace could not load.' }))}
        description={_(msg({ id: 'shell.error-boundary.description.recovery', message: 'This screen hit an error. Reloading may restore the interface.' }))}
        actionLabel={_(msg({ id: 'shell.runtime-error.retry', message: 'Retry workspace' }))}
        onAction={onRetry}
        reportHref={APPLICATION_SUPPORT_HREF}
        reportLabel={_(msg({ id: 'shell.error-boundary.report-issue', message: 'Report issue' }))}
      />
    </div>
  );
}
