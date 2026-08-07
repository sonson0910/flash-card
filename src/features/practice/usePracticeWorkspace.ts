import { useCallback, useRef } from 'react';
import type { LanguageProfile } from '../language/languageProfile';
import type { GamificationStorage } from '../gamification/gamificationStorage';
import type { GamificationStore } from '../gamification/gamificationStore';
import { useGamificationState, type GamificationState } from '../gamification/useGamification';
import { isCardDue } from '../../lib/srs';
import type { CardData } from '../../types/card';
import {
  usePracticeSession,
  type PracticeLearningActions,
  type PracticeSessionController,
  type PracticeSnapshotPort,
  type PracticeViewMode,
} from './usePracticeSession';

const DEFAULT_PRACTICE_POOL_SIZE = 50;
export const MAXIMUM_PRACTICE_POOL_SIZE = 50;

export type PracticePoolFailure = 'quota' | 'unavailable';

export interface PracticePoolSource {
  load: (
    ownerId: string,
    maximum: number,
    options: { includeFuture: boolean },
  ) => Promise<CardData[]>;
  classifyFailure?: (error: unknown) => PracticePoolFailure;
}

export interface PracticePoolLoaderOptions {
  ownerId: string | null;
  cloudBackoffActive: boolean;
  cards: readonly CardData[];
  source: PracticePoolSource | null;
  reportError: (message: string) => void;
}

const boundedPoolSize = (maximum: number | undefined) => {
  if (maximum === undefined || !Number.isFinite(maximum)) return DEFAULT_PRACTICE_POOL_SIZE;
  return Math.min(MAXIMUM_PRACTICE_POOL_SIZE, Math.max(1, Math.floor(maximum)));
};

export function createPracticePoolLoader({
  ownerId,
  cloudBackoffActive,
  cards,
  source,
  reportError,
}: PracticePoolLoaderOptions) {
  return async (maximum?: number, includeFuture = true): Promise<CardData[]> => {
    const limit = boundedPoolSize(maximum);
    if (ownerId && source && !cloudBackoffActive) {
      try {
        const loaded = await source.load(ownerId, limit, { includeFuture });
        return loaded.slice(0, limit);
      } catch (error) {
        const failure = source.classifyFailure?.(error) ?? 'unavailable';
        reportError(failure === 'quota'
          ? 'The cloud read quota has been reached. Practice is using cards cached on this device.'
          : 'Could not load the cloud queue. Practice is using cards cached on this device.');
      }
    }

    const candidates = includeFuture ? cards : cards.filter(isCardDue);
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
  gamificationStore: GamificationStore | null;
  gamificationStorage?: GamificationStorage;
  now?: () => Date;
  gamificationSaveDelayMs?: number;
  learning: PracticeLearningActions;
  languageProfile: LanguageProfile;
  reportError: (message: string) => void;
}

export interface PracticeWorkspace {
  model: {
    session: Pick<PracticeSessionController, 'mode' | 'study' | 'quiz' | 'learning'>;
    gamification: GamificationState;
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
  gamificationStore,
  gamificationStorage,
  now,
  gamificationSaveDelayMs,
  learning,
  languageProfile,
  reportError,
}: PracticeWorkspaceOptions): PracticeWorkspace {
  const gamification = useGamificationState({
    ownerId,
    cloudBackoffActive,
    store: gamificationStore,
    storage: gamificationStorage,
    now,
    saveDelayMs: gamificationSaveDelayMs,
  });
  const loadPracticePool = useCallback(createPracticePoolLoader({
    ownerId,
    cloudBackoffActive,
    cards,
    source: poolSource,
    reportError,
  }), [cards, cloudBackoffActive, ownerId, poolSource, reportError]);
  const session = usePracticeSession({
    mode,
    openView,
    onSessionStarted,
    loadPracticePool,
    learning,
    languageProfile,
    addXp: gamification.addXp,
    reportError,
  });
  const snapshotRef = useRef<PracticeSnapshotPort>(session.snapshot);
  snapshotRef.current = session.snapshot;

  return {
    model: {
      session: {
        mode: session.mode,
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
