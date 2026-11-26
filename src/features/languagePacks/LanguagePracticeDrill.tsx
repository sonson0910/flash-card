import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { CheckCircle2, ChevronRight, Gauge, X, XCircle } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { playWordAudio } from '../../lib/audio';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import { voiceForActiveCourseCard } from '../../lib/courseVoicePreference';
import type { CardData } from '../../types/card';
import { JapanesePitchContour } from '../../components/flashcard/ReadingToggle';
import { useCourseSession } from '../courses/CourseGate';
import { useTheme } from '../theme/ThemeProvider';
import { loadLanguagePack } from './registry';
import { decomposeHangulSyllables, romanizeHangul } from './hangulRomanization';
import {
  createLanguagePracticeDrill,
  composeHangulBlocks,
  evaluateJapaneseSentenceCloze,
  findHangulFinalCorrection,
  hangulFinalKeys,
  evaluateToneLanguagePracticeDrill,
  evaluateTypedLanguagePracticeDrill,
  languagePracticeDrillSurfaceState,
  shouldRevealLanguagePracticeReading,
  shouldStartJapaneseSentenceCloze,
  toneSyllableLabel,
  type LanguagePracticeDrillResult,
} from './languagePracticeDrill';
import type { HeadwordReadingPlan, LanguagePack } from './types';
import './language-practice-drill.css';

export interface LanguagePracticeDrillProps {
  readonly card: CardData;
  readonly cards: readonly CardData[];
  readonly onClose: () => void;
  readonly onNext: (result: LanguagePracticeDrillResult) => void;
  /** Optional session-owned progress; omitted while the host has not supplied it. */
  readonly currentIndex?: number;
  readonly total?: number;
}

const TONES = [1, 2, 3, 4, 5] as const;
// Pitch contour icons for tones 1-4 and the neutral tone, drawn in a 36x24 box.
const TONE_CONTOURS = ['M4 5h28', 'M4 17L32 4', 'M4 9Q13 25 21 18T32 5', 'M4 4L32 20', 'M18 12h.1'] as const;
const HANGUL_KEYS = [
  'ㅂ', 'ㅈ', 'ㄷ', 'ㄱ', 'ㅅ', 'ㅛ', 'ㅕ', 'ㅑ', 'ㅐ', 'ㅔ',
  'ㅁ', 'ㄴ', 'ㅇ', 'ㄹ', 'ㅎ', 'ㅗ', 'ㅓ', 'ㅏ', 'ㅣ',
  'ㅋ', 'ㅌ', 'ㅊ', 'ㅍ', 'ㅠ', 'ㅜ', 'ㅡ',
] as const;
// The three rows of the 2-set layout, so the on-screen keys stagger like a keyboard.
const HANGUL_KEY_ROWS = [HANGUL_KEYS.slice(0, 10), HANGUL_KEYS.slice(10, 19), HANGUL_KEYS.slice(19)] as const;
const HANGUL_SHIFTED_KEYS: Readonly<Partial<Record<(typeof HANGUL_KEYS)[number], string>>> = {
  'ㅂ': 'ㅃ', 'ㅈ': 'ㅉ', 'ㄷ': 'ㄸ', 'ㄱ': 'ㄲ', 'ㅅ': 'ㅆ', 'ㅐ': 'ㅒ', 'ㅔ': 'ㅖ',
};
const HANGUL_KEYBOARD: Readonly<Record<string, string>> = {
  q: 'ㅂ', Q: 'ㅃ', w: 'ㅈ', W: 'ㅉ', e: 'ㄷ', E: 'ㄸ', r: 'ㄱ', R: 'ㄲ', t: 'ㅅ', T: 'ㅆ',
  y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', O: 'ㅒ', p: 'ㅔ', P: 'ㅖ', a: 'ㅁ', s: 'ㄴ', d: 'ㅇ',
  f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ', z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ',
  b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
};
const HANGUL_KEY_LABEL: Readonly<Record<string, string>> = {
  'ㅂ': 'q', 'ㅈ': 'w', 'ㄷ': 'e', 'ㄱ': 'r', 'ㅅ': 't', 'ㅛ': 'y', 'ㅕ': 'u', 'ㅑ': 'i', 'ㅐ': 'o', 'ㅔ': 'p',
  'ㅁ': 'a', 'ㄴ': 's', 'ㅇ': 'd', 'ㄹ': 'f', 'ㅎ': 'g', 'ㅗ': 'h', 'ㅓ': 'j', 'ㅏ': 'k', 'ㅣ': 'l',
  'ㅋ': 'z', 'ㅌ': 'x', 'ㅊ': 'c', 'ㅍ': 'v', 'ㅠ': 'b', 'ㅜ': 'n', 'ㅡ': 'm',
};

