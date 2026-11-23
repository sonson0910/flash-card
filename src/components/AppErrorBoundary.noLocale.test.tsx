import { i18n } from '@lingui/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

describe('AppErrorBoundary before any locale is active', () => {
  it('still renders the recovery panel in English', () => {
    expect(i18n.locale).toBeFalsy();
    const boundary = new AppErrorBoundary({ children: null });
    boundary.state = AppErrorBoundary.getDerivedStateFromError();

    const html = renderToStaticMarkup(boundary.render());

    expect(html).toContain('Reload app');
    expect(html).toContain('Report issue');
    expect(html).toContain('This screen hit an error. Reloading may restore the interface.');
  });
});
