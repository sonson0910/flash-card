import { useGSAP } from '@gsap/react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import gsap from 'gsap';
import { BookOpen, ChevronRight, Volume2, Languages, Trash2, Star, Mic, CheckCircle2, Eye, EyeOff, Loader2, FolderOpen, FolderX, ImageOff, X } from 'lucide-react';
import React, { useEffect, useState, useRef } from 'react';
import { isCardDue } from '../lib/srs';
import { isSupportedImageUrl } from '../lib/images';
import { playFlipSound, playRewardSound } from '../lib/interactionSounds';
import { triggerHaptic } from '../lib/haptics';
import { scoreSpeechMatch } from '../lib/speechMatch';
import { getFlashcardFlipMotion, getSpotlightPosition } from '../lib/motion';
import {
  EXPLANATION_TRANSLATION_FAILURE_MESSAGE,
  translateExplanationSafely,
} from '../lib/recoverableActions';
import { RecoverableActionFeedback } from './RecoverableActionFeedback';
import { CardAiAssistantModal } from './flashcard/CardAiAssistantModal';
import { CardImage } from './flashcard/CardImage';
import { RichVietnameseExplanation } from './flashcard/RichVietnameseExplanation';
import { SpeechMatchFeedback, type SpeechMatchFeedbackValue } from './flashcard/SpeechMatchFeedback';
import type { CardData } from '../types/card';

gsap.registerPlugin(useGSAP);

interface FlashcardProps {
  data: CardData;
  onDelete?: (id: string) => void | Promise<void>;
  onToggleBookmark?: (id: string) => void;
  customDecks?: string[];
  onAssignDeck?: (cardId: string, deckName: string | null) => void;
  onUpdateCard?: (cardId: string, updatedFields: Partial<CardData>) => void;
  initialSide?: 'front' | 'back';
  imagePriority?: boolean;
}

