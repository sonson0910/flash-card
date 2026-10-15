import { isSupportedAudioUrl } from '../../lib/audio';
import { cardLogicalKey, createWordCardId } from '../../lib/cardIdentity';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { isSupportedImageUrl } from '../../lib/images';
import { captureFailureMessage } from '../../lib/captureFailureMessage';
import type { WordGenerationProgress } from '../../lib/gemini';
import type { CardData } from '../../types/card';
import {
  createSpreadsheetImportService,
  SpreadsheetImportStaleError,
  type CardIntakePort as SpreadsheetCardIntakePort,
  type SpreadsheetImportProgress,
  type SpreadsheetImportRequest,
  type SpreadsheetImportResult,
} from '../importExport/spreadsheetImportService';
import {
  ENGLISH_TO_VIETNAMESE_PROFILE,
  type LanguageProfile,
} from '../language/languageProfile';
import {
  createEmptyCardCreatorDraft,
  createInitialCardCreatorModel,
  type CardCreateError,
  type CardCreateResult,
  type CardCreatorActions,
  type CardCreatorDraft,
  type CardCreatorModel,
  type CardGenerationField,
  type ManualCardDraft,
} from './card-creator-model';

export interface CardMediaPatch {
  audioUrl: string | null;
  imageUrl: string | null;
}

export interface CardGenerationOptions {
  context?: string;
  partOfSpeechHint?: string;
  operationId?: string;
  surface?: 'app' | 'extension';
  requestedDeck?: string;
  requestedDeckAvailable?: (deck: string) => boolean | Promise<boolean>;
  /** Page URL the word was captured from. Browser-extension capture only. */
  sourceUrl?: string;
  /** Page <title> at capture time. Browser-extension capture only. */
  pageTitle?: string;
  /** ISO 8601 timestamp of the capture instant. Browser-extension capture only. */
  capturedAt?: string;
}

export interface CardGenerationRequest extends CardGenerationOptions {
  term: string;
  language: LanguageProfile;
  operationId?: string;
  onProgress?: (progress: WordGenerationProgress) => void;
  signal?: AbortSignal;
}

export class RequestedDeckUnavailableError extends Error {
  readonly code = 'REQUESTED_DECK_UNAVAILABLE';

  constructor(readonly deck: string) {
    super(`Deck “${deck}” không còn tồn tại. Hãy chọn lại deck rồi thử lại.`);
    this.name = 'RequestedDeckUnavailableError';
  }
}

export interface CardIntakeControllerPort extends SpreadsheetCardIntakePort {
  captureSession?(): () => boolean;
  cancelGeneration?(operationId: string): Promise<void>;
  generateCard(request: CardGenerationRequest): Promise<{
    card: CardData;
    mediaPromise: Promise<CardMediaPatch>;
  }>;
  assignExistingDeck?(card: CardData, deck: string): Promise<CardData>;
  persistCards(cards: readonly CardData[], source: 'generate' | 'shared'): Promise<Array<{
    card: CardData;
    created: boolean;
  }>>;
  createConfirmedCatalogCards(cards: readonly CardData[]): Promise<ConfirmedCatalogCardsResult>;
  applyMedia(card: CardData, media: CardMediaPatch): Promise<void>;
}

export type ConfirmedCatalogCardsResult =
  | { status: 'busy' | 'stale' }
  | { status: 'invalid'; reason: 'invalid-catalog-cards' | 'too-many-cards' }
  | { status: 'completed'; cards: readonly CardData[]; createdCount: number; reusedCount: number }
  | { status: 'partial'; cards: readonly CardData[]; failedCount: number };

export const catalogCardBatchError = (
  cards: readonly CardData[],
): 'invalid-catalog-cards' | 'too-many-cards' | null => {
  if (cards.length === 0) return 'invalid-catalog-cards';
  if (cards.length > 20) return 'too-many-cards';
  const lexemeIds = new Set<string>();
  for (const card of cards) {
    const lexemeId = typeof card.lexemeId === 'string' ? card.lexemeId.trim() : '';
    if (!lexemeId || lexemeIds.has(lexemeId)) return 'invalid-catalog-cards';
    lexemeIds.add(lexemeId);
  }
  return null;
};

export const settleMediaBestEffort = async <Media,>(
  mediaPromise: Promise<Media>,
  applyMedia: (media: Media) => Promise<void> | void,
  reportFailure: (error: unknown) => void = () => undefined,
): Promise<void> => {
  try {
    const media = await mediaPromise;
    await applyMedia(media);
  } catch (error) {
    try {
      reportFailure(error);
    } catch {
      // Diagnostics must not turn optional media work into a failed card intake.
    }
  }
};

export interface CardIntakeDraftOperation {
  word: string;
  context: string;
  languageId: string;
  id: string;
  partOfSpeech?: string;
}

export interface CardIntakeDraftPort {
  read(): string | null;
  write(value: string): void;
  clear(): void;
  readOperation?(): CardIntakeDraftOperation | null;
  writeOperation?(operation: CardIntakeDraftOperation): void;
  clearOperation?(): void;
}

export interface CardIntakeSnapshot {
  draft: string;
  isSubmitting: boolean;
  isImporting: boolean;
  isAdoptingSharedDeck: boolean;
  importProgress: SpreadsheetImportProgress | null;
  importResult: SpreadsheetImportResult | null;
  error: string | null;
  cardCreator: CardCreatorModel;
}

export interface CardIntakeLanguagePair {
  targetLanguage: string;
  nativeLanguage: string;
}

type GenerateResult =
  | { status: 'invalid'; reason: 'empty' | 'too-long' }
  | { status: 'busy' }
  | { status: 'existing'; card: CardData }
  | { status: 'created'; card: CardData; mediaTask: Promise<void> }
  | { status: 'failed'; error: unknown };

type IntakeOperationResult = { status: 'busy' | 'stale' } | SpreadsheetImportResult;

interface CardIntakeDiagnosticsPort {
  generationFailed?(error: unknown): void;
  captureStarted?(event: { requestId: string; surface: 'app' | 'extension' }): void;
  captureFailed?(event: { requestId: string; surface: 'app' | 'extension'; latencyMs: number; error: unknown }): void;
  sharedDeckFailed?(error: unknown): void;
  mediaFailed?(card: CardData, error: unknown): void;
}

