import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { ReviewApplyResult, ReviewCommand } from '../../lib/cardReviewRepository';

const mocks = vi.hoisted(() => ({ applyReviewViaCallable: vi.fn() }));

vi.mock('../../lib/cardReviewRepository', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardReviewRepository')>('../../lib/cardReviewRepository');
  return { ...actual, applyReviewViaCallable: mocks.applyReviewViaCallable };
});

vi.mock('../../lib/firebase', () => ({
  db: { kind: 'database' },
  handleFirestoreError: vi.fn(),
  isFirebaseConfigured: true,
  OperationType: { DELETE: 'delete' },
}));

import { useLearningStatePersistence } from '../learning/useLearningStatePersistence';
import { createLearningStateController } from '../learning/learningStateController';
import type { LearningPersistenceOptions } from '../learning/learningPersistencePort';
import type { LearningStatePersistencePort } from '../learning/useLearningState';
import { createDailySessionController } from './dailySessionController';

const localCard: CardData = {
  id: 'word-focus', word: 'focus', normalizedWord: 'focus', translation: 'tap trung', explanation: '',
  phonetic: '', emoji: '', category: 'Study', audioUrl: null, imageUrl: null, bookmarked: false,
  difficulty: 'unrated', reviews: 0, revision: 3, libraryEpoch: 2,
};

const T_B = '2026-08-03T10:00:00.000Z'; // device B rates while offline
const T_A = '2026-08-03T10:05:00.000Z'; // device A reviews online later

describe('daily lesson retry after another device reviewed the same card', () => {
  it('reschedules the retried question from the clock after another device reviewed the card later', async () => {
    const sent: ReviewCommand[] = [];
    let online = false;
    // Server state after device A: revision 4, lastReview T_A.
    const serverCard: CardData = {
      ...localCard, revision: 4, reviews: 1,
      reviewHistory: [{ rating: 'good', reviewedAt: T_A }] as never,
      fsrs: { lastReview: T_A } as never,
    };
    mocks.applyReviewViaCallable.mockImplementation(async (_db: unknown, _owner: string, command: ReviewCommand): Promise<ReviewApplyResult> => {
      sent.push(command);
      if (!online) throw new Error('network offline');
      if (command.baseRevision !== 4) {
        return { applied: false, reason: 'revision-conflict', currentRevision: 4, card: serverCard } as ReviewApplyResult;
      }
      return { applied: true, duplicate: false, xpAwarded: 2, card: { ...serverCard, revision: 5 } } as ReviewApplyResult;
    });

    const options = {
      ownerId: 'user-a', verifiedEpoch: 2, knownLibraryTotal: 1, validateRestore: () => null,
      findCard: (id: string) => id === localCard.id ? localCard : undefined,
      canPublishPatch: () => true, acceptVerifiedEpoch: vi.fn(), updateCloudStats: vi.fn(),
      updateCategoryFacets: vi.fn(async () => undefined), resetCloudState: vi.fn(), resetCloudPage: vi.fn(),
      refreshCloud: vi.fn(), setCloudUnavailable: vi.fn(), setMutationPending: vi.fn(), reportError: vi.fn(),
      onReviewOutcome: vi.fn(),
    } as unknown as LearningPersistenceOptions;
    const captured: { persistence?: LearningStatePersistencePort } = {};
    function Harness() { captured.persistence = useLearningStatePersistence(options); return null; }
    renderToStaticMarkup(<Harness />);
    const persistence = captured.persistence!;

    let now = new Date(T_B);
    const learning = createLearningStateController({
      port: { activeOwner: () => 'user-a', findCard: id => persistence.findCard(id), persist: m => persistence.persist(m) },
      snapshots: { library: { apply: () => undefined }, practice: { apply: () => undefined } },
      now: () => now,
    });
    const lesson = createDailySessionController({
      reviewCard: (cardId, rating, operationId) => learning.review(cardId, rating, operationId),
      createOperationId: () => 'daily-op-1',
    });
    lesson.start([{ cardId: localCard.id, mode: 'active-recall', prompt: 'p', promptLanguage: 'en',
      instruction: 'Type the word', answer: 'focus', scoringPolicy: 'latin' } as never]);
    lesson.submit('focus' as never);

    // The rating fails offline with a retryable error and the lesson waits for a retry.
    expect((await lesson.rate('good')).status).toBe('failed');
    expect(lesson.getSnapshot()?.phase).toBe('save-error');

    // Another device reviewed the card later than the remembered review. Retry is refused as stale once,
    // and the next retry reschedules from the clock instead of resending the remembered review.
    online = true;
    now = new Date('2026-08-03T10:10:00.000Z');
    await lesson.retry();
    expect(sent.at(-1)?.reviewedAt).toBe(T_B);

    now = new Date('2026-08-03T10:15:00.000Z');
    const second = await lesson.retry();

    expect(sent.at(-1)?.reviewedAt).toBe('2026-08-03T10:15:00.000Z');
    expect(second.status).not.toBe('failed');
    expect(lesson.getSnapshot()?.phase).not.toBe('save-error');
  });
});
