import { createWordCardId } from '../../lib/cardIdentity';

export interface LexemeIdentityInput {
  readonly language: string;
  readonly normalizedLemma: string;
  readonly partOfSpeech: string;
  readonly senseKey: string;
}

export interface TrackMembershipIdentityInput {
  readonly trackId: string;
  readonly lexemeId: string;
}

const normalizeIdentityComponent = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ');

const requireIdentityComponent = (
  name: string,
  value: string,
  options: { lowercase?: boolean } = {},
): string => {
  const normalized = normalizeIdentityComponent(value);
  if (!normalized) throw new TypeError(`${name} is required for identity.`);
  return options.lowercase ? normalized.toLowerCase() : normalized;
};

export function canonicalizeLexemeIdentity(input: LexemeIdentityInput): LexemeIdentityInput {
  return {
    language: requireIdentityComponent('language', input.language, { lowercase: true }),
    normalizedLemma: requireIdentityComponent('normalizedLemma', input.normalizedLemma),
    partOfSpeech: requireIdentityComponent('partOfSpeech', input.partOfSpeech, { lowercase: true }),
    senseKey: requireIdentityComponent('senseKey', input.senseKey, { lowercase: true }),
  };
}

export function canonicalizeTrackMembershipIdentity(
  input: TrackMembershipIdentityInput,
): TrackMembershipIdentityInput {
  return {
    trackId: requireIdentityComponent('trackId', input.trackId, { lowercase: true }),
    lexemeId: requireIdentityComponent('lexemeId', input.lexemeId),
  };
}

const createHashedId = (prefix: 'lexeme' | 'membership', components: readonly string[]): string => {
  const canonicalTuple = JSON.stringify(components);
  const casePreservingBytes = Array.from(new TextEncoder().encode(canonicalTuple))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  const hashBackedId = createWordCardId(`\u0000${casePreservingBytes}`).replace(/^word-/, '');
  return `${prefix}-${hashBackedId}`;
};

export function createLexemeId(input: LexemeIdentityInput): string {
  const canonical = canonicalizeLexemeIdentity(input);
  return createHashedId('lexeme', [
    canonical.language,
    canonical.normalizedLemma,
    canonical.partOfSpeech,
    canonical.senseKey,
  ]);
}

export function createTrackMembershipId(input: TrackMembershipIdentityInput): string {
  const canonical = canonicalizeTrackMembershipIdentity(input);
  return createHashedId('membership', [
    canonical.trackId,
    canonical.lexemeId,
  ]);
}
