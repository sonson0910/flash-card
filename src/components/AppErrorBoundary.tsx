import React, { type ErrorInfo, type ReactNode } from 'react';

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
    console.error('Unhandled application render error', {
      name: error.name,
      componentStack: info.componentStack?.slice(0, 1000),
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--sf-canvas)] p-6 text-[var(--sf-text)]">
        <section className="max-w-md rounded-3xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-8 text-center shadow-2xl" role="alert">
          <h1 className="text-balance text-2xl font-black">SonFlash needs a reload</h1>
          <p className="mt-3 text-pretty text-[var(--sf-text-muted)]">Your saved data is safe. Reload the app to restore the interface.</p>
          <button
            type="button"
            className="mt-6 min-h-11 rounded-xl bg-[var(--sf-brand)] px-5 py-3 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sf-brand)]"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </section>
      </main>
    );
  }
}
