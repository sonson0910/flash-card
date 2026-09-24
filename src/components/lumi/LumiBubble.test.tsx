import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LumiBubble } from './LumiBubble';

describe('LumiBubble', () => {
  it('renders the localized message node supplied by its caller', () => {
    expect(renderToStaticMarkup(<LumiBubble message={<strong>Translated message</strong>} />))
      .toContain('<aside><strong>Translated message</strong></aside>');
  });
});
