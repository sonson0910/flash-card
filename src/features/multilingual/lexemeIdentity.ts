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
  .toLowerCase()
  .replace(/\s+/g, ' ');

const requireIdentityComponent = (name: string, value: string): string => {
  const normalized = normalizeIdentityComponent(value);
  if (!normalized) throw new TypeError(`${name} is required for identity.`);
  return normalized;
};

const createHashedId = (prefix: 'lexeme' | 'membership', components: readonly string[]): string => {
  const canonicalTuple = JSON.stringify(components);
  const hashBackedId = createWordCardId(canonicalTuple).replace(/^word-/, '');
  return `${prefix}-${hashBackedId}`;
};

export function createLexemeId(input: LexemeIdentityInput): string {
  return createHashedId('lexeme', [
    requireIdentityComponent('language', input.language),
    requireIdentityComponent('normalizedLemma', input.normalizedLemma),
    requireIdentityComponent('partOfSpeech', input.partOfSpeech),
    requireIdentityComponent('senseKey', input.senseKey),
  ]);
}

export function createTrackMembershipId(input: TrackMembershipIdentityInput): string {
  return createHashedId('membership', [
    requireIdentityComponent('trackId', input.trackId),
    requireIdentityComponent('lexemeId', input.lexemeId),
  ]);
}
