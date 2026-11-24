import { i18n } from '@lingui/core';
import { ChevronLeft, ChevronRight, Mic, Play, RotateCcw } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import { voiceForActiveCourseCard } from '../../lib/courseVoicePreference';
import { triggerConfetti } from '../../lib/confetti';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import { speechLocaleFor } from '../../lib/speechLocale';
import { scoreSpeechMatch, type SpeechMatchResult } from '../../lib/speechMatch';
import type { CardData } from '../../types/card';
import { useCourseSession } from '../courses/CourseGate';
import { getLibraryCardTier } from '../library/libraryViewModel';
import { useTheme } from '../theme/ThemeProvider';
import { headwordStressParts } from '../../components/flashcard/CardHeadword';
import { CardTierName } from '../../components/flashcard/CardFront';
import { PronunciationVideo } from '../../components/flashcard/PronunciationVideo';
import { WordContextVideo, contextForWord } from '../../components/flashcard/WordContextVideo';
import { LumiCoach, PracticeCount, PracticeTopBar, useCrystalLumi, type PracticeSegmentState } from './practice-board-parts';
import { MIC_LEVEL_INTERVAL_MS, captureMicLevels, formatTakeClock, loadAudioPeaks, type AudioPeaks, type MicLevelCapture, type MicLevelStatus } from './shadowing-audio';
import { markSentence, type ShadowingWord } from './shadowing-words';
import './practice-board.css';

interface ShadowingViewProps {
  cards: CardData[];
  onClose: () => void;
}

/** Bars in each waveform: the model's whole clip, and the latest stretch of the take. */
const WAVE_BARS = 48;
const CLEAR_SCORE = 80;

type Descriptor = ReturnType<typeof msg>;

