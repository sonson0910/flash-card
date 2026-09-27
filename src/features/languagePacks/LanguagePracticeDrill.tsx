import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { CheckCircle2, ChevronRight, Gauge, Volume2, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { playWordAudio } from '../../lib/audio';
import type { CardData } from '../../types/card';
import { JapanesePitchContour } from '../../components/flashcard/ReadingToggle';
import { loadLanguagePack } from './registry';
import {
  createLanguagePracticeDrill,
  composeHangulBlocks,
  evaluateJapaneseSentenceCloze,
  findHangulFinalCorrection,
  evaluateToneLanguagePracticeDrill,
  evaluateTypedLanguagePracticeDrill,
  languagePracticeDrillSurfaceState,
  shouldRevealLanguagePracticeReading,
  shouldStartJapaneseSentenceCloze,
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
const TONE_MARKS = ['¯', 'ˊ', 'ˇ', 'ˋ', '˙'] as const;
const HANGUL_KEYS = [
  'ㅂ', 'ㅈ', 'ㄷ', 'ㄱ', 'ㅅ', 'ㅛ', 'ㅕ', 'ㅑ', 'ㅐ', 'ㅔ',
  'ㅁ', 'ㄴ', 'ㅇ', 'ㄹ', 'ㅎ', 'ㅗ', 'ㅓ', 'ㅏ', 'ㅣ',
  'ㅋ', 'ㅌ', 'ㅊ', 'ㅍ', 'ㅠ', 'ㅜ', 'ㅡ',
] as const;
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

export function LanguagePracticeDrill({ card, cards, onClose, onNext, currentIndex, total }: LanguagePracticeDrillProps) {
  const { i18n } = useLingui();
  const model = useMemo(() => createLanguagePracticeDrill(card, cards), [card, cards]);
  const [pack, setPack] = useState<LanguagePack | null>(null);
  const [reading, setReading] = useState<HeadwordReadingPlan | null>(null);
  const [input, setInput] = useState('');
  const [hangulJamo, setHangulJamo] = useState('');
  const [selectedTones, setSelectedTones] = useState<readonly number[]>([]);
  const [result, setResult] = useState<LanguagePracticeDrillResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [slowAudio, setSlowAudio] = useState(false);
  const [sentenceStage, setSentenceStage] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const composing = useRef(false);
  const answerInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (sentenceStage) answerInput.current?.focus(); }, [sentenceStage]);

  useEffect(() => {
    let active = true;
    setPack(null);
    setReading(null);
    setInput('');
    setHangulJamo('');
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
  }, [card, model.packId]);

  const hasToneExercise = model.kind === 'tone-melody';
  const cloze = sentenceStage ? model.sentenceCloze : undefined;
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
    if (composing.current || checked || !ready) return;
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
  const progress = typeof currentIndex === 'number' && typeof total === 'number' && total > 0
    ? { current: Math.min(currentIndex + 1, total), total } : null;
  const packLabel = model.packId === 'ko' ? <Trans id="languagePractice.ko.pack" message="Korean pack · 한국어" />
    : model.packId === 'ja' ? <Trans id="languagePractice.ja.pack" message="Japanese pack · 日本語" />
      : model.packId === 'zh' ? <Trans id="languagePractice.zh.pack" message="Chinese pack · 中文" />
        : <Trans id="languagePractice.en.pack" message="English pack" />;
  const title = cloze ? <Trans id="languagePractice.ja.sentence.title" message="Complete the sentence" />
    : model.kind === 'hangul-blocks' ? <Trans id="languagePractice.ko.title" message="Build the syllable blocks" />
    : model.kind === 'kana-reading' ? <Trans id="languagePractice.ja.title" message="Type the reading" />
      : model.kind === 'tone-melody' ? <Trans id="languagePractice.zh.title" message="Hear the tones" />
        : <Trans id="languagePractice.en.title" message="Spell the word" />;
  const playAudio = () => {
    if (typeof window === 'undefined' || !pack) return;
    if (!slowAudio) {
      playWordAudio(card.word, card.audioUrl, pack.speech.speechLocale);
      return;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(card.word);
    utterance.lang = pack.speech.speechLocale;
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
    const jamo = HANGUL_KEYBOARD[event.key];
    if (!jamo) return;
    event.preventDefault();
    setHangulJamo(value => value + jamo);
  };

  const instruction = cloze ? <Trans id="languagePractice.ja.sentence.instruction" message="Choose the missing word." />
    : model.kind === 'hangul-blocks'
    ? <Trans id="languagePractice.ko.instruction" message="Build the Hangul word from its meaning." />
    : model.kind === 'kana-reading'
      ? <Trans id="languagePractice.ja.instruction" message="Read the word, then type it in Japanese." />
      : model.kind === 'tone-melody'
        ? <Trans id="languagePractice.zh.instruction" message="Choose the tone for every pinyin syllable." />
        : <Trans id="languagePractice.en.instruction" message="Type the vocabulary word for this meaning." />;
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
    <section className={`language-practice-drill language-practice-drill--${model.kind}`} aria-labelledby="language-practice-heading" onKeyDown={handleHangulKeyDown} tabIndex={model.kind === 'hangul-blocks' ? 0 : undefined}>
      <header className="language-practice-drill__toolbar">
        <button type="button" onClick={onClose} className="language-practice-drill__exit">
          <X size={18} aria-hidden="true" /><span className="language-practice-drill__sr-only"><Trans id="languagePractice.action.exit" message="Exit" /></span>
        </button>
        <div className="language-practice-drill__identity"><span className="language-practice-drill__pack">{model.packId}</span><span>{packLabel}</span><h2 id="language-practice-heading">{title}</h2></div>
        {progress && <div className="language-practice-drill__progress"><span className="language-practice-drill__sr-only"><Trans id="languagePractice.progress" message="Item {current} of {total}" values={progress} /></span><span aria-hidden="true">{Array.from({ length: progress.total }, (_, index) => <i key={index} className={index < progress.current ? 'language-practice-drill__progress-done' : undefined} />)}</span><b aria-hidden="true">{progress.current}/{progress.total}</b></div>}
      </header>
      <div className="language-practice-drill__panel">
        <div className="language-practice-drill__prompt-row">
          <button type="button" className="language-practice-drill__listen" onClick={playAudio} disabled={!pack} aria-label={i18n._(msg({ id: 'languagePractice.action.listen', message: 'Play pronunciation' }))}><Volume2 size={20} aria-hidden="true" /></button>
          <div><p className="language-practice-drill__instruction">{instruction}</p><p className="language-practice-drill__prompt" lang={card.translationLanguage || 'vi'}>{cloze ? card.exampleTranslation || model.prompt : model.prompt}</p></div>
          <button type="button" className="language-practice-drill__speed" onClick={() => setSlowAudio(value => !value)} aria-pressed={slowAudio} title={i18n._(msg({ id: 'languagePractice.action.slow', message: 'Toggle slow pronunciation' }))}><Gauge size={14} aria-hidden="true" />{slowAudio ? '0.75×' : '1×'}</button>
        </div>
        {!cloze && model.kind === 'kana-reading' && reading?.readingText && revealReading ? <div className="language-practice-drill__japanese-reading" lang="ja"><p className="language-practice-drill__ruby"><ruby>{card.word}<rt>{reading.readingText}</rt></ruby></p>{reading.japanesePitchAccent && <JapanesePitchContour accent={reading.japanesePitchAccent} />}</div> : !cloze && showHint && reading?.readingText && (
          <div className="language-practice-drill__reading" lang={reading.readingLang}>
            <span>{reading.readingText}</span>{reading.japanesePitchAccent && <JapanesePitchContour accent={reading.japanesePitchAccent} />}
          </div>
        )}
        <form className="language-practice-drill__form" onSubmit={submit}>
          {surfaceState === 'loading' ? <p role="status" className="language-practice-drill__status"><Trans id="languagePractice.loading" message="Loading this language exercise…" /></p> : surfaceState === 'error' ? <p role="alert" className="language-practice-drill__status"><Trans id="languagePractice.loadError" message="This language exercise could not load. Please go back and try again." /></p> : surfaceState === 'missing-tone-data' ? <p role="alert" className="language-practice-drill__status"><Trans id="languagePractice.zh.missingTones" message="This card needs verified pinyin tone data before it can be practised." /></p> : hasToneExercise ? (
            <fieldset disabled={checked}>
              <legend className="language-practice-drill__sr-only"><Trans id="languagePractice.zh.tones" message="Pinyin tones" /></legend>
              <div className="language-practice-drill__tone-grid">
                {reading?.toneSyllables?.map((syllable, index) => (
                  <div key={`${syllable.text}-${index}`} className="language-practice-drill__tone-card">
                    <p lang="zh-Latn" className="language-practice-drill__syllable">{syllable.text.replace(/[\u0300-\u036fāēīōūǖáéíóúǘǎěǐǒǔǚàèìòùǜ]/gu, character => character.normalize('NFD').replace(/[\u0300-\u036f]/gu, ''))}</p>
                    <div className="language-practice-drill__tone-options">
                      {TONES.map(tone => <button key={tone} type="button" onClick={() => selectTone(index, tone)} aria-pressed={selectedTones[index] === tone} className={`language-practice-drill__tone-option language-practice-drill__tone-option--${tone}`}><span aria-hidden="true">{TONE_MARKS[tone - 1]}</span><small>{tone}</small></button>)}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : model.kind === 'hangul-blocks' ? (
            <fieldset disabled={checked} className="language-practice-drill__hangul">
              <legend className="language-practice-drill__sr-only"><Trans id="languagePractice.ko.keyboard" message="Hangul block keyboard" /></legend>
              <div className="language-practice-drill__hangul-blocks" lang="ko" aria-label={hangulAnswer || i18n._(msg({ id: 'languagePractice.ko.emptyBlocks', message: 'Empty Hangul blocks' }))}>
                {Array.from({ length: Math.max(targetGraphemes.length, 1) }, (_, index) => <span key={index} className={answerGraphemes[index] ? 'language-practice-drill__hangul-filled' : undefined} data-hangul-mismatch={hangulCorrection && answerGraphemes[index] !== targetGraphemes[index] ? 'true' : undefined} style={hangulCorrection && answerGraphemes[index] !== targetGraphemes[index] ? { color: 'var(--sf-danger)', borderColor: 'var(--sf-danger)' } : undefined}>{answerGraphemes[index] ?? '□'}</span>)}
              </div>
              {hangulAnswer && <p className="language-practice-drill__hangul-diagnostic"><span>{hangulJamo.split('').join(' + ')}</span> → <b>{hangulAnswer}</b></p>}
              {hangulCorrection && <p role="status" className="language-practice-drill__hangul-diagnostic"><Trans id="languagePractice.ko.final-correction" message="Final consonant: {typed} makes a different word. Delete it and choose {expected}." values={hangulCorrection} /></p>}
              <div className="language-practice-drill__hangul-keys">
                {HANGUL_KEYS.map(key => <button key={key} type="button" onClick={() => setHangulJamo(value => value + key)} className="language-practice-drill__hangul-key" style={key === hangulCorrection?.expected ? { color: 'var(--sf-success)', borderColor: 'var(--sf-success)' } : key === hangulCorrection?.typed ? { color: 'var(--sf-danger)', borderColor: 'var(--sf-danger)' } : undefined}>{key}<small>{HANGUL_KEY_LABEL[key]}</small></button>)}
                <button type="button" onClick={() => setHangulJamo(value => Array.from(value).slice(0, -1).join(''))} className="language-practice-drill__hangul-key"><Trans id="languagePractice.ko.backspace" message="Delete" /></button>
              </div>
            </fieldset>
          ) : (
            <label className="language-practice-drill__answer-label">
              <span className="language-practice-drill__sr-only"><Trans id="languagePractice.answer.label" message="Your answer" /></span>
              <input ref={answerInput} value={input} onChange={event => setInput(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} autoComplete="off" lang={card.language || 'en'} className="language-practice-drill__answer" placeholder={placeholder} disabled={checked} />
            </label>
          )}
          {cloze && <div className="language-practice-drill__sentence" lang="ja" aria-label={i18n._(msg({ id: 'languagePractice.ja.sentence.choices', message: 'Sentence completion choices' }))}>
            <p className="language-practice-drill__sentence-tokens">{sentence.tokens.map((token, index) => <span key={`${token.text}-${index}`} className={token.word ? index === sentence.blankIndex ? 'language-practice-drill__sentence-blank' : 'language-practice-drill__sentence-token' : undefined}>{token.text}</span>)}</p>
            {cloze.choices.length > 1 && <div className="language-practice-drill__segments">{cloze.choices.map(choice => <button key={choice.word} type="button" aria-pressed={input === choice.word} onClick={() => setInput(choice.word)} disabled={checked}><span>{choice.word}</span>{choice.reading && <small lang="ja">{choice.reading}</small>}{choice.meaning && <small lang={card.translationLanguage || 'vi'}>{choice.meaning}</small>}</button>)}</div>}
            {card.explanation && <aside className="language-practice-drill__sentence-explanation"><p>{card.explanation}</p></aside>}
          </div>}
          {checked && <p role="status" aria-live="polite" aria-atomic="true" className={`language-practice-drill__feedback ${result.correct ? 'language-practice-drill__feedback--correct' : 'language-practice-drill__feedback--incorrect'}`}>{result.correct ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}{result.correct ? <Trans id="languagePractice.feedback.correct" message="Correct." /> : <Trans id="languagePractice.feedback.incorrect" message="Try this card again in the next round." />}</p>}
          <div className="language-practice-drill__actions">
            {!cloze && !checked && reading?.readingText && <button type="button" onClick={() => setShowHint(true)} disabled={showHint} className="language-practice-drill__hint"><Trans id="languagePractice.action.hint" message="Hint" /></button>}
            {!checked ? <button type="submit" disabled={!ready || (hasToneExercise && selectedTones.length !== reading?.toneSyllables?.length)} className="language-practice-drill__primary-action"><Trans id="languagePractice.action.check" message="Check" /></button> : <button type="button" onClick={() => onNext(result)} className="language-practice-drill__primary-action"><Trans id="languagePractice.action.next" message="Next" /><ChevronRight size={18} aria-hidden="true" /></button>}
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
  return (
    <section className="language-practice-drill" aria-labelledby="language-practice-results-heading">
      <div className="language-practice-drill__panel language-practice-drill__results">
        <CheckCircle2 size={42} aria-hidden="true" />
        <h2 id="language-practice-results-heading" className="language-practice-drill__prompt"><Trans id="languagePractice.results.title" message="Drill complete" /></h2>
        <p><Trans id="languagePractice.results.score" message="{correct} of {total} correct" values={{ correct, total }} /></p>
        <div className="language-practice-drill__actions">
          <button type="button" onClick={onRestart} className="language-practice-drill__primary-action"><Trans id="languagePractice.results.try-again" message="Try again" /></button>
          <button type="button" onClick={onClose} className="language-practice-drill__exit"><Trans id="languagePractice.results.close" message="Back to library" /></button>
        </div>
      </div>
    </section>
  );
}
