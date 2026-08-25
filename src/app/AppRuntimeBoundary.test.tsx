import { Children, isValidElement, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRuntimeBoundary } from './AppRuntimeBoundary';

describe('AppRuntimeBoundary', () => {
  it('keeps the landing recovery affordance after a runtime chunk error', () => {
    const onError = vi.fn();
    const onRetry = vi.fn();
    const error = new Error('Failed to fetch dynamically imported module');
    const boundary = new AppRuntimeBoundary({ children: null, onError, onRetry });

    boundary.state = AppRuntimeBoundary.getDerivedStateFromError(error);
    boundary.componentDidCatch(error, { componentStack: '' } as ErrorInfo);

    expect(boundary.state.error).toBe(error);
    expect(onError).toHaveBeenCalledWith(error);
    expect(renderToStaticMarkup(boundary.render())).toContain('Workspace could not load');

    const fallback = boundary.render() as ReactElement<{ children?: ReactNode }>;
    const retryButton = Children.toArray(fallback.props.children).find(
      child => isValidElement(child) && child.type === 'button',
    ) as ReactElement<{ onClick: () => void }>;
    retryButton.props.onClick();

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
