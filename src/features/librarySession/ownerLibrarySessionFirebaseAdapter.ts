import { arrayUnion, doc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { countPageableCards, migrateLegacyCardQueryFields } from '../../lib/cardRepository';
import { queueDeviceUpserts } from '../../lib/deviceSync';
import { normalizeCardForStorage } from '../library/libraryStorage';
import type { OwnerLibrarySessionAdapter } from './ownerLibrarySessionController';

export function createOwnerLibrarySessionFirebaseAdapter({
  database,
  configured,
}: {
  database: Firestore | null;
  configured: boolean;
}): OwnerLibrarySessionAdapter {
  const available = configured && database !== null;
  return {
    available,
    queueCardMigration: async (ownerId, cards, libraryEpoch) => {
      await queueDeviceUpserts(
        cards.map(card => normalizeCardForStorage({ ...card, libraryEpoch })),
        cards.length,
        ownerId,
      );
    },
    seedDeckProfile: async (ownerId, decks) => {
      if (!database || decks.length === 0) return;
      await setDoc(
        doc(database, 'users', ownerId, 'profile', 'custom_decks'),
        { decks: arrayUnion(...decks) },
        { merge: true },
      );
    },
    subscribeDeckProfile: (ownerId, onDecks, onError) => {
      if (!database) return () => undefined;
      return onSnapshot(
        doc(database, 'users', ownerId, 'profile', 'custom_decks'),
        snapshot => {
          if (!snapshot.exists()) {
            onDecks(null);
            return;
          }
          const decks = snapshot.data()?.decks;
          onDecks(Array.isArray(decks) ? decks : []);
        },
        onError,
      );
    },
    countPageableCards: async ownerId => {
      if (!database) return 0;
      return countPageableCards(database, ownerId);
    },
    migrateLegacyCards: async (ownerId, batchSize) => {
      if (!database) return { migrated: 0, complete: false };
      const result = await migrateLegacyCardQueryFields(database, ownerId, batchSize);
      return { migrated: result.migrated, complete: result.complete };
    },
  };
}
