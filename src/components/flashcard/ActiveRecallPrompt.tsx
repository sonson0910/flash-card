import { Eye, Image as ImageIcon, Volume2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CardData } from '../../types/card';
import { buildRecallPrompt, isRecallAnswerCorrect, resolveRecallMode, type RecallMode } from '../../lib/recall';
import { isSupportedImageUrl } from '../../lib/images';
import { CardImage } from './CardImage';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import { voiceForActiveCourseCard } from '../../lib/courseVoicePreference';
import { speechLocaleFor } from '../../lib/speechLocale';
import { useCourseSession } from '../../features/courses/CourseGate';

interface ActiveRecallPromptProps {
  card: CardData;
  mode: RecallMode;
  onReveal: () => void;
  onImageUnavailable?: () => void;
}

export function ActiveRecallPrompt({ card, mode, onReveal, onImageUnavailable }: ActiveRecallPromptProps) {
  const { _, i18n } = useLingui();
  const { model: courseModel } = useCourseSession();
  const resolvedMode = resolveRecallMode(card, mode);
  const targetLanguage = card.language || 'en';
  const translationLanguage = card.translationLanguage || 'vi';
  const languageNames = new Intl.DisplayNames([i18n.locale], { type: 'language' });
  const prompt = buildRecallPrompt(card, mode, {
    missingVocabularyWord: _(msg({ id: 'flashcard.recall.missing-vocabulary-word', message: 'Complete the missing vocabulary word.' })),
    completeMissingWord: _(msg({ id: 'flashcard.recall.complete-missing-word', message: 'Complete the missing word' })),
    recallTargetWord: _(msg({ id: 'flashcard.recall.target-word', message: 'Recall the {language} word' }).id, { language: languageNames.of(targetLanguage) || targetLanguage }),
    translateMeaning: _(msg({ id: 'flashcard.recall.translate-meaning', message: 'Translate this meaning' })),
    nameWhatYouSee: _(msg({ id: 'flashcard.recall.name-what-you-see', message: 'Name what you see' })),
    visualRecall: _(msg({ id: 'flashcard.recall.visual-recall', message: 'Visual recall' })),
    listenAndRecallSpelling: _(msg({ id: 'flashcard.recall.listen-and-spell', message: 'Listen and recall the spelling' })),
    audioRecall: _(msg({ id: 'flashcard.recall.audio-recall', message: 'Audio recall' })),
    recallNativeMeaning: _(msg({ id: 'flashcard.recall.native-meaning', message: 'Recall the {language} meaning' }).id, { language: languageNames.of(translationLanguage) || translationLanguage }),
  });
  const imageUrl = isSupportedImageUrl(card.imageUrl) ? card.imageUrl : null;
  const [answerInput, setAnswerInput] = useState('');
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null);
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);

  useEffect(() => {
    setAnswerInput('');
    setAnswerCorrect(null);
    audioPlaybackRef.current?.cancel();
    audioPlaybackRef.current = null;
  }, [card.id, mode]);

  useEffect(() => () => audioPlaybackRef.current?.cancel(), []);

  const playPrompt = () => {
    audioPlaybackRef.current?.cancel();
    const voice = voiceForActiveCourseCard(card, courseModel.activeCourse);
    audioPlaybackRef.current = playWordAudio(card.word, card.audioUrl, speechLocaleFor(card), voice);
  };

  const checkAnswer = (event: FormEvent) => {
    event.preventDefault();
    // An IME composing a Hangul/kana/pinyin candidate can trigger the
    // Enter-to-submit form event before the learner has confirmed their
    // input; ignore that submit instead of checking a half-typed answer.
    if ((event.nativeEvent as SubmitEvent & { isComposing?: boolean }).isComposing) return;
    if (!answerInput.trim()) return;
    setAnswerCorrect(isRecallAnswerCorrect(answerInput, prompt.answer));
  };

  return (
    <section
      className="group mx-auto flex h-[clamp(300px,60dvh,480px)] w-full max-w-xl flex-col overflow-hidden rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-xl md:max-w-2xl"
      aria-labelledby="recall-instruction"
    >
      <div className="px-6 pt-6 text-center">
        <p id="recall-instruction" className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--sf-brand-text)]">
          {prompt.instruction}
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 sm:p-8 text-center overflow-y-auto">
        {prompt.showImage ? (
          imageUrl ? (
            <div className="w-full max-w-sm h-52 overflow-hidden rounded-3xl shadow-lg">
              <CardImage
                src={imageUrl}
                alt={_(msg({ id: 'flashcard.image.illustration', message: 'Illustration for {word}' }).id, { word: card.word })}
                priority
                onUnavailable={onImageUnavailable}
              />
            </div>
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-3xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]" role="img" aria-label={_(msg({ id: 'flashcard.recall.no-illustration', message: 'No illustration available' }))}>
              <ImageIcon size={48} strokeWidth={1.5} />
            </div>
          )
        ) : prompt.playAudio ? (
          <button
            type="button"
            onClick={playPrompt}
            className="flex h-28 w-28 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] transition-transform hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sf-brand)]"
            aria-label={_(msg({ id: 'flashcard.recall.play-word', message: 'Play word for listening practice' }))}
          >
            <Volume2 size={46} />
          </button>
        ) : (
          <h2 lang={resolvedMode === 'native-to-target' ? translationLanguage : targetLanguage} className="text-balance text-4xl font-black text-[var(--sf-text)] sm:text-5xl">{prompt.promptText}</h2>
        )}

        <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="flashcard.recall.instructions" message="Recall first, then type your answer to check it." /></p>

        <form onSubmit={checkAnswer} className="w-full max-w-sm flex gap-2" aria-label={_(msg({ id: 'flashcard.recall.check-answer', message: 'Check recalled answer' }))}>
          <label htmlFor={`recall-answer-${card.id}`} className="sr-only"><Trans id="flashcard.recall.answer" message="Your answer" /></label>
          <input
            id={`recall-answer-${card.id}`}
            lang={resolvedMode === 'target-to-native' ? translationLanguage : targetLanguage}
            value={answerInput}
            onChange={event => {
              setAnswerInput(event.target.value);
              setAnswerCorrect(null);
            }}
            autoComplete="off"
            spellCheck="false"
            placeholder={_(msg({ id: 'flashcard.recall.answer-placeholder', message: 'Type your answer…' }))}
            className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 text-base text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-none focus:ring-2 focus:ring-cyan-600/25"
          />
          <button
            type="submit"
            disabled={!answerInput.trim()}
            className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-xs font-black uppercase tracking-wider text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trans id="flashcard.recall.check" message="Check" />
          </button>
        </form>

        <p className={`min-h-5 text-sm font-bold ${answerCorrect === true ? 'text-emerald-700 dark:text-emerald-300' : answerCorrect === false ? 'text-rose-700 dark:text-rose-300' : 'text-[var(--sf-text-muted)]'}`} aria-live="polite">
          {answerCorrect === true ? <Trans id="flashcard.recall.correct" message="Correct. Reveal the answer to compare." /> : answerCorrect === false ? <Trans id="flashcard.recall.incorrect" message="Not quite. Try again or reveal the answer to check." /> : ''}
        </p>
      </div>

      <button
        type="button"
        onClick={onReveal}
        className="flex h-16 flex-shrink-0 items-center justify-center gap-2 bg-[var(--sf-brand)] text-xs font-black uppercase tracking-[0.15em] text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--sf-on-brand)]"
      >
        <Eye size={16} /> <Trans id="flashcard.recall.reveal" message="Reveal answer" />
      </button>
    </section>
  );
}
