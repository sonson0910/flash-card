import { useGSAP } from '@gsap/react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import gsap from 'gsap';
import { AudioLines, BookOpen, Eye, EyeOff, Pencil, Sparkles, Star, Trash2, X } from 'lucide-react';
import React, { lazy, Suspense, useEffect, useState, useRef } from 'react';
import '../styles/flashcard-effects.css';
import './flashcard/flashcard-canvas.css';
import { isSupportedImageUrl } from '../lib/images';
import { playFlipSound, playRewardSound } from '../lib/interactionSounds';
import { triggerHaptic } from '../lib/haptics';
import { scoreSpeechMatch } from '../lib/speechMatch';
import { speechLocaleFor } from '../lib/speechLocale';
import { getFlashcardFlipMotion } from '../lib/motion';
import { useReducedMotion } from '../lib/motionPreference';
import {
  translateExplanationSafely,
} from '../lib/recoverableActions';
import { CardAiAssistantModal } from './flashcard/CardAiAssistantModal';
import { CardBack } from './flashcard/CardBack';
import { CardEffectsLayer, useCardEffects } from './flashcard/CardEffectsLayer';
import { CardFront } from './flashcard/CardFront';
import type { SpeechMatchFeedbackValue } from './flashcard/SpeechMatchFeedback';
import { useZenGlassMode } from '../lib/useZenGlassMode';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import type { LearningStateOutcome } from '../features/learning/learningStateController';
import type { EditCardDialogContext } from '../features/cardEdit/EditCardDialog';
import type { CardData } from '../types/card';

const ReportCardDialog = lazy(() => import('../features/cardReport/ReportCardDialog').then(module => ({ default: module.ReportCardDialog })));
const EditCardDialog = lazy(() => Promise.all([
  import('../features/cardEdit/EditCardDialog'), loadCatalog(getActiveUiLocale(), 'library'),
]).then(([module]) => ({ default: module.EditCardDialog })));
const HangulBreakdown = lazy(() => import('./flashcard/HangulBreakdown').then(module => ({ default: module.HangulBreakdown })));

gsap.registerPlugin(useGSAP);

export interface FlashcardProps {
  data: CardData;
  onDelete?: (id: string) => void | Promise<void>;
  onToggleBookmark?: (id: string) => void;
  customDecks?: string[];
  onAssignDeck?: (cardId: string, deckName: string | null) => void;
  onUpdateCard?: (cardId: string, updatedFields: Partial<CardData>) => void | Promise<LearningStateOutcome>;
  onEditOpenChange?: (open: boolean) => void;
  editorContext?: EditCardDialogContext;
  initialSide?: 'front' | 'back';
  imagePriority?: boolean;
}

