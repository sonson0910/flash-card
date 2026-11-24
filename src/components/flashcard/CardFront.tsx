import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { CheckCircle2, EyeOff, FolderOpen, FolderX, Mic, Sparkles, Volume2, X } from 'lucide-react';
import type { Dispatch, MouseEvent, PointerEvent, ReactNode, RefObject, SetStateAction } from 'react';
import { speechLocaleFor } from '../../lib/speechLocale';
import { localizeSpeechMessage } from './localizeSpeechMessage';
import { isCardDue } from '../../lib/srs';
import type { CardData } from '../../types/card';
import { ActiveRecallQuiz } from './ActiveRecallQuiz';
import { CardEffectsLayer } from './CardEffectsLayer';
import { CardHeadword } from './CardHeadword';
import { CardImage } from './CardImage';
import { SpeechMatchFeedback, type SpeechMatchFeedbackValue } from './SpeechMatchFeedback';
import { cardRevealLabel, isLanguagePackCard } from './cardLanguage';
import { useCardLook } from './cardLook';
import { cardEndonym, LanguageCardExample, LanguageCardHeadword, LanguageCardPhrases, LanguageReadingSwitch, useLanguageCardReading } from './LanguageCardFace';

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
  /** Latin reading aids on a language-pack card (romanization, romaji, pinyin). */
  showReading: boolean;
  toggleShowReading: () => void;
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
  isBlindMode, showReading, toggleShowReading, audioSpeed, toggleAudioSpeed, playAudio, playExplanationAudio, isPlayingAudio,
  isRecording, recordingTarget, startPronunciationCheck, pronunciationScore, pronunciationError,
  showQuickQuiz, setShowQuickQuiz, customDecks, onAssignDeck, showDeckSelector, setShowDeckSelector,
  deckButtonRef, frontFlipRef, focusAfterFlipRef, showCardSide,
}: CardFrontProps) {
  const { _, i18n } = useLingui();
  const look = useCardLook();
  const reading = useLanguageCardReading(data);
  if (isZenMode) return <ZenCardFront
    tier={tier}
    data={data}
    faceRef={faceRef}
    spotlightRef={spotlightRef}
    spotlightBackground={spotlightBackground}
    isHovered={isHovered}
    playAudio={playAudio}
    isPlayingAudio={isPlayingAudio}
    isBlindMode={isBlindMode}
    focusAfterFlipRef={focusAfterFlipRef}
    showCardSide={showCardSide}
  />;

  const language = data.language || 'en';
  const isPackCard = isLanguagePackCard(data);
  const endonym = isPackCard ? cardEndonym(data) : null;
  const partOfSpeech = data.partOfSpeech?.trim();
  const isDue = Boolean(data.nextReviewDate) && isCardDue(data);
  const statusChips = (
    <>
      {isDue && (
        <span data-card-status="due" className="flashcard-status-chip">
          <span className="size-1.5 rounded-full bg-[var(--sf-reward)]" aria-hidden="true" />
          <Trans {...msg({ context: 'flashcard.status.due', message: 'Due for review' })} />
        </span>
      )}
      {data.difficulty === 'hard' && (
        <span data-card-status="needs-practice" className="flashcard-status-chip">
          <Trans {...msg({ context: 'flashcard.status.needs-practice', message: 'Needs practice' })} />
        </span>
      )}
    </>
  );
  const listenWaves = <span data-audio-waves="active" className="flex h-3.5 items-center gap-0.5" aria-hidden="true"><span className="wave-bar-1 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-2 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-3 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-4 h-full w-0.5 rounded-full bg-current" /></span>;
  const revealMeaning = () => {
    focusAfterFlipRef.current = 'back';
    showCardSide('back');
  };

  const toolsMenu = (className: string, extraItems: ReactNode) => (
    <details className={`group/tools relative ${className}`}>
      <summary className="flashcard-action flashcard-action-more flex size-11 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden" aria-label={_(msg({ id: 'flashcard.more-tools', message: 'More card tools' }))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
      </summary>
      <div className="absolute bottom-12 right-0 z-40 flex w-max max-w-[calc(100vw-3rem)] flex-wrap justify-end gap-2 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-2 shadow-[var(--sf-panel-shadow)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
        {extraItems}
        <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={playExplanationAudio} className="touch-manipulation flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-[var(--sf-text-muted)] hover:bg-[color-mix(in_srgb,var(--sf-text)_7%,transparent)] hover:text-[var(--sf-text)]" title={_(msg({ id: 'flashcard.definition.listen', message: 'Listen to the definition' }))}><Volume2 size={13} aria-hidden="true" /><span><Trans {...msg({ context: 'flashcard.listen', message: 'Listen' })} /></span></button>
        <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={event => startPronunciationCheck(event, 'explanation')} disabled={isRecording} className={`touch-manipulation flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${isRecording && recordingTarget === 'explanation' ? 'bg-[var(--sf-danger)] text-[var(--sf-on-brand)] animate-pulse motion-reduce:animate-none' : 'text-[var(--sf-text-muted)] hover:bg-[color-mix(in_srgb,var(--sf-text)_7%,transparent)] hover:text-[var(--sf-text)]'}`} title={_(msg({ id: 'flashcard.definition.practice', message: 'Practise reading the definition' }))}><Mic size={13} aria-hidden="true" /><span><Trans {...msg({ context: 'flashcard.read-aloud', message: 'Read aloud' })} /></span></button>
        {onAssignDeck && <Dialog.Root open={showDeckSelector} onOpenChange={setShowDeckSelector}>
          <Dialog.Trigger asChild><button ref={deckButtonRef} onPointerDown={event => event.stopPropagation()} className="touch-manipulation flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-1 text-xs font-bold text-[var(--sf-text-muted)] transition-colors hover:text-[var(--sf-text)]"><FolderOpen size={13} aria-hidden="true" /><span className="max-w-32 truncate">{data.customDeck || <Trans {...msg({ context: 'flashcard.deck.choose', message: 'Choose deck' })} />}</span></button></Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[110] dialog-veil backdrop-blur-sm" />
            <Dialog.Content className="liquid-glass fixed left-1/2 top-1/2 z-[111] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6 focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:crystal-chamfer" aria-describedby={`deck-description-${data.id}`}>
              <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-balance text-lg font-black text-[var(--sf-text)]"><Trans {...msg({ context: 'flashcard.deck.choose', message: 'Choose deck' })} /></Dialog.Title><Dialog.Description id={`deck-description-${data.id}`} className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'flashcard.deck.description', message: 'Organise “{word}” without leaving the card.' })} values={{ word: data.word }} /></Dialog.Description></div><Dialog.Close className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--sf-text)]" aria-label={_(msg({ id: 'flashcard.deck.close', message: 'Close deck selector' }))}><X size={18} /></Dialog.Close></div>
              <div className="mt-5 max-h-[min(360px,55dvh)] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                <button onClick={() => { onAssignDeck(data.id, null); setShowDeckSelector(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold ${!data.customDeck ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'liquid-control text-[var(--sf-text)]'}`}><FolderX size={16} /><span><Trans {...msg({ context: 'flashcard.deck.unassigned', message: 'Unassigned' })} /></span>{!data.customDeck && <CheckCircle2 size={15} className="ml-auto" />}</button>
                {customDecks.map(deck => <button key={deck} onClick={() => { onAssignDeck(data.id, deck); setShowDeckSelector(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold ${data.customDeck === deck ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'liquid-control text-[var(--sf-text)]'}`}><FolderOpen size={16} /><span className="min-w-0 flex-1 truncate">{deck}</span>{data.customDeck === deck && <CheckCircle2 size={15} />}</button>)}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>}
      </div>
    </details>
  );

  return (
    <div
      ref={faceRef}
      data-card-face="front"
      data-card-mode="standard"
      data-card-look={look}
      data-card-kind={isPackCard ? 'language' : undefined}
      style={{ transformOrigin: 'center center', borderRadius: 'var(--flashcard-radius, 32px)' }}
      className="flashcard-panel flashcard-face absolute flex h-full w-full flex-col overflow-hidden rounded-[var(--flashcard-radius,32px)]"
    >
      <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
      {!supportedImageUrl && <span data-card-glyph className="flashcard-art-glyph pointer-events-none absolute select-none" lang={language} aria-hidden="true">{Array.from(data.word.trim())[0] ?? ''}</span>}
      <div data-card-art data-card-art-kind={supportedImageUrl ? 'image' : 'glyph'} className="flashcard-art group/image relative shrink-0 overflow-hidden">
        <div data-card-effect="blind-image" className={`flashcard-art-image h-full w-full transition-[filter] duration-500 ease-out ${isBlindMode ? 'scale-110 blur-2xl saturate-50' : ''}`} aria-hidden={isBlindMode}>
          {supportedImageUrl && <CardImage src={supportedImageUrl} alt={i18n._(msg({ id: 'flashcard.image.illustration', message: 'Illustration for {word}' }).id, { word: data.word })} priority={imagePriority} />}
        </div>
        {supportedImageUrl && <div className="flashcard-art-shade pointer-events-none absolute inset-0" aria-hidden="true" />}
        {isBlindMode && look === 'crystal' && !isPackCard && <CrystalBlindBand />}
        {isBlindMode && supportedImageUrl && !(look === 'crystal' && !isPackCard) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center px-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--sf-surface)] px-3.5 py-2 text-sm font-semibold text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)]">
              <EyeOff size={16} aria-hidden="true" />
              <Trans {...msg({ context: 'flashcard.visual-hint.hidden', message: 'Visual hint hidden' })} />
            </span>
          </div>
        )}
        {(look === 'aurora' || (look === 'paper' && !supportedImageUrl)) && data.category && (
          <span className="flashcard-category-chip absolute left-[18px] top-[18px] z-20 inline-flex max-w-[calc(100%-9rem)] items-center gap-[7px]">
            <span className="size-1.5 shrink-0 rounded-full bg-[var(--flashcard-accent)]" aria-hidden="true" />
            <span lang={language} className="min-w-0 [overflow-wrap:anywhere]">{data.category}</span>
          </span>
        )}
        {look === 'crystal' && !isPackCard && (
          <span className="flashcard-tier-ribbon absolute left-[18px] top-4 z-20 inline-flex items-center gap-2">
            <span data-card-tier-label className="flashcard-tier-grade"><CardTierName tier={tier} /></span>
            <span className="flashcard-tier-name"><CardTierStatus tier={tier} /></span>
          </span>
        )}
        {look === 'crystal' && isPackCard && (
          <div className="flashcard-lang-top absolute left-[18px] top-4 z-20 flex items-center gap-2">
            <span className="flashcard-tier-ribbon inline-flex shrink-0 items-center gap-2">
              <span data-card-tier-label className="flashcard-tier-grade"><CardTierName tier={tier} /></span>
              <span className="flashcard-tier-name"><CardTierStatus tier={tier} /></span>
            </span>
            {data.category && <span lang={language} className="flashcard-level-chip min-w-0 truncate">{data.category}</span>}
          </div>
        )}
      </div>
      {look === 'paper' && supportedImageUrl && data.category && (
        <div className="flashcard-fig-caption">
          <span aria-hidden="true">{`${_(msg({ id: 'flashcard.figure-caption', message: 'fig.' }))} — `}</span>
          <span lang={language} className="min-w-0 break-words [overflow-wrap:anywhere]">{data.category}</span>
        </div>
      )}

      <div className="flashcard-body relative z-20 flex min-h-0 flex-1 flex-col">
        <div className="flashcard-body-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scrollbar-thin">
          {look === 'paper' && !isPackCard && (
            <div data-card-seal className="flashcard-seal">
              <span className="flashcard-seal-glyph" aria-hidden="true">{tier === 'new' ? '·' : tier === 'learning' ? '½' : '✦'}</span>
              <span data-card-tier-label><CardTierStatus tier={tier} /></span>
            </div>
          )}
          {(look === 'aurora' || (look === 'paper' && isPackCard)) && (
            <div data-card-metadata className="flashcard-meta">
              {partOfSpeech && <><span lang={language}>{partOfSpeech}</span><span className="flashcard-meta-dot" aria-hidden="true" /></>}
              <span className="flashcard-meta-tier"><span className="flashcard-meta-tier-dot" aria-hidden="true" /><span data-card-tier-label><CardTierStatus tier={tier} /></span></span>
              {statusChips}
            </div>
          )}
          {look === 'crystal' && (
            <div data-card-metadata className="flashcard-meta">
              {partOfSpeech && <span lang={language}>{partOfSpeech}</span>}
              {isPackCard
                ? endonym && <span className="flashcard-meta-category"><span aria-hidden="true">{'// '}</span><span lang={language}>{endonym}</span></span>
                : data.category && <span className="flashcard-meta-category"><span aria-hidden="true">{'// '}</span><span lang={language}>{data.category}</span></span>}
              {statusChips}
            </div>
          )}
          {look === 'paper' && !isPackCard && (isDue || data.difficulty === 'hard') && <div data-card-metadata className="flashcard-meta">{statusChips}</div>}

          {isPackCard
            ? <LanguageCardHeadword card={data} reading={reading} showReading={showReading} isBlindMode={isBlindMode} onPlayAudio={playAudio} isPlayingAudio={isPlayingAudio} />
            : <CardHeadword
              card={data}
              onPlayAudio={look === 'paper' ? undefined : playAudio}
              isPlayingAudio={isPlayingAudio}
              leading={look === 'paper' && partOfSpeech ? <span lang={language} className="flashcard-pos">{partOfSpeech}</span> : undefined}
            />}

          {isRecording && <div className="mt-3 flex items-center gap-2 text-xs font-bold text-[var(--sf-danger)]"><span className="size-2 rounded-full bg-[var(--sf-danger)] animate-pulse motion-reduce:animate-none" /><Trans {...msg({ context: 'flashcard.audio.listening', message: 'Listening' })} /></div>}
          {pronunciationScore && <SpeechMatchFeedback value={pronunciationScore} target={pronunciationScore.type === 'word' ? data.word : data.explanation} />}
          {pronunciationError && <p className="mt-2 text-pretty text-xs font-semibold text-[var(--sf-danger)]" role="alert">{localizeSpeechMessage(pronunciationError, _)}</p>}

          {isPackCard ? (
            <>
              <LanguageCardExample card={data} reading={reading} />
              <LanguageCardPhrases card={data} />
            </>
          ) : (
            <>
              {look === 'paper' && <div className="flashcard-rule" aria-hidden="true" />}
              <div className="flashcard-definition relative text-left">
                {look === 'paper' && <span className="flashcard-definition-number" aria-hidden="true">1</span>}
                <p lang={language} aria-hidden={isBlindMode} className={`min-w-0 break-words [overflow-wrap:anywhere] transition-[filter,opacity] ${isBlindMode ? 'select-none blur-md opacity-35' : ''}`}>{data.explanation}</p>
                {isBlindMode && <div className="pointer-events-none absolute inset-0 flex items-center justify-start"><span className="text-xs font-bold text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'flashcard.definition.hidden', message: 'Definition hidden' })} /></span></div>}
              </div>
            </>
          )}

          {showQuickQuiz && (
            <ActiveRecallQuiz
              card={data}
              onRevealMeaning={revealMeaning}
            />
          )}

          {isPackCard ? (
            <div data-card-actions className="flashcard-actions flashcard-lang-actions mt-auto flex flex-wrap items-center">
              <button
                type="button"
                data-card-control
                data-recording={isRecording && recordingTarget === 'word' ? 'true' : undefined}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => startPronunciationCheck(event, 'word')}
                disabled={isRecording}
                className="flashcard-action flashcard-lang-say touch-manipulation flex min-h-11 shrink-0 items-center"
                title={_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}
              >
                <Mic size={15} aria-hidden="true" />
                <span className="flashcard-action-label"><Trans {...msg({ context: 'flashcard.say-it', message: 'Say it' })} /></span>
                <span className="flashcard-lang-speech-locale font-mono" aria-hidden="true">{speechLocaleFor(data)}</span>
              </button>
              <LanguageReadingSwitch card={data} showReading={showReading} onToggle={toggleShowReading} />
              {toolsMenu('shrink-0', (
                <>
                  <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={toggleAudioSpeed} aria-pressed={audioSpeed === 0.75} className="touch-manipulation flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 py-1 font-mono text-xs font-bold text-[var(--sf-text-muted)] hover:bg-[color-mix(in_srgb,var(--sf-text)_7%,transparent)] hover:text-[var(--sf-text)] aria-pressed:text-[var(--sf-brand-text)]" title={_(msg({ id: 'flashcard.audio.toggle-speed-detail', message: 'Toggle pronunciation speed (1.0x / 0.75x slow)' }))} aria-label={_(msg({ id: 'flashcard.audio.toggle-speed', message: 'Toggle speed' }))}>{`${audioSpeed}×`}</button>
                  <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={() => setShowQuickQuiz(prev => !prev)} aria-pressed={showQuickQuiz} className="touch-manipulation flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-[var(--sf-text-muted)] hover:bg-[color-mix(in_srgb,var(--sf-text)_7%,transparent)] hover:text-[var(--sf-text)] aria-pressed:text-[var(--sf-brand-text)]" title={_(msg({ id: 'flashcard.quiz.title', message: 'Quick self-test quiz before revealing definition' }))}><Sparkles size={13} aria-hidden="true" /><span><Trans {...msg({ context: 'flashcard.quiz-me', message: 'Quiz me' })} /></span></button>
                </>
              ))}
            </div>
          ) : (
          <div data-card-actions className="flashcard-actions mt-auto flex flex-wrap items-center gap-1.5">
            {look === 'paper' && (
              <button
                type="button"
                data-card-control
                data-card-effect="audio"
                data-playing={isPlayingAudio ? 'true' : 'false'}
                onPointerDown={event => event.stopPropagation()}
                onClick={playAudio}
                className="flashcard-action flashcard-action-listen touch-manipulation flex min-h-11 items-center gap-2"
                aria-label={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
                title={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
              >
                {isPlayingAudio ? listenWaves : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
                <span className="flashcard-action-listen-label"><Trans {...msg({ context: 'flashcard.listen', message: 'Listen' })} /></span>
              </button>
            )}
            <button
              type="button"
              data-card-control
              onPointerDown={event => event.stopPropagation()}
              onClick={toggleAudioSpeed}
              aria-pressed={audioSpeed === 0.75}
              className="flashcard-action flashcard-action-speed touch-manipulation flex min-h-11 min-w-11 shrink-0 items-center justify-center font-mono"
              title={_(msg({ id: 'flashcard.audio.toggle-speed-detail', message: 'Toggle pronunciation speed (1.0x / 0.75x slow)' }))}
              aria-label={_(msg({ id: 'flashcard.audio.toggle-speed', message: 'Toggle speed' }))}
            >
              {`${audioSpeed}×`}
            </button>
            <button
              type="button"
              data-card-control
              data-recording={isRecording && recordingTarget === 'word' ? 'true' : undefined}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => startPronunciationCheck(event, 'word')}
              disabled={isRecording}
              className="flashcard-action touch-manipulation flex min-h-11 items-center gap-[7px]"
              title={_(msg({ id: 'flashcard.audio.check-pronunciation', message: 'Check pronunciation' }))}
            >
              <Mic size={15} aria-hidden="true" />
              <span className="flashcard-action-label"><Trans {...msg({ context: 'flashcard.say-it', message: 'Say it' })} /></span>
            </button>
            <button
              type="button"
              data-card-control
              onPointerDown={event => event.stopPropagation()}
              onClick={() => setShowQuickQuiz(prev => !prev)}
              aria-pressed={showQuickQuiz}
              className="flashcard-action touch-manipulation flex min-h-11 items-center gap-[7px]"
              title={_(msg({ id: 'flashcard.quiz.title', message: 'Quick self-test quiz before revealing definition' }))}
            >
              <Sparkles size={15} className="flashcard-action-quiz-icon text-[var(--sf-second)]" aria-hidden="true" />
              <span className="flashcard-action-label"><Trans {...msg({ context: 'flashcard.quiz-me', message: 'Quiz me' })} /></span>
            </button>
            {toolsMenu('ml-auto', null)}
          </div>
          )}
        </div>

        <div className="flashcard-reveal-dock shrink-0">
          <button
            ref={frontFlipRef}
            type="button"
            data-flip-card
            data-reveal-meaning
            onClick={event => {
              event.stopPropagation();
              revealMeaning();
            }}
            className="flashcard-reveal group/flip relative z-20 flex min-h-[58px] w-full cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--sf-brand)]"
            aria-label={cardRevealLabel(i18n, data)}
          >
            {look === 'aurora' && <span data-reveal-hover-edge className="flashcard-reveal-laser pointer-events-none absolute" aria-hidden="true" />}
            {look === 'crystal' && <span className="flashcard-reveal-shine pointer-events-none absolute" aria-hidden="true" />}
            {look === 'crystal' && <svg className="relative" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l3 7.1 7.7.6-5.9 5 1.8 7.5L12 17.7l-6.6 4 1.8-7.5-5.9-5 7.7-.6z" fill="currentColor" /><path d="M12 1.5l3 7.1-3 9.1z" fill="var(--sf-reward)" /></svg>}
            <span className="relative">
              {isPackCard
                ? <Trans {...msg({ context: 'flashcard.reveal-meaning', message: 'Reveal meaning' })} />
                : look === 'paper'
                  ? <Trans {...msg({ context: 'flashcard.turn-card', message: 'Turn the card' })} />
                  : look === 'crystal'
                    ? <Trans {...msg({ context: 'flashcard.reveal', message: 'Reveal' })} />
                    : <Trans {...msg({ context: 'flashcard.reveal-meaning', message: 'Reveal meaning' })} />}
            </span>
            {look === 'paper' && !isPackCard && <span data-reveal-hover-edge className="flashcard-reveal-rule" aria-hidden="true" />}
            <kbd className="flashcard-kbd relative font-mono" aria-hidden="true"><Trans {...msg({ context: 'flashcard.shortcut.space', message: 'Space' })} /></kbd>
          </button>
        </div>
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
  isBlindMode,
  focusAfterFlipRef,
  showCardSide,
}: Pick<CardFrontProps, 'tier' | 'data' | 'faceRef' | 'spotlightRef' | 'spotlightBackground' | 'isHovered' | 'playAudio' | 'isPlayingAudio' | 'isBlindMode' | 'focusAfterFlipRef' | 'showCardSide'>) {
  const { _ } = useLingui();
  return (
<div
              ref={faceRef}
              data-card-face="front"
              data-card-mode="zen"
              style={{ transformOrigin: 'center center', borderRadius: '32px' }}
              className="flashcard-panel flashcard-face zen-glass-slab relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[32px] p-7 pt-16 sm:p-9 sm:pt-16 text-center text-white select-none"
            >
              <CardEffectsLayer spotlightRef={spotlightRef} isHovered={isHovered} spotlightBackground={spotlightBackground} holo tier={tier} />
              {/* Top Rim Specular Star Sparkle from Mockup */}
              <div className="pointer-events-none absolute left-[22%] -top-2.5 z-30 flex items-center justify-center" aria-hidden="true">
                <span className="text-white text-base font-black drop-shadow-[0_0_8px_#ffffff] select-none">✦</span>
                <span className="absolute size-6 rounded-full bg-white/35 blur-sm" />
              </div>

              <div className="flex w-full items-center justify-between z-20">
                <CardTierBadge tier={tier} />
                {data.cefrLevel && <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-bold text-white"><Trans {...msg({ context: 'flashcard.cefr-level', message: 'CEFR {level}' })} values={{ level: data.cefrLevel }} /></span>}
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
                  <div className="relative mt-6 max-w-lg">
                    <p lang={data.language || 'en'} aria-hidden={isBlindMode} className={`text-balance text-base sm:text-lg leading-relaxed text-slate-100/85 font-normal text-center px-4 transition-[filter,opacity] ${isBlindMode ? 'select-none blur-md opacity-35' : ''}`}>
                      {data.explanation}
                    </p>
                    {isBlindMode && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="text-xs font-bold text-slate-100/80"><Trans {...msg({ context: 'flashcard.definition.hidden', message: 'Definition hidden' })} /></span></div>}
                  </div>
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
                  <span><Trans {...msg({ context: 'flashcard.reveal-meaning', message: 'Reveal meaning' })} /></span>
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

const BLIND_ZIGZAG = '0,150 70,128 110,160 170,118 205,150 250,96 300,140 340,110 390,146 460,120';

/**
 * The board's blind band over the picture area: a dark veil, a cyan zigzag crack and the crimson plate that says the
 * visual hint is hidden. Crystal only.
 */
export function CrystalBlindBand() {
  return (
    <div data-card-effect="blind-band" className="flashcard-blind-band absolute inset-0 flex items-center justify-center">
      <svg className="flashcard-blind-crack absolute inset-0 h-full w-full" viewBox="0 0 460 282" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={BLIND_ZIGZAG} fill="none" stroke="#5ef2ff" strokeWidth="3" style={{ filter: 'drop-shadow(0 0 8px #5ef2ff)' }} />
        <polyline points={BLIND_ZIGZAG} fill="none" stroke="#ffffff" strokeWidth="1" />
        <polyline points="170,118 180,70 214,40" fill="none" stroke="#ff5470" strokeWidth="1.6" />
      </svg>
      <div className="flashcard-blind-plate relative">
        <div className="flashcard-blind-title"><Trans {...msg({ context: 'flashcard.visual-hint.hidden', message: 'Visual hint hidden' })} /></div>
      </div>
    </div>
  );
}

export function CardTierBadge({ tier }: { tier: CardTier }) {
  return <span data-card-tier-label className="inline-flex items-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[var(--sf-brand-text)]">
    <CardTierName tier={tier} />
  </span>;
}

/** The mastery grade a word grows through: Bud, Bloom, Star. */
export function CardTierName({ tier }: { tier: CardTier }) {
  return tier === 'new' ? <Trans {...msg({ id: 'flashcard.tier.new', message: 'Bud' })} />
    : tier === 'learning' ? <Trans {...msg({ id: 'flashcard.tier.learning', message: 'Bloom' })} />
      : <Trans {...msg({ id: 'flashcard.tier.mastered', message: 'Star' })} />;
}

/** The plain review status shown beside the grade: New, Learning, Mastered. */
export function CardTierStatus({ tier }: { tier: CardTier }) {
  return tier === 'new' ? <Trans {...msg({ id: 'flashcard.tier-status.new', message: 'New' })} />
    : tier === 'learning' ? <Trans {...msg({ id: 'flashcard.tier-status.learning', message: 'Learning' })} />
      : <Trans {...msg({ id: 'flashcard.tier-status.mastered', message: 'Mastered' })} />;
}
