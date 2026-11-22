import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react";
import { ArrowRight, Check, Trophy, X, Zap } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { headwordStressParts } from "../../components/flashcard/CardHeadword";
import { GsapEntrance } from "../../components/motion/GsapEntrance";
import { Lumi } from "../../components/lumi/Lumi";
import { isSupportedImageUrl } from "../../lib/images";
import { parseSyllables } from "../../lib/syllableParser";
import type { CardData } from "../../types/card";
import { getLibraryCardTier } from "../library/libraryViewModel";
import { useFocusModePreference } from "../settings/focus-mode-preference";
import { EnterKeyHint, LumiCoach, PracticeCount, PracticeTopBar, practiceSegments, useCrystalLumi } from "./practice-board-parts";
import { isQuizAnswerCorrect, type QuizQuestion } from "./practiceModel";
import { moveFocus } from "./practice-focus";
import "./practice-board.css";

interface QuizViewProps {
  questions: QuizQuestion[];
  currentIndex: number;
  selectedAnswer: string | null;
  answeredCorrectly: boolean | null;
  score: number;
  /** Real per-question results so far, indexed like `questions`. */
  outcomes?: readonly boolean[];
  showResults: boolean;
  savingResult?: boolean;
  onSelect: (answer: string) => void;
  onNext: () => void;
  onRestart: () => void;
  onClose: () => void;
  onLearnFirst?: () => void;
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

/** Times the learner has reviewed a card, from whichever review record the card carries. */
export function cardReviewCount(card: CardData) {
  return card.reviews ?? card.reviewHistory?.length ?? card.fsrs?.reps ?? 0;
}

/** Splits an example sentence around the first whole-word use of `word`. */
export function splitExample(sentence: string, word: string) {
  const target = word.trim();
  if (!target) return null;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "iu").exec(sentence);
  if (!match) return null;
  const start = match.index + match[1].length;
  return { before: sentence.slice(0, start), match: match[2], after: sentence.slice(start + match[2].length) };
}

/** The prompt headword with the board's accent: the stressed syllable, or the last word of a phrase. */
export function PromptWord({ card, text }: { card: CardData; text: string }) {
  const stress = text === card.word ? headwordStressParts(card) : null;
  if (stress) return <>{stress.stressed}<em>{stress.rest}</em></>;
  const words = text.trim().split(/\s+/);
  if (words.length > 1) return <>{words.slice(0, -1).join(" ")} <em>{words[words.length - 1]}</em></>;
  return <>{text}</>;
}

function TierLine({ card }: { card: CardData }) {
  const tier = getLibraryCardTier(card);
  const seen = cardReviewCount(card);
  return (
    <p className="practice-prompt__state" data-tier={tier}>
      <span aria-hidden="true" className="practice-prompt__dot" />
      {tier === "new" ? (
        <Trans {...msg({ context: "practice.card-state.new", message: "New word" })} />
      ) : tier === "mastered" ? (
        <Trans {...msg({ context: "practice.card-state.mastered", message: "Mastered" })} />
      ) : (
        <Trans {...msg({ context: "practice.card-state.learning", message: "Learning" })} />
      )}
      {seen > 0 && (
        <>
          {" · "}
          <Trans
            {...msg({ context: "practice.card-state.seen", message: "{count, plural, one {seen # time} other {seen # times}}" })}
            values={{ count: seen }}
          />
        </>
      )}
    </p>
  );
}

