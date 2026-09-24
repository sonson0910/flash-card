import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as Dialog from '@radix-ui/react-dialog';
import { i18n } from '@lingui/core';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { extractionFailureMessage, WordExtractorContent, WordExtractorModal } from './WordExtractorModal';

describe('WordExtractorModal', () => {
  it('renders extractor content', () => {
    const html = renderToStaticMarkup(
      <Dialog.Root open>
        <Dialog.Content>
          <WordExtractorContent
            onClose={vi.fn()}
            onImportWords={vi.fn()}
          />
        </Dialog.Content>
      </Dialog.Root>
    );

    expect(html).toContain('Scan text');
    expect(html).toContain('Extract vocabulary');
    const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(descriptionId).toBeTruthy();
    expect(html).toContain(`id="${descriptionId}"`);
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

  it('keeps actionable AI quota guidance', () => {
    expect(extractionFailureMessage(new ProtectedFunctionError({
      message: 'internal', kind: 'quota', code: 'resource-exhausted', retryable: false, reason: 'ai-card-quota',
    }))).toContain('adding words manually still works');
  });

  it('translates quota guidance when the active locale changes', () => {
    const failure = new ProtectedFunctionError({
      message: 'internal', kind: 'quota', code: 'resource-exhausted', retryable: false, reason: 'ai-card-quota',
    });
    i18n.load({
      en: { 'library.extract.error.ai-card-quota': 'Add words manually.' },
      vi: { 'library.extract.error.ai-card-quota': 'Bạn vẫn có thể tự thêm từ.' },
    });
    i18n.activate('en');
    expect(extractionFailureMessage(failure)).toBe('Add words manually.');
    i18n.activate('vi');
    expect(extractionFailureMessage(failure)).toBe('Bạn vẫn có thể tự thêm từ.');
  });
});
