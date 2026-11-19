import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Timer, Trophy, Zap } from "lucide-react";
import { GsapEntrance } from "../../components/motion/GsapEntrance";
import { Lumi } from "../../components/lumi/Lumi";
import { useFocusModePreference } from "../settings/focus-mode-preference";
import { useTheme } from "../theme/ThemeProvider";
import { playWordAudio, type WordAudioPlayback } from "../../lib/audio";
import { voiceForActiveCourseCard } from "../../lib/courseVoicePreference";
import { createImeSubmitGuard } from "../../lib/imeSubmitGuard";
import { speechLocaleFor } from "../../lib/speechLocale";
import type { CardData } from "../../types/card";
import { useCourseSession } from "../courses/CourseGate";
import { EnterKeyHint, LumiCoach, PracticeCount, PracticeTopBar, practiceSegments, useCrystalLumi } from "./practice-board-parts";
import { moveFocus } from "./practice-focus";
import { spellingCharacters, spellingTilesFor } from "./spelling-tiles";
import "./practice-board.css";

interface SpellingViewProps {
  cards: CardData[];
  currentIndex: number;
  input: string;
  checked: boolean;
  correct: boolean;
  score: number;
  /** Real per-word results so far, indexed like `cards`. */
  outcomes?: readonly boolean[];
  showResults: boolean;
  savingResult?: boolean;
  onInput: (value: string) => void;
  onCheck: (event: FormEvent) => void;
  /** Shows the word and records it as missed. */
  onReveal?: () => void;
  /** Moves on without an answer; the word counts as missed. */
  onSkip?: () => void;
  onNext: () => void;
  onRestart: () => void;
  onClose: () => void;
  onLearnFirst?: () => void;
}

type PlaybackSpeed = 1 | 0.75;

/** Bar heights of the static waveform drawn on the listen button. */
const LISTEN_BARS = [14, 26, 38, 30, 42, 24, 16] as const;

