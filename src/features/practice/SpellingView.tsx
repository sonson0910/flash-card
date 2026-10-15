import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react";
import { useEffect, useRef, type FormEvent } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Trophy,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import { GsapEntrance } from "../../components/motion/GsapEntrance";
import { Lumi } from "../../components/lumi/Lumi";
import { readLumiEnabled } from "../settings/lumi-preference";
import { useFocusModePreference } from "../settings/focus-mode-preference";
import { useTheme } from "../theme/ThemeProvider";
import { playWordAudio, type WordAudioPlayback } from "../../lib/audio";
import { voiceForActiveCourseCard } from "../../lib/courseVoicePreference";
import { createImeSubmitGuard } from "../../lib/imeSubmitGuard";
import { speechLocaleFor } from "../../lib/speechLocale";
import type { CardData } from "../../types/card";
import { useCourseSession } from "../courses/CourseGate";

interface SpellingViewProps {
  cards: CardData[];
  currentIndex: number;
  input: string;
  checked: boolean;
  correct: boolean;
  score: number;
  showResults: boolean;
  savingResult?: boolean;
  onInput: (value: string) => void;
  onCheck: (event: FormEvent) => void;
  onNext: () => void;
  onRestart: () => void;
  onClose: () => void;
  onLearnFirst?: () => void;
}