type CardIntakeErrorSource = 'generation' | 'spreadsheet' | 'shared-adoption' | null;

interface CardIntakeControllerOptions {
  port: CardIntakeControllerPort;
  language?: LanguageProfile;
  draft?: CardIntakeDraftPort;
  diagnostics?: CardIntakeDiagnosticsPort;
  resetImportSource?: () => void;
  now?: () => string;
  spreadsheetDelay?: (milliseconds: number) => Promise<void>;
}

type CardCreatorFocusTarget = Pick<HTMLElement, 'focus'>;

const readDraft = (draft: CardIntakeDraftPort | undefined): string => {
  try {
    return draft?.read() ?? '';
  } catch {
    return '';
  }
};

const readDraftOperation = (draft: CardIntakeDraftPort | undefined): CardIntakeDraftOperation | null => {
  try { return draft?.readOperation?.() ?? null; } catch { return null; }
};

const draftOperationMatches = (
  operation: CardIntakeDraftOperation | null,
  word: string,
  context: string,
  languageId: string,
  partOfSpeech = '',
): boolean => operation !== null
  && operation.word === word
  && operation.context === context
  && operation.languageId === languageId
  && (operation.partOfSpeech ?? '') === partOfSpeech;

const boundedText = (value: unknown, maximum: number): string =>
  (typeof value === 'string' ? value : String(value ?? '')).trim().slice(0, maximum);

const boundedTextList = (value: unknown): string[] => Array.isArray(value)
  ? value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 4)
    .map(item => item.trim().slice(0, 100))
  : [];

const boundedWordFamily = (value: unknown): CardData['wordFamily'] | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const family = Object.fromEntries(
    (['noun', 'verb', 'adj', 'adv'] as const)
      .map(key => [key, typeof source[key] === 'string' ? boundedText(source[key], 100) : ''])
      .filter(([, text]) => text),
  ) as Record<string, string>;
  return Object.keys(family).length > 0 ? family : undefined;
};

const existingCardFor = (
  existingCards: ReadonlyMap<string, CardData>,
  normalizedWord: string,
  language: LanguageProfile,
  candidate?: CardData,
): CardData | null => existingCards.get(normalizedWord)
  && (!candidate?.lexemeId || cardLogicalKey(existingCards.get(normalizedWord)!) === cardLogicalKey(candidate))
  ? existingCards.get(normalizedWord)!
  : Array.from(existingCards.values()).find(card =>
    candidate?.lexemeId
      ? cardLogicalKey(card) === cardLogicalKey(candidate)
      : language.normalize(card.normalizedWord || card.word) === normalizedWord)
  ?? null;

const sharedCardCandidate = (
  value: unknown,
  language: LanguageProfile,
  createdAt: string,
): CardData | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<CardData>;
  const word = language.normalize(source.word).slice(0, 80);
  const translation = boundedText(source.translation, 256);
  if (!word || !translation) return null;
  const partOfSpeech = normalizePartOfSpeech(source.partOfSpeech);
  const lexemeId = boundedText(source.lexemeId, 128);
  const identity = lexemeId || boundedText(source.language, 64) || boundedText(source.senseKey, 128);
  const languageCode = boundedText(source.language, 64);
  const senseKey = boundedText(source.senseKey, 128);
  const normalizedLemma = boundedText(source.normalizedLemma, 256) || word;
  if (identity && (!lexemeId || !languageCode || !senseKey || !partOfSpeech
    || createLexemeId({ language: languageCode, normalizedLemma, partOfSpeech, senseKey }) !== lexemeId)) return null;
  const wordFamily = boundedWordFamily(source.wordFamily);
  const origin = source.origin === 'ai' || source.origin === 'manual' ? source.origin : undefined;
  return {
    id: lexemeId || createWordCardId(word),
    ...(lexemeId ? { lexemeId, senseKey, normalizedLemma } : {}),
    // The active course, not the shared card's own claim, decides the
    // language tag: course-mismatch routing (see shareCourseMatching.ts)
    // has already steered the import into a matching course by this point,
    // so the imported card is tagged with that course's language pair.
    // languageCode is still honored when it is present and already matches
    // (kept for lexemeId identity verification above).
    language: languageCode || language.source.code,
    translationLanguage: language.target.code,
    word,
    ...(origin ? { origin } : {}),
    normalizedWord: word,
    translation,
    explanation: boundedText(source.explanation, 2048),
    explanationTranslation: boundedText(source.explanationTranslation, 2048),
    phonetic: boundedText(source.phonetic, 256),
    category: boundedText(source.category, 128) || 'Shared',
    partOfSpeech,
    emoji: boundedText(source.emoji, 64) || '📝',
    audioUrl: isSupportedAudioUrl(source.audioUrl) ? source.audioUrl : null,
    imageUrl: isSupportedImageUrl(source.imageUrl) ? source.imageUrl ?? null : null,
    createdAt,
    customDeck: null,
    difficulty: 'unrated',
    bookmarked: false,
    cefrLevel: boundedText(source.cefrLevel, 8),
    exampleSentence: boundedText(source.exampleSentence, 2048),
    exampleTranslation: boundedText(source.exampleTranslation, 2048),
    collocations: boundedTextList(source.collocations),
    synonyms: boundedTextList(source.synonyms),
    antonyms: boundedTextList(source.antonyms),
    register: boundedText(source.register, 64),
    commonMistake: boundedText(source.commonMistake, 2048),
    imageSearchQuery: boundedText(source.imageSearchQuery, 120),
    ...(typeof source.mnemonic === 'string' && source.mnemonic.trim()
      ? { mnemonic: boundedText(source.mnemonic, 2048) }
      : {}),
    ...(wordFamily ? { wordFamily } : {}),
  };
};

const creatorRegenerationFields: readonly CardGenerationField[] = [
  'meaning', 'pronunciation', 'examples', 'wordFamily', 'cefr',
];

const creatorPreviewFields = [
  'translation', 'explanation', 'explanationTranslation', 'phonetic', 'emoji',
  'category', 'customDeck', 'cefrLevel', 'exampleSentence', 'exampleTranslation',
  'collocations', 'synonyms', 'antonyms', 'mnemonic', 'wordFamily', 'register',
  'commonMistake', 'imageSearchQuery', 'audioUrl', 'imageUrl',
] as const satisfies readonly (keyof CardData)[];

