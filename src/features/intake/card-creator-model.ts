import type { CardData } from '../../types/card';

export type CardCreatorStage = 'input' | 'generating' | 'preview' | 'saving' | 'error';
export type CardCreatorMode = 'ai' | 'manual';
/**
 * `retrying` shows while the same request is retried after a dropped connection; `finding-image`
 * runs after the card text is complete, while the pipeline waits briefly for an image.
 */
export type CardCreatorGenerationStage = 'reserving' | 'drafting' | 'retrying' | 'finding-image' | null;

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
  | 'stopped'
  | 'offline'
  | 'save'
  | 'busy'
  | 'stale';

/**
 * How the last generation ended when it did not finish. `partial` says whether any field had
 * arrived. `refunded` is the server's answer to a stop: true when the request was not counted,
 * false when it still counts, null when the answer is unknown (always null for a failure).
 */
export interface CardCreatorGenerationOutcome {
  kind: 'stopped' | 'failed';
  partial: boolean;
  refunded: boolean | null;
}

export interface CardCreateError {
  code: CardCreateErrorCode;
  message: string;
  cause?: unknown;
}

export interface CardCreatorModel {
  open: boolean;
  stage: CardCreatorStage;
  mode: CardCreatorMode;
  generationStage: CardCreatorGenerationStage;
  draft: CardCreatorDraft;
  preview: CardData | null;
  completedAiRequests: number;
  duplicate: CardData | null;
  error: CardCreateError | null;
  /** Card fields received during the current or last generation, in arrival order. */
  streamedFields: readonly (keyof CardData)[];
  /** Field groups being regenerated; empty for a first generation. */
  regenerating: readonly CardGenerationField[];
  generationOutcome: CardCreatorGenerationOutcome | null;
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
  /**
   * Stops the running generation and keeps the dialog open. Optional so that callers built before
   * streaming keep compiling; without it the dialog offers no Cancel while generating.
   */
  stopGeneration?(): Promise<CardCreateResult>;
  /** Tries the unfinished generation again under the same request, keeping the learner's edits. */
  retryGeneration?(): Promise<CardCreateResult>;
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
  generationStage: null,
  draft: createEmptyCardCreatorDraft(),
  preview: null,
  completedAiRequests: 0,
  duplicate: null,
  error: null,
  streamedFields: [],
  regenerating: [],
  generationOutcome: null,
  focusTarget: null,
});

export type CardStreamStepId = 'headword' | 'pronunciation' | 'meaning' | 'example' | 'image';
export type CardStreamStepState = 'done' | 'active' | 'waiting' | 'stopped';
export interface CardStreamStep {
  id: CardStreamStepId;
  state: CardStreamStepState;
}

/** The card fields that complete each text step, in the order the dialog lists the steps. */
export const CARD_STREAM_STEP_FIELDS = {
  headword: ['phonetic'],
  pronunciation: ['phonetic', 'partOfSpeech', 'cefrLevel'],
  meaning: ['translation', 'explanation'],
  example: ['exampleSentence', 'exampleTranslation'],
} as const satisfies Record<Exclude<CardStreamStepId, 'image'>, readonly (keyof CardData)[]>;

const CARD_STREAM_STEP_ORDER: readonly CardStreamStepId[] = ['headword', 'pronunciation', 'meaning', 'example', 'image'];

/**
 * Maps the fields that really arrived to the dialog's five steps. A text step is done once all of its
 * fields arrived or the card text is complete; the image step is done when the card is ready. The first
 * unfinished step is active while generating; after a stop or failure unfinished steps are stopped.
 */
export const deriveStreamSteps = (
  model: Pick<CardCreatorModel, 'stage' | 'generationStage' | 'streamedFields' | 'generationOutcome'>,
): { steps: CardStreamStep[]; ready: number; total: number } => {
  const arrived = new Set<keyof CardData>(model.streamedFields);
  const cardReady = model.stage === 'preview' || model.stage === 'saving';
  const textComplete = cardReady || model.generationStage === 'finding-image';
  const done = (id: CardStreamStepId) => id === 'image'
    ? cardReady
    : textComplete || CARD_STREAM_STEP_FIELDS[id].every(field => arrived.has(field));
  let activeTaken = model.stage !== 'generating';
  const steps = CARD_STREAM_STEP_ORDER.map((id): CardStreamStep => {
    if (done(id)) return { id, state: 'done' };
    if (!activeTaken) {
      activeTaken = true;
      return { id, state: 'active' };
    }
    return { id, state: model.generationOutcome ? 'stopped' : 'waiting' };
  });
  if (model.generationOutcome) {
    for (const step of steps) if (step.state === 'waiting') step.state = 'stopped';
  }
  return { steps, ready: steps.filter(step => step.state === 'done').length, total: steps.length };
};
