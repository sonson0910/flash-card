import React, { lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Trans } from '@lingui/react';

const AppRuntimeError = lazy(() => import('./app-runtime-error'));

interface AppRuntimeBoundaryProps {
  readonly children: ReactNode;
  readonly onError: (error: Error) => void;
  readonly onRetry: () => void;
}

interface AppRuntimeBoundaryState {
  readonly error: Error | null;
}

export class AppRuntimeBoundary extends React.Component<AppRuntimeBoundaryProps, AppRuntimeBoundaryState> {
  state: AppRuntimeBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppRuntimeBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <Suspense fallback={
      <button type="button" className="app-runtime-retry" onClick={this.props.onRetry}>
        <Trans id="shell.runtime-error.retry" message="Retry workspace" />
      </button>
    }><AppRuntimeError onRetry={this.props.onRetry} /></Suspense>;
  }
}
