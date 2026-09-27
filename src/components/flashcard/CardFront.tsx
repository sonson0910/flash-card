import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { CheckCircle2, EyeOff, FolderOpen, FolderX, ImageOff, Languages, Mic, Sparkles, Volume2, X } from 'lucide-react';
import type { Dispatch, MouseEvent, PointerEvent, RefObject, SetStateAction } from 'react';
import { isCardDue } from '../../lib/srs';
import { useTheme } from '../../features/theme/ThemeProvider';
import type { CardData } from '../../types/card';
import { ActiveRecallQuiz } from './ActiveRecallQuiz';
import { CardEffectsLayer } from './CardEffectsLayer';
import { CardHeadword } from './CardHeadword';
import { CardImage } from './CardImage';
import { SpeechMatchFeedback, type SpeechMatchFeedbackValue } from './SpeechMatchFeedback';

export type CardTier = 'new' | 'learning' | 'mastered';

interface CardFrontProps {
  isZenMode: boolean;
  tier: CardTier;
  data: CardData;
  faceRef: RefObject<HTMLDivElement | null>;
  spotlightRef: RefObject<HTMLDivElement | null>;
  spotlightBackground: string;
  isHovered: boolean;
  supportedImageUrl: string | null;
  imagePriority: boolean;
  isBlindMode: boolean;
  audioSpeed: 1 | 0.75;
  toggleAudioSpeed: (event: MouseEvent | PointerEvent) => void;
  playAudio: (event: MouseEvent | PointerEvent) => void;
  playExplanationAudio: (event: MouseEvent | PointerEvent) => void;
  isPlayingAudio: boolean;
  isRecording: boolean;
  recordingTarget: 'word' | 'explanation' | null;
  startPronunciationCheck: (event: MouseEvent | PointerEvent, targetType?: 'word' | 'explanation') => void;
  pronunciationScore: SpeechMatchFeedbackValue | null;
  pronunciationError: string | null;
  showQuickQuiz: boolean;
  setShowQuickQuiz: Dispatch<SetStateAction<boolean>>;
  customDecks: string[];
  onAssignDeck?: (cardId: string, deckName: string | null) => void;
  showDeckSelector: boolean;
  setShowDeckSelector: Dispatch<SetStateAction<boolean>>;
  deckButtonRef: RefObject<HTMLButtonElement | null>;
  frontFlipRef: RefObject<HTMLButtonElement | null>;
  focusAfterFlipRef: RefObject<'front' | 'back' | null>;
  showCardSide: (side: 'front' | 'back') => void;
}

