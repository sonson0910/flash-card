import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { AiGenerationAccess } from './aiGenerationAccess';
import {
  DeckCreationForm,
  DeckDeletionDialogContent,
  LibraryTools,
  SpreadsheetImportStatus,
  createDeckThenClearInput,
  deleteDeckThenCloseDialog,
  restoreDeckDeletionFocus,
} from './LibraryTools';

const renderLibraryTools = ({
  isAuthenticated,
  generationAccess,
}: {
  isAuthenticated: boolean;
  generationAccess: AiGenerationAccess;
}) => renderToStaticMarkup(
  <LibraryTools
    fileInputRef={{ current: null }}
    onImport={vi.fn()}
    importFile={vi.fn()}
    onGenerate={vi.fn(async () => undefined)}
    wordInput="focus"
    setWordInput={vi.fn()}
    isLoading={false}
    importProgress={null}
    libraryCount={0}
    searchQuery=""
    setSearchQuery={vi.fn()}
    showStarredOnly={false}
    setShowStarredOnly={vi.fn()}
    activeDifficulty="All"
    setActiveDifficulty={vi.fn()}
    activePartOfSpeech="All"
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

describe('quick learning tools', () => {
  it('uses one neutral secondary-control treatment for dialogue and text scanning', () => {
    const html = renderLibraryTools({
      isAuthenticated: true,
      generationAccess: { available: true },
    });

    expect(html.match(/data-color-role="secondary"/g)).toHaveLength(2);
    expect(html).not.toMatch(/(?:purple|emerald)-500/);
  });
});

describe('spreadsheet import feedback', () => {
  it('renders operation-specific progress instead of AI generation copy', () => {
    const html = renderToStaticMarkup(
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
    const html = renderToStaticMarkup(
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
    const creatingHtml = renderToStaticMarkup(
      <DeckCreationForm
        value="TOEIC"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        isCreating
        error="Deck creation failed."
      />,
    );
    const deletingHtml = renderToStaticMarkup(
      <AlertDialog.Root open>
        <DeckDeletionDialogContent
          deckName="IELTS"
          assignedCardCount={2}
          onConfirm={vi.fn()}
          isDeleting
          error="Deck deletion failed."
        />
      </AlertDialog.Root>,
    );

    expect(creatingHtml).toContain('Creating…');
    expect(creatingHtml).toContain('role="alert"');
    expect(creatingHtml).toContain('Deck creation failed.');
    expect(deletingHtml).toContain('Deleting…');
    expect(deletingHtml).toContain('role="alert"');
    expect(deletingHtml).toContain('Deck deletion failed.');
  });
});

describe('DeckDeletionDialog', () => {
  it('describes the destructive effect and provides explicit cancel and confirm actions', () => {
    const html = renderToStaticMarkup(
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
    expect(source).toContain('label="All decks" buttonRef={deckDeletionRestoreRef}');
    expect(source).toContain('restoreFocusRef={deckDeletionRestoreRef}');
  });
});
