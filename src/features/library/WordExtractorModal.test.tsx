import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Dialog from '@radix-ui/react-dialog';
import { i18n } from '@lingui/core';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { buildExtractorPrompt, extractionFailureMessage, extractorItemsForScope, extractorScopeKey, extractorSelectionForScope, getSelectableExtractedWords, selectedExtractedWords, useExtractorRequestGuard, WordExtractorContent, WordExtractorModal } from './WordExtractorModal';
import { languageProfileForPair } from '../courses/courseLanguageProfile';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

afterEach(() => vi.unstubAllGlobals());

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

  it('excludes incomplete results and scopes extraction to the active owner and language pair', () => {
    const koreanToVietnamese = languageProfileForPair('ko', 'vi');
    expect(selectedExtractedWords([
      { word: 'valid', translation: 'hợp lệ', partOfSpeech: 'noun', cefrLevel: '', example: '' },
      { word: 'blank translation', translation: '  ', partOfSpeech: 'noun', cefrLevel: '', example: '' },
    ], new Set(['valid', 'blank translation']))).toEqual([
      expect.objectContaining({ word: 'valid' }),
    ]);
    expect(getSelectableExtractedWords([
      { word: 'valid', translation: 'hợp lệ', partOfSpeech: 'noun', cefrLevel: '', example: '' },
      { word: 'blank translation', translation: '  ', partOfSpeech: 'noun', cefrLevel: '', example: '' },
    ], [])).toEqual([expect.objectContaining({ word: 'valid' })]);
    expect(buildExtractorPrompt(' 안녕하세요 ', koreanToVietnamese)).toContain('từ vựng Korean');
    expect(buildExtractorPrompt(' 안녕하세요 ', koreanToVietnamese)).toContain('nghĩa Vietnamese ngắn gọn');
    expect(extractorScopeKey(koreanToVietnamese, 'owner-a'))
      .not.toBe(extractorScopeKey(languageProfileForPair('ja', 'vi'), 'owner-b'));
  });

  it('synchronously hides old-owner results and selections before scope-reset effects run', () => {
    const ownerAScope = extractorScopeKey(languageProfileForPair('en', 'vi'), 'owner-a');
    const ownerBScope = extractorScopeKey(languageProfileForPair('ko', 'vi'), 'owner-b');
    const oldItems = [{ word: 'private', translation: 'riêng tư', partOfSpeech: 'adjective', cefrLevel: '', example: '' }];
    const oldSelection = new Set(['private']);

    const visibleItems = extractorItemsForScope(oldItems, ownerAScope, ownerBScope);
    const visibleSelection = extractorSelectionForScope(oldSelection, ownerAScope, ownerBScope);

    expect(visibleItems).toEqual([]);
    expect(visibleSelection).toEqual(new Set());
    expect(selectedExtractedWords(visibleItems, visibleSelection)).toEqual([]);
  });

  it('removes a selected extraction when a rerender receives that card from the library', () => {
    const items = [{ word: 'focus', translation: 'tập trung', partOfSpeech: 'verb', cefrLevel: 'B2', example: 'Focus on the task.' }];
    const selected = new Set(['focus']);

    expect(getSelectableExtractedWords(selectedExtractedWords(items, selected), [])).toEqual(items);
    expect(getSelectableExtractedWords(selectedExtractedWords(items, selected), [{ word: 'focus', normalizedWord: 'focus' }])).toEqual([]);
  });

  it('renders card-arrival selections as unavailable and disables Select all with no selectable rows', () => {
    const source = readFileSync(fileURLToPath(new URL('./WordExtractorModal.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('const isSelected = importableSelectedWords.includes(item);');
    expect(source).toContain('disabled={selectableWords.length === 0}');
  });

  it('drops an old deferred response across a mounted A→B→A scope rerender', async () => {
    const captured: { current: ReturnType<typeof useExtractorRequestGuard> | null } = { current: null };
    const root = createRoot(installMinimalReactDom());
    const rendered: string[] = [];
    const imported: string[] = [];
    let resolveOld!: (value: string) => void;
    const oldResponse = new Promise<string>(resolve => { resolveOld = resolve; });
    function Harness() {
      captured.current = useExtractorRequestGuard();
      return null;
    }
    try {
      await act(async () => { root.render(<Harness key="owner-a:en-vi" />); });
      const oldRequest = captured.current!();
      const consumeOld = oldResponse.then(word => {
        if (!oldRequest.isCurrent()) return;
        rendered.push(word);
        imported.push(word);
      });

      await act(async () => { root.render(<Harness key="owner-b:ko-vi" />); });
      await act(async () => { root.render(<Harness key="owner-a:en-vi:new" />); });
      const currentRequest = captured.current!();
      resolveOld('stale');
      await consumeOld;

      expect(rendered).toEqual([]);
      expect(imported).toEqual([]);
      expect(currentRequest.isCurrent()).toBe(true);
    } finally {
      await act(async () => { root.unmount(); });
    }
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
