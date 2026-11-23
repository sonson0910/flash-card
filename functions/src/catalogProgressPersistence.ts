import { FieldPath, FieldValue, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { CardRecord } from './cardPersistence.js';
import { assertOwnerLibraryWriteAllowed } from './legacyLibraryMigrationOwnerScope.js';

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

export const catalogProgressReferenceForCard = (
  database: Firestore,
  ownerId: string,
  card: DocumentData | CardRecord,
) => {
  const source = projectionSource(card);
  return source ? projectionRef(database, ownerId, source.lexemeId) : null;
};

/**
 * Whether the stored projection already says what readers take from the card.
 * Edits that are not reviews raise the card revision without touching the
 * projection, so the revision alone is no reason to write it again.
 */
const catalogProgressMatchesCard = (
  stored: DocumentData | undefined,
  card: DocumentData | CardRecord,
): boolean => {
  const source = projectionSource(card);
  if (!source) return true;
  return stored?.schemaVersion === 1
    && isCounter(stored.cardRevision)
    && stored.lexemeId === source.lexemeId
    && stored.targetLanguage === source.targetLanguage
    && stored.status === source.status
    && stored.libraryEpoch === source.libraryEpoch;
};

const REPAIR_PAGE_SIZE = 200;

/**
 * Writes the catalog progress of each lexeme card in the owner's current
 * library where it is missing or says something else. Lexeme cards written
 * before the projection existed have none, and no learner action writes it
 * until the card's next review. A second run writes nothing. An owner whose
 * library is fenced by a migration is refused with the fence error.
 */
export async function repairCatalogProgressForOwner(
  database: Firestore,
  ownerId: string,
): Promise<{ scanned: number; repaired: number }> {
  const owner = database.collection('users').doc(ownerId);
  let scanned = 0;
  let repaired = 0;
  let cursor: string | undefined;
  for (;;) {
    let query = owner.collection('cards').orderBy(FieldPath.documentId()).limit(REPAIR_PAGE_SIZE);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const page = await query.get();
    scanned += page.size;
    // A lexeme card is stored under its lexeme id; one per projection.
    const candidates = page.docs
      .filter(document => projectionSource(document.data())?.lexemeId === document.id)
      .map(document => document.ref);
    if (candidates.length > 0) {
      repaired += await database.runTransaction(async transaction => {
        await assertOwnerLibraryWriteAllowed(transaction, database, ownerId);
        const state = await transaction.get(owner.collection('profile').doc('library_state'));
        const libraryEpoch = state.exists ? state.data()?.libraryEpoch ?? 0 : 0;
        const cards = (await transaction.getAll(...candidates)).flatMap(snapshot => {
          const data = snapshot.data();
          const source = data ? projectionSource(data) : null;
          return data && source?.lexemeId === snapshot.id && source.libraryEpoch === libraryEpoch ? [data] : [];
        });
        if (cards.length === 0) return 0;
        const stored = await transaction.getAll(...cards.map(card => projectionRef(database, ownerId, String(card.lexemeId))));
        let written = 0;
        cards.forEach((card, index) => {
          if (catalogProgressMatchesCard(stored[index]?.data(), card)) return;
          upsertCatalogProgressForCard(database, transaction, ownerId, card);
          written += 1;
        });
        return written;
      });
    }
    if (page.size < REPAIR_PAGE_SIZE) break;
    cursor = page.docs[page.docs.length - 1]!.id;
  }
  return { scanned, repaired };
}

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
  const reference = catalogProgressReferenceForCard(database, ownerId, card);
  if (reference) transaction.delete(reference);
};
