import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const repository = vi.hoisted(() => ({
  applyCategoryDeltas: vi.fn(async () => ({ categories: {}, complete: true })),
}));

vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: { uid: 'owner-1' } },
  db: { kind: 'database' },
  isFirebaseConfigured: true,
}));
vi.mock('../../lib/cardRepository', () => ({
  applyCategoryDeltas: repository.applyCategoryDeltas,
  CardHeadwordRenameError: class extends Error {},
  deriveLibraryFacetOperationId: (operationId: string, suffix: string) => `facet:${operationId}:${suffix}`,
  renameCardHeadword: vi.fn(),
}));

import { mirrorCardCategoryEdit } from './cardEditService';

describe('card edit category mirror', () => {
  beforeEach(() => repository.applyCategoryDeltas.mockClear());

  it('tags the category change with the library generation of the edited card', () => {
    const card = { id: 'card-1', category: 'Travel', revision: 2, libraryEpoch: 5 } as CardData;

    mirrorCardCategoryEdit(card, 'Study', 'owner-1');

    expect(repository.applyCategoryDeltas).toHaveBeenCalledWith(
      { kind: 'database' },
      'owner-1',
      { Travel: -1, Study: 1 },
      'facet:card-edit:card-1:2:category-edit',
      undefined,
      5,
    );
  });
});
