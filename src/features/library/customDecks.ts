export const MAX_CUSTOM_DECK_NAME_LENGTH = 128;
export const MAX_CUSTOM_DECKS = 100;
export const coverPresets = ['aurora', 'violet', 'amber', 'slate', 'moss'] as const;
export type CoverPreset = typeof coverPresets[number];
export const defaultCoverPreset: CoverPreset = 'aurora';

export type CustomDeckProfile = {
  decks: string[];
  coverPresets: Record<string, CoverPreset>;
};

const toWellFormed = (value: string) => {
  const native = (String.prototype as unknown as StringConstructor & {
    toWellFormed?: (this: string) => string;
  }).toWellFormed;
  if (native) return native.call(value);
  return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
};

export const normalizeCustomDeckName = (value: unknown) => (
  typeof value === 'string'
    ? toWellFormed(value.replace(/\u001f/g, ' ').trim().slice(0, MAX_CUSTOM_DECK_NAME_LENGTH))
    : ''
);

export const customDeckCoverKey = (name: string): string => {
  const normalized = normalizeCustomDeckName(name);
  const bytes = new TextEncoder().encode(normalized);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `d_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
};

export const normalizeCoverPreset = (value: unknown): CoverPreset =>
  coverPresets.includes(value as CoverPreset) ? value as CoverPreset : defaultCoverPreset;

export const deckMonogram = (name: string): string => Array.from(normalizeCustomDeckName(name))[0] ?? '';

export const normalizeCustomDeckProfile = (value: unknown): CustomDeckProfile => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const decks = normalizeCustomDeckCollection(record.decks);
  const presets = record.coverPresets && typeof record.coverPresets === 'object' && !Array.isArray(record.coverPresets)
    ? record.coverPresets as Record<string, unknown>
    : {};
  const normalizedCoverPresets: Record<string, CoverPreset> = {};
  decks.forEach(deck => {
    const key = customDeckCoverKey(deck);
    if (key in presets && coverPresets.includes(presets[key] as CoverPreset)) {
      normalizedCoverPresets[key] = presets[key] as CoverPreset;
    }
  });
  return { decks, coverPresets: normalizedCoverPresets };
};

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
