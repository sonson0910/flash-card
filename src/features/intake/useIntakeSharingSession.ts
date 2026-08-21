import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withTimeout } from '../../lib/async';
import type {
  SpreadsheetImportProgress,
  SpreadsheetImportResult,
} from '../importExport/spreadsheetImportService';
import type { LanguageProfile } from '../language/languageProfile';
import type {
  SharedDeckAdapter,
  SharedDeckBrowser,
  SharedDeckCardBatch,
} from '../sharing/sharedDeckSessionController';
import { useSharedDeckSession } from '../sharing/useSharedDeckSession';
import type { CardIntakeControllerPort, CardIntakeDraftPort } from './cardIntakeController';
import { useCardIntake, type CardIntakeActions } from './useCardIntake';
import {
  spreadsheetRequestFromFile,
} from './spreadsheetFileRequest';
import type { CardIntakePortOptions } from './cardIntakePortContract';

const SHARE_CATEGORY_LOAD_TIMEOUT_MS = 20_000;

export interface IntakeSharingFeedbackPort {
  reportError(message: string): void;
  notify(message: string): void;
}

export interface IntakeSharingSessionOptions {
  ownerKey: string | null;
  intake: CardIntakePortOptions;
  sharing: {
    adapter: SharedDeckAdapter;
    loadCards(category: string): Promise<SharedDeckCardBatch>;
    browser?: SharedDeckBrowser;
  };
  draft?: CardIntakeDraftPort;
  language?: LanguageProfile;
  resetSpreadsheetSource?: () => void;
  feedback?: IntakeSharingFeedbackPort;
  externalBusy?: boolean;
}

export interface IntakeSharingSessionDependencies {
  useIntakePort(options: CardIntakePortOptions): CardIntakeControllerPort;
}

export interface IntakeSharingSessionModel {
  draft: string;
  importProgress: SpreadsheetImportProgress | null;
  importResult: SpreadsheetImportResult | null;
  error: string | null;
  notice: string | null;
  isBusy: boolean;
  isSubmitting: boolean;
  isImporting: boolean;
  isAdoptingSharedDeck: boolean;
  share: {
    isLoading: boolean;
    isShareDialogOpen: boolean;
    activeShareId: string | null;
    shareLink: string | null;
    shareWarning: string | null;
    incomingPreview: ReturnType<typeof useSharedDeckSession>['model']['incomingPreview'];
    expiresAt: string | null;
  };
}

type ShareCategoryResult = Awaited<ReturnType<ReturnType<typeof useSharedDeckSession>['actions']['createShare']>>;

export interface IntakeSharingSessionActions {
  changeDraft(value: string): void;
  clearDraft(): void;
  generate(): ReturnType<CardIntakeActions['generate']>;
  importFile(file: File | null): Promise<
    | { status: 'missing' }
    | Awaited<ReturnType<CardIntakeActions['importSpreadsheet']>>
  >;
  adoptCards?(cards: readonly unknown[]): ReturnType<CardIntakeActions['adoptShared']>;
  shareCategory(category: string): Promise<ShareCategoryResult>;
  acceptShared(): ReturnType<ReturnType<typeof useSharedDeckSession>['actions']['acceptShared']>;
  cancelShared(): void;
  revokeShare(): ReturnType<ReturnType<typeof useSharedDeckSession>['actions']['revokeShare']>;
  dismissShareLink(): void;
  showShareDialog(): void;
  clearError(): void;
  clearNotice(): void;
  invalidateCard(cardId: string): void;
}

const browserDraft: CardIntakeDraftPort = {
  read: () => {
    try { return globalThis.sessionStorage?.getItem('lingoflash_word_draft') ?? null; } catch { return null; }
  },
  write: value => {
    try { globalThis.sessionStorage?.setItem('lingoflash_word_draft', value); } catch { /* storage is optional */ }
  },
  clear: () => {
    try { globalThis.sessionStorage?.removeItem('lingoflash_word_draft'); } catch { /* storage is optional */ }
  },
};