const normalizeCreatorDraft = (draft: CardCreatorDraft): CardCreatorDraft => ({
  word: typeof draft.word === 'string' ? draft.word.slice(0, 80) : '',
  context: typeof draft.context === 'string'
    ? draft.context.replace(/\s+/g, ' ').trim().slice(0, 500)
    : '',
  partOfSpeech: normalizePartOfSpeech(draft.partOfSpeech),
  deck: typeof draft.deck === 'string' ? draft.deck.trim().slice(0, 128) : '',
});

const createCardCreatorError = (
  code: CardCreateError['code'],
  message: string,
  cause?: unknown,
): CardCreateError => ({ code, message, ...(cause === undefined ? {} : { cause }) });

const creatorPatch = (patch: Partial<CardData>): Partial<CardData> => {
  const safe = {} as Partial<CardData>;
  for (const field of creatorPreviewFields) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      safe[field] = patch[field] as never;
    }
  }
  return safe;
};

const mergeRegeneratedFields = (
  current: CardData,
  generated: CardData,
  fields: readonly CardGenerationField[],
): CardData => {
  const selected = new Set(fields.length > 0 ? fields : creatorRegenerationFields);
  const next: CardData = { ...current };
  if (selected.has('meaning')) {
    next.translation = generated.translation;
    next.explanation = generated.explanation;
    next.explanationTranslation = generated.explanationTranslation;
  }
  if (selected.has('pronunciation')) next.phonetic = generated.phonetic;
  if (selected.has('examples')) {
    next.exampleSentence = generated.exampleSentence;
    next.exampleTranslation = generated.exampleTranslation;
  }
  if (selected.has('wordFamily')) next.wordFamily = generated.wordFamily;
  if (selected.has('cefr')) next.cefrLevel = generated.cefrLevel;
  return next;
};

const manualCardFromDraft = (
  draft: ManualCardDraft,
  language: LanguageProfile,
  createdAt: string,
  allowEmptyTranslation = false,
): CardData | null => {
  const word = language.normalize(draft.word).slice(0, 80);
  const translation = boundedText(draft.translation, 256);
  if (!word || (!translation && !allowEmptyTranslation)) return null;
  const deck = boundedText(draft.deck, 128);
  const partOfSpeech = normalizePartOfSpeech(draft.partOfSpeech);
  const card: CardData = {
    id: createWordCardId(word),
    origin: 'manual',
    language: language.source.code,
    translationLanguage: language.target.code,
    word,
    normalizedWord: word,
    translation,
    explanation: boundedText(draft.explanation, 2048),
    explanationTranslation: boundedText(draft.explanationTranslation, 2048),
    phonetic: boundedText(draft.phonetic, 256),
    emoji: boundedText(draft.emoji, 64) || '📝',
    category: boundedText(draft.category, 128) || 'Manual',
    audioUrl: null,
    imageUrl: null,
    createdAt,
    customDeck: deck || null,
    difficulty: 'unrated',
    bookmarked: false,
    exampleSentence: boundedText(draft.exampleSentence, 2048),
    exampleTranslation: boundedText(draft.exampleTranslation, 2048),
    partOfSpeech,
    cefrLevel: boundedText(draft.cefrLevel, 8),
    register: boundedText(draft.register, 64),
    commonMistake: boundedText(draft.commonMistake, 2048),
    ...(typeof draft.mnemonic === 'string' && draft.mnemonic.trim()
      ? { mnemonic: boundedText(draft.mnemonic, 2048) }
      : {}),
    ...(draft.wordFamily ? { wordFamily: boundedWordFamily(draft.wordFamily) } : {}),
  };
  return card;
};

