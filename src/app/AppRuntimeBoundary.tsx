import React, { type ErrorInfo, type ReactNode } from 'react';

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

    return (
      <aside className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-lg items-center justify-between gap-4 rounded-2xl border border-red-300/40 bg-[#101820] p-4 text-sm text-white shadow-2xl" role="alert">
        <p>Workspace could not load.</p>
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-xl bg-cyan-300 px-4 py-2 font-bold text-[#061014] transition hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200"
          onClick={this.props.onRetry}
        >
          Retry workspace
        </button>
      </aside>
    );
  }
}
