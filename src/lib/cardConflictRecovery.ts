import type { CardData } from '../types/card';
import type {
  ApplyCardPatchResult,
  DeleteCardWithTombstoneResult,
} from './cardRepository';

export interface CardPatchCommand {
  cardId: string;
  fields: Partial<CardData>;
  fieldMask: readonly (keyof CardData)[];
  baseRevision: number;
  libraryEpoch: number;
}

export interface CardDeleteCommand {
  cardId: string;
  opId: string;
  baseRevision: number;
  libraryEpoch: number;
}

type ApplyPatch = (command: CardPatchCommand) => Promise<ApplyCardPatchResult>;
type ApplyDelete = (command: CardDeleteCommand) => Promise<DeleteCardWithTombstoneResult>;

/**
 * A field-level patch is safe to rebase because the repository only writes the
 * declared field mask. Retry exactly once so a hot card cannot spin forever.
 */
export async function applyCardPatchWithConflictRecovery(
  command: CardPatchCommand,
  applyPatch: ApplyPatch,
): Promise<ApplyCardPatchResult> {
  const firstResult = await applyPatch(command);
  if (firstResult.applied || firstResult.reason !== 'revision-conflict') {
    return firstResult;
  }
  return applyPatch({
    ...command,
    baseRevision: firstResult.currentRevision,
  });
}

/**
 * A queued delete represents an explicit user intent. Re-check the exact latest
 * revision and retry once; a second concurrent edit remains queued for a later
 * recovery cycle instead of being overwritten in a loop.
 */
export async function deleteCardWithConflictRecovery(
  command: CardDeleteCommand,
  applyDelete: ApplyDelete,
): Promise<DeleteCardWithTombstoneResult> {
  const firstResult = await applyDelete(command);
  if (firstResult.deleted || firstResult.reason !== 'revision-conflict') {
    return firstResult;
  }
  return applyDelete({
    ...command,
    baseRevision: firstResult.currentRevision,
  });
}
