import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { AiGenerationAccess } from './aiGenerationAccess';
import { ALL_PRACTICE_DECK_SCOPE } from '../../lib/practiceScope';
import {
  DeckDeletionDialogContent,
  LibraryTools,
  SpreadsheetImportStatus,
  createDeckThenClearInput,
  deleteDeckThenCloseDialog,
  getDeckCreationValidationError,
  getGenerationDeckSelection,
  restoreDeckDeletionFocus,
} from './LibraryTools';
import { createExtractedWordsCsv } from './extractedWordsImport';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import { classifyStructuredCardRows } from '../importExport/spreadsheetModel';
import { createSpreadsheetImportService } from '../importExport/spreadsheetImportService';
import { loadSpreadsheetWorkbook } from '../importExport/spreadsheetWorkbook';
import { selectedExtractedWords } from './WordExtractorModal';
import { languageProfileForPair } from '../courses/courseLanguageProfile';

i18n.load('en', {});
i18n.activate('en');
i18n.load('vi', {
  'library.import.partial-guidance': 'Hãy thử lại các từ bị lỗi hoặc bị bỏ qua sau.',
  'library.part-of-speech.noun': 'Danh từ',
  'library.categories.all': 'Tất cả',
  'library.create.sign-in-help': 'Đăng nhập để tạo thẻ thông minh.',
  'library.deck.create-error': 'Không thể tạo bộ thẻ này. Kiểm tra kết nối rồi thử lại.',
  'library.deck.delete-error': 'Không thể xoá bộ thẻ này. Làm mới dữ liệu đám mây rồi thử lại.',
});

beforeEach(() => i18n.activate('en'));

const renderMarkup = (node: ReactNode) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>{node}</I18nProvider>,
);

const renderLibraryTools = ({
  isAuthenticated,
  generationAccess,
  libraryCount = 0,
  activePartOfSpeech = 'All',
  customDecks = [],
  activeCustomDeck = ALL_PRACTICE_DECK_SCOPE,
}: {
  isAuthenticated: boolean;
  generationAccess: AiGenerationAccess;
  libraryCount?: number;
  activePartOfSpeech?: string;
  customDecks?: string[];
  activeCustomDeck?: typeof ALL_PRACTICE_DECK_SCOPE | { kind: 'unassigned' } | { kind: 'deck'; name: string };
}) => renderMarkup(
  <LibraryTools
    fileInputRef={{ current: null }}
    onImport={vi.fn()}
    importFile={vi.fn()}
    onGenerate={vi.fn(async () => undefined)}
    wordInput="focus"
    setWordInput={vi.fn()}
    isLoading={false}
    importProgress={null}
    libraryCount={libraryCount}
    searchQuery=""
    setSearchQuery={vi.fn()}
    showStarredOnly={false}
    setShowStarredOnly={vi.fn()}
    activeDifficulty="All"
    setActiveDifficulty={vi.fn()}
    activePartOfSpeech={activePartOfSpeech}
    setActivePartOfSpeech={vi.fn()}
    isAuthenticated={isAuthenticated}
    generationAccess={generationAccess}
    activeDate="All"
    setActiveDate={vi.fn()}
    availableDates={['All']}
    customDecks={customDecks}
    newDeckInput=""
    setNewDeckInput={vi.fn()}
    createCustomDeck={vi.fn(async () => undefined)}
    activeCustomDeck={activeCustomDeck}
    setActiveCustomDeck={vi.fn()}
    cards={[]}
    deleteCustomDeck={vi.fn(async () => undefined)}
    cloudFacetsComplete
    sortedCategories={['All']}
    categoryCounts={{ All: 0 }}
    activeCategory="All"
    setActiveCategory={vi.fn()}
  />,
);

describe('smart-card generation access', () => {
  it('allows a signed-out user to check for an existing local card before generation', () => {
    const html = renderLibraryTools({
      isAuthenticated: false,
      generationAccess: {
        available: false,
        reason: 'authentication-required',
        message: 'Sign in to generate smart cards.',
      },
    });
    const submitButton = html.match(/<button type="submit"[^>]*>/)?.[0];

    expect(submitButton).not.toContain('disabled=""');
    expect(html).toContain('Check library');
    expect(html).toContain('Sign in to generate smart cards.');
  });

  it('keeps production generation available after sign-in when the word is valid', () => {
    const html = renderLibraryTools({
      isAuthenticated: true,
      generationAccess: { available: true },
    });
    const submitButton = html.match(/<button type="submit"[^>]*>/)?.[0];

    expect(submitButton).not.toContain('disabled=""');
    expect(html).not.toContain('Sign in to generate smart cards.');
  });
});

