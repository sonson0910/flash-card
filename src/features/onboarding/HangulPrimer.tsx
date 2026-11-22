import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { ReactNode } from 'react';

/** The 14 basic consonants and 10 basic vowels, with their Revised Romanization sounds. */
const HANGUL_CONSONANTS: readonly (readonly [jamo: string, sound: string])[] = [
  ['ㄱ', 'g/k'], ['ㄴ', 'n'], ['ㄷ', 'd/t'], ['ㄹ', 'r/l'], ['ㅁ', 'm'], ['ㅂ', 'b/p'], ['ㅅ', 's'],
  ['ㅇ', '-/ng'], ['ㅈ', 'j'], ['ㅊ', 'ch'], ['ㅋ', 'k'], ['ㅌ', 't'], ['ㅍ', 'p'], ['ㅎ', 'h'],
];
const HANGUL_VOWELS: readonly (readonly [jamo: string, sound: string])[] = [
  ['ㅏ', 'a'], ['ㅑ', 'ya'], ['ㅓ', 'eo'], ['ㅕ', 'yeo'], ['ㅗ', 'o'], ['ㅛ', 'yo'], ['ㅜ', 'u'], ['ㅠ', 'yu'], ['ㅡ', 'eu'], ['ㅣ', 'i'],
];
/** ㅎ + ㅏ + ㄴ stack into the block 한, the first syllable of 한국 (Korea). */
const BLOCK_PARTS: readonly (readonly [jamo: string, sound: string])[] = [['ㅎ', 'h'], ['ㅏ', 'a'], ['ㄴ', 'n']];
const BLOCK = '한';
const BLOCK_SOUND = 'han';
const BLOCK_WORD = '한국';
const BLOCK_WORD_SOUND = 'han-guk';

export interface HangulPrimerProps {
  readonly eyebrow: ReactNode;
  /** True to show romanization while learning, false when the learner already reads Hangul. */
  readonly romanization: boolean | null;
  readonly onChoose: (romanization: boolean) => void;
}

function JamoGrid({ items, label, count }: { readonly items: typeof HANGUL_CONSONANTS; readonly label: string; readonly count: number }) {
  return <section className="onb-primer-set" aria-label={label}>
    <p className="onb-primer-set-head"><span>{label}</span><span>{count}</span></p>
    <ul className="onb-primer-grid" data-count={count}>
      {items.map(([jamo, sound]) => <li key={jamo} className="onb-primer-jamo crystal-chamfer-sm">
        <span lang="ko" className="onb-primer-jamo-glyph">{jamo}</span>
        <span className="onb-primer-jamo-sound">{sound}</span>
      </li>)}
    </ul>
  </section>;
}

/**
 * A Korean course's first look at its script: how one syllable block is built, and the basic
 * consonants and vowels with their sounds. The learner's answer sets the course's romanization
 * preference; there is no lesson behind it, so the step promises none.
 */
export function HangulPrimer({ eyebrow, romanization, onChoose }: HangulPrimerProps) {
  const { _ } = useLingui();
  return <div className="onb-primer">
    <div className="onb-primer-copy">
      {eyebrow}
      <h2 className="onb-title"><Trans {...msg({ context: 'onboarding.primer.heading', message: 'Read <0>Hangul</0> before your first words' })} components={{ 0: <em className="onb-accent" /> }} /></h2>
      <p className="onb-subtitle"><Trans {...msg({ context: 'onboarding.primer.subtitle', message: 'Hangul has 14 basic consonants and 10 basic vowels. They stack into one block per syllable, so once you know the letters you can sound out any word.' })} /></p>
      <div className="onb-primer-choices" role="group" aria-label={_(msg({ context: 'onboarding.primer.choice-label', message: 'Reading aid' }))}>
        <button type="button" aria-pressed={romanization === true} className="onb-option onb-primer-choice crystal-chamfer" onClick={() => onChoose(true)}>
          <span className="onb-option-name"><Trans {...msg({ context: 'onboarding.primer.learning', message: 'I’m still learning to read' })} /></span>
          <span className="onb-option-sub"><Trans {...msg({ context: 'onboarding.primer.learning.description', message: 'Show romanization next to Korean on my cards.' })} /></span>
        </button>
        <button type="button" aria-pressed={romanization === false} className="onb-option onb-primer-choice crystal-chamfer" onClick={() => onChoose(false)}>
          <span className="onb-option-name"><Trans {...msg({ context: 'onboarding.primer.reader', message: 'I can already read Hangul' })} /></span>
          <span className="onb-option-sub"><Trans {...msg({ context: 'onboarding.primer.reader.description', message: 'Show Korean only.' })} /></span>
        </button>
      </div>
      <p className="onb-primer-note"><Trans {...msg({ context: 'onboarding.primer.note', message: 'You can turn romanization on or off any time in Settings.' })} /></p>
    </div>
    <div className="onb-primer-board crystal-chamfer">
      <section className="onb-primer-block" aria-label={_(msg({ context: 'onboarding.primer.block.label', message: 'Build one syllable block' }))}>
        <p className="onb-primer-set-head"><span><Trans {...msg({ context: 'onboarding.primer.block.title', message: 'Build one syllable block' })} /></span><span><Trans {...msg({ context: 'onboarding.primer.block.parts', message: 'first consonant + vowel + final consonant' })} /></span></p>
        <div className="onb-primer-equation">
          {BLOCK_PARTS.map(([jamo, sound], index) => <span key={jamo} className="onb-primer-part">
            {index > 0 && <span className="onb-primer-op" aria-hidden="true">+</span>}
            <span className="onb-primer-jamo crystal-chamfer-sm"><span lang="ko" className="onb-primer-jamo-glyph">{jamo}</span><span className="onb-primer-jamo-sound">{sound}</span></span>
          </span>)}
          <span className="onb-primer-op" aria-hidden="true">=</span>
          <span className="onb-primer-jamo onb-primer-result crystal-chamfer-sm"><span lang="ko" className="onb-primer-jamo-glyph">{BLOCK}</span><span className="onb-primer-jamo-sound">{BLOCK_SOUND}</span></span>
          <span className="onb-primer-word">
            <span lang="ko" className="onb-primer-word-text">{BLOCK_WORD}</span>
            <span className="onb-primer-word-sound">{BLOCK_WORD_SOUND}</span>
            <span className="onb-primer-word-meaning"><Trans {...msg({ context: 'onboarding.primer.block.meaning', message: 'Korea' })} /></span>
          </span>
        </div>
      </section>
      <JamoGrid items={HANGUL_CONSONANTS} count={HANGUL_CONSONANTS.length} label={_(msg({ context: 'onboarding.primer.consonants', message: 'Basic consonants' }))} />
      <JamoGrid items={HANGUL_VOWELS} count={HANGUL_VOWELS.length} label={_(msg({ context: 'onboarding.primer.vowels', message: 'Basic vowels' }))} />
    </div>
  </div>;
}
