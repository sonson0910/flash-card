import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react";
import { CircleAlert, Loader2, Play, RefreshCw, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CardTierName, CardTierStatus } from "../../components/flashcard/CardFront";
import { headwordStressParts } from "../../components/flashcard/CardHeadword";
import { GsapEntrance } from "../../components/motion/GsapEntrance";
import { cancelSpeech, playWordAudio, type WordAudioPlayback } from "../../lib/audio";
import type { PlainStoryInfo, StoryInfo } from "../../lib/wordInfo";
import type { CardData } from "../../types/card";
import { resolveLanguagePackId, speechLocaleForPack } from "../languagePacks/registry";
import { getLibraryCardTier } from "../library/libraryViewModel";
import { useTheme } from "../theme/ThemeProvider";
import { LumiCoach, PracticeTopBar, useCrystalLumi } from "./practice-board-parts";
import { moveFocus } from "./practice-focus";
import { getStoryStatusAnnouncement } from "./practiceAccessibility";
import { RichStoryExercises } from "./rich-story-view";
import { cardDueInDays, storyReadMinutes, storyTextParts } from "./story-words";
import "./practice-board.css";

export { normalizeGrammarAnswer, isGrammarAnswerCorrect, isComprehensionAnswerCorrect } from "./rich-story-view";

/** A generated story, with the learner's cards it was written from when the caller has them. */
export type StoryContent = (StoryInfo | PlainStoryInfo) & {
  language?: string;
  translationLanguage?: string;
  cards?: readonly CardData[];
};

interface StoryViewProps {
  story: StoryContent | null;
  loading: boolean;
  error?: string | null;
  onGenerate: () => void;
  onClose: () => void;
  /** Starts a review session with the given story words. */
  onReviewCards?: (cards: CardData[]) => void;
}

interface ActiveWord {
  cardId: string;
  /** Which trigger opened the meaning: one place in the text, or the word list. */
  anchor: string;
}

const POPOVER_ID = "story-word-meaning";

function languageName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale || "en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The title with its last word set in the board's accent style. */
function accentLastWord(text: string): ReactNode {
  const trimmed = text.trim();
  const split = trimmed.lastIndexOf(" ");
  if (split <= 0) return trimmed;
  return <>{trimmed.slice(0, split + 1)}<em>{trimmed.slice(split + 1)}</em></>;
}

/** Translates a message descriptor with values through the active catalog. */
function useTranslate() {
  const { i18n: active } = useLingui();
  return {
    locale: active.locale,
    _: (descriptor: ReturnType<typeof msg>, values?: Record<string, unknown>) => active._(descriptor.id, values, { message: descriptor.message }),
  };
}

function StoryWordState({ card }: { card: CardData }) {
  const tier = getLibraryCardTier(card);
  const days = tier === "new" ? null : cardDueInDays(card);
  return (
    <span className="practice-story__state" data-tier={tier}>
      <span aria-hidden="true" className="practice-story__dot" />
      <span>
        {tier === "new" ? (
          <Trans {...msg({ context: "practice.card-state.new", message: "New word" })} />
        ) : tier === "mastered" ? (
          <Trans {...msg({ context: "practice.card-state.mastered", message: "Mastered" })} />
        ) : (
          <Trans {...msg({ context: "practice.card-state.learning", message: "Learning" })} />
        )}
        {days !== null && (
          <>
            {" · "}
            {days === 0 ? (
              <Trans {...msg({ context: "practice.story.due-now", message: "due now" })} />
            ) : (
              <Trans {...msg({ context: "practice.story.due-in", message: "{days, plural, one {due in # day} other {due in # days}}" })} values={{ days }} />
            )}
          </>
        )}
      </span>
    </span>
  );
}

interface StoryGlossProps {
  card: CardData;
  onListen: () => void;
  onReview?: () => void;
}

