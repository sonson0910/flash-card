import { Captions, CheckCircle2, Headphones, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ListenMvpLessonV1 } from './listenMvpContract';
import type { OfflineMediaPackResolutionContext } from '../offlineMedia/offlineMediaPack';
import { activeListenTranscriptCue, initialListenCueId } from './listenMvpTranscript';
import {
  createListenMvpAnswerReporter,
  createListenMvpInteractionState,
  reduceListenMvpInteractionState,
  replayListenAudio,
  runListenSave,
} from './listenMvpInteraction';
import type { ListenMvpEvidenceInput } from './listenMvpInteraction';

export const LISTEN_MVP_CACHE_LOOKUP_TIMEOUT_MS = 2_000;

export interface ListenMvpProps {
  readonly lesson: ListenMvpLessonV1 | null;
  /** Optional phrase-save integration; learner persistence is supplied by the caller. */
  readonly onSaveChunk?: (lesson: ListenMvpLessonV1['chunk']) => void | Promise<void>;
  /** Optional learner-owned listening evidence seam; this never rates FSRS. */
  readonly onEvidence?: (evidence: ListenMvpEvidenceInput) => void | Promise<void>;
  /** Optional Cache Storage seam; failures always fall back to the online path. */
  readonly offlineMediaPacks?: ListenMvpOfflineMediaResolver;
  /** Trusted catalog/release/derivative identity required before using cached media. */
  readonly offlineMediaPackIdentity?: OfflineMediaPackResolutionContext;
}

export interface ListenMvpOfflineMediaResolver {
  readonly resolveCachedClip: (
    clip: ListenMvpLessonV1['clip'],
    context: OfflineMediaPackResolutionContext,
  ) => Promise<Response | null>;
}

export interface ListenMvpAudioUrlApi {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

export interface ListenMvpCachedAudioSource {
  readonly url: string;
  readonly revoke: () => void;
}

export interface ListenMvpCachedAudioSelection {
  readonly clipKey: string;
  readonly source: ListenMvpCachedAudioSource;
}

export interface ListenMvpCachedLookupState {
  readonly clipKey: string;
  readonly status: 'pending' | 'ready';
}

export const listenMvpClipKey = (
  clip: ListenMvpLessonV1['clip'],
  identity?: OfflineMediaPackResolutionContext,
): string => (
  JSON.stringify({ clip, identity: identity ?? null })
);

export const getListenMvpAudioState = (
  lesson: ListenMvpLessonV1 | null,
  resolver: ListenMvpOfflineMediaResolver | undefined,
  lookup: ListenMvpCachedLookupState | null,
  cached: ListenMvpCachedAudioSelection | null,
  identity?: OfflineMediaPackResolutionContext,
): { readonly pending: boolean; readonly src: string | undefined } => {
  if (!lesson) return { pending: false, src: undefined };
  if (!resolver) return { pending: false, src: lesson.clip.path };
  const clipKey = listenMvpClipKey(lesson.clip, identity);
  if (lookup?.clipKey !== clipKey || lookup.status === 'pending') {
    return { pending: true, src: undefined };
  }
  return {
    pending: false,
    src: cached?.clipKey === clipKey ? cached.source.url : lesson.clip.path,
  };
};

const browserAudioUrlApi: ListenMvpAudioUrlApi = {
  createObjectURL: blob => URL.createObjectURL(blob),
  revokeObjectURL: url => URL.revokeObjectURL(url),
};

export const createListenMvpCachedAudioSource = async (
  response: Response,
  urlApi: ListenMvpAudioUrlApi = browserAudioUrlApi,
): Promise<ListenMvpCachedAudioSource> => {
  const url = urlApi.createObjectURL(await response.blob());
  let revoked = false;
  return {
    url,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      urlApi.revokeObjectURL(url);
    },
  };
};

export const shouldAdoptListenMvpCachedAudio = (
  disposed: boolean,
  onlinePlaybackStarted: boolean,
): boolean => !disposed && !onlinePlaybackStarted;

