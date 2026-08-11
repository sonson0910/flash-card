import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecoverableActionFeedback } from './RecoverableActionFeedback';

describe('RecoverableActionFeedback', () => {
  it('announces a user-safe failure and exposes retry and dismiss controls', () => {
    const html = renderToStaticMarkup(
      <RecoverableActionFeedback
        message="The action could not be completed. Please try again."
        retryLabel="Try again"
        onRetry={vi.fn()}
        dismissLabel="Dismiss action error"
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('The action could not be completed. Please try again.');
    expect(html).toContain('>Try again</button>');
    expect(html).toContain('aria-label="Dismiss action error"');
  });

  it('can expose a dismissible message without adding a redundant retry control', () => {
    const html = renderToStaticMarkup(
      <RecoverableActionFeedback
        message="Copy the link manually or try the copy button again."
        dismissLabel="Dismiss copy error"
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).not.toContain('>Try again</button>');
    expect(html).toContain('aria-label="Dismiss copy error"');
  });
});
