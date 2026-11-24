import { BookOpen, ChevronRight, Languages, Loader2, Mic, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { Dispatch, MouseEvent, PointerEvent, ReactNode, RefObject, SetStateAction } from 'react';
import { isAccountSignedIn } from '../../features/account/accountDataService';
import type { LearningStateOutcome } from '../../features/learning/learningStateController';
import { localizeSpeechMessage } from './localizeSpeechMessage';
import { isCardDue } from '../../lib/srs';
import type { CardData } from '../../types/card';
import { RecoverableActionFeedback } from '../RecoverableActionFeedback';
import { CardEffectsLayer } from './CardEffectsLayer';
import { CardTierBadge, type CardTier } from './CardFront';
import { CardHeadword } from './CardHeadword';
import { cardExplanationSectionLabel, cardInMeaningLanguage, cardMeaningLanguageName, cardMeaningSectionLabel, cardReturnLabel, cardTargetLanguageKey, isLanguagePackCard } from './cardLanguage';
import { useCardLook } from './cardLook';
import { buildExampleSegments } from './languageCardReading';
import { cardTextLang, useLanguageCardReading } from './LanguageCardFace';
import { CardMnemonicSection } from './CardMnemonicSection';
import { RichVietnameseExplanation } from './RichVietnameseExplanation';

interface CardBackProps {
  isZenMode: boolean;
  tier: CardTier;
  data: CardData;
  faceRef: RefObject<HTMLDivElement | null>;
  spotlightRef: RefObject<HTMLDivElement | null>;
  spotlightBackground: string;
  isHovered: boolean;
  onUpdateCard?: (cardId: string, updatedFields: Partial<CardData>) => void | Promise<LearningStateOutcome>;
  setShowReportDialog: Dispatch<SetStateAction<boolean>>;
  setShowEditDialog: (open: boolean) => void;
  audioSpeed: 1 | 0.75;
  toggleAudioSpeed: (event: MouseEvent | PointerEvent) => void;
  playAudio: (event: MouseEvent | PointerEvent) => void;
  isPlayingAudio: boolean;
  startPronunciationCheck: (event: MouseEvent | PointerEvent, targetType?: 'word' | 'explanation') => void;
  isRecording: boolean;
  pronunciationError: string | null;
  isTranslating: boolean;
  translationError: string | null;
  translateExplanation: (event?: MouseEvent<HTMLButtonElement>) => Promise<void>;
  setTranslationError: Dispatch<SetStateAction<string | null>>;
  learningDetailsButtonRef: RefObject<HTMLButtonElement | null>;
  setShowLearningDetails: Dispatch<SetStateAction<boolean>>;
  setShowAiModal: Dispatch<SetStateAction<boolean>>;
  aiTutorButtonRef: RefObject<HTMLButtonElement | null>;
  backFlipRef: RefObject<HTMLButtonElement | null>;
  focusAfterFlipRef: RefObject<'front' | 'back' | null>;
  showCardSide: (side: 'front' | 'back') => void;
}

export function CardBack({
  isZenMode, tier, data, faceRef, spotlightRef, spotlightBackground, isHovered, onUpdateCard,
  setShowReportDialog, setShowEditDialog, audioSpeed, toggleAudioSpeed, playAudio, isPlayingAudio,
  startPronunciationCheck, isRecording, pronunciationError, isTranslating, translationError,
  translateExplanation, setTranslationError, learningDetailsButtonRef, setShowLearningDetails,
  setShowAiModal, aiTutorButtonRef, backFlipRef, focusAfterFlipRef, showCardSide,
}: CardBackProps) {
  const { _, i18n } = useLingui();
  const reading = useLanguageCardReading(data);
  if (isZenMode) return <ZenCardBack
    tier={tier}
    data={data}
    faceRef={faceRef}
    spotlightRef={spotlightRef}
    spotlightBackground={spotlightBackground}
    isHovered={isHovered}
    playAudio={playAudio}
    isPlayingAudio={isPlayingAudio}
    onUpdateCard={onUpdateCard}
    setShowReportDialog={setShowReportDialog}
    setShowEditDialog={setShowEditDialog}
    backFlipRef={backFlipRef}
    focusAfterFlipRef={focusAfterFlipRef}
    showCardSide={showCardSide}
  />;
  const look = useCardLook();
  const sourceLanguage = data.language || 'en';
  const meaningLanguage = data.translationLanguage || 'vi';
  const isPackCard = isLanguagePackCard(data);
  const backReading = isPackCard ? reading?.backReading ?? data.phonetic : null;
  const isDue = Boolean(data.nextReviewDate) && isCardDue(data);
  const hasLearningDetails = Boolean(data.partOfSpeech || data.cefrLevel || data.exampleSentence || data.collocations?.length || data.synonyms?.length || data.antonyms?.length || data.commonMistake);
  return (
    <div
      ref={faceRef}
      data-card-face="back"
      data-card-mode="standard"
      data-card-look={look}
      data-card-kind={isPackCard ? 'language' : undefined}
      style={{ transformOrigin: 'center center', borderRadius: 'var(--flashcard-radius, 34px)' }}
      className="flashcard-panel flashcard-back absolute inset-0 isolate box-border flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[var(--flashcard-radius,34px)]"
    >
      <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
      {/* The Crystal board's back carries a slow light beam and a faint star mark behind the content. */}
      {look === 'crystal' && (
        <>
          <span className="flashcard-back-beam" aria-hidden="true" />
          <span className="flashcard-back-star crystal-star-art" aria-hidden="true" />
        </>
      )}
      <div className="flashcard-back-header relative z-20 flex shrink-0 flex-wrap items-center">
        <span className="flashcard-back-language">
          {/* The language card's ink back keeps the dot too (LangCard.dc.html 188). */}
          {(look === 'aurora' || (isPackCard && look === 'paper')) && <span className="flashcard-back-language-dot" aria-hidden="true" />}
          {isPackCard ? cardInMeaningLanguage(i18n, data) : cardMeaningLanguageName(i18n, data)}
        </span>
        {isDue && (
          <span data-card-status="due" className="flashcard-back-due">
            <Trans {...msg({ context: 'flashcard.status.due', message: 'Due for review' })} />
          </span>
        )}
      </div>

      <div data-card-content="revealed" className="flashcard-back-scroll relative z-20 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scrollbar-thin">
        <section data-card-section="meaning" aria-labelledby={`flashcard-meaning-${data.id}`} className="flashcard-back-meaning flex w-full flex-col">
          <p id={`flashcard-meaning-${data.id}`} className="sr-only">{cardMeaningSectionLabel(i18n, data)}</p>
          <h2 data-translation-reveal lang={meaningLanguage} className="flashcard-back-translation flashcard-translation-reveal break-words text-balance first-letter:uppercase [overflow-wrap:anywhere]">
            {data.translation}
          </h2>
          {(look === 'paper' || look === 'aurora') && <span className="flashcard-back-ink-rule" aria-hidden="true" />}
          <div className="flashcard-back-source flex flex-wrap items-center">
            <span lang={sourceLanguage} className="flashcard-back-word">{data.word}</span>
            {isPackCard
              ? backReading && <span data-card-back-reading className="flashcard-back-reading">{backReading}</span>
              : <>
                {data.partOfSpeech && <span lang={sourceLanguage} className="flashcard-back-pos">{data.partOfSpeech}</span>}
                {data.phonetic && <span lang={sourceLanguage} className="flashcard-back-ipa font-mono">{data.phonetic}</span>}
              </>}
            <button
              type="button"
              data-card-control
              data-card-effect="audio"
              data-playing={isPlayingAudio ? 'true' : 'false'}
              onPointerDown={event => event.stopPropagation()}
              onClick={playAudio}
              className="flashcard-back-play touch-manipulation flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              aria-label={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
            >
              {isPlayingAudio
                ? <span data-audio-waves="active" className="flex h-3 items-center gap-0.5" aria-hidden="true"><span className="wave-bar-1 w-0.5 rounded-full bg-current" /><span className="wave-bar-2 w-0.5 rounded-full bg-current" /><span className="wave-bar-3 w-0.5 rounded-full bg-current" /><span className="wave-bar-4 w-0.5 rounded-full bg-current" /></span>
                : look === 'crystal'
                  ? <Volume2 size={16} aria-hidden="true" />
                  // The Classic boards play the word from a filled triangle (Aurora 13px, Atelier 12px).
                  : <svg width={look === 'paper' ? 12 : 13} height={look === 'paper' ? 12 : 13} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
            </button>
          </div>
          {data.origin === 'ai' && (
            <p data-ai-disclosure className="flashcard-back-note">
              <Trans {...msg({ context: 'flashcard.ai-disclosure', message: 'AI-generated content may be incorrect. Please check the meaning.' })} />
            </p>
          )}
          {pronunciationError && <p className="flashcard-back-error text-pretty" role="alert">{localizeSpeechMessage(pronunciationError, _)}</p>}
        </section>

        {(data.exampleSentence || data.exampleTranslation) && (
          <figure data-card-section="example" className="flashcard-back-example">
            {data.exampleSentence && (isPackCard ? (
              <blockquote lang={cardTextLang(data)} className="flashcard-back-example-text flashcard-lang-example-text">
                {buildExampleSegments(data.exampleSentence, data, cardTargetLanguageKey(data) as 'ko' | 'ja' | 'zh', reading).map((segment, index) => !segment.highlight
                  ? <span key={index}>{segment.text}</span>
                  : segment.ruby
                    ? <ruby key={index} data-example-word className="flashcard-back-example-word">{segment.text}<rt className="flashcard-lang-example-rt">{segment.ruby}</rt></ruby>
                    : <span key={index} data-example-word className="flashcard-back-example-word">{segment.text}</span>)}
              </blockquote>
            ) : (
              <blockquote lang={sourceLanguage} className="flashcard-back-example-text">
                <span aria-hidden="true">“</span><span>{highlightWord(data.exampleSentence, data.word)}</span><span aria-hidden="true">”</span>
              </blockquote>
            ))}
            {data.exampleTranslation && <figcaption lang={meaningLanguage} className="flashcard-back-example-translation">{data.exampleTranslation}</figcaption>}
          </figure>
        )}

        <section data-card-section="explanation" aria-labelledby={`flashcard-explanation-${data.id}`} className="flashcard-back-explanation flex w-full flex-col items-start text-left">
          <p id={`flashcard-explanation-${data.id}`} className="sr-only">{cardExplanationSectionLabel(i18n, data)}</p>
          {data.explanationTranslation ? (
            <RichVietnameseExplanation value={data.explanationTranslation} lang={meaningLanguage} />
          ) : (
            <>
              <button
                type="button"
                data-card-control
                onPointerDown={(e) => e.stopPropagation()}
                onClick={translateExplanation}
                className="flashcard-back-translate flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              >
                {isTranslating ? (
                  <><Loader2 size={14} className="animate-spin" aria-hidden="true" /><span><Trans {...msg({ context: 'flashcard.translating', message: 'Translating…' })} /></span></>
                ) : (
                  <><Languages size={14} aria-hidden="true" /><span><Trans {...msg({ context: 'flashcard.translate-explanation', message: 'Translate explanation' })} /></span></>
                )}
              </button>
              {translationError ? (
                <RecoverableActionFeedback
                  message={translationError}
                  retryLabel={_(msg({ id: 'flashcard.try-again', message: 'Try again' }))}
                  onRetry={() => void translateExplanation()}
                  dismissLabel={_(msg({ id: 'flashcard.dismiss-translation-error', message: 'Dismiss translation error' }))}
                  onDismiss={() => setTranslationError(null)}
                  className="w-full"
                />
              ) : null}
            </>
          )}
        </section>

        <div className="flashcard-back-tools grid grid-cols-2 items-start gap-2">
          <section data-card-section="memory-hook" aria-label={_(msg({ id: 'flashcard.memory-hook', message: 'Memory hook' }))} className={`min-w-0 ${data.mnemonic ? 'col-span-2' : ''}`}>
            <CardMnemonicSection card={data} onUpdateCard={onUpdateCard} />
          </section>
          <button
            ref={aiTutorButtonRef}
            type="button"
            data-card-control
            onPointerDown={event => event.stopPropagation()}
            onClick={() => setShowAiModal(true)}
            className={`flashcard-back-tool flashcard-back-tutor flex min-h-11 min-w-0 items-center justify-center gap-2 transition-[background-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] ${data.mnemonic ? 'col-span-2' : ''}`}
          >
            <Sparkles size={15} className="flashcard-back-tutor-icon shrink-0" aria-hidden="true" />
            <span className="truncate"><Trans {...msg({ context: 'flashcard.ask-ai-tutor', message: 'Ask AI Tutor' })} /></span>
          </button>
        </div>

        <details data-card-disclosure="learning-tools" className="flashcard-back-more group/disclosure text-left">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--sf-brand)] [&::-webkit-details-marker]:hidden">
            <BookOpen size={15} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1"><Trans {...msg({ context: 'flashcard.explore-more', message: 'Explore more' })} /></span>
            <ChevronRight size={15} className="shrink-0 transition-transform duration-200 group-open/disclosure:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="flashcard-back-more-panel">
            {hasLearningDetails && (
              <button
                ref={learningDetailsButtonRef}
                type="button"
                data-card-control
                aria-label={_(msg({ id: 'flashcard.learning-details-label', message: 'Learning details: examples, collocations and nuances' }))}
                onPointerDown={event => event.stopPropagation()}
                onClick={() => setShowLearningDetails(true)}
                className="flashcard-back-more-item flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--sf-brand)]"
              >
                <BookOpen size={15} className="shrink-0 text-[var(--sf-text-muted)]" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-xs font-bold"><Trans {...msg({ context: 'flashcard.lexicon-context', message: 'Lexicon context' })} /></span><span className="block truncate text-[11px] text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'flashcard.lexicon-context-description', message: 'Examples, collocations & nuances' })} /></span></span>
                <ChevronRight size={15} className="text-[var(--sf-text-muted)]" aria-hidden="true" />
              </button>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2 px-1 pt-1">
              <button type="button" data-card-control aria-pressed={audioSpeed === 0.75} onPointerDown={event => event.stopPropagation()} onClick={toggleAudioSpeed} className="flashcard-back-more-item min-h-11 min-w-11 rounded-full px-3 font-mono text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]" aria-label={_(msg({ id: 'flashcard.audio.toggle-speed', message: 'Toggle speed' }))}>{`${audioSpeed}×`}</button>
              <button type="button" data-card-control data-recording={isRecording ? 'true' : 'false'} onPointerDown={event => event.stopPropagation()} onClick={startPronunciationCheck} disabled={isRecording} className="flashcard-back-more-item flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]" aria-label={_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}><Mic size={14} aria-hidden="true" /></button>
              {isAccountSignedIn() && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowReportDialog(true)} className="flashcard-back-more-item flashcard-back-report min-h-11 rounded-full px-3 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"><Trans {...msg({ context: 'flashcard.report', message: 'Report incorrect card' })} /></button>}
              {onUpdateCard && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowEditDialog(true)} className="flashcard-back-more-item min-h-11 rounded-full px-3 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"><Trans {...msg({ id: 'flashcard.edit', message: 'Edit card' })} /></button>}
            </div>
          </div>
        </details>
      </div>

      <button
        ref={backFlipRef}
        type="button"
        data-flip-card
        data-return-to-english
        onClick={(event) => {
          event.stopPropagation();
          focusAfterFlipRef.current = 'front';
          showCardSide('front');
        }}
        className="flashcard-back-return group/back relative z-20 flex w-full shrink-0 cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--sf-brand)]"
        aria-label={cardReturnLabel(i18n, data)}
      >
        {look === 'aurora' && <span data-return-hover-edge className="flashcard-reveal-laser pointer-events-none absolute" aria-hidden="true" />}
        {(look === 'crystal' || look === 'aurora' || isPackCard) && (
          <RotateCcw size={15} strokeWidth={2.2} aria-hidden="true" />
        )}
        <span>
          {cardTargetLanguageKey(data) === 'en'
            ? <Trans {...msg({ context: 'flashcard.back-to-english', message: 'Back to English' })} />
            : <Trans {...msg({ context: 'flashcard.back-to-front', message: 'Back to front' })} />}
        </span>
      </button>
    </div>
  );
}