/** A word's meaning card. Built from spans and buttons so it can sit inside a paragraph. */
function StoryGloss({ card, onListen, onReview }: StoryGlossProps) {
  const { _ } = useTranslate();
  const stress = headwordStressParts(card);
  const details = [card.phonetic?.trim(), card.partOfSpeech?.trim()].filter(Boolean);
  return (
    <>
      <span className="practice-story__gloss-head">
        <span className="practice-story__gloss-word" lang={card.language}>
          {stress ? <><span className="practice-story__gloss-stress">{stress.stressed}</span><em>{stress.rest}</em></> : card.word}
        </span>
        <button
          type="button"
          onClick={onListen}
          aria-label={_(msg({ id: "practice.story.listen-word", message: "Listen to {word}" }), { word: card.word })}
          className="practice-story__gloss-listen focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span aria-hidden="true"><Play size={11} fill="currentColor" /></span>
        </button>
      </span>
      {details.length > 0 && (
        <span className="practice-story__gloss-meta">
          {card.phonetic?.trim() && <span className="practice-story__ipa">{card.phonetic.trim()}</span>}
          {details.length > 1 && " · "}
          {card.partOfSpeech?.trim()}
        </span>
      )}
      <span className="practice-story__gloss-meaning" lang={card.translationLanguage}>{card.translation}</span>
      <span className="practice-story__gloss-foot">
        <StoryWordState card={card} />
        {onReview && (
          <button type="button" onClick={onReview} className="practice-story__review-now focus-visible:outline-2 focus-visible:outline-offset-2">
            <Trans {...msg({ context: "practice.story.review-now", message: "Review now" })} />
          </button>
        )}
      </span>
    </>
  );
}

