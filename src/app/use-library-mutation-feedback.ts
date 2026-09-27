import { useCallback, type RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import type { UndoToastItem } from '../components/ui/UndoToast';
import type { LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import { canStartLibraryClear } from '../features/library/libraryMutationRecovery';

interface LibraryMutationFeedbackOptions {
  ownerId: string | null;
  activeOwnerIdRef: RefObject<string | null>;
  commands: Pick<LearningWorkspaceActions, 'deleteCard' | 'restoreCard' | 'clearLibrary'>;
  isLibraryBusy: boolean;
  setClearConfirm(open: boolean): void;
  reportError(message: string | null): void;
  offerUndo(ownerId: string | null, toast: UndoToastItem): void;
}

export function useLibraryMutationFeedback({
  ownerId, activeOwnerIdRef, commands, isLibraryBusy,
  setClearConfirm, reportError, offerUndo,
}: LibraryMutationFeedbackOptions) {
  const { _ } = useLingui();
  const deleteCard = useCallback(async (id: string) => {
    try {
      const outcome = await commands.deleteCard(id);
      if (outcome.status !== 'published') return;
      const token = outcome.result.undoToken;
      if (!token) return;
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
    } catch (cause) {
      if (activeOwnerIdRef.current === ownerId) {
        reportError(cause instanceof Error ? cause.message : _(msg({ id: 'shell.card.delete-failed', message: 'The card could not be deleted. Please try again.' })));
      }
    }
  }, [_, commands, offerUndo, activeOwnerIdRef, reportError, ownerId]);

  const clearAll = async () => {
    if (!canStartLibraryClear(isLibraryBusy)) {
      reportError('Wait for the current card generation or import to finish before clearing the library.');
      return;
    }
    setClearConfirm(false);
    try {
      await commands.clearLibrary();
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : 'The library could not be cleared. Please try again.');
    }
  };

  return { deleteCard, clearAll };
}
