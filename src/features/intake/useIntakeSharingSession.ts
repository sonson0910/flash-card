import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardData } from '../../types/card';
import type { SpreadsheetImportProgress } from '../importExport/spreadsheetImportService';
import type { LanguageProfile } from '../language/languageProfile';
import type { SharedDeckAdapter, SharedDeckBrowser } from '../sharing/sharedDeckSessionController';
import { useSharedDeckSession } from '../sharing/useSharedDeckSession';
import type { CardIntakeDraftPort } from './cardIntakeController';
import { useCardIntake, type CardIntakeActions } from './useCardIntake';
import {
  spreadsheetRequestFromFile,
  useCardIntakePort,
  type CardIntakePortOptions,
} from './useCardIntakePort';

export interface IntakeSharingFeedbackPort {
  reportError(message: string): void;
  notify(message: string): void;
}

export interface IntakeSharingSessionOptions {
  ownerKey: string | null;
  intake: CardIntakePortOptions;
  sharing: {
    adapter: SharedDeckAdapter;
    loadCards(category: string): Promise<readonly CardData[]>;
    browser?: SharedDeckBrowser;
  };
  draft?: CardIntakeDraftPort;
  language?: LanguageProfile;
  resetSpreadsheetSource?: () => void;
  feedback?: IntakeSharingFeedbackPort;
  externalBusy?: boolean;
}

export interface IntakeSharingSessionModel {
  draft: string;
  importProgress: SpreadsheetImportProgress | null;
  error: string | null;
  notice: string | null;
  isBusy: boolean;
  isSubmitting: boolean;
  isImporting: boolean;
  isAdoptingSharedDeck: boolean;
  share: {
    isLoading: boolean;
    activeShareId: string | null;
    shareLink: string | null;
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
  shareCategory(category: string): Promise<ShareCategoryResult>;
  revokeShare(): ReturnType<ReturnType<typeof useSharedDeckSession>['actions']['revokeShare']>;
  dismissShareLink(): void;
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
}: IntakeSharingSessionOptions): { model: IntakeSharingSessionModel; actions: IntakeSharingSessionActions } {
  const cardPort = useCardIntakePort(intake);
  const cardIntake = useCardIntake({
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
  const [facadeError, setFacadeError] = useState<string | null>(null);
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
    setFacadeError(null);
    return cardIntake.actions.importSpreadsheet(spreadsheetRequestFromFile(file));
  }, [cardIntake.actions]);

  const shareCategory = useCallback(async (category: string): Promise<ShareCategoryResult> => {
    setFacadeError(null);
    try {
      const cards = await loadShareCards(category);
      return sharedDeck.actions.createShare({ category, cards });
    } catch {
      setFacadeError('Could not load the cards needed to create this share link. Please try again.');
      return { status: 'failed' };
    }
  }, [loadShareCards, sharedDeck.actions]);

  const actions = useMemo<IntakeSharingSessionActions>(() => ({
    changeDraft: cardIntake.actions.changeDraft,
    clearDraft: cardIntake.actions.clearDraft,
    generate: cardIntake.actions.generate,
    importFile,
    shareCategory,
    revokeShare: sharedDeck.actions.revokeShare,
    dismissShareLink: sharedDeck.actions.dismissShareLink,
    clearError: () => {
      setFacadeError(null);
      cardIntake.actions.clearError();
      sharedDeck.actions.clearError();
    },
    clearNotice: sharedDeck.actions.clearNotice,
    invalidateCard: cardIntake.actions.invalidateCard,
  }), [cardIntake.actions, importFile, shareCategory, sharedDeck.actions]);

  const model = useMemo<IntakeSharingSessionModel>(() => ({
    draft: cardIntake.model.draft,
    importProgress: cardIntake.model.importProgress,
    error,
    notice,
    isBusy: externalBusy
      || cardIntake.model.isSubmitting
      || cardIntake.model.isImporting
      || cardIntake.model.isAdoptingSharedDeck
      || sharedDeck.model.isLoading,
    isSubmitting: cardIntake.model.isSubmitting,
    isImporting: cardIntake.model.isImporting,
    isAdoptingSharedDeck: cardIntake.model.isAdoptingSharedDeck,
    share: {
      isLoading: sharedDeck.model.isLoading,
      activeShareId: sharedDeck.model.activeShareId,
      shareLink: sharedDeck.model.shareLink,
      expiresAt: sharedDeck.model.expiresAt,
    },
  }), [cardIntake.model, error, externalBusy, notice, sharedDeck.model]);

  return { model, actions };
}