describe('extractor structured import', () => {
  it('keeps selected extractor details through quoted CSV and structured classification', async () => {
    const languageProfile = languageProfileForPair('ko', 'vi');
    const csv = createExtractedWordsCsv(selectedExtractedWords([
      { word: 'skip', translation: 'bỏ qua', partOfSpeech: 'verb', example: '', cefrLevel: '' },
      {
        word: 'well, "said"', translation: 'nói, hay', partOfSpeech: 'adjective',
        example: 'She said, "well done".', cefrLevel: 'b2',
      },
    ], new Set(['well, "said"'])), languageProfile);

    const workbook = await loadSpreadsheetWorkbook(new File([csv], 'extracted_words.csv', { type: 'text/csv' }));
    expect(workbook.hasStructuredHeader).toBe(true);
    expect(workbook.flatRows[0]).toEqual(['Word', 'Translation', 'Part of Speech', 'Example Sentence', 'CEFR Level', 'Language', 'Translation Language']);
    expect(classifyStructuredCardRows(workbook.structuredSourceRows ?? [])).toEqual([
      expect.objectContaining({
        kind: 'accepted',
        row: expect.objectContaining({
          word: 'well, "said"',
          translation: 'nói, hay',
          partOfSpeech: 'adjective',
          exampleSentence: 'She said, "well done".',
          cefrLevel: 'B2',
          language: 'ko',
          translationLanguage: 'vi',
        }),
      }),
    ]);

    const generate = vi.fn(async () => ({ created: true }));
    const persistStructured = vi.fn(async (plan: { creates: unknown[] }) => ({ createdCount: plan.creates.length }));
    const importer = createSpreadsheetImportService({
      cards: {
        findExisting: async () => new Map(),
        persistStructured,
        touchExisting: async () => undefined,
        generate,
        completeFlat: async () => undefined,
      },
      feedback: {
        start: vi.fn(), clearError: vi.fn(), progress: vi.fn(), error: vi.fn(), finish: vi.fn(), resetSource: vi.fn(),
      },
    });
    const result = await importer.import({
      sizeBytes: csv.length,
      loadWorkbook: () => loadSpreadsheetWorkbook(new File([csv], 'extracted_words.csv', { type: 'text/csv' })),
    });

    expect(result.summary).toMatchObject({ created: 1, failed: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(persistStructured).toHaveBeenCalledWith(expect.objectContaining({
      creates: [expect.objectContaining({ exampleSentence: 'She said, "well done".', cefrLevel: 'B2', language: 'ko', translationLanguage: 'vi' })],
    }), expect.any(Function));
  });
});

describe('smart-card IME submission', () => {
  it('keeps a queued Safari Enter from generating a card while allowing the button click', () => {
    vi.useFakeTimers();
    try {
      const guard = createImeSubmitGuard();
      guard.onCompositionStart();
      expect(guard.shouldBlockSubmit({ keyCode: 13 })).toBe(true);
      expect(guard.shouldBlockSubmit({}, true)).toBe(true);

      guard.onCompositionEnd();
      expect(guard.shouldBlockSubmit({ keyCode: 13 })).toBe(true);
      expect(guard.shouldBlockSubmit({ keyCode: 13 }, true)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the shared guard for the smart-card form events', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryTools.tsx', import.meta.url)), 'utf8');

    expect(source).toContain("import { createImeSubmitGuard } from '../../lib/imeSubmitGuard'");
    expect(source).toContain('shouldBlockSubmit(event.nativeEvent');
    expect(source).toContain('onCompositionEnd={imeSubmitGuard.onCompositionEnd}');
    expect(source).toContain('shouldBlockKeyDown(event.nativeEvent)');
    expect(source).toContain('onPointerDown={() => { pointerSubmit.current = true;');
  });
});

describe('quick learning tools', () => {
  it('uses one neutral secondary-control treatment for dialogue and text scanning', () => {
    const html = renderLibraryTools({
      isAuthenticated: true,
      generationAccess: { available: true },
    });

    expect(html.match(/data-color-role="secondary"/g)).toHaveLength(2);
    expect(html).not.toMatch(/(?:purple|emerald)-500/);
  });

  it('makes smart-card creation primary and keeps secondary tools quiet', () => {
    const html = renderLibraryTools({
      isAuthenticated: true,
      generationAccess: { available: true },
      libraryCount: 1,
    });

    expect(html).toMatch(/data-library-tool="create"[^>]*data-tool-priority="primary"/);
    expect(html).toMatch(/data-library-tool="filters"[^>]*data-tool-priority="secondary"/);
    expect(html).not.toContain('liquid-glass');
  });

  it('gives deck spaces their own primary section and a native card destination selector', () => {
    const html = renderLibraryTools({
      isAuthenticated: true,
      generationAccess: { available: true },
      libraryCount: 1,
      customDecks: ['IELTS'],
      activeCustomDeck: { kind: 'deck', name: 'IELTS' },
    });

    expect(html).toMatch(/data-library-tool="deck-spaces"[^>]*data-tool-priority="primary"/);
    expect(html).toContain('Deck space');
    expect(html).toContain('id="new-card-deck"');
    expect(html).toContain('<option value="">Unassigned</option>');
    expect(html).toMatch(/<option value="IELTS"(?: selected="")?>IELTS<\/option>/);
    expect(html.indexOf('data-library-tool="deck-spaces"')).toBeLessThan(html.indexOf('data-library-tool="filters"'));
  });

  it('keeps Unassigned and deleted deck selections out of generation requests', () => {
    expect(getGenerationDeckSelection({ kind: 'unassigned' }, ['IELTS'])).toBe('');
    expect(getGenerationDeckSelection(ALL_PRACTICE_DECK_SCOPE, ['IELTS'])).toBe('');
    expect(getGenerationDeckSelection({ kind: 'deck', name: 'Removed' }, ['IELTS'])).toBe('');
    expect(getGenerationDeckSelection({ kind: 'deck', name: 'IELTS' }, ['IELTS'])).toBe('IELTS');
  });
});

describe('library touch targets', () => {
  it('keeps filters, deck controls, and creation actions at least 44px tall', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryTools.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--sf-brand)]');
    expect(source).toContain('flex size-11 items-center justify-center rounded-lg');
    expect(source).toContain('flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border px-3 py-1');
  });
});

