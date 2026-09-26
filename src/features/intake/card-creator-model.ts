import type { CardData } from '../../types/card';

export type CardCreatorStage = 'input' | 'generating' | 'preview' | 'saving' | 'error';
export type CardCreatorMode = 'ai' | 'manual';

export interface CardCreatorDraft {
  word: string;
  context: string;
  partOfSpeech: string;
  deck: string;
}

export interface ManualCardDraft {
  word: string;
  translation: string;
  explanation?: string;
  explanationTranslation?: string;
  phonetic?: string;
  emoji?: string;
  category?: string;
  deck?: string;
  partOfSpeech?: string;
  cefrLevel?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  mnemonic?: string;
  wordFamily?: CardData['wordFamily'];
  register?: string;
  commonMistake?: string;
}

export type CardGenerationField =
  | 'meaning'
  | 'pronunciation'
  | 'examples'
  | 'wordFamily'
  | 'cefr';

export type CardCreateErrorCode =
  | 'invalid'
  | 'duplicate'
  | 'generation'
  | 'save'
  | 'busy'
  | 'stale';

export interface CardCreateError {
  code: CardCreateErrorCode;
  message: string;
  cause?: unknown;
}

export interface CardCreatorModel {
  open: boolean;
  stage: CardCreatorStage;
  mode: CardCreatorMode;
  draft: CardCreatorDraft;
  preview: CardData | null;
  completedAiRequests: number;
  duplicate: CardData | null;
  error: CardCreateError | null;
  /**
   * The element that had focus when the dialog opened. Radix's Dialog
   * FocusScope still traps focus at the instant this model publishes the
   * closed state (React has not yet unmounted Dialog.Content), so the
   * caller must not call `.focus()` on this element itself — it would be
   * immediately overridden by the still-active trap. Instead, the dialog
   * mirrors this value into a ref and restores focus from its own
   * `onCloseAutoFocus`, which fires after the trap actually releases (see
   * CreateCardDialog.tsx and the matching restoreLibraryDialogFocus pattern
   * in LibraryDialogOverlays.tsx). Typed as the minimal focusable shape
   * (matching CardCreatorFocusTarget in cardIntakeController.ts) rather than
   * the full HTMLElement so controller tests can pass a plain stub.
   */
  focusTarget: Pick<HTMLElement, 'focus'> | null;
}

export type CardCreateResult =
  | { status: 'invalid'; reason: 'empty' | 'too-long' | 'missing-translation'; error?: CardCreateError }
  | { status: 'busy' }
  | { status: 'duplicate'; card: CardData }
  | { status: 'preview'; card: CardData; operationId: string }
  | { status: 'saved'; card: CardData; mediaTask: Promise<void> }
  | { status: 'cancelled' }
  | { status: 'failed'; error: CardCreateError };

export interface CardCreatorActions {
  open(opener?: HTMLElement): void;
  updateDraft(patch: Partial<CardCreatorDraft>): void;
  generatePreview(): Promise<CardCreateResult>;
  updatePreview(patch: Partial<CardData>): void;
  regenerate(fields: readonly CardGenerationField[]): Promise<CardCreateResult>;
  createManualDraft(fields: ManualCardDraft): void;
  save(): Promise<CardCreateResult>;
  cancel(): void;
}

export const createEmptyCardCreatorDraft = (): CardCreatorDraft => ({
  word: '',
  context: '',
  partOfSpeech: '',
  deck: '',
});

export const createInitialCardCreatorModel = (): CardCreatorModel => ({
  open: false,
  stage: 'input',
  mode: 'ai',
  draft: createEmptyCardCreatorDraft(),
  preview: null,
  completedAiRequests: 0,
  duplicate: null,
  error: null,
  focusTarget: null,
});
