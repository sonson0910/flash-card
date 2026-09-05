import { BookOpen, Check, CircleAlert, Loader2, RefreshCw, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cancelSpeech, speakText } from '../../lib/audio';
import type { StoryInfo } from '../../lib/wordInfo';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { getStoryStatusAnnouncement } from './practiceAccessibility';

interface StoryViewProps {
  story: StoryInfo | null;
  loading: boolean;
  error?: string | null;
  onGenerate: () => void;
  onClose: () => void;
}

export const normalizeGrammarAnswer = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export const isGrammarAnswerCorrect = (answer: string, acceptedAnswer: string): boolean => (
  Boolean(answer.trim()) && normalizeGrammarAnswer(answer) === normalizeGrammarAnswer(acceptedAnswer)
);

export const isComprehensionAnswerCorrect = (selectedIndex: number, correctIndex: number): boolean => (
  selectedIndex === correctIndex
);

export function StoryView({ story, loading, error = null, onGenerate, onClose }: StoryViewProps) {
  const loadingStatusRef = useRef<HTMLDivElement>(null);
  const storyHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const speechRunRef = useRef(0);
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [selectedComprehension, setSelectedComprehension] = useState<number | null>(null);
  const [grammarAnswer, setGrammarAnswer] = useState('');
  const [grammarChecked, setGrammarChecked] = useState(false);
  const [retellDraft, setRetellDraft] = useState('');

  const stopSpeech = () => {
    speechRunRef.current += 1;
    cancelSpeech();
    setActiveScene(null);
  };

  useEffect(() => () => {
    speechRunRef.current += 1;
    cancelSpeech();
  }, []);

  useEffect(() => {
    stopSpeech();
    setSpeechError(null);
    setSelectedComprehension(null);
    setGrammarAnswer('');
    setGrammarChecked(false);
    setRetellDraft('');
  }, [loading, story]);

  useEffect(() => {
    if (loading) {
      loadingStatusRef.current?.focus();
      return;
    }
    if (error) {
      errorRef.current?.focus();
      return;
    }
    if (story) storyHeadingRef.current?.focus();
  }, [error, loading, story]);

  const speakScene = (sceneIndex: number) => {
    const english = story?.segments[sceneIndex]?.english;
    if (!english) return;
    const run = speechRunRef.current + 1;
    speechRunRef.current = run;
    cancelSpeech();
    setSpeechError(null);
    setActiveScene(sceneIndex);
    const started = speakText(english, {
      onStart: () => {
        if (speechRunRef.current === run) setActiveScene(sceneIndex);
      },
      onEnd: () => {
        if (speechRunRef.current === run) setActiveScene(current => current === sceneIndex ? null : current);
      },
      onError: speechErrorCode => {
        if (speechRunRef.current !== run || speechErrorCode === 'canceled' || speechErrorCode === 'interrupted') return;
        setActiveScene(null);
        setSpeechError('Speech playback is unavailable. Read the English text below.');
      },
    });
    if (!started && speechRunRef.current === run) {
      setActiveScene(null);
      setSpeechError('Speech playback is unavailable. Read the English text below.');
    }
  };

  const handleClose = () => {
    stopSpeech();
    onClose();
  };

  const handleGenerate = () => {
    stopSpeech();
    onGenerate();
  };

  const statusAnnouncement = getStoryStatusAnnouncement(loading, story !== null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center py-4 sm:py-8" aria-busy={loading}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loading ? '' : statusAnnouncement}</p>
      <div className="mb-6 flex w-full items-center justify-between px-2">
        <button type="button" onClick={handleClose} className="min-h-11 min-w-11 rounded-full p-2 text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 motion-reduce:transition-none" aria-label="Close story">
          <X size={24} aria-hidden="true" />
        </button>
        <div className="text-sm font-bold text-[var(--sf-text-muted)]">Context story</div>
        <div className="w-11" aria-hidden="true" />
      </div>
      {loading ? (
        <GsapEntrance animationKey="story-loading" ref={loadingStatusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="mx-auto flex min-h-72 w-full max-w-lg flex-col items-center justify-center rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] focus-visible:outline-2">
          <Loader2 size={48} className="mb-4 animate-spin text-[var(--sf-brand-text)] motion-reduce:animate-none" aria-hidden="true" />
          <p className="text-center font-bold text-[var(--sf-text)]">Creating your story…</p>
        </GsapEntrance>
      ) : error ? (
        <GsapEntrance
          animationKey={error}
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          variant="result"
          className="w-full max-w-lg rounded-[28px] border border-rose-300 bg-rose-50 p-7 text-center text-rose-900 shadow-[0_28px_70px_-52px_var(--sf-shadow)] focus-visible:outline-2 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100"
        >
          <CircleAlert className="mx-auto mb-4" size={36} aria-hidden="true" />
          <h2 className="text-lg font-black">Story generation stopped</h2>
          <p className="mt-2 text-sm leading-relaxed">{error}</p>
          <button type="button" onClick={handleGenerate} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-5 py-3 font-bold text-white transition-colors hover:bg-rose-800 focus-visible:outline-2 motion-reduce:transition-none">
            <RefreshCw size={17} aria-hidden="true" /> Try again
          </button>
        </GsapEntrance>
      ) : story ? (
        <GsapEntrance animationKey={story.title} variant="result" className="w-full max-w-3xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" aria-labelledby="story-heading">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 text-[var(--sf-brand-text)]" aria-hidden="true"><BookOpen size={24} /></div>
            <div>
              <h2 id="story-heading" ref={storyHeadingRef} tabIndex={-1} className="text-balance text-2xl font-black tracking-tight focus-visible:outline-2">{story.title}</h2>
              <p className="text-pretty text-xs font-bold text-[var(--sf-text-muted)]">An ephemeral AI-generated lesson from your vocabulary</p>
            </div>
          </div>

          <section aria-labelledby="story-scenes-heading">
            <h3 id="story-scenes-heading" className="mb-3 text-sm font-black text-[var(--sf-brand-text)]">Read the scenes</h3>
            <div className="space-y-4">
              {story.segments.map((segment, index) => (
                <article
                  key={`${index}-${segment.english}`}
                  data-story-scene={index}
                  aria-current={activeScene === index ? 'true' : undefined}
                  className={`rounded-2xl border p-4 transition-colors motion-reduce:transition-none ${activeScene === index ? 'border-[var(--sf-brand)] bg-[var(--sf-surface-raised)]' : 'border-[var(--sf-border)]'}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="text-xs font-black uppercase tracking-wide text-[var(--sf-text-muted)]">Scene {index + 1}</h4>
                    <button type="button" onClick={() => speakScene(index)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-[var(--sf-brand-text)] hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2" aria-label={`Read scene ${index + 1} in English`}>
                      <Volume2 size={17} aria-hidden="true" /> Read aloud
                    </button>
                  </div>
                  <p className="font-medium leading-relaxed">{segment.english}</p>
                  <p lang="vi" className="mt-2 font-medium leading-relaxed text-[var(--sf-text-muted)]">{segment.vietnamese}</p>
                </article>
              ))}
            </div>
            {speechError ? <p role="status" aria-live="polite" className="mt-3 text-sm text-[var(--sf-text-muted)]">{speechError}</p> : null}
          </section>

          <section aria-labelledby="story-targets-heading" className="mt-7 border-t border-[var(--sf-border)] pt-6">
            <h3 id="story-targets-heading" className="text-sm font-black text-[var(--sf-brand-text)]">Target phrases</h3>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Target phrases from your vocabulary">
              {story.targetPhrases.map(phrase => <li key={phrase} className="rounded-full bg-[var(--sf-surface-raised)] px-3 py-1 text-sm font-bold">{phrase}</li>)}
            </ul>
          </section>

          <section aria-labelledby="story-comprehension-heading" className="mt-7 border-t border-[var(--sf-border)] pt-6">
            <fieldset>
              <legend id="story-comprehension-heading" className="text-sm font-black text-[var(--sf-brand-text)]">Check understanding</legend>
              <p className="mt-2 font-bold">{story.comprehension.question}</p>
              <div className="mt-3 space-y-2">
                {story.comprehension.options.map((option, index) => (
                  <label key={option} className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--sf-border)] px-3 py-2 hover:bg-[var(--sf-surface-raised)]">
                    <input type="radio" name="story-comprehension" value={index} checked={selectedComprehension === index} onChange={() => setSelectedComprehension(index)} />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {selectedComprehension !== null ? (
              <p role="status" aria-live="polite" className="mt-3 flex items-start gap-2 text-sm font-bold">
                {isComprehensionAnswerCorrect(selectedComprehension, story.comprehension.correctIndex) ? <Check size={17} aria-hidden="true" /> : null}
                {isComprehensionAnswerCorrect(selectedComprehension, story.comprehension.correctIndex) ? 'Correct.' : 'Not quite.'} {story.comprehension.explanationVi}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="story-grammar-heading" className="mt-7 border-t border-[var(--sf-border)] pt-6">
            <h3 id="story-grammar-heading" className="text-sm font-black text-[var(--sf-brand-text)]">Grammar transformation: {story.grammar.label}</h3>
            <p lang="vi" className="mt-2 text-sm text-[var(--sf-text-muted)]">{story.grammar.explanationVi}</p>
            <p className="mt-3 rounded-xl bg-[var(--sf-surface-raised)] p-3 font-medium">{story.grammar.sourceSentence}</p>
            <form onSubmit={event => { event.preventDefault(); setGrammarChecked(true); }} className="mt-3">
              <label htmlFor="story-grammar-answer" className="text-sm font-bold">{story.grammar.prompt}</label>
              <input id="story-grammar-answer" value={grammarAnswer} onChange={event => { setGrammarAnswer(event.target.value); setGrammarChecked(false); }} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 focus-visible:outline-2" autoComplete="off" />
              <button type="submit" className="mt-3 min-h-11 rounded-xl border border-[var(--sf-border)] px-4 py-2 font-bold hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2">Check grammar</button>
            </form>
            {grammarChecked ? <p role="status" aria-live="polite" className="mt-3 text-sm font-bold">{isGrammarAnswerCorrect(grammarAnswer, story.grammar.acceptedAnswer) ? 'Correct.' : `Try again. One accepted answer is “${story.grammar.acceptedAnswer}”.`}</p> : null}
          </section>

          <section aria-labelledby="story-retell-heading" className="mt-7 border-t border-[var(--sf-border)] pt-6">
            <h3 id="story-retell-heading" className="text-sm font-black text-[var(--sf-brand-text)]">Retell in your own words</h3>
            <label htmlFor="story-retell-draft" className="mt-2 block text-sm font-bold">{story.retellPrompt}</label>
            <textarea id="story-retell-draft" value={retellDraft} onChange={event => setRetellDraft(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 focus-visible:outline-2" />
            <p className="mt-2 text-xs text-[var(--sf-text-muted)]">This draft stays on this screen and is not submitted.</p>
          </section>

          <div className="mt-8 flex justify-center"><button data-color-role="primary" type="button" onClick={handleGenerate} className="flex min-h-12 items-center gap-2 rounded-xl bg-[var(--sf-brand)] px-6 py-3 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none"><RefreshCw size={18} aria-hidden="true" /> Create another story</button></div>
        </GsapEntrance>
      ) : null}
    </div>
  );
}
