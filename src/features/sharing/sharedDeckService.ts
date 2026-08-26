import type { FirebaseApp } from 'firebase/app';
import type { CardData } from '../../types/card';
import { protectedFunctionsCapability } from '../../lib/firebase';
import { runProtectedFunction } from '../../lib/protectedFunctionsCapability';

const REGION = 'asia-southeast1';

type SharedDeckResult = {
  shareId: string;
  expiresAt: string;
};

const unauthenticated = () => Object.assign(
  new Error('The active Firebase user does not match the sharing session.'),
  { code: 'functions/unauthenticated' },
);

const callAsCurrentOwner = async <T>(
  app: FirebaseApp,
  ownerId: string,
  invoke: () => Promise<T>,
): Promise<T> => {
  const { getAuth } = await import('firebase/auth');
  const auth = getAuth(app);
  if (auth.currentUser?.uid !== ownerId) throw unauthenticated();
  try {
    return await invoke();
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
        .replace(/^firebase\//, '')
        .replace(/^functions\//, '')
      : '';
    if (code !== 'unauthenticated' || auth.currentUser?.uid !== ownerId) throw error;
    try {
      await auth.currentUser.getIdToken(true);
    } catch {
      throw error;
    }
    if (auth.currentUser?.uid !== ownerId) throw unauthenticated();
    return invoke();
  }
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
  ...(card.mnemonic?.trim() ? { mnemonic: card.mnemonic.trim().slice(0, 2_048) } : {}),
  ...(card.wordFamily ? { wordFamily: card.wordFamily } : {}),
});

export async function createSharedDeckShare(
  app: FirebaseApp,
  category: string,
  cards: CardData[],
  ownerId: string,
): Promise<SharedDeckResult> {
  const response = await runProtectedFunction(protectedFunctionsCapability, 'Deck sharing', async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<
      {
        expectedOwnerId: string;
        category: string;
        cards: ReturnType<typeof publicCardProjection>[];
      },
      SharedDeckResult
    >(getFunctions(app, REGION), 'createSharedDeckV2');
    return callAsCurrentOwner(app, ownerId, () => callable({
      expectedOwnerId: ownerId,
      category,
      cards: cards.map(publicCardProjection),
    }));
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
  ownerId: string,
): Promise<void> {
  const response = await runProtectedFunction(protectedFunctionsCapability, 'Share revocation', async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const callable = httpsCallable<{ shareId: string }, { revoked: boolean }>(
      getFunctions(app, REGION),
      'revokeSharedDeck',
    );
    return callAsCurrentOwner(app, ownerId, () => callable({ shareId }));
  });
  if (response.data?.revoked !== true) {
    throw new Error('Shared-deck service did not confirm revocation.');
  }
}
