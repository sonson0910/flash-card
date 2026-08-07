import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppFeedback } from './AppFeedback';

describe('AppFeedback', () => {
  it('renders compact, dismissible alert and status regions with preserved labels', () => {
    const html = renderToStaticMarkup(
      <AppFeedback
        authError="Sign-in failed."
        error="Import failed."
        notice="Import complete."
        onDismissAuthError={vi.fn()}
        onDismissError={vi.fn()}
        onDismissNotice={vi.fn()}
      />,
    );

    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('aria-label="Dismiss sign-in message"');
    expect(html).toContain('aria-label="Dismiss system message"');
    expect(html).toContain('aria-label="Dismiss success message"');
    expect(html).toContain('Sign-in failed.');
    expect(html).toContain('Import failed.');
    expect(html).toContain('Import complete.');
  });

  it('renders nothing when there is no feedback', () => {
    expect(renderToStaticMarkup(<AppFeedback />)).toBe('');
  });
});