describe('library touch targets', () => {
  it('keeps filters, deck controls, and creation actions at least 44px tall', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryTools.tsx', import.meta.url)), 'utf8');
    const dialogSource = readFileSync(fileURLToPath(new URL('./LibraryDialogOverlays.tsx', import.meta.url)), 'utf8');
    const dialogCss = readFileSync(fileURLToPath(new URL('./library-dialog-overlays.css', import.meta.url)), 'utf8');

    expect(dialogSource).toContain('className="library-dialog-button library-dialog-button--primary"');
    expect(dialogCss).toMatch(/\.library-dialog-button\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(source).toContain('flex size-11 items-center justify-center rounded-lg');
    expect(source).toContain('flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border px-3 py-1');
  });
});

describe('spreadsheet import feedback', () => {
  it('renders operation-specific progress instead of AI generation copy', () => {
    const html = renderMarkup(
      <SpreadsheetImportStatus
        progress={{ current: 2, total: 5, word: 'banana' }}
        result={null}
      />,
    );

    expect(html).toContain('Importing 2 of 5');
    expect(html).toContain('banana');
    expect(html).not.toContain('AI is analysing');
  });

  it('keeps a typed partial result visible with retry guidance', () => {
    const html = renderMarkup(
      <SpreadsheetImportStatus
        progress={null}
        result={{
          status: 'partial',
          summary: { total: 5, created: 2, reused: 1, failed: 1, skipped: 1 },
          message: 'Import partly finished. Retry the failed or skipped words later.',
        }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('2 created');
    expect(html).toContain('1 already present');
    expect(html).toContain('1 failed');
    expect(html).toContain('1 skipped');
    expect(html).toContain('Retry the failed or skipped words later.');
    expect(html).not.toContain('Import partly finished.');
  });

  it('uses Vietnamese catalog copy instead of service text and localizes filter values', () => {
    i18n.activate('vi');
    const importHtml = renderMarkup(
      <SpreadsheetImportStatus
        progress={null}
        result={{
          status: 'partial',
          summary: { total: 5, created: 2, reused: 1, failed: 1, skipped: 1 },
          message: 'Import partly finished. Retry the failed or skipped words later.',
        }}
      />,
    );
    const toolsHtml = renderLibraryTools({
      isAuthenticated: true,
      generationAccess: { available: false, reason: 'authentication-required', message: 'Sign in to generate smart cards.' },
      libraryCount: 1,
      activePartOfSpeech: 'noun',
    });

    expect(importHtml).toContain('Hãy thử lại các từ bị lỗi hoặc bị bỏ qua sau.');
    expect(importHtml).not.toContain('Import partly finished.');
    expect(toolsHtml).toContain('Danh từ');
    expect(toolsHtml).toContain('Tất cả');
    expect(toolsHtml).toContain('Đăng nhập để tạo thẻ thông minh.');
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe('custom deck mutation feedback', () => {
  it('explains reserved deck names without flagging ordinary names', () => {
    expect(getDeckCreationValidationError(' Ａｌｌ ')).toContain('reserved');
    expect(getDeckCreationValidationError(' TOEIC ')).toBeNull();
    expect(getDeckCreationValidationError('One more')).toBeNull();
  });

  it('clears the deck name only after creation is confirmed', async () => {
    const remoteCreate = deferred<void>();
    const clearInput = vi.fn();

    const creation = createDeckThenClearInput('TOEIC', () => remoteCreate.promise, clearInput);
    expect(clearInput).not.toHaveBeenCalled();

    remoteCreate.resolve();
    await creation;

    expect(clearInput).toHaveBeenCalledOnce();
  });

  it('preserves the deck name when creation fails', async () => {
    const clearInput = vi.fn();

    await expect(createDeckThenClearInput(
      'TOEIC',
      async () => { throw new Error('offline'); },
      clearInput,
    )).rejects.toThrow('offline');

    expect(clearInput).not.toHaveBeenCalled();
  });

  it('closes the deletion dialog only after deletion is confirmed', async () => {
    const remoteDelete = deferred<void>();
    const closeDialog = vi.fn();

    const deletion = deleteDeckThenCloseDialog(
      { name: 'IELTS', ownerId: 'alice' },
      'alice',
      () => remoteDelete.promise,
      closeDialog,
    );
    expect(closeDialog).not.toHaveBeenCalled();

    remoteDelete.resolve();
    await deletion;

    expect(closeDialog).toHaveBeenCalledOnce();
  });

  it('keeps the deletion dialog open when deletion fails', async () => {
    const closeDialog = vi.fn();

    await expect(deleteDeckThenCloseDialog(
      { name: 'IELTS', ownerId: 'alice' },
      'alice',
      async () => { throw new Error('offline'); },
      closeDialog,
    )).rejects.toThrow('offline');

    expect(closeDialog).not.toHaveBeenCalled();
  });

  it('does not invoke a stale deletion intent for another owner', async () => {
    const deleteDeck = vi.fn(async () => undefined);
    const closeDialog = vi.fn();

    await expect(deleteDeckThenCloseDialog(
      { name: 'IELTS', ownerId: 'alice' },
      'bob',
      deleteDeck,
      closeDialog,
    )).resolves.toBe(false);

    expect(deleteDeck).not.toHaveBeenCalled();
    expect(closeDialog).not.toHaveBeenCalled();
  });

  it('renders explicit pending and retryable deletion error feedback', () => {
    const deletingHtml = renderMarkup(
      <AlertDialog.Root open>
        <DeckDeletionDialogContent
          deckName="IELTS"
          assignedCardCount={2}
          onConfirm={vi.fn()}
          isDeleting
          error
        />
      </AlertDialog.Root>,
    );

    expect(deletingHtml).toContain('Deleting…');
    expect(deletingHtml).toContain('role="alert"');
    expect(deletingHtml).toContain('Could not finish deleting this deck.');
  });

});

describe('DeckDeletionDialog', () => {
  it('keeps Escape from dismissing the confirmation while deletion is pending', () => {
    const escapeHandler = (isDeleting: boolean) => {
      const tree = DeckDeletionDialogContent({
        deckName: 'IELTS', assignedCardCount: 2, onConfirm: vi.fn(), isDeleting,
      });
      const content = (tree.props.children as ReactElement<{ onEscapeKeyDown: (event: { preventDefault(): void }) => void }>[])[1];
      return content.props.onEscapeKeyDown;
    };
    const pendingEvent = { preventDefault: vi.fn() };
    escapeHandler(true)(pendingEvent);
    expect(pendingEvent.preventDefault).toHaveBeenCalledOnce();

    const idleEvent = { preventDefault: vi.fn() };
    escapeHandler(false)(idleEvent);
    expect(idleEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('describes the destructive effect and provides explicit cancel and confirm actions', () => {
    const html = renderMarkup(
      <AlertDialog.Root open>
        <DeckDeletionDialogContent
          deckName="IELTS"
          assignedCardCount={2}
          onConfirm={vi.fn()}
        />
      </AlertDialog.Root>,
    );

    expect(html).toContain('Delete “IELTS” deck?');
    expect(html).toContain('2 cards will become unassigned');
    expect(html).toContain('Keep deck');
    expect(html).toContain('Delete deck');
  });

  it('does not delegate confirmation to the browser', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryTools.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('AlertDialog.Root');
    expect(source).toContain('onCloseAutoFocus');
    expect(source).not.toMatch(/window\.confirm|confirmDelete/);
  });

  it('restores focus to a stable deck control after the deleted row is removed', () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();

    restoreDeckDeletionFocus(
      { preventDefault },
      { current: { focus } as unknown as HTMLButtonElement },
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();

    const source = readFileSync(fileURLToPath(new URL('./LibraryTools.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("label={i18n._(msg({ id: 'library.decks.all', message: 'All decks' }))} buttonRef={deckDeletionRestoreRef}");
    expect(source).toContain('restoreFocusRef={deckDeletionRestoreRef}');
  });
});
