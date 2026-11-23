import React, { type ErrorInfo, type ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { APPLICATION_SUPPORT_HREF, ApplicationErrorPanel } from './ApplicationErrorPanel';

const errorCopy = {
  title: msg({ id: 'shell.error-boundary.title', message: 'Something went sideways.' }),
  description: msg({ id: 'shell.error-boundary.description.recovery', message: 'This screen hit an error. Reloading may restore the interface.' }),
  reload: msg({ id: 'shell.error-boundary.reload', message: 'Reload app' }),
  report: msg({ id: 'shell.error-boundary.report-issue', message: 'Report issue' }),
};

const recoveryCopy = (id: string, fallback: string) => {
  // Lingui throws when no locale was ever activated (a catalog failed on the first visit).
  const translated = i18n.locale ? i18n._(id) : id;
  return translated === id ? fallback : translated;
};

/** Logs the error name and a bounded component stack, never the message, which can quote learner content. */
export const logRenderError = (error: Error, info: ErrorInfo) => {
  console.error('Render error', {
    name: error.name,
    componentStack: info.componentStack?.slice(0, 1000),
  });
};

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logRenderError(error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ApplicationErrorPanel
        title={recoveryCopy(errorCopy.title.id, 'Something went sideways.')}
        description={recoveryCopy(errorCopy.description.id, 'This screen hit an error. Reloading may restore the interface.')}
        actionLabel={recoveryCopy(errorCopy.reload.id, 'Reload app')}
        onAction={() => window.location.reload()}
        reportHref={APPLICATION_SUPPORT_HREF}
        reportLabel={recoveryCopy(errorCopy.report.id, 'Report issue')}
      />
    );
  }
}
