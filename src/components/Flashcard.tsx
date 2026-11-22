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
import { voiceForActiveCourseCard } from '../lib/courseVoicePreference';
import { speechLocaleFor } from '../lib/speechLocale';
import { getFlashcardFlipMotion } from '../lib/motion';
import { useReducedMotion } from '../lib/motionPreferenceHooks';
import {
  translateExplanationSafely,
} from '../lib/recoverableActions';
import { CardAiAssistantModal } from './flashcard/CardAiAssistantModal';
import { CardBack } from './flashcard/CardBack';
import { CardEffectsLayer, useCardEffects } from './flashcard/CardEffectsLayer';
import { CardFront } from './flashcard/CardFront';
import { cardSideAnnouncement, cardSideStatus, isLanguagePackCard } from './flashcard/cardLanguage';
import { useCardLook } from './flashcard/cardLook';
import { useFlashcardAudio } from './flashcard/useFlashcardAudio';
import { useFlashcardSpeechMatch } from './flashcard/useFlashcardSpeechMatch';
import { useZenGlassMode } from '../lib/useZenGlassMode';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import type { LearningStateOutcome } from '../features/learning/learningStateController';
import type { EditCardDialogContext } from '../features/cardEdit/EditCardDialog';
import type { CardData } from '../types/card';
import { useCourseSession } from '../features/courses/CourseGate';

/** The card group's name: the word, then which of the card's two languages is showing. */
const cardStatusMessage = msg({ id: 'flashcard.card.status', message: '{word} flashcard. {side}' });
/** Blind mode on a language-pack card hides the reading aids (and the picture, when there is one). */
const showReadingsMessage = msg({ id: 'flashcard.hints.show-readings', message: '{image, select, yes {Show image and readings} other {Show readings}}' });
const hideReadingsMessage = msg({ id: 'flashcard.hints.hide-readings', message: '{image, select, yes {Hide image and readings} other {Hide readings}}' });

const ReportCardDialog = lazy(() => import('../features/cardReport/ReportCardDialog').then(module => ({ default: module.ReportCardDialog })));
const EditCardDialog = lazy(() => Promise.all([
  import('../features/cardEdit/EditCardDialog'), loadCatalog(getActiveUiLocale(), 'library'),
]).then(([module]) => ({ default: module.EditCardDialog })));
const HangulBreakdown = lazy(() => import('./flashcard/HangulBreakdown').then(module => ({ default: module.HangulBreakdown })));
const detailsWidePanelClass = 'flex w-full flex-col items-start rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-left shadow-sm [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';
const detailsSplitPanelClass = 'flex flex-col items-start rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-left shadow-sm [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';
const detailsSectionHeaderClass = 'mb-2.5 flex w-full items-center gap-2 border-b border-[var(--sf-border)] pb-2.5';
const detailsSectionIconClass = 'flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] text-[var(--sf-brand-text)]';
const detailsSectionTitleClass = 'text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--sf-text-muted)]';
const detailsChipListClass = 'flex flex-wrap gap-1.5';

gsap.registerPlugin(useGSAP);

export interface FlashcardProps {
  data: CardData;
  onDelete?: (id: string) => void | Promise<void>;
  /** Deletion from the editor needs an explicit result so its confirmation can retry on failure. */
  onEditDelete?: (id: string) => Promise<boolean>;
  onToggleBookmark?: (id: string) => void;
  customDecks?: string[];
  onAssignDeck?: (cardId: string, deckName: string | null) => void;
  onUpdateCard?: (cardId: string, updatedFields: Partial<CardData>) => void | Promise<LearningStateOutcome>;
  onEditOpenChange?: (open: boolean) => void;
  editorContext?: EditCardDialogContext;
  initialSide?: 'front' | 'back';
  imagePriority?: boolean;
}

/**
 * True when a pointer gesture began on one of the card's own controls, or in a dialog opened from
 * the card (React delivers a portalled dialog's events to the card). A dialog that hosts the card
 * itself, such as onboarding, does not count: tapping the face there still turns the card.
 */
const startsOnCardControl = (target: EventTarget, card: Element): boolean => {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-card-control], button, a, input, select, textarea, summary')) return true;
  const dialog = target.closest('[role="dialog"]');
  return dialog !== null && !dialog.contains(card);
};

