import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('uses the typed extractor and never parses model JSON in the component', () => {
    const source = readFileSync(fileURLToPath(new URL('./WordExtractorModal.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('extractVocabulary');
    expect(source).not.toContain('translateText');
    expect(source).not.toContain('JSON.parse');
  });
});
