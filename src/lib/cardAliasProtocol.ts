export interface PendingCardAlias {
  fromCardId: string;
  toCardId: string;
  sourceBaseRevision: number;
  sourceLibraryEpoch: number;
  targetRevision: number;
  targetLibraryEpoch: number;
  createdAt: string;
}

interface AliasableCardOperation {
  type?: unknown;
  cardId?: unknown;
  baseRevision?: unknown;
  libraryEpoch?: unknown;
}

const isBoundary = (value: unknown, minimum: number): value is number => (
  Number.isSafeInteger(value) && Number(value) >= minimum
);

export function normalizePendingCardAlias(value: unknown): PendingCardAlias | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.fromCardId !== 'string'
    || source.fromCardId.length === 0
    || typeof source.toCardId !== 'string'
    || source.toCardId.length === 0
    || source.fromCardId === source.toCardId
    || !isBoundary(source.sourceBaseRevision, 0)
    || !isBoundary(source.sourceLibraryEpoch, -1)
    || !isBoundary(source.targetRevision, 0)
    || !isBoundary(source.targetLibraryEpoch, 0)
    || typeof source.createdAt !== 'string'
    || !Number.isFinite(new Date(source.createdAt).getTime())
  ) return null;
  return {
    fromCardId: source.fromCardId,
    toCardId: source.toCardId,
    sourceBaseRevision: source.sourceBaseRevision,
    sourceLibraryEpoch: source.sourceLibraryEpoch,
    targetRevision: source.targetRevision,
    targetLibraryEpoch: source.targetLibraryEpoch,
    createdAt: new Date(source.createdAt).toISOString(),
  };
}

function preferredAlias(
  existing: PendingCardAlias | undefined,
  incoming: PendingCardAlias,
): PendingCardAlias {
  if (!existing) return incoming;
  if (existing.sourceLibraryEpoch !== incoming.sourceLibraryEpoch) {
    return existing.sourceLibraryEpoch > incoming.sourceLibraryEpoch ? existing : incoming;
  }
  if (existing.sourceBaseRevision !== incoming.sourceBaseRevision) {
    return existing.sourceBaseRevision > incoming.sourceBaseRevision ? existing : incoming;
  }
  if (existing.targetLibraryEpoch !== incoming.targetLibraryEpoch) {
    return existing.targetLibraryEpoch > incoming.targetLibraryEpoch ? existing : incoming;
  }
  if (existing.targetRevision !== incoming.targetRevision) {
    return existing.targetRevision > incoming.targetRevision ? existing : incoming;
  }
  return existing;
}

export function mergePendingCardAliases(
  aliases: readonly PendingCardAlias[],
): PendingCardAlias[] {
  const bySource = new Map<string, PendingCardAlias>();
  aliases.forEach(alias => {
    bySource.set(alias.fromCardId, preferredAlias(bySource.get(alias.fromCardId), alias));
  });
  return [...bySource.values()];
}

function aliasApplies(
  alias: PendingCardAlias,
  operation: AliasableCardOperation,
): boolean {
  if (
    (operation.type !== 'patch' && operation.type !== 'delete')
    || operation.cardId !== alias.fromCardId
    || (operation.baseRevision ?? 0) !== alias.sourceBaseRevision
  ) return false;
  const operationEpoch = operation.libraryEpoch ?? 0;
  return operationEpoch === alias.sourceLibraryEpoch
    || operationEpoch === -1
    || alias.sourceLibraryEpoch === -1;
}

export function retargetCardOperationWithAliases<T extends AliasableCardOperation>(
  operation: T,
  aliases: readonly PendingCardAlias[],
): T {
  let current = operation;
  const visited = new Set<string>();
  while (
    (current.type === 'patch' || current.type === 'delete')
    && typeof current.cardId === 'string'
    && !visited.has(current.cardId)
  ) {
    visited.add(current.cardId);
    const alias = aliases.find(candidate => aliasApplies(candidate, current));
    if (!alias) break;
    current = {
      ...current,
      cardId: alias.toCardId,
      baseRevision: alias.targetRevision,
      libraryEpoch: alias.targetLibraryEpoch,
    };
  }
  return current;
}
