import type { FirebaseApp } from 'firebase/app';
import type { CardData } from '../../types/card';

const REGION = 'asia-southeast1';

type SharedDeckResult = {
  shareId: string;
  expiresAt: string;
};

const publicCardProjection = (card: CardData) => ({
  word: card.word,
  translation: card.translation,
  explanation: card.explanation || '',
  phonetic: card.phonetic || '',
  category: card.category || '',
  partOfSpeech: card.partOfSpeech || '',
  emoji: card.emoji || '',
  audioUrl: card.audioUrl || null,
  imageUrl: card.imageUrl || null,
});

export async function createSharedDeckShare(
  app: FirebaseApp,
  category: string,
  cards: CardData[],
): Promise<SharedDeckResult> {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const callable = httpsCallable<
    { category: string; cards: ReturnType<typeof publicCardProjection>[] },
    SharedDeckResult
  >(getFunctions(app, REGION), 'createSharedDeck');
  const response = await callable({
    category,
    cards: cards.map(publicCardProjection),
  });
  if (
    typeof response.data?.shareId !== 'string'
    || response.data.shareId.trim().length === 0
    || typeof response.data.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(response.data.expiresAt))
  ) {
    throw new Error('Shared-deck service returned an invalid response.');
  }
  return response.data;
}

export async function revokeSharedDeckShare(
  app: FirebaseApp,
  shareId: string,
): Promise<void> {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const callable = httpsCallable<{ shareId: string }, { revoked: boolean }>(
    getFunctions(app, REGION),
    'revokeSharedDeck',
  );
  const response = await callable({ shareId });
  if (response.data?.revoked !== true) {
    throw new Error('Shared-deck service did not confirm revocation.');
  }
}