function DrillPitchContour({ accent, draw }: {
  readonly accent: NonNullable<HeadwordReadingPlan['japanesePitchAccent']>;
  readonly draw: boolean;
}) {
  const { i18n } = useLingui();
  const levels = Array.from({ length: accent.moraCount }, (_, index) => {
    if (accent.downstep === 0) return index === 0 ? 0 : 1;
    if (accent.downstep === 1) return index === 0 ? 1 : 0;
    return index > 0 && index < accent.downstep ? 1 : 0;
  });
  const points = levels.map((level, index) => `${12 + index * 20},${level ? 8 : 24}`).join(' ');
  return (
    <svg className="japanese-pitch-contour" viewBox={`0 0 ${Math.max(24, accent.moraCount * 20 + 4)} 32`} role="img" aria-label={i18n._(msg({ id: 'flashcard.reading.verified-pitch', message: 'Verified Japanese pitch contour' }))}>
      <polyline className={draw ? 'sf-draw' : undefined} pathLength={1} points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {levels.map((level, index) => <circle key={index} cx={12 + index * 20} cy={level ? 8 : 24} r="2.75" fill="currentColor" />)}
    </svg>
  );
}

export function resolveOnScreenHangulKey(key: (typeof HANGUL_KEYS)[number], shifted: boolean): string {
  return shifted ? HANGUL_SHIFTED_KEYS[key] ?? key : key;
}

