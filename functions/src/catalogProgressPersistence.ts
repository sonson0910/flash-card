import { FieldValue, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { CardRecord } from './cardPersistence.js';

export type CatalogProgressStatus = 'active' | 'mastered';

const isCounter = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const projectionSource = (card: DocumentData | CardRecord): {
  lexemeId: string;
  targetLanguage: string;
  status: CatalogProgressStatus;
  cardRevision: number;
  libraryEpoch: number;
} | null => {
  if (
    card.schemaVersion !== 2
    || typeof card.lexemeId !== 'string'
    || card.lexemeId.length === 0
    || card.lexemeId.includes('/')
    || typeof card.language !== 'string'
    || card.language.length === 0
    || !isCounter(card.revision)
    || !isCounter(card.libraryEpoch)
  ) return null;
  const interval = card.interval ?? (card.fsrs as Record<string, unknown> | undefined)?.scheduledDays;
  return {
    lexemeId: card.lexemeId,
    targetLanguage: card.language,
    status: card.difficulty === 'easy' || (typeof interval === 'number' && interval >= 21)
      ? 'mastered'
      : 'active',
    cardRevision: card.revision,
    libraryEpoch: card.libraryEpoch,
  };
};

const projectionRef = (database: Firestore, ownerId: string, lexemeId: string) =>
  database.collection('users').doc(ownerId).collection('catalog_progress').doc(lexemeId);

export const upsertCatalogProgressForCard = (
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  card: DocumentData | CardRecord,
): void => {
  const source = projectionSource(card);
  if (!source) return;
  transaction.set(projectionRef(database, ownerId, source.lexemeId), {
    schemaVersion: 1,
    ownerId,
    ...source,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: false });
};

export const deleteCatalogProgressForCard = (
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  card: DocumentData | CardRecord,
): void => {
  const source = projectionSource(card);
  if (source) transaction.delete(projectionRef(database, ownerId, source.lexemeId));
};
