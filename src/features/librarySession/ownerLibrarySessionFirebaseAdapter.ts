import type { FirebaseApp } from 'firebase/app';
import {
  FieldPath,
  arrayRemove,
  collection,
  deleteField,
  doc,
  getCountFromServer,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import {
  clearCustomDeckAssignments,
  getLegacyCardQueryMigrationProgress,
} from '../../lib/cardRepository';
import { migrateLegacyLibraryWithAdmin } from './legacyLibraryMigrationService';
import type { OwnerLibrarySessionAdapter } from './ownerLibrarySessionController';
import {
  customDeckCoverKey,
  defaultCoverPreset,
  normalizeCoverPreset,
  normalizeCustomDeckProfile,
  type CoverPreset,
} from '../library/customDecks';

const CURRENT_CARD_SCHEMA_VERSION = 2;
const QUERY_MIGRATION_VERSION = 2;

/**
 * Counts the cards that are not in the current stored shape. A library with no
 * such card needs no upgrade, however its advisory progress document looks.
 */
async function countOlderCards(database: Firestore, ownerId: string): Promise<number> {
  const cards = collection(database, 'users', ownerId, 'cards');
  const [all, current] = await Promise.all([
    getCountFromServer(cards),
    getCountFromServer(query(cards, where('schemaVersion', '==', CURRENT_CARD_SCHEMA_VERSION))),
  ]);
  return Math.max(0, all.data().count - current.data().count);
}

/** Records the finished state once so later opens skip the count. Advisory: a refused write is harmless. */
async function markLibraryUpgradeComplete(database: Firestore, ownerId: string, scanned: number): Promise<void> {
  try {
    await setDoc(doc(database, 'users', ownerId, 'profile', 'query_migration'), {
      migrationVersion: QUERY_MIGRATION_VERSION,
      lastDocumentId: null,
      complete: true,
      scanned,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('The library upgrade status could not be recorded.', error);
  }
}

export function createOwnerLibrarySessionFirebaseAdapter({
  app,
  database,
  configured,
}: {
  app: FirebaseApp | null;
  database: Firestore | null;
  configured: boolean;
}): OwnerLibrarySessionAdapter {
  const available = configured && database !== null;
  return {
    available,
    subscribeDeckProfile: (ownerId, onDecks, onError) => {
      if (!database) return () => undefined;
      return onSnapshot(
        doc(database, 'users', ownerId, 'profile', 'custom_decks'),
        // Metadata changes matter for a missing document: the device cache
        // reports it as absent until the server confirms that it is.
        { includeMetadataChanges: true },
        snapshot => {
          if (!snapshot.exists()) {
            // Only the server can say the learner has no decks; a cache miss is no answer.
            onDecks(snapshot.metadata.fromCache ? null : { decks: [], coverPresets: {} });
            return;
          }
          onDecks(snapshot.data());
        },
        onError,
      );
    },
    getLegacyMigrationProgress: async ownerId => {
      if (!database) return { scanned: 0, complete: false };
      const progress = await getLegacyCardQueryMigrationProgress(database, ownerId);
      if (progress.complete) return progress;
      // A missing or unfinished progress document says nothing about the cards:
      // libraries created after the browser upgrade was removed never get one.
      let older: number;
      try {
        older = await countOlderCards(database, ownerId);
      } catch (error) {
        console.warn('Older library cards could not be counted.', error);
        return progress;
      }
      if (older > 0) return { scanned: progress.scanned, complete: false, pending: older };
      await markLibraryUpgradeComplete(database, ownerId, progress.scanned);
      return { scanned: progress.scanned, complete: true };
    },
    migrateLegacyCards: async () => {
      if (!app || !database) return { migrated: 0, scanned: 0, complete: false };
      return migrateLegacyLibraryWithAdmin(app);
    },
  };
}

export function createOwnerDeckMutationFirebaseAdapter(database: Firestore | null) {
  return {
    add: async (ownerId: string, deckName: string, preset: CoverPreset = defaultCoverPreset) => {
      if (!database) return;
      const profileRef = doc(database, 'users', ownerId, 'profile', 'custom_decks');
      await runTransaction(database, async transaction => {
        const profile = normalizeCustomDeckProfile((await transaction.get(profileRef)).data());
        if (profile.decks.includes(deckName)) throw new Error('custom-deck-duplicate');
        if (profile.decks.length >= 100) throw new Error('custom-deck-limit');
        const decks = [...profile.decks, deckName];
        transaction.set(profileRef, {
          decks,
          coverPresets: {
            ...profile.coverPresets,
            [customDeckCoverKey(deckName)]: normalizeCoverPreset(preset),
          },
        });
      });
    },
    clearAssignments: async (ownerId: string, deckName: string) => {
      if (!database) return;
      await clearCustomDeckAssignments(database, ownerId, deckName);
    },
    removeProfile: async (ownerId: string, deckName: string) => {
      if (!database) return;
      const profileRef = doc(database, 'users', ownerId, 'profile', 'custom_decks');
      await updateDoc(
        profileRef,
        'decks', arrayRemove(deckName),
        new FieldPath('coverPresets', customDeckCoverKey(deckName)), deleteField(),
      );
    },
  };
}
