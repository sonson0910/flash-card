import type { FirebaseApp } from 'firebase/app';
import type { CardData } from '../../types/card';
import { protectedFunctionsCapability } from '../../lib/firebase';
import { runProtectedFunction } from '../../lib/protectedFunctionsCapability';

const REGION = 'asia-southeast1';

type SharedDeckResult = {
  shareId: string;
  expiresAt: string;
};

const publicCardProjection = (card: CardData) => ({
  word: card.word,
  translation: card.translation,
  explanation: card.explanation || '',
  explanationTranslation: card.explanationTranslation || '',
  phonetic: card.phonetic || '',
  category: card.category || '',
  partOfSpeech: card.partOfSpeech || '',
  cefrLevel: card.cefrLevel || '',
  exampleSentence: card.exampleSentence || '',
  exampleTranslation: card.exampleTranslation || '',
  collocations: card.collocations || [],
  synonyms: card.synonyms || [],
  antonyms: card.antonyms || [],
  register: card.register || '',
  commonMistake: card.commonMistake || '',
  imageSearchQuery: card.imageSearchQuery || '',
  emoji: card.emoji || '',
  audioUrl: card.audioUrl || null,
  imageUrl: card.imageUrl || null,
});

export async function createSharedDeckShare(
  app: FirebaseApp,
  category: string,
  cards: CardData[],
): Promise<SharedDeckResult> {
  const response = await runProtectedFunction(protectedFunctionsCapability, 'Deck sharing', async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<
      { category: string; cards: ReturnType<typeof publicCardProjection>[] },
      SharedDeckResult
    >(getFunctions(app, REGION), 'createSharedDeck');
    return callable({
      category,
      cards: cards.map(publicCardProjection),
    });
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
  const response = await runProtectedFunction(protectedFunctionsCapability, 'Share revocation', async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<{ shareId: string }, { revoked: boolean }>(
      getFunctions(app, REGION),
      'revokeSharedDeck',
    );
    return callable({ shareId });
  });
  if (response.data?.revoked !== true) {
    throw new Error('Shared-deck service did not confirm revocation.');
  }
}