export function ListenMvp({
  lesson,
  onSaveChunk,
  onEvidence,
  offlineMediaPacks,
  offlineMediaPackIdentity,
}: ListenMvpProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [interaction, dispatch] = useReducer(
    reduceListenMvpInteractionState,
    lesson ? initialListenCueId(lesson.clip) : null,
    createListenMvpInteractionState,
  );
  const [error, setError] = useState<string | null>(null);
  const [cachedAudio, setCachedAudio] = useState<ListenMvpCachedAudioSelection | null>(null);
  const [cacheLookup, setCacheLookup] = useState<ListenMvpCachedLookupState | null>(null);
  const cacheResolver = offlineMediaPacks && offlineMediaPackIdentity
    ? offlineMediaPacks
    : undefined;
  const offlineMediaKey = lesson
    ? listenMvpClipKey(lesson.clip, offlineMediaPackIdentity)
    : null;
  const onlinePlaybackStartedRef = useRef(false);
  const onEvidenceRef = useRef(onEvidence);
  onEvidenceRef.current = onEvidence;
  const answerReporter = useRef<{
    readonly lessonKey: string;
    readonly report: (answer: string) => boolean;
  } | null>(null);
  const lessonKey = lesson?.clip.id ?? null;
  if (lesson === null) answerReporter.current = null;
  else if (answerReporter.current?.lessonKey !== lessonKey) {
    answerReporter.current = {
      lessonKey: lesson.clip.id,
      ...createListenMvpAnswerReporter(lesson, evidence => onEvidenceRef.current?.(evidence)),
    };
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = interaction.playbackRate;
  }, [lesson, interaction.playbackRate]);

  useEffect(() => {
    dispatch({ type: 'reset', initialCueId: lesson ? initialListenCueId(lesson.clip) : null });
    setError(null);
  }, [lesson]);

  useEffect(() => {
    onlinePlaybackStartedRef.current = false;
  }, [offlineMediaKey]);

  useEffect(() => {
    let disposed = false;
    let source: ListenMvpCachedAudioSource | null = null;
    setCachedAudio(null);
    if (!lesson || !cacheResolver || !offlineMediaPackIdentity || offlineMediaKey === null) {
      setCacheLookup(null);
      return () => {
        disposed = true;
      };
    }
    const clipKey = offlineMediaKey;
    setCacheLookup({ clipKey, status: 'pending' });
    const lookupTimeout = globalThis.setTimeout(() => {
      if (disposed) return;
      onlinePlaybackStartedRef.current = true;
      setCacheLookup({ clipKey, status: 'ready' });
      setError(null);
    }, LISTEN_MVP_CACHE_LOOKUP_TIMEOUT_MS);
    void (async () => {
      try {
        const response = await cacheResolver.resolveCachedClip(lesson.clip, offlineMediaPackIdentity);
        if (disposed) return;
        if (response === null) {
          onlinePlaybackStartedRef.current = true;
          setCacheLookup({ clipKey, status: 'ready' });
          setError(null);
          return;
        }
        source = await createListenMvpCachedAudioSource(response);
        if (!shouldAdoptListenMvpCachedAudio(disposed, onlinePlaybackStartedRef.current)) {
          source.revoke();
          if (!disposed) {
            setCacheLookup({ clipKey, status: 'ready' });
            setError(null);
          }
          return;
        }
        setCachedAudio({ clipKey, source });
        setCacheLookup({ clipKey, status: 'ready' });
        setError(null);
      } catch {
        if (disposed) return;
        onlinePlaybackStartedRef.current = true;
        setCachedAudio(null);
        setCacheLookup({ clipKey, status: 'ready' });
        setError(null);
      } finally {
        globalThis.clearTimeout(lookupTimeout);
      }
    })();
    return () => {
      disposed = true;
      globalThis.clearTimeout(lookupTimeout);
      source?.revoke();
    };
  }, [cacheResolver, offlineMediaKey]);

  const audioState = getListenMvpAudioState(
    lesson,
    cacheResolver,
    cacheLookup,
    cachedAudio,
    offlineMediaPackIdentity,
  );

  const onAudioPlay = useCallback(() => {
    if (audioState.pending) onlinePlaybackStartedRef.current = true;
  }, [audioState.pending]);

  const updateCue = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!lesson) return;
    dispatch({ type: 'set-cue', cueId: activeListenTranscriptCue(
      lesson.clip,
      event.currentTarget.currentTime * 1_000,
    )?.id ?? null });
  }, [lesson]);

  const replay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioState.pending) return;
    setError(null);
    dispatch({ type: 'set-cue', cueId: lesson ? initialListenCueId(lesson.clip) : null });
    void replayListenAudio(audio, () => {
      setError('Audio could not start. Use the browser controls to try again.');
    });
  }, [audioState.pending, lesson]);

  const selectAnswer = useCallback((answer: string) => {
    dispatch({ type: 'select-answer', answer });
    answerReporter.current?.report(answer);
  }, []);

  const saveChunk = useCallback(async () => {
    if (!lesson || !onSaveChunk || interaction.saveState === 'saving' || interaction.saveState === 'saved') return;
    const requestId = interaction.saveRequestId + 1;
    dispatch({ type: 'save-start', requestId });
    const result = await runListenSave(lesson.chunk, onSaveChunk);
    dispatch({ type: result === 'saved' ? 'save-success' : 'save-failed', requestId });
  }, [interaction.saveRequestId, interaction.saveState, lesson, onSaveChunk]);

  if (!lesson) {
    return (
      <section className="mx-auto w-full max-w-3xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)]" aria-labelledby="listen-unavailable-heading">
        <div role="status" aria-live="polite" className="flex items-start gap-3">
          <Headphones className="mt-0.5 size-6 shrink-0 text-[var(--sf-brand-text)]" aria-hidden="true" />
          <div>
            <h2 id="listen-unavailable-heading" className="text-xl font-black">Reviewed listening is not installed yet</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">A verified audio release will appear here after its source, rights, transcript, and human review are complete. Draft media is never played.</p>
          </div>
        </div>
      </section>
    );
  }

  const activeCue = lesson.clip.transcriptCues.find(cue => cue.id === interaction.activeCueId) ?? null;
  const answerCorrect = interaction.selectedAnswer === lesson.comprehension.answer;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5 rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" aria-labelledby="listen-mvp-heading">
      <header>
        <p className="premium-kicker uppercase tracking-[0.16em]">Immerse · Listen</p>
        <h2 id="listen-mvp-heading" className="mt-2 text-2xl font-black tracking-tight">{lesson.chunk.text}</h2>
        <p className="mt-2 text-sm text-[var(--sf-text-muted)]">Listen for the sentence, then check what you understood.</p>
      </header>

      <div className="space-y-3">
        <audio
          ref={audioRef}
          className="w-full"
          controls
          preload="metadata"
          src={audioState.src}
          aria-busy={audioState.pending}
          aria-label={`Listen to ${lesson.chunk.text}`}
          onPlay={onAudioPlay}
          onTimeUpdate={updateCue}
          onError={() => setError('This reviewed audio is unavailable on the current device.')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={replay} disabled={audioState.pending} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"><RotateCcw className="size-4" aria-hidden="true" />{audioState.pending ? 'Preparing audio…' : 'Replay'}</button>
          <fieldset className="flex min-h-11 items-center gap-1 rounded-xl border border-[var(--sf-border)] px-2">
            <legend className="sr-only">Playback speed</legend>
            {([0.75, 1] as const).map(rate => <button key={rate} type="button" onClick={() => dispatch({ type: 'set-playback-rate', value: rate })} aria-pressed={interaction.playbackRate === rate} className="min-h-9 rounded-lg px-2.5 text-sm font-bold transition-colors hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 motion-reduce:transition-none" aria-label={`Play at ${rate} times speed`}>{rate}×</button>)}
          </fieldset>
          <button type="button" onClick={() => dispatch({ type: 'toggle-captions' })} aria-pressed={interaction.captionsVisible} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none"><Captions className="size-4" aria-hidden="true" />Captions</button>
        </div>
        {interaction.captionsVisible && <p className="min-h-12 rounded-xl bg-[var(--sf-surface-raised)] p-3 text-sm leading-6" lang={lesson.clip.language} role="status" aria-live="polite">{activeCue?.text ?? 'Captions will follow the audio.'}</p>}
        {error && <p className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200" role="alert">{error}</p>}
      </div>

      <fieldset className="space-y-3 border-t border-[var(--sf-border)] pt-5">
        <legend className="text-sm font-black">{lesson.comprehension.question}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {lesson.comprehension.options.map(option => <button key={option} type="button" onClick={() => selectAnswer(option)} aria-pressed={interaction.selectedAnswer === option} className="min-h-12 rounded-xl border border-[var(--sf-border)] px-4 py-3 text-left text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none aria-[pressed=true]:border-[var(--sf-brand)] aria-[pressed=true]:bg-cyan-50 dark:aria-[pressed=true]:bg-cyan-950/30">{option}</button>)}
        </div>
        {interaction.selectedAnswer && <p className={`flex items-center gap-2 text-sm font-bold ${answerCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`} role="status" aria-live="polite">{answerCorrect && <CheckCircle2 className="size-4" aria-hidden="true" />}{answerCorrect ? 'Correct — nice listening.' : 'Not quite. Listen again and try once more.'}</p>}
      </fieldset>

      <footer className="space-y-4 border-t border-[var(--sf-border)] pt-5 text-sm">
        {onSaveChunk && <button type="button" onClick={() => void saveChunk()} disabled={interaction.saveState === 'saving' || interaction.saveState === 'saved'} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 disabled:cursor-default disabled:opacity-60 motion-reduce:transition-none"><Save className="size-4" aria-hidden="true" />{interaction.saveState === 'saved' ? 'Saved phrase' : interaction.saveState === 'saving' ? 'Saving…' : 'Save phrase'}</button>}
        {interaction.saveState === 'failed' && <p className="text-sm font-semibold text-rose-700 dark:text-rose-300" role="alert">The phrase was not saved. Try again when your library is available.</p>}
        <div aria-label="Source and attribution" className="space-y-2 text-xs leading-5 text-[var(--sf-text-muted)]">
          <p className="font-black uppercase tracking-wide">Source and attribution</p>
          {lesson.sources.map(source => <p key={source.sourceRef}><a className="font-bold text-[var(--sf-brand-text)] underline decoration-[var(--sf-brand)] underline-offset-2" href={source.sourceUrl}>{source.sourceRef}</a> · License: {source.licenseId} · Attribution: {source.attribution}</p>)}
        </div>
      </footer>
    </section>
  );
}