export function StoryView({ story, loading, error = null, onGenerate, onClose, onReviewCards }: StoryViewProps) {
  const { _, locale } = useTranslate();
  const crystal = useTheme().family === "crystal";
  const showLumi = useCrystalLumi();
  const loadingStatusRef = useRef<HTMLDivElement>(null);
  const storyHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const speechRunRef = useRef(0);
  const playbackRef = useRef<WordAudioPlayback | null>(null);
  const [active, setActive] = useState<ActiveWord | null>(null);
  const [playing, setPlaying] = useState<"story" | number | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const rich = story && "segments" in story ? story : null;
  const plain = story && !("segments" in story) ? story : null;
  const language = story?.language || "en";
  const translationLanguage = story?.translationLanguage || "vi";
  const cards = story?.cards ?? [];
  const cardsById = new Map(cards.map(card => [card.id, card]));
  const storyText = rich ? rich.segments.map(segment => segment.english).join(" ") : plain?.story ?? "";
  const activeCard = active ? cardsById.get(active.cardId) ?? null : null;
  const glossCard = activeCard ?? cards[0] ?? null;

  const stopSpeech = () => {
    speechRunRef.current += 1;
    playbackRef.current?.cancel();
    playbackRef.current = null;
    cancelSpeech();
    setPlaying(null);
  };

  useEffect(() => () => {
    speechRunRef.current += 1;
    playbackRef.current?.cancel();
    cancelSpeech();
  }, []);

  useEffect(() => {
    stopSpeech();
    setSpeechError(null);
    setActive(null);
  }, [loading, story]);

  // Announce each new state; the ring follows keyboard use only (see practice-focus).
  useEffect(() => {
    if (loading) {
      moveFocus(loadingStatusRef.current);
      return;
    }
    if (error) {
      moveFocus(errorRef.current);
      return;
    }
    if (story) moveFocus(storyHeadingRef.current);
  }, [error, loading, story]);

  useEffect(() => {
    if (!active) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-story-pop], [data-story-word]")) return;
      setActive(null);
    };
    // Escape closes the meaning and returns focus to the word that opened it. It is
    // heard on the document because Safari leaves focus on the page after a tap.
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActive(null);
      moveFocus(triggerRef.current);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [active]);

  const speak = (text: string, target: "story" | number, speechLanguage: string) => {
    if (!text.trim()) return;
    const run = speechRunRef.current + 1;
    speechRunRef.current = run;
    playbackRef.current?.cancel();
    setSpeechError(null);
    setPlaying(target);
    playbackRef.current = playWordAudio(text, null, {
      speechLocale: speechLocaleForPack(resolveLanguagePackId(speechLanguage)),
      onEnd: () => { if (speechRunRef.current === run) setPlaying(null); },
      onError: () => {
        if (speechRunRef.current !== run) return;
        setPlaying(null);
        setSpeechError(_(msg({ id: "practice.story.speech-unavailable", message: "Speech playback is unavailable. You can still read the story." })));
      },
    });
  };
  const toggleStoryAudio = () => {
    if (playing === "story") stopSpeech();
    else speak(storyText, "story", language);
  };
  const listenToWord = (card: CardData) => {
    const run = speechRunRef.current + 1;
    speechRunRef.current = run;
    playbackRef.current?.cancel();
    setPlaying(null);
    playbackRef.current = playWordAudio(card.word, card.audioUrl, { speechLocale: speechLocaleForPack(resolveLanguagePackId(card.language ?? language)) });
  };

  const handleClose = () => {
    stopSpeech();
    onClose();
  };
  const handleGenerate = () => {
    stopSpeech();
    onGenerate();
  };
  const reviewCards = (selected: CardData[]) => {
    stopSpeech();
    onReviewCards?.(selected);
  };

  const pickWord = (cardId: string, anchor: string, trigger: HTMLElement) => {
    if (active?.cardId === cardId && active.anchor === anchor) {
      setActive(null);
      return;
    }
    triggerRef.current = trigger;
    setActive({ cardId, anchor });
  };

  const popover = (card: CardData) => (
    <span id={POPOVER_ID} role="dialog" aria-label={card.word} data-story-pop className="practice-story__pop crystal-chamfer">
      <span aria-hidden="true" className="practice-story__caret" />
      <StoryGloss
        card={card}
        onListen={() => listenToWord(card)}
        onReview={onReviewCards ? () => reviewCards([card]) : undefined}
      />
    </span>
  );

  const wordTrigger = (card: CardData, anchor: string, children: ReactNode, className: string) => {
    const open = active?.cardId === card.id && active.anchor === anchor;
    return (
      <button
        type="button"
        data-story-word
        data-tier={getLibraryCardTier(card)}
        data-current={crystal && glossCard?.id === card.id ? "true" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? POPOVER_ID : undefined}
        onClick={event => pickWord(card.id, anchor, event.currentTarget)}
        className={className}
      >
        {children}
      </button>
    );
  };

  const storyWords = (text: string, keyPrefix: string) => storyTextParts(text, cards, language).map((part, index) => {
    const card = part.cardId ? cardsById.get(part.cardId) : undefined;
    if (!card) return part.text;
    const anchor = `${keyPrefix}-${index}`;
    return (
      <span key={anchor} className="practice-story__word-wrap">
        {wordTrigger(card, anchor, part.text, "practice-story__word crystal-chamfer-sm focus-visible:outline-2 focus-visible:outline-offset-2")}
        {active?.cardId === card.id && active.anchor === anchor && popover(card)}
      </span>
    );
  });

  const statusAnnouncement = getStoryStatusAnnouncement(
    loading,
    story !== null,
    _(msg({ id: "practice.story.creating", message: "Creating your story." })),
    rich
      ? i18n._(msg({ id: "practice.rich-story.story-ready", message: "Story ready" }))
      : _(msg({ id: "practice.story.ready", message: "Your story is ready." })),
  );
  const closeLabel = _(msg({ id: "practice.story.close", message: "Close story" }));
  const title = rich ? rich.title : _(msg({ id: "practice.story.reading-context-title", message: "Reading in context" }));
  const tip = (
    <Trans
      {...msg({ context: "practice.story.tip", message: "{count, plural, one {Tap the highlighted word for its meaning. Finish the story to review it.} other {Tap any highlighted word for its meaning. Finish the story to review all # in one go.}}" })}
      values={{ count: cards.length }}
    />
  );
  const paragraphs = plain ? plain.story.split(/\n+/).map(paragraph => paragraph.trim()).filter(Boolean) : [];

  return (
    <div
      className="practice-board practice-board--story practice-stage"
      data-practice-mode="story"
      aria-busy={loading}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading ? "" : statusAnnouncement}
      </p>
      <PracticeTopBar
        closeLabel={closeLabel}
        closeAriaLabel={closeLabel}
        onClose={handleClose}
        kicker={false}
        mode={<Trans {...msg({ context: "practice.story.mode", message: "Story" })} />}
        detail={<Trans {...msg({ context: "practice.story.mode-detail", message: "written from your words" })} />}
        actions={story && !loading && !error ? (
          <>
            <button
              type="button"
              onClick={toggleStoryAudio}
              aria-pressed={playing === "story"}
              className="practice-topbar__action crystal-chamfer-sm min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
              data-variant="accent"
            >
              {playing === "story" ? <Square size={12} fill="currentColor" aria-hidden="true" /> : <Play size={crystal ? 13 : 12} fill="currentColor" aria-hidden="true" />}
              <span className="practice-topbar__action-label">
                <Trans {...msg({ context: "practice.story.listen", message: "Listen" })} />
              </span>
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              className="practice-topbar__action crystal-chamfer-sm min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span className="practice-topbar__action-label">
                <Trans {...msg({ context: "practice.story.create-another", message: "Create another story" })} />
              </span>
            </button>
          </>
        ) : undefined}
      />
      {loading ? (
        <GsapEntrance
          animationKey="story-loading"
          ref={loadingStatusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="practice-story__status crystal-chamfer surface-glass focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <Loader2 size={44} className="practice-story__spinner animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <p>
            <Trans {...msg({ context: "practice.story.creating-progress", message: "Creating your story…" })} />
          </p>
        </GsapEntrance>
      ) : error ? (
        <GsapEntrance
          animationKey={error}
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          variant="result"
          className="practice-story__error crystal-chamfer focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <CircleAlert size={36} aria-hidden="true" className="practice-story__error-icon" />
          <h2>
            <Trans {...msg({ context: "practice.story.generation-stopped", message: "Story generation stopped" })} />
          </h2>
          <p>{error}</p>
          <button
            type="button"
            data-color-role="primary"
            onClick={handleGenerate}
            className="practice-primary crystal-chamfer-sm min-h-12 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
          >
            <RefreshCw size={17} aria-hidden="true" />
            <Trans {...msg({ context: "practice.actions.try-again", message: "Try again" })} />
          </button>
        </GsapEntrance>
      ) : story ? (
        <GsapEntrance
          animationKey={rich ? rich.title : storyText}
          variant="result"
          className="practice-story"
          data-side={crystal ? "true" : undefined}
          aria-labelledby="story-heading"
        >
          <article className="practice-story__article">
            <p className="practice-story__meta">
              <span className="practice-story__chip">
                <span className="practice-story__chip-text">
                  <Trans {...msg({ context: "practice.story.target-language", message: "{languageName}" })} values={{ languageName: languageName(language, locale) }} />
                </span>
              </span>
              <span>
                {cards.length > 0 && (
                  <>
                    <Trans {...msg({ context: "practice.story.word-count", message: "{count} of your words" })} values={{ count: cards.length }} />
                    <span className="practice-story__sep" aria-hidden="true">{crystal ? " // " : " · "}</span>
                  </>
                )}
                <Trans {...msg({ context: "practice.story.read-time", message: "{minutes} min read" })} values={{ minutes: storyReadMinutes(storyText, language) }} />
              </span>
            </p>
            <h2
              id="story-heading"
              ref={storyHeadingRef}
              tabIndex={-1}
              className="practice-story__title focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              {accentLastWord(title)}
            </h2>
            {rich ? (
              <div className="practice-story__text" lang="en">
                {rich.segments.map((segment, index) => (
                  <section
                    key={`${index}-${segment.english}`}
                    data-story-scene={index}
                    aria-current={playing === index ? "true" : undefined}
                    className="practice-story__scene"
                  >
                    <p className="practice-story__para">{storyWords(segment.english, `scene-${index}`)}</p>
                    <div className="practice-story__scene-foot">
                      <p lang="vi" className="practice-story__scene-translation">{segment.vietnamese}</p>
                      <button
                        type="button"
                        onClick={() => speak(segment.english, index, "en")}
                        aria-label={i18n._(msg({ id: "rich-story-view.read-scene", message: "Read scene {number} in English" }).id, { number: index + 1 })}
                        className="practice-story__scene-listen crystal-chamfer-sm min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <Volume2 size={16} aria-hidden="true" />
                        <Trans {...msg({ context: "rich-story-view.read-aloud", message: "Read aloud" })} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="practice-story__text">
                {paragraphs.length > 1
                  ? paragraphs.map((paragraph, index) => <p key={index} lang={language} className="practice-story__para">{storyWords(paragraph, `para-${index}`)}</p>)
                  : <p lang={language} className="practice-story__para">{storyWords(plain?.story ?? "", "para-0")}</p>}
              </div>
            )}
            {speechError ? <p role="status" aria-live="polite" className="practice-story__note">{speechError}</p> : null}
            {plain && (
              <section className="practice-story__translation" aria-labelledby="story-translation-heading">
                <h3 id="story-translation-heading">
                  <Trans
                    {...msg({ context: "practice.story.translation-language", message: "{languageName} translation" })}
                    values={{ languageName: languageName(translationLanguage, locale) }}
                  />
                </h3>
                <p lang={translationLanguage}>{plain.translation}</p>
              </section>
            )}
            {rich && <RichStoryExercises key={rich.title} story={rich} />}
            {showLumi && (
              <LumiCoach
                pose={playing === "story" ? "happy" : "hint"}
                className="practice-story__lumi"
                label={<Trans {...msg({ context: "practice.story.lumi.label", message: "Lumi · Narrator" })} />}
                heading={activeCard ? (
                  <Trans
                    {...msg({ context: "practice.story.lumi.meaning", message: "“{word}” means {meaning}." })}
                    values={{ word: activeCard.word, meaning: activeCard.translation }}
                  />
                ) : (
                  <Trans {...msg({ context: "practice.story.lumi.tap", message: "Tap a highlighted word to see what it means." })} />
                )}
              >
                {cards.length > 0 ? tip : null}
              </LumiCoach>
            )}
          </article>
          <aside className="practice-story__aside">
            {crystal && glossCard && (
              <section data-story-pop className="practice-story__gloss-panel" aria-labelledby="story-gloss-heading" aria-live="polite" data-tier={getLibraryCardTier(glossCard)}>
                <p className="practice-story__gloss-top">
                  <span className="practice-story__tier" aria-hidden="true">
                    <span className="practice-story__tier-grade"><CardTierName tier={getLibraryCardTier(glossCard)} /></span>
                    <span className="practice-story__tier-name"><CardTierStatus tier={getLibraryCardTier(glossCard)} /></span>
                  </span>
                  <span id="story-gloss-heading" className="practice-story__gloss-label">
                    <Trans {...msg({ context: "practice.story.gloss", message: "Lumi gloss" })} />
                  </span>
                </p>
                <StoryGloss
                  card={glossCard}
                  onListen={() => listenToWord(glossCard)}
                  onReview={onReviewCards ? () => reviewCards([glossCard]) : undefined}
                />
              </section>
            )}
            {cards.length > 0 && (
              <section className="practice-story__words crystal-chamfer" aria-labelledby="story-words-heading">
                <h3 id="story-words-heading" className="practice-story__words-title">
                  <Trans {...msg({ context: "practice.story.words-heading", message: "Words in this story" })} />
                  <span className="practice-story__words-count">{cards.length}</span>
                </h3>
                <ul>
                  {cards.map(card => {
                    const anchor = `list-${card.id}`;
                    return (
                      <li key={card.id}>
                        {wordTrigger(card, anchor, (
                          <>
                            {crystal
                              ? <span aria-hidden="true" className="practice-story__row-tier"><CardTierName tier={getLibraryCardTier(card)} /></span>
                              : <span aria-hidden="true" className="practice-story__dot" />}
                            <span className="practice-story__row-word" lang={card.language}>{card.word}</span>
                            <span className="practice-story__row-meaning" lang={card.translationLanguage}>{card.translation}</span>
                          </>
                        ), "practice-story__row focus-visible:outline-2 focus-visible:-outline-offset-2")}
                        {active?.cardId === card.id && active.anchor === anchor && popover(card)}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {cards.length > 0 && (onReviewCards || !showLumi) ? (
              <div className="practice-story__tip">
                {!showLumi && <p>{tip}</p>}
                {onReviewCards && (
                  <button
                    type="button"
                    data-color-role="primary"
                    onClick={() => reviewCards([...cards])}
                    className="practice-primary crystal-chamfer min-h-12 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
                  >
                    {crystal && (
                      <>
                        <span aria-hidden="true" className="practice-story__shine crystal-shine" />
                        <svg className="practice-story__star" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l3 7.1 7.7.6-5.9 5 1.8 7.5L12 17.7l-6.6 4 1.8-7.5-5.9-5 7.7-.6z" fill="currentColor" /><path d="M12 1.5l3 7.1-3 9.1z" fill="var(--sf-reward)" /></svg>
                      </>
                    )}
                    <span className="practice-story__review-label">
                      <Trans {...msg({ context: "practice.story.review-all", message: "{count, plural, one {Review this word} other {Review these # words}}" })} values={{ count: cards.length }} />
                    </span>
                  </button>
                )}
              </div>
            ) : null}
          </aside>
        </GsapEntrance>
      ) : null}
    </div>
  );
}