export function CardFront({
  isZenMode, tier, data, faceRef, spotlightRef, spotlightBackground, isHovered, supportedImageUrl, imagePriority,
  isBlindMode, audioSpeed, toggleAudioSpeed, playAudio, playExplanationAudio, isPlayingAudio,
  isRecording, recordingTarget, startPronunciationCheck, pronunciationScore, pronunciationError,
  showQuickQuiz, setShowQuickQuiz, customDecks, onAssignDeck, showDeckSelector, setShowDeckSelector,
  deckButtonRef, frontFlipRef, focusAfterFlipRef, showCardSide,
}: CardFrontProps) {
  const { _, i18n } = useLingui();
  if (isZenMode) return <ZenCardFront
    tier={tier}
    data={data}
    faceRef={faceRef}
    spotlightRef={spotlightRef}
    spotlightBackground={spotlightBackground}
    isHovered={isHovered}
    playAudio={playAudio}
    isPlayingAudio={isPlayingAudio}
    focusAfterFlipRef={focusAfterFlipRef}
    showCardSide={showCardSide}
  />;
  return (
    <div
      ref={faceRef}
      data-card-face="front"
      data-card-mode="standard"
      style={{ transformOrigin: 'center center', borderRadius: '32px' }}
      className="flashcard-panel flashcard-face absolute flex h-full w-full flex-col overflow-hidden rounded-[32px]"
    >

          <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
          <div className="group/image relative h-[44%] w-full overflow-hidden bg-transparent">
            <div data-card-effect="blind-image" className={`h-full w-full transition-[filter] duration-500 ease-out ${isBlindMode ? 'scale-110 blur-2xl saturate-50' : ''}`} aria-hidden={isBlindMode}>
              {supportedImageUrl ? <CardImage src={supportedImageUrl} alt={i18n._(msg({ id: 'flashcard.image.illustration', message: 'Illustration for {word}' }).id, { word: data.word })} priority={imagePriority} /> : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[var(--sf-text-muted)]" role="img" aria-label={i18n._(msg({ id: 'flashcard.image.none', message: 'No image for {word}' }).id, { word: data.word })}>
                  <span className="liquid-control flex size-16 items-center justify-center rounded-full"><ImageOff size={28} strokeWidth={1.5} /></span>
                  <span className="text-sm font-semibold"><Trans id="flashcard.image.unavailable" message="Image cue unavailable" /></span>
                </div>
              )}
            </div>
            <div className="flashcard-image-fade pointer-events-none absolute inset-x-0 bottom-0 h-16 z-10" aria-hidden="true" />
            {isBlindMode && <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/22 px-6 text-center text-white backdrop-blur-md"><EyeOff size={24} /><span className="mt-2 text-sm font-bold"><Trans id="flashcard.visual-hint.hidden" message="Visual hint hidden" /></span></div>}
          </div>

          <div className="relative z-20 flex min-h-0 flex-1 flex-col overflow-hidden -mt-6 rounded-b-[31px] bg-white dark:bg-[#081318]">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-4 pt-4 scrollbar-thin sm:px-6">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
                <div className="min-w-0 text-left">
                  <div data-card-metadata className="mb-2.5 flex flex-wrap items-center gap-2 text-[10px]">
                    <CardTierBadge tier={tier} />
                    {/* Category Chip (e.g. Education) */}
                    <span lang={data.language || 'en'}
                      aria-label={i18n._(msg({ id: 'flashcard.category', message: 'Category: {category}' }).id, { category: data.category })}
                      className="inline-flex items-center rounded-lg border border-slate-200/80 bg-slate-100/90 px-2.5 py-0.5 font-black uppercase tracking-wider text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                    >
                      {data.category}
                    </span>

                    {/* Status Badge (e.g. New card / Due for review) */}
                    {!data.nextReviewDate ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-50/90 px-2.5 py-0.5 font-bold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                        <Trans id="flashcard.status.new" message="New card" />
                      </span>
                    ) : isCardDue(data) ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-50/90 px-2.5 py-0.5 font-bold text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300">
                        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" aria-hidden="true" />
                        <Trans id="flashcard.status.due" message="Due for review" />
                      </span>
                    ) : null}

                    {data.difficulty && data.difficulty !== 'unrated' && (
                      <span className="inline-flex items-center rounded-lg border border-slate-200/60 bg-slate-50 px-2 py-0.5 font-bold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                        {data.difficulty === 'easy' ? <Trans id="flashcard.status.mastered" message="Mastered" /> : data.difficulty === 'good' ? <Trans id="flashcard.status.learning" message="Learning" /> : <Trans id="flashcard.status.needs-practice" message="Needs practice" />}
                      </span>
                    )}
                  </div>
                  <CardHeadword card={data} />
                </div>
                <div className="relative z-30 flex w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end sm:pt-4" data-card-control>
                  {/* Dynamic Audio Capsule */}
                  <div className="flex items-center rounded-full p-1 border border-slate-200/90 bg-slate-100/90 dark:border-white/15 dark:bg-white/[0.08] backdrop-blur-md shadow-xs transition-all">
                    <button
                      type="button"
                      data-card-control
                      onPointerDown={event => event.stopPropagation()}
                      onClick={toggleAudioSpeed}
                      className={`touch-manipulation flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full px-2.5 text-xs font-black transition-all cursor-pointer ${
                        audioSpeed === 0.75 ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
                      }`}
                      title={_(msg({ id: 'flashcard.audio.toggle-speed-detail', message: 'Toggle pronunciation speed (1.0x / 0.75x slow)' }))}
                      aria-label={_(msg({ id: 'flashcard.audio.toggle-speed', message: 'Toggle speed' }))}
                    >
                      {`${audioSpeed}×`}
                    </button>
                    <span className="mx-1 h-3.5 w-px bg-slate-300 dark:bg-white/10" aria-hidden="true" />
                    <button
                      type="button"
                      data-card-control
                      onPointerDown={event => event.stopPropagation()}
                      onClick={playAudio}
                      data-card-effect="audio"
                      className={`touch-manipulation flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-black transition-all cursor-pointer ${
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
                        <Volume2 size={15} />
                      )}
                      <span><Trans id="flashcard.listen" message="Listen" /></span>
                    </button>
                    <span className="mx-1 h-3.5 w-px bg-slate-300 dark:bg-white/10" aria-hidden="true" />
                    <button
                      type="button"
                      data-card-control
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => startPronunciationCheck(event, 'word')}
                      disabled={isRecording}
                      className={`touch-manipulation flex size-12 items-center justify-center rounded-full transition-all cursor-pointer ${
                        isRecording && recordingTarget === 'word' ? 'bg-rose-500 text-white animate-pulse shadow-[0_0_12px_rgba(244,63,94,0.6)]' : 'text-[var(--sf-text)] hover:text-rose-500 hover:bg-rose-500/10'
                      }`}
                      aria-label={_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}
                      title={_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}
                    >
                      <Mic size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {isRecording && <div className="mt-3 flex items-center gap-2 text-xs font-bold text-rose-500 dark:text-rose-400"><span className="size-2 rounded-full bg-rose-500 animate-pulse" /><Trans id="flashcard.audio.listening" message="Listening" /></div>}
              {pronunciationScore && <SpeechMatchFeedback value={pronunciationScore} target={pronunciationScore.type === 'word' ? data.word : data.explanation} />}
              {pronunciationError && <p className="mt-2 text-pretty text-xs font-semibold text-rose-600 dark:text-rose-300" role="alert">{pronunciationError}</p>}

              <div className="relative mt-4 text-left">
                <p lang={data.language || 'en'} aria-hidden={isBlindMode} className={`break-words text-sm leading-6 text-[var(--sf-text)] [overflow-wrap:anywhere] transition-[filter,opacity] ${isBlindMode ? 'select-none blur-md opacity-35' : ''}`}>{data.explanation}</p>
                {isBlindMode && <div className="pointer-events-none absolute inset-0 flex items-center justify-start"><span className="text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="flashcard.definition.hidden" message="Definition hidden" /></span></div>}
              </div>

              {showQuickQuiz && (
                <ActiveRecallQuiz
                  card={data}
                  onRevealMeaning={() => {
                    focusAfterFlipRef.current = 'back';
                    showCardSide('back');
                  }}
                />
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-card-control
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => setShowQuickQuiz(prev => !prev)}
                  className={`touch-manipulation flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-black transition-all cursor-pointer ${
                    showQuickQuiz
                      ? 'border border-cyan-400/80 bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                      : 'border border-cyan-500/30 bg-cyan-50/80 text-cyan-900 hover:bg-cyan-100/90 dark:border-cyan-400/25 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20 shadow-xs'
                  }`}
                  title={_(msg({ id: 'flashcard.quiz.title', message: 'Quick self-test quiz before revealing definition' }))}
                >
                  <Sparkles size={12} className={showQuickQuiz ? 'text-cyan-500' : 'text-cyan-600 dark:text-cyan-400'} />
                  <span><Trans id="flashcard.quiz" message="Quiz" /></span>
                </button>
                <button
                  type="button"
                  data-card-control
                  onPointerDown={event => event.stopPropagation()}
                  onClick={playExplanationAudio}
                  className="touch-manipulation flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-100/80 px-3 py-1 text-xs font-bold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-slate-200/80 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] transition-all cursor-pointer shadow-xs"
                  title={_(msg({ id: 'flashcard.definition.listen', message: 'Listen to the definition' }))}
                >
                  <Volume2 size={13} />
                  <span><Trans id="flashcard.listen" message="Listen" /></span>
                </button>
                <button
                  type="button"
                  data-card-control
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => startPronunciationCheck(event, 'explanation')}
                  disabled={isRecording}
                  className={`touch-manipulation flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all cursor-pointer shadow-xs ${
                    isRecording && recordingTarget === 'explanation'
                      ? 'bg-rose-500 text-white animate-pulse shadow-[0_0_12px_rgba(244,63,94,0.5)]'
                      : 'border border-slate-200/80 bg-slate-100/80 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-slate-200/80 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
                  }`}
                  title={_(msg({ id: 'flashcard.definition.practice', message: 'Practise reading the definition' }))}
                >
                  <Mic size={13} />
                  <span><Trans id="flashcard.read-aloud" message="Read aloud" /></span>
                </button>
                {onAssignDeck && <Dialog.Root open={showDeckSelector} onOpenChange={setShowDeckSelector}>
                  <Dialog.Trigger asChild><button ref={deckButtonRef} onPointerDown={event => event.stopPropagation()} className="touch-manipulation flex min-h-11 min-w-0 items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-100/80 px-3 py-1 text-xs font-bold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-slate-200/80 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] transition-all cursor-pointer shadow-xs"><FolderOpen size={13} /><span className="max-w-32 truncate">{data.customDeck || <Trans id="flashcard.deck.choose" message="Choose deck" />}</span></button></Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/72 backdrop-blur-sm" />
                    <Dialog.Content className="liquid-glass fixed left-1/2 top-1/2 z-[111] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6 outline-none" aria-describedby={`deck-description-${data.id}`}>
                      <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-balance text-lg font-black text-[var(--sf-text)]"><Trans id="flashcard.deck.choose" message="Choose deck" /></Dialog.Title><Dialog.Description id={`deck-description-${data.id}`} className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]"><Trans id="flashcard.deck.description" message="Organise “{word}” without leaving the card." values={{ word: data.word }} /></Dialog.Description></div><Dialog.Close className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--sf-text)]" aria-label={_(msg({ id: 'flashcard.deck.close', message: 'Close deck selector' }))}><X size={18} /></Dialog.Close></div>
                      <div className="mt-5 max-h-[min(360px,55dvh)] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                        <button onClick={() => { onAssignDeck(data.id, null); setShowDeckSelector(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold ${!data.customDeck ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'liquid-control text-[var(--sf-text)]'}`}><FolderX size={16} /><span><Trans id="flashcard.deck.unassigned" message="Unassigned" /></span>{!data.customDeck && <CheckCircle2 size={15} className="ml-auto" />}</button>
                        {customDecks.map(deck => <button key={deck} onClick={() => { onAssignDeck(data.id, deck); setShowDeckSelector(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold ${data.customDeck === deck ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'liquid-control text-[var(--sf-text)]'}`}><FolderOpen size={16} /><span className="min-w-0 flex-1 truncate">{deck}</span>{data.customDeck === deck && <CheckCircle2 size={15} />}</button>)}
                      </div>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>}
              </div>
            </div>

            <button
              ref={frontFlipRef}
              type="button"
              data-flip-card
              data-reveal-meaning
              onClick={event => {
                event.stopPropagation();
                focusAfterFlipRef.current = 'back';
                showCardSide('back');
              }}
              className="group/flip relative z-20 flex min-h-[60px] w-full flex-shrink-0 cursor-pointer items-center justify-center gap-2 border-x-0 border-b-0 border-t border-cyan-500/20 bg-transparent px-4 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 outline-none transition-colors duration-200 hover:border-cyan-500/45 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-brand)] dark:border-cyan-300/15 dark:hover:border-cyan-300/45 dark:text-slate-400 dark:hover:text-slate-200"
              aria-label={i18n._(msg({ id: 'flashcard.reveal-meaning-label', message: 'Reveal the Vietnamese meaning of {word}' }).id, { word: data.word })}
            >
              <span
                data-reveal-hover-edge
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-500/10 via-cyan-400/55 to-cyan-500/10 opacity-75 transition-opacity duration-200 group-hover/flip:opacity-100 motion-reduce:transition-none dark:from-cyan-300/10 dark:via-cyan-300/55 dark:to-cyan-300/10"
                aria-hidden="true"
              />
              <Languages
                data-reveal-translate-icon
                size={16}
                className="text-cyan-700 dark:text-cyan-300"
                aria-hidden="true"
              />
              <span><Trans id="flashcard.reveal-meaning" message="Reveal meaning" /></span>
            </button>
          </div>

    </div>
  );
}

function ZenCardFront({
  tier,
  data,
  faceRef,
  spotlightRef,
  spotlightBackground,
  isHovered,
  playAudio,
  isPlayingAudio,
  focusAfterFlipRef,
  showCardSide,
}: Pick<CardFrontProps, 'tier' | 'data' | 'faceRef' | 'spotlightRef' | 'spotlightBackground' | 'isHovered' | 'playAudio' | 'isPlayingAudio' | 'focusAfterFlipRef' | 'showCardSide'>) {
  const { _ } = useLingui();
  return (
<div
              ref={faceRef}
              data-card-face="front"
              data-card-mode="zen"
              style={{ transformOrigin: 'center center', borderRadius: '32px' }}
              className="flashcard-panel flashcard-face zen-glass-slab relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[32px] p-7 pt-20 sm:p-9 sm:pt-20 text-center text-white select-none"
            >
              <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
              {/* Top Rim Specular Star Sparkle from Mockup */}
              <div className="pointer-events-none absolute left-[22%] -top-2.5 z-30 flex items-center justify-center" aria-hidden="true">
                <span className="text-white text-base font-black drop-shadow-[0_0_8px_#ffffff] select-none">✦</span>
                <span className="absolute size-6 rounded-full bg-white/35 blur-sm" />
              </div>

              <div className="flex w-full items-center justify-between z-20">
                <CardTierBadge tier={tier} />
                {data.cefrLevel && <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-bold text-white"><Trans id="flashcard.cefr-level" message="CEFR {level}" values={{ level: data.cefrLevel }} /></span>}
              </div>

              {/* Center Section: Word in Playfair Serif + 5-Bar Waveform + Centered Example */}
              <div className="my-auto flex min-h-0 flex-1 flex-col items-center justify-[safe_center] overflow-y-auto overscroll-contain py-2 z-20">
                <CardHeadword card={data} variant="zen" />
                <div className="mt-2.5 flex items-center justify-center gap-2.5">
                  <button
                    type="button"
                    data-card-control
                    data-card-effect="audio"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={playAudio}
                    className="flex min-h-11 min-w-11 items-center justify-center gap-[3px] p-1 text-cyan-400 hover:text-cyan-300 transition-all hover:scale-110 cursor-pointer"
                    title={_(msg({ id: 'flashcard.audio.listen-pronunciation', message: 'Listen to pronunciation' }))}
                    aria-label={_(msg({ id: 'flashcard.audio.listen-pronunciation', message: 'Listen to pronunciation' }))}
                  >
                    {isPlayingAudio ? (
                      <span data-audio-waves="active" className="flex h-5 items-center gap-[3.5px]" aria-hidden="true">
                        <span className="wave-bar-1 w-[3px] h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_#22d3ee]" />
                        <span className="wave-bar-2 w-[3px] h-3.5 bg-cyan-400 rounded-full shadow-[0_0_8px_#22d3ee]" />
                        <span className="wave-bar-3 w-[3px] h-5 bg-cyan-400 rounded-full shadow-[0_0_10px_#22d3ee]" />
                        <span className="wave-bar-4 w-[3px] h-3.5 bg-cyan-400 rounded-full shadow-[0_0_8px_#22d3ee]" />
                        <span className="flashcard-audio-wave-bar w-[3px] h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_#22d3ee]" />
                      </span>
                    ) : <Volume2 size={15} aria-hidden="true" />}
                  </button>
                </div>

                {/* Centered Example Sentence from Mockup */}
                {data.explanation && (
                  <p lang={data.language || 'en'} className="mt-6 max-w-lg text-balance text-base sm:text-lg leading-relaxed text-slate-100/85 font-normal text-center px-4">
                    {data.explanation}
                  </p>
                )}
              </div>

              {/* Bottom Row: Frosted Glass Capsule Button with Cyan Neon Laser Underline */}
              <div className="flex justify-center pb-2 z-20">
                <button
                  type="button"
                  data-card-control
                  data-reveal-meaning="true"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => {
                    focusAfterFlipRef.current = 'back';
                    showCardSide('back');
                  }}
                  className="relative group inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 bg-white/10 px-9 py-2.5 text-sm font-medium tracking-wide text-white/95 shadow-[0_12px_35px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 hover:bg-white/20 hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <span><Trans id="flashcard.reveal-meaning" message="Reveal meaning" /></span>
                  {/* Cyan Laser Underline Light from Mockup */}
                  <span
                    className="absolute -bottom-px left-[22%] right-[22%] h-[2.5px] rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee,0_0_24px_#06b6d4] transition-all duration-300 group-hover:left-[16%] group-hover:right-[16%]"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
  );
}

export function CardTierBadge({ tier }: { tier: CardTier }) {
  const { family } = useTheme();
  const { _ } = useLingui();
  return <span data-card-tier-label className="inline-flex items-center rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[var(--sf-brand-text)]">
    {family === 'crystal'
      ? tier === 'new' ? _(msg({ id: 'flashcard.tier.crystal.new', context: 'crystal.tier', message: 'Bud' }))
        : tier === 'learning' ? _(msg({ id: 'flashcard.tier.crystal.learning', context: 'crystal.tier', message: 'Bloom' }))
          : _(msg({ id: 'flashcard.tier.crystal.mastered', context: 'crystal.tier', message: 'Star' }))
      : tier === 'new' ? <Trans id="flashcard.tier.new" message="New" />
        : tier === 'learning' ? <Trans id="flashcard.tier.learning" message="Learning" />
          : <Trans id="flashcard.tier.mastered" message="Mastered" />}
  </span>;
}
