import type { CatalogContentChunkV1 } from '../catalogPipeline/catalogContracts';

export type ListenMvpPlaybackRate = 0.75 | 1;
export type ListenMvpSaveState = 'idle' | 'saving' | 'saved' | 'failed';

export interface ListenMvpInteractionState {
  readonly playbackRate: ListenMvpPlaybackRate;
  readonly captionsVisible: boolean;
  readonly activeCueId: string | null;
  readonly selectedAnswer: string | null;
  readonly saveState: ListenMvpSaveState;
}

export type ListenMvpInteractionAction =
  | { readonly type: 'set-playback-rate'; readonly value: ListenMvpPlaybackRate }
  | { readonly type: 'toggle-captions' }
  | { readonly type: 'set-cue'; readonly cueId: string | null }
  | { readonly type: 'select-answer'; readonly answer: string }
  | { readonly type: 'reset'; readonly initialCueId: string | null }
  | { readonly type: 'save-start' }
  | { readonly type: 'save-success' }
  | { readonly type: 'save-failed' };

export const createListenMvpInteractionState = (
  initialCueId: string | null,
): ListenMvpInteractionState => ({
  playbackRate: 1,
  captionsVisible: true,
  activeCueId: initialCueId,
  selectedAnswer: null,
  saveState: 'idle',
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
      return createListenMvpInteractionState(action.initialCueId);
    case 'save-start':
      return { ...state, saveState: 'saving' };
    case 'save-success':
      return { ...state, saveState: 'saved' };
    case 'save-failed':
      return { ...state, saveState: 'failed' };
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