export function SpellingView({
  cards,
  currentIndex,
  input,
  checked,
  correct,
  score,
  showResults,
  savingResult = false,
  onInput,
  onCheck,
  onNext,
  onRestart,
  onClose,
  onLearnFirst,
}: SpellingViewProps) {
  const { i18n } = useLingui();
  const { model: courseModel } = useCourseSession();
  const _ = (
    descriptor: ReturnType<typeof msg>,
    values?: Record<string, unknown>,
  ) => i18n._(descriptor.id, values);
  const showLumi = useTheme().family === "crystal" && readLumiEnabled();
  const { focusModeEnabled } = useFocusModePreference();
  const answeredCount = currentIndex + (checked ? 1 : 0);
  const card = cards[currentIndex];
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousShowResultsRef = useRef(showResults);
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);
  const imeSubmitGuard = useRef(createImeSubmitGuard()).current;

  useEffect(() => () => audioPlaybackRef.current?.cancel(), []);

  useEffect(() => {
    audioPlaybackRef.current?.cancel();
    audioPlaybackRef.current = null;
  }, [card?.id, showResults]);

  const playPronunciation = () => {
    audioPlaybackRef.current?.cancel();
    const voice = voiceForActiveCourseCard(card, courseModel.activeCourse);
    audioPlaybackRef.current = playWordAudio(card.word, card.audioUrl, speechLocaleFor(card), voice);
  };

  const close = () => {
    audioPlaybackRef.current?.cancel();
    onClose();
  };
  const check = (event: FormEvent) => {
    if (imeSubmitGuard.shouldBlockSubmit(event.nativeEvent as Event & { isComposing?: boolean; keyCode?: number })) {
      event.preventDefault();
      return;
    }
    onCheck(event);
  };


  useEffect(() => {
    const returnedFromResults = previousShowResultsRef.current && !showResults;
    previousShowResultsRef.current = showResults;
    if (showResults) {
      resultsHeadingRef.current?.focus();
      return;
    }
    if (checked) {
      nextButtonRef.current?.focus();
      return;
    }
    if (currentIndex > 0 || returnedFromResults)
      questionHeadingRef.current?.focus();
  }, [checked, currentIndex, showResults]);

  if (!card && !showResults) return null;
  const accuracy =
    cards.length > 0 ? Math.round((score / cards.length) * 100) : 0;
  const targetLanguage = card?.language || "en";
  const nativeLanguage = card?.translationLanguage || "vi";
  const targetLanguageName =
    new Intl.DisplayNames([i18n.locale], { type: "language" }).of(
      targetLanguage,
    ) || targetLanguage;
  return (
    <div className="practice-board practice-board--spelling mx-auto flex max-w-6xl flex-col items-center py-4 sm:py-8">
      {showResults ? (
        <GsapEntrance
          animationKey="spelling-results"
          variant="result"
          className="w-full max-w-2xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-center text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8"
          aria-labelledby="spelling-results-heading"
        >
          <div
            data-color-role="reward"
            className="relative mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-amber-100 text-[var(--sf-reward)] dark:bg-amber-950/30"
            aria-hidden="true"
          >
            <Trophy size={40} />
            {showLumi && <Lumi pose="proud" size={58} className="crystal-ornament pointer-events-none absolute -bottom-2 -right-3 max-w-none drop-shadow-md" />}
          </div>
          <h2
            id="spelling-results-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="mb-2 text-balance text-3xl font-black tracking-tight focus-visible:outline-2"
          >
            <Trans {...msg({ context: 'practice.spelling.complete', message: 'Complete' })} />
          </h2>
          <p className="text-pretty text-sm text-[var(--sf-text-muted)] mb-6 font-medium">
            <Trans
              {...msg({ context: 'practice.spelling.results-subtitle', message: 'Your spelling practice results' })}
            />
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4">
              <span className="block text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans
                  {...msg({ context: 'practice.results.correct-answers', message: 'Correct answers' })}
                />
              </span>
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                {score} / {cards.length}
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4">
              <span className="block text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans {...msg({ context: 'practice.results.accuracy', message: 'Accuracy' })} />
              </span>
              <span className="text-3xl font-black text-[var(--sf-brand-text)]">
                {accuracy}%
              </span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              data-color-role="primary"
              type="button"
              onClick={onRestart}
              className="min-h-12 rounded-xl bg-[var(--sf-brand)] px-6 py-3 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none"
            >
              <Trans {...msg({ context: 'practice.actions.try-again', message: 'Try again' })} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-12 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-6 py-3 font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none"
            >
              <Trans
                {...msg({ context: 'practice.actions.back-to-library', message: 'Back to library' })}
              />
            </button>
          </div>
        </GsapEntrance>
      ) : card ? (
        <div className="w-full">
          <div className="mb-6 flex items-center justify-between px-2">
            <button
              type="button"
              onClick={close}
              className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold text-[var(--sf-text-muted)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2"
            >
              <X size={18} aria-hidden="true" />{" "}
              <Trans {...msg({ context: 'practice.actions.exit', message: 'Exit' })} />
            </button>
            {!focusModeEnabled && answeredCount >= 2 && <span data-practice-combo={answeredCount} className="rounded-full border border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] px-3 py-1.5 text-xs font-black text-[var(--sf-brand-text)]"><Trans {...msg({ context: 'study.combo', message: 'Combo ×{count}' })} values={{ count: answeredCount }} /></span>}
            <div className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-1.5 text-xs font-bold text-[var(--sf-text)]">
              <Trans
                {...msg({ context: 'practice.score', message: 'Score: {score} / {total}' })}
                values={{ score, total: cards.length }}
              />
            </div>
          </div>
          <GsapEntrance
            animationKey={currentIndex}
            variant="step"
            onEntered={() => {
              if (currentIndex > 0 && !checked)
                questionHeadingRef.current?.focus();
            }}
            className="crystal-chamfer relative mx-auto mb-6 flex min-h-[25rem] w-full max-w-2xl flex-col items-center justify-center overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-5 text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] sm:p-8"
            aria-labelledby="spelling-question-heading"
          >
            <div className="absolute right-4 top-4 max-w-40 break-words rounded-xl bg-[var(--sf-brand)] px-2.5 py-1 text-center text-xs font-black uppercase tracking-wider text-[var(--sf-on-brand)]">
              {card.category}
            </div>
            <div className="w-full max-w-xl text-center">
              <span className="mb-4 block text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans
                  {...msg({ context: 'practice.question-progress', message: 'Question {current} / {total}' })}
                  values={{ current: currentIndex + 1, total: cards.length }}
                />
              </span>
              <button
                type="button"
                onClick={playPronunciation}
                className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full border-8 border-[color-mix(in_srgb,var(--sf-brand)_16%,transparent)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-[0_0_0_12px_color-mix(in_srgb,var(--sf-brand)_8%,transparent)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 motion-reduce:transition-none"
                aria-label={_(
                  msg({
                    id: "practice.spelling.play-pronunciation",
                    message: "Play pronunciation for {word}",
                  }),
                  { word: card.word },
                )}
              >
                <Volume2 size={32} aria-hidden="true" />
              </button>
              <h3
                id="spelling-question-heading"
                ref={questionHeadingRef}
                tabIndex={-1}
                lang={nativeLanguage}
                className="text-balance text-3xl font-extrabold tracking-tight focus-visible:outline-2 sm:text-4xl"
              >
                {card.translation}
              </h3>
            </div>
            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {checked &&
                (correct ? (
                  <Trans
                    {...msg({ id: 'practice.feedback.correct', message: 'Correct answer.' })}
                  />
                ) : (
                  <>
                    <Trans
                      {...msg({ context: 'practice.feedback.incorrect-prefix', message: 'Incorrect. The correct answer is' })}
                    />{" "}
                    <span lang={targetLanguage}>“{card.word}”.</span>
                  </>
                ))}
            </p>
{onLearnFirst && <button type="button" onClick={onLearnFirst} className="my-4 min-h-11 rounded-xl border border-[var(--sf-border)] px-4 py-2 font-bold"><Trans {...msg({ context: 'practice.learn-first', message: 'I don\'t know this — learn first' })} /></button>}
            <form onSubmit={check} className="mt-8 w-full max-w-xl">
              <input
                name="spelling-answer"
                type="text"
                lang={targetLanguage}
                disabled={checked}
                value={input}
                onChange={(event) => onInput(event.target.value)}
                onCompositionStart={imeSubmitGuard.onCompositionStart}
                onCompositionEnd={imeSubmitGuard.onCompositionEnd}
                onKeyDown={(event) => {
                  if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault();
                }}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={_(
                  msg({
                    id: "practice.spelling.answer-placeholder",
                    message: "Type the {targetLanguage} word…",
                  }),
                  { targetLanguage: targetLanguageName },
                )}
                aria-label={_(
                  msg({
                    id: "practice.spelling.answer-label",
                    message: "Type the {targetLanguage} word",
                  }),
                  { targetLanguage: targetLanguageName },
                )}
                className={`min-h-16 w-full rounded-xl border-2 bg-[var(--sf-surface-raised)] p-4 text-center text-2xl font-bold tracking-[.22em] text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 ${checked ? (correct ? "border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400" : "border-rose-500 bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400") : "border-[var(--sf-border)]"}`}
              />
            </form>
            {checked && (
              <GsapEntrance
                animationKey={`${currentIndex}-feedback`}
                variant="feedback"
                className="mt-6 flex w-full flex-col items-center justify-between gap-4 rounded-xl bg-[var(--sf-surface-raised)] p-4 sm:flex-row"
              >
                <div aria-hidden="true">
                  {correct ? (
                    <span className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={17} />{" "}
                      <Trans {...msg({ context: 'practice.spelling.correct', message: 'Correct' })} />
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
                      <XCircle size={17} />{" "}
                      <Trans
                        {...msg({ context: 'practice.spelling.answer-is', message: 'The answer is' })}
                      />{" "}
                      <span
                        className="font-black underline"
                        lang={targetLanguage}
                      >
                        {card.word}
                      </span>
                    </span>
                  )}
                </div>
                <button
                  data-color-role="primary"
                  ref={nextButtonRef}
                  type="button"
                  onClick={onNext}
                  disabled={savingResult}
                  aria-busy={savingResult}
                  className="flex min-h-11 items-center gap-1 rounded-xl bg-[var(--sf-brand)] px-6 py-2.5 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none"
                >
                  {savingResult ? (
                    <Trans {...msg({ context: 'practice.actions.saving-result', message: 'Saving result…' })} />
                  ) : currentIndex === cards.length - 1 ? (
                    <Trans
                      {...msg({ context: 'practice.actions.view-results', message: 'View results' })}
                    />
                  ) : (
                    <Trans {...msg({ context: 'practice.actions.next', message: 'Next' })} />
                  )}{" "}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </GsapEntrance>
            )}
          </GsapEntrance>
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-[var(--sf-surface-raised)]"
            role="progressbar"
            aria-label={_(
              msg({
                id: "practice.spelling.progress",
                message: "Spelling progress",
              }),
            )}
            aria-valuemin={0}
            aria-valuemax={cards.length}
            aria-valuenow={currentIndex + (checked ? 1 : 0)}
          >
            <div
              className="h-full w-full origin-left bg-[var(--sf-brand)] transition-transform duration-200 motion-reduce:transition-none"
              style={{
                transform: `scaleX(${(currentIndex + (checked ? 1 : 0)) / cards.length})`,
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
