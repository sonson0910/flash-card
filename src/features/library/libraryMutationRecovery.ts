export const canStartLibraryClear = (isLibraryMutationInFlight: boolean) => !isLibraryMutationInFlight;

export async function runEpochProtectedLibraryClear({
  incrementEpoch,
  onEpochAdvanced,
  clearPending,
  deleteCards,
  assertActive = () => undefined,
}: {
  incrementEpoch: () => Promise<number>;
  onEpochAdvanced: (epoch: number) => void;
  clearPending: () => Promise<void>;
  deleteCards: (epoch: number) => Promise<void>;
  assertActive?: () => void;
}): Promise<number> {
  assertActive();
  const nextEpoch = await incrementEpoch();
  assertActive();
  onEpochAdvanced(nextEpoch);
  assertActive();
  await clearPending();
  assertActive();
  await deleteCards(nextEpoch);
  assertActive();
  return nextEpoch;
}

export const planClearFailureRecovery = (cardDeletionCompleted: boolean) => ({
  clearLocalView: cardDeletionCompleted,
  message: cardDeletionCompleted
    ? 'Cards were deleted, but library metadata could not be fully reset. Refreshing the cloud view now.'
    : 'The clear operation stopped before it could be verified. Some cards may already have been deleted; refreshing the cloud view now.',
});

export const planDeckDeletionFailureRecovery = (
  assignmentsCleared: boolean,
  deckProfileRemoved: boolean,
) => ({
  applyLocalResult: assignmentsCleared && deckProfileRemoved,
  message: assignmentsCleared && deckProfileRemoved
    ? 'The deck was deleted, but its local backup could not be fully updated. Refreshing the cloud view now.'
    : 'Deck deletion may have partially completed. Refreshing the cloud view before you try again.',
});