export function LanguagePracticeDrill({ card, cards, onClose, onNext, currentIndex, total }: LanguagePracticeDrillProps) {
  const { i18n } = useLingui();
  const { model: courseModel } = useCourseSession();
  const crystal = useTheme().family === 'crystal';
  const model = useMemo(() => createLanguagePracticeDrill(card, cards), [card, cards]);
  const [pack, setPack] = useState<LanguagePack | null>(null);
  const [reading, setReading] = useState<HeadwordReadingPlan | null>(null);
  const [input, setInput] = useState('');
  const [hangulJamo, setHangulJamo] = useState('');
  const [hangulShift, setHangulShift] = useState(false);
  const [selectedTones, setSelectedTones] = useState<readonly number[]>([]);
  const [result, setResult] = useState<LanguagePracticeDrillResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [slowAudio, setSlowAudio] = useState(false);
  const [sentenceStage, setSentenceStage] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const imeSubmitGuard = useRef(createImeSubmitGuard()).current;
  const pointerSubmit = useRef(false);
  const answerInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (sentenceStage) answerInput.current?.focus(); }, [sentenceStage]);

  useEffect(() => {
    let active = true;
    setPack(null);
    setReading(null);
    setInput('');
    setHangulJamo('');
    setHangulShift(false);
    setSelectedTones([]);
    setResult(null);
    setShowHint(false);
    setSentenceStage(false);
    setLoadError(false);
    void loadLanguagePack(model.packId)
      .then(nextPack => {
        if (!active) return;
        setPack(nextPack);
        setReading(nextPack.rendering.buildReadingPlan(card));
      })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [card, model.packId, loadAttempt]);

  const hasToneExercise = model.kind === 'tone-melody';
  const tonesComplete = Boolean(reading?.toneSyllables?.length)
    && reading?.toneSyllables?.every((_, index) => selectedTones[index] !== undefined) === true;
  const hanziSyllables = hasToneExercise ? Array.from(card.word.trim()) : [];
  const showHanziSyllables = hanziSyllables.length === reading?.toneSyllables?.length
    && hanziSyllables.every(character => /\p{Script=Han}/u.test(character));
  const cloze = sentenceStage ? model.sentenceCloze : undefined;
  const selectedClozeChoice = cloze?.choices.find(choice => choice.word === input);
  const sentence = cloze && pack ? (() => {
    const segment = (value: string) => {
      const tokens: { text: string; word: boolean }[] = [];
      let offset = 0;
      for (const word of pack.tokenization.segmentWords(value)) {
        const index = value.indexOf(word, offset);
        if (index < 0) return [{ text: value, word: false }];
        if (index > offset) tokens.push({ text: value.slice(offset, index), word: false });
        tokens.push({ text: word, word: true });
        offset = index + word.length;
      }
      if (offset < value.length) tokens.push({ text: value.slice(offset), word: false });
      return tokens;
    };
    const before = segment(cloze.before);
    return { tokens: [...before, { text: input || '＿＿', word: true }, ...segment(cloze.after)], blankIndex: before.length };
  })() : { tokens: [], blankIndex: -1 };
  const surfaceState = languagePracticeDrillSurfaceState(model.kind, reading, pack !== null, loadError);
  const ready = surfaceState === 'ready';
  const checked = result !== null;
  const revealReading = shouldRevealLanguagePracticeReading(showHint, checked);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const submittedByPointer = pointerSubmit.current;
    pointerSubmit.current = false;
    if (imeSubmitGuard.shouldBlockSubmit(event.nativeEvent as Event & { isComposing?: boolean; keyCode?: number }, submittedByPointer) || checked || !ready) return;
    if (cloze) {
      setResult(evaluateJapaneseSentenceCloze(model, input));
      return;
    }
    const typedAnswer = model.kind === 'hangul-blocks' ? composeHangulBlocks(hangulJamo) : input;
    const expectedAnswer = model.kind === 'kana-reading' && reading?.readingText ? reading.readingText : undefined;
    const next = hasToneExercise
      ? evaluateToneLanguagePracticeDrill(card.id, reading?.toneSyllables ?? [], selectedTones)
      : evaluateTypedLanguagePracticeDrill(model, typedAnswer, expectedAnswer);
    if (shouldStartJapaneseSentenceCloze(model, next)) {
      setSentenceStage(true);
      setInput('');
      setShowHint(true);
      return;
    }
    setResult(next);
  };
  const selectTone = (index: number, tone: number) => {
    if (checked) return;
    setSelectedTones(current => {
      const next = [...current];
      next[index] = tone;
      return next;
    });
  };
  const hangulAnswer = composeHangulBlocks(hangulJamo);
  const hangulCorrection = model.kind === 'hangul-blocks' && !checked
    ? findHangulFinalCorrection(hangulAnswer, card.word) : null;
  const targetGraphemes = pack?.tokenization.segmentGraphemes(card.word) ?? [];
  const answerGraphemes = pack?.tokenization.segmentGraphemes(hangulAnswer) ?? [];
  // The block the learner meant, spelled out jamo by jamo for the correction panel.
  const expectedBlock = hangulCorrection
    ? decomposeHangulSyllables(targetGraphemes.find((block, index) => block !== answerGraphemes[index]) ?? '')[0] : undefined;
  // A multi-word answer needs a space; single words keep the keyboard without one.
  const needsHangulSpace = model.kind === 'hangul-blocks' && /\s/u.test(card.word.trim());
  const progress = typeof currentIndex === 'number' && typeof total === 'number' && total > 0
    ? { current: Math.min(currentIndex + 1, total), total } : null;
  const packLabel = model.packId === 'ko' ? <Trans {...msg({ context: 'languagePractice.ko.pack', message: 'Korean pack · 한국어' })} />
    : model.packId === 'ja' ? <Trans {...msg({ context: 'languagePractice.ja.pack', message: 'Japanese pack · 日本語' })} />
      : model.packId === 'zh' ? <Trans {...msg({ context: 'languagePractice.zh.pack', message: 'Chinese pack · 中文' })} />
        : <Trans {...msg({ context: 'languagePractice.en.pack', message: 'English pack' })} />;
  const title = cloze ? <Trans {...msg({ context: 'languagePractice.ja.sentence.title', message: 'Complete the sentence' })} />
    : model.kind === 'hangul-blocks' ? <Trans {...msg({ context: 'languagePractice.ko.title', message: 'Build the syllable blocks' })} />
    : model.kind === 'kana-reading' ? <Trans {...msg({ context: 'languagePractice.ja.title', message: 'Type the reading' })} />
      : model.kind === 'tone-melody' ? <Trans {...msg({ context: 'languagePractice.zh.title', message: 'Hear the tones' })} />
        : <Trans {...msg({ context: 'languagePractice.en.title', message: 'Spell the word' })} />;
  const playAudio = () => {
    if (typeof window === 'undefined' || !pack) return;
    const voice = voiceForActiveCourseCard(card, courseModel.activeCourse);
    if (!slowAudio) {
      playWordAudio(card.word, card.audioUrl, pack.speech.speechLocale, voice);
      return;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(card.word);
    utterance.lang = pack.speech.speechLocale;
    if (voice) utterance.voice = voice;
    utterance.rate = 0.75;
    window.speechSynthesis.speak(utterance);
  };
  const handleHangulKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (model.kind !== 'hangul-blocks' || checked) return;
    if (event.key === 'Backspace') {
      event.preventDefault();
      setHangulJamo(value => Array.from(value).slice(0, -1).join(''));
      return;
    }
    // Space still activates a focused button; it types a space only from the drill surface itself.
    const jamo = event.key === ' ' ? (needsHangulSpace && event.target === event.currentTarget ? ' ' : undefined)
      : HANGUL_KEYBOARD[event.key];
    if (!jamo) return;
    event.preventDefault();
    setHangulJamo(value => value + jamo);
  };

  const instruction = cloze ? <Trans {...msg({ context: 'languagePractice.ja.sentence.instruction', message: 'Choose the missing word.' })} />
    : model.kind === 'hangul-blocks'
    ? <Trans {...msg({ context: 'languagePractice.ko.instruction', message: 'Build the Hangul word from its meaning.' })} />
    : model.kind === 'kana-reading'
      ? <Trans {...msg({ context: 'languagePractice.ja.instruction', message: 'Read the word, then type it in Japanese.' })} />
      : model.kind === 'tone-melody'
        ? <Trans {...msg({ context: 'languagePractice.zh.instruction', message: 'Choose the tone for every pinyin syllable.' })} />
        : <Trans {...msg({ context: 'languagePractice.en.instruction', message: 'Type the vocabulary word for this meaning.' })} />;
  const placeholder = cloze
    ? i18n._(msg({ id: 'languagePractice.ja.sentence.placeholder', message: 'Type the missing word' }))
    : model.packId === 'ja'
    ? i18n._(msg({ id: 'languagePractice.ja.placeholder', message: 'Kana answer' }))
    : model.packId === 'ko'
      ? i18n._(msg({ id: 'languagePractice.ko.placeholder', message: 'Hangul answer' }))
      : model.packId === 'zh'
        ? i18n._(msg({ id: 'languagePractice.zh.placeholder', message: 'Hanzi answer' }))
        : i18n._(msg({ id: 'languagePractice.en.placeholder', message: 'Word' }));

  return (
    <section className={`language-practice-drill language-practice-drill--${model.kind}`} aria-labelledby="language-practice-heading" data-result={result ? result.correct ? 'correct' : 'incorrect' : undefined} onKeyDown={handleHangulKeyDown} tabIndex={model.kind === 'hangul-blocks' ? 0 : undefined}>
      <header className="language-practice-drill__toolbar">
        <button type="button" onClick={onClose} className={`language-practice-drill__exit${crystal ? '' : ' fx-press'}`}>
          <X size={crystal ? 16 : 18} aria-hidden="true" /><span className="language-practice-drill__sr-only"><Trans {...msg({ context: 'languagePractice.action.exit', message: 'Exit' })} /></span>
        </button>
        <div className="language-practice-drill__identity"><span className="language-practice-drill__pack">{model.packId}</span><span>{packLabel}</span><h2 id="language-practice-heading" className={crystal ? undefined : 'fx-title'}><span className="language-practice-drill__title-text">{title}</span></h2></div>
        {progress && <div className="language-practice-drill__progress"><span className="language-practice-drill__sr-only"><Trans {...msg({ context: 'languagePractice.progress', message: 'Item {current} of {total}' })} values={progress} /></span><span aria-hidden="true">{Array.from({ length: progress.total }, (_, index) => <i key={index} className={[index < progress.current ? 'language-practice-drill__progress-done' : '', !crystal && index === progress.current - 1 ? 'sf-grow' : ''].filter(Boolean).join(' ') || undefined} data-current={index === progress.current - 1 || undefined} />)}</span><b aria-hidden="true">{progress.current}/{progress.total}</b></div>}
      </header>
      <div className={crystal ? 'language-practice-drill__panel' : 'language-practice-drill__panel fx-enter-2'}>
        <div className="language-practice-drill__prompt-row">
          <button type="button" className={crystal ? 'language-practice-drill__listen' : 'language-practice-drill__listen fx-press sf-pulse'} onClick={playAudio} disabled={!pack} aria-label={i18n._(msg({ id: 'languagePractice.action.listen', message: 'Play pronunciation' }))}><span className="language-practice-drill__listen-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map(bar => <i key={bar} className={crystal ? undefined : 'sf-wave'} style={crystal ? undefined : { animationDelay: `${bar * 110}ms` }} />)}</span></button>
          <div><p className="language-practice-drill__instruction">{instruction}</p><p className="language-practice-drill__prompt" lang={card.translationLanguage || 'vi'}>{cloze ? card.exampleTranslation || model.prompt : model.prompt}</p></div>
          <button type="button" className={crystal ? 'language-practice-drill__speed' : 'language-practice-drill__speed sf-ease'} onClick={() => setSlowAudio(value => !value)} aria-pressed={slowAudio} title={i18n._(msg({ id: 'languagePractice.action.slow', message: 'Toggle slow pronunciation' }))}><Gauge size={14} aria-hidden="true" />{slowAudio ? '0.75×' : '1×'}</button>
        </div>
        {!cloze && model.kind === 'kana-reading' ? revealReading && reading?.readingText ? <div className="language-practice-drill__japanese-reading" lang="ja"><p className="language-practice-drill__ruby"><ruby>{card.word}<rt>{reading.readingText}</rt></ruby></p>{reading.japanesePitchAccent && (crystal ? <JapanesePitchContour accent={reading.japanesePitchAccent} /> : <DrillPitchContour accent={reading.japanesePitchAccent} draw={checked} />)}</div> : <p className="language-practice-drill__ruby" lang="ja">{card.word}</p> : !cloze && showHint && reading?.readingText && (
          <div className="language-practice-drill__reading" lang={reading.readingLang}>
            <span>{reading.readingText}</span>{reading.japanesePitchAccent && (crystal ? <JapanesePitchContour accent={reading.japanesePitchAccent} /> : <DrillPitchContour accent={reading.japanesePitchAccent} draw={checked} />)}
          </div>
        )}
        <form className="language-practice-drill__form" onSubmit={submit}>
          {surfaceState === 'loading' ? <p role="status" className="language-practice-drill__status"><Trans {...msg({ context: 'languagePractice.loading', message: 'Loading this language exercise…' })} /></p> : surfaceState === 'error' ? <div role="alert" className="language-practice-drill__status"><p><Trans {...msg({ context: 'languagePractice.loadError', message: 'This language exercise could not load. Please try again.' })} /></p><button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)} className={`language-practice-drill__primary-action ${crystal ? 'sf-press' : 'fx-press'}`}><Trans {...msg({ id: 'languagePractice.action.retry', message: 'Retry' })} /></button></div> : surfaceState === 'missing-tone-data' ? <p role="alert" className="language-practice-drill__status"><Trans {...msg({ context: 'languagePractice.zh.missingTones', message: 'This card needs verified pinyin tone data before it can be practised.' })} /></p> : hasToneExercise ? (
            <fieldset disabled={checked}>
              <legend className="language-practice-drill__sr-only"><Trans {...msg({ context: 'languagePractice.zh.tones', message: 'Pinyin tones' })} /></legend>
              <div className="language-practice-drill__tone-grid">
                {reading?.toneSyllables?.map((syllable, index) => (
                  <div key={`${syllable.text}-${index}`} className="language-practice-drill__tone-card" data-tone={checked ? syllable.tone : undefined} data-tone-verdict={checked ? selectedTones[index] === syllable.tone ? 'right' : 'wrong' : undefined}>
                    <p lang="zh-Latn" className="language-practice-drill__syllable">{checked ? syllable.text : toneSyllableLabel(syllable.text)}</p>
                    {showHanziSyllables && <p lang={card.language || 'zh'} className="language-practice-drill__hanzi">{hanziSyllables[index]}</p>}
                    <div className="language-practice-drill__tone-options">
                      {TONES.map(tone => <button key={tone} type="button" onClick={() => selectTone(index, tone)} aria-pressed={selectedTones[index] === tone} data-tone-verdict={!checked ? undefined : selectedTones[index] === tone ? tone === syllable.tone ? 'right' : 'wrong' : tone === syllable.tone ? 'answer' : undefined} className={[`language-practice-drill__tone-option`, `language-practice-drill__tone-option--${tone}`, crystal ? 'sf-press' : 'fx-press', !crystal && checked && selectedTones[index] === tone ? (tone === syllable.tone ? 'fx-correct' : 'sf-shake') : ''].filter(Boolean).join(' ')}><svg width="28" height="18" viewBox="0 0 36 24" aria-hidden="true"><path d={TONE_CONTOURS[tone - 1]} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg><small>{tone}</small></button>)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="language-practice-drill__tone-legend" aria-hidden="true">{TONES.map(tone => <span key={tone} data-tone={tone}><i />{tone === 5 ? '·' : tone}</span>)}</div>
            </fieldset>
          ) : model.kind === 'hangul-blocks' ? (
            <fieldset disabled={checked} className="language-practice-drill__hangul">
              <legend className="language-practice-drill__sr-only"><Trans {...msg({ context: 'languagePractice.ko.keyboard', message: 'Hangul block keyboard' })} /></legend>
              <div className="language-practice-drill__hangul-blocks" lang="ko" aria-label={hangulAnswer || i18n._(msg({ id: 'languagePractice.ko.emptyBlocks', message: 'Empty Hangul blocks' }))}>
                {Array.from({ length: Math.max(targetGraphemes.length, 1) }, (_, index) => {
                  const answer = answerGraphemes[index];
                  const parts = answer ? decomposeHangulSyllables(answer)[0]?.parts : undefined;
                  const mismatch = Boolean(hangulCorrection && answer !== targetGraphemes[index]);
                  const blockShake = mismatch || Boolean(checked && !result?.correct && answer !== targetGraphemes[index]);
                  const blockCorrect = Boolean(!crystal && checked && result?.correct && answer && answer === targetGraphemes[index]);
                  const label = mismatch ? `→ ${targetGraphemes[index]}` : answer ? romanizeHangul(answer) : null;
                  return <div key={index}>
                    <i className="language-practice-drill__hangul-label" data-hangul-fix={mismatch ? 'true' : undefined} aria-hidden="true">{label ?? ' '}</i>
                    <span className={[answer ? 'language-practice-drill__hangul-filled' : '', blockShake ? 'sf-shake' : '', blockCorrect ? 'fx-correct' : ''].filter(Boolean).join(' ') || undefined} data-hangul-mismatch={mismatch ? 'true' : undefined}>{answer ?? '□'}</span>
                    {parts && <small className="language-practice-drill__hangul-parts">{parts.map((part, partIndex) => <span key={partIndex}>{partIndex > 0 && <span className="language-practice-drill__hangul-plus"> + </span>}<b data-hangul-wrong={mismatch && partIndex === 2 && hangulFinalKeys(part.jamo) === hangulCorrection?.typed ? 'true' : undefined}>{part.jamo}</b></span>)}</small>}
                  </div>;
                })}
              </div>
              <p className="language-practice-drill__hangul-caption"><Trans {...msg({ context: 'languagePractice.ko.block-formula', message: 'Each block = 초성 initial + 중성 vowel + 종성 final' })} /></p>
              {hangulAnswer && <p className="language-practice-drill__hangul-diagnostic"><span>{hangulJamo.split('').join(' + ')}</span> → <b>{hangulAnswer}</b></p>}
              {hangulCorrection && <div role="status" className="language-practice-drill__hangul-diagnostic language-practice-drill__hangul-fix">{expectedBlock && <b lang="ko" aria-hidden="true">{expectedBlock.parts.map((part, partIndex) => <Fragment key={partIndex}>{partIndex > 0 && ' + '}{partIndex === 2 ? <span className="language-practice-drill__hangul-fix-final">{part.jamo}</span> : part.jamo}</Fragment>)} → {expectedBlock.block}</b>}<p><Trans {...msg({ context: 'languagePractice.ko.final-correction', message: 'Final consonant: {typed} makes a different word. Delete it and choose {expected}.' })} values={hangulCorrection} /></p></div>}
              <div className="language-practice-drill__hangul-keys">
                <button type="button" aria-label="Shift" aria-pressed={hangulShift} onClick={() => setHangulShift(value => !value)} className={`language-practice-drill__hangul-key ${crystal ? 'sf-press' : 'fx-press'}`}>⇧<small>Shift</small></button>
                {HANGUL_KEY_ROWS.map((row, rowIndex) => <div key={rowIndex} className="language-practice-drill__hangul-row">{row.map(key => {
                  const displayedKey = resolveOnScreenHangulKey(key, hangulShift);
                  return <button key={key} type="button" onClick={() => { setHangulJamo(value => value + displayedKey); setHangulShift(false); }} className={`language-practice-drill__hangul-key ${crystal ? 'sf-press' : 'fx-press'}`} data-hangul-key={hangulCorrection?.expected.includes(displayedKey) ? 'expected' : hangulCorrection?.typed.includes(displayedKey) ? 'typed' : undefined}>{displayedKey}<small>{hangulShift ? `⇧${HANGUL_KEY_LABEL[key]}` : HANGUL_KEY_LABEL[key]}</small></button>;
                })}</div>)}
                {needsHangulSpace && <button type="button" onClick={() => { setHangulJamo(value => `${value} `); setHangulShift(false); }} className={`language-practice-drill__hangul-key ${crystal ? 'sf-press' : 'fx-press'}`}><Trans {...msg({ id: 'languagePractice.ko.space', message: 'Space' })} /></button>}
                <button type="button" onClick={() => setHangulJamo(value => Array.from(value).slice(0, -1).join(''))} className={`language-practice-drill__hangul-key ${crystal ? 'sf-press' : 'fx-press'}`}><Trans {...msg({ context: 'languagePractice.ko.backspace', message: 'Delete' })} /></button>
              </div>
              <p className="language-practice-drill__physical-help"><Trans {...msg({ context: 'languagePractice.ko.physicalKeyboard', message: 'Physical keyboard: type the 2-set keys shown on each button.' })} /></p>
            </fieldset>
          ) : (
            <label className="language-practice-drill__answer-label">
              <span className="language-practice-drill__sr-only"><Trans {...msg({ context: 'languagePractice.answer.label', message: 'Your answer' })} /></span>
              <input ref={answerInput} value={input} onChange={event => setInput(event.target.value)} onCompositionStart={imeSubmitGuard.onCompositionStart} onCompositionEnd={imeSubmitGuard.onCompositionEnd} onKeyDown={event => { if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault(); }} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} lang={card.language || 'en'} className="language-practice-drill__answer" placeholder={placeholder} disabled={checked} />
            </label>
          )}
          {cloze && <div className="language-practice-drill__sentence" lang="ja" aria-label={i18n._(msg({ id: 'languagePractice.ja.sentence.choices', message: 'Sentence completion choices' }))}>
            <p className="language-practice-drill__sentence-tokens">{sentence.tokens.map((token, index) => <span key={`${token.text}-${index}`} className={token.word ? index === sentence.blankIndex ? `language-practice-drill__sentence-blank${!crystal && checked && result ? (result.correct ? ' fx-correct' : ' sf-shake') : ''}` : 'language-practice-drill__sentence-token' : undefined}>{token.text}{index === sentence.blankIndex && selectedClozeChoice && (selectedClozeChoice.reading || selectedClozeChoice.meaning) && <span className="language-practice-drill__sentence-gloss">{selectedClozeChoice.reading && <span lang="ja">{selectedClozeChoice.reading}</span>}{selectedClozeChoice.reading && selectedClozeChoice.meaning && <span aria-hidden="true"> · </span>}{selectedClozeChoice.meaning && <span lang={card.translationLanguage || 'vi'}>{selectedClozeChoice.meaning}</span>}</span>}</span>)}</p>
            {cloze.choices.length > 1 && <div className="language-practice-drill__segments">{cloze.choices.map(choice => <button key={choice.word} type="button" className={crystal ? 'sf-press' : 'fx-press'} aria-pressed={input === choice.word} onClick={() => setInput(choice.word)} disabled={checked}><span>{choice.word}</span>{choice.reading && <small lang="ja">{choice.reading}</small>}{choice.meaning && <small lang={card.translationLanguage || 'vi'}>{choice.meaning}</small>}</button>)}</div>}
            {card.explanation && <aside className="language-practice-drill__sentence-explanation"><p>{card.explanation}</p></aside>}
          </div>}
          {checked && <p role="status" aria-live="polite" aria-atomic="true" className={`language-practice-drill__feedback ${result.correct ? 'language-practice-drill__feedback--correct' : 'language-practice-drill__feedback--incorrect'}${!crystal ? (result.correct ? ' fx-correct' : ' sf-shake') : ''}`}>{result.correct ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}{result.correct ? <Trans {...msg({ context: 'languagePractice.feedback.correct', message: 'Correct.' })} /> : <Trans {...msg({ context: 'languagePractice.feedback.incorrect', message: 'Try this card again in the next round.' })} />}</p>}
          <div className={crystal ? 'language-practice-drill__actions' : 'language-practice-drill__actions fx-enter-3'}>
            {progress && <p className="language-practice-drill__footnote" aria-hidden="true"><Trans {...msg({ context: 'languagePractice.footer.progress', message: 'Word {current} of {total}' })} values={progress} />{card.category && <> · {card.category}</>}</p>}
            {!cloze && !checked && reading?.readingText && <button type="button" onClick={() => setShowHint(true)} disabled={showHint} className={`language-practice-drill__hint ${crystal ? 'sf-press' : 'fx-press'}`}><Trans {...msg({ context: 'languagePractice.action.hint', message: 'Hint' })} /></button>}
            {!checked ? <button type="submit" onPointerDown={() => { pointerSubmit.current = true; setTimeout(() => { pointerSubmit.current = false; }, 0); }} disabled={!ready || (hasToneExercise && !tonesComplete)} className={`language-practice-drill__primary-action ${crystal ? 'sf-press' : 'fx-press'}`}><span className="language-practice-drill__primary-label"><Trans {...msg({ context: 'languagePractice.action.check', message: 'Check' })} /></span><kbd aria-hidden="true"><Trans {...msg({ context: 'languagePractice.key.enter', message: 'Enter' })} /></kbd></button> : <button type="button" onClick={() => onNext(result)} className={`language-practice-drill__primary-action ${crystal ? 'sf-press' : 'fx-press'}`}><span className="language-practice-drill__primary-label"><Trans {...msg({ context: 'languagePractice.action.next', message: 'Next' })} /></span><ChevronRight size={18} aria-hidden="true" /></button>}
          </div>
        </form>
      </div>
    </section>
  );
}

