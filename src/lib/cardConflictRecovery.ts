import type { CardData } from '../types/card';
import type {
  ApplyCardPatchResult,
  DeleteCardWithTombstoneResult,
} from './cardRepository';

export interface CardPatchCommand {
  cardId: string;
  fields: Partial<CardData>;
  baseFields?: Partial<CardData>;
  fieldMask: readonly (keyof CardData)[];
  opId?: string;
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
 * Receipt-aware commands resolve safe disjoint-field rebases inside the
 * Firestore transaction. Legacy commands retain one bounded retry.
 */
export async function applyCardPatchWithConflictRecovery(
  command: CardPatchCommand,
  applyPatch: ApplyPatch,
): Promise<ApplyCardPatchResult> {
  const firstResult = await applyPatch(command);
  if (
    firstResult.applied
    || firstResult.reason !== 'revision-conflict'
    || command.opId
  ) {
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
