import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CardQueryState } from './cardQuery';
import { ALL_PRACTICE_DECK_SCOPE, practiceDeckScopeForLibraryDeck } from './practiceScope';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), documentId: vi.fn(), endAt: vi.fn(), getCountFromServer: vi.fn(),
  getDocs: vi.fn(), getDocsFromServer: vi.fn(), getDoc: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn(),
  orderBy: vi.fn(), query: vi.fn(), runTransaction: vi.fn(), serverTimestamp: vi.fn(), setDoc: vi.fn(),
  startAfter: vi.fn(), startAt: vi.fn(), where: vi.fn(), writeBatch: vi.fn(),
}));

vi.mock('./firebase', () => ({
  app: null,
  auth: null,
  isFirebaseConfigured: false,
  protectedFunctionsCapability: { available: false, reason: 'app-check-unconfigured' },
}));

import { cardQueryIndexFields, UnsupportedCardQueryError } from './cardRepository';

type Index = { collectionGroup: string; queryScope: string; fields: unknown[] };

const manifest = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as {
  indexes: Index[];
};

const values = <T>(items: readonly T[]): T[] => [...items];

const queryStates = function* (): Generator<CardQueryState> {
  for (const category of values([null, 'IELTS'])) {
    for (const customDeck of values<CardQueryState['customDeck']>([
      ALL_PRACTICE_DECK_SCOPE,
      practiceDeckScopeForLibraryDeck('Deck'),
      practiceDeckScopeForLibraryDeck('Unassigned'),
    ])) {
      for (const difficulty of values<CardQueryState['difficulty']>([null, 'easy', 'good', 'hard', 'unrated', 'due'])) {
        for (const partOfSpeech of values([null, 'noun'])) {
          for (const bookmarkedOnly of [false, true]) {
            for (const createdDate of values([null, '2026-09-21'])) {
              for (const wordPrefix of values(['', 'ap'])) {
                yield { category, customDeck, difficulty, partOfSpeech, bookmarkedOnly, createdDate, wordPrefix };
              }
            }
          }
        }
      }
    }
  }
};

const isMixedRangeFamily = (state: CardQueryState) => {
  const families = [Boolean(state.createdDate), Boolean(state.wordPrefix), state.difficulty === 'due'];
  return families.filter(Boolean).length > 1;
};

const isManifestCovered = (fields: unknown[]) => fields.length === 2 || manifest.indexes.some(index => (
  index.collectionGroup === 'cards'
    && index.queryScope === 'COLLECTION'
    && JSON.stringify(index.fields) === JSON.stringify(fields)
));

describe('library Firestore query index contract', () => {
  it('derives every reachable filter state and rejects only mixed range families before query creation', () => {
    let accepted = 0;
    let rejected = 0;
    for (const state of queryStates()) {
      if (isMixedRangeFamily(state)) {
        expect(() => cardQueryIndexFields(state)).toThrow(UnsupportedCardQueryError);
        rejected += 1;
      } else {
        expect(isManifestCovered(cardQueryIndexFields(state))).toBe(true);
        accepted += 1;
      }
    }
    expect({ accepted, rejected }).toEqual({ accepted: 384, rejected: 192 });
  });

  it('keeps deterministic document-id tie breakers in every accepted signature', () => {
    for (const state of queryStates()) {
      if (isMixedRangeFamily(state)) continue;
      const fields = cardQueryIndexFields(state);
      expect(fields.at(-1)).toEqual({
        fieldPath: '__name__',
        order: state.wordPrefix || state.difficulty === 'due' ? 'ASCENDING' : 'DESCENDING',
      });
    }
  });

  it('retains the multilingual membership composite', () => {
    expect(manifest.indexes).toContainEqual({
      collectionGroup: 'track_memberships',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'lexemeId', order: 'ASCENDING' },
        { fieldPath: 'editorialStatus', order: 'ASCENDING' },
        { fieldPath: 'schemaVersion', order: 'ASCENDING' },
      ],
    });
  });
});
