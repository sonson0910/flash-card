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