export function SpellingView({
  cards,
  currentIndex,
  input,
  checked,
  correct,
  score,
  outcomes,
  showResults,
  savingResult = false,
  onInput,
  onCheck,
  onReveal,
  onSkip,
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
  ) => i18n._(descriptor.id, values, { message: descriptor.message });
  const showLumi = useCrystalLumi();
  const crystal = useTheme().family === "crystal";
  const { focusModeEnabled } = useFocusModePreference();
  const answeredCount = currentIndex + (checked ? 1 : 0);
  const card = cards[currentIndex];
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousShowResultsRef = useRef(showResults);
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);
  const imeSubmitGuard = useRef(createImeSubmitGuard()).current;
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  useEffect(() => () => audioPlaybackRef.current?.cancel(), []);

  useEffect(() => {
    audioPlaybackRef.current?.cancel();
    audioPlaybackRef.current = null;
  }, [card?.id, showResults]);

  const playPronunciation = (playbackSpeed: PlaybackSpeed = speed) => {
    audioPlaybackRef.current?.cancel();
    const voice = voiceForActiveCourseCard(card, courseModel.activeCourse);
    audioPlaybackRef.current = playWordAudio(card.word, card.audioUrl, { speechLocale: speechLocaleFor(card), voice, speed: playbackSpeed });
  };
  const chooseSpeed = (playbackSpeed: PlaybackSpeed) => {
    setSpeed(playbackSpeed);
    playPronunciation(playbackSpeed);
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
      moveFocus(resultsHeadingRef.current);
      return;
    }
    if (checked) {
      moveFocus(nextButtonRef.current);
      return;
    }
    if (currentIndex > 0 || returnedFromResults)
      moveFocus(questionHeadingRef.current);
  }, [checked, currentIndex, showResults]);

  if (!card && !showResults) return null;
  const accuracy =
    cards.length > 0 ? Math.round((score / cards.length) * 100) : 0;
  const runningAccuracy = answeredCount > 0 ? Math.round((score / answeredCount) * 100) : null;
  const targetLanguage = card?.language || "en";
  const nativeLanguage = card?.translationLanguage || "vi";
  const targetLanguageName =
    new Intl.DisplayNames([i18n.locale], { type: "language" }).of(
      targetLanguage,
    ) || targetLanguage;
  const letterCount = card ? spellingCharacters(card.word.replace(/\s+/g, "")).length : 0;
  const typedCount = spellingCharacters(input).length;
  const tiles = card ? spellingTilesFor(input, card.word, checked, correct) : [];
  const partOfSpeech = card?.partOfSpeech?.trim();
  let coach: { pose: "thinking" | "happy" | "oops"; heading: ReactNode; body?: ReactNode } | null = null;
  if (showLumi && card) {
    if (!checked) coach = { pose: "thinking", heading: <Trans {...msg({ context: "practice.spelling.lumi.listen", message: "Listen, then type it" })} /> };
    else if (correct) coach = { pose: "happy", heading: <Trans {...msg({ context: "practice.spelling.lumi.right", message: "Spot on!" })} /> };
    else coach = { pose: "oops", heading: <Trans {...msg({ context: "practice.quiz.lumi.almost", message: "Almost!" })} />, body: <span lang={targetLanguage}>{card.word}</span> };
  }
  const legend = (
    <ul className="practice-spelling__legend">
      <li data-state="correct"><Trans {...msg({ context: "practice.spelling.legend.correct", message: "Correct" })} /></li>
      <li data-state="wrong"><Trans {...msg({ context: "practice.spelling.legend.wrong", message: "Wrong letter" })} /></li>
      <li data-state="missing"><Trans {...msg({ context: "practice.spelling.legend.missing", message: "Missing letter" })} /></li>
    </ul>
  );
  const actionClass = "crystal-chamfer-sm min-h-14 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none";
  return (
    <div className="practice-board practice-board--spelling practice-stage" data-practice-mode="spelling">
      {showResults ? (
        <GsapEntrance
          animationKey="spelling-results"
          variant="result"
          className="practice-results crystal-chamfer surface-glass"
          aria-labelledby="spelling-results-heading"
        >
          <div
            data-color-role="reward"
            className="practice-results__medal"
            aria-hidden="true"
          >
            <Trophy size={40} />
            {showLumi && <Lumi pose="proud" size={58} className="crystal-ornament pointer-events-none absolute -bottom-2 -right-3 max-w-none drop-shadow-md" />}
          </div>
          <h2
            id="spelling-results-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="practice-results__title focus-visible:outline-2"
          >
            <Trans {...msg({ context: 'practice.spelling.complete', message: 'Complete' })} />
          </h2>
          <p className="practice-results__subtitle">
            <Trans
              {...msg({ context: 'practice.spelling.results-subtitle', message: 'Your spelling practice results' })}
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
                {score} / {cards.length}
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
      ) : card ? (
        <>
          <PracticeTopBar
            closeLabel={<Trans {...msg({ context: 'practice.actions.exit', message: 'Exit' })} />}
            onClose={close}
            mode={<Trans {...msg({ context: 'practice.spelling.mode', message: 'Spelling' })} />}
            detail={<Trans {...msg({ context: 'practice.spelling.mode-detail', message: 'listen and type' })} />}
            progressLabel={_(
              msg({
                id: "practice.spelling.progress",
                message: "Spelling progress",
              }),
            )}
            segments={practiceSegments(cards.length, answeredCount, outcomes)}
            progressValue={answeredCount}
            actions={runningAccuracy !== null ? (
              <span className="practice-topbar__accuracy">
                <Trans {...msg({ context: 'practice.spelling.accuracy-so-far', message: '{percent}% accuracy' })} values={{ percent: runningAccuracy }} />
              </span>
            ) : undefined}
            chip={!focusModeEnabled && answeredCount >= 2 ? (
              <span data-practice-combo={answeredCount} className="practice-chip">
                <Zap size={14} aria-hidden="true" />
                <Trans {...msg({ context: 'study.combo', message: 'Combo ×{count}' })} values={{ count: answeredCount }} />
              </span>
            ) : undefined}
            count={<PracticeCount current={answeredCount} total={cards.length} />}
          />
          <p className="sr-only">
            <Trans
              {...msg({ context: 'practice.score', message: 'Score: {score} / {total}' })}
              values={{ score, total: cards.length }}
            />
          </p>
          <GsapEntrance
            animationKey={currentIndex}
            variant="step"
            onEntered={() => {
              if (currentIndex > 0 && !checked)
                moveFocus(questionHeadingRef.current);
            }}
            className="practice-spelling"
            data-lumi={coach ? "true" : undefined}
            data-side={crystal ? "true" : undefined}
            aria-labelledby="spelling-question-heading"
          >
            {coach && (
              <LumiCoach pose={coach.pose} heading={coach.heading} className="practice-spelling__lumi">
                {coach.body}
              </LumiCoach>
            )}
            <div className="practice-spelling__main">
              <span className="sr-only">
                <Trans
                  {...msg({ context: 'practice.question-progress', message: 'Question {current} / {total}' })}
                  values={{ current: currentIndex + 1, total: cards.length }}
                />
              </span>
              <div className="practice-listen">
                <button
                  type="button"
                  onClick={() => playPronunciation()}
                  className="practice-listen__button transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none"
                  aria-label={_(
                    msg({
                      id: "practice.spelling.play-pronunciation",
                      message: "Play pronunciation for {word}",
                    }),
                    { word: card.word },
                  )}
                >
                  {LISTEN_BARS.map(height => <i key={height} aria-hidden="true" style={{ height }} />)}
                </button>
              </div>
              <div className="practice-speed" role="group" aria-label={_(msg({ id: "practice.spelling.speed", message: "Playback speed" }))}>
                <button type="button" aria-pressed={speed === 1} onClick={() => chooseSpeed(1)} className="practice-speed__chip min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2">
                  <span className="practice-speed__face crystal-chamfer-sm transition-colors motion-reduce:transition-none">
                    <Trans {...msg({ context: 'practice.spelling.speed-normal', message: '1× normal' })} />
                  </span>
                </button>
                <button type="button" aria-pressed={speed === 0.75} onClick={() => chooseSpeed(0.75)} className="practice-speed__chip min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2">
                  <span className="practice-speed__face crystal-chamfer-sm transition-colors motion-reduce:transition-none">
                    <Timer size={14} aria-hidden="true" />
                    <Trans {...msg({ context: 'practice.spelling.speed-slow', message: '0.75× slow' })} />
                  </span>
                </button>
              </div>
              <div className="practice-spelling__hint">
                <span className="practice-spelling__hint-label"><Trans {...msg({ context: 'practice.spelling.meaning-hint', message: 'Meaning hint:' })} /></span>{" "}
                <h3
                  id="spelling-question-heading"
                  ref={questionHeadingRef}
                  tabIndex={-1}
                  lang={nativeLanguage}
                  className="practice-spelling__meaning focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                  {card.translation}
                </h3>
                {partOfSpeech && <span className="practice-spelling__meta"> · <span lang={targetLanguage}>{partOfSpeech}</span></span>}
                <span className="practice-spelling__meta">
                  {" · "}
                  {targetLanguage === "en" ? (
                    <Trans {...msg({ context: 'practice.spelling.letter-count', message: '{count, plural, one {# letter} other {# letters}}' })} values={{ count: letterCount }} />
                  ) : (
                    <Trans {...msg({ context: 'practice.spelling.character-count', message: '{count, plural, one {# character} other {# characters}}' })} values={{ count: letterCount }} />
                  )}
                </span>
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
              <form onSubmit={check} className="practice-spelling__form">
                <div
                  className="practice-tiles"
                  data-checked={checked ? "true" : undefined}
                  data-practice-tiles
                  style={{ "--tile-count": Math.max(tiles.length, 1) } as CSSProperties}
                >
                  <ol className="practice-tiles__row" aria-hidden="true" lang={targetLanguage}>
                    {tiles.map((tile, index) => (
                      <li
                        key={index}
                        className="practice-tile crystal-chamfer-sm"
                        data-state={tile.state}
                        data-space={tile.char === " " ? "true" : undefined}
                        data-next={!checked && index === typedCount ? "true" : undefined}
                      >
                        {tile.char === " " ? " " : tile.char}
                      </li>
                    ))}
                  </ol>
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
                    className="practice-tiles__input"
                  />
                </div>
                {checked && !correct && legend}
                {checked && (
                  <p className="practice-spelling__feedback" data-outcome={correct ? "correct" : "wrong"} aria-hidden="true">
                    {correct ? (
                      <Trans {...msg({ context: 'practice.spelling.correct', message: 'Correct' })} />
                    ) : (
                      <>
                        <Trans
                          {...msg({ context: 'practice.spelling.answer-is', message: 'The answer is' })}
                        />{" "}
                        <b lang={targetLanguage}>{card.word}</b>
                      </>
                    )}
                  </p>
                )}
                <div className="practice-spelling__actions">
                  {checked ? (
                    <button
                      data-color-role="primary"
                      ref={nextButtonRef}
                      type="button"
                      onClick={onNext}
                      disabled={savingResult}
                      aria-busy={savingResult}
                      className={`practice-primary ${actionClass}`}
                    >
                      {savingResult ? (
                        <Trans {...msg({ context: 'practice.actions.saving-result', message: 'Saving result…' })} />
                      ) : currentIndex === cards.length - 1 ? (
                        <Trans
                          {...msg({ context: 'practice.actions.view-results', message: 'View results' })}
                        />
                      ) : (
                        <Trans {...msg({ context: 'practice.actions.next', message: 'Next' })} />
                      )}
                      {!savingResult && <EnterKeyHint />}
                    </button>
                  ) : (
                    <>
                      <button data-color-role="primary" type="submit" className={`practice-primary ${actionClass}`}>
                        <Trans {...msg({ context: 'practice.spelling.check', message: 'Check' })} />
                        <EnterKeyHint />
                      </button>
                      {onReveal && (
                        <button type="button" onClick={onReveal} className={`practice-secondary ${actionClass}`}>
                          <Trans {...msg({ context: 'practice.spelling.reveal', message: 'Reveal' })} />
                        </button>
                      )}
                      {onSkip && (
                        <button type="button" onClick={onSkip} className="practice-ghost min-h-14 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
                          <Trans {...msg({ context: 'practice.spelling.skip', message: 'Skip' })} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </form>
              {!checked && onLearnFirst && (
                <button type="button" onClick={onLearnFirst} className="practice-link practice-spelling__learn min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
                  <Trans {...msg({ context: 'practice.learn-first', message: 'I don\'t know this — learn first' })} />
                </button>
              )}
            </div>
            {crystal && (
              <div className="practice-spelling__side">
                <div className="practice-side-panel crystal-chamfer-sm">
                  <span className="practice-side-panel__label"><Trans {...msg({ context: 'practice.results.accuracy', message: 'Accuracy' })} /></span>
                  <b className="practice-side-panel__value">{runningAccuracy === null ? "—" : `${runningAccuracy}%`}</b>
                  <span className="practice-side-panel__bar" aria-hidden="true"><i style={{ width: `${runningAccuracy ?? 0}%` }} /></span>
                  <span className="practice-side-panel__note">
                    <Trans {...msg({ context: 'practice.spelling.words-right', message: '{score} of {answered} words right' })} values={{ score, answered: answeredCount }} />
                  </span>
                </div>
                <div className="practice-side-panel crystal-chamfer-sm">
                  <span className="practice-side-panel__label"><Trans {...msg({ context: 'practice.spelling.letter-key', message: 'Letter key' })} /></span>
                  {legend}
                </div>
              </div>
            )}
          </GsapEntrance>
        </>
      ) : null}
    </div>
  );
}
