import type { CatalogContentChunkV1 } from '../catalogPipeline/catalogContracts';
import type { SkillEvidenceV4 } from '../skillEvidence/skillEvidenceModel';
import type { ListenMvpLessonV1 } from './listenMvpContract';

export type ListenMvpEvidenceInput = Omit<SkillEvidenceV4, 'ownerId' | 'skill' | 'source'> & {
  readonly skill: 'listening';
  readonly source: 'listening';
};

const evidenceAnswerId = (answer: string): string => answer
  .normalize('NFKC')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'answer';

export const createListenMvpEvidence = (
  lesson: ListenMvpLessonV1,
  answer: string,
  observedAt = new Date().toISOString(),
): ListenMvpEvidenceInput => ({
  schemaVersion: 4,
  id: `listen-${lesson.clip.id}-${evidenceAnswerId(answer)}-${observedAt.replace(/[^0-9]/g, '')}`,
  target: { kind: 'chunk', id: lesson.chunk.id },
  skill: 'listening',
  source: 'listening',
  activityId: lesson.clip.id,
  score: answer === lesson.comprehension.answer ? 1 : 0,
  observedAt,
});

export interface ListenMvpAnswerReporter {
  report(answer: string): boolean;
  reset(): void;
}

export const createListenMvpAnswerReporter = (
  lesson: ListenMvpLessonV1,
  onEvidence: (evidence: ListenMvpEvidenceInput) => void | Promise<void>,
): ListenMvpAnswerReporter => {
  const reportedAnswers = new Set<string>();
  return {
    report: answer => {
      if (reportedAnswers.has(answer)) return false;
      reportedAnswers.add(answer);
      try {
        void Promise.resolve(onEvidence(createListenMvpEvidence(lesson, answer))).catch(() => undefined);
      } catch {
        // Evidence is additive learner progress and must not break answering.
      }
      return true;
    },
    reset: () => reportedAnswers.clear(),
  };
};

export type ListenMvpPlaybackRate = 0.75 | 1;
export type ListenMvpSaveState = 'idle' | 'saving' | 'saved' | 'failed';

export interface ListenMvpInteractionState {
  readonly playbackRate: ListenMvpPlaybackRate;
  readonly captionsVisible: boolean;
  readonly activeCueId: string | null;
  readonly selectedAnswer: string | null;
  readonly saveState: ListenMvpSaveState;
  readonly saveRequestId: number;
}

export type ListenMvpInteractionAction =
  | { readonly type: 'set-playback-rate'; readonly value: ListenMvpPlaybackRate }
  | { readonly type: 'toggle-captions' }
  | { readonly type: 'set-cue'; readonly cueId: string | null }
  | { readonly type: 'select-answer'; readonly answer: string }
  | { readonly type: 'reset'; readonly initialCueId: string | null }
  | { readonly type: 'save-start'; readonly requestId: number }
  | { readonly type: 'save-success'; readonly requestId: number }
  | { readonly type: 'save-failed'; readonly requestId: number };

export const createListenMvpInteractionState = (
  initialCueId: string | null,
  saveRequestId = 0,
): ListenMvpInteractionState => ({
  playbackRate: 1,
  captionsVisible: true,
  activeCueId: initialCueId,
  selectedAnswer: null,
  saveState: 'idle',
  saveRequestId,
});

export const reduceListenMvpInteractionState = (
  state: ListenMvpInteractionState,
  action: ListenMvpInteractionAction,
): ListenMvpInteractionState => {
  switch (action.type) {
    case 'set-playback-rate':
      return { ...state, playbackRate: action.value };
    case 'toggle-captions':
      return { ...state, captionsVisible: !state.captionsVisible };
    case 'set-cue':
      return { ...state, activeCueId: action.cueId };
    case 'select-answer':
      return { ...state, selectedAnswer: action.answer };
    case 'reset':
      return createListenMvpInteractionState(action.initialCueId, state.saveRequestId + 1);
    case 'save-start':
      return action.requestId > state.saveRequestId && state.saveState !== 'saving'
        ? { ...state, saveState: 'saving', saveRequestId: action.requestId }
        : state;
    case 'save-success':
      return action.requestId === state.saveRequestId && state.saveState === 'saving'
        ? { ...state, saveState: 'saved' }
        : state;
    case 'save-failed':
      return action.requestId === state.saveRequestId && state.saveState === 'saving'
        ? { ...state, saveState: 'failed' }
        : state;
    default:
      return state;
  }
};

export async function replayListenAudio(
  audio: Pick<HTMLAudioElement, 'currentTime' | 'play'>,
  onError: () => void,
): Promise<'played' | 'failed'> {
  audio.currentTime = 0;
  try {
    await audio.play();
    return 'played';
  } catch {
    onError();
    return 'failed';
  }
}

export async function runListenSave(
  chunk: CatalogContentChunkV1,
  onSaveChunk: (chunk: CatalogContentChunkV1) => void | Promise<void>,
): Promise<'saved' | 'failed'> {
  try {
    await onSaveChunk(chunk);
    return 'saved';
  } catch {
    return 'failed';
  }
}