export const Flashcard = React.memo(function Flashcard({ data, onDelete, onToggleBookmark, customDecks = [], onAssignDeck, onUpdateCard, initialSide = 'front', imagePriority = false }: FlashcardProps) {
  const supportedImageUrl = isSupportedImageUrl(data.imageUrl) ? data.imageUrl : null;
  const [isFlipped, setIsFlipped] = useState(initialSide === 'back');
  const [flipDirection, setFlipDirection] = useState<1 | -1>(initialSide === 'back' ? 1 : -1);
  const [isFlipAnimating, setIsFlipAnimating] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const frontFlipRef = useRef<HTMLButtonElement | null>(null);
  const backFlipRef = useRef<HTMLButtonElement | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmedRef = useRef(false);
  const deckButtonRef = useRef<HTMLButtonElement | null>(null);
  const learningDetailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterFlipRef = useRef<'front' | 'back' | null>(null);
  const gestureRef = useRef({ x: 0, y: 0, moved: false, startedOnControl: false });
  const shellRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const spotlightBoundsRef = useRef<DOMRect | null>(null);
  const spotlightXToRef = useRef<((value: number) => void) | null>(null);
  const spotlightYToRef = useRef<((value: number) => void) | null>(null);
  const tiltXToRef = useRef<((value: number) => void) | null>(null);
  const tiltYToRef = useRef<((value: number) => void) | null>(null);
  const hasMountedFaceRef = useRef(false);
  const flipOutTweenRef = useRef<gsap.core.Tween | null>(null);
  const flipCommitTimerRef = useRef<number | null>(null);
  const starButtonRef = useRef<HTMLButtonElement | null>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<'word' | 'explanation' | null>(null);
  const [pronunciationScore, setPronunciationScore] = useState<SpeechMatchFeedbackValue | null>(null);
  const [pronunciationError, setPronunciationError] = useState<string | null>(null);
  const [showDeckSelector, setShowDeckSelector] = useState(false);
  const [showLearningDetails, setShowLearningDetails] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [isBlindMode, setIsBlindMode] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const updatePreference = () => setReduceMotion(query.matches);
    query.addEventListener('change', updatePreference);
    return () => query.removeEventListener('change', updatePreference);
  }, []);

  useGSAP(() => {
    const target = spotlightRef.current;
    if (target) {
      gsap.set(target, { '--spotlight-x': 50, '--spotlight-y': 50 });
      spotlightXToRef.current = gsap.quickTo(target, '--spotlight-x', { duration: 0.28, ease: 'power3.out' });
      spotlightYToRef.current = gsap.quickTo(target, '--spotlight-y', { duration: 0.28, ease: 'power3.out' });
    }
    const face = faceRef.current;
    if (face && !reduceMotion) {
      tiltXToRef.current = gsap.quickTo(face, 'rotationX', { duration: 0.35, ease: 'power2.out' });
      tiltYToRef.current = gsap.quickTo(face, 'rotationY', { duration: 0.35, ease: 'power2.out' });
    }
    return () => {
      spotlightXToRef.current = null;
      spotlightYToRef.current = null;
      tiltXToRef.current = null;
      tiltYToRef.current = null;
    };
  }, { scope: shellRef, dependencies: [isFlipped, reduceMotion], revertOnUpdate: true });

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const bounds = spotlightBoundsRef.current ?? event.currentTarget.getBoundingClientRect();
    spotlightBoundsRef.current = bounds;
    const position = getSpotlightPosition(event.clientX, event.clientY, bounds);
    spotlightXToRef.current?.(position.x);
    spotlightYToRef.current?.(position.y);

    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const px = (x / bounds.width - 0.5) * 2;
    const py = (y / bounds.height - 0.5) * 2;
    tiltXToRef.current?.(-py * 5.5);
    tiltYToRef.current?.(px * 5.5);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    spotlightBoundsRef.current = null;
    spotlightXToRef.current?.(50);
    spotlightYToRef.current?.(50);
    tiltXToRef.current?.(0);
    tiltYToRef.current?.(0);
  };

  const handleMouseEnter = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      spotlightBoundsRef.current = event.currentTarget.getBoundingClientRect();
      setIsHovered(true);
    }
  };

  const showCardSide = (side: 'front' | 'back') => {
    const nextFlipped = side === 'back';
    if (nextFlipped === isFlipped || isFlipAnimating) return;
    playFlipSound();
    triggerHaptic('light');
    const direction: 1 | -1 = nextFlipped ? 1 : -1;
    let sideCommitted = false;
    const commitSideChange = () => {
      if (sideCommitted) return;
      sideCommitted = true;
      if (flipCommitTimerRef.current !== null) {
        window.clearTimeout(flipCommitTimerRef.current);
        flipCommitTimerRef.current = null;
      }
      flipOutTweenRef.current = null;
      setFlipDirection(direction);
      setIsFlipped(nextFlipped);
    };

    if (reduceMotion || !faceRef.current) {
      setIsFlipAnimating(false);
      commitSideChange();
      return;
    }

    setIsFlipAnimating(true);
    flipOutTweenRef.current?.kill();
    flipOutTweenRef.current = gsap.to(faceRef.current, {
      autoAlpha: 0.62,
      rotationY: direction * -92,
      scale: 0.985,
      duration: 0.16,
      ease: 'power2.in',
      force3D: true,
      transformOrigin: 'center center',
      onComplete: commitSideChange,
    });
    // GSAP relies on requestAnimationFrame, which browsers may suspend in a
    // throttled/background tab. Never let that leave the card interaction locked.
    flipCommitTimerRef.current = window.setTimeout(commitSideChange, 320);
  };

  const handleCardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    const startedOnControl = target instanceof Element && Boolean(target.closest('[data-card-control], button, a, input, select, textarea, summary, [role="dialog"]'));
    if (startedOnControl && focusAfterFlipRef.current) {
      // A later control interaction supersedes the flip's pending focus move.
      focusAfterFlipRef.current = null;
    }
    gestureRef.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      startedOnControl,
    };
  };

  const handleCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true;
  };

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      event.defaultPrevented
      || gestureRef.current.moved
      || gestureRef.current.startedOnControl
      || (target instanceof Element && target.closest('[data-card-control], button, a, input, select, textarea, summary, [role="dialog"]'))
    ) return;
    showCardSide(isFlipped ? 'front' : 'back');
  };

  const completeFaceTransition = (side: 'front' | 'back') => {
    if ((side === 'back') !== isFlipped) return;
    setIsFlipAnimating(false);
    const destination = focusAfterFlipRef.current;
    if (!destination || destination !== side) return;
    focusAfterFlipRef.current = null;
    window.requestAnimationFrame(() => {
      (destination === 'back' ? backFlipRef : frontFlipRef).current?.focus();
    });
  };

  useGSAP(() => {
    const face = faceRef.current;
    if (!face) return;
    if (!hasMountedFaceRef.current) {
      hasMountedFaceRef.current = true;
      gsap.set(face, { clearProps: 'transform,opacity,visibility' });
      return;
    }

    const side = isFlipped ? 'back' : 'front';
    const media = gsap.matchMedia();
    media.add(
      {
        reduced: '(prefers-reduced-motion: reduce)',
        expressive: '(prefers-reduced-motion: no-preference)',
      },
      context => {
        const animation = getFlashcardFlipMotion(flipDirection, Boolean(context.conditions?.reduced));
        let transitionFinished = false;
        const finishTransition = () => {
          if (transitionFinished) return;
          transitionFinished = true;
          gsap.killTweensOf(face);
          gsap.set(face, { clearProps: 'transform,opacity,visibility' });
          completeFaceTransition(side);
        };
        const completionFallback = window.setTimeout(finishTransition, 500);
        gsap.fromTo(face, animation.from, {
          ...animation.to,
          transformOrigin: 'center center',
          force3D: !context.conditions?.reduced,
          onComplete: () => {
            window.clearTimeout(completionFallback);
            finishTransition();
          },
        });
        return () => window.clearTimeout(completionFallback);
      },
    );
    return () => media.revert();
  }, { scope: shellRef, dependencies: [isFlipped, flipDirection], revertOnUpdate: true });

  useEffect(() => () => {
    flipOutTweenRef.current?.kill();
    if (flipCommitTimerRef.current !== null) window.clearTimeout(flipCommitTimerRef.current);
    gsap.killTweensOf(starButtonRef.current);
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    audioRef.current?.pause();
  }, []);

  const speakFallback = (text: string) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setPronunciationError('Audio playback is not supported by this browser.');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utteranceRef.current = utterance;
    utterance.onend = () => {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
    };
    utterance.onerror = () => {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setPronunciationError('Audio could not be played. Check this site’s audio permission and try again.');
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    // Keep this call inside the original click event. Safari can block delayed TTS.
    window.speechSynthesis.speak(utterance);
  };

  const playAudio = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    setPronunciationError(null);
    if (audioRef.current) {
      audioRef.current.pause();
      try {
        audioRef.current.currentTime = 0;
      } catch {
        // Some Safari streams cannot seek until their metadata is ready.
      }
      audioRef.current.play().catch((err) => {
        console.warn('Audio play failed, using web speech fallback:', err);
        speakFallback(data.word);
      });
    } else {
      speakFallback(data.word);
    }
  };

  const playExplanationAudio = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    setPronunciationError(null);
    speakFallback(data.explanation);
  };

  const startPronunciationCheck = (e: React.MouseEvent | React.PointerEvent, targetType: 'word' | 'explanation' = 'word') => {
    e.stopPropagation();
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setPronunciationError('This browser does not support speech recognition. Try Google Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current?.abort?.();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setPronunciationError(null);
      setIsRecording(true);
      setRecordingTarget(targetType);
      setPronunciationScore(null);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase().replace(/[.,?!:;'"()\-]/g, '').trim();
      const targetText = (targetType === 'word' ? data.word : data.explanation).toLowerCase().replace(/[.,?!:;'"()\-]/g, '').trim();
      
      const confidence = Number(event.results[0][0].confidence ?? 0.75);
      const match = scoreSpeechMatch(targetText, transcript, confidence);
      setPronunciationScore({ score: match.score, confidence: match.confidence, transcript, type: targetType });
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setPronunciationError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access is blocked. Allow microphone access for this site, then try again.'
        : 'Speech could not be recognised. Check microphone permission and try again.');
      setIsRecording(false);
      setRecordingTarget(null);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      setRecordingTarget(null);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };

    setPronunciationError(null);
    setPronunciationScore(null);
    setIsRecording(true);
    setRecordingTarget(targetType);
    try {
      recognition.start();
    } catch (error) {
      console.error('Could not start speech recognition', error);
      setPronunciationError('The microphone could not start. Check permission and try again.');
      setIsRecording(false);
      setRecordingTarget(null);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    }
  };

  const translateExplanation = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (isTranslating) return;

    setTranslationError(null);
    setIsTranslating(true);
    try {
      const result = await translateExplanationSafely(async explanation => {
        const { translateText } = await import('../lib/gemini');
        return translateText(explanation);
      }, data.explanation);

      if (result.status === 'translated') {
        if (onUpdateCard) {
          onUpdateCard(data.id, { explanationTranslation: result.value });
        } else {
          setTranslationError(EXPLANATION_TRANSLATION_FAILURE_MESSAGE);
        }
        return;
      }
      setTranslationError(result.message ?? EXPLANATION_TRANSLATION_FAILURE_MESSAGE);
    } catch {
      setTranslationError(EXPLANATION_TRANSLATION_FAILURE_MESSAGE);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div 
      ref={shellRef}
      className="flashcard-shell group relative mx-auto h-[clamp(560px,72dvh,610px)] w-full max-w-[580px] touch-pan-y overflow-hidden rounded-[30px] bg-[var(--sf-surface)]"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="group"
      aria-label={`${data.word} flashcard. ${isFlipped ? 'Showing the Vietnamese meaning.' : 'Showing the English word.'}`}
      data-card-side={isFlipped ? 'back' : 'front'}
      data-flip-animation={reduceMotion ? 'reduced' : 'spatial'}
    >
      <span className="sr-only" aria-live="polite">{isFlipped ? 'Vietnamese meaning revealed' : 'English word revealed'}</span>
      <AlertDialog.Root
        open={showConfirmDelete}
        onOpenChange={open => {
          if (open) deleteConfirmedRef.current = false;
          setShowConfirmDelete(open);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/72" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none" onClick={event => event.stopPropagation()} onCloseAutoFocus={event => {
            event.preventDefault();
            if (!deleteConfirmedRef.current) deleteButtonRef.current?.focus();
            deleteConfirmedRef.current = false;
          }}>
            <AlertDialog.Title className="text-balance text-lg font-black">Delete “{data.word}”?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-pretty text-sm leading-relaxed text-[var(--sf-text-muted)]">The card will be removed from your library and the change will sync to the shared store.</AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-3">
              <AlertDialog.Cancel className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]">Keep card</AlertDialog.Cancel>
              <AlertDialog.Action onClick={() => {
                deleteConfirmedRef.current = true;
                void onDelete?.(data.id);
              }} className="min-h-11 rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-800">Delete card</AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog.Root open={showLearningDetails} onOpenChange={setShowLearningDetails}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/72" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none sm:p-7" aria-describedby={`learning-details-description-${data.id}`} onCloseAutoFocus={event => {
            event.preventDefault();
            // WebKit keeps the page inert until the controlled portal finishes
            // unmounting, so restore focus after both the next task and frame.
            globalThis.setTimeout(() => globalThis.requestAnimationFrame(() => {
              learningDetailsButtonRef.current?.focus({ preventScroll: true });
            }), 0);
          }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-balance text-xl font-black">Learning details</Dialog.Title>
                <Dialog.Description id={`learning-details-description-${data.id}`} className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]">Useful context for remembering “{data.word}”.</Dialog.Description>
              </div>
              <Dialog.Close className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]" aria-label="Close learning details"><X size={18} /></Dialog.Close>
            </div>
            <div className="mt-6 space-y-5">
              <div className="flex flex-wrap gap-2">
                {data.partOfSpeech && <DetailChip>{data.partOfSpeech}</DetailChip>}
                {data.cefrLevel && <DetailChip>CEFR {data.cefrLevel}</DetailChip>}
                {data.register && <DetailChip>{data.register}</DetailChip>}
              </div>
              {data.exampleSentence && <DetailSection title="Example"><p className="text-sm font-semibold text-[var(--sf-text)]">{data.exampleSentence}</p>{data.exampleTranslation && <p lang="vi" className="mt-2 text-sm text-[var(--sf-text-muted)]">{data.exampleTranslation}</p>}</DetailSection>}
              {data.collocations && data.collocations.length > 0 && <DetailSection title="Collocations"><WordList values={data.collocations} /></DetailSection>}
              {data.synonyms && data.synonyms.length > 0 && <DetailSection title="Synonyms"><WordList values={data.synonyms} /></DetailSection>}
              {data.antonyms && data.antonyms.length > 0 && <DetailSection title="Antonyms"><WordList values={data.antonyms} /></DetailSection>}
              {data.commonMistake && <DetailSection title="Common mistake"><p className="text-sm leading-relaxed text-orange-700 dark:text-orange-300">{data.commonMistake}</p></DetailSection>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <CardAiAssistantModal
        card={data}
        open={showAiModal}
        onOpenChange={setShowAiModal}
      />
      {onDelete && (
        <button
          ref={deleteButtonRef}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteConfirmedRef.current = false; setShowConfirmDelete(true); }}
          className={`liquid-control absolute -left-2 -top-2 z-50 flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-slate-500 opacity-100 transition-[transform,opacity,color] duration-200 hover:text-rose-600 lg:scale-95 lg:opacity-0 lg:group-hover:scale-100 lg:group-hover:opacity-100 lg:group-focus-within:scale-100 lg:group-focus-within:opacity-100 dark:text-slate-300 dark:hover:text-rose-300 ${isFlipAnimating ? '!pointer-events-none !opacity-0' : ''}`}
          title="Delete card"
          aria-label="Delete card"
        >
          <Trash2 size={15} />
        </button>
      )}

      {(onToggleBookmark || !isFlipped) && (
        <div className={`absolute right-4 top-4 z-[70] flex flex-row-reverse items-center gap-2 transition-opacity duration-150 ${isFlipAnimating ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
          {onToggleBookmark && (
            <button
              ref={starButtonRef}
              type="button"
              data-color-role="reward"
              onMouseEnter={event => {
                if (reduceMotion) return;
                gsap.to(event.currentTarget, { scale: 1.05, rotation: 6, duration: 0.18, ease: 'power3.out', overwrite: 'auto' });
              }}
              onMouseLeave={event => {
                gsap.to(event.currentTarget, { scale: 1, rotation: 0, duration: reduceMotion ? 0 : 0.22, ease: 'power3.out', overwrite: 'auto' });
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (!data.bookmarked) {
                  playRewardSound();
                  triggerHaptic('success');
                } else {
                  triggerHaptic('light');
                }
                onToggleBookmark(data.id);
              }}
              className={`flashcard-reward-button flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 transition-[transform,background-color,border-color,color] duration-200 ${
                data.bookmarked
                  ? 'border border-[var(--sf-reward)] bg-[var(--sf-reward)] text-slate-950 shadow-lg shadow-amber-500/15'
                  : 'border border-white/35 bg-slate-950/48 text-white shadow-lg backdrop-blur-2xl hover:border-amber-300/70 hover:text-amber-300'
              }`}
              title={data.bookmarked ? 'Remove star' : 'Star this word'}
              aria-label={data.bookmarked ? 'Remove star' : 'Star this word'}
              aria-pressed={data.bookmarked}
            >
              <span className={data.bookmarked ? 'flashcard-star-selected' : undefined}>
                <Star size={15} className={data.bookmarked ? 'fill-slate-900' : ''} />
              </span>
            </button>
          )}

          {!isFlipped && (
            <button
              type="button"
              onClick={event => {
                event.stopPropagation();
                setIsBlindMode(value => !value);
              }}
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border p-2 shadow-lg backdrop-blur-2xl transition-colors ${isBlindMode ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'border-white/35 bg-slate-950/48 text-white hover:bg-slate-950/72'}`}
              title={isBlindMode ? 'Show hints' : 'Hide hints'}
              aria-label={isBlindMode ? 'Reveal image and definition' : 'Hide image and definition'}
              aria-pressed={isBlindMode}
            >
              {isBlindMode ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
        </div>
      )}

      <div
        data-flashcard-stage
        className="relative h-full w-full overflow-hidden rounded-[30px]"
        style={{ perspective: reduceMotion ? 'none' : '1600px' }}
        onPointerDownCapture={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onClick={handleCardClick}
      >
        {/* A face uses 3D only during the hand-off; the settled face returns to transform: none for crisp text. */}
        {!isFlipped ? (
        <div
          ref={faceRef}
          style={{ transformOrigin: 'center center', borderRadius: '30px' }}
          className="flashcard-face absolute flex h-full w-full flex-col overflow-hidden rounded-[30px] transition-[box-shadow,border-color] duration-300 hover:border-[var(--sf-brand)]"
        >
          <div
            ref={spotlightRef}
            className="absolute inset-0 pointer-events-none z-10 mix-blend-screen transition-opacity duration-200"
            style={{
              background: 'radial-gradient(circle at calc(var(--spotlight-x, 50) * 1%) calc(var(--spotlight-y, 50) * 1%), rgba(6, 182, 212, 0.13) 0%, rgba(6, 182, 212, 0.04) 34%, transparent 68%)',
              opacity: isHovered ? 1 : 0,
            }}
          />
          <div className="group/image relative h-[48%] w-full overflow-hidden bg-[var(--sf-surface-raised)]">
            <div className={`h-full w-full transition-[filter,transform] duration-500 ${isBlindMode ? 'scale-110 blur-2xl saturate-50' : 'scale-[1.01]'}`} aria-hidden={isBlindMode}>
              {supportedImageUrl ? <CardImage src={supportedImageUrl} alt={`Illustration for ${data.word}`} priority={imagePriority} /> : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[var(--sf-text-muted)]" role="img" aria-label={`No image for ${data.word}`}>
                  <span className="liquid-control flex size-16 items-center justify-center rounded-[22px]"><ImageOff size={28} strokeWidth={1.5} /></span>
                  <span className="text-sm font-semibold">Image cue unavailable</span>
                </div>
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/55 to-transparent" aria-hidden="true" />
            {isBlindMode && <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/22 px-6 text-center text-white backdrop-blur-md"><EyeOff size={24} /><span className="mt-2 text-sm font-bold">Visual hint hidden</span></div>}
          </div>

          <div className="liquid-content-dock relative z-20 mx-3 -mt-8 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px]">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-4 pt-4 scrollbar-thin sm:px-6">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
                <div className="min-w-0 text-left">
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xs font-semibold text-[var(--sf-text-muted)]">
                    <span className={`rounded-full border px-2 py-0.5 capitalize ${data.partOfSpeech ? 'border-cyan-200/80 bg-cyan-50/80 text-cyan-800 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-200' : 'border-slate-200 bg-slate-100/70 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400'}`} aria-label={`Part of speech: ${data.partOfSpeech || 'unspecified'}`}>{data.partOfSpeech || 'Type unspecified'}</span>
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{data.category}</span>
                    {!data.nextReviewDate
                      ? <span className="text-emerald-700 dark:text-emerald-300">New card</span>
                      : isCardDue(data) && <span className="text-rose-600 dark:text-rose-300">Due for review</span>}
                    {data.difficulty && data.difficulty !== 'unrated' && <span>{data.difficulty === 'easy' ? 'Mastered' : data.difficulty === 'good' ? 'Learning' : 'Needs practice'}</span>}
                  </div>
                  <h2 className="break-words text-balance text-3xl font-black capitalize tracking-[-0.055em] text-[var(--sf-text)] [overflow-wrap:anywhere] sm:text-4xl">{data.word}</h2>
                  <p className="mt-1 break-words font-mono text-xs font-semibold text-[var(--sf-brand-text)] [overflow-wrap:anywhere]">{data.phonetic || '/.../'}</p>
                </div>
                <div className="relative z-30 flex w-full shrink-0 justify-end gap-2 sm:w-auto sm:pt-4" data-card-control>
                  <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={playAudio} className="liquid-control touch-manipulation flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--sf-brand-text)]" aria-label="Play pronunciation"><Volume2 size={15} /></button>
                  <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={event => startPronunciationCheck(event, 'word')} disabled={isRecording} className={`touch-manipulation flex min-h-11 min-w-11 items-center justify-center rounded-full ${isRecording && recordingTarget === 'word' ? 'bg-rose-500 text-white' : 'liquid-control text-[var(--sf-text)]'}`} aria-label="Check pronunciation"><Mic size={15} /></button>
                </div>
              </div>

              {isRecording && <div className="mt-3 flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-300"><span className="size-2 rounded-full bg-rose-500 animate-pulse" />Listening</div>}
              {pronunciationScore && <SpeechMatchFeedback value={pronunciationScore} target={pronunciationScore.type === 'word' ? data.word : data.explanation} />}
              {pronunciationError && <p className="mt-2 text-pretty text-xs font-semibold text-rose-700 dark:text-rose-300" role="alert">{pronunciationError}</p>}

              <div className="relative mt-4 text-left">
                <p aria-hidden={isBlindMode} className={`break-words text-sm leading-6 text-[var(--sf-text)] [overflow-wrap:anywhere] transition-[filter,opacity] ${isBlindMode ? 'select-none blur-md opacity-35' : ''}`}>{data.explanation}</p>
                {isBlindMode && <div className="pointer-events-none absolute inset-0 flex items-center justify-start"><span className="text-xs font-bold text-[var(--sf-text-muted)]">Definition hidden</span></div>}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={playExplanationAudio} className="liquid-control touch-manipulation flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold text-[var(--sf-text)]" title="Listen to the definition"><Volume2 size={13} /><span>Listen</span></button>
                <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={event => startPronunciationCheck(event, 'explanation')} disabled={isRecording} className={`touch-manipulation flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold ${isRecording && recordingTarget === 'explanation' ? 'bg-rose-500 text-white' : 'liquid-control text-[var(--sf-text)]'}`} title="Practise reading the definition"><Mic size={13} /><span>Read aloud</span></button>
                {onAssignDeck && <Dialog.Root open={showDeckSelector} onOpenChange={setShowDeckSelector}>
                  <Dialog.Trigger asChild><button ref={deckButtonRef} onPointerDown={event => event.stopPropagation()} className="liquid-control flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 text-xs font-bold text-[var(--sf-text)]"><FolderOpen size={14} /><span className="max-w-32 truncate">{data.customDeck || 'Choose deck'}</span></button></Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-sm" />
                    <Dialog.Content className="liquid-glass fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6 outline-none" aria-describedby={`deck-description-${data.id}`}>
                      <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-balance text-lg font-black text-[var(--sf-text)]">Choose a deck</Dialog.Title><Dialog.Description id={`deck-description-${data.id}`} className="mt-1 text-pretty text-sm text-[var(--sf-text-muted)]">Organise “{data.word}” without leaving the card.</Dialog.Description></div><Dialog.Close className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--sf-text)]" aria-label="Close deck selector"><X size={18} /></Dialog.Close></div>
                      <div className="mt-5 max-h-[min(360px,55dvh)] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                        <button onClick={() => { onAssignDeck(data.id, null); setShowDeckSelector(false); }} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold ${!data.customDeck ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'liquid-control text-[var(--sf-text)]'}`}><FolderX size={16} /><span>Unassigned</span>{!data.customDeck && <CheckCircle2 size={15} className="ml-auto" />}</button>
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
              onClick={event => {
                event.stopPropagation();
                focusAfterFlipRef.current = 'back';
                showCardSide('back');
              }}
              className="group/flip relative flex min-h-[64px] w-full flex-shrink-0 items-center gap-3 overflow-hidden border-x-0 border-b-0 border-t border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] outline-none transition-[background-color,border-color] hover:border-[var(--sf-brand)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-brand)]"
              aria-label={`Reveal the Vietnamese meaning of ${data.word}`}
            >
              <span className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/75 to-transparent" aria-hidden="true" />
              <span className="flex size-9 shrink-0 items-center justify-center text-[var(--sf-brand-text)]">
                <Languages size={18} strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black tracking-[-0.01em] text-[var(--sf-text)]">Reveal meaning</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-[var(--sf-text-muted)]">Flip to the Vietnamese side</span>
              </span>
              <span className="flex size-9 shrink-0 items-center justify-center text-[var(--sf-brand-text)] transition-transform group-hover/flip:translate-x-1">
                <ChevronRight size={17} strokeWidth={2.3} />
              </span>
          </button>
          </div>
        </div>
        ) : (
        <div
          ref={faceRef}
          style={{ transformOrigin: 'center center', borderRadius: '30px' }}
          className="flashcard-back absolute inset-0 isolate box-border flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[30px] text-white transition-[box-shadow,border-color] duration-300 hover:border-[var(--sf-brand)]"
        >
          <div
            ref={spotlightRef}
            className="absolute inset-0 pointer-events-none z-10 mix-blend-screen transition-opacity duration-200"
            style={{
              background: 'radial-gradient(circle at calc(var(--spotlight-x, 50) * 1%) calc(var(--spotlight-y, 50) * 1%), rgba(165, 243, 252, 0.14) 0%, rgba(34, 211, 238, 0.04) 38%, transparent 70%)',
              opacity: isHovered ? 1 : 0,
            }}
          />
          <div className="pointer-events-none absolute -bottom-20 -right-20 size-72 rounded-full border border-white/8 bg-white/[0.025]" aria-hidden="true" />
          <div className={`absolute top-5 flex flex-wrap items-center gap-2 ${onDelete ? 'left-16' : 'left-5'}`}>
            <div className="text-xs font-bold text-slate-200">
              Vietnamese
            </div>
              {data.nextReviewDate && isCardDue(data) && (
                <div className="bg-rose-600/95 dark:bg-rose-950/80 text-white dark:text-rose-200 backdrop-blur-md px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase border border-rose-400/20 dark:border-rose-800/40 shadow-sm flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-400"></span>
                  </span>
                  <span>Review overdue</span>
                </div>
              )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-16 text-center scrollbar-thin sm:px-6">
            <div className="relative w-full overflow-hidden rounded-[28px] border border-white/18 bg-white/[0.09] px-4 pb-4 pt-5 shadow-[0_24px_50px_-30px_rgba(2,20,30,0.8),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-2xl sm:px-5">
              <div className="relative mx-auto mb-3 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-slate-950/22 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-100">
                <Languages size={13} /> Meaning revealed
              </div>
              <p className="relative text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">Vietnamese</p>
              <h2 lang="vi" className="relative mt-1 break-words text-balance text-4xl font-black tracking-[-0.055em] text-white drop-shadow-sm first-letter:uppercase [overflow-wrap:anywhere] sm:text-5xl">
                {data.translation}
              </h2>
              <div className="relative mt-4 flex items-center justify-between gap-3 rounded-[18px] border border-white/12 bg-slate-950/16 px-3 py-2 text-left shadow-inner shadow-slate-950/10">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.17em] text-slate-300">Original word</p>
                  <p className="break-words text-base font-black capitalize text-white [overflow-wrap:anywhere] sm:text-lg">{data.word}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                 <button
                   type="button"
                   data-card-control
                   onPointerDown={(e) => e.stopPropagation()}
                   onClick={playAudio}
                   style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                   className="liquid-control touch-manipulation flex min-h-11 min-w-11 items-center justify-center rounded-full border-white/15 bg-white/12 text-white transition-colors"
                   aria-label="Play pronunciation"
                 >
                   <Volume2 size={12} />
                 </button>
                 <button
                   type="button"
                   data-card-control
                   onPointerDown={(e) => e.stopPropagation()}
                   onClick={startPronunciationCheck}
                   disabled={isRecording}
                   style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                   className={`touch-manipulation flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors ${isRecording ? 'bg-rose-500 text-white animate-pulse' : 'liquid-control border-white/15 bg-white/12 text-white'}`}
                   aria-label="Check pronunciation"
                   title="Practise pronunciation"
                 >
                   <Mic size={12} />
                 </button>
                </div>
               </div>
               {pronunciationError && <p className="mt-2 text-pretty text-xs font-semibold text-rose-100" role="alert">{pronunciationError}</p>}
            </div>
 
            {/* Description Translation */}
            <div className="mt-3 flex w-full flex-col items-start rounded-[22px] border border-white/12 bg-slate-950/14 p-4 text-left shadow-lg shadow-slate-950/10 backdrop-blur-xl">
              <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-[var(--sf-brand-text)]" aria-hidden="true"><Languages size={15} /></span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-200">Explanation in Vietnamese</p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-300">Natural translations and usage notes</p>
                </div>
              </div>
              {data.explanationTranslation ? (
                <RichVietnameseExplanation value={data.explanationTranslation} />
              ) : (
                <>
                  <button
                    type="button"
                    data-card-control
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={translateExplanation}
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--sf-brand)] bg-[var(--sf-brand)] px-3.5 py-2 text-[11px] font-bold text-[var(--sf-on-brand)] shadow-inner shadow-slate-950/10 transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 size={11} className="animate-spin" />
                        <span>Translating…</span>
                      </>
                    ) : (
                      <>
                        <Languages size={11} />
                        <span>Translate explanation</span>
                      </>
                    )}
                  </button>
                  {translationError ? (
                    <RecoverableActionFeedback
                      message={translationError}
                      retryLabel="Try again"
                      onRetry={() => void translateExplanation()}
                      dismissLabel="Dismiss translation error"
                      onDismiss={() => setTranslationError(null)}
                      className="w-full"
                    />
                  ) : null}
                </>
              )}
            </div>

            {(data.partOfSpeech || data.cefrLevel || data.exampleSentence || data.collocations?.length || data.synonyms?.length || data.antonyms?.length || data.commonMistake) && (
              <button ref={learningDetailsButtonRef} type="button" onClick={() => setShowLearningDetails(true)} className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-[22px] border border-white/15 bg-white/[0.08] px-3 py-2 text-left text-slate-100 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-white">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/10"><BookOpen size={17} /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold">Learning details</span><span className="block truncate text-xs text-slate-300">Examples, word relations, and usage notes</span></span>
                <ChevronRight size={17} />
              </button>
            )}

            <button
              type="button"
              data-card-control
              onPointerDown={e => e.stopPropagation()}
              onClick={() => setShowAiModal(true)}
              className="mt-2.5 flex min-h-12 w-full items-center gap-3 rounded-[20px] border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-2 text-left text-cyan-200 shadow-md backdrop-blur-xl transition-colors hover:bg-cyan-500/20 hover:border-cyan-400/50 focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[12px] bg-cyan-500/20 text-cyan-300">
                <Sparkles size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-black uppercase tracking-wider text-cyan-300">Ask AI Tutor</span>
                <span className="block truncate text-[11px] font-medium text-slate-300">Ví dụ công sở, ngữ cảnh &amp; từ đồng nghĩa</span>
              </span>
              <ChevronRight size={16} className="text-cyan-300" />
            </button>
          </div>
 
          <div className="relative z-20 box-border flex-shrink-0 overflow-hidden rounded-b-[29px] border-t border-white/12 bg-slate-950/16 p-3 backdrop-blur-2xl">
            <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" aria-hidden="true" />
            <button
              ref={backFlipRef}
              type="button"
              data-flip-card
              onClick={(event) => {
                event.stopPropagation();
                focusAfterFlipRef.current = 'front';
                showCardSide('front');
              }}
              className="group/back flex min-h-[60px] w-full items-center gap-3 rounded-[18px] border border-white/18 bg-white/[0.09] px-3.5 py-2 text-left text-white shadow-[0_16px_34px_-22px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.18)] outline-none transition-[border-color,background-color] hover:border-[var(--sf-brand)] hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-[var(--sf-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#102229]"
              aria-label={`Return to the English side of ${data.word}`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] border border-white/15 bg-white/12 text-slate-100 shadow-inner shadow-white/5">
                <ChevronRight size={18} className="rotate-180 transition-transform group-hover/back:-translate-x-0.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black">Back to English</span>
                <span className="mt-0.5 block break-words text-[11px] font-semibold text-slate-300 [overflow-wrap:anywhere]">Return to “{data.word}”</span>
              </span>
              <Languages size={18} className="mr-2 text-[var(--sf-brand-text)]" />
            </button>
          </div>
        </div>
        )}
      </div>

      {data.audioUrl && (
        <audio ref={audioRef} src={data.audioUrl} preload={imagePriority ? 'metadata' : 'none'} />
      )}
    </div>
  );
});

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4">
      <h3 className="mb-2 text-xs font-black text-[var(--sf-text-muted)]">{title}</h3>
      {children}
    </section>
  );
}

function DetailChip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-lg border border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))] px-2.5 py-1 text-xs font-bold text-[var(--sf-brand-text)]">{children}</span>;
}

function WordList({ values }: { values: string[] }) {
  return <div className="flex flex-wrap gap-2">{values.map(value => <span key={value} className="rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)] px-2.5 py-1 text-sm font-semibold text-[var(--sf-text)]">{value}</span>)}</div>;
}