export function ShadowingView({ cards, onClose }: ShadowingViewProps) {
  const { _ } = useLingui();
  const crystal = useTheme().family === 'crystal';
  const t = (descriptor: Descriptor, values?: Record<string, unknown>) => _({ ...descriptor, values });
  const { model: courseModel } = useCourseSession();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [matchResult, setMatchResult] = useState<SpeechMatchResult | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const [practiceWord, setPracticeWord] = useState(false);
  const [practiceContext, setPracticeContext] = useState(false);
  const finalizedRecognitionRef = useRef<unknown>(null);
  const [takeNumber, setTakeNumber] = useState(0);
  const [takeLevels, setTakeLevels] = useState<number[]>([]);
  const [takeSamples, setTakeSamples] = useState(0);
  const [micStatus, setMicStatus] = useState<MicLevelStatus | null>(null);
  const micRef = useRef<MicLevelCapture | null>(null);
  const [modelAudio, setModelAudio] = useState<{ url: string; peaks: AudioPeaks | null } | null>(null);

  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);
  const card = cards[currentIndex];
  useEffect(() => () => { audioPlaybackRef.current?.cancel(); }, [card?.id]);
  const contextCue = card && contextForWord(card.word);
  const targetSentence = (practiceContext && contextCue?.text) || (!practiceWord && card?.exampleSentence) || card?.word || '';
  const position = currentIndex + 1;
  const audioUrl = card?.audioUrl ?? null;

  // The model waveform is the card's own recording when the browser can decode it.
  useEffect(() => {
    if (!audioUrl) return;
    const controller = new AbortController();
    void loadAudioPeaks(audioUrl, WAVE_BARS, controller.signal).then(peaks => {
      if (!controller.signal.aborted) setModelAudio({ url: audioUrl, peaks });
    });
    return () => controller.abort();
  }, [audioUrl]);

  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    finalizedRecognitionRef.current = null;
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
      try {
        recognition.abort?.();
      } catch {}
    }
    stopMic();
    setIsListening(false);
  }, [stopMic]);

  const startListening = useCallback(() => {
    stopListening();
    setSpeechError(null);
    setTranscript('');
    setMatchResult(null);

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError(_(msg({ id: 'practice.shadowing.unsupported', message: 'This browser does not support speech recognition.' })));
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      finalizedRecognitionRef.current = null;
      recognition.lang = speechLocaleFor(card);
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (recognitionRef.current !== recognition) return;
        setIsListening(true);
        triggerHaptic('medium');
      };

      recognition.onresult = (event: any) => {
        if (recognitionRef.current !== recognition) return;
        const currentTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setTranscript(currentTranscript);

        if (event.results[0].isFinal && finalizedRecognitionRef.current !== recognition) {
          finalizedRecognitionRef.current = recognition;
          const confidence = event.results[0][0].confidence || 0.8;
          const evaluated = scoreSpeechMatch(targetSentence, currentTranscript, confidence);
          setMatchResult(evaluated);

          if (evaluated.score >= CLEAR_SCORE) {
            playRewardSound();
            triggerConfetti(0.5, 0.5);
            triggerHaptic('success');
          } else {
            triggerHaptic('warning');
          }
        }
      };

      recognition.onerror = (e: any) => {
        if (recognitionRef.current !== recognition) return;
        if (e.error !== 'no-speech') {
          setSpeechError(t(msg({ id: 'practice.shadowing.error', message: 'Speech recognition error: {error}' }), { error: e.error }));
        }
        stopMic();
        setIsListening(false);
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        stopMic();
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      setTakeNumber(takeNumber + 1);
      setTakeLevels([]);
      setTakeSamples(0);
      // The waveform listens to the same microphone; refusing it leaves recognition running.
      micRef.current = captureMicLevels({
        onStatus: setMicStatus,
        onLevel: level => {
          setTakeLevels(levels => [...levels, level].slice(-WAVE_BARS));
          setTakeSamples(samples => samples + 1);
        },
      });
      recognition.start();
    } catch {
      recognitionRef.current = null;
      stopMic();
      setSpeechError(_(msg({ id: 'practice.shadowing.microphone-error', message: 'Unable to open the microphone. Please grant microphone access in your browser.' })));
      setIsListening(false);
    }
  }, [_, card, targetSentence, stopListening, stopMic, takeNumber]);

  useEffect(() => {
    return () => {
      stopListening();
      audioPlaybackRef.current?.cancel();
    };
  }, [stopListening]);

  const playPronunciation = () => {
    audioPlaybackRef.current?.cancel();
    const voice = voiceForActiveCourseCard(card, courseModel.activeCourse);
    audioPlaybackRef.current = playWordAudio(card.word, card.audioUrl, speechLocaleFor(card), voice);
  };

  const close = () => {
    stopListening();
    audioPlaybackRef.current?.cancel();
    onClose();
  };

  const resetTake = () => {
    setTranscript('');
    setMatchResult(null);
    setSpeechError(null);
    setTakeLevels([]);
    setTakeSamples(0);
    setMicStatus(null);
  };

  const move = (nextIndex: number) => {
    stopListening();
    audioPlaybackRef.current?.cancel();
    resetTake();
    setTakeNumber(0);
    setCurrentIndex(nextIndex);
    setPracticeContext(false);
  };

  const chooseTarget = (wordOnly: boolean | 'context') => {
    stopListening();
    resetTake();
    setTakeNumber(0);
    setPracticeContext(wordOnly === 'context');
    if (wordOnly !== 'context') setPracticeWord(wordOnly);
  };

  if (!card) return null;

  const targetLanguage = card.language || 'en';
  const nativeLanguage = card.translationLanguage || 'vi';
  const words = markSentence(targetSentence, matchResult ? transcript : null, card.word, targetLanguage);
  const clearWords = words.filter(word => word.mark === 'clear').length;
  const segments: PracticeSegmentState[] = cards.map((_item, index) => (index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending'));
  const model = modelAudio && modelAudio.url === audioUrl ? modelAudio.peaks : null;
  const hasTake = takeNumber > 0 && (isListening || takeSamples > 0 || Boolean(transcript) || Boolean(matchResult));
  const isLast = currentIndex === cards.length - 1;
  const spaced = !/^(ja|zh|th)/.test(targetLanguage);
  const stress = headwordStressParts(card);

  return (
    <div className="practice-board practice-board--shadowing practice-stage" data-practice-mode="shadowing">
      <PracticeTopBar
        closeLabel={<Trans {...msg({ context: 'practice.shadowing.close', message: 'Close shadowing practice' })} />}
        closeAriaLabel={_(msg({ id: 'practice.shadowing.close', message: 'Close shadowing practice' }))}
        onClose={close}
        mode={<Trans {...msg({ context: 'practice.shadowing.mode', message: 'Shadowing' })} />}
        detail={<Trans {...msg({ context: 'practice.shadowing.mode-detail', message: 'say it after me' })} />}
        progressLabel={t(msg({ id: 'practice.shadowing.progress', message: 'Sentence {current} of {total}' }), { current: position, total: cards.length })}
        segments={segments}
        progressValue={position}
        count={<PracticeCount current={position} total={cards.length} />}
      />

      <section className="practice-shadowing" aria-labelledby="shadowing-sentence">
        <p className="practice-shadowing__focus">
          <span className="practice-shadowing__focus-text">
            <span><Trans {...msg({ context: 'practice.shadowing.focus-word', message: 'Focus word' })} /></span>{' '}
            <span lang={targetLanguage} className="practice-shadowing__focus-word">
              {stress ? <><span className="practice-shadowing__focus-stress">{stress.stressed}</span>{stress.rest}</> : card.word}
            </span>
            {card.phonetic && <span lang={targetLanguage} className="practice-shadowing__ipa">{card.phonetic}</span>}
          </span>
        </p>
        <h2 id="shadowing-sentence" lang={targetLanguage} className="practice-shadowing__sentence" data-spaced={spaced || undefined}>
          {words.map((word, index) => (
            <SentenceWord key={index} word={word} space={index > 0 && spaced} />
          ))}
        </h2>
        {!practiceWord && !practiceContext && card.exampleTranslation && (
          <p lang={nativeLanguage} className="practice-shadowing__translation">
            {card.exampleTranslation}
          </p>
        )}

        <div className="practice-shadowing__targets" role="group" aria-label={i18n._(msg({ id: "shadowing-view.practice-target", message: "Practice target" }))}>
          {[true, false].map(wordOnly => (
            <button
              key={String(wordOnly)}
              type="button"
              aria-pressed={!practiceContext && practiceWord === wordOnly}
              disabled={!wordOnly && !card.exampleSentence}
              className="practice-shadowing__target min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
              onClick={() => chooseTarget(wordOnly)}
            >
              {wordOnly
                ? <Trans {...msg({ context: 'shadowing-view.practice-target-word', message: 'Practice target word' })} />
                : <Trans {...msg({ context: 'shadowing-view.practice-card-sentence', message: 'Practice card sentence' })} />}
            </button>
          ))}
          {contextCue && (
            <button type="button" aria-pressed={practiceContext} className="practice-shadowing__target min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none" onClick={() => chooseTarget('context')}>
              <Trans {...msg({ context: 'shadowing-view.practice-clip-sentence', message: 'Practice clip sentence' })} />
            </button>
          )}
        </div>

        <section className="practice-shadowing__waves crystal-chamfer surface-glass" aria-label={_(msg({ id: 'practice.shadowing.waves', message: 'Model and your take' }))}>
          <div className="practice-shadowing__track">
            <div className="practice-shadowing__track-head">
              <button
                type="button"
                onClick={playPronunciation}
                className="practice-shadowing__play focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label={t(msg({ id: 'practice.shadowing.play-pronunciation', message: 'Play pronunciation for {word}' }), { word: card.word })}
              >
                <span><Play size={crystal ? 12 : 13} fill="currentColor" aria-hidden="true" /></span>
              </button>
              <span className="practice-shadowing__track-label"><Trans {...msg({ context: 'practice.shadowing.model', message: 'Model' })} /></span>
              {model && <span className="practice-shadowing__clock">{formatTakeClock(model.duration)}</span>}
            </div>
            <Waveform levels={model?.peaks ?? []} kind="model" />
            {!model && (
              <p className="practice-shadowing__wave-note">
                <Trans {...msg({ context: 'practice.shadowing.model-voice', message: 'Spoken by your browser voice. Tap play to hear it.' })} />
              </p>
            )}
          </div>
          <div className="practice-shadowing__track">
            <div className="practice-shadowing__track-head">
              <span className="practice-shadowing__rec" data-live={isListening || undefined} aria-hidden="true" />
              <span className="practice-shadowing__track-label">
                {takeNumber === 0
                  ? <Trans {...msg({ context: 'practice.shadowing.your-take', message: 'Your take' })} />
                  : isListening
                    ? <Trans {...msg({ context: 'practice.shadowing.take-recording', message: 'Take {take} · recording' })} values={{ take: takeNumber }} />
                    : <Trans {...msg({ context: 'practice.shadowing.take', message: 'Take {take}' })} values={{ take: takeNumber }} />}
              </span>
              {takeSamples > 0 && <span className="practice-shadowing__clock">{formatTakeClock((takeSamples * MIC_LEVEL_INTERVAL_MS) / 1000)}</span>}
            </div>
            <Waveform levels={takeLevels} kind="take" live={isListening} />
            {hasTake && (micStatus === 'denied' || micStatus === 'unavailable') && (
              <p className="practice-shadowing__wave-note" data-mic-status={micStatus}>
                {micStatus === 'denied'
                  ? <Trans {...msg({ context: 'practice.shadowing.levels-denied', message: 'Microphone levels are off because access was not allowed. Your words are still checked.' })} />
                  : <Trans {...msg({ context: 'practice.shadowing.levels-unavailable', message: 'This browser cannot show microphone levels. Your words are still checked.' })} />}
              </p>
            )}
          </div>
        </section>

        <div className="practice-shadowing__controls">
          <div className="practice-shadowing__score">
            {matchResult ? (
              <>
                <p className="practice-shadowing__score-line">
                  <span className="practice-shadowing__score-value">{matchResult.score}</span>
                  <span>
                    <Trans {...msg({ context: 'practice.shadowing.match-take', message: '% match · take {take}' })} values={{ take: takeNumber }} />
                  </span>
                  {crystal && <span className="practice-shadowing__tier" data-tier={getLibraryCardTier(card)}><CardTierName tier={getLibraryCardTier(card)} /></span>}
                </p>
                <div
                  className="practice-shadowing__meter"
                  role="meter"
                  aria-label={_(msg({ id: 'practice.shadowing.match-meter', message: 'Sentence match' }))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={matchResult.score}
                >
                  <span style={{ width: `${Math.max(0, Math.min(100, matchResult.score))}%` }} />
                </div>
              </>
            ) : (
              <p className="practice-shadowing__prompt">
                {isListening
                  ? <Trans {...msg({ context: 'practice.shadowing.listening', message: 'Listening…' })} />
                  : <Trans {...msg({ context: 'practice.shadowing.start-copy', message: 'Tap the microphone and read the sentence.' })} />}
              </p>
            )}
            <ul className="practice-shadowing__legend">
              <li data-mark="clear"><Trans {...msg({ context: 'practice.shadowing.legend-clear', message: 'Clear' })} /></li>
              <li data-mark="close"><Trans {...msg({ context: 'practice.shadowing.legend-close', message: 'Close' })} /></li>
              <li data-mark="missed"><Trans {...msg({ context: 'practice.shadowing.legend-missed', message: 'Missed' })} /></li>
            </ul>
          </div>

          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            data-listening={isListening || undefined}
            className={`practice-shadowing__mic sf-press${isListening ? ' sf-pulse' : ''} focus-visible:outline-2 focus-visible:outline-offset-4`}
            aria-label={isListening ? _(msg({ id: 'practice.shadowing.stop-recording', message: 'Stop recording' })) : _(msg({ id: 'practice.shadowing.start-reading', message: 'Start reading' }))}
          >
            {crystal && <span className="practice-shadowing__mic-ring" aria-hidden="true"><span className="practice-shadowing__mic-ring-spin" /></span>}
            <span className="practice-shadowing__mic-face">
              {isListening ? <span className="practice-shadowing__stop" aria-hidden="true" /> : <Mic size={crystal ? 30 : 34} aria-hidden="true" />}
            </span>
          </button>

          <div className="practice-shadowing__actions">
            <button
              type="button"
              onClick={() => move(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="practice-shadowing__prev practice-secondary crystal-chamfer focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={_(msg({ id: 'practice.shadowing.previous', message: 'Previous word' }))}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            {(matchResult || transcript) && !isListening && (
              <button type="button" onClick={startListening} className="practice-secondary crystal-chamfer focus-visible:outline-2 focus-visible:outline-offset-2">
                <RotateCcw size={16} aria-hidden="true" />
                <Trans {...msg({ context: 'practice.shadowing.try-again', message: 'Try again' })} />
              </button>
            )}
            <button
              type="button"
              onClick={() => move(Math.min(cards.length - 1, currentIndex + 1))}
              disabled={isLast}
              className="practice-primary crystal-chamfer focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={_(msg({ id: 'practice.shadowing.next', message: 'Next word' }))}
            >
              {crystal && <span aria-hidden="true" className="practice-shadowing__shine crystal-shine" />}
              <span className="practice-shadowing__next-label"><Trans {...msg({ context: 'practice.shadowing.next-short', message: 'Next' })} /></span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="practice-shadowing__feedback" aria-live="polite">
          {transcript && (
            <p lang={targetLanguage} className="practice-shadowing__heard">
              <b><Trans {...msg({ context: 'practice.shadowing.you-said', message: 'You said:' })} /></b> “{transcript}”
            </p>
          )}
          {matchResult && matchResult.score >= CLEAR_SCORE && (
            <p className="practice-shadowing__success">
              <Trans {...msg({ context: 'practice.shadowing.success', message: 'Nice pronunciation' })} />
            </p>
          )}
        </div>
        {speechError && <p role="alert" className="practice-shadowing__error">{speechError}</p>}

        <div className="practice-shadowing__notes">
          <p><Trans {...msg({ context: 'shadowing-view.the-browser-checks-whether-the-intended-words-were-recognised-it-', message: 'The browser checks whether the intended words were recognised; it does not assess individual sounds, phonemes, or accent.' })} /></p>
          <p data-assessment="unavailable"><Trans {...msg({ context: 'shadowing-view.pronunciation-assessment-is-unavailable-in-this-build-browser-tra', message: 'Pronunciation assessment is unavailable in this build; browser transcript matching remains available.' })} /></p>
        </div>

        {targetLanguage === 'en' && <PronunciationVideo key={card.id} word={card.word} />}
        {targetLanguage === 'en' && <WordContextVideo key={`context-${card.id}`} word={card.word} />}

        <ShadowingCoach
          heading={matchResult
            ? t(msg({ id: 'practice.shadowing.coach-result', message: '{clear} of {total} words came through clearly.' }), { clear: clearWords, total: words.length })
            : _(msg({ id: 'practice.shadowing.coach-start', message: 'Say it after me!' }))}
          body={_(msg({ id: 'practice.shadowing.coach-body', message: 'Listen to the model first, then read the whole sentence in one go.' }))}
        />
      </section>
    </div>
  );
}

function SentenceWord({ word, space }: { word: ShadowingWord; space: boolean }) {
  return (
    <>
      {space && ' '}
      <span className="practice-shadowing__word" data-mark={word.mark} data-focus={word.focus || undefined}>
        <span className="practice-shadowing__word-text">{word.text}</span>
        <span aria-hidden="true" className="practice-shadowing__bar" />
      </span>
    </>
  );
}

interface WaveformProps {
  levels: readonly number[];
  kind: 'model' | 'take';
  live?: boolean;
}

/** A row of bars from real loudness samples; unrecorded room is drawn as a dotted rest line. */
function Waveform({ levels, kind, live = false }: WaveformProps) {
  const rest = Math.max(0, WAVE_BARS - levels.length);
  return (
    <div className="practice-shadowing__wave" data-kind={kind} data-live={live || undefined} aria-hidden="true">
      {levels.map((level, index) => (
        <span key={index} className="practice-shadowing__wave-bar" style={{ height: `${Math.round(8 + Math.min(1, level) * 92)}%` }} />
      ))}
      {rest > 0 && <span className="practice-shadowing__wave-rest" style={{ flexGrow: rest }} />}
    </div>
  );
}

/** Crystal-only: Lumi coaching the take, from the learner's own result when there is one. */
function ShadowingCoach({ heading, body }: { heading: string; body: string }) {
  const showLumi = useCrystalLumi();
  if (!showLumi) return null;
  return (
    <LumiCoach pose="happy" heading={heading} className="practice-shadowing__lumi">
      {body}
    </LumiCoach>
  );
}
