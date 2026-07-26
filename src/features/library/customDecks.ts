export const MAX_CUSTOM_DECK_NAME_LENGTH = 128;
export const MAX_CUSTOM_DECKS = 100;

export const normalizeCustomDeckName = (value: unknown) => (
  typeof value === 'string' ? value.trim().slice(0, MAX_CUSTOM_DECK_NAME_LENGTH) : ''
);

export const normalizeAssignedDeckName = (value: string | null) => {
  if (value === null) return null;
  return normalizeCustomDeckName(value) || null;
};

export const normalizeCustomDeckCollection = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const entry of value) {
    const name = normalizeCustomDeckName(entry);
    if (name) unique.add(name);
    if (unique.size === MAX_CUSTOM_DECKS) break;
  }
  return [...unique];
};

export type CustomDeckCreationPlan = {
  status: 'created' | 'empty' | 'duplicate' | 'limit';
  name: string;
  decks: string[];
};

export const planCustomDeckCreation = (decks: string[], input: string): CustomDeckCreationPlan => {
  const normalizedDecks = normalizeCustomDeckCollection(decks);
  const name = normalizeCustomDeckName(input);
  if (!name) return { status: 'empty', name, decks: normalizedDecks };
  if (normalizedDecks.includes(name)) return { status: 'duplicate', name, decks: normalizedDecks };
  if (normalizedDecks.length >= MAX_CUSTOM_DECKS) return { status: 'limit', name, decks: normalizedDecks };
  return { status: 'created', name, decks: [...normalizedDecks, name] };
};
