import { decomposeHangulSyllables } from '../../features/languagePacks/hangulRomanization';
import { Trans } from '@lingui/react';
import './hangul-breakdown.css';

export function HangulBreakdown({ word }: { readonly word: string }) {
  const syllables = decomposeHangulSyllables(word);
  if (!syllables.length) return null;

  return (
    <section data-hangul-breakdown aria-labelledby="hangul-breakdown-title" className="hangul-breakdown">
      <p id="hangul-breakdown-title" className="hangul-breakdown__title"><Trans id="flashcard.hangul-breakdown" message="Hangul breakdown" /></p>
      <div className="hangul-breakdown__grid">
        {syllables.map(({ block, parts }, index) => (
          <div key={`${block}-${index}`} className="hangul-breakdown__row">
            <span lang="ko" className="hangul-breakdown__block">{block}</span>
            <span aria-hidden="true" className="hangul-breakdown__equals">=</span>
            <span className="hangul-breakdown__parts">
              {parts.map(part => <span key={part.jamo} className="hangul-breakdown__part"><span lang="ko">{part.jamo}</span><span lang="ko-Latn">{part.romanization || '—'}</span></span>)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
