import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react";
import {
  CheckCircle2,
  ChevronRight,
  ImageOff,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { GsapEntrance } from "../../components/motion/GsapEntrance";
import { Lumi } from "../../components/lumi/Lumi";
import { readLumiEnabled } from "../settings/lumi-preference";
import { useTheme } from "../theme/ThemeProvider";
import { isSupportedImageUrl } from "../../lib/images";
import { isQuizAnswerCorrect, type QuizQuestion } from "./practiceModel";

interface QuizViewProps {
  questions: QuizQuestion[];
  currentIndex: number;
  selectedAnswer: string | null;
  answeredCorrectly: boolean | null;
  score: number;
  showResults: boolean;
  onSelect: (answer: string) => void;
  onNext: () => void;
  onRestart: () => void;
  onClose: () => void;
}
export function languageName(language: string, locale: string) {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(language) ??
      language
    );
  } catch {
    return language;
  }
}

export function QuizView({
  questions,
  currentIndex,
  selectedAnswer,
  answeredCorrectly,
  score,
  showResults,
  onSelect,
  onNext,
  onRestart,
  onClose,
}: QuizViewProps) {
  const { i18n } = useLingui();
  const _ = (
    descriptor: ReturnType<typeof msg>,
    values?: Record<string, unknown>,
  ) => i18n._(descriptor.id, values);
  const showLumi = useTheme().family === "crystal" && readLumiEnabled();
  const question = questions[currentIndex];
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousShowResultsRef = useRef(showResults);
  useEffect(() => {
    const returnedFromResults = previousShowResultsRef.current && !showResults;
    previousShowResultsRef.current = showResults;
    if (showResults) return void resultsHeadingRef.current?.focus();
    if (selectedAnswer !== null) return void nextButtonRef.current?.focus();
    if (currentIndex > 0 || returnedFromResults)
      questionHeadingRef.current?.focus();
  }, [currentIndex, selectedAnswer, showResults]);
  if (!question && !showResults) return null;
  const accuracy = questions.length
    ? Math.round((score / questions.length) * 100)
    : 0;
  const targetLanguage = question?.card.language || "en";
  const nativeLanguage = question?.card.translationLanguage || "vi";
  const locale = i18n.locale || "en";
  const targetLanguageName = languageName(targetLanguage, locale);
  const nativeLanguageName = languageName(nativeLanguage, locale);
  const answerLanguage =
    question?.type === "target-to-native" ? nativeLanguage : targetLanguage;
  const questionPrompt =
    question?.type === "target-to-native" ? (
      <Trans
        id="practice.quiz.target-to-native-question"
        message="What does {word} mean in {nativeLanguageName}?"
        values={{
          word: <span lang={targetLanguage}>“{question.card.word}”</span>,
          nativeLanguageName,
        }}
      />
    ) : (
      <Trans
        id="practice.quiz.native-to-target-question"
        message="Which {targetLanguageName} word matches {translation}?"
        values={{
          targetLanguageName,
          translation: (
            <span lang={nativeLanguage}>
              “{question?.card.translation ?? ""}”
            </span>
          ),
        }}
      />
    );
  return (
    <div className="practice-board practice-board--quiz mx-auto flex max-w-6xl flex-col items-center py-4 sm:py-8">
      {showResults ? (
        <GsapEntrance
          animationKey="quiz-results"
          variant="result"
          className="crystal-chamfer w-full max-w-2xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-6 text-center text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] sm:p-8"
          aria-labelledby="quiz-results-heading"
        >
          <div
            data-color-role="reward"
            className="relative mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-amber-100 text-[var(--sf-reward)] dark:bg-amber-950/30"
            aria-hidden="true"
          >
            <Trophy size={44} />
            {showLumi && <Lumi pose="proud" size={58} className="crystal-ornament pointer-events-none absolute -bottom-2 -right-3 max-w-none drop-shadow-md" />}
          </div>
          <h2
            id="quiz-results-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="mb-2 text-balance text-3xl font-black tracking-tight focus-visible:outline-2"
          >
            <Trans id="practice.quiz.complete" message="Quiz complete" />
          </h2>
          <p className="mb-6 text-pretty text-sm font-medium text-[var(--sf-text-muted)]">
            <Trans
              id="practice.quiz.results-subtitle"
              message="Your vocabulary review results"
            />
          </p>
          <div className="mx-auto mb-8 grid max-w-sm grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4">
              <span className="block text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans
                  id="practice.results.correct-answers"
                  message="Correct answers"
                />
              </span>
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                {score} / {questions.length}
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4">
              <span className="block text-xs font-bold text-[var(--sf-text-muted)]">
                <Trans id="practice.results.accuracy" message="Accuracy" />
              </span>
              <span className="text-3xl font-black text-[var(--sf-brand-text)]">
                {accuracy}%
              </span>
            </div>
          </div>
          <div className="mx-auto mb-8 max-w-md rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-sm font-medium text-[var(--sf-text-muted)]">
            {score === questions.length ? (
              <Trans
                id="practice.results.perfect"
                message="Perfect. You answered every question correctly."
              />
            ) : score >= questions.length * 0.7 ? (
              <Trans
                id="practice.results.good"
                message="Great work. This vocabulary is becoming secure."
              />
            ) : (
              <Trans
                id="practice.results.keep-practising"
                message="Keep practising until the difficult words feel automatic."
              />
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              data-color-role="primary"
              type="button"
              onClick={onRestart}
              className="brand-action crystal-chamfer min-h-12 rounded-xl bg-[var(--sf-brand)] px-6 py-3 font-bold text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none"
            >
              <Trans id="practice.actions.try-again" message="Try again" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="crystal-chamfer min-h-12 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-6 py-3 font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none"
            >
              <Trans
                id="practice.actions.back-to-library"
                message="Back to library"
              />
            </button>
          </div>
        </GsapEntrance>
      ) : question ? (
        <div className="w-full">
          <div className="mb-6 flex items-center justify-between px-2">
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold text-[var(--sf-text-muted)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2"
            >
              <X size={18} aria-hidden="true" />
              <Trans id="practice.actions.exit" message="Exit" />
            </button>
            <div className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-1.5 text-xs font-bold text-[var(--sf-text)]">
              <Trans
                id="practice.score"
                message="Score: {score} / {total}"
                values={{ score, total: questions.length }}
              />
            </div>
          </div>
          <GsapEntrance
            animationKey={currentIndex}
            variant="step"
            onEntered={() => {
              if (currentIndex > 0 && selectedAnswer === null)
                questionHeadingRef.current?.focus();
            }}
            className="relative mb-6 grid gap-5 text-[var(--sf-text)] lg:grid-cols-[minmax(19rem,.78fr)_minmax(26rem,1.22fr)] lg:items-center lg:gap-8"
            aria-labelledby="quiz-question-heading"
          >
            <div className="absolute right-4 top-4 max-w-40 break-words rounded-xl bg-[var(--sf-brand)] px-2.5 py-1 text-center text-xs font-black uppercase tracking-wider text-[var(--sf-on-brand)]">
              {question.card.category}
            </div>
            {isSupportedImageUrl(question.card.imageUrl) ? (
              <div className="absolute left-6 top-6 z-10 size-16 overflow-hidden rounded-2xl shadow-md">
                <img
                  src={question.card.imageUrl!}
                  alt={_(
                    msg({
                      id: "practice.quiz.illustration-alt",
                      message: "Illustration for {word}",
                    }),
                    { word: question.card.word },
                  )}
                  width={80}
                  height={80}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div
                className="absolute left-6 top-6 z-10 flex size-16 items-center justify-center rounded-2xl bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]"
                aria-hidden="true"
              >
                <ImageOff size={28} />
              </div>
            )}
            <div className="crystal-chamfer flex min-h-64 w-full flex-col justify-end rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-6 pt-24 shadow-[var(--sf-panel-shadow)] sm:min-h-80 sm:p-8 sm:pt-28">
              <span className="mb-2 block font-display text-xs font-bold uppercase tracking-[.12em] text-[var(--sf-text-muted)]">
                <Trans
                  id="practice.question-progress"
                  message="Question {current} / {total}"
                  values={{
                    current: currentIndex + 1,
                    total: questions.length,
                  }}
                />
              </span>
              <h3
                id="quiz-question-heading"
                ref={questionHeadingRef}
                tabIndex={-1}
                className="text-balance text-2xl font-extrabold leading-tight focus-visible:outline-2 sm:text-4xl"
              >
                {questionPrompt}
              </h3>
            </div>
            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {selectedAnswer !== null &&
                (answeredCorrectly ? (
                  <Trans
                    id="practice.feedback.correct"
                    message="Correct answer."
                  />
                ) : (
                  <>
                    <Trans
                      id="practice.feedback.incorrect-prefix"
                      message="Incorrect. The correct answer is"
                    />{" "}
                    <span lang={answerLanguage}>
                      “{question.correctAnswer}”.
                    </span>
                  </>
                ))}
            </p>
            <fieldset className="min-w-0 w-full lg:self-center">
              <legend className="mb-3 font-display text-xs font-bold uppercase tracking-[.12em] text-[var(--sf-text-muted)]">
                <Trans
                  id="practice.quiz.choose-answer"
                  message="Choose one answer"
                />
              </legend>
              <div className="grid grid-cols-1 gap-3">
                {question.options.map((option, optionIndex) => {
                  const correct = isQuizAnswerCorrect(question, option);
                  const selected = selectedAnswer === option;
                  const answered = selectedAnswer !== null;
                  const style = answered
                    ? correct
                      ? "border-emerald-500 bg-emerald-50 font-extrabold text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400"
                      : selected
                        ? "border-rose-500 bg-rose-50 font-extrabold text-rose-700 dark:bg-rose-950/20 dark:text-rose-400"
                        : "cursor-not-allowed border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]"
                    : "border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text)] hover:border-[var(--sf-brand)]";
                  return (
                    <button
                      type="button"
                      key={option}
                      lang={answerLanguage}
                      onClick={() => onSelect(option)}
                      disabled={answered}
                      aria-pressed={selected}
                      className={`crystal-chamfer flex min-h-[4.75rem] min-w-0 w-full items-center justify-between gap-3 rounded-xl border-2 p-4 text-left text-lg font-semibold capitalize transition-colors focus-visible:outline-2 motion-reduce:transition-none ${style}`}
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-current/20 text-xs font-black"
                      >
                        {optionIndex + 1}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
                        {option}
                      </span>
                      {answered && correct && (
                        <CheckCircle2
                          size={16}
                          className="shrink-0 text-emerald-500"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {selectedAnswer !== null && (
              <GsapEntrance
                animationKey={`${currentIndex}-feedback`}
                variant="feedback"
                className="flex w-full flex-col items-center gap-4 border-t border-[var(--sf-border)] pt-5 text-center lg:col-start-2"
              >
                <div aria-hidden="true">
                  {answeredCorrectly ? (
                    <span className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={17} />
                      <Trans
                        id="practice.feedback.correct-short"
                        message="Correct"
                      />
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
                      <XCircle size={17} />
                      <Trans
                        id="practice.feedback.correct-answer"
                        message="The correct answer is"
                      />{" "}
                      <span
                        lang={answerLanguage}
                        className="font-black capitalize underline"
                      >
                        “{question.correctAnswer}”
                      </span>
                    </span>
                  )}
                </div>
                <button
                  data-color-role="primary"
                  ref={nextButtonRef}
                  type="button"
                  onClick={onNext}
                  className="brand-action crystal-chamfer flex min-h-11 items-center gap-1 rounded-xl bg-[var(--sf-brand)] px-6 py-2.5 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none"
                >
                  {currentIndex === questions.length - 1 ? (
                    <Trans
                      id="practice.actions.view-results"
                      message="View results"
                    />
                  ) : (
                    <Trans id="practice.actions.next" message="Next" />
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
              msg({ id: "practice.quiz.progress", message: "Quiz progress" }),
            )}
            aria-valuemin={0}
            aria-valuemax={questions.length}
            aria-valuenow={currentIndex + (selectedAnswer !== null ? 1 : 0)}
          >
            <div
              className="h-full w-full origin-left bg-[var(--sf-brand)] transition-transform duration-200 motion-reduce:transition-none"
              style={{
                transform: `scaleX(${(currentIndex + (selectedAnswer !== null ? 1 : 0)) / questions.length})`,
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
