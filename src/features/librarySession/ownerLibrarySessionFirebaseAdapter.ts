import type { FirebaseApp } from 'firebase/app';
import { FieldPath, arrayRemove, deleteField, doc, onSnapshot, runTransaction, updateDoc, type Firestore } from 'firebase/firestore';
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
      return getLegacyCardQueryMigrationProgress(database, ownerId);
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
