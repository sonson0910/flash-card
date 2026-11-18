import { lazy, Suspense, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Lumi } from '../../components/lumi/Lumi';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import type { SpreadsheetImportProgress, SpreadsheetImportResult } from '../importExport/spreadsheetImportService';
import type { AiGenerationAccess } from './aiGenerationAccess';
import type { ExtractedWordItem } from './WordExtractorModal';
import { createExtractedWordsCsv } from './extractedWordsImport';
import './empty-library-panel.css';

const WordExtractorModal = lazy(() => import('./WordExtractorModal').then(module => ({ default: module.WordExtractorModal })));

interface EmptyLibraryPanelProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  wordInput: string;
  onWordInputChange: (value: string) => void;
  onGenerate: (event: FormEvent) => Promise<void>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  importFile: (file: File) => void;
  onOpenPaths: () => void;
  isLoading: boolean;
  isGenerating: boolean;
  isImporting: boolean;
  generationAccess: AiGenerationAccess;
  importProgress: SpreadsheetImportProgress | null;
  importResult: SpreadsheetImportResult | null;
  cards: readonly Pick<CardData, 'word' | 'normalizedWord'>[];
  languageProfile?: LanguageProfile;
  ownerId?: string | null;
}

export function EmptyLibraryPanel({
  fileInputRef,
  wordInput,
  onWordInputChange,
  onGenerate,
  onImport,
  importFile,
  onOpenPaths,
  isLoading,
  isGenerating,
  isImporting,
  generationAccess,
  importProgress,
  importResult,
  cards,
  languageProfile = ENGLISH_TO_VIETNAMESE_PROFILE,
  ownerId,
}: EmptyLibraryPanelProps) {
  const isCrystal = useTheme().family === 'crystal';
  const showLumi = isCrystal && readLumiEnabled();
  const [scanOpen, setScanOpen] = useState(false);
  const imeSubmitGuard = useRef(createImeSubmitGuard()).current;
  const pointerSubmit = useRef(false);
  const extractorRestoreRef = useRef<HTMLButtonElement | null>(null);
  const canGenerate = Boolean(wordInput.trim())
    && generationAccess.available
    && !isLoading
    && !isGenerating
    && !isImporting;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const submittedByPointer = pointerSubmit.current;
    pointerSubmit.current = false;
    if (imeSubmitGuard.shouldBlockSubmit(event.nativeEvent as SubmitEvent & { isComposing?: boolean; keyCode?: number }, submittedByPointer)) {
      event.preventDefault();
      return;
    }
    if (!canGenerate) {
      event.preventDefault();
      return;
    }
    void onGenerate(event);
  };

  const importExtractedItems = (items: ExtractedWordItem[]) => {
    if (items.length > 0) {
      importFile(new File([createExtractedWordsCsv(items, languageProfile)], 'extracted_words.csv', { type: 'text/csv' }));
    }
  };

  const generationHelpId = 'empty-library-generation-help';
  const importStatus = importProgress
    ? <p className="empty-library__status" role="status" aria-live="polite"><Trans {...msg({ context: 'library.import.progress', message: 'Importing {current, number} of {total, number}' })} values={{ current: importProgress.current, total: importProgress.total }} /> · <Trans {...msg({ context: 'library.import.current-word', message: 'Current word: {word}' })} values={{ word: importProgress.word }} /></p>
    : importResult
      ? <p className="empty-library__status" role={importResult.status === 'failed' ? 'alert' : 'status'} aria-live={importResult.status === 'failed' ? 'assertive' : 'polite'}>{importResult.message}</p>
      : null;

  return (
    <section className={`empty-library${isCrystal ? ' empty-library--crystal' : ' empty-library--classic'}`} aria-labelledby="empty-library-caption" data-empty-library-panel="true">
      <p id="empty-library-caption" className="empty-library__caption"><Trans {...msg({ context: 'library.empty.first-run-kicker', message: 'Empty library · first run' })} /></p>
      {isCrystal ? (
        <div className="empty-library__crystal-frame">
          <div className="empty-library__crystal-inner">
            <div className="empty-library__crystal-heading">
              <div className="empty-library__lumi-space" aria-hidden="true">
                {showLumi && <Lumi pose="sleepy" size={108} className="empty-library__lumi" />}
              </div>
              <div className="empty-library__title-wrap">
                <p className="empty-library__link-label"><Trans {...msg({ context: 'library.empty.lumi-link', message: 'LUMI · LINK' })} /></p>
                <h2 className="empty-library__title"><Trans {...msg({ context: 'library.empty.title-prefix', message: 'Start with your' })} /> <span><Trans {...msg({ context: 'library.empty.title-emphasis', message: 'first word.' })} /></span></h2>
              </div>
            </div>
            <EmptyLibraryActions
              fileInputRef={fileInputRef}
              wordInput={wordInput}
              onWordInputChange={onWordInputChange}
              onImport={onImport}
              onOpenPaths={onOpenPaths}
              isLoading={isLoading}
              isGenerating={isGenerating}
              isImporting={isImporting}
              generationAccess={generationAccess}
              generationHelpId={generationHelpId}
              canGenerate={canGenerate}
              submit={submit}
              onCompositionStart={imeSubmitGuard.onCompositionStart}
              onCompositionEnd={imeSubmitGuard.onCompositionEnd}
              onKeyDown={event => { if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault(); }}
              onPointerSubmit={() => { pointerSubmit.current = true; setTimeout(() => { pointerSubmit.current = false; }, 0); }}
              setScanOpen={setScanOpen}
              extractorRestoreRef={extractorRestoreRef}
              importStatus={importStatus}
            />
          </div>
        </div>
      ) : (
        <div className="empty-library__classic-tile">
          <div className="empty-library__card-stack" aria-hidden="true">
            <span className="empty-library__card-outline empty-library__card-outline--back" />
            <span className="empty-library__card-outline empty-library__card-outline--front" />
            <span className="empty-library__mini-card">a</span>
          </div>
          <h2 className="empty-library__title"><Trans {...msg({ context: 'library.empty.title-prefix', message: 'Start with your' })} /> <span><Trans {...msg({ context: 'library.empty.title-emphasis', message: 'first word.' })} /></span></h2>
          <EmptyLibraryActions
            fileInputRef={fileInputRef}
            wordInput={wordInput}
            onWordInputChange={onWordInputChange}
            onImport={onImport}
            onOpenPaths={onOpenPaths}
            isLoading={isLoading}
            isGenerating={isGenerating}
            isImporting={isImporting}
            generationAccess={generationAccess}
            generationHelpId={generationHelpId}
            canGenerate={canGenerate}
            submit={submit}
            onCompositionStart={imeSubmitGuard.onCompositionStart}
            onCompositionEnd={imeSubmitGuard.onCompositionEnd}
            onKeyDown={event => { if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault(); }}
            onPointerSubmit={() => { pointerSubmit.current = true; setTimeout(() => { pointerSubmit.current = false; }, 0); }}
            setScanOpen={setScanOpen}
            extractorRestoreRef={extractorRestoreRef}
            importStatus={importStatus}
          />
        </div>
      )}
      {scanOpen && (
        <Suspense fallback={null}>
          <WordExtractorModal
            open
            onOpenChange={setScanOpen}
            onImportItems={importExtractedItems}
            cards={cards}
            restoreFocusRef={extractorRestoreRef}
            languageProfile={languageProfile}
            ownerId={ownerId}
          />
        </Suspense>
      )}
    </section>
  );
}

