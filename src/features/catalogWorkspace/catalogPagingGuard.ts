export interface CatalogPagingToken {
  readonly generation: number;
}

export interface CatalogPagingGuard {
  capture(): CatalogPagingToken;
  invalidate(): void;
  isCurrent(token: CatalogPagingToken): boolean;
}

export function createCatalogPagingGuard(): CatalogPagingGuard {
  let generation = 0;
  return {
    capture: () => ({ generation }),
    invalidate: () => { generation += 1; },
    isCurrent: token => token.generation === generation,
  };
}
