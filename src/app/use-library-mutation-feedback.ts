import { useCallback, useEffect, useRef, useState, type RefObject, type SetStateAction } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import type { UndoToastItem } from '../components/ui/UndoToast';
import type { LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import { canStartLibraryClear } from '../features/library/libraryMutationRecovery';
import type { LibraryDialogPhase } from '../features/library/LibraryDialogOverlays';

interface LibraryMutationFeedbackOptions {
  ownerId: string | null;
  activeOwnerIdRef: RefObject<string | null>;
  commands: Pick<LearningWorkspaceActions, 'deleteCard' | 'restoreCard' | 'clearLibrary'>;
  isLibraryBusy: boolean;
  reportError(message: SetStateAction<string | null>): void;
  offerUndo(ownerId: string | null, toast: UndoToastItem): void;
}

interface ClearFeedback {
  ownerId: string | null;
  status: LibraryDialogPhase;
  errorMessage: string | null;
}

export function useLibraryMutationFeedback({
  ownerId, activeOwnerIdRef, commands, isLibraryBusy,
  reportError, offerUndo,
}: LibraryMutationFeedbackOptions) {
  const { _ } = useLingui();
  const [clearFeedback, setClearFeedback] = useState<ClearFeedback>(() => ({
    ownerId,
    status: 'idle',
    errorMessage: null,
  }));
  const clearRequestRef = useRef(0);
  const clearInFlightRef = useRef(false);
  const ownerGenerationRef = useRef(0);
  const lastOwnerIdRef = useRef(ownerId);
  const deleteRequestRef = useRef(0);
  const deleteErrorRef = useRef<readonly [string, number, string] | null>(null);

  if (lastOwnerIdRef.current !== ownerId) {
    lastOwnerIdRef.current = ownerId;
    ownerGenerationRef.current += 1;
    clearRequestRef.current += 1;
    clearInFlightRef.current = false;
    deleteErrorRef.current = null;
  }

  useEffect(() => {
    setClearFeedback(current => current.ownerId === ownerId
      ? current
      : { ownerId, status: 'idle', errorMessage: null });
  }, [ownerId]);

  const deleteCard = useCallback(async (id: string) => {
    if (activeOwnerIdRef.current !== ownerId) return false;
    const requestId = ++deleteRequestRef.current;
    try {
      const outcome = await commands.deleteCard(id);
      if (outcome.status !== 'published') {
        if (activeOwnerIdRef.current === ownerId) {
          const message = _(msg({ id: 'shell.card.delete-failed', message: 'The card could not be deleted. Please try again.' }));
          deleteErrorRef.current = [id, requestId, message];
          reportError(message);
        }
        return false;
      }
      if (activeOwnerIdRef.current !== ownerId) return false;
      const deleteError = deleteErrorRef.current;
      if (deleteError?.[0] === id && requestId > deleteError[1]) {
        deleteErrorRef.current = null;
        reportError(current => current === deleteError[2] ? null : current);
      }
      const token = outcome.result.undoToken;
      if (token) {
        offerUndo(token.ownerId, {
          id: token.lifecycleId,
          message: _(msg({ id: 'shell.undo.card-deleted', message: 'Card deleted.' })),
          subject: token.card.word,
          onUndo: () => {
            void commands.restoreCard(token).then(restored => {
              if (activeOwnerIdRef.current === token.ownerId && restored.status !== 'published') {
                reportError(_(msg({ id: 'shell.undo.restore-failed', message: 'This card could not be restored. Please check your library and try again.' })));
              }
            }).catch(() => {
              if (activeOwnerIdRef.current === token.ownerId) {
                reportError(_(msg({ id: 'shell.undo.restore-failed', message: 'This card could not be restored. Please check your library and try again.' })));
              }
            });
          },
        });
      }
      return true;
    } catch (cause) {
      if (activeOwnerIdRef.current === ownerId) {
        const message = cause instanceof Error ? cause.message : _(msg({ id: 'shell.card.delete-failed', message: 'The card could not be deleted. Please try again.' }));
        deleteErrorRef.current = [id, requestId, message];
        reportError(message);
      }
      return false;
    }
  }, [_, commands, offerUndo, activeOwnerIdRef, reportError, ownerId]);

  const clearAll = useCallback(async () => {
    if (
      clearInFlightRef.current
      || activeOwnerIdRef.current !== ownerId
      || !canStartLibraryClear(isLibraryBusy)
    ) {
      if (!clearInFlightRef.current && activeOwnerIdRef.current === ownerId && !canStartLibraryClear(isLibraryBusy)) {
        setClearFeedback({
          ownerId,
          status: 'failure',
          errorMessage: 'Wait for the current card generation or import to finish before clearing the library.',
        });
      }
      return;
    }

    clearInFlightRef.current = true;
    const requestId = ++clearRequestRef.current;
    const ownerGeneration = ownerGenerationRef.current;
    setClearFeedback({ ownerId, status: 'working', errorMessage: null });
    try {
      await commands.clearLibrary();
      if (
        activeOwnerIdRef.current === ownerId
        && ownerGenerationRef.current === ownerGeneration
        && clearRequestRef.current === requestId
      ) {
        setClearFeedback({ ownerId, status: 'success', errorMessage: null });
      }
    } catch (cause) {
      if (
        activeOwnerIdRef.current === ownerId
        && ownerGenerationRef.current === ownerGeneration
        && clearRequestRef.current === requestId
      ) {
        const errorMessage = cause instanceof Error ? cause.message : 'The library could not be cleared. Please try again.';
        setClearFeedback({ ownerId, status: 'failure', errorMessage });
      }
    } finally {
      if (clearRequestRef.current === requestId) clearInFlightRef.current = false;
    }
  }, [activeOwnerIdRef, commands, isLibraryBusy, ownerId, reportError]);

  const resetClearFeedback = useCallback(() => {
    clearRequestRef.current += 1;
    clearInFlightRef.current = false;
    if (activeOwnerIdRef.current !== ownerId) return;
    setClearFeedback({ ownerId, status: 'idle', errorMessage: null });
  }, [activeOwnerIdRef, ownerId]);

  const currentClearFeedback = clearFeedback.ownerId === ownerId
    ? clearFeedback
    : { ownerId, status: 'idle' as const, errorMessage: null };

  return {
    deleteCard,
    clearAll,
    clearStatus: currentClearFeedback.status,
    clearError: currentClearFeedback.errorMessage,
    resetClearFeedback,
  };
}
