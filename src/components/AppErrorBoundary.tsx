import React, { type ErrorInfo, type ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import lumiOops from '../assets/lumi/lumi-oops.webp';

const errorCopy = {
  title: msg({ id: 'shell.error-boundary.title', message: 'SonFlash needs a reload' }),
  description: msg({ id: 'shell.error-boundary.description', message: 'Your saved data is safe. Reload the app to restore the interface.' }),
  reload: msg({ id: 'shell.error-boundary.reload', message: 'Reload app' }),
};

const recoveryCopy = (id: string, fallback: string) => {
  const translated = i18n._(id);
  return translated === id ? fallback : translated;
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
    console.error('Unhandled application render error', {
      name: error.name,
      componentStack: info.componentStack?.slice(0, 1000),
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const isCrystal = globalThis.document?.documentElement.dataset.themeFamily === 'crystal';
    return (
      <main className="app-error-screen crystal-starfield">
        <section className="app-error-panel crystal-chamfer" role="alert">
          {isCrystal ? <img src={lumiOops} alt="" aria-hidden="true" width={72} height={72} className="crystal-ornament mx-auto mb-3" /> : null}
          <h1 className="app-error-title">{recoveryCopy(errorCopy.title.id, 'SonFlash needs a reload')}</h1>
          <p className="app-error-description">{recoveryCopy(errorCopy.description.id, 'Your saved data is safe. Reload the app to restore the interface.')}</p>
          <button
            type="button"
            className="app-error-reload"
            onClick={() => window.location.reload()}
          >
            {recoveryCopy(errorCopy.reload.id, 'Reload app')}
          </button>
        </section>
      </main>
    );
  }
}
