import { useGSAP } from '@gsap/react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import gsap from 'gsap';
import { AudioLines, BookOpen, CheckCircle2, ChevronRight, Eye, EyeOff, FolderOpen, FolderX, HelpCircle, ImageOff, Languages, Loader2, Mic, Sparkles, Star, Trash2, Volume2, X } from 'lucide-react';
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
import { SyllableStressBadge } from './flashcard/SyllableStressBadge';
import { CardMnemonicSection } from './flashcard/CardMnemonicSection';
import { ActiveRecallQuiz } from './flashcard/ActiveRecallQuiz';
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
  const [audioSpeed, setAudioSpeed] = useState<1.0 | 0.75>(1.0);
  const [showQuickQuiz, setShowQuickQuiz] = useState(false);
  const rafTiltRef = useRef<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(
    () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const updatePreference = () => setReduceMotion(query.matches);
    query.addEventListener('change', updatePreference);
    return () => {
      query.removeEventListener('change', updatePreference);
      if (rafTiltRef.current !== null) {
        window.cancelAnimationFrame(rafTiltRef.current);
        rafTiltRef.current = null;
      }
    };
  }, []);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const clientX = event.clientX;
    const clientY = event.clientY;
    const currentTarget = event.currentTarget;
    if (rafTiltRef.current !== null) return;
    rafTiltRef.current = window.requestAnimationFrame(() => {
      rafTiltRef.current = null;
      const bounds = spotlightBoundsRef.current ?? currentTarget.getBoundingClientRect();
      spotlightBoundsRef.current = bounds;
      const position = getSpotlightPosition(clientX, clientY, bounds);

      if (spotlightRef.current) {
        spotlightRef.current.style.setProperty('--spotlight-x', `${position.x}%`);
        spotlightRef.current.style.setProperty('--spotlight-y', `${position.y}%`);
      }

      if (!isFlipAnimating && faceRef.current) {
        const x = clientX - bounds.left;
        const y = clientY - bounds.top;
        const px = (x / bounds.width - 0.5) * 2;
        const py = (y / bounds.height - 0.5) * 2;
        gsap.to(faceRef.current, {
          rotationX: -py * 4,
          rotationY: px * 4,
          duration: 0.28,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      }
    });
  };

  const handleMouseLeave = () => {
    if (rafTiltRef.current !== null) {
      window.cancelAnimationFrame(rafTiltRef.current);
      rafTiltRef.current = null;
    }
    setIsHovered(false);
    spotlightBoundsRef.current = null;
    if (spotlightRef.current) {
      spotlightRef.current.style.setProperty('--spotlight-x', '50%');
      spotlightRef.current.style.setProperty('--spotlight-y', '50%');
    }
    if (!isFlipAnimating && faceRef.current) {
      gsap.to(faceRef.current, {
        rotationX: 0,
        rotationY: 0,
        duration: 0.35,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }
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

  const toggleAudioSpeed = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    triggerHaptic('light');
    setAudioSpeed(prev => (prev === 1.0 ? 0.75 : 1.0));
  };

  const speakFallback = (text: string) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setPronunciationError('Audio playback is not supported by this browser.');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = audioSpeed === 0.75 ? 0.65 : 0.9;
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
        audioRef.current.playbackRate = audioSpeed;
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

  const getCategoryAura = (category?: string) => {
    const cat = (category || '').toLowerCase();
    if (cat.includes('nature') || cat.includes('environment')) {
      return {
        core: 'rgba(16, 185, 129, 0.7)',
        mid: 'rgba(6, 182, 212, 0.45)',
        outer: 'rgba(5, 150, 105, 0.2)',
      };
    }
    if (cat.includes('tech') || cat.includes('science')) {
      return {
        core: 'rgba(6, 182, 212, 0.8)',
        mid: 'rgba(59, 130, 246, 0.5)',
        outer: 'rgba(147, 51, 234, 0.25)',
      };
    }
    if (cat.includes('emotion') || cat.includes('feeling') || cat.includes('food')) {
      return {
        core: 'rgba(244, 63, 94, 0.75)',
        mid: 'rgba(251, 146, 60, 0.45)',
        outer: 'rgba(236, 72, 153, 0.2)',
      };
    }
    if (cat.includes('work') || cat.includes('business')) {
      return {
        core: 'rgba(139, 92, 246, 0.75)',
        mid: 'rgba(6, 182, 212, 0.45)',
        outer: 'rgba(99, 102, 241, 0.2)',
      };
    }
    return {
      core: 'rgba(6, 182, 212, 0.75)',
      mid: 'rgba(14, 165, 233, 0.45)',
      outer: 'rgba(99, 102, 241, 0.2)',
    };
  };

  const aura = getCategoryAura(data.category);

  return (
    <div 
      ref={shellRef}
      className="flashcard-shell group relative mx-auto h-[clamp(560px,72dvh,610px)] w-full max-w-[580px] touch-pan-y overflow-visible rounded-[32px] bg-transparent"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="group"
      aria-label={`${data.word} flashcard. ${isFlipped ? 'Showing the Vietnamese meaning.' : 'Showing the English word.'}`}
      data-card-side={isFlipped ? 'back' : 'front'}
      data-flip-animation={reduceMotion ? 'reduced' : 'spatial'}
    >
      {/* Dynamic Ambient Glow Aura (Only on hover / touch, gentle opacity) */}
      <div
        className="pointer-events-none absolute -inset-3 sm:-inset-4 z-0 rounded-[44px] opacity-0 blur-xl transition-all duration-300 ease-out will-change-transform group-hover:opacity-45 group-focus-within:opacity-45"
        style={{
          background: `radial-gradient(ellipse at 50% 38%, ${aura.core} 0%, ${aura.mid} 45%, ${aura.outer} 70%, transparent 85%)`,
        }}
        aria-hidden="true"
      />
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
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs" />
          <Dialog.Content
            className="flashcard-panel flashcard-details-dialog fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] p-6 text-slate-900 outline-none sm:p-7 dark:text-white"
            aria-describedby={`learning-details-description-${data.id}`}
            onCloseAutoFocus={event => {
              event.preventDefault();
              globalThis.setTimeout(() => globalThis.requestAnimationFrame(() => {
                learningDetailsButtonRef.current?.focus({ preventScroll: true });
              }), 0);
            }}
          >
            {/* Header: Synchronized with Flashcard Front */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 pb-4 dark:border-white/10">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                  <span className="rounded-full border border-cyan-300/60 bg-cyan-50 px-2.5 py-0.5 font-bold capitalize text-cyan-800 dark:border-cyan-300/30 dark:bg-cyan-300/10 dark:text-cyan-300">
                    {data.partOfSpeech || 'Vocabulary'}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-100/90 px-2.5 py-0.5 font-bold text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">
                    {data.category}
                  </span>
                  {data.cefrLevel && (
                    <span className={`rounded-full border px-2.5 py-0.5 font-black uppercase shadow-xs ${
                      data.cefrLevel.toUpperCase().startsWith('A')
                        ? 'border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : data.cefrLevel.toUpperCase().startsWith('B')
                          ? 'border-cyan-300/70 bg-cyan-50 text-cyan-800 dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-300'
                          : 'border-indigo-300/70 bg-indigo-50 text-indigo-800 dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-300'
                    }`}>
                      CEFR {data.cefrLevel}
                    </span>
                  )}
                  {data.register && (
                    <span className="rounded-full border border-slate-200 bg-slate-100/90 px-2.5 py-0.5 font-bold capitalize text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">
                      {data.register}
                    </span>
                  )}
                </div>

                <Dialog.Title className="mt-2.5 break-words text-balance text-3xl font-black capitalize tracking-[-0.04em] text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 drop-shadow-xs sm:text-4xl dark:from-white dark:via-slate-100 dark:to-cyan-100">
                  {data.word}
                </Dialog.Title>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300 bg-cyan-50 px-3 py-0.5 font-mono text-xs font-bold text-cyan-800 shadow-xs ring-1 ring-cyan-400/20 backdrop-blur-md dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-300">
                    <AudioLines size={13} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
                    <span>{data.phonetic || '/.../'}</span>
                  </span>
                  {data.translation && (
                    <Dialog.Description id={`learning-details-description-${data.id}`} className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                      · {data.translation}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <Dialog.Close
                className="liquid-control flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100/90 text-slate-700 transition-all hover:bg-slate-200 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 cursor-pointer"
                aria-label="Close learning details"
              >
                <X size={17} />
              </Dialog.Close>
            </div>

            {/* Content Docks: Matching Back Face Architecture */}
            <div className="mt-4 space-y-3.5 text-sm">
              {/* Example in Context */}
              {data.exampleSentence && (
                <div className="flex w-full flex-col items-start rounded-[24px] border border-slate-200 bg-white/90 p-4 text-left shadow-sm backdrop-blur-2xl dark:border-white/12 dark:bg-slate-950/20">
                  <div className="mb-2.5 flex w-full items-center gap-2 border-b border-slate-200/80 pb-2.5 dark:border-white/10">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-cyan-700 dark:border-white/10 dark:bg-white/10 dark:text-cyan-300">
                      <BookOpen size={13} />
                    </span>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-700 dark:text-slate-200">
                        Example in Context
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold leading-relaxed text-slate-900 dark:text-white">
                    “{data.exampleSentence}”
                  </p>
                  {data.exampleTranslation && (
                    <p lang="vi" className="mt-1.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-300">
                      {data.exampleTranslation}
                    </p>
                  )}
                </div>
              )}

              {/* Collocations */}
              {data.collocations && data.collocations.length > 0 && (
                <div className="flex w-full flex-col items-start rounded-[24px] border border-slate-200 bg-white/90 p-4 text-left shadow-sm backdrop-blur-2xl dark:border-white/12 dark:bg-slate-950/20">
                  <div className="mb-2.5 flex w-full items-center gap-2 border-b border-slate-200/80 pb-2.5 dark:border-white/10">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-cyan-700 dark:border-white/10 dark:bg-white/10 dark:text-cyan-300">
                      <Sparkles size={13} />
                    </span>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-700 dark:text-slate-200">
                        Common Collocations
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.collocations.map((colloc) => (
                      <span
                        key={colloc}
                        className="rounded-full border border-slate-200 bg-slate-100/90 px-3 py-1 text-xs font-bold text-slate-800 shadow-xs dark:border-white/15 dark:bg-white/10 dark:text-slate-200"
                      >
                        {colloc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Synonyms & Antonyms Grid */}
              {((data.synonyms && data.synonyms.length > 0) || (data.antonyms && data.antonyms.length > 0)) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.synonyms && data.synonyms.length > 0 && (
                    <div className="flex flex-col items-start rounded-[24px] border border-slate-200 bg-white/90 p-4 text-left shadow-sm backdrop-blur-2xl dark:border-white/12 dark:bg-slate-950/20">
                      <div className="mb-2.5 flex w-full items-center gap-2 border-b border-slate-200/80 pb-2.5 dark:border-white/10">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-cyan-300 bg-cyan-50 text-xs font-black text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-300">
                          ≈
                        </span>
                        <p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-700 dark:text-slate-200">
                          Synonyms
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.synonyms.map(syn => (
                          <span
                            key={syn}
                            className="rounded-full border border-cyan-300/60 bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-800 dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-300"
                          >
                            {syn}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.antonyms && data.antonyms.length > 0 && (
                    <div className="flex flex-col items-start rounded-[24px] border border-slate-200 bg-white/90 p-4 text-left shadow-sm backdrop-blur-2xl dark:border-white/12 dark:bg-slate-950/20">
                      <div className="mb-2.5 flex w-full items-center gap-2 border-b border-slate-200/80 pb-2.5 dark:border-white/10">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-black text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
                          ≠
                        </span>
                        <p className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-700 dark:text-slate-200">
                          Antonyms
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.antonyms.map(ant => (
                          <span
                            key={ant}
                            className="rounded-full border border-slate-200 bg-slate-100/90 px-2.5 py-1 text-xs font-bold text-slate-700 dark:border-white/15 dark:bg-white/10 dark:text-slate-300"
                          >
                            {ant}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Common Mistake / Usage Note */}
              {data.commonMistake && (
                <div className="flex w-full flex-col items-start rounded-[24px] border border-amber-300/80 bg-amber-50/90 p-4 text-left shadow-sm backdrop-blur-2xl dark:border-amber-400/30 dark:bg-amber-500/10">
                  <div className="mb-2.5 flex w-full items-center gap-2 border-b border-amber-200/80 pb-2.5 dark:border-amber-400/20">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-black text-amber-900 dark:bg-amber-400/20 dark:text-amber-300">
                      ⚠️
                    </span>
                    <p className="text-[10px] font-black uppercase tracking-[0.17em] text-amber-900 dark:text-amber-200">
                      Common Mistake
                    </p>
                  </div>
                  <p className="text-xs font-semibold leading-relaxed text-amber-950 dark:text-amber-100">
                    {data.commonMistake}
                  </p>
                </div>
              )}
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
          className={`absolute left-4 top-4 z-[70] flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/35 bg-slate-950/48 text-white shadow-lg backdrop-blur-2xl transition-[transform,opacity,background-color,border-color,color] duration-200 hover:border-rose-400/80 hover:bg-rose-600/90 hover:text-white lg:scale-95 lg:opacity-0 lg:group-hover:scale-100 lg:group-hover:opacity-100 lg:group-focus-within:scale-100 lg:group-focus-within:opacity-100 ${isFlipAnimating ? '!pointer-events-none !opacity-0' : ''}`}
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
        className="relative z-10 h-full w-full overflow-visible rounded-[32px]"
        style={{ perspective: reduceMotion ? 'none' : '1600px' }}
        onPointerDownCapture={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onClick={handleCardClick}
      >
        {/* A face uses 3D only during the hand-off; the settled face returns to transform: none for crisp text. */}
        {!isFlipped ? (
        <div
          ref={faceRef}
          data-card-face="front"
          style={{ transformOrigin: 'center center', borderRadius: '32px' }}
          className="flashcard-panel flashcard-face absolute flex h-full w-full flex-col overflow-hidden rounded-[32px]"
        >
          <div
            ref={spotlightRef}
            className="absolute inset-0 pointer-events-none z-30 transition-opacity duration-200"
            style={{
              background: 'radial-gradient(circle at calc(var(--spotlight-x, 50) * 1%) calc(var(--spotlight-y, 50) * 1%), rgba(2, 132, 199, 0.16) 0%, rgba(6, 182, 212, 0.04) 40%, transparent 70%)',
              opacity: isHovered ? 1 : 0,
            }}
          />
          <div className="group/image relative h-[44%] w-full overflow-hidden bg-[var(--sf-surface-raised)]">
            <div className={`h-full w-full transition-[filter,transform] duration-500 ${isBlindMode ? 'scale-110 blur-2xl saturate-50' : 'scale-[1.01]'}`} aria-hidden={isBlindMode}>
              {supportedImageUrl ? <CardImage src={supportedImageUrl} alt={`Illustration for ${data.word}`} priority={imagePriority} /> : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[var(--sf-text-muted)]" role="img" aria-label={`No image for ${data.word}`}>
                  <span className="liquid-control flex size-16 items-center justify-center rounded-full"><ImageOff size={28} strokeWidth={1.5} /></span>
                  <span className="text-sm font-semibold">Image cue unavailable</span>
                </div>
              )}
            </div>
            <div className="flashcard-image-fade pointer-events-none absolute inset-x-0 bottom-0 h-28" aria-hidden="true" />
            {isBlindMode && <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/22 px-6 text-center text-white backdrop-blur-md"><EyeOff size={24} /><span className="mt-2 text-sm font-bold">Visual hint hidden</span></div>}
          </div>

          <div className="relative z-20 flex min-h-0 flex-1 flex-col overflow-hidden -mt-6 rounded-b-[31px] border-t border-slate-200/80 bg-white/95 dark:border-white/10 dark:bg-[#071318]/95">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-4 pt-4 scrollbar-thin sm:px-6">
              <div className="flashcard-front-header flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
                <div className="min-w-0 text-left">
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xs font-semibold text-[var(--sf-text-muted)]">
                    <span className={`rounded-full border px-2.5 py-0.5 capitalize ${data.partOfSpeech ? 'border-cyan-300/60 bg-cyan-50 text-cyan-800 dark:border-cyan-300/30 dark:bg-cyan-300/10 dark:text-cyan-300' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400'}`} aria-label={`Part of speech: ${data.partOfSpeech || 'unspecified'}`}>{data.partOfSpeech || 'Type unspecified'}</span>
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{data.category}</span>
                    {!data.nextReviewDate
                      ? <span className="text-emerald-600 dark:text-emerald-400">New card</span>
                      : isCardDue(data) && <span className="text-rose-600 dark:text-rose-400">Due for review</span>}
                    {data.difficulty && data.difficulty !== 'unrated' && <span>{data.difficulty === 'easy' ? 'Mastered' : data.difficulty === 'good' ? 'Learning' : 'Needs practice'}</span>}
                  </div>
                  <h2 data-card-primary="word" className="flashcard-word-gradient break-words text-balance text-3xl font-black capitalize tracking-[-0.04em] drop-shadow-xs [overflow-wrap:anywhere] sm:text-4xl">{data.word}</h2>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span data-card-primary="pronunciation" className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300 bg-cyan-50 px-3 py-0.5 font-mono text-xs font-bold text-cyan-800 dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-300 shadow-xs ring-1 ring-cyan-400/20">
                      <AudioLines size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                      <span>{data.phonetic || '/.../'}</span>
                    </span>
                  </div>
                  <SyllableStressBadge word={data.word} phonetic={data.phonetic} />
                </div>
                <div className="relative z-30 flex w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end sm:pt-4" data-card-control data-card-controls="audio">
                  <button
                    type="button"
                    data-card-control
                    onPointerDown={event => event.stopPropagation()}
                    onClick={toggleAudioSpeed}
                    className={`liquid-control touch-manipulation flex size-11 items-center justify-center rounded-full text-xs font-black transition-all ${
                      audioSpeed === 0.75 ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
                    }`}
                    title="Toggle pronunciation speed (1.0x / 0.75x slow)"
                    aria-label="Toggle speed"
                  >
                    {audioSpeed}x
                  </button>
                  <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={playAudio} className="liquid-control touch-manipulation flex size-11 items-center justify-center rounded-full text-[var(--sf-brand-text)]" aria-label="Play pronunciation" title="Play pronunciation"><Volume2 size={15} /></button>
                  <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={event => startPronunciationCheck(event, 'word')} disabled={isRecording} className={`touch-manipulation flex size-11 items-center justify-center rounded-full ${isRecording && recordingTarget === 'word' ? 'bg-rose-500 text-white animate-pulse' : 'liquid-control text-[var(--sf-text)]'}`} aria-label="Check pronunciation" title="Check pronunciation"><Mic size={15} /></button>
                </div>
              </div>

              {isRecording && <div className="mt-3 flex items-center gap-2 text-xs font-bold text-rose-500 dark:text-rose-400"><span className="size-2 rounded-full bg-rose-500 animate-pulse" />Listening</div>}
              {pronunciationScore && <SpeechMatchFeedback value={pronunciationScore} target={pronunciationScore.type === 'word' ? data.word : data.explanation} />}
              {pronunciationError && <p className="mt-2 text-pretty text-xs font-semibold text-rose-600 dark:text-rose-300" role="alert">{pronunciationError}</p>}

              <div className="relative mt-4 text-left">
                <p aria-hidden={isBlindMode} className={`break-words text-sm leading-6 text-[var(--sf-text)] [overflow-wrap:anywhere] transition-[filter,opacity] ${isBlindMode ? 'select-none blur-md opacity-35' : ''}`}>{data.explanation}</p>
                {isBlindMode && <div className="pointer-events-none absolute inset-0 flex items-center justify-start"><span className="text-xs font-bold text-[var(--sf-text-muted)]">Definition hidden</span></div>}
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
                  className={`liquid-control touch-manipulation flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition-all ${
                    showQuickQuiz ? 'border-cyan-400/80 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' : 'text-[var(--sf-text)]'
                  }`}
                  title="Quick self-test quiz before revealing definition"
                >
                  <HelpCircle size={13} />
                  <span>Quiz</span>
                </button>
                <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={playExplanationAudio} className="liquid-control touch-manipulation flex min-h-11 items-center gap-2 rounded-full px-3.5 text-xs font-bold text-[var(--sf-text)]" title="Listen to the definition"><Volume2 size={13} /><span>Listen</span></button>
                <button type="button" data-card-control onPointerDown={event => event.stopPropagation()} onClick={event => startPronunciationCheck(event, 'explanation')} disabled={isRecording} className={`touch-manipulation flex min-h-11 items-center gap-2 rounded-full px-3.5 text-xs font-bold ${isRecording && recordingTarget === 'explanation' ? 'bg-rose-500 text-white' : 'liquid-control text-[var(--sf-text)]'}`} title="Practise reading the definition"><Mic size={13} /><span>Read aloud</span></button>
                {onAssignDeck && <Dialog.Root open={showDeckSelector} onOpenChange={setShowDeckSelector}>
                  <Dialog.Trigger asChild><button ref={deckButtonRef} onPointerDown={event => event.stopPropagation()} className="liquid-control flex min-h-11 min-w-0 items-center gap-2 rounded-full px-3.5 text-xs font-bold text-[var(--sf-text)]"><FolderOpen size={14} /><span className="max-w-32 truncate">{data.customDeck || 'Choose deck'}</span></button></Dialog.Trigger>
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

            <div className="relative z-20 box-border flex-shrink-0 overflow-hidden rounded-b-[31px] border-t border-slate-200 bg-slate-50/95 dark:border-white/12 dark:bg-slate-950/40 p-3">
              <button
                ref={frontFlipRef}
                type="button"
                data-flip-card
                onClick={event => {
                  event.stopPropagation();
                  focusAfterFlipRef.current = 'back';
                  showCardSide('back');
                }}
                className="flashcard-reveal-button group/flip flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-2.5 text-left text-[var(--sf-text)] shadow-xs outline-none transition-[background-color,border-color] hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-focus)] focus-visible:ring-2 focus-visible:ring-[var(--sf-brand)] focus-visible:ring-offset-2 motion-reduce:transition-none"
                aria-label={`Reveal the Vietnamese meaning of ${data.word}`}
                aria-keyshortcuts="Space"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-[var(--sf-brand-text)]">
                  <Languages size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-black">Reveal meaning</span>
                <span className="flex shrink-0 items-center gap-2 text-[var(--sf-text-muted)]" aria-hidden="true">
                  <kbd className="rounded-md border border-[var(--sf-border)] bg-[var(--sf-surface)] px-1.5 py-1 font-mono text-[10px] font-bold">Space</kbd>
                  <ChevronRight size={17} className="transition-transform group-hover/flip:translate-x-0.5 motion-reduce:transform-none" />
                </span>
              </button>
            </div>
          </div>
        </div>
        ) : (
        <div
          ref={faceRef}
          data-card-face="back"
          style={{ transformOrigin: 'center center', borderRadius: '32px' }}
          className="flashcard-panel flashcard-back absolute inset-0 isolate box-border flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[32px] text-slate-900 dark:text-white"
        >
          <div
            ref={spotlightRef}
            className="absolute inset-0 pointer-events-none z-30 transition-opacity duration-200"
            style={{
              background: 'radial-gradient(circle at calc(var(--spotlight-x, 50) * 1%) calc(var(--spotlight-y, 50) * 1%), rgba(2, 132, 199, 0.16) 0%, rgba(6, 182, 212, 0.04) 40%, transparent 70%)',
              opacity: isHovered ? 1 : 0,
            }}
          />
          <div className="pointer-events-none absolute -bottom-20 -right-20 size-72 rounded-full border border-slate-200/40 bg-slate-100/20 dark:border-white/10 dark:bg-white/5" aria-hidden="true" />
          <div className={`absolute top-5 flex flex-wrap items-center gap-2 ${onDelete ? 'left-16' : 'left-5'}`}>
            <div className="rounded-full border border-slate-200 bg-slate-100/90 px-3 py-1 text-xs font-bold text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 backdrop-blur-md">
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
          <div data-card-content="revealed" data-card-reveal="sequence" className="flashcard-reveal-sequence min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-16 text-center scrollbar-thin sm:px-6">
            <section data-card-section="meaning" data-reveal-order="meaning" aria-labelledby={`flashcard-meaning-${data.id}`} className="flashcard-meaning-card relative w-full overflow-hidden rounded-[28px] px-4 pb-4 pt-5 sm:px-5">
              <div className="relative mx-auto mb-3 flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-100/90 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 dark:border-white/15 dark:bg-slate-950/20 dark:text-slate-100">
                <Languages size={13} /> Meaning revealed
              </div>
              <p id={`flashcard-meaning-${data.id}`} className="relative text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">Vietnamese meaning</p>
              <h2 lang="vi" className="flashcard-translation-gradient relative mt-1 break-words text-balance text-4xl font-black tracking-[-0.04em] drop-shadow-xs first-letter:uppercase [overflow-wrap:anywhere] sm:text-5xl">
                {data.translation}
              </h2>
              <div className="relative mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-slate-50/90 dark:border-white/12 dark:bg-slate-950/20 px-3.5 py-2 text-left shadow-xs">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.17em] text-slate-500 dark:text-slate-400">Original word</p>
                  <p className="break-words text-base font-black capitalize text-slate-900 dark:text-white [overflow-wrap:anywhere] sm:text-lg">{data.word}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                 <button
                   type="button"
                   data-card-control
                   onPointerDown={(e) => e.stopPropagation()}
                   onClick={toggleAudioSpeed}
                   style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                   className={`liquid-control touch-manipulation flex size-11 items-center justify-center rounded-full text-xs font-black transition-all ${
                     audioSpeed === 0.75 ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-sm' : 'border-slate-200 bg-slate-100 text-slate-800 dark:bg-white/12 dark:text-white'
                   }`}
                   title="Toggle speed (1.0x / 0.75x slow)"
                   aria-label="Toggle speed"
                 >
                   {audioSpeed}x
                 </button>
                 <button
                   type="button"
                   data-card-control
                   onPointerDown={(e) => e.stopPropagation()}
                   onClick={playAudio}
                   style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                   className="liquid-control touch-manipulation flex size-11 items-center justify-center rounded-full border-slate-200 bg-slate-100 text-slate-800 dark:border-white/15 dark:bg-white/12 dark:text-white transition-colors"
                   aria-label="Play pronunciation"
                   title="Play pronunciation"
                 >
                   <Volume2 size={13} />
                 </button>
                 <button
                   type="button"
                   data-card-control
                   onPointerDown={(e) => e.stopPropagation()}
                   onClick={startPronunciationCheck}
                   disabled={isRecording}
                   style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                   className={`touch-manipulation flex size-11 items-center justify-center rounded-full transition-colors ${isRecording ? 'bg-rose-500 text-white animate-pulse' : 'liquid-control border-slate-200 bg-slate-100 text-slate-800 dark:border-white/15 dark:bg-white/12 dark:text-white'}`}
                   aria-label="Check pronunciation"
                   title="Practise pronunciation"
                 >
                   <Mic size={13} />
                 </button>
                </div>
               </div>
               {pronunciationError && <p className="mt-2 text-pretty text-xs font-semibold text-rose-600 dark:text-rose-100" role="alert">{pronunciationError}</p>}
            </section>

            {/* Description Translation */}
            <section data-card-section="explanation" data-reveal-order="explanation" aria-labelledby={`flashcard-explanation-${data.id}`} className="mt-3.5 flex w-full flex-col items-start rounded-[24px] border border-slate-200 bg-white/95 dark:border-white/12 dark:bg-slate-950/40 p-4 text-left shadow-sm">
              <div className="mb-3 flex items-center gap-2 border-b border-slate-200/80 dark:border-white/10 pb-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-cyan-700 dark:border-white/10 dark:bg-white/10 dark:text-cyan-300" aria-hidden="true"><Languages size={15} /></span>
                <div>
                  <p id={`flashcard-explanation-${data.id}`} className="text-[10px] font-black uppercase tracking-[0.17em] text-slate-700 dark:text-slate-200">Explanation in Vietnamese</p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-300">Natural translations and usage notes</p>
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
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-cyan-400 bg-cyan-400 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#071014] shadow-md shadow-cyan-500/25 transition-all hover:bg-cyan-300 active:scale-[0.98] cursor-pointer"
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Translating…</span>
                      </>
                    ) : (
                      <>
                        <Languages size={13} />
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
            </section>

            {/* AI Mnemonic Section */}
            <section data-card-section="memory-hook" data-reveal-order="memory-hook" aria-label="Memory hook">
              <CardMnemonicSection card={data} onUpdateCard={onUpdateCard} />
            </section>

            {(data.partOfSpeech || data.cefrLevel || data.exampleSentence || data.collocations?.length || data.synonyms?.length || data.antonyms?.length || data.commonMistake) && (
              <button
                ref={learningDetailsButtonRef}
                type="button"
                aria-label="Learning details: examples, collocations and nuances"
                onClick={() => setShowLearningDetails(true)}
                className="mt-3.5 flex min-h-14 w-full items-center gap-3.5 rounded-full border border-slate-200/90 bg-white/95 px-4 py-2.5 text-left text-slate-800 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-50 dark:border-white/12 dark:bg-white/[0.05] dark:text-slate-100 dark:hover:border-white/20 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-500 cursor-pointer"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                  <BookOpen size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 dark:text-slate-400">Lexicon Context</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                    Examples, collocations &amp; nuances
                  </span>
                </span>
                <ChevronRight size={16} className="text-slate-400" />
              </button>
            )}

            <button
              type="button"
              data-card-control
              onPointerDown={e => e.stopPropagation()}
              onClick={() => setShowAiModal(true)}
              className="mt-2.5 flex min-h-12 w-full items-center gap-3 rounded-full border border-cyan-300 bg-cyan-50/90 dark:border-cyan-400/30 dark:bg-cyan-500/10 px-4 py-2.5 text-left text-cyan-900 dark:text-cyan-200 shadow-xs transition-all hover:bg-cyan-100/80 hover:border-cyan-400 dark:hover:bg-cyan-500/20 dark:hover:border-cyan-400/50 focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
                <Sparkles size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-black uppercase tracking-wider text-cyan-800 dark:text-cyan-300">Ask AI Tutor</span>
                <span className="block truncate text-[11px] font-medium text-slate-600 dark:text-slate-300">Business examples, nuance &amp; synonyms</span>
              </span>
              <ChevronRight size={16} className="text-cyan-700 dark:text-cyan-300" />
            </button>
          </div>
 
          <div className="relative z-20 box-border flex-shrink-0 overflow-hidden rounded-b-[31px] border-t border-slate-200 bg-slate-50/95 dark:border-white/12 dark:bg-slate-950/40 p-3">
            <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" aria-hidden="true" />
            <button
              ref={backFlipRef}
              type="button"
              data-flip-card
              onClick={(event) => {
                event.stopPropagation();
                focusAfterFlipRef.current = 'front';
                showCardSide('front');
              }}
              className="flashcard-return-button group/back flex min-h-[60px] w-full items-center gap-3 rounded-full border border-slate-200/90 bg-white/90 px-4 py-2 text-left text-slate-900 dark:border-white/15 dark:bg-white/10 dark:text-white shadow-xs outline-none transition-all hover:border-cyan-400/60 hover:bg-cyan-50/50 dark:hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-[var(--sf-brand)] focus-visible:ring-offset-2"
              aria-label={`Return to the English side of ${data.word}`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 dark:border-white/15 dark:bg-white/12 dark:text-slate-100 shadow-inner shadow-black/5 dark:shadow-white/5">
                <ChevronRight size={18} className="rotate-180 transition-transform group-hover/back:-translate-x-0.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black">Back to English</span>
                <span className="mt-0.5 block break-words text-[11px] font-semibold text-slate-500 dark:text-slate-300 [overflow-wrap:anywhere]">Return to “{data.word}”</span>
              </span>
              <Languages size={18} className="mr-2 text-cyan-600 dark:text-cyan-300" />
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
