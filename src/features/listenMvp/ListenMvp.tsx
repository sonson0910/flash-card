import { Captions, CheckCircle2, Headphones, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListenMvpLessonV1 } from './listenMvpContract';
import { activeListenTranscriptCue } from './listenMvpContract';

export interface ListenMvpProps {
  readonly lesson: ListenMvpLessonV1 | null;
  /** Integration seam only; this feature does not persist learner data. */
  readonly onSaveChunk?: (lesson: ListenMvpLessonV1['chunk']) => void | Promise<void>;
}

type PlaybackRate = 0.75 | 1;
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function ListenMvp({ lesson, onSaveChunk }: ListenMvpProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [activeCueId, setActiveCueId] = useState<string | null>(
    lesson?.clip.transcriptCues[0]?.id ?? null,
  );
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [lesson, playbackRate]);

  useEffect(() => {
    setActiveCueId(lesson?.clip.transcriptCues[0]?.id ?? null);
    setSelectedAnswer(null);
    setSaveState('idle');
    setError(null);
  }, [lesson]);

  const updateCue = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (!lesson) return;
    setActiveCueId(activeListenTranscriptCue(
      lesson.clip,
      event.currentTarget.currentTime * 1_000,
    )?.id ?? null);
  }, [lesson]);

  const replay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    audio.currentTime = 0;
    void audio.play().catch(() => {
      setError('Audio could not start. Use the browser controls to try again.');
    });
  }, []);

  const saveChunk = useCallback(async () => {
    if (!lesson || !onSaveChunk || saveState === 'saving' || saveState === 'saved') return;
    setSaveState('saving');
    try {
      await onSaveChunk(lesson.chunk);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }, [lesson, onSaveChunk, saveState]);

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

  const activeCue = lesson.clip.transcriptCues.find(cue => cue.id === activeCueId) ?? null;
  const answerCorrect = selectedAnswer === lesson.comprehension.answer;

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
          src={lesson.clip.path}
          aria-label={`Listen to ${lesson.chunk.text}`}
          onTimeUpdate={updateCue}
          onError={() => setError('This reviewed audio is unavailable on the current device.')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={replay} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none"><RotateCcw className="size-4" aria-hidden="true" />Replay</button>
          <fieldset className="flex min-h-11 items-center gap-1 rounded-xl border border-[var(--sf-border)] px-2">
            <legend className="sr-only">Playback speed</legend>
            {([0.75, 1] as const).map(rate => <button key={rate} type="button" onClick={() => setPlaybackRate(rate)} aria-pressed={playbackRate === rate} className="min-h-9 rounded-lg px-2.5 text-sm font-bold transition-colors hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 motion-reduce:transition-none" aria-label={`Play at ${rate} times speed`}>{rate}×</button>)}
          </fieldset>
          <button type="button" onClick={() => setCaptionsVisible(value => !value)} aria-pressed={captionsVisible} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none"><Captions className="size-4" aria-hidden="true" />Captions</button>
        </div>
        {captionsVisible && <p className="min-h-12 rounded-xl bg-[var(--sf-surface-raised)] p-3 text-sm leading-6" lang={lesson.clip.language} role="status" aria-live="polite">{activeCue?.text ?? 'Captions will follow the audio.'}</p>}
        {error && <p className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200" role="alert">{error}</p>}
      </div>

      <fieldset className="space-y-3 border-t border-[var(--sf-border)] pt-5">
        <legend className="text-sm font-black">{lesson.comprehension.question}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {lesson.comprehension.options.map(option => <button key={option} type="button" onClick={() => setSelectedAnswer(option)} aria-pressed={selectedAnswer === option} className="min-h-12 rounded-xl border border-[var(--sf-border)] px-4 py-3 text-left text-sm font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none aria-[pressed=true]:border-[var(--sf-brand)] aria-[pressed=true]:bg-cyan-50 dark:aria-[pressed=true]:bg-cyan-950/30">{option}</button>)}
        </div>
        {selectedAnswer && <p className={`flex items-center gap-2 text-sm font-bold ${answerCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`} role="status" aria-live="polite">{answerCorrect && <CheckCircle2 className="size-4" aria-hidden="true" />}{answerCorrect ? 'Correct — nice listening.' : 'Not quite. Listen again and try once more.'}</p>}
      </fieldset>

      <footer className="space-y-4 border-t border-[var(--sf-border)] pt-5 text-sm">
        {onSaveChunk && <button type="button" onClick={() => void saveChunk()} disabled={saveState === 'saving' || saveState === 'saved'} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 disabled:cursor-default disabled:opacity-60 motion-reduce:transition-none"><Save className="size-4" aria-hidden="true" />{saveState === 'saved' ? 'Saved phrase' : saveState === 'saving' ? 'Saving…' : 'Save phrase'}</button>}
        {saveState === 'failed' && <p className="text-sm font-semibold text-rose-700 dark:text-rose-300" role="alert">The phrase was not saved. Try again when your library is available.</p>}
        <div aria-label="Source and attribution" className="space-y-2 text-xs leading-5 text-[var(--sf-text-muted)]">
          <p className="font-black uppercase tracking-wide">Source and attribution</p>
          {lesson.sources.map(source => <p key={source.sourceRef}><a className="font-bold text-[var(--sf-brand-text)] underline decoration-[var(--sf-brand)] underline-offset-2" href={source.sourceUrl}>{source.sourceRef}</a> · License: {source.licenseId} · Attribution: {source.attribution}</p>)}
        </div>
      </footer>
    </section>
  );
}