/** Marks each case-insensitive occurrence of the card's word inside its example sentence. */
function highlightWord(sentence: string, word: string): ReactNode {
  const target = word.trim();
  if (!target) return sentence;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(${escaped})`, 'giu');
  const parts = sentence.split(pattern);
  if (parts.length === 1) return sentence;
  return parts.map((part, index) => index % 2 === 1
    ? <span key={index} data-example-word className="flashcard-back-example-word">{part}</span>
    : part);
}

function ZenCardBack({
  tier,
  data,
  faceRef,
  spotlightRef,
  spotlightBackground,
  isHovered,
  playAudio,
  isPlayingAudio,
  onUpdateCard,
  setShowReportDialog,
  setShowEditDialog,
  backFlipRef,
  focusAfterFlipRef,
  showCardSide,
}: Pick<CardBackProps, 'tier' | 'data' | 'faceRef' | 'spotlightRef' | 'spotlightBackground' | 'isHovered' | 'playAudio' | 'isPlayingAudio' | 'onUpdateCard' | 'setShowReportDialog' | 'setShowEditDialog' | 'backFlipRef' | 'focusAfterFlipRef' | 'showCardSide'>) {
  const { _, i18n } = useLingui();
  const isEnglishCard = cardTargetLanguageKey(data) === 'en';
  return (
<div
            ref={faceRef}
            data-card-face="back"
            data-card-mode="zen"
            style={{ transformOrigin: 'center center', borderRadius: '32px' }}
            className="flashcard-panel flashcard-back zen-glass-slab relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[32px] p-7 pt-16 sm:p-9 sm:pt-16 text-center text-white select-none"
          >
            <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
            {/* Top Rim Specular Star Sparkle from Mockup */}
            <div className="pointer-events-none absolute left-[22%] -top-2.5 z-30 flex items-center justify-center" aria-hidden="true">
              <span className="text-white text-base font-black drop-shadow-[0_0_8px_#ffffff] select-none">✦</span>
              <span className="absolute size-6 rounded-full bg-white/35 blur-sm" />
            </div>

            <div className="flex w-full items-center justify-between z-20">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-300">
                <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                <span>{cardMeaningLanguageName(i18n, data)}</span>
              </div>
              <CardTierBadge tier={tier} />
            </div>

            {/* Center Section: Word in Playfair Serif, Meaning, Definition */}
            <div data-card-content="revealed" className="my-auto flex min-h-0 flex-1 flex-col items-center justify-[safe_center] overflow-y-auto overscroll-contain py-2 z-20">
              <CardHeadword card={data} variant="zen-back" />

              {/* Large Vietnamese Meaning */}
              <div className="mt-4 max-w-lg rounded-2xl border border-white/15 bg-white/10 p-4 sm:p-5 backdrop-blur-xl text-center shadow-2xl">
                <p lang={data.translationLanguage || 'vi'} className="text-2xl sm:text-3xl font-bold text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.4)]">
                  {data.translation || data.word}
                </p>
                {data.explanationTranslation && (
                  <p lang={data.translationLanguage || 'vi'} className="mt-2 text-sm sm:text-base leading-relaxed text-slate-100/90 font-normal">
                    {data.explanationTranslation}
                  </p>
                )}
                <button
                  type="button"
                  data-card-control
                  data-card-effect="audio"
                  onPointerDown={event => event.stopPropagation()}
                  onClick={playAudio}
                  className="mx-auto mt-3 flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 text-cyan-200 transition-colors hover:bg-cyan-400/20"
                  aria-label={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
                >
                  {isPlayingAudio ? (
                    <span data-audio-waves="active" className="flex h-3 items-center gap-0.5" aria-hidden="true">
                      <span className="wave-bar-1 w-0.5 rounded-full bg-current" />
                      <span className="wave-bar-2 w-0.5 rounded-full bg-current" />
                      <span className="wave-bar-3 w-0.5 rounded-full bg-current" />
                      <span className="wave-bar-4 w-0.5 rounded-full bg-current" />
                    </span>
                  ) : <Volume2 size={14} aria-hidden="true" />}
                </button>
              </div>
              {data.origin === 'ai' && (
                <p data-ai-disclosure className="mt-3 max-w-lg text-xs font-medium text-cyan-100/90">
                  <Trans {...msg({ context: 'flashcard.ai-disclosure', message: 'AI-generated content may be incorrect. Please check the meaning.' })} />
                </p>
              )}
              {isAccountSignedIn() && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowReportDialog(true)} className="mt-2 min-h-11 px-3 text-xs font-bold text-cyan-100 underline underline-offset-4">
                <Trans {...msg({ context: 'flashcard.report', message: 'Report incorrect card' })} />
              </button>}
              {onUpdateCard && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowEditDialog(true)} className="mt-2 min-h-11 px-3 text-xs font-bold text-cyan-100 underline underline-offset-4"><Trans {...msg({ id: 'flashcard.edit', message: 'Edit card' })} /></button>}

              {/* Memory Hook / Mnemonic if available */}
              {data.mnemonic && (
                <p lang={data.translationLanguage || 'vi'} className="mt-3.5 max-w-md text-xs sm:text-sm leading-relaxed text-amber-200/95 italic">
                  💡 {data.mnemonic}
                </p>
              )}
            </div>

            {/* Bottom Row: Return to English Capsule Button */}
            <div className="flex justify-center pb-2 z-20">
              <button
                ref={backFlipRef}
                type="button"
                data-card-control
                data-return-to-english="true"
                aria-label={isEnglishCard ? undefined : cardReturnLabel(i18n, data)}
                onPointerDown={e => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  focusAfterFlipRef.current = 'front';
                  showCardSide('front');
                }}
                className="relative group inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 bg-white/10 px-9 py-2.5 text-sm font-medium tracking-wide text-white/95 shadow-[0_12px_35px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 hover:bg-white/20 hover:scale-105 active:scale-95 cursor-pointer"
              >
                <span>
                  {isEnglishCard
                    ? <Trans {...msg({ context: 'flashcard.return-to-english', message: 'Return to English' })} />
                    : <Trans {...msg({ context: 'flashcard.back-to-front', message: 'Back to front' })} />}
                </span>
                <span
                  className="absolute -bottom-px left-[22%] right-[22%] h-[2.5px] rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee,0_0_24px_#06b6d4] transition-all duration-300 group-hover:left-[16%] group-hover:right-[16%]"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
  );
}
