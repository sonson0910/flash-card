import { Eye, Image as ImageIcon, Star, Volume2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CardData } from '../../types/card';
import { buildRecallPrompt, isRecallAnswerCorrect, resolveRecallMode, type RecallMode } from '../../lib/recall';
import { isSupportedImageUrl } from '../../lib/images';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import { CardImage } from './CardImage';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import { voiceForActiveCourseCard } from '../../lib/courseVoicePreference';
import { speechLocaleFor } from '../../lib/speechLocale';
import { useCourseSession } from '../../features/courses/CourseGate';
import { useCardLook } from './cardLook';
import './flashcard-canvas.css';

interface ActiveRecallPromptProps {
  card: CardData;
  mode: RecallMode;
  onReveal: () => void;
  onImageUnavailable?: () => void;
}

export function ActiveRecallPrompt({ card, mode, onReveal, onImageUnavailable }: ActiveRecallPromptProps) {
  const { _, i18n } = useLingui();
  const { model: courseModel } = useCourseSession();
  const look = useCardLook();
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
  const imeSubmitGuard = useRef(createImeSubmitGuard()).current;

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
    // Enter that confirms an IME candidate must not grade the half-typed answer.
    if (imeSubmitGuard.shouldBlockSubmit(event.nativeEvent as SubmitEvent & { isComposing?: boolean; keyCode?: number })) return;
    if (!answerInput.trim()) return;
    setAnswerCorrect(isRecallAnswerCorrect(answerInput, prompt.answer));
  };

  return (
    <section
      data-active-recall
      data-card-look={look}
      className="flashcard-recall group mx-auto flex h-[clamp(300px,60dvh,480px)] w-full max-w-[460px] flex-col overflow-hidden"
      aria-labelledby="recall-instruction"
    >
      <div className="flashcard-recall-head shrink-0">
        <p id="recall-instruction" className="flashcard-recall-instruction">
          {prompt.instruction}
        </p>
      </div>

      <div className="flashcard-recall-body flex flex-1 flex-col items-center justify-[safe_center] gap-4 overflow-y-auto text-center">
        {prompt.showImage ? (
          imageUrl ? (
            <div className="flashcard-recall-image h-52 w-full max-w-sm overflow-hidden">
              <CardImage
                src={imageUrl}
                alt={_(msg({ id: 'flashcard.image.illustration', message: 'Illustration for {word}' }).id, { word: card.word })}
                priority
                onUnavailable={onImageUnavailable}
              />
            </div>
          ) : (
            <div className="flashcard-recall-image flex h-44 w-44 items-center justify-center border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]" role="img" aria-label={_(msg({ id: 'flashcard.recall.no-illustration', message: 'No illustration available' }))}>
              <ImageIcon size={48} strokeWidth={1.5} aria-hidden="true" />
            </div>
          )
        ) : prompt.playAudio ? (
          <button
            type="button"
            onClick={playPrompt}
            className="flashcard-recall-audio flex size-28 items-center justify-center transition-transform hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none"
            aria-label={_(msg({ id: 'flashcard.recall.play-word', message: 'Play word for listening practice' }))}
          >
            <Volume2 size={46} aria-hidden="true" />
          </button>
        ) : (
          <h2 lang={resolvedMode === 'native-to-target' ? translationLanguage : targetLanguage} className="flashcard-recall-prompt text-balance break-words [overflow-wrap:anywhere]">{prompt.promptText}</h2>
        )}

        <p className="flashcard-recall-hint"><Trans {...msg({ context: 'flashcard.recall.instructions', message: 'Recall first, then type your answer to check it.' })} /></p>

        <form onSubmit={checkAnswer} className="flex w-full max-w-sm gap-2" aria-label={_(msg({ id: 'flashcard.recall.check-answer', message: 'Check recalled answer' }))}>
          <label htmlFor={`recall-answer-${card.id}`} className="sr-only"><Trans {...msg({ context: 'flashcard.recall.answer', message: 'Your answer' })} /></label>
          <input
            id={`recall-answer-${card.id}`}
            lang={resolvedMode === 'target-to-native' ? translationLanguage : targetLanguage}
            value={answerInput}
            onChange={event => {
              setAnswerInput(event.target.value);
              setAnswerCorrect(null);
            }}
            onCompositionStart={imeSubmitGuard.onCompositionStart}
            onCompositionEnd={imeSubmitGuard.onCompositionEnd}
            onKeyDown={event => { if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault(); }}
            autoComplete="off"
            spellCheck="false"
            placeholder={_(msg({ id: 'flashcard.recall.answer-placeholder', message: 'Type your answer…' }))}
            className="flashcard-recall-input min-h-11 min-w-0 flex-1 px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
          />
          <button
            type="submit"
            disabled={!answerInput.trim()}
            className="flashcard-recall-check min-h-11 px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none"
          >
            <Trans {...msg({ context: 'flashcard.recall.check', message: 'Check' })} />
          </button>
        </form>

        <p className={`min-h-5 text-sm font-semibold ${answerCorrect === true ? 'text-[var(--sf-success)]' : answerCorrect === false ? 'text-[var(--sf-danger)]' : 'text-[var(--sf-text-muted)]'}`} aria-live="polite">
          {answerCorrect === true ? <Trans {...msg({ context: 'flashcard.recall.correct', message: 'Correct. Reveal the answer to compare.' })} /> : answerCorrect === false ? <Trans {...msg({ context: 'flashcard.recall.incorrect', message: 'Not quite. Try again or reveal the answer to check.' })} /> : ''}
        </p>
      </div>

      <div className="flashcard-reveal-dock shrink-0">
        <button
          type="button"
          onClick={onReveal}
          className="flashcard-reveal group/flip relative flex min-h-[58px] w-full cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--sf-brand)]"
        >
          {look === 'aurora' && <span className="flashcard-reveal-laser pointer-events-none absolute" aria-hidden="true" />}
          {look === 'crystal' && <span className="flashcard-reveal-shine pointer-events-none absolute" aria-hidden="true" />}
          {look === 'crystal'
            ? <Star size={18} className="relative fill-current" aria-hidden="true" />
            : look === 'aurora' && <Eye size={16} className="relative" aria-hidden="true" />}
          <span className="relative"><Trans {...msg({ context: 'flashcard.recall.reveal', message: 'Reveal answer' })} /></span>
          {look === 'paper' && <span className="flashcard-reveal-rule" aria-hidden="true" />}
          <kbd className="flashcard-kbd relative font-mono" aria-hidden="true"><Trans {...msg({ context: 'flashcard.shortcut.space', message: 'Space' })} /></kbd>
        </button>
      </div>
    </section>
  );
}
