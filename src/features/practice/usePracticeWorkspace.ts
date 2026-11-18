import { useCallback, useRef } from 'react';
import type { LanguageProfile } from '../language/languageProfile';
import { useVerifiedGamificationState } from '../gamification/verifiedGamificationClient';
import { isCardReadyForPractice } from '../../lib/srs';
import { withTimeout } from '../../lib/async';
import { normalizeCardLanguage } from '../../lib/cardIdentity';
import {
  ALL_PRACTICE_DECK_SCOPE,
  type PracticeDeckScope,
} from '../../lib/practiceScope';
import type { CardData } from '../../types/card';
import { cardsForLanguagePair } from './practiceModel';
import {
  usePracticeSession,
  type PracticeLearningActions,
  type PracticeSessionController,
  type PracticeSnapshotPort,
  type PracticeViewMode,
} from './usePracticeSession';

const DEFAULT_PRACTICE_POOL_SIZE = 50;
export const MAXIMUM_PRACTICE_POOL_SIZE = 50;
const CLOUD_PRACTICE_POOL_TIMEOUT_MS = 10_000;

export type PracticePoolFailure = 'quota' | 'unavailable';

export interface PracticePoolSource {
  load: (
    ownerId: string,
    maximum: number,
    options: { includeFuture: boolean; targetLanguage?: string; customDeck: PracticeDeckScope },
  ) => Promise<CardData[]>;
  classifyFailure?: (error: unknown) => PracticePoolFailure;
}

export interface PracticePoolLoaderOptions {
  ownerId: string | null;
  cloudBackoffActive: boolean;
  cards: readonly CardData[];
  source: PracticePoolSource | null;
  /** Active course's target language; scopes the practice pool so cards from another course never leak in. */
  targetLanguage: string;
  reportError: (message: string) => void;
}

const boundedPoolSize = (maximum: number | undefined) => {
  if (maximum === undefined || !Number.isFinite(maximum)) return DEFAULT_PRACTICE_POOL_SIZE;
  return Math.min(MAXIMUM_PRACTICE_POOL_SIZE, Math.max(1, Math.floor(maximum)));
};

const matchesDeckScope = (card: CardData, scope: PracticeDeckScope): boolean => {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'unassigned') return card.customDeck === null || card.customDeck === undefined;
  return card.customDeck === scope.name;
};

export function createPracticePoolLoader({
  ownerId,
  cloudBackoffActive,
  cards,
  source,
  targetLanguage,
  reportError,
}: PracticePoolLoaderOptions) {
  return async (
    maximum?: number,
    includeFuture = true,
    customDeck: PracticeDeckScope = ALL_PRACTICE_DECK_SCOPE,
  ): Promise<CardData[]> => {
    const limit = boundedPoolSize(maximum);
    if (ownerId && source && !cloudBackoffActive) {
      try {
        const loaded = await withTimeout(
          source.load(ownerId, limit, { includeFuture, targetLanguage, customDeck }),
          CLOUD_PRACTICE_POOL_TIMEOUT_MS,
        );
        return loaded.slice(0, limit);
      } catch (error) {
        const failure = source.classifyFailure?.(error) ?? 'unavailable';
        reportError(failure === 'quota'
          ? 'The cloud read quota has been reached. Practice is using cards cached on this device.'
          : 'Could not load the cloud queue. Practice is using cards cached on this device.');
      }
    }

    const normalizedTargetLanguage = normalizeCardLanguage(targetLanguage);
    const languageCards = cards.filter(card => (normalizeCardLanguage(card.language) || 'en') === normalizedTargetLanguage);
    const scopedCards = languageCards.filter(card => matchesDeckScope(card, customDeck));
    const candidates = includeFuture ? scopedCards : scopedCards.filter(isCardReadyForPractice);
    return candidates.slice(0, limit);
  };
}

export interface PracticeWorkspaceOptions {
  mode: PracticeViewMode;
  openView: (view: PracticeViewMode) => void;
  onSessionStarted?: () => void;
  ownerId: string | null;
  cloudBackoffActive: boolean;
  cards: readonly CardData[];
  poolSource: PracticePoolSource | null;
  gamificationDatabase: Parameters<typeof useVerifiedGamificationState>[0]['database'];
  onCeremony?: Parameters<typeof usePracticeSession>[0]['onAuthoritativeOutcome'];
  onEmptyStudy?: () => void;
  learning: PracticeLearningActions;
  languageProfile: LanguageProfile;
  reportError: (message: string) => void;
}

export interface PracticeWorkspace {
  model: {
    session: Pick<PracticeSessionController, 'mode' | 'sessionKey' | 'study' | 'quiz' | 'learning'>;
    gamification: ReturnType<typeof useVerifiedGamificationState>;
  };
  actions: PracticeSessionController['commands'];
  ports: {
    loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  };
  snapshotRef: { current: PracticeSnapshotPort };
}

export function usePracticeWorkspace({
  mode,
  openView,
  onSessionStarted,
  ownerId,
  cloudBackoffActive,
  cards,
  poolSource,
  gamificationDatabase,
  onCeremony,
  onEmptyStudy,
  learning,
  languageProfile,
  reportError,
}: PracticeWorkspaceOptions): PracticeWorkspace {
  const gamification = useVerifiedGamificationState({ ownerId, database: gamificationDatabase });
  const ownerGenerationRef = useRef({ ownerId, generation: 0 });
  if (ownerGenerationRef.current.ownerId !== ownerId) {
    ownerGenerationRef.current = { ownerId, generation: ownerGenerationRef.current.generation + 1 };
  }
  const targetLanguage = languageProfile.source.code;
  const normalizedTargetLanguage = normalizeCardLanguage(targetLanguage);
  const nativeLanguage = normalizeCardLanguage(languageProfile.target.code);
  const languageDrillCards = cardsForLanguagePair(cards, normalizedTargetLanguage, nativeLanguage);
  const loadPracticePool = useCallback(createPracticePoolLoader({
    ownerId,
    cloudBackoffActive,
    cards,
    source: poolSource,
    targetLanguage,
    reportError,
  }), [cards, cloudBackoffActive, ownerId, poolSource, targetLanguage, reportError]);
  const session = usePracticeSession({
    ownerId,
    mode,
    openView,
    onSessionStarted,
    loadPracticePool,
    languageDrillCards,
    languageDrillScopeKey: `${ownerId ?? ''}:${normalizedTargetLanguage}:${nativeLanguage}`,
    learning,
    languageProfile,
    onAuthoritativeOutcome: (outcome, operationId, sessionToken) => {
      if (sessionToken !== ownerGenerationRef.current.generation) return;
      gamification.acceptAuthoritativeOutcome(outcome);
      onCeremony?.(outcome, operationId, sessionToken);
    },
    onEmptyStudy,
    reportError,
  });
  const snapshotRef = useRef<PracticeSnapshotPort>(session.snapshot);
  snapshotRef.current = session.snapshot;

  return {
    model: {
      session: {
        mode: session.mode,
        sessionKey: session.sessionKey,
        study: session.study,
        quiz: session.quiz,
        learning: session.learning,
      },
      gamification,
    },
    actions: session.commands,
    ports: { loadPracticePool },
    snapshotRef,
  };
}
