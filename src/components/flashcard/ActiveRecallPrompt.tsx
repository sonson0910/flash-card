import { Eye, EyeOff, Image as ImageIcon, Star, Volume2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { CardData } from '../../types/card';
import { buildRecallPrompt, isRecallAnswerCorrect, resolveRecallMode, type RecallMode } from '../../lib/recall';
import { isSupportedImageUrl } from '../../lib/images';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import { CardImage } from './CardImage';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import { voiceForActiveCourseCard } from '../../lib/courseVoicePreference';
import { speechLocaleFor } from '../../lib/speechLocale';
import { useCourseSession } from '../../features/courses/CourseGate';
import { cardTierOf, useCardLook } from './cardLook';
import { CardEffectsLayer, useCardEffects } from './CardEffectsLayer';
import { CardHeadword } from './CardHeadword';
import { CardTierName, CardTierStatus, CrystalBlindBand } from './CardFront';
import { crystalTiltMotion } from './crystalCardMotion';
import { useReducedMotion } from '../../lib/motionPreferenceHooks';
import { useZenGlassMode } from '../../lib/useZenGlassMode';
import { playRewardSound } from '../../lib/interactionSounds';
import { triggerHaptic } from '../../lib/haptics';
import './flashcard-canvas.css';

interface ActiveRecallPromptProps {
  card: CardData;
  mode: RecallMode;
  onReveal: () => void;
  onImageUnavailable?: () => void;
  /** Stars or unstars the card from the Crystal card face, as the card's own star does. */
  onToggleBookmark?: (cardId: string) => void;
}

export function ActiveRecallPrompt({ card, mode, onReveal, onImageUnavailable, onToggleBookmark }: ActiveRecallPromptProps) {
  const { _, i18n } = useLingui();
  const { model: courseModel } = useCourseSession();
  const look = useCardLook();
  // The zen glass card keeps the earlier recall panel; the prompt follows the setting when it changes while open.
  const [zenGlass] = useZenGlassMode();
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

  const answerResult = (
    answerCorrect === true ? <Trans {...msg({ context: 'flashcard.recall.correct', message: 'Correct. Reveal the answer to compare.' })} /> : answerCorrect === false ? <Trans {...msg({ context: 'flashcard.recall.incorrect', message: 'Not quite. Try again or reveal the answer to check.' })} /> : ''
  );
  const answerForm = (formClassName: string, inputClassName: string, checkClassName: string) => (
    <form onSubmit={checkAnswer} className={formClassName} aria-label={_(msg({ id: 'flashcard.recall.check-answer', message: 'Check recalled answer' }))}>
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
        className={inputClassName}
      />
      <button
        type="submit"
        disabled={!answerInput.trim()}
        className={checkClassName}
      >
        <Trans {...msg({ context: 'flashcard.recall.check', message: 'Check' })} />
      </button>
    </form>
  );

  if (look === 'crystal' && !zenGlass) {
    return (
      <CrystalRecallCard
        card={card}
        resolvedMode={resolvedMode}
        promptText={prompt.promptText}
        instruction={prompt.instruction}
        pictureUrl={prompt.showImage ? imageUrl : null}
        playAudio={prompt.playAudio}
        targetLanguage={targetLanguage}
        translationLanguage={translationLanguage}
        onPlayPrompt={playPrompt}
        onReveal={onReveal}
        onImageUnavailable={onImageUnavailable}
        onToggleBookmark={onToggleBookmark}
        answerCorrect={answerCorrect}
        answerResult={answerResult}
        form={answerForm(
          'flashcard-recall-form flex w-full gap-2',
          'flashcard-recall-input min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)]',
          'flashcard-recall-check min-h-11 shrink-0 cursor-pointer transition-[transform,filter] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none',
        )}
      />
    );
  }

  return (
    <section
      data-active-recall
      data-card-look={look}
      data-card-tier={cardTierOf(card)}
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

        {answerForm(
          'flex w-full max-w-sm gap-2',
          'flashcard-recall-input min-h-11 min-w-0 flex-1 px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]',
          'flashcard-recall-check min-h-11 px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none',
        )}

        <p className={`min-h-5 text-sm font-semibold ${answerCorrect === true ? 'text-[var(--sf-success)]' : answerCorrect === false ? 'text-[var(--sf-danger)]' : 'text-[var(--sf-text-muted)]'}`} aria-live="polite">
          {answerResult}
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

interface CrystalRecallCardProps {
  card: CardData;
  resolvedMode: ReturnType<typeof resolveRecallMode>;
  promptText: string;
  instruction: string;
  /** The picture the prompt asks about; null when the mode keeps the picture hidden. */
  pictureUrl: string | null;
  playAudio: boolean;
  targetLanguage: string;
  translationLanguage: string;
  onPlayPrompt: () => void;
  onReveal: () => void;
  onImageUnavailable?: () => void;
  onToggleBookmark?: (cardId: string) => void;
  answerCorrect: boolean | null;
  answerResult: ReactNode;
  form: ReactNode;
}

/**
 * The Crystal prompt in the AnimeReview board's card face: rim, corner marks, tier chip, star, the picture band (or
 * the board's blind band while the mode keeps the picture hidden), the kicker, the prompt in the board's word type,
 * then the answer box where the board shows the definition, and the board's reveal button. The learner's task, the
 * answer check and the reveal are those of the plain prompt.
 */
function CrystalRecallCard({
  card, resolvedMode, promptText, instruction, pictureUrl, playAudio, targetLanguage, translationLanguage,
  onPlayPrompt, onReveal, onImageUnavailable, onToggleBookmark, answerCorrect, answerResult, form,
}: CrystalRecallCardProps) {
  const { _ } = useLingui();
  const reduceMotion = useReducedMotion();
  const faceRef = useRef<HTMLDivElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const tier = cardTierOf(card);
  const spotlightBackground = 'radial-gradient(circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), var(--flashcard-tier-soft) 0%, transparent 40%)';
  const { aura, isHovered, handleMouseEnter, handleMouseMove, handleMouseLeave } = useCardEffects({
    category: card.category,
    faceRef,
    spotlightRef,
    reduceMotion,
    isFlipAnimating: false,
    spotlightBackground,
    tilt: crystalTiltMotion,
  });
  const pictureHidden = !pictureUrl;
  const partOfSpeech = card.partOfSpeech?.trim();
  const promptLanguage = resolvedMode === 'native-to-target' ? translationLanguage : targetLanguage;
  const headwordStyle = { '--headword-chars': Math.max(4, Array.from(promptText).length) } as CSSProperties;
  const starLabel = card.bookmarked ? _(msg({ id: 'flashcard.star.remove', message: 'Remove star' })) : _(msg({ id: 'flashcard.star.add', message: 'Star this word' }));

  return (
    <section
      data-active-recall
      data-card-look="crystal"
      data-card-tier={tier}
      data-recall-mode={resolvedMode}
      className="flashcard-recall-card relative mx-auto w-full max-w-[460px]"
      aria-labelledby="recall-instruction"
    >
      <div
        className="flashcard-shell group relative mx-auto h-full w-full max-w-[460px] touch-pan-y overflow-visible bg-transparent"
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        data-card-side="front"
        data-card-tier={tier}
        data-card-flipping="false"
        data-flip-animation={reduceMotion ? 'reduced' : 'spatial'}
        data-card-mode="standard"
        data-card-look="crystal"
        data-card-hovered={isHovered ? 'true' : 'false'}
        data-card-blind={pictureHidden ? 'true' : 'false'}
        data-card-effects="tilt spotlight aura star blind tier-rim hover-wings"
      >
        <CardEffectsLayer aura={aura} wings tier={tier} isHovered={isHovered} />
        <div data-card-top-controls className="absolute right-4 top-4 z-[45] flex flex-row-reverse items-center gap-2">
          {onToggleBookmark && (
            <button
              type="button"
              data-color-role="reward"
              data-card-effect="star-pop"
              onClick={event => {
                event.stopPropagation();
                if (!card.bookmarked) {
                  playRewardSound();
                  triggerHaptic('success');
                } else {
                  triggerHaptic('light');
                }
                onToggleBookmark(card.id);
              }}
              data-selected={card.bookmarked ? 'true' : 'false'}
              className="flashcard-chrome-button flashcard-reward-button flex min-h-11 min-w-11 items-center justify-center p-2 transition-[transform,background-color,border-color,color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              title={starLabel}
              aria-label={starLabel}
              aria-pressed={Boolean(card.bookmarked)}
            >
              <span className={card.bookmarked ? 'flashcard-star-selected' : undefined}>
                <Star size={17} className={card.bookmarked ? 'fill-current' : ''} aria-hidden="true" />
              </span>
            </button>
          )}
          {onToggleBookmark && card.bookmarked && <span data-card-effect="star-flare" className="flashcard-star-flare" aria-hidden="true" />}
          {/* The prompt decides whether the picture shows, so the eye shows that state instead of switching it; the
              blind band's plate says it in words. */}
          <span
            aria-hidden="true"
            data-card-hint-state
            data-selected={pictureHidden ? 'true' : 'false'}
            className="flashcard-chrome-button flex min-h-11 min-w-11 items-center justify-center p-2"
          >
            {pictureHidden ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
          </span>
        </div>

        <div data-flashcard-stage className="relative z-10 h-full w-full overflow-visible" style={{ perspective: reduceMotion ? 'none' : '1600px' }}>
          <div
            ref={faceRef}
            data-card-face="front"
            data-card-mode="standard"
            data-card-look="crystal"
            style={{ transformOrigin: 'center center' }}
            className="flashcard-panel flashcard-face absolute flex h-full w-full flex-col overflow-hidden"
          >
            <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
            <div data-card-art data-card-art-kind={pictureHidden ? 'blind' : 'image'} className="flashcard-art relative shrink-0 overflow-hidden">
              <div data-card-effect="blind-image" className="flashcard-art-image h-full w-full">
                {pictureUrl && (
                  <CardImage
                    src={pictureUrl}
                    alt={_(msg({ id: 'flashcard.image.illustration', message: 'Illustration for {word}' }).id, { word: card.word })}
                    priority
                    onUnavailable={onImageUnavailable}
                  />
                )}
              </div>
              {pictureUrl && <div className="flashcard-art-shade pointer-events-none absolute inset-0" aria-hidden="true" />}
              {pictureHidden && <CrystalBlindBand />}
              <span className="flashcard-tier-ribbon absolute left-[18px] top-4 z-20 inline-flex items-center gap-2">
                <span data-card-tier-label className="flashcard-tier-grade"><CardTierName tier={tier} /></span>
                <span className="flashcard-tier-name"><CardTierStatus tier={tier} /></span>
              </span>
            </div>

            <div className="flashcard-body relative z-20 flex min-h-0 flex-1 flex-col">
              <div className="flashcard-body-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scrollbar-thin">
                <div data-card-metadata className="flashcard-meta">
                  {partOfSpeech && <span lang={targetLanguage}>{partOfSpeech}</span>}
                  {card.category && <span className="flashcard-meta-category"><span aria-hidden="true">{'// '}</span><span lang={targetLanguage}>{card.category}</span></span>}
                </div>
                {resolvedMode === 'target-to-native' ? (
                  <CardHeadword card={card} onPlayAudio={event => { event.stopPropagation(); onPlayPrompt(); }} />
                ) : (
                  <div data-card-headword data-recall-prompt={resolvedMode === 'cloze' ? 'sentence' : 'word'} className="flashcard-headword">
                    <h2 lang={promptLanguage} style={headwordStyle} className="flashcard-headword-word flashcard-word-gradient flashcard-recall-prompt-text break-words text-balance [overflow-wrap:anywhere]">{promptText}</h2>
                    {playAudio && (
                      <div data-card-pronunciation className="flashcard-pronunciation flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                          type="button"
                          onClick={onPlayPrompt}
                          className="flashcard-play-button touch-manipulation flex size-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
                          aria-label={_(msg({ id: 'flashcard.recall.play-word', message: 'Play word for listening practice' }))}
                        >
                          <Volume2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flashcard-definition flashcard-recall-slot relative text-left">
                  <p id="recall-instruction" className="flashcard-recall-instruction">{instruction}</p>
                  <p className="sr-only"><Trans {...msg({ context: 'flashcard.recall.instructions', message: 'Recall first, then type your answer to check it.' })} /></p>
                  {form}
                  <p data-recall-result={answerCorrect === null ? undefined : answerCorrect ? 'correct' : 'incorrect'} className="flashcard-recall-result" aria-live="polite">{answerResult}</p>
                </div>
              </div>

              <div className="flashcard-reveal-dock shrink-0">
                <button
                  type="button"
                  onClick={onReveal}
                  className="flashcard-reveal group/flip relative z-20 flex min-h-[58px] w-full cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--sf-brand)]"
                >
                  <span className="flashcard-reveal-shine pointer-events-none absolute" aria-hidden="true" />
                  <svg className="relative" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l3 7.1 7.7.6-5.9 5 1.8 7.5L12 17.7l-6.6 4 1.8-7.5-5.9-5 7.7-.6z" fill="currentColor" /><path d="M12 1.5l3 7.1-3 9.1z" fill="var(--sf-reward)" /></svg>
                  <span className="relative"><Trans {...msg({ context: 'flashcard.recall.reveal', message: 'Reveal answer' })} /></span>
                  <kbd className="flashcard-kbd relative font-mono" aria-hidden="true"><Trans {...msg({ context: 'flashcard.shortcut.space', message: 'Space' })} /></kbd>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
