import { isSupportedAudioUrl } from '../../lib/audio';
import { createWordCardId } from '../../lib/cardIdentity';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { isSupportedImageUrl } from '../../lib/images';
import type { CardData } from '../../types/card';
import {
  createSpreadsheetImportService,
  type CardIntakePort as SpreadsheetCardIntakePort,
  type SpreadsheetImportProgress,
  type SpreadsheetImportRequest,
} from '../importExport/spreadsheetImportService';
import {
  ENGLISH_TO_VIETNAMESE_PROFILE,
  type LanguageProfile,
} from '../language/languageProfile';

export interface CardMediaPatch {
  audioUrl: string | null;
  imageUrl: string | null;
}

export interface CardIntakeControllerPort extends SpreadsheetCardIntakePort {
  generateCard(word: string, language: LanguageProfile): Promise<{
    card: CardData;
    mediaPromise: Promise<CardMediaPatch>;
  }>;
  persistCards(cards: readonly CardData[], source: 'generate' | 'shared'): Promise<Array<{
    card: CardData;
    created: boolean;
  }>>;
  applyMedia(card: CardData, media: CardMediaPatch): Promise<void>;
}

export interface CardIntakeDraftPort {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export interface CardIntakeSnapshot {
  draft: string;
  isSubmitting: boolean;
  isImporting: boolean;
  isAdoptingSharedDeck: boolean;
  importProgress: SpreadsheetImportProgress | null;
  error: string | null;
}

type GenerateResult =
  | { status: 'invalid'; reason: 'empty' | 'too-long' }
  | { status: 'busy' }
  | { status: 'existing'; card: CardData }
  | { status: 'created'; card: CardData; mediaTask: Promise<void> }
  | { status: 'failed'; error: unknown };

type IntakeOperationResult = { status: 'busy' } | { status: 'completed' } | { status: 'failed'; error: unknown };

interface CardIntakeDiagnosticsPort {
  generationFailed?(error: unknown): void;
  sharedDeckFailed?(error: unknown): void;
  mediaFailed?(card: CardData, error: unknown): void;
}

interface CardIntakeControllerOptions {
  port: CardIntakeControllerPort;
  language?: LanguageProfile;
  draft?: CardIntakeDraftPort;
  diagnostics?: CardIntakeDiagnosticsPort;
  resetImportSource?: () => void;
  now?: () => string;
  spreadsheetDelay?: (milliseconds: number) => Promise<void>;
}

const readDraft = (draft: CardIntakeDraftPort | undefined): string => {
  try {
    return draft?.read() ?? '';
  } catch {
    return '';
  }
};

const boundedText = (value: unknown, maximum: number): string =>
  (typeof value === 'string' ? value : String(value ?? '')).trim().slice(0, maximum);

const existingCardFor = (
  existingCards: ReadonlyMap<string, CardData>,
  normalizedWord: string,
  language: LanguageProfile,
): CardData | null => existingCards.get(normalizedWord)
  ?? Array.from(existingCards.values()).find(card =>
    language.normalize(card.normalizedWord || card.word) === normalizedWord)
  ?? null;

const sharedCardCandidate = (
  value: unknown,
  language: LanguageProfile,
  createdAt: string,
): CardData | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<CardData>;
  const word = language.normalize(source.word).slice(0, 80);
  if (!word || typeof source.translation !== 'string') return null;
  return {
    id: createWordCardId(word),
    word,
    normalizedWord: word,
    translation: boundedText(source.translation, 256),
    explanation: boundedText(source.explanation, 2048),
    phonetic: boundedText(source.phonetic, 256),
    category: boundedText(source.category, 128) || 'Shared',
    partOfSpeech: normalizePartOfSpeech(source.partOfSpeech),
    emoji: boundedText(source.emoji, 64) || '📝',
    audioUrl: isSupportedAudioUrl(source.audioUrl) ? source.audioUrl : null,
    imageUrl: isSupportedImageUrl(source.imageUrl) ? source.imageUrl ?? null : null,
    createdAt,
    customDeck: null,
    difficulty: 'unrated',
    bookmarked: false,
  };
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
    error: null,
  };
  let activeOperation: 'generate' | 'spreadsheet' | 'shared' | null = null;
  let controllerLifecycle = 0;
  const cardLifecycles = new Map<string, number>();
  const listeners = new Set<(next: CardIntakeSnapshot) => void>();

  const publish = (patch: Partial<CardIntakeSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener(snapshot));
  };

  const setDraft = (value: string) => {
    publish({ draft: value });
    try {
      if (value) draftPort?.write(value);
      else draftPort?.clear();
    } catch {
      // The in-memory draft remains authoritative when browser storage is denied.
    }
  };

  const clearDraft = () => setDraft('');

  const spreadsheet = createSpreadsheetImportService({
    cards: port,
    feedback: {
      start: () => publish({ isImporting: true }),
      clearError: () => publish({ error: null }),
      progress: importProgress => publish({ importProgress }),
      error: error => publish({ error }),
      finish: () => publish({ isImporting: false }),
      resetSource: resetImportSource,
    },
    diagnostics: {
      workbookFailed: error => diagnostics.generationFailed?.(error),
    },
    delay: spreadsheetDelay,
    now,
  });

  const generateDraft = async (): Promise<GenerateResult> => {
    const normalizedWord = language.normalize(snapshot.draft);
    if (!normalizedWord) return { status: 'invalid', reason: 'empty' };
    if (normalizedWord.length > 80) {
      publish({ error: 'A word or phrase cannot be longer than 80 characters.' });
      return { status: 'invalid', reason: 'too-long' };
    }
    if (activeOperation) return { status: 'busy' };

    activeOperation = 'generate';
    const intakeLifecycle = controllerLifecycle;
    publish({ isSubmitting: true, error: null });
    try {
      const existingCards = await port.findExisting([normalizedWord]);
      const existing = existingCardFor(existingCards, normalizedWord, language);
      if (existing) {
        await port.touchExisting(existing, now());
        clearDraft();
        return { status: 'existing', card: existing };
      }

      const generated = await port.generateCard(normalizedWord, language);
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
      const mediaTask = mediaResult.then(async media => {
        if (!media) return;
        if (controllerLifecycle !== intakeLifecycle) return;
        if ((cardLifecycles.get(persisted.card.id) ?? 0) !== cardLifecycle) return;
        await port.applyMedia(persisted.card, media);
      });
      return { status: 'created', card: persisted.card, mediaTask };
    } catch (error) {
      diagnostics.generationFailed?.(error);
      publish({ error: 'Failed to generate the flashcard. Your word is still here, so you can try again.' });
      return { status: 'failed', error };
    } finally {
      activeOperation = null;
      publish({ isSubmitting: false });
    }
  };

  const importSpreadsheet = async (request: SpreadsheetImportRequest): Promise<IntakeOperationResult> => {
    if (activeOperation) return { status: 'busy' };
    activeOperation = 'spreadsheet';
    publish({ isImporting: true, error: null });
    try {
      await spreadsheet.import(request);
      return { status: 'completed' };
    } catch (error) {
      return { status: 'failed', error };
    } finally {
      activeOperation = null;
      publish({ isImporting: false, importProgress: null });
    }
  };

  const adoptSharedDeck = async ({ cards }: { cards: readonly unknown[] }): Promise<
    | { status: 'busy' }
    | { status: 'failed'; error: unknown }
    | { status: 'completed'; candidateCount: number; createdCount: number; reusedCount: number; cards: CardData[] }
  > => {
    if (activeOperation) return { status: 'busy' };
    activeOperation = 'shared';
    publish({ isAdoptingSharedDeck: true, error: null });
    try {
      const seen = new Set<string>();
      const candidates = cards.slice(0, 100).flatMap(value => {
        const candidate = sharedCardCandidate(value, language, now());
        if (!candidate || seen.has(candidate.normalizedWord || candidate.word)) return [];
        seen.add(candidate.normalizedWord || candidate.word);
        return [candidate];
      });
      const words = candidates.map(candidate => candidate.normalizedWord || candidate.word);
      const existingCards = words.length > 0 ? await port.findExisting(words) : new Map<string, CardData>();
      const newCards = candidates.filter(candidate =>
        !existingCardFor(existingCards, candidate.normalizedWord || candidate.word, language));
      const persisted = newCards.length > 0
        ? await port.persistCards(newCards, 'shared')
        : [];
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
      publish({ error: 'Could not verify the complete library for this shared deck, so no cards were created.' });
      return { status: 'failed', error };
    } finally {
      activeOperation = null;
      publish({ isAdoptingSharedDeck: false });
    }
  };

  const invalidateCard = (cardId: string) => {
    cardLifecycles.set(cardId, (cardLifecycles.get(cardId) ?? 0) + 1);
  };

  const clearError = () => publish({ error: null });

  const dispose = () => {
    controllerLifecycle += 1;
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
    importSpreadsheet,
    adoptSharedDeck,
    invalidateCard,
    clearError,
    dispose,
  };
}
