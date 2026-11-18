import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { SpreadsheetImportRequest } from '../importExport/spreadsheetImportService';
import type { LanguageProfile } from '../language/languageProfile';
import {
  createCardIntakeController,
  type CardGenerationOptions,
  type CardIntakeControllerPort,
  type CardIntakeDraftPort,
  type CardIntakeLanguagePair,
  type CardIntakeSnapshot,
} from './cardIntakeController';
import { createInitialCardCreatorModel, type CardCreatorActions } from './card-creator-model';
import type { CardData } from '../../types/card';

type IntakeController = ReturnType<typeof createCardIntakeController>;

export interface CardIntakePorts {
  cards: CardIntakeControllerPort;
  draft?: CardIntakeDraftPort;
  resetSpreadsheetSource?: () => void;
}

export interface CardIntakeBindingOptions {
  ownerKey?: string | null;
  ports: CardIntakePorts;
  language?: LanguageProfile;
  now?: () => string;
  spreadsheetDelay?: (milliseconds: number) => Promise<void>;
  analytics?: {
    captureStarted(event: { requestId: string; surface: 'app' | 'extension' }): void;
    captureFailed(event: { requestId: string; surface: 'app' | 'extension'; latencyMs: number; error: unknown }): void;
  };
}

export interface CardIntakeActions {
  changeDraft(value: string): void;
  clearDraft(): void;
  generate(options?: CardGenerationOptions): ReturnType<IntakeController['generateDraft']>;
  importSpreadsheet(request: SpreadsheetImportRequest): ReturnType<IntakeController['importSpreadsheet']>;
  adoptShared(request: { cards: readonly unknown[]; expectedPair?: CardIntakeLanguagePair }): ReturnType<IntakeController['adoptSharedDeck']>;
  createConfirmedCatalogCards(cards: readonly CardData[]): ReturnType<IntakeController['createConfirmedCatalogCards']>;
  invalidateCard(cardId: string): void;
  clearError(): void;
  clearSharedAdoptionError(): void;
  cardCreator: CardCreatorActions;
}

export interface CardIntakeBindingOwner {
  getSnapshot(): CardIntakeSnapshot;
  subscribe(listener: () => void): () => void;
  replace(options: CardIntakeBindingOptions): void;
  dispose(): void;
  readonly actions: CardIntakeActions;
}

const sameOptions = (
  left: CardIntakeBindingOptions,
  right: CardIntakeBindingOptions,
): boolean => left.ports.cards === right.ports.cards
  && left.ownerKey === right.ownerKey
  && left.ports.draft === right.ports.draft
  && left.ports.resetSpreadsheetSource === right.ports.resetSpreadsheetSource
  && left.language === right.language
  && left.now === right.now
  && left.spreadsheetDelay === right.spreadsheetDelay
  && left.analytics === right.analytics;

const createController = (options: CardIntakeBindingOptions): IntakeController =>
  createCardIntakeController({
    port: options.ports.cards,
    draft: options.ports.draft,
    resetImportSource: options.ports.resetSpreadsheetSource,
    language: options.language,
    now: options.now,
    spreadsheetDelay: options.spreadsheetDelay,
    diagnostics: options.analytics,
  });

export function createCardIntakeBindingOwner(
  initialOptions: CardIntakeBindingOptions,
): CardIntakeBindingOwner {
  let options = initialOptions;
  let controller = createController(options);
  let snapshot = controller.getSnapshot();
  let disposed = false;
  let listeners = new Set<() => void>();
  let unsubscribeController: () => void = () => undefined;

  const notify = () => listeners.forEach(listener => listener());
  const connect = () => {
    unsubscribeController = controller.subscribe(next => {
      snapshot = next;
      notify();
    });
  };
  connect();

  const actions: CardIntakeActions = {
    changeDraft: value => controller.setDraft(value),
    clearDraft: () => controller.clearDraft(),
    generate: options => controller.generateDraft(options),
    importSpreadsheet: request => controller.importSpreadsheet(request),
    adoptShared: request => controller.adoptSharedDeck(request),
    createConfirmedCatalogCards: cards => controller.createConfirmedCatalogCards(cards),
    invalidateCard: cardId => controller.invalidateCard(cardId),
    clearError: () => controller.clearError(),
    clearSharedAdoptionError: () => controller.clearSharedAdoptionError(),
    cardCreator: {
      open: opener => controller.cardCreator.open(opener),
      updateDraft: patch => controller.cardCreator.updateDraft(patch),
      generatePreview: () => controller.cardCreator.generatePreview(),
      updatePreview: patch => controller.cardCreator.updatePreview(patch),
      regenerate: fields => controller.cardCreator.regenerate(fields),
      createManualDraft: fields => controller.cardCreator.createManualDraft(fields),
      save: () => controller.cardCreator.save(),
      cancel: () => controller.cardCreator.cancel(),
    },
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(nextOptions) {
      if (disposed || sameOptions(options, nextOptions)) return;
      unsubscribeController();
      controller.dispose();
      options = nextOptions;
      controller = createController(options);
      snapshot = controller.getSnapshot();
      connect();
      notify();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeController();
      controller.dispose();
      listeners.clear();
      listeners = new Set();
    },
    actions,
  };
}

export interface UseCardIntakeResult {
  model: CardIntakeSnapshot;
  actions: CardIntakeActions;
}

export function useCardIntake(options: CardIntakeBindingOptions): UseCardIntakeResult {
  const ownerRef = useRef<CardIntakeBindingOwner | null>(null);
  const ownerKeyRef = useRef(options.ownerKey);
  if (ownerRef.current === null) {
    ownerRef.current = createCardIntakeBindingOwner(options);
  }
  const owner = ownerRef.current;
  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  );
  const ownerChanged = ownerKeyRef.current !== options.ownerKey;
  const model = ownerChanged ? {
    ...snapshot,
    draft: '',
    isSubmitting: false,
    isImporting: false,
    isAdoptingSharedDeck: false,
    importProgress: null,
    importResult: null,
    error: null,
    cardCreator: createInitialCardCreatorModel(),
  } : snapshot;

  // Bind the new language/port before passive effects can accept a shared deck.
  // The controller still checks the pair at the operation boundary.
  useLayoutEffect(() => {
    ownerKeyRef.current = options.ownerKey;
    owner.replace(options);
  }, [
    owner,
    options.ownerKey,
    options.language,
    options.now,
    options.ports.cards,
    options.ports.draft,
    options.ports.resetSpreadsheetSource,
    options.spreadsheetDelay,
    options.analytics,
  ]);

  useEffect(() => () => owner.dispose(), [owner]);

  return { model, actions: owner.actions };
}