export function LanguagePracticeDrillResults({
  correct,
  total,
  onRestart,
  onClose,
}: {
  readonly correct: number;
  readonly total: number;
  readonly onRestart: () => void;
  readonly onClose: () => void;
}) {
  const crystal = useTheme().family === 'crystal';
  return (
    <section className="language-practice-drill" aria-labelledby="language-practice-results-heading">
      <div className={crystal ? 'language-practice-drill__panel language-practice-drill__results' : 'language-practice-drill__panel language-practice-drill__results fx-enter-2'}>
        <CheckCircle2 size={42} aria-hidden="true" />
        <h2 id="language-practice-results-heading" className={crystal ? 'language-practice-drill__prompt' : 'language-practice-drill__prompt fx-title'}><Trans {...msg({ context: 'languagePractice.results.title', message: 'Drill complete' })} /></h2>
        <p><Trans {...msg({ context: 'languagePractice.results.score', message: '{correct} of {total} correct' })} values={{ correct, total }} /></p>
        <div className={crystal ? 'language-practice-drill__actions' : 'language-practice-drill__actions fx-enter-3'}>
          <button type="button" onClick={onRestart} className={`language-practice-drill__primary-action ${crystal ? 'sf-press' : 'fx-press'}`}><Trans {...msg({ context: 'languagePractice.results.try-again', message: 'Try again' })} /></button>
          <button type="button" onClick={onClose} className={`language-practice-drill__exit${crystal ? '' : ' fx-press'}`}><Trans {...msg({ context: 'languagePractice.results.close', message: 'Back to library' })} /></button>
        </div>
      </div>
    </section>
  );
}