export const Flashcard = React.memo(function Flashcard({ data, onDelete, onEditDelete, onToggleBookmark, customDecks = [], onAssignDeck, onUpdateCard, onEditOpenChange, editorContext, initialSide = 'front', imagePriority = false }: FlashcardProps) {
  const { _, i18n } = useLingui();
  const { model: courseModel } = useCourseSession();
  const translationFailureMessage = _(msg({ id: 'flashcard.translation.failed', message: 'The explanation could not be translated. Check your connection and try again.' }));
  const supportedImageUrl = isSupportedImageUrl(data.imageUrl) ? data.imageUrl : null;
  const targetLanguage = data.language || 'en';
  const translationLanguage = data.translationLanguage || 'vi';
  const [isFlipped, setIsFlipped] = useState(initialSide === 'back');
  const [flipDirection, setFlipDirection] = useState<1 | -1>(initialSide === 'back' ? 1 : -1);
  const [isFlipAnimating, setIsFlipAnimating] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const frontFlipRef = useRef<HTMLButtonElement | null>(null);
  const backFlipRef = useRef<HTMLButtonElement | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmedRef = useRef(false);
  const deckButtonRef = useRef<HTMLButtonElement | null>(null);
  const learningDetailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const aiTutorButtonRef = useRef<HTMLButtonElement | null>(null);
  const learningDetailsFocusTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const learningDetailsFocusFrameRef = useRef<number | null>(null);
  const focusAfterFlipRef = useRef<'front' | 'back' | null>(null);
  const gestureRef = useRef({ x: 0, y: 0, moved: false, startedOnControl: false });
  const shellRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const hasMountedFaceRef = useRef(false);
  const flipOutTweenRef = useRef<gsap.core.Tween | null>(null);
  const flipCommitTimerRef = useRef<number | null>(null);
  const starButtonRef = useRef<HTMLButtonElement | null>(null);
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [showDeckSelector, setShowDeckSelector] = useState(false);
  const [showLearningDetails, setShowLearningDetails] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const editDialogOpenRef = useRef(false);
  const latestEditOpenChangeRef = useRef(onEditOpenChange);
  latestEditOpenChangeRef.current = onEditOpenChange;
  const [isBlindMode, setIsBlindMode] = useState(false);
  const [showReading, setShowReading] = useState(true);
  const isPackCard = isLanguagePackCard(data);
  const [showQuickQuiz, setShowQuickQuiz] = useState(false);
  const [isZenMode] = useZenGlassMode();
  const reduceMotion = useReducedMotion();
  const cancelLearningDetailsFocusRestore = () => {
    if (learningDetailsFocusTimerRef.current !== null) {
      globalThis.clearTimeout(learningDetailsFocusTimerRef.current);
      learningDetailsFocusTimerRef.current = null;
    }
    if (learningDetailsFocusFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(learningDetailsFocusFrameRef.current);
      learningDetailsFocusFrameRef.current = null;
    }
  };
  useEffect(() => cancelLearningDetailsFocusRestore, []);
  const {
    audioRef,
    audioSpeed,
    isPlayingAudio,
    pronunciationError,
    setPronunciationError,
    toggleAudioSpeed,
    playAudio,
    playExplanationAudio,
  } = useFlashcardAudio({
    cardId: data.id,
    word: data.word,
    explanation: data.explanation,
    audioUrl: data.audioUrl,
    speechLocale: speechLocaleFor(data),
    voice: voiceForActiveCourseCard(data, courseModel.activeCourse),
  });
  const {
    isRecording,
    recordingTarget,
    pronunciationScore,
    startPronunciationCheck,
  } = useFlashcardSpeechMatch({
    cardId: data.id,
    word: data.word,
    explanation: data.explanation,
    onPronunciationError: setPronunciationError,
    speechLocale: speechLocaleFor(data),
  });

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
    const startedOnControl = startsOnCardControl(target, event.currentTarget);
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
      || startsOnCardControl(target, event.currentTarget)
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
  }, []);

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
  const cardLook = useCardLook();

  return (
    <div className="relative mx-auto w-full max-w-[960px]">
    <div
      ref={shellRef}
      className={`flashcard-shell group relative mx-auto w-full touch-pan-y overflow-visible rounded-[32px] bg-transparent transition-[max-width,height] duration-300 ${
        isZenMode ? 'h-[460px] sm:h-[480px] max-w-[700px] [@media(max-height:500px)]:h-[320px]' : 'h-[clamp(560px,72dvh,620px)] max-w-[460px] [@media(max-height:500px)]:h-[320px]'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="group"
      aria-label={_({ ...cardStatusMessage, values: { word: data.word, side: cardSideStatus(i18n, data, isFlipped ? 'back' : 'front') } })}
      data-card-side={isFlipped ? 'back' : 'front'}
      data-card-tier={cardTier}
      data-flip-animation={reduceMotion ? 'reduced' : 'spatial'}
      data-card-mode={isZenMode ? 'zen' : 'standard'}
      data-card-look={cardLook}
      data-card-kind={isPackCard ? 'language' : undefined}
      data-card-hovered={isHovered ? 'true' : 'false'}
      data-card-blind={isBlindMode ? 'true' : 'false'}
      data-card-effects="tilt spotlight aura flip star blind audio tier-rim hover-wings"
    >
      <CardEffectsLayer aura={aura} wings tier={cardTier} isHovered={isHovered} />
      <span className="sr-only" aria-live="polite">{cardSideAnnouncement(i18n, data, isFlipped ? 'back' : 'front')}</span>
      <AlertDialog.Root
        open={showConfirmDelete}
        onOpenChange={open => {
          if (open) deleteConfirmedRef.current = false;
          setShowConfirmDelete(open);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[110] bg-[var(--sf-scrim)] backdrop-blur-xs" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[111] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] [html[data-theme-family=crystal]_&]:crystal-chamfer" onClick={event => event.stopPropagation()} onCloseAutoFocus={event => {
            event.preventDefault();
            if (!deleteConfirmedRef.current) deleteButtonRef.current?.focus();
            deleteConfirmedRef.current = false;
          }}>
            <AlertDialog.Title className="text-balance text-lg font-black"><Trans {...msg({ context: 'flashcard.delete.title', message: 'Delete “{word}”?' })} values={{ word: data.word }} /></AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-pretty text-sm leading-relaxed text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'flashcard.delete.description', message: 'The card will be removed from your library and the change will sync to the shared store.' })} /></AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-3">
              <AlertDialog.Cancel className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"><Trans {...msg({ context: 'flashcard.delete.cancel', message: 'Keep card' })} /></AlertDialog.Cancel>
              <AlertDialog.Action onClick={() => {
                deleteConfirmedRef.current = true;
                void onDelete?.(data.id);
              }} className="min-h-11 rounded-xl bg-[var(--sf-danger)] px-4 py-2 text-sm font-semibold text-[var(--sf-on-brand)] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-danger)]"><Trans {...msg({ id: 'flashcard.delete.confirm', message: 'Delete card' })} /></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog.Root open={showLearningDetails} onOpenChange={open => {
        if (open) cancelLearningDetailsFocusRestore();
        setShowLearningDetails(open);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[110] bg-[var(--sf-scrim)] backdrop-blur-xs" />
          <Dialog.Content
            className="flashcard-panel flashcard-details-dialog fixed left-1/2 top-1/2 z-[111] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] sm:p-7 [html[data-theme-family=crystal]_&]:crystal-chamfer"
            aria-describedby={`learning-details-description-${data.id}`}
            onCloseAutoFocus={event => {
              event.preventDefault();
              cancelLearningDetailsFocusRestore();
              learningDetailsFocusTimerRef.current = globalThis.setTimeout(() => {
                learningDetailsFocusFrameRef.current = globalThis.requestAnimationFrame(() => {
                  learningDetailsFocusFrameRef.current = null;
                  learningDetailsButtonRef.current?.focus({ preventScroll: true });
                });
                learningDetailsFocusTimerRef.current = null;
              }, 0);
            }}
          >
            {/* Header: Synchronized with Flashcard Front */}
            <div className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] pb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                  <span lang={data.partOfSpeech ? targetLanguage : undefined} className="rounded-full border border-[color-mix(in_srgb,var(--sf-brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] text-[var(--sf-brand-text)] px-2.5 py-0.5 font-bold capitalize">
                    {data.partOfSpeech || <Trans {...msg({ context: 'flashcard.details.vocabulary', message: 'Vocabulary' })} />}
                  </span>
                  <span lang={targetLanguage} className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] px-2.5 py-0.5 font-bold text-[var(--sf-text-muted)]">
                    {data.category}
                  </span>
                  {data.cefrLevel && (
                    <span className={`rounded-full border px-2.5 py-0.5 font-bold uppercase ${
                      data.cefrLevel.toUpperCase().startsWith('A')
                        ? 'border-[color-mix(in_srgb,var(--sf-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--sf-success)_10%,transparent)] text-[var(--sf-success)]'
                        : data.cefrLevel.toUpperCase().startsWith('B')
                          ? 'border-[color-mix(in_srgb,var(--sf-brand)_40%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] text-[var(--sf-brand-text)]'
                          : 'border-[color-mix(in_srgb,var(--sf-second)_45%,transparent)] bg-[color-mix(in_srgb,var(--sf-second)_12%,transparent)] text-[var(--sf-text)]'
                    }`}>
                      <Trans {...msg({ context: 'flashcard.cefr-level', message: 'CEFR {level}' })} values={{ level: data.cefrLevel }} />
                    </span>
                  )}
                  {data.register && (
                    <span lang={targetLanguage} className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] px-2.5 py-0.5 font-bold capitalize text-[var(--sf-text-muted)]">
                      {data.register}
                    </span>
                  )}
                </div>

                <Dialog.Title lang={targetLanguage} className="mt-2.5 break-words text-balance font-serif text-3xl font-medium tracking-[-0.02em] text-[var(--sf-text)] sm:text-4xl">
                  {data.word}
                </Dialog.Title>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span lang={targetLanguage} className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--sf-brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] text-[var(--sf-brand-text)] px-3 py-0.5 font-mono text-xs font-medium">
                    <AudioLines size={13} className="shrink-0" aria-hidden="true" />
                    <span>{data.phonetic || '/.../'}</span>
                  </span>
                  {data.translation && (
                    <Dialog.Description id={`learning-details-description-${data.id}`} lang={translationLanguage} className="text-sm font-semibold text-[var(--sf-text-muted)]">
                      · {data.translation}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <Dialog.Close
                className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
                aria-label={_(msg({ id: 'flashcard.details.close', message: 'Close learning details' }))}
              >
                <X size={17} aria-hidden="true" />
              </Dialog.Close>
            </div>

            {/* Content Docks: Matching Back Face Architecture */}
            <div className="mt-4 space-y-3.5 text-sm">
              {/* Example in Context */}
              {data.exampleSentence && (
                <div className={detailsWidePanelClass}>
                  <div className={detailsSectionHeaderClass}>
                    <span className={detailsSectionIconClass}>
                      <BookOpen size={13} />
                    </span>
                    <div>
                      <p className={detailsSectionTitleClass}>
                        <Trans {...msg({ context: 'flashcard.details.example', message: 'Example in Context' })} />
                      </p>
                    </div>
                  </div>
                  <p lang={targetLanguage} className="font-serif text-base italic leading-relaxed text-[var(--sf-text)]">
                    “{data.exampleSentence}”
                  </p>
                  {data.exampleTranslation && (
                    <p lang={translationLanguage} className="mt-1.5 text-xs font-medium leading-relaxed text-[var(--sf-text-muted)]">
                      {data.exampleTranslation}
                    </p>
                  )}
                </div>
              )}

              {/* Collocations */}
              {data.collocations && data.collocations.length > 0 && (
                <div className={detailsWidePanelClass}>
                  <div className={detailsSectionHeaderClass}>
                    <span className={detailsSectionIconClass}>
                      <Sparkles size={13} />
                    </span>
                    <div>
                      <p className={detailsSectionTitleClass}>
                          <Trans {...msg({ context: 'flashcard.details.collocations', message: 'Common Collocations' })} />
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.collocations.map((colloc) => (
                      <span
                        key={colloc}
                        lang={targetLanguage}
                        className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] px-3 py-1 text-xs font-bold text-[var(--sf-text)]"
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
                    <div className={detailsSplitPanelClass}>
                      <div className={detailsSectionHeaderClass}>
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--sf-brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] text-[var(--sf-brand-text)] text-xs font-bold" aria-hidden="true">
                          ≈
                        </span>
                        <p className={detailsSectionTitleClass}>
                          <Trans {...msg({ context: 'flashcard.details.synonyms', message: 'Synonyms' })} />
                        </p>
                      </div>
                      <div className={detailsChipListClass}>
                        {data.synonyms.map(syn => (
                          <span
                            key={syn}
                            lang={targetLanguage}
                            className="rounded-full border border-[color-mix(in_srgb,var(--sf-brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] text-[var(--sf-brand-text)] px-2.5 py-1 text-xs font-bold"
                          >
                            {syn}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.antonyms && data.antonyms.length > 0 && (
                    <div className={detailsSplitPanelClass}>
                      <div className={detailsSectionHeaderClass}>
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] text-xs font-bold text-[var(--sf-text-muted)]" aria-hidden="true">
                          ≠
                        </span>
                        <p className={detailsSectionTitleClass}>
                          <Trans {...msg({ context: 'flashcard.details.antonyms', message: 'Antonyms' })} />
                        </p>
                      </div>
                      <div className={detailsChipListClass}>
                        {data.antonyms.map(ant => (
                          <span
                            key={ant}
                            lang={targetLanguage}
                            className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] px-2.5 py-1 text-xs font-bold text-[var(--sf-text-muted)]"
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
                <div className="flex w-full flex-col items-start rounded-[24px] border border-[color-mix(in_srgb,var(--sf-reward)_45%,transparent)] bg-[color-mix(in_srgb,var(--sf-reward)_10%,transparent)] p-4 text-left [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                  <div className="mb-2.5 flex w-full items-center gap-2 border-b border-[color-mix(in_srgb,var(--sf-reward)_30%,transparent)] pb-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sf-reward)_25%,transparent)] text-xs font-bold text-[var(--sf-text)]" aria-hidden="true">
                      ⚠️
                    </span>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--sf-text)]">
                      <Trans {...msg({ context: 'flashcard.details.common-mistake', message: 'Common Mistake' })} />
                    </p>
                  </div>
                  <p lang={targetLanguage} className="text-xs font-semibold leading-relaxed text-[var(--sf-text)]">
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
        restoreFocusRef={aiTutorButtonRef}
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
          <EditCardDialog card={data} open={showEditDialog} onOpenChange={setEditDialogOpen} onSave={onUpdateCard} onDelete={onEditDelete} context={editorContext} />
        </Suspense>
      )}
      {(onToggleBookmark || !isFlipped || onDelete) && (
        <div data-card-top-controls className={`absolute right-4 top-4 z-[45] flex flex-row-reverse items-center gap-2 transition-opacity duration-150 ${isFlipAnimating ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
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
              data-selected={data.bookmarked ? 'true' : 'false'}
              className="flashcard-chrome-button flashcard-reward-button flex min-h-11 min-w-11 items-center justify-center p-2 transition-[transform,background-color,border-color,color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              title={data.bookmarked ? _(msg({ id: 'flashcard.star.remove', message: 'Remove star' })) : _(msg({ id: 'flashcard.star.add', message: 'Star this word' }))}
              aria-label={data.bookmarked ? _(msg({ id: 'flashcard.star.remove', message: 'Remove star' })) : _(msg({ id: 'flashcard.star.add', message: 'Star this word' }))}
              aria-pressed={data.bookmarked}
            >
              <span className={data.bookmarked ? 'flashcard-star-selected' : undefined}>
                <Star size={17} className={data.bookmarked ? 'fill-current' : ''} aria-hidden="true" />
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
              data-selected={isBlindMode ? 'true' : 'false'}
              className="flashcard-chrome-button flex min-h-11 min-w-11 items-center justify-center p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              title={isBlindMode ? _(msg({ id: 'flashcard.hints.show', message: 'Show hints' })) : _(msg({ id: 'flashcard.hints.hide', message: 'Hide hints' }))}
              aria-label={isPackCard
                ? isBlindMode
                  ? _({ ...showReadingsMessage, values: { image: supportedImageUrl ? 'yes' : 'no' } })
                  : _({ ...hideReadingsMessage, values: { image: supportedImageUrl ? 'yes' : 'no' } })
                : isBlindMode ? _(msg({ id: 'flashcard.hints.reveal', message: 'Reveal image and definition' })) : _(msg({ id: 'flashcard.hints.hide-content', message: 'Hide image and definition' }))}
              aria-pressed={isBlindMode}
            >
              {isBlindMode ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          )}

          {onEditDelete && onUpdateCard && !isFlipped && (
            <button type="button" data-card-control onPointerDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); setEditDialogOpen(true); }}
              className="flashcard-chrome-button flex min-h-11 min-w-11 items-center justify-center p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              title={_(msg({ id: 'flashcard.edit', message: 'Edit card' }))} aria-label={_(msg({ id: 'flashcard.edit', message: 'Edit card' }))}><Pencil size={16} aria-hidden="true" /></button>
          )}

          {onDelete && (
            <button
              ref={deleteButtonRef}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteConfirmedRef.current = false; setShowConfirmDelete(true); }}
              data-card-danger
              className="flashcard-chrome-button flex min-h-11 min-w-11 items-center justify-center p-2 transition-[transform,opacity,background-color,border-color,color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] lg:scale-95 lg:opacity-0 lg:group-hover:scale-100 lg:group-hover:opacity-100 lg:group-focus-within:scale-100 lg:group-focus-within:opacity-100"
              title={_(msg({ id: 'flashcard.delete.confirm', message: 'Delete card' }))}
              aria-label={_(msg({ id: 'flashcard.delete.confirm', message: 'Delete card' }))}
            >
              <Trash2 size={15} aria-hidden="true" />
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
            showReading={showReading}
            toggleShowReading={() => setShowReading(value => !value)}
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
          aiTutorButtonRef={aiTutorButtonRef}
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
