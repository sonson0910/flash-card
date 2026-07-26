import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import {
  isActiveUserSession,
  isCardUpdateLifecycleCurrent,
  isMissingFirestoreDocumentError,
  resolveCardUpdateSource,
} from './cardUpdates';

const newCard: CardData = {
  id: 'word-delayed',
  word: 'delayed',
  normalizedWord: 'delayed',
  translation: 'bị trì hoãn',
  explanation: '',
  phonetic: '',
  emoji: '⏳',
  category: 'Time',
  audioUrl: null,
  imageUrl: null,
};

describe('card field update source', () => {
  it('allows pending-sync UI updates only for the account that started the flush', () => {
    expect(isActiveUserSession('user-a', 'user-a')).toBe(true);
    expect(isActiveUserSession('user-a', 'user-b')).toBe(false);
    expect(isActiveUserSession('user-a', null)).toBe(false);
  });

  it('uses the explicit source card when a late media callback precedes the React state refresh', () => {
    expect(resolveCardUpdateSource(newCard.id, newCard, [], [])).toBe(newCard);
  });

  it('falls back to the latest visible or study card for ordinary edits', () => {
    const visible = { ...newCard, bookmarked: true };
    expect(resolveCardUpdateSource(newCard.id, undefined, [visible], [])).toBe(visible);
  });

  it('rejects late media after the card lifecycle advances', () => {
    expect(isCardUpdateLifecycleCurrent(2, 2)).toBe(true);
    expect(isCardUpdateLifecycleCurrent(2, 3)).toBe(false);
    expect(isCardUpdateLifecycleCurrent(undefined, 3)).toBe(true);
  });

  it('recognizes only Firestore missing-document errors for patch reconciliation', () => {
    expect(isMissingFirestoreDocumentError({ code: 'not-found' })).toBe(true);
    expect(isMissingFirestoreDocumentError({ code: 'firestore/not-found' })).toBe(true);
    expect(isMissingFirestoreDocumentError({ code: 'unavailable' })).toBe(false);
    expect(isMissingFirestoreDocumentError(new Error('not-found'))).toBe(false);
  });
});