export function useIntakeSharingSession({
  ownerKey,
  intake,
  sharing,
  draft = browserDraft,
  language,
  resetSpreadsheetSource,
  feedback,
  externalBusy = false,
}: IntakeSharingSessionOptions,
dependencies: IntakeSharingSessionDependencies,
): { model: IntakeSharingSessionModel; actions: IntakeSharingSessionActions } {
  const ownerSessionRef = useRef({ ownerKey, generation: 0 });
  if (ownerSessionRef.current.ownerKey !== ownerKey) {
    ownerSessionRef.current = {
      ownerKey,
      generation: ownerSessionRef.current.generation + 1,
    };
  }
  const ownerSessionGeneration = ownerSessionRef.current.generation;
  const sharePreparationSequenceRef = useRef(0);
  const activeSharePreparationRef = useRef<{
    id: number;
    ownerSessionGeneration: number;
  } | null>(null);
  const [preparingShareGeneration, setPreparingShareGeneration] = useState<number | null>(null);
  const isPreparingShare = preparingShareGeneration === ownerSessionGeneration;
  const cardPort = dependencies.useIntakePort(intake);
  const cardIntake = useCardIntake({
    ownerKey,
    ports: { cards: cardPort, draft, resetSpreadsheetSource },
    language,
  });
  const sharedIntake = useMemo(
    () => ({ adoptShared: cardIntake.actions.adoptShared }),
    [cardIntake.actions],
  );
  const sharedDeck = useSharedDeckSession({
    ownerKey,
    adapter: sharing.adapter,
    intake: sharedIntake,
    browser: sharing.browser,
  });
  const [facadeFailure, setFacadeFailure] = useState<{
    ownerSessionGeneration: number;
    message: string;
  } | null>(null);
  const facadeError = facadeFailure?.ownerSessionGeneration === ownerSessionGeneration
    ? facadeFailure.message
    : null;
  const error = facadeError ?? sharedDeck.model.error ?? cardIntake.model.error;
  const notice = sharedDeck.model.notice;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const loadShareCards = sharing.loadCards;

  useEffect(() => {
    if (error) feedbackRef.current?.reportError(error);
  }, [error]);
  useEffect(() => {
    if (notice) feedbackRef.current?.notify(notice);
  }, [notice]);

  const importFile = useCallback(async (file: File | null) => {
    if (!file) return { status: 'missing' } as const;
    setFacadeFailure(null);
    return cardIntake.actions.importSpreadsheet(spreadsheetRequestFromFile(file));
  }, [cardIntake.actions]);

  const shareCategory = useCallback(async (category: string): Promise<ShareCategoryResult> => {
    const operationOwnerSession = ownerSessionGeneration;
    if (ownerSessionRef.current.generation !== operationOwnerSession) return { status: 'stale' };
    if (activeSharePreparationRef.current?.ownerSessionGeneration === operationOwnerSession) {
      return { status: 'busy' };
    }
    const operation = {
      id: sharePreparationSequenceRef.current + 1,
      ownerSessionGeneration: operationOwnerSession,
    };
    sharePreparationSequenceRef.current = operation.id;
    activeSharePreparationRef.current = operation;
    setPreparingShareGeneration(operationOwnerSession);
    setFacadeFailure(null);
    try {
      const batch = await withTimeout(
        loadShareCards(category),
        SHARE_CATEGORY_LOAD_TIMEOUT_MS,
      );
      if (ownerSessionRef.current.generation !== operationOwnerSession) return { status: 'stale' };
      const result = await sharedDeck.actions.createShare({ category, ...batch });
      if (ownerSessionRef.current.generation !== operationOwnerSession) return { status: 'stale' };
      return result;
    } catch {
      if (ownerSessionRef.current.generation !== operationOwnerSession) return { status: 'stale' };
      setFacadeFailure({
        ownerSessionGeneration: operationOwnerSession,
        message: 'Could not load the cards needed to create this share link. Please try again.',
      });
      return { status: 'failed' };
    } finally {
      if (activeSharePreparationRef.current?.id === operation.id) {
        activeSharePreparationRef.current = null;
        if (ownerSessionRef.current.generation === operationOwnerSession) {
          setPreparingShareGeneration(current => (
            current === operationOwnerSession ? null : current
          ));
        }
      }
    }
  }, [loadShareCards, ownerSessionGeneration, sharedDeck.actions]);

  const actions = useMemo<IntakeSharingSessionActions>(() => ({
    changeDraft: cardIntake.actions.changeDraft,
    clearDraft: cardIntake.actions.clearDraft,
    generate: cardIntake.actions.generate,
    importFile,
    adoptCards: cards => cardIntake.actions.adoptShared({ cards }),
    shareCategory,
    acceptShared: sharedDeck.actions.acceptShared,
    cancelShared: sharedDeck.actions.cancelShared,
    revokeShare: sharedDeck.actions.revokeShare,
    dismissShareLink: sharedDeck.actions.dismissShareLink,
    showShareDialog: sharedDeck.actions.showShareDialog,
    clearError: () => {
      setFacadeFailure(null);
      cardIntake.actions.clearError();
      sharedDeck.actions.clearError();
    },
    clearNotice: sharedDeck.actions.clearNotice,
    invalidateCard: cardIntake.actions.invalidateCard,
  }), [cardIntake.actions, importFile, shareCategory, sharedDeck.actions]);

  const model = useMemo<IntakeSharingSessionModel>(() => ({
    draft: cardIntake.model.draft,
    importProgress: cardIntake.model.importProgress,
    importResult: cardIntake.model.importResult,
    error,
    notice,
    isBusy: externalBusy
      || cardIntake.model.isSubmitting
      || cardIntake.model.isImporting
      || cardIntake.model.isAdoptingSharedDeck
      || isPreparingShare
      || sharedDeck.model.isLoading,
    isSubmitting: cardIntake.model.isSubmitting,
    isImporting: cardIntake.model.isImporting,
    isAdoptingSharedDeck: cardIntake.model.isAdoptingSharedDeck,
    share: {
      isLoading: isPreparingShare || sharedDeck.model.isLoading,
      isShareDialogOpen: sharedDeck.model.isShareDialogOpen,
      activeShareId: sharedDeck.model.activeShareId,
      shareLink: sharedDeck.model.shareLink,
      shareWarning: sharedDeck.model.shareWarning,
      incomingPreview: sharedDeck.model.incomingPreview,
      expiresAt: sharedDeck.model.expiresAt,
    },
  }), [cardIntake.model, error, externalBusy, isPreparingShare, notice, sharedDeck.model]);

  return { model, actions };
}