export const Flashcard = React.memo(function Flashcard({ data, onDelete, onToggleBookmark, customDecks = [], onAssignDeck, onUpdateCard, onEditOpenChange, editorContext, initialSide = 'front', imagePriority = false }: FlashcardProps) {
  const { _, i18n } = useLingui();
  const translationFailureMessage = _(msg({ id: 'flashcard.translation.failed', message: 'The explanation could not be translated. Check your connection and try again.' }));
  const supportedImageUrl = isSupportedImageUrl(data.imageUrl) ? data.imageUrl : null;
  const targetLanguage = data.language || 'en';
  const translationLanguage = data.translationLanguage || 'vi';
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
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const editDialogOpenRef = useRef(false);
  const latestEditOpenChangeRef = useRef(onEditOpenChange);
  latestEditOpenChangeRef.current = onEditOpenChange;
  const [isBlindMode, setIsBlindMode] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState<1.0 | 0.75>(1.0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [showQuickQuiz, setShowQuickQuiz] = useState(false);
  const [isZenMode] = useZenGlassMode();
  const reduceMotion = useReducedMotion();

  const setEditDialogOpen = (open: boolean) => {
    editDialogOpenRef.current = open;
    setShowEditDialog(open);
    onEditOpenChange?.(open);
  };

  useEffect(() => () => {
    if (!editDialogOpenRef.current) return;
    editDialogOpenRef.current = false;
    latestEditOpenChangeRef.current?.(false);
  }, []);

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
    if (reduceMotion) {
      gsap.set(face, { clearProps: 'transform,opacity,visibility' });
      completeFaceTransition(side);
      return;
    }
    const animation = getFlashcardFlipMotion(flipDirection, reduceMotion);
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
          force3D: !reduceMotion,
          onComplete: () => {
            window.clearTimeout(completionFallback);
            finishTransition();
          },
        });
        return () => window.clearTimeout(completionFallback);
  }, { scope: shellRef, dependencies: [isFlipped, flipDirection, reduceMotion], revertOnUpdate: true });

  useEffect(() => () => {
    flipOutTweenRef.current?.kill();
    if (flipCommitTimerRef.current !== null) window.clearTimeout(flipCommitTimerRef.current);
    gsap.killTweensOf(starButtonRef.current);
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    audioRef.current?.pause();
    setIsPlayingAudio(false);
  }, []);

  const toggleAudioSpeed = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    triggerHaptic('light');
    setAudioSpeed(prev => (prev === 1.0 ? 0.75 : 1.0));
  };

  const speakFallback = (text: string) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setIsPlayingAudio(false);
      setPronunciationError(_(msg({ id: 'flashcard.audio.unsupported', message: 'Audio playback is not supported by this browser.' })));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLocaleFor(data);
    utterance.rate = audioSpeed === 0.75 ? 0.65 : 0.9;
    utteranceRef.current = utterance;
    utterance.onend = () => {
      setIsPlayingAudio(false);
      if (utteranceRef.current === utterance) utteranceRef.current = null;
    };
    utterance.onerror = () => {
      setIsPlayingAudio(false);
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setPronunciationError(_(msg({ id: 'flashcard.audio.failed', message: 'Audio could not be played. Check this site’s audio permission and try again.' })));
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    // Keep this call inside the original click event. Safari can block delayed TTS.
    window.speechSynthesis.speak(utterance);
  };

  const playAudio = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    setPronunciationError(null);
    setIsPlayingAudio(true);
    if (audioRef.current) {
      audioRef.current.pause();
      try {
        audioRef.current.currentTime = 0;
        audioRef.current.playbackRate = audioSpeed;
      } catch {
        // Some Safari streams cannot seek until their metadata is ready.
      }
      audioRef.current.onended = () => setIsPlayingAudio(false);
      audioRef.current.onerror = () => setIsPlayingAudio(false);
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
      setPronunciationError(_(msg({ id: 'flashcard.speech.unsupported', message: 'This browser does not support speech recognition. Try Google Chrome.' })));
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current?.abort?.();
    recognitionRef.current = recognition;
    recognition.lang = speechLocaleFor(data);
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
        ? _(msg({ id: 'flashcard.speech.permission-blocked', message: 'Microphone access is blocked. Allow microphone access for this site, then try again.' }))
        : _(msg({ id: 'flashcard.speech.failed', message: 'Speech could not be recognised. Check microphone permission and try again.' })));
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
      setPronunciationError(_(msg({ id: 'flashcard.speech.start-failed', message: 'The microphone could not start. Check permission and try again.' })));
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
          setTranslationError(translationFailureMessage);
        }
        return;
      }
      setTranslationError(result.message ?? translationFailureMessage);
    } catch {
      setTranslationError(translationFailureMessage);
    } finally {
      setIsTranslating(false);
    }
  };

  const spotlightBackground = 'radial-gradient(circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), rgba(2, 132, 199, 0.11) 0%, rgba(6, 182, 212, 0.025) 40%, transparent 70%)';
  const { aura, isHovered, handleMouseEnter, handleMouseMove, handleMouseLeave } = useCardEffects({
    category: data.category,
    faceRef,
    spotlightRef,
    reduceMotion,
    isFlipAnimating,
    spotlightBackground,
  });
  const cardTier = data.difficulty === 'easy' ? 'mastered'
    : (data.nextReviewDate || (data.reviews ?? 0) > 0 || (data.difficulty && data.difficulty !== 'unrated'))
      ? 'learning' : 'new';
  const hasHangulReviewPanel = editorContext?.kind === 'review' && /^ko(?:-|$)/i.test(data.language ?? '');

  return (
    <div className="relative mx-auto w-full max-w-[960px]">
    <div
      ref={shellRef}
      className={`flashcard-shell group relative mx-auto w-full touch-pan-y overflow-visible rounded-[32px] bg-transparent transition-[max-width,height] duration-300 ${
        isZenMode ? 'h-[460px] sm:h-[480px] max-w-[700px] [@media(max-height:500px)]:h-[320px]' : 'h-[clamp(560px,72dvh,610px)] max-w-[580px] [@media(max-height:500px)]:h-[320px]'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="group"
      aria-label={i18n._(msg({ id: 'flashcard.card.status', message: '{word} flashcard. {side}' }).id, { word: data.word, side: isFlipped ? _(msg({ id: 'flashcard.card.showing-meaning', message: 'Showing the Vietnamese meaning.' })) : _(msg({ id: 'flashcard.card.showing-word', message: 'Showing the English word.' })) })}
      data-card-side={isFlipped ? 'back' : 'front'}
      data-card-tier={cardTier}
      data-flip-animation={reduceMotion ? 'reduced' : 'spatial'}
      data-card-mode={isZenMode ? 'zen' : 'standard'}
      data-card-hovered={isHovered ? 'true' : 'false'}
      data-card-blind={isBlindMode ? 'true' : 'false'}
      data-card-effects="tilt spotlight aura flip star blind audio tier-rim hover-wings"
    >
      <CardEffectsLayer aura={aura} wings tier={cardTier} isHovered={isHovered} />
      <span className="sr-only" aria-live="polite">{isFlipped ? <Trans id="flashcard.card.meaning-revealed" message="Vietnamese meaning revealed" /> : <Trans id="flashcard.card.word-revealed" message="English word revealed" />}</span>
      <AlertDialog.Root
        open={showConfirmDelete}
        onOpenChange={open => {
          if (open) deleteConfirmedRef.current = false;
          setShowConfirmDelete(open);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/72" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[111] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none" onClick={event => event.stopPropagation()} onCloseAutoFocus={event => {
            event.preventDefault();
            if (!deleteConfirmedRef.current) deleteButtonRef.current?.focus();
            deleteConfirmedRef.current = false;
          }}>
            <AlertDialog.Title className="text-balance text-lg font-black"><Trans id="flashcard.delete.title" message="Delete “{word}”?" values={{ word: data.word }} /></AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-pretty text-sm leading-relaxed text-[var(--sf-text-muted)]"><Trans id="flashcard.delete.description" message="The card will be removed from your library and the change will sync to the shared store." /></AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-3">
              <AlertDialog.Cancel className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"><Trans id="flashcard.delete.cancel" message="Keep card" /></AlertDialog.Cancel>
              <AlertDialog.Action onClick={() => {
                deleteConfirmedRef.current = true;
                void onDelete?.(data.id);
              }} className="min-h-11 rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-800"><Trans id="flashcard.delete.confirm" message="Delete card" /></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog.Root open={showLearningDetails} onOpenChange={setShowLearningDetails}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/75 backdrop-blur-xs" />
          <Dialog.Content
            className="flashcard-panel flashcard-details-dialog fixed left-1/2 top-1/2 z-[111] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] p-6 text-slate-900 outline-none sm:p-7 dark:text-white"
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
                  <span lang={data.partOfSpeech ? targetLanguage : undefined} className="rounded-full border border-cyan-300/60 bg-cyan-50 px-2.5 py-0.5 font-bold capitalize text-cyan-800 dark:border-cyan-300/30 dark:bg-cyan-300/10 dark:text-cyan-300">
                    {data.partOfSpeech || <Trans id="flashcard.details.vocabulary" message="Vocabulary" />}
                  </span>
                  <span lang={targetLanguage} className="rounded-full border border-slate-200 bg-slate-100/90 px-2.5 py-0.5 font-bold text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">
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
                      <Trans id="flashcard.cefr-level" message="CEFR {level}" values={{ level: data.cefrLevel }} />
                    </span>
                  )}
                  {data.register && (
                    <span lang={targetLanguage} className="rounded-full border border-slate-200 bg-slate-100/90 px-2.5 py-0.5 font-bold capitalize text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">
                      {data.register}
                    </span>
                  )}
                </div>

                <Dialog.Title lang={targetLanguage} className="mt-2.5 break-words text-balance text-3xl font-black tracking-[-0.04em] text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 drop-shadow-xs sm:text-4xl dark:from-white dark:via-slate-100 dark:to-cyan-100">
                  {data.word}
                </Dialog.Title>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span lang={targetLanguage} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300 bg-cyan-50 px-3 py-0.5 font-mono text-xs font-bold text-cyan-800 shadow-xs ring-1 ring-cyan-400/20 backdrop-blur-md dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-300">
                    <AudioLines size={13} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
                    <span>{data.phonetic || '/.../'}</span>
                  </span>
                  {data.translation && (
                    <Dialog.Description id={`learning-details-description-${data.id}`} lang={translationLanguage} className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                      · {data.translation}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <Dialog.Close
                className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100/90 text-slate-700 transition-all hover:bg-slate-200 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 cursor-pointer"
                aria-label={_(msg({ id: 'flashcard.details.close', message: 'Close learning details' }))}
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
                        <Trans id="flashcard.details.example" message="Example in Context" />
                      </p>
                    </div>
                  </div>
                  <p lang={targetLanguage} className="text-sm font-semibold leading-relaxed text-slate-900 dark:text-white">
                    “{data.exampleSentence}”
                  </p>
                  {data.exampleTranslation && (
                    <p lang={translationLanguage} className="mt-1.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-300">
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
                          <Trans id="flashcard.details.collocations" message="Common Collocations" />
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.collocations.map((colloc) => (
                      <span
                        key={colloc}
                        lang={targetLanguage}
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
                          <Trans id="flashcard.details.synonyms" message="Synonyms" />
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.synonyms.map(syn => (
                          <span
                            key={syn}
                            lang={targetLanguage}
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
                          <Trans id="flashcard.details.antonyms" message="Antonyms" />
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.antonyms.map(ant => (
                          <span
                            key={ant}
                            lang={targetLanguage}
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
                      <Trans id="flashcard.details.common-mistake" message="Common Mistake" />
                    </p>
                  </div>
                  <p lang={targetLanguage} className="text-xs font-semibold leading-relaxed text-amber-950 dark:text-amber-100">
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
      {showReportDialog && (
        <Suspense fallback={null}>
          <ReportCardDialog
            cardId={data.id}
            cardWord={data.word}
            open={showReportDialog}
            onOpenChange={setShowReportDialog}
          />
        </Suspense>
      )}
      {showEditDialog && onUpdateCard && (
        <Suspense fallback={null}>
          <EditCardDialog card={data} open={showEditDialog} onOpenChange={setEditDialogOpen} onSave={onUpdateCard} context={editorContext} />
        </Suspense>
      )}
      {onDelete && (
        <button
          ref={deleteButtonRef}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteConfirmedRef.current = false; setShowConfirmDelete(true); }}
          className={`absolute left-4 top-4 z-[45] flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/35 bg-slate-950/48 text-white shadow-lg backdrop-blur-2xl transition-[transform,opacity,background-color,border-color,color] duration-200 hover:border-rose-400/80 hover:bg-rose-600/90 hover:text-white lg:scale-95 lg:opacity-0 lg:group-hover:scale-100 lg:group-hover:opacity-100 lg:group-focus-within:scale-100 lg:group-focus-within:opacity-100 ${isFlipAnimating ? '!pointer-events-none !opacity-0' : ''}`}
          title={_(msg({ id: 'flashcard.delete.confirm', message: 'Delete card' }))}
          aria-label={_(msg({ id: 'flashcard.delete.confirm', message: 'Delete card' }))}
        >
          <Trash2 size={15} />
        </button>
      )}
      {onDelete && onUpdateCard && !isFlipped && (
        <button type="button" data-card-control onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); setEditDialogOpen(true); }}
          className="absolute left-16 top-4 z-[45] flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/35 bg-slate-950/48 text-white shadow-lg backdrop-blur-2xl"
          title={_(msg({ id: 'flashcard.edit', message: 'Edit card' }))} aria-label={_(msg({ id: 'flashcard.edit', message: 'Edit card' }))}><Pencil size={16} /></button>
      )}

      {(onToggleBookmark || !isFlipped) && (
        <div className={`absolute right-4 top-4 z-[45] flex flex-row-reverse items-center gap-2 transition-opacity duration-150 ${isFlipAnimating ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
          {onToggleBookmark && (
            <button
              ref={starButtonRef}
              type="button"
              data-color-role="reward"
              data-card-effect="star-pop"
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
              title={data.bookmarked ? _(msg({ id: 'flashcard.star.remove', message: 'Remove star' })) : _(msg({ id: 'flashcard.star.add', message: 'Star this word' }))}
              aria-label={data.bookmarked ? _(msg({ id: 'flashcard.star.remove', message: 'Remove star' })) : _(msg({ id: 'flashcard.star.add', message: 'Star this word' }))}
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
              title={isBlindMode ? _(msg({ id: 'flashcard.hints.show', message: 'Show hints' })) : _(msg({ id: 'flashcard.hints.hide', message: 'Hide hints' }))}
              aria-label={isBlindMode ? _(msg({ id: 'flashcard.hints.reveal', message: 'Reveal image and definition' })) : _(msg({ id: 'flashcard.hints.hide-content', message: 'Hide image and definition' }))}
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
        {isZenMode && (
          <>
            <div className="pointer-events-none absolute -left-12 -top-12 size-80 rounded-full bg-gradient-to-br from-teal-400/40 to-cyan-500/20 blur-3xl -z-10" aria-hidden="true" />
            <div className="pointer-events-none absolute -right-12 -top-8 size-80 rounded-full bg-gradient-to-bl from-amber-400/25 to-yellow-500/15 blur-3xl -z-10" aria-hidden="true" />
          </>
        )}

        {/* A face uses 3D only during the hand-off; the settled face returns to transform: none for crisp text. */}
        {!isFlipped ? (
          <CardFront
            isZenMode={isZenMode}
            tier={cardTier}
            data={data}
            faceRef={faceRef}
            spotlightRef={spotlightRef}
            spotlightBackground={spotlightBackground}
            isHovered={isHovered}
            supportedImageUrl={supportedImageUrl}
            imagePriority={imagePriority}
            isBlindMode={isBlindMode}
            audioSpeed={audioSpeed}
            toggleAudioSpeed={toggleAudioSpeed}
            playAudio={playAudio}
            playExplanationAudio={playExplanationAudio}
            isPlayingAudio={isPlayingAudio}
            isRecording={isRecording}
            recordingTarget={recordingTarget}
            startPronunciationCheck={startPronunciationCheck}
            pronunciationScore={pronunciationScore}
            pronunciationError={pronunciationError}
            showQuickQuiz={showQuickQuiz}
            setShowQuickQuiz={setShowQuickQuiz}
            customDecks={customDecks}
            onAssignDeck={onAssignDeck}
            showDeckSelector={showDeckSelector}
            setShowDeckSelector={setShowDeckSelector}
            deckButtonRef={deckButtonRef}
            frontFlipRef={frontFlipRef}
            focusAfterFlipRef={focusAfterFlipRef}
            showCardSide={showCardSide}
          />
        ) : (
        <CardBack
          isZenMode={isZenMode}
          tier={cardTier}
          data={data}
          faceRef={faceRef}
          spotlightRef={spotlightRef}
          spotlightBackground={spotlightBackground}
          isHovered={isHovered}
          canDelete={Boolean(onDelete)}
          onUpdateCard={onUpdateCard}
          setShowReportDialog={setShowReportDialog}
          setShowEditDialog={setEditDialogOpen}
          audioSpeed={audioSpeed}
          toggleAudioSpeed={toggleAudioSpeed}
          playAudio={playAudio}
          isPlayingAudio={isPlayingAudio}
          startPronunciationCheck={startPronunciationCheck}
          isRecording={isRecording}
          pronunciationError={pronunciationError}
          isTranslating={isTranslating}
          translationError={translationError}
          translateExplanation={translateExplanation}
          setTranslationError={setTranslationError}
          learningDetailsButtonRef={learningDetailsButtonRef}
          setShowLearningDetails={setShowLearningDetails}
          setShowAiModal={setShowAiModal}
          backFlipRef={backFlipRef}
          focusAfterFlipRef={focusAfterFlipRef}
          showCardSide={showCardSide}
        />
        )}
      </div>

      {data.audioUrl && (
        <audio ref={audioRef} src={data.audioUrl} preload={imagePriority ? 'metadata' : 'none'} />
      )}
    </div>
    {hasHangulReviewPanel && <Suspense fallback={null}><div className="hangul-breakdown-slot"><HangulBreakdown word={data.word} /></div></Suspense>}
    </div>
  );
});
