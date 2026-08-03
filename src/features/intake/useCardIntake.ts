import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SpreadsheetImportRequest } from '../importExport/spreadsheetImportService';
import type { LanguageProfile } from '../language/languageProfile';
import {
  createCardIntakeController,
  type CardIntakeControllerPort,
  type CardIntakeDraftPort,
  type CardIntakeSnapshot,
} from './cardIntakeController';

type IntakeController = ReturnType<typeof createCardIntakeController>;

export interface CardIntakePorts {
  cards: CardIntakeControllerPort;
  draft?: CardIntakeDraftPort;
  resetSpreadsheetSource?: () => void;
}

export interface CardIntakeBindingOptions {
  ports: CardIntakePorts;
  language?: LanguageProfile;
  now?: () => string;
  spreadsheetDelay?: (milliseconds: number) => Promise<void>;
}

export interface CardIntakeActions {
  changeDraft(value: string): void;
  clearDraft(): void;
  generate(): ReturnType<IntakeController['generateDraft']>;
  importSpreadsheet(request: SpreadsheetImportRequest): ReturnType<IntakeController['importSpreadsheet']>;
  adoptShared(request: { cards: readonly unknown[] }): ReturnType<IntakeController['adoptSharedDeck']>;
  invalidateCard(cardId: string): void;
  clearError(): void;
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
  && left.ports.draft === right.ports.draft
  && left.ports.resetSpreadsheetSource === right.ports.resetSpreadsheetSource
  && left.language === right.language
  && left.now === right.now
  && left.spreadsheetDelay === right.spreadsheetDelay;

const createController = (options: CardIntakeBindingOptions): IntakeController =>
  createCardIntakeController({
    port: options.ports.cards,
    draft: options.ports.draft,
    resetImportSource: options.ports.resetSpreadsheetSource,
    language: options.language,
    now: options.now,
    spreadsheetDelay: options.spreadsheetDelay,
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
    generate: () => controller.generateDraft(),
    importSpreadsheet: request => controller.importSpreadsheet(request),
    adoptShared: request => controller.adoptSharedDeck(request),
    invalidateCard: cardId => controller.invalidateCard(cardId),
    clearError: () => controller.clearError(),
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
  if (ownerRef.current === null) {
    ownerRef.current = createCardIntakeBindingOwner(options);
  }
  const owner = ownerRef.current;
  const model = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  );

  useEffect(() => {
    owner.replace(options);
  }, [
    owner,
    options.language,
    options.now,
    options.ports.cards,
    options.ports.draft,
    options.ports.resetSpreadsheetSource,
    options.spreadsheetDelay,
  ]);

  useEffect(() => () => owner.dispose(), [owner]);

  return { model, actions: owner.actions };
}
