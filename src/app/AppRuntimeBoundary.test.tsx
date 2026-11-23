import { type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it, vi } from 'vitest';
import { AppRuntimeBoundary } from './AppRuntimeBoundary';
import AppRuntimeError from './app-runtime-error';

describe('AppRuntimeBoundary', () => {
  it('provides a retry action after a runtime chunk error', () => {
    const onError = vi.fn();
    const onRetry = vi.fn();
    const error = new Error('Failed to fetch dynamically imported module');
    const boundary = new AppRuntimeBoundary({ children: null, onError, onRetry });

    boundary.state = AppRuntimeBoundary.getDerivedStateFromError(error);
    boundary.componentDidCatch(error, { componentStack: '' } as ErrorInfo);

    expect(boundary.state.error).toBe(error);
    expect(onError).toHaveBeenCalledWith(error);
    i18n.load('en', {});
    i18n.activate('en');
    const errorHtml = renderToStaticMarkup(<I18nProvider i18n={i18n}><AppRuntimeError onRetry={onRetry} /></I18nProvider>);
    expect(errorHtml.match(/<h1>(.*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '')).toBe('Workspace could not load.');
    expect(renderToStaticMarkup(<I18nProvider i18n={i18n}>{boundary.render()}</I18nProvider>)).toContain('Retry workspace');

    const fallback = boundary.render() as ReactElement<{ fallback: ReactNode }>;
    const retryButton = fallback.props.fallback as ReactElement<{ onClick: () => void }>;
    retryButton.props.onClick();

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('logs the error name and a bounded component stack without the message', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const error = new TypeError('card body for a learner');
      const boundary = new AppRuntimeBoundary({ children: null, onError: vi.fn(), onRetry: vi.fn() });

      boundary.componentDidCatch(error, { componentStack: 'x'.repeat(3000) } as ErrorInfo);

      expect(logged).toHaveBeenCalledOnce();
      const [, details] = logged.mock.calls[0] as [string, { name: string; componentStack: string }];
      expect(details.name).toBe('TypeError');
      expect(details.componentStack).toHaveLength(1000);
      expect(JSON.stringify(logged.mock.calls)).not.toContain('learner');
    } finally {
      logged.mockRestore();
    }
  });
});
