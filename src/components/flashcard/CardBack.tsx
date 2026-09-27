import { BookOpen, ChevronRight, Languages, Loader2, Mic, Sparkles, Volume2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { Dispatch, MouseEvent, PointerEvent, RefObject, SetStateAction } from 'react';
import { isAccountSignedIn } from '../../features/account/accountDataService';
import type { LearningStateOutcome } from '../../features/learning/learningStateController';
import { isCardDue } from '../../lib/srs';
import type { CardData } from '../../types/card';
import { RecoverableActionFeedback } from '../RecoverableActionFeedback';
import { CardEffectsLayer } from './CardEffectsLayer';
import { CardTierBadge, type CardTier } from './CardFront';
import { CardHeadword } from './CardHeadword';
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
  canDelete: boolean;
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
  backFlipRef: RefObject<HTMLButtonElement | null>;
  focusAfterFlipRef: RefObject<'front' | 'back' | null>;
  showCardSide: (side: 'front' | 'back') => void;
}

export function CardBack({
  isZenMode, tier, data, faceRef, spotlightRef, spotlightBackground, isHovered, canDelete, onUpdateCard,
  setShowReportDialog, setShowEditDialog, audioSpeed, toggleAudioSpeed, playAudio, isPlayingAudio,
  startPronunciationCheck, isRecording, pronunciationError, isTranslating, translationError,
  translateExplanation, setTranslationError, learningDetailsButtonRef, setShowLearningDetails,
  setShowAiModal, backFlipRef, focusAfterFlipRef, showCardSide,
}: CardBackProps) {
  const { _, i18n } = useLingui();
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
  return (
    <div
      ref={faceRef}
      data-card-face="back"
      data-card-mode="standard"
      style={{ transformOrigin: 'center center', borderRadius: '32px' }}
      className="flashcard-panel flashcard-back absolute inset-0 isolate box-border flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[32px] text-slate-900 dark:text-white"
    >

          {/* Diagonal Glass Sheen Reflection */}
          <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-gradient-to-br from-white/[0.08] via-transparent to-transparent opacity-70 z-10" aria-hidden="true" />

          <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
          <div className="pointer-events-none absolute -bottom-20 -right-20 size-72 rounded-full border border-slate-200/40 bg-slate-100/20 dark:border-white/10 dark:bg-white/5" aria-hidden="true" />
          <div className={`absolute top-5 z-20 flex flex-wrap items-center gap-2 ${canDelete ? 'left-16' : 'left-5'}`}>
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">
              <Languages size={13} aria-hidden="true" /> <Trans id="flashcard.language.vietnamese" message="Vietnamese" />
            </div>
              {data.nextReviewDate && isCardDue(data) && (
                <div className="bg-rose-600/95 dark:bg-rose-950/80 text-white dark:text-rose-200 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase border border-rose-400/20 dark:border-rose-800/40 shadow-sm flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-400"></span>
                  </span>
                  <span><Trans id="flashcard.status.overdue" message="Review overdue" /></span>
                </div>
              )}
          </div>
          <div data-card-content="revealed" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-16 text-center scrollbar-thin sm:px-7">
            <section data-card-section="meaning" aria-labelledby={`flashcard-meaning-${data.id}`} className="relative mx-auto w-full max-w-xl px-1 pb-3 pt-2 text-center sm:px-3">
              <p id={`flashcard-meaning-${data.id}`} className="relative text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300"><Trans id="flashcard.meaning.vietnamese" message="Vietnamese meaning" /></p>
              <h2 data-translation-reveal lang={data.translationLanguage || 'vi'} className="flashcard-translation-gradient flashcard-translation-reveal relative mt-1 break-words text-balance text-3xl font-black tracking-[-0.04em] drop-shadow-xs first-letter:uppercase [overflow-wrap:anywhere] sm:text-4xl">
                {data.translation}
              </h2>
              {data.origin === 'ai' && (
                <p data-ai-disclosure className="relative mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <Trans id="flashcard.ai-disclosure" message="AI-generated content may be incorrect. Please check the meaning." />
                </p>
              )}
              <div className="relative mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
                <p className="sr-only"><Trans id="flashcard.original-word" message="Original word" /></p>
                <p lang={data.language || 'en'} className="break-words text-base font-black text-slate-900 dark:text-white [overflow-wrap:anywhere] sm:text-lg">{data.word}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center rounded-full p-1 border border-slate-200/90 bg-slate-100/90 dark:border-white/15 dark:bg-white/[0.08] backdrop-blur-md shadow-xs transition-all">
                    <button
                      type="button"
                      data-card-control
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={toggleAudioSpeed}
                      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                      className={`touch-manipulation flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full px-2.5 text-xs font-black transition-all cursor-pointer ${
                        audioSpeed === 0.75 ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
                      }`}
                      title={_(msg({ id: 'flashcard.audio.toggle-speed-back', message: 'Toggle speed (1.0x / 0.75x slow)' }))}
                      aria-label={_(msg({ id: 'flashcard.audio.toggle-speed', message: 'Toggle speed' }))}
                    >
                      {`${audioSpeed}×`}
                    </button>
                    <span className="mx-1 h-3.5 w-px bg-slate-300 dark:bg-white/10" aria-hidden="true" />
                    <button
                      type="button"
                      data-card-control
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={playAudio}
                      data-card-effect="audio"
                      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                      className={`touch-manipulation flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-black transition-all cursor-pointer ${
                        isPlayingAudio ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]' : 'text-[var(--sf-brand-text)] hover:bg-cyan-500/10'
                      }`}
                      aria-label={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
                      title={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
                    >
                      {isPlayingAudio ? (
                        <span className="flex items-center gap-0.5 h-3" aria-hidden="true">
                          <span className="w-0.5 h-full rounded-full bg-cyan-600 dark:bg-cyan-400 wave-bar-1" />
                          <span className="w-0.5 h-full rounded-full bg-cyan-600 dark:bg-cyan-400 wave-bar-2" />
                          <span className="w-0.5 h-full rounded-full bg-cyan-600 dark:bg-cyan-400 wave-bar-3" />
                          <span className="w-0.5 h-full rounded-full bg-cyan-600 dark:bg-cyan-400 wave-bar-4" />
                        </span>
                      ) : (
                        <Volume2 size={13} />
                      )}
                    </button>
                    <span className="mx-1 h-3.5 w-px bg-slate-300 dark:bg-white/10" aria-hidden="true" />
                    <button
                      type="button"
                      data-card-control
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={startPronunciationCheck}
                      disabled={isRecording}
                      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                      className={`touch-manipulation flex size-12 items-center justify-center rounded-full transition-all cursor-pointer ${
                        isRecording ? 'bg-rose-500 text-white animate-pulse' : 'text-[var(--sf-text)] hover:text-rose-500 hover:bg-rose-500/10'
                      }`}
                      aria-label={_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}
                      title={_(msg({ id: 'flashcard.audio.practice-pronunciation', message: 'Practise pronunciation' }))}
                    >
                      <Mic size={13} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="relative flex flex-wrap items-center justify-center gap-1 text-center">
                {isAccountSignedIn() && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowReportDialog(true)} className="min-h-11 px-3 text-xs font-bold text-rose-800 underline underline-offset-4 dark:text-rose-200"><Trans id="flashcard.report" message="Report incorrect card" /></button>}
                {onUpdateCard && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowEditDialog(true)} className="min-h-11 px-3 text-xs font-bold text-cyan-800 underline underline-offset-4 dark:text-cyan-200"><Trans id="flashcard.edit" message="Edit card" /></button>}
              </div>
               {pronunciationError && <p className="mt-2 text-pretty text-xs font-semibold text-rose-600 dark:text-rose-100" role="alert">{pronunciationError}</p>}
            </section>

            <section data-card-section="explanation" aria-labelledby={`flashcard-explanation-${data.id}`} className="mx-auto mt-4 flex w-full max-w-xl flex-col items-start text-left">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-cyan-700 dark:border-white/10 dark:bg-white/10 dark:text-cyan-300" aria-hidden="true"><Languages size={15} /></span>
                <div>
                  <p id={`flashcard-explanation-${data.id}`} className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-700 dark:text-slate-200"><Trans id="flashcard.explanation.vietnamese" message="Explanation in Vietnamese" /></p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-300"><Trans id="flashcard.explanation.subtitle" message="Natural translations and usage notes" /></p>
                </div>
              </div>
              {data.explanationTranslation ? (
                <RichVietnameseExplanation value={data.explanationTranslation} lang={data.translationLanguage || 'vi'} />
              ) : (
                <>
                  <button
                    type="button"
                    data-card-control
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={translateExplanation}
                    className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-cyan-400 bg-cyan-400 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#071014] shadow-sm shadow-cyan-500/20 transition-[background-color,box-shadow] duration-200 hover:bg-cyan-300"
                  >
                    {isTranslating ? (
                      <><Loader2 size={13} className="animate-spin" /><span><Trans id="flashcard.translating" message="Translating…" /></span></>
                    ) : (
                      <><Languages size={13} /><span><Trans id="flashcard.translate-explanation" message="Translate explanation" /></span></>
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

            <section data-card-section="memory-hook" aria-label={_(msg({ id: 'flashcard.memory-hook', message: 'Memory hook' }))}>
              <CardMnemonicSection card={data} onUpdateCard={onUpdateCard} />
            </section>

            <details data-card-disclosure="learning-tools" className="flashcard-disclosure group/disclosure mt-2 text-left">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-brand)] [&::-webkit-details-marker]:hidden">
                <BookOpen size={16} className="shrink-0 text-slate-600 dark:text-slate-300" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 dark:text-slate-200"><Trans id="flashcard.explore-more" message="Explore more" /></span>
                  <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500 dark:text-slate-300"><Trans id="flashcard.explore-more-description" message="Context, nuance and AI tutoring" /></span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-slate-400 transition-transform duration-200 group-open/disclosure:rotate-90" aria-hidden="true" />
              </summary>
              <div className="border-t border-slate-200/80 p-2 dark:border-white/10">
                {(data.partOfSpeech || data.cefrLevel || data.exampleSentence || data.collocations?.length || data.synonyms?.length || data.antonyms?.length || data.commonMistake) && (
                  <button
                    ref={learningDetailsButtonRef}
                    type="button"
                    data-card-control
                    aria-label={_(msg({ id: 'flashcard.learning-details-label', message: 'Learning details: examples, collocations and nuances' }))}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={() => setShowLearningDetails(true)}
                    className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-slate-800 outline-none transition-colors duration-200 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-brand)] dark:text-slate-100 dark:hover:bg-white/[0.07]"
                  >
                    <BookOpen size={15} className="shrink-0 text-slate-500 dark:text-slate-300" />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-bold"><Trans id="flashcard.lexicon-context" message="Lexicon context" /></span><span className="block truncate text-[11px] text-slate-500 dark:text-slate-300"><Trans id="flashcard.lexicon-context-description" message="Examples, collocations & nuances" /></span></span>
                    <ChevronRight size={15} className="text-slate-400" />
                  </button>
                )}
                <button
                  type="button"
                  data-card-control
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => setShowAiModal(true)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-slate-800 outline-none transition-colors duration-200 hover:bg-cyan-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-brand)] dark:text-slate-100 dark:hover:bg-cyan-400/10"
                >
                  <Sparkles size={15} className="shrink-0 text-cyan-700 dark:text-cyan-300" />
                  <span className="min-w-0 flex-1"><span className="block text-xs font-bold"><Trans id="flashcard.ask-ai-tutor" message="Ask AI Tutor" /></span><span className="block truncate text-[11px] text-slate-500 dark:text-slate-300"><Trans id="flashcard.ask-ai-tutor-description" message="Business examples, nuance & synonyms" /></span></span>
                  <ChevronRight size={15} className="text-slate-400" />
                </button>
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
            className="group/back relative z-20 flex min-h-[60px] w-full flex-shrink-0 cursor-pointer items-center justify-center gap-2 border-x-0 border-b-0 border-t border-cyan-500/20 bg-transparent px-4 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 outline-none transition-colors duration-200 hover:border-cyan-500/45 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-brand)] dark:border-cyan-300/15 dark:hover:border-cyan-300/45 dark:text-slate-400 dark:hover:text-slate-200"
            aria-label={i18n._(msg({ id: 'flashcard.return-to-english-label', message: 'Return to the English side of {word}' }).id, { word: data.word })}
          >
            <span
              data-return-hover-edge
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-500/10 via-cyan-400/55 to-cyan-500/10 opacity-75 transition-opacity duration-200 group-hover/back:opacity-100 motion-reduce:transition-none dark:from-cyan-300/10 dark:via-cyan-300/55 dark:to-cyan-300/10"
              aria-hidden="true"
            />
            <ChevronRight size={16} className="rotate-180 transition-transform duration-200 group-hover/back:-translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true" />
            <span><Trans id="flashcard.back-to-english" message="Back to English" /></span>
          </button>

    </div>
  );
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
  const { _ } = useLingui();
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
                <span><Trans id="flashcard.language.vietnamese" message="Vietnamese" /></span>
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
                  <Trans id="flashcard.ai-disclosure" message="AI-generated content may be incorrect. Please check the meaning." />
                </p>
              )}
              {isAccountSignedIn() && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowReportDialog(true)} className="mt-2 min-h-11 px-3 text-xs font-bold text-cyan-100 underline underline-offset-4">
                <Trans id="flashcard.report" message="Report incorrect card" />
              </button>}
              {onUpdateCard && <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowEditDialog(true)} className="mt-2 min-h-11 px-3 text-xs font-bold text-cyan-100 underline underline-offset-4"><Trans id="flashcard.edit" message="Edit card" /></button>}

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
                onPointerDown={e => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  focusAfterFlipRef.current = 'front';
                  showCardSide('front');
                }}
                className="relative group inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 bg-white/10 px-9 py-2.5 text-sm font-medium tracking-wide text-white/95 shadow-[0_12px_35px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 hover:bg-white/20 hover:scale-105 active:scale-95 cursor-pointer"
              >
                <span><Trans id="flashcard.return-to-english" message="Return to English" /></span>
                <span
                  className="absolute -bottom-px left-[22%] right-[22%] h-[2.5px] rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee,0_0_24px_#06b6d4] transition-all duration-300 group-hover:left-[16%] group-hover:right-[16%]"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
  );
}
