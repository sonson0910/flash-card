import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { AiGenerationAccess } from './aiGenerationAccess';
import {
  DeckCreationForm,
  DeckDeletionDialogContent,
  LibraryTools,
  SpreadsheetImportStatus,
  createDeckThenClearInput,
  deleteDeckThenCloseDialog,
  restoreDeckDeletionFocus,
  shouldBlockImeSubmit,
} from './LibraryTools';

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
}: {
  isAuthenticated: boolean;
  generationAccess: AiGenerationAccess;
  libraryCount?: number;
  activePartOfSpeech?: string;
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
    customDecks={[]}
    newDeckInput=""
    setNewDeckInput={vi.fn()}
    createCustomDeck={vi.fn(async () => undefined)}
    activeCustomDeck="All"
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

describe('smart-card IME submission', () => {
  it('blocks Enter while Korean composition is active and accepts it after composition ends', () => {
    expect(shouldBlockImeSubmit(true)).toBe(true);
    expect(shouldBlockImeSubmit(false, true)).toBe(true);
    expect(shouldBlockImeSubmit(false)).toBe(false);
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
});

describe('library touch targets', () => {
  it('keeps filters, deck controls, and creation actions at least 44px tall', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryTools.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--sf-brand)]');
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

    const deletion = deleteDeckThenCloseDialog('IELTS', () => remoteDelete.promise, closeDialog);
    expect(closeDialog).not.toHaveBeenCalled();

    remoteDelete.resolve();
    await deletion;

    expect(closeDialog).toHaveBeenCalledOnce();
  });

  it('keeps the deletion dialog open when deletion fails', async () => {
    const closeDialog = vi.fn();

    await expect(deleteDeckThenCloseDialog(
      'IELTS',
      async () => { throw new Error('offline'); },
      closeDialog,
    )).rejects.toThrow('offline');

    expect(closeDialog).not.toHaveBeenCalled();
  });

  it('renders explicit pending and retryable error feedback', () => {
    const creatingHtml = renderMarkup(
      <DeckCreationForm
        value="TOEIC"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        isCreating
        error
      />,
    );
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

    expect(creatingHtml).toContain('Creating…');
    expect(creatingHtml).toContain('role="alert"');
    expect(creatingHtml).toContain('Could not create this deck.');
    expect(deletingHtml).toContain('Deleting…');
    expect(deletingHtml).toContain('role="alert"');
    expect(deletingHtml).toContain('Could not finish deleting this deck.');
  });

  it('renders deck errors from the active catalog instead of a stored English string', () => {
    i18n.activate('vi');
    const html = renderMarkup(
      <DeckCreationForm value="TOEIC" onChange={vi.fn()} onSubmit={vi.fn()} isCreating={false} error />,
    );

    expect(html).toContain('Không thể tạo bộ thẻ này.');
  });
});

describe('DeckDeletionDialog', () => {
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