export function QuizView({
  questions,
  currentIndex,
  selectedAnswer,
  answeredCorrectly,
  score,
  outcomes,
  showResults,
  savingResult = false,
  onSelect,
  onNext,
  onRestart,
  onClose,
  onLearnFirst,
}: QuizViewProps) {
  const { i18n } = useLingui();
  const _ = (
    descriptor: ReturnType<typeof msg>,
    values?: Record<string, unknown>,
  ) => i18n._(descriptor.id, values, { message: descriptor.message });
  const showLumi = useCrystalLumi();
  const { focusModeEnabled } = useFocusModePreference();
  const answeredCount = currentIndex + (selectedAnswer === null ? 0 : 1);
  const question = questions[currentIndex];
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousShowResultsRef = useRef(showResults);
  useEffect(() => {
    const returnedFromResults = previousShowResultsRef.current && !showResults;
    previousShowResultsRef.current = showResults;
    if (showResults) return void moveFocus(resultsHeadingRef.current);
    if (selectedAnswer !== null) return void moveFocus(nextButtonRef.current);
    if (currentIndex > 0 || returnedFromResults)
      moveFocus(questionHeadingRef.current);
  }, [currentIndex, selectedAnswer, showResults]);
  useEffect(() => {
    if (showResults || !question) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (selectedAnswer === null) {
        const option = /^[1-9]$/.test(event.key) ? question.options[Number(event.key) - 1] : undefined;
        if (option === undefined) return;
        event.preventDefault();
        onSelect(option);
        return;
      }
      if (event.key === "Enter" && !target?.closest?.("button, a")) {
        event.preventDefault();
        if (!savingResult) onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNext, onSelect, question, savingResult, selectedAnswer, showResults]);
  if (!question && !showResults) return null;
  const accuracy = questions.length
    ? Math.round((score / questions.length) * 100)
    : 0;
  const targetLanguage = question?.card.language || "en";
  const nativeLanguage = question?.card.translationLanguage || "vi";
  const locale = i18n.locale || "en";
  const targetLanguageName = languageName(targetLanguage, locale);
  const nativeLanguageName = languageName(nativeLanguage, locale);
  const targetToNative = question?.type === "target-to-native";
  const answerLanguage = targetToNative ? nativeLanguage : targetLanguage;
  const promptLanguage = targetToNative ? targetLanguage : nativeLanguage;
  const answered = selectedAnswer !== null;
  const questionPrompt =
    targetToNative ? (
      <Trans
        {...msg({ id: 'practice.quiz.target-to-native-question', message: 'What does {word} mean in {nativeLanguageName}?' })}
        values={{
          word: <span lang={targetLanguage}>“{question.card.word}”</span>,
          nativeLanguageName,
        }}
      />
    ) : (
      <Trans
        {...msg({ id: 'practice.quiz.native-to-target-question', message: 'Which {targetLanguageName} word matches {translation}?' })}
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
  let streak = 0;
  if (outcomes) for (let index = answeredCount - 1; index >= 0 && outcomes[index] === true; index -= 1) streak += 1;
  const segments = practiceSegments(questions.length, answeredCount, outcomes);
  const card = question?.card;
  const example = card?.exampleSentence?.trim() ? card.exampleSentence.trim() : "";
  const exampleParts = card && example ? splitExample(example, card.word) : null;
  const syllables = card && targetLanguage === "en" ? parseSyllables(card.word, card.phonetic) : null;
  const explanationWord = syllables?.hasMultipleSyllables ? syllables.syllables.map(part => part.text).join("·") : card?.word;
  const hasExplanation = Boolean(card && (card.explanation?.trim() || card.phonetic?.trim()));
  const meta = [card?.partOfSpeech?.trim(), targetLanguage === "en" ? card?.phonetic?.trim() : ""].filter(Boolean) as string[];
  let coach: { pose: "thinking" | "happy" | "oops"; heading: ReactNode; body?: ReactNode } | null = null;
  if (showLumi && card) {
    coach = !answered
      ? { pose: "thinking", heading: <Trans {...msg({ context: "practice.quiz.lumi.ask", message: "Which one fits?" })} /> }
      : answeredCorrectly
        ? { pose: "happy", heading: <Trans {...msg({ context: "practice.quiz.lumi.right", message: "That's it!" })} />, body: <><span lang={targetLanguage}>{card.word}</span> = <span lang={nativeLanguage}>{card.translation}</span></> }
        : { pose: "oops", heading: <Trans {...msg({ context: "practice.quiz.lumi.almost", message: "Almost!" })} />, body: <><span lang={targetLanguage}>{card.word}</span> = <span lang={nativeLanguage}>{card.translation}</span></> };
  }
  return (
    <div className="practice-board practice-board--quiz practice-stage" data-practice-mode="quiz">
      {showResults ? (
        <GsapEntrance
          animationKey="quiz-results"
          variant="result"
          className="practice-results crystal-chamfer surface-glass"
          aria-labelledby="quiz-results-heading"
        >
          <div
            data-color-role="reward"
            className="practice-results__medal"
            aria-hidden="true"
          >
            <Trophy size={44} />
            {showLumi && <Lumi pose="proud" size={58} className="crystal-ornament pointer-events-none absolute -bottom-2 -right-3 max-w-none drop-shadow-md" />}
          </div>
          <h2
            id="quiz-results-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="practice-results__title focus-visible:outline-2"
          >
            <Trans {...msg({ context: 'practice.quiz.complete', message: 'Quiz complete' })} />
          </h2>
          <p className="practice-results__subtitle">
            <Trans
              {...msg({ context: 'practice.quiz.results-subtitle', message: 'Your vocabulary review results' })}
            />
          </p>
          <div className="practice-results__stats">
            <div>
              <span>
                <Trans
                  {...msg({ context: 'practice.results.correct-answers', message: 'Correct answers' })}
                />
              </span>
              <b data-tone="good">
                {score} / {questions.length}
              </b>
            </div>
            <div>
              <span>
                <Trans {...msg({ context: 'practice.results.accuracy', message: 'Accuracy' })} />
              </span>
              <b data-tone="brand">
                {accuracy}%
              </b>
            </div>
          </div>
          <p className="practice-results__note">
            {score === questions.length ? (
              <Trans
                {...msg({ context: 'practice.results.perfect', message: 'Perfect. You answered every question correctly.' })}
              />
            ) : score >= questions.length * 0.7 ? (
              <Trans
                {...msg({ context: 'practice.results.good', message: 'Great work. This vocabulary is becoming secure.' })}
              />
            ) : (
              <Trans
                {...msg({ context: 'practice.results.keep-practising', message: 'Keep practising until the difficult words feel automatic.' })}
              />
            )}
          </p>
          <div className="practice-results__actions">
            <button
              data-color-role="primary"
              type="button"
              onClick={onRestart}
              className="practice-primary crystal-chamfer-sm min-h-12 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
            >
              <Trans {...msg({ context: 'practice.actions.try-again', message: 'Try again' })} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="practice-secondary crystal-chamfer-sm min-h-12 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
            >
              <Trans
                {...msg({ context: 'practice.actions.back-to-library', message: 'Back to library' })}
              />
            </button>
          </div>
        </GsapEntrance>
      ) : question && card ? (
        <>
          <PracticeTopBar
            closeLabel={<Trans {...msg({ context: 'practice.actions.exit', message: 'Exit' })} />}
            onClose={onClose}
            mode={<Trans {...msg({ context: 'practice.quiz.mode', message: 'Quiz' })} />}
            detail={targetLanguageName}
            progressLabel={_(msg({ id: "practice.quiz.progress", message: "Quiz progress" }))}
            segments={segments}
            progressValue={answeredCount}
            chip={!focusModeEnabled && answeredCount >= 2 ? (
              <span data-practice-combo={answeredCount} className="practice-chip">
                <Zap size={14} aria-hidden="true" />
                <Trans {...msg({ context: 'study.combo', message: 'Combo ×{count}' })} values={{ count: answeredCount }} />
              </span>
            ) : undefined}
            count={<PracticeCount current={answeredCount} total={questions.length} />}
          />
          <p className="sr-only">
            <Trans
              {...msg({ context: 'practice.score', message: 'Score: {score} / {total}' })}
              values={{ score, total: questions.length }}
            />
            {streak >= 2 && <>{" "}<Trans {...msg({ context: 'practice.quiz.streak', message: '{count} in a row' })} values={{ count: streak }} /></>}
          </p>
          <GsapEntrance
            animationKey={currentIndex}
            variant="step"
            onEntered={() => {
              if (currentIndex > 0 && selectedAnswer === null)
                moveFocus(questionHeadingRef.current);
            }}
            className="practice-quiz"
            data-lumi={coach ? "true" : undefined}
            aria-labelledby="quiz-question-heading"
          >
            {coach && (
              <LumiCoach pose={coach.pose} heading={coach.heading} className="practice-quiz__lumi">
                {coach.body}
              </LumiCoach>
            )}
            <section data-quiz-question-panel className="practice-prompt crystal-chamfer" aria-label={_(msg({ id: "practice.quiz.prompt-card", message: "Prompt card" }))}>
              <div className="practice-prompt__top">
                <p className="practice-prompt__direction">
                  <span>{targetToNative ? targetLanguageName : nativeLanguageName}</span>
                  <ArrowRight size={13} aria-hidden="true" />
                  <span data-accent>{targetToNative ? nativeLanguageName : targetLanguageName}</span>
                </p>
                <span className="practice-prompt__badge">{card.category}</span>
              </div>
              {isSupportedImageUrl(card.imageUrl) && (
                <img
                  src={card.imageUrl!}
                  alt={_(
                    msg({
                      id: "practice.quiz.illustration-alt",
                      message: "Illustration for {word}",
                    }),
                    { word: card.word },
                  )}
                  width={80}
                  height={80}
                  className="practice-prompt__image"
                />
              )}
              <p className="practice-prompt__word" lang={promptLanguage}>
                <PromptWord card={card} text={targetToNative ? card.word : card.translation} />
              </p>
              {meta.length > 0 && <p className="practice-prompt__meta" lang={targetLanguage}>{meta.join(" · ")}</p>}
              {example && (
                <p className="practice-prompt__example" lang={targetLanguage}>
                  “{exampleParts ? (
                    <>
                      {exampleParts.before}
                      {answered ? <mark>{exampleParts.match}</mark> : <><span className="practice-prompt__blank" aria-hidden="true" /><span className="sr-only">…</span></>}
                      {exampleParts.after}
                    </>
                  ) : example}”
                </p>
              )}
              <div className="practice-prompt__foot">
                <TierLine card={card} />
                <span className="practice-prompt__progress">
                  <Trans
                    {...msg({ context: 'practice.question-progress', message: 'Question {current} / {total}' })}
                    values={{
                      current: currentIndex + 1,
                      total: questions.length,
                    }}
                  />
                </span>
              </div>
            </section>
            <div className="practice-quiz__answers">
              <h3
                id="quiz-question-heading"
                ref={questionHeadingRef}
                tabIndex={-1}
                className="practice-quiz__question focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                {questionPrompt}
              </h3>
              <p
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {answered &&
                  (answeredCorrectly ? (
                    <Trans
                      {...msg({ id: 'practice.feedback.correct', message: 'Correct answer.' })}
                    />
                  ) : (
                    <>
                      <Trans
                        {...msg({ context: 'practice.feedback.incorrect-prefix', message: 'Incorrect. The correct answer is' })}
                      />{" "}
                      <span lang={answerLanguage}>
                        “{question.correctAnswer}”.
                      </span>
                    </>
                  ))}
              </p>
              <fieldset className="practice-quiz__options">
                <legend className="sr-only">
                  <Trans
                    {...msg({ context: 'practice.quiz.choose-answer', message: 'Choose one answer' })}
                  />
                </legend>
                {question.options.map((option, optionIndex) => {
                  const correct = isQuizAnswerCorrect(question, option);
                  const selected = selectedAnswer === option;
                  const state = !answered ? "idle" : correct ? "correct" : selected ? "wrong" : "dim";
                  return (
                    <button
                      type="button"
                      key={option}
                      lang={answerLanguage}
                      onClick={() => onSelect(option)}
                      disabled={answered}
                      aria-pressed={selected}
                      data-state={state}
                      className="practice-option crystal-chamfer min-w-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
                    >
                      <span aria-hidden="true" className="practice-option__key">
                        {optionIndex + 1}
                      </span>
                      <span className="practice-option__text min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
                        {option}
                      </span>
                      {state === "wrong" && (
                        <span className="practice-option__tag" aria-hidden="true">
                          <Trans {...msg({ context: 'practice.quiz.your-answer', message: 'Your answer' })} />
                        </span>
                      )}
                      {state === "correct" && (
                        <span className="practice-option__tag" aria-hidden="true">
                          <Check size={13} strokeWidth={3} />
                          <Trans {...msg({ context: 'practice.feedback.correct-short', message: 'Correct' })} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </fieldset>
              {!answered && onLearnFirst && (
                <button type="button" onClick={onLearnFirst} className="practice-link min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
                  <Trans {...msg({ context: 'practice.learn-first', message: 'I don\'t know this — learn first' })} />
                </button>
              )}
              {answered && hasExplanation && (
                <div className="practice-explain crystal-chamfer-sm">
                  <span className="practice-explain__icon" aria-hidden="true" />
                  <p>
                    <b lang={targetLanguage}>{explanationWord}</b>
                    {card.phonetic?.trim() && <> <span className="practice-explain__ipa" lang={targetLanguage}>{card.phonetic.trim()}</span></>}
                    {card.explanation?.trim() && <> <span lang={targetLanguage}>{card.explanation.trim()}</span></>}
                  </p>
                </div>
              )}
              {answered && (
                <GsapEntrance
                  animationKey={`${currentIndex}-feedback`}
                  variant="feedback"
                  className="practice-quiz__continue"
                  data-quiz-feedback
                  data-outcome={answeredCorrectly ? "correct" : "wrong"}
                >
                  {!answeredCorrectly && (
                    <div className="practice-sheet__copy" aria-hidden="true">
                      <p className="practice-sheet__title">
                        <X size={16} strokeWidth={3} />
                        <Trans {...msg({ context: 'practice.quiz.not-quite', message: 'Not quite.' })} />
                      </p>
                      <p>
                        <b lang={promptLanguage}>{targetToNative ? card.word : card.translation}</b> = <span lang={answerLanguage}>“{question.correctAnswer}”</span>
                      </p>
                    </div>
                  )}
                  <button
                    data-color-role="primary"
                    ref={nextButtonRef}
                    type="button"
                    onClick={onNext}
                    disabled={savingResult}
                    aria-busy={savingResult}
                    className="practice-primary crystal-chamfer-sm min-h-14 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
                  >
                    {savingResult ? (
                      <Trans {...msg({ context: 'practice.actions.saving-result', message: 'Saving result…' })} />
                    ) : currentIndex === questions.length - 1 ? (
                      <Trans
                        {...msg({ context: 'practice.actions.view-results', message: 'View results' })}
                      />
                    ) : (
                      <Trans {...msg({ context: 'practice.quiz.continue', message: 'Continue' })} />
                    )}
                    {!savingResult && <EnterKeyHint />}
                  </button>
                </GsapEntrance>
              )}
            </div>
          </GsapEntrance>
        </>
      ) : null}
    </div>
  );
}
