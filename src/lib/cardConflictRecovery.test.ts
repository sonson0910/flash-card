import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import {
  applyCardPatchWithConflictRecovery,
  deleteCardWithConflictRecovery,
} from './cardConflictRecovery';

type PatchCommand = {
  cardId: string;
  fields: Partial<CardData>;
  fieldMask: readonly (keyof CardData)[];
  baseRevision: number;
  libraryEpoch: number;
};

type PatchAttemptResult =
  | { applied: true; revision: number }
  | {
    applied: false;
    reason: 'revision-conflict';
    currentRevision: number;
  };

describe('card patch conflict recovery', () => {
  it('rebases once onto the latest cloud revision without replacing fields outside the field mask', async () => {
    let cloudCard = {
      id: 'word-quite',
      translation: 'cloud translation',
      imageUrl: 'https://images.example/cloud-quite.jpg',
      bookmarked: false,
      difficulty: 'good',
      revision: 8,
    };
    const attemptedBaseRevisions: number[] = [];
    const applyPatch = async (attempt: PatchCommand): Promise<PatchAttemptResult> => {
      attemptedBaseRevisions.push(attempt.baseRevision);
      if (attempt.baseRevision !== cloudCard.revision) {
        return {
          applied: false,
          reason: 'revision-conflict',
          currentRevision: cloudCard.revision,
        };
      }

      const maskedFields = Object.fromEntries(
        attempt.fieldMask.flatMap(field =>
          Object.prototype.hasOwnProperty.call(attempt.fields, field)
            ? [[field, attempt.fields[field]]]
            : [],
        ),
      );
      cloudCard = {
        ...cloudCard,
        ...maskedFields,
        revision: cloudCard.revision + 1,
      };
      return { applied: true, revision: cloudCard.revision };
    };

    const result = await applyCardPatchWithConflictRecovery({
      cardId: cloudCard.id,
      fields: {
        bookmarked: true,
        translation: 'stale local translation that is not in the mask',
      },
      fieldMask: ['bookmarked'],
      baseRevision: 7,
      libraryEpoch: 3,
    }, applyPatch);

    expect(result).toEqual({ applied: true, revision: 9 });
    expect(attemptedBaseRevisions).toEqual([7, 8]);
    expect(cloudCard).toEqual({
      id: 'word-quite',
      translation: 'cloud translation',
      imageUrl: 'https://images.example/cloud-quite.jpg',
      bookmarked: true,
      difficulty: 'good',
      revision: 9,
    });
  });

  it('stops after one rebase retry when the cloud revision keeps changing', async () => {
    let currentRevision = 11;
    const attemptedBaseRevisions: number[] = [];
    const alwaysConflicts = async (attempt: PatchCommand): Promise<PatchAttemptResult> => {
      attemptedBaseRevisions.push(attempt.baseRevision);
      const conflict = {
        applied: false as const,
        reason: 'revision-conflict' as const,
        currentRevision,
      };
      currentRevision += 1;
      return conflict;
    };

    const result = await applyCardPatchWithConflictRecovery({
      cardId: 'word-quite',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 4,
      libraryEpoch: 3,
    }, alwaysConflicts);

    expect(result).toEqual({
      applied: false,
      reason: 'revision-conflict',
      currentRevision: 12,
    });
    expect(attemptedBaseRevisions).toEqual([4, 11]);
  });
});

describe('card delete conflict recovery', () => {
  it('rebases an explicit delete once onto the latest cloud revision', async () => {
    const attemptedBaseRevisions: number[] = [];
    const applyDelete = async (command: {
      cardId: string;
      opId: string;
      baseRevision: number;
      libraryEpoch: number;
    }) => {
      attemptedBaseRevisions.push(command.baseRevision);
      if (command.baseRevision !== 15) {
        return {
          deleted: false as const,
          reason: 'revision-conflict' as const,
          currentRevision: 15,
        };
      }
      return {
        deleted: true as const,
        tombstone: {
          cardId: command.cardId,
          opId: command.opId,
          libraryEpoch: command.libraryEpoch,
          revision: 16,
          deletedAt: '2026-07-26T10:00:00.000Z',
        },
      };
    };

    const result = await deleteCardWithConflictRecovery({
      cardId: 'word-quite',
      opId: 'delete-quite',
      baseRevision: 12,
      libraryEpoch: 3,
    }, applyDelete);

    expect(result).toMatchObject({
      deleted: true,
      tombstone: { revision: 16 },
    });
    expect(attemptedBaseRevisions).toEqual([12, 15]);
  });

  it('does not retry epoch failures as revision conflicts', async () => {
    const applyDelete = vi.fn(async () => ({
      deleted: false as const,
      reason: 'future-library-epoch' as const,
    }));

    await expect(deleteCardWithConflictRecovery({
      cardId: 'word-quite',
      opId: 'delete-quite',
      baseRevision: 12,
      libraryEpoch: 4,
    }, applyDelete)).resolves.toEqual({
      deleted: false,
      reason: 'future-library-epoch',
    });
    expect(applyDelete).toHaveBeenCalledTimes(1);
  });
});
