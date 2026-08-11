import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEARNING_WORKSPACE_ID, SkipToContentLink } from './SkipToContentLink';

describe('SkipToContentLink', () => {
  it('stays out of sight until focused and targets the learning workspace', () => {
    const html = renderToStaticMarkup(<SkipToContentLink />);

    expect(html).toContain(`href="#${LEARNING_WORKSPACE_ID}"`);
    expect(html).toContain('sr-only focus:not-sr-only');
    expect(html).toContain('focus:fixed');
    expect(html).toContain('Skip to content');
  });
});
