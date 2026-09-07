export type PracticeDeckScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'unassigned' }
  | { readonly kind: 'deck'; readonly name: string };

export const ALL_PRACTICE_DECK_SCOPE: PracticeDeckScope = { kind: 'all' };

export function practiceDeckScopeForLibraryDeck(deck: string): PracticeDeckScope {
  if (deck === 'All') return ALL_PRACTICE_DECK_SCOPE;
  if (deck === 'Unassigned') return { kind: 'unassigned' };
  return { kind: 'deck', name: deck };
}

export function libraryDeckForPracticeScope(scope: PracticeDeckScope): string {
  if (scope.kind === 'all') return 'All';
  if (scope.kind === 'unassigned') return 'Unassigned';
  return scope.name;
}

export function samePracticeDeckScope(left: PracticeDeckScope, right: PracticeDeckScope): boolean {
  return left.kind === right.kind && (left.kind !== 'deck' || right.kind === 'deck' && left.name === right.name);
}

export function practiceDeckScopeMatchesCard(
  scope: PracticeDeckScope,
  customDeck: string | null | undefined,
): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'unassigned') return customDeck === null || customDeck === undefined;
  return customDeck === scope.name;
}