export function createCardIntakeController({
  port,
  language = ENGLISH_TO_VIETNAMESE_PROFILE,
  draft: draftPort,
  diagnostics = {},
  resetImportSource = () => undefined,
  now = () => new Date().toISOString(),
  spreadsheetDelay,
}: CardIntakeControllerOptions) {
  let snapshot: CardIntakeSnapshot = {
    draft: readDraft(draftPort),
    isSubmitting: false,
    isImporting: false,
    isAdoptingSharedDeck: false,
    importProgress: null,
    importResult: null,
    error: null,
    cardCreator: createInitialCardCreatorModel(),
  };
  let activeOperation: 'generate' | 'spreadsheet' | 'shared' | 'catalog' | 'creator-generate' | 'creator-save' | null = null;
  let errorSource: CardIntakeErrorSource = null;
  let draftOperation = readDraftOperation(draftPort);
  let controllerLifecycle = 0;
  let creatorLifecycle = 0;
  let creatorFocusTarget: CardCreatorFocusTarget | null = null;
  let creatorOperation: {
    id: string;
    word: string;
    context: string;
    partOfSpeech: string;
  } | null = null;
  let creatorMediaPromise: Promise<CardMediaPatch | null> | null = null;
  let creatorGenerationAbort: AbortController | null = null;
  const creatorEditedFields = new Set<keyof CardData>();
  let creatorInvocation = 0;
  let activeOperationToken = 0;
  let spreadsheetLifecycle: number | null = null;
  let spreadsheetSessionIsActive: (() => boolean) | null = null;
  const cardLifecycles = new Map<string, number>();
  const listeners = new Set<(next: CardIntakeSnapshot) => void>();

  const publish = (patch: Partial<CardIntakeSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener(snapshot));
  };

  const publishError = (
    error: string | null,
    source: CardIntakeErrorSource,
    patch: Partial<CardIntakeSnapshot> = {},
  ) => {
    errorSource = error === null ? null : source;
    publish({ ...patch, error });
  };

  const clearError = () => publishError(null, null);
  const clearSharedAdoptionError = () => {
    if (errorSource === 'shared-adoption') clearError();
  };

  const setDraft = (value: string) => {
    if (draftOperation && language.normalize(value) !== draftOperation.word) {
      draftOperation = null;
      try { draftPort?.clearOperation?.(); } catch { /* storage is optional */ }
    }
    const cardCreator = snapshot.cardCreator;
    publish({
      draft: value,
      ...(cardCreator.open
        ? { cardCreator: { ...cardCreator, draft: { ...cardCreator.draft, word: value } } }
        : {}),
    });
    try {
      if (value) draftPort?.write(value);
      else draftPort?.clear();
    } catch {
      // The in-memory draft remains authoritative when browser storage is denied.
    }
  };

  const clearDraft = () => setDraft('');

  const publishCardCreator = (patch: Partial<CardCreatorModel>) => {
    publish({ cardCreator: { ...snapshot.cardCreator, ...patch } });
  };

  const isCreatorInvocationCurrent = (
    invocation: number,
    lifecycle: number,
    controllerGeneration: number,
  ): boolean =>
    creatorInvocation === invocation
    && creatorLifecycle === lifecycle
    && controllerLifecycle === controllerGeneration
    && snapshot.cardCreator.open;

  const spreadsheet = createSpreadsheetImportService({
    cards: port,
    feedback: {
      start: () => publish({ isImporting: true }),
      clearError,
      progress: importProgress => publish({ importProgress }),
      error: error => publishError(error, 'spreadsheet'),
      finish: () => publish({ isImporting: false }),
      resetSource: resetImportSource,
    },
    diagnostics: {
      workbookFailed: error => diagnostics.generationFailed?.(error),
    },
    delay: spreadsheetDelay,
    now,
    isActive: () => spreadsheetLifecycle !== null
      && controllerLifecycle === spreadsheetLifecycle
      && (spreadsheetSessionIsActive?.() ?? false),
  });

  const generateDraft = async (generationOptions: CardGenerationOptions = {}): Promise<GenerateResult> => {
    const normalizedWord = language.normalize(snapshot.draft);
    if (!normalizedWord) return { status: 'invalid', reason: 'empty' };
    if (normalizedWord.length > 80) {
      publishError('A word or phrase cannot be longer than 80 characters.', 'generation');
      return { status: 'invalid', reason: 'too-long' };
    }
    if (activeOperation) return { status: 'busy' };

    activeOperation = 'generate';
    const intakeLifecycle = controllerLifecycle;
    let captureAttempt: { requestId: string; surface: 'app' | 'extension'; startedAt: number } | null = null;
    publishError(null, null, { isSubmitting: true });
    try {
      const existingCards = await port.findExisting([normalizedWord]);
      const existing = existingCardFor(existingCards, normalizedWord, language);
      const requestedDeck = typeof generationOptions.requestedDeck === 'string'
        ? generationOptions.requestedDeck.trim().slice(0, 128)
        : '';
      if (requestedDeck && generationOptions.requestedDeckAvailable) {
        let available = false;
        try {
          available = await generationOptions.requestedDeckAvailable(requestedDeck);
        } catch {
          available = false;
        }
        if (!available) throw new RequestedDeckUnavailableError(requestedDeck);
      }
      if (existing) {
        const routedExisting = requestedDeck
          ? await port.assignExistingDeck?.(existing, requestedDeck)
          : existing;
        if (!routedExisting) throw new Error('The current runtime cannot route an existing card to a deck.');
        await port.touchExisting(routedExisting, now());
        clearDraft();
        return { status: 'existing', card: routedExisting };
      }

      const context = typeof generationOptions.context === 'string'
        ? generationOptions.context.replace(/\s+/g, ' ').trim().slice(0, 500)
        : '';
      const partOfSpeechHint = normalizePartOfSpeech(generationOptions.partOfSpeechHint);
      const suppliedId = generationOptions.operationId;
      const validSuppliedId = typeof suppliedId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId);
      if (!draftOperation || !draftOperationMatches(draftOperation, normalizedWord, context, language.id, partOfSpeechHint)
        || (validSuppliedId && draftOperation.id !== suppliedId)) {
        const operationId = validSuppliedId
          ? suppliedId : globalThis.crypto.randomUUID();
        draftOperation = {
          word: normalizedWord,
          context,
          languageId: language.id,
          id: operationId,
          ...(partOfSpeechHint ? { partOfSpeech: partOfSpeechHint } : {}),
        };
        try { draftPort?.writeOperation?.(draftOperation); } catch { /* storage is optional */ }
      }
      captureAttempt = {
        requestId: globalThis.crypto.randomUUID(),
        surface: generationOptions.surface === 'extension' ? 'extension' : 'app',
        startedAt: Date.now(),
      };
      try { diagnostics.captureStarted?.({ requestId: captureAttempt.requestId, surface: captureAttempt.surface }); }
      catch { /* analytics cannot block capture */ }
      const generated = await port.generateCard({
        term: normalizedWord,
        language,
        operationId: draftOperation.id,
        ...(context ? { context } : {}),
        ...(partOfSpeechHint ? { partOfSpeechHint } : {}),
        ...(requestedDeck ? { requestedDeck } : {}),
        ...(requestedDeck && generationOptions.requestedDeckAvailable
          ? { requestedDeckAvailable: generationOptions.requestedDeckAvailable }
          : {}),
      });
      const candidate: CardData = {
        ...generated.card,
        word: normalizedWord,
        normalizedWord,
        createdAt: generated.card.createdAt || now(),
      };
      const mediaResult = generated.mediaPromise.then(
        media => media,
        error => {
          diagnostics.mediaFailed?.(candidate, error);
          return null;
        },
      );
      const [persisted] = await port.persistCards([candidate], 'generate');
      if (!persisted) throw new Error('Card intake persistence returned no result.');
      clearDraft();

      if (!persisted.created) {
        return { status: 'existing', card: persisted.card };
      }

      const cardLifecycle = cardLifecycles.get(persisted.card.id) ?? 0;
      const mediaTask = settleMediaBestEffort(
        mediaResult,
        async media => {
          if (!media) return;
          if (controllerLifecycle !== intakeLifecycle) return;
          if ((cardLifecycles.get(persisted.card.id) ?? 0) !== cardLifecycle) return;
          if (
            persisted.card.audioUrl === media.audioUrl
            && persisted.card.imageUrl === media.imageUrl
          ) return;
          await port.applyMedia(persisted.card, media);
        },
        error => diagnostics.mediaFailed?.(persisted.card, error),
      );
      return { status: 'created', card: persisted.card, mediaTask };
    } catch (error) {
      if (captureAttempt) {
        try { diagnostics.captureFailed?.({
          requestId: captureAttempt.requestId, surface: captureAttempt.surface,
          latencyMs: Math.min(600_000, Math.max(0, Date.now() - captureAttempt.startedAt)), error,
        }); } catch { /* analytics cannot block capture */ }
      }
      diagnostics.generationFailed?.(error);
      publishError(
        error instanceof RequestedDeckUnavailableError ? error.message : captureFailureMessage(error),
        'generation',
      );
      return { status: 'failed', error };
    } finally {
      activeOperation = null;
      publish({ isSubmitting: false });
    }
  };

  const clearCreatorOperation = (keepMedia = false) => {
    creatorOperation = null;
    creatorEditedFields.clear();
    if (!keepMedia) creatorMediaPromise = null;
    draftOperation = null;
    try { draftPort?.clearOperation?.(); } catch { /* storage is optional */ }
  };

  const cancelCreatorGeneration = () => {
    const cancellingId = snapshot.cardCreator.stage === 'generating' ? creatorOperation?.id : null;
    creatorGenerationAbort?.abort();
    creatorGenerationAbort = null;
    if (cancellingId) void port.cancelGeneration?.(cancellingId).catch(() => undefined);
  };

  const closeCardCreator = () => {
    cancelCreatorGeneration();
    creatorLifecycle += 1;
    creatorInvocation += 1;
    if (activeOperation === 'creator-generate' || activeOperation === 'creator-save') {
      activeOperation = null;
    }
    clearCreatorOperation();
    clearDraft();
    creatorFocusTarget = null;
    // The dialog itself restores focus from its own onCloseAutoFocus (after
    // Radix's FocusScope trap has actually released) using the focusTarget
    // captured below in openCardCreator. Calling .focus() here would run
    // while Dialog.Content is still mounted and get overridden by that
    // still-active trap — see the doc comment on CardCreatorModel.focusTarget.
    publish({ isSubmitting: false, cardCreator: createInitialCardCreatorModel() });
  };

  const openCardCreator = (opener?: HTMLElement) => {
    creatorLifecycle += 1;
    creatorInvocation += 1;
    if (activeOperation === 'creator-generate' || activeOperation === 'creator-save') {
      activeOperation = null;
    }
    clearCreatorOperation();
    creatorFocusTarget = opener ?? null;
    publishCardCreator({
      ...createInitialCardCreatorModel(),
      open: true,
      draft: normalizeCreatorDraft({
        ...createEmptyCardCreatorDraft(),
        word: snapshot.draft,
      }),
      focusTarget: creatorFocusTarget,
    });
  };

  const updateCardCreatorDraft = (patch: Partial<CardCreatorDraft>) => {
    const current = snapshot.cardCreator;
    const nextDraft = normalizeCreatorDraft({ ...current.draft, ...patch });
    const requestChanged = nextDraft.word !== current.draft.word
      || nextDraft.context !== current.draft.context
      || nextDraft.partOfSpeech !== current.draft.partOfSpeech;
    if (requestChanged && (creatorOperation
      || activeOperation === 'creator-generate'
      || activeOperation === 'creator-save')) {
      cancelCreatorGeneration();
      creatorLifecycle += 1;
      creatorInvocation += 1;
      if (activeOperation === 'creator-generate' || activeOperation === 'creator-save') {
        activeOperation = null;
      }
      clearCreatorOperation();
    }
    const preview = requestChanged ? null : current.preview;
    const nextPreview = patch.deck !== undefined && preview
      ? { ...preview, customDeck: nextDraft.deck || null }
      : preview;
    publish({
      draft: nextDraft.word,
      cardCreator: {
        ...current,
        draft: nextDraft,
        stage: requestChanged ? 'input' : current.stage,
        preview: nextPreview,
        duplicate: requestChanged ? null : current.duplicate,
        error: requestChanged ? null : current.error,
      },
    });
    try {
      if (nextDraft.word) draftPort?.write(nextDraft.word);
      else draftPort?.clear();
    } catch {
      // The in-memory draft remains authoritative when browser storage is denied.
    }
  };

  const createManualCardCreatorDraft = (fields: ManualCardDraft) => {
    creatorLifecycle += 1;
    creatorInvocation += 1;
    if (activeOperation === 'creator-generate' || activeOperation === 'creator-save') {
      activeOperation = null;
    }
    clearCreatorOperation();
    const current = snapshot.cardCreator;
    const manualFields: ManualCardDraft = {
      ...fields,
      word: typeof fields.word === 'string' ? fields.word : current.draft.word,
      translation: typeof fields.translation === 'string' ? fields.translation : '',
    };
    const draft = normalizeCreatorDraft({
      ...current.draft,
      word: manualFields.word,
      partOfSpeech: manualFields.partOfSpeech ?? current.draft.partOfSpeech,
      deck: manualFields.deck ?? current.draft.deck,
    });
    const preview = manualCardFromDraft(manualFields, language, now());
    const error = preview
      ? null
      : createCardCreatorError('invalid', 'Enter a word and its meaning before saving the card.');
    publish({
      draft: draft.word,
      cardCreator: {
        ...current,
        open: true,
        stage: preview ? 'preview' : 'input',
        mode: 'manual',
        draft,
        preview,
        completedAiRequests: 0,
        duplicate: null,
        error,
      },
    });
    try {
      if (draft.word) draftPort?.write(draft.word);
      else draftPort?.clear();
    } catch {
      // The in-memory draft remains authoritative when browser storage is denied.
    }
  };

  const updateCardCreatorPreview = (patch: Partial<CardData>) => {
    const current = snapshot.cardCreator;
    if (!current.preview) return;
    const nextPatch = creatorPatch(patch);
    if (current.stage === 'generating') Object.keys(nextPatch).forEach(field => {
      creatorEditedFields.add(field as keyof CardData);
    });
    const nextPreview: CardData = { ...current.preview, ...nextPatch };
    const nextDraft = patch.customDeck === undefined
      ? current.draft
      : { ...current.draft, deck: typeof patch.customDeck === 'string' ? patch.customDeck : '' };
    publishCardCreator({
      preview: nextPreview,
      draft: nextDraft,
      stage: current.stage === 'generating' || current.stage === 'saving' ? current.stage : 'preview',
      error: null,
      duplicate: null,
    });
  };

  const generateCardCreatorPreview = async (
    regenerateFields?: readonly CardGenerationField[],
  ): Promise<CardCreateResult> => {
    const current = snapshot.cardCreator;
    if (activeOperation) return { status: 'busy' };
    if (!current.open) {
      const error = createCardCreatorError('invalid', 'Open the card creator before generating a preview.');
      return { status: 'failed', error };
    }
    if (current.mode === 'manual') {
      const error = createCardCreatorError('invalid', 'Manual cards are saved from the fields you enter.');
      publishCardCreator({ stage: 'error', error });
      return { status: 'failed', error };
    }
    const draft = normalizeCreatorDraft(current.draft);
    const normalizedWord = language.normalize(draft.word);
    if (!normalizedWord) {
      const error = createCardCreatorError('invalid', 'Enter a word or phrase first.');
      publishCardCreator({ stage: 'error', error });
      return { status: 'invalid', reason: 'empty', error };
    }
    if (normalizedWord.length > 80) {
      const error = createCardCreatorError('invalid', 'A word or phrase cannot be longer than 80 characters.');
      publishCardCreator({ stage: 'error', error });
      return { status: 'invalid', reason: 'too-long', error };
    }
    const context = draft.context;
    const partOfSpeechHint = draft.partOfSpeech;
    const requestedDeck = draft.deck;
    const isRegeneration = Boolean(regenerateFields);
    const selectedFields = (regenerateFields ?? []).filter((field): field is CardGenerationField =>
      creatorRegenerationFields.includes(field),
    );
    if (isRegeneration && !current.preview) {
      const error = createCardCreatorError('invalid', 'Generate a preview before regenerating its fields.');
      publishCardCreator({ stage: 'error', error });
      return { status: 'failed', error };
    }
    if (!isRegeneration && current.preview && current.stage === 'preview' && creatorOperation) {
      return { status: 'preview', card: current.preview, operationId: creatorOperation.id };
    }

    if (isRegeneration) {
      clearCreatorOperation(true);
    }
    creatorEditedFields.clear();
    const invocation = ++creatorInvocation;
    const lifecycle = creatorLifecycle;
    const controllerGeneration = controllerLifecycle;
    activeOperation = 'creator-generate';
    activeOperationToken = invocation;
    publish({
      isSubmitting: true,
      cardCreator: {
        ...snapshot.cardCreator,
        stage: 'generating',
        generationStage: null,
        draft,
        duplicate: null,
        error: null,
      },
    });
    let existingCards = new Map<string, CardData>();
    try {
      if (!isRegeneration) existingCards = await port.findExisting([normalizedWord]);
    } catch (error) {
      if (!isCreatorInvocationCurrent(invocation, lifecycle, controllerGeneration)) {
        return { status: 'cancelled' };
      }
      const createError = createCardCreatorError('generation', captureFailureMessage(error), error);
      diagnostics.generationFailed?.(error);
      publishCardCreator({ stage: 'error', error: createError });
      if (activeOperation === 'creator-generate' && activeOperationToken === invocation) {
        activeOperation = null;
        publish({ isSubmitting: false });
      }
      return { status: 'failed', error: createError };
    }
    if (!isCreatorInvocationCurrent(invocation, lifecycle, controllerGeneration)) {
      return { status: 'cancelled' };
    }
    if (!isRegeneration) {
      const existing = existingCardFor(existingCards, normalizedWord, language);
      if (existing) {
        const error = createCardCreatorError('duplicate', `“${existing.word}” is already in your library.`);
        publishCardCreator({ stage: 'error', duplicate: existing, error });
        if (activeOperation === 'creator-generate' && activeOperationToken === invocation) {
          activeOperation = null;
          publish({ isSubmitting: false });
        }
        return { status: 'duplicate', card: existing };
      }
    }
    const draftOperationMatchesCreator = creatorOperation
      && creatorOperation.word === normalizedWord
      && creatorOperation.context === context
      && creatorOperation.partOfSpeech === partOfSpeechHint;
    const storedOperationMatchesCreator = draftOperationMatches(
      draftOperation,
      normalizedWord,
      context,
      language.id,
      partOfSpeechHint,
    );
    if (!draftOperationMatchesCreator) {
      const operationId = storedOperationMatchesCreator
        ? draftOperation!.id
        : globalThis.crypto.randomUUID();
      creatorOperation = {
        id: operationId,
        word: normalizedWord,
        context,
        partOfSpeech: partOfSpeechHint,
      };
      draftOperation = {
        word: normalizedWord,
        context,
        languageId: language.id,
        id: operationId,
        ...(partOfSpeechHint ? { partOfSpeech: partOfSpeechHint } : {}),
      };
      try { draftPort?.writeOperation?.(draftOperation); } catch { /* storage is optional */ }
    }

    const initialPreview = isRegeneration ? current.preview : manualCardFromDraft({
      word: normalizedWord, translation: '', deck: requestedDeck, partOfSpeech: partOfSpeechHint,
    }, language, now(), true);
    if (initialPreview && !isRegeneration) publishCardCreator({ preview: {
      ...initialPreview, origin: 'ai',
      category: '', emoji: '',
    } });
    const generationPreview = snapshot.cardCreator.preview;
    const generationAbort = new AbortController();
    creatorGenerationAbort = generationAbort;

    try {
      const generated = await port.generateCard({
        term: normalizedWord,
        language,
        operationId: creatorOperation!.id,
        ...(context ? { context } : {}),
        ...(partOfSpeechHint ? { partOfSpeechHint } : {}),
        ...(requestedDeck ? { requestedDeck } : {}),
        onProgress: progress => {
          if (progress.operationId !== creatorOperation?.id
            || !isCreatorInvocationCurrent(invocation, lifecycle, controllerGeneration)
            || snapshot.cardCreator.stage !== 'generating') return;
          if (progress.stage === 'reserving' || progress.stage === 'drafting') {
            publishCardCreator({ generationStage: progress.stage });
            return;
          }
          if (progress.stage !== 'field' || !progress.field
            || !creatorPreviewFields.includes(progress.field as typeof creatorPreviewFields[number])
            || creatorEditedFields.has(progress.field as keyof CardData)) return;
          const value = progress.value;
          const valid = typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string'))
            || (progress.field === 'wordFamily' && value !== null && typeof value === 'object' && !Array.isArray(value));
          if (!valid || !snapshot.cardCreator.preview) return;
          publishCardCreator({ preview: { ...snapshot.cardCreator.preview, [progress.field]: value } });
        },
        signal: generationAbort.signal,
      });
      if (!isCreatorInvocationCurrent(invocation, lifecycle, controllerGeneration)) {
        void generated.mediaPromise.catch(() => undefined);
        return { status: 'cancelled' };
      }
      const generatedCard: CardData = {
        ...generated.card,
        id: current.preview?.id ?? generated.card.id,
        origin: 'ai',
        word: normalizedWord,
        normalizedWord,
        ...(requestedDeck ? { customDeck: requestedDeck } : {}),
        createdAt: generated.card.createdAt || now(),
      };
      const mediaResult = generated.mediaPromise.then(
        media => media,
        error => {
          diagnostics.mediaFailed?.(generatedCard, error);
          return null;
        },
      );
      if (!isRegeneration) creatorMediaPromise = mediaResult;
      if (isRegeneration) void mediaResult;
      const preview = isRegeneration
        ? mergeRegeneratedFields(snapshot.cardCreator.preview!, generatedCard, selectedFields)
        : generatedCard;
      for (const field of creatorEditedFields) {
        if (snapshot.cardCreator.preview && field in snapshot.cardCreator.preview) {
          (preview as unknown as Record<string, unknown>)[field] = snapshot.cardCreator.preview[field];
        }
      }
      creatorEditedFields.clear();
      const nextOperationId = creatorOperation!.id;
      publishCardCreator({
        stage: 'preview',
        generationStage: null,
        preview,
        completedAiRequests: snapshot.cardCreator.completedAiRequests + 1,
        duplicate: null,
        error: null,
      });
      return { status: 'preview', card: preview, operationId: nextOperationId };
    } catch (error) {
      if (!isCreatorInvocationCurrent(invocation, lifecycle, controllerGeneration)) {
        return { status: 'cancelled' };
      }
      const createError = createCardCreatorError(
        'generation',
        error instanceof RequestedDeckUnavailableError ? error.message : captureFailureMessage(error),
        error,
      );
      diagnostics.generationFailed?.(error);
      publishCardCreator({
        stage: 'error',
        generationStage: null,
        preview: snapshot.cardCreator.preview === generationPreview
          ? current.preview
          : snapshot.cardCreator.preview,
        error: createError,
      });
      return { status: 'failed', error: createError };
    } finally {
      if (creatorGenerationAbort === generationAbort) creatorGenerationAbort = null;
      if (activeOperation === 'creator-generate' && activeOperationToken === invocation) {
        activeOperation = null;
        publish({ isSubmitting: false });
      }
    }
  };

  const regenerateCardCreator = (fields: readonly CardGenerationField[]) => {
    if (!snapshot.cardCreator.preview) {
      const error = createCardCreatorError('invalid', 'Generate a preview before regenerating its fields.');
      publishCardCreator({ stage: 'error', error });
      return Promise.resolve<CardCreateResult>({ status: 'failed', error });
    }
    return generateCardCreatorPreview(fields);
  };

  const saveCardCreator = async (): Promise<CardCreateResult> => {
    const current = snapshot.cardCreator;
    if (activeOperation) return { status: 'busy' };
    if (!current.open || !current.preview || (current.mode === 'ai' && current.stage !== 'preview')) {
      const error = createCardCreatorError('invalid', 'Wait for a complete AI preview before saving.');
      publishCardCreator({ stage: 'error', error });
      return { status: 'failed', error };
    }
    const candidate: CardData = {
      ...current.preview,
      origin: current.mode === 'manual' ? 'manual' : 'ai',
      customDeck: current.draft.deck || current.preview.customDeck || null,
    };
    const invocation = ++creatorInvocation;
    const lifecycle = creatorLifecycle;
    const controllerGeneration = controllerLifecycle;
    const intakeLifecycle = controllerLifecycle;
    activeOperation = 'creator-save';
    activeOperationToken = invocation;
    publish({
      isSubmitting: true,
      cardCreator: { ...current, stage: 'saving', error: null, duplicate: null },
    });
    try {
      const [persisted] = await port.persistCards([candidate], 'generate');
      if (!isCreatorInvocationCurrent(invocation, lifecycle, controllerGeneration)) {
        return { status: 'cancelled' };
      }
      if (!persisted) throw new Error('Card intake persistence returned no result.');
      if (!persisted.created) {
        const error = createCardCreatorError('duplicate', `“${persisted.card.word}” is already in your library.`);
        publishCardCreator({ stage: 'error', duplicate: persisted.card, error });
        return { status: 'duplicate', card: persisted.card };
      }
      const mediaResult = creatorMediaPromise;
      const cardLifecycle = cardLifecycles.get(persisted.card.id) ?? 0;
      const mediaTask = mediaResult
        ? settleMediaBestEffort(
          mediaResult,
          async media => {
            if (!media) return;
            if (controllerLifecycle !== intakeLifecycle) return;
            if ((cardLifecycles.get(persisted.card.id) ?? 0) !== cardLifecycle) return;
            if (
              persisted.card.audioUrl === media.audioUrl
              && persisted.card.imageUrl === media.imageUrl
            ) return;
            await port.applyMedia(persisted.card, media);
          },
          error => diagnostics.mediaFailed?.(persisted.card, error),
        )
        : Promise.resolve();
      closeCardCreator();
      return { status: 'saved', card: persisted.card, mediaTask };
    } catch (error) {
      if (!isCreatorInvocationCurrent(invocation, lifecycle, controllerGeneration)) {
        return { status: 'cancelled' };
      }
      const createError = createCardCreatorError('save', captureFailureMessage(error), error);
      diagnostics.generationFailed?.(error);
      publishCardCreator({ stage: 'error', error: createError });
      return { status: 'failed', error: createError };
    } finally {
      if (activeOperation === 'creator-save' && activeOperationToken === invocation) {
        activeOperation = null;
        publish({ isSubmitting: false });
      }
    }
  };

  const cancelCardCreator = () => closeCardCreator();

  const importSpreadsheet = async (request: SpreadsheetImportRequest): Promise<IntakeOperationResult> => {
    if (activeOperation) {
      publishError('Wait for the current card operation to finish, then choose the spreadsheet again.', 'spreadsheet');
      return { status: 'busy' };
    }
    activeOperation = 'spreadsheet';
    const intakeLifecycle = controllerLifecycle;
    spreadsheetSessionIsActive = port.captureSession?.() ?? (() => true);
    spreadsheetLifecycle = intakeLifecycle;
    const isCurrent = () => controllerLifecycle === intakeLifecycle;
    const isOperationCurrent = () => isCurrent() && (spreadsheetSessionIsActive?.() ?? false);
    publishError(null, null, { isImporting: true, importResult: null });
    try {
      const result = await spreadsheet.import(request);
      if (!isOperationCurrent()) return { status: 'stale' };
      publish({ importResult: result });
      return result;
    } catch (error) {
      if (error instanceof SpreadsheetImportStaleError || !isOperationCurrent()) {
        return { status: 'stale' };
      }
      diagnostics.generationFailed?.(error);
      const result: SpreadsheetImportResult = {
        status: 'failed',
        reason: 'save',
        summary: { total: 0, created: 0, reused: 0, failed: 0, skipped: 0 },
        message: 'Could not finish the spreadsheet import. Check your connection and try again.',
      };
      publishError(result.message, 'spreadsheet', { importResult: result });
      return result;
    } finally {
      const shouldPublishFinalState = isOperationCurrent();
      spreadsheetSessionIsActive = null;
      spreadsheetLifecycle = null;
      activeOperation = null;
      if (shouldPublishFinalState) publish({ isImporting: false, importProgress: null });
    }
  };

  const adoptSharedDeck = async ({ cards, expectedPair }: {
    cards: readonly unknown[];
    expectedPair?: CardIntakeLanguagePair;
  }): Promise<
    | { status: 'busy' }
    | { status: 'pair-mismatch' }
    | { status: 'stale' }
    | { status: 'failed'; error: unknown }
    | { status: 'completed'; candidateCount: number; createdCount: number; reusedCount: number; cards: CardData[] }
  > => {
    const hasExpectedPair = !!expectedPair
      && typeof expectedPair.targetLanguage === 'string'
      && expectedPair.targetLanguage.length > 0
      && typeof expectedPair.nativeLanguage === 'string'
      && expectedPair.nativeLanguage.length > 0;
    if (expectedPair !== undefined && (!hasExpectedPair
      || language.source.code !== expectedPair.targetLanguage
      || language.target.code !== expectedPair.nativeLanguage)) {
      return { status: 'pair-mismatch' };
    }
    if (activeOperation) return { status: 'busy' };
    const intakeLifecycle = controllerLifecycle;
    activeOperation = 'shared';
    publishError(null, null, { isAdoptingSharedDeck: true });
    try {
      const seen = new Set<string>();
      const candidates = cards.slice(0, 100).flatMap(value => {
        const candidate = sharedCardCandidate(value, language, now());
        if (!candidate) return [];
        const identity = cardLogicalKey(candidate);
        if (seen.has(identity)) return [];
        seen.add(identity);
        return [candidate];
      });
      if (controllerLifecycle !== intakeLifecycle) return { status: 'stale' };
      const words = candidates.map(candidate => candidate.normalizedWord || candidate.word);
      const existingCards = words.length > 0 ? await port.findExisting(words) : new Map<string, CardData>();
      if (controllerLifecycle !== intakeLifecycle) return { status: 'stale' };
      if (expectedPair && (language.source.code !== expectedPair.targetLanguage
        || language.target.code !== expectedPair.nativeLanguage)) {
        return { status: 'pair-mismatch' };
      }
      const newCards = candidates.filter(candidate =>
        !existingCardFor(existingCards, candidate.normalizedWord || candidate.word, language, candidate));
      const persisted = newCards.length > 0
        ? await port.persistCards(newCards, 'shared')
        : [];
      if (controllerLifecycle !== intakeLifecycle) return { status: 'stale' };
      const createdCards = persisted.flatMap(result => result.created ? [result.card] : []);
      return {
        status: 'completed',
        candidateCount: candidates.length,
        createdCount: createdCards.length,
        reusedCount: candidates.length - createdCards.length,
        cards: createdCards,
      };
    } catch (error) {
      diagnostics.sharedDeckFailed?.(error);
      publishError(
        'Could not finish adding this shared deck. Retry the same link; cards already saved will be reused.',
        'shared-adoption',
      );
      return { status: 'failed', error };
    } finally {
      activeOperation = null;
      publish({ isAdoptingSharedDeck: false });
    }
  };

  const createConfirmedCatalogCards = async (
    cards: readonly CardData[],
  ): Promise<ConfirmedCatalogCardsResult> => {
    const invalidReason = catalogCardBatchError(cards);
    if (invalidReason) return { status: 'invalid', reason: invalidReason };
    if (activeOperation) return { status: 'busy' };
    activeOperation = 'catalog';
    publishError(null, null, { isSubmitting: true });
    try {
      return await port.createConfirmedCatalogCards(cards);
    } catch (error) {
      diagnostics.generationFailed?.(error);
      publishError('Could not confirm the catalog cards. Check your connection and try again.', 'generation');
      return { status: 'partial', cards: [], failedCount: cards.length };
    } finally {
      activeOperation = null;
      publish({ isSubmitting: false });
    }
  };

  const invalidateCard = (cardId: string) => {
    cardLifecycles.set(cardId, (cardLifecycles.get(cardId) ?? 0) + 1);
  };

  const dispose = () => {
    cancelCreatorGeneration();
    controllerLifecycle += 1;
    creatorLifecycle += 1;
    creatorInvocation += 1;
    activeOperation = null;
    creatorFocusTarget = null;
    clearCreatorOperation();
    listeners.clear();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: (next: CardIntakeSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDraft,
    clearDraft,
    generateDraft,
    cardCreator: {
      open: openCardCreator,
      updateDraft: updateCardCreatorDraft,
      generatePreview: () => generateCardCreatorPreview(),
      updatePreview: updateCardCreatorPreview,
      regenerate: regenerateCardCreator,
      createManualDraft: createManualCardCreatorDraft,
      save: saveCardCreator,
      cancel: cancelCardCreator,
    } satisfies CardCreatorActions,
    importSpreadsheet,
    adoptSharedDeck,
    createConfirmedCatalogCards,
    invalidateCard,
    clearError,
    clearSharedAdoptionError,
    dispose,
  };
}