type ActionProps = Pick<EmptyLibraryPanelProps,
  'fileInputRef' | 'wordInput' | 'onWordInputChange' | 'onImport' | 'onOpenPaths'
  | 'isLoading' | 'isGenerating' | 'isImporting' | 'generationAccess'> & {
    generationHelpId: string;
    canGenerate: boolean;
    submit: (event: FormEvent<HTMLFormElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
    onPointerSubmit: () => void;
    setScanOpen: (open: boolean) => void;
    extractorRestoreRef: RefObject<HTMLButtonElement | null>;
    importStatus: ReactNode;
  };

function EmptyLibraryActions({
  fileInputRef,
  wordInput,
  onWordInputChange,
  onImport,
  onOpenPaths,
  isLoading,
  isGenerating,
  isImporting,
  generationAccess,
  generationHelpId,
  canGenerate,
  submit,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
  onPointerSubmit,
  setScanOpen,
  extractorRestoreRef,
  importStatus,
}: ActionProps) {
  const { i18n } = useLingui();
  const isBusy = isLoading || isGenerating || isImporting;

  return (
    <>
      <form className="empty-library__form" onSubmit={submit} onKeyDown={onKeyDown}>
        <label className="sr-only" htmlFor="empty-library-word"><Trans {...msg({ context: 'library.create.word-label', message: 'English word' })} /></label>
        <input
          id="empty-library-word"
          className="empty-library__word-input"
          type="text"
          lang="en"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={i18n._(msg({ id: 'library.empty.word-placeholder', message: 'Type a word or phrase…' }))}
          value={wordInput}
          disabled={isLoading}
          aria-describedby={generationHelpId}
          onChange={event => onWordInputChange(event.currentTarget.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        <button className="empty-library__generate" type="submit" onPointerDown={onPointerSubmit} disabled={!canGenerate}>
          {isGenerating
            ? <Trans {...msg({ id: 'library.create.creating', message: 'Creating card…' })} />
            : isImporting
              ? <Trans {...msg({ id: 'library.create.importing', message: 'Import in progress…' })} />
              : <Trans {...msg({ context: 'library.empty.generate', message: 'Generate card' })} />}
        </button>
      </form>
      <span id={generationHelpId} className={generationAccess.available ? 'sr-only' : 'empty-library__generation-help'}>
        {generationAccess.available
          ? <Trans {...msg({ context: 'library.empty.generate-help', message: 'Add a word or phrase to generate a card.' })} />
          : generationAccess.message}
      </span>
      {isGenerating && <p className="empty-library__status" role="status" aria-live="polite"><Trans {...msg({ context: 'library.create.analysing', message: 'AI is analysing' })} /> · <Trans {...msg({ context: 'library.create.building', message: 'Building your card' })} /></p>}
      {importStatus}
      <div className="empty-library__links">
        <button type="button" onClick={() => setScanOpen(true)} ref={extractorRestoreRef} disabled={isBusy}>
          <Trans {...msg({ context: 'library.empty.scan', message: 'Scan a text' })} />
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
          <Trans {...msg({ context: 'library.empty.import', message: 'Import CSV / Excel' })} />
        </button>
        <button type="button" onClick={onOpenPaths}>
          <Trans {...msg({ context: 'library.empty.paths', message: 'Browse paths' })} />
        </button>
        <input
          ref={fileInputRef}
          className="empty-library__file-input"
          type="file"
          accept=".csv,.xlsx"
          aria-label={i18n._(msg({ id: 'library.import.choose-file', message: 'Choose an Excel or CSV file' }))}
          tabIndex={-1}
          disabled={isBusy}
          onChange={onImport}
        />
      </div>
    </>
  );
}
