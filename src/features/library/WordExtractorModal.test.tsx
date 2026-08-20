import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WordExtractorContent, WordExtractorModal } from './WordExtractorModal';

describe('WordExtractorModal', () => {
  it('renders extractor content', () => {
    const html = renderToStaticMarkup(
      <WordExtractorContent
        onClose={vi.fn()}
        onImportWords={vi.fn()}
      />
    );

    expect(html).toContain('Scan');
    expect(html).toContain('Extract Vocabulary');
  });

  it('renders nothing when closed modal', () => {
    const html = renderToStaticMarkup(
      <WordExtractorModal
        open={false}
        onOpenChange={vi.fn()}
        onImportWords={vi.fn()}
      />
    );

    expect(html).toBe('');
  });
});
