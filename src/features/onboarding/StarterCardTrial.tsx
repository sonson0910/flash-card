import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { lazy, Suspense, useState } from 'react';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import type { CardData } from '../../types/card';

// The trial shows the library's own card, so its chunk and its catalog load only once a learner reaches it.
const Flashcard = lazy(() => Promise.all([
  import('../../components/Flashcard'), loadCatalog(getActiveUiLocale(), 'components'),
]).then(([module]) => ({ default: module.Flashcard })));

export type TrialGrade = 'known' | 'again';

export interface StarterCardTrialProps {
  /** The starter cards the server actually wrote to the learner's library. */
  readonly cards: readonly CardData[];
  /** The journey's step line, shown above the heading. */
  readonly eyebrow?: ReactNode;
}

const accent = { 0: <em className="onb-accent" /> };

/**
 * A first pass over the starter cards on the real flashcard: the learner flips
 * each card and says whether they knew it. The grades only drive this summary;
 * they are the learner's own answers and are never stored as reviews.
 */
export function StarterCardTrial({ cards, eyebrow }: StarterCardTrialProps) {
  const { _ } = useLingui();
  const [grades, setGrades] = useState<Readonly<Partial<Record<string, TrialGrade>>>>({});
  const graded = cards.filter(card => grades[card.id]).length;
  const done = graded >= cards.length;
  const current = cards[Math.min(graded, cards.length - 1)];
  const known = cards.filter(card => grades[card.id] === 'known').length;
  const grade = (value: TrialGrade) => {
    if (!current || done) return;
    setGrades(previous => ({ ...previous, [current.id]: value }));
  };

  return <div className="onb-trial" data-state={done ? 'done' : 'grading'}>
    <div className="onb-trial-head">
      {eyebrow}
      <h2 className="onb-title onb-title--compact">
        {done
          ? <Trans {...msg({ context: 'onboarding.trial.result', message: '<0>{known} of {total}</0> remembered.' })} values={{ known, total: cards.length }} components={accent} />
          : <Trans {...msg({ context: 'onboarding.trial.heading', message: 'Flip each card, then <0>grade yourself.</0>' })} components={accent} />}
      </h2>
      <p className="onb-subtitle">
        {done
          ? <Trans {...msg({ context: 'onboarding.trial.result-body', message: 'All {total} cards are already in your library, ready for your first review.' })} values={{ total: cards.length }} />
          : <Trans {...msg({ context: 'onboarding.trial.body', message: 'Turn the card to see its meaning. These cards are already in your library.' })} />}
      </p>
    </div>

    <div className="onb-trial-deck">
      <p className="onb-trial-count" aria-live="polite">
        <Trans {...msg({ context: 'onboarding.trial.position', message: 'Card {position} of {total}' })} values={{ position: Math.min(graded + 1, cards.length), total: cards.length }} />
      </p>
      <div className="onb-trial-card">
        <Suspense fallback={<div className="onb-trial-card-loading" aria-hidden="true" />}>
          {current && <Flashcard key={current.id} data={current} />}
        </Suspense>
      </div>
      {!done && <div className="onb-trial-grade" role="group" aria-label={_(msg({ context: 'onboarding.trial.grade-label', message: 'Did you know this word?' }))}>
        <button type="button" className="onb-trial-again crystal-chamfer-sm" onClick={() => grade('again')}>
          <RotateCcw aria-hidden="true" size={16} />
          <Trans {...msg({ context: 'onboarding.trial.again', message: 'Forgot' })} />
        </button>
        <button type="button" className="onb-trial-known crystal-chamfer-sm" onClick={() => grade('known')}>
          <Check aria-hidden="true" size={16} />
          <Trans {...msg({ context: 'onboarding.trial.known', message: 'Got it' })} />
        </button>
      </div>}
    </div>

    <ul className="onb-trial-list" aria-label={_({ ...msg({ context: 'onboarding.trial.list-label', message: 'Your first {total} cards' }), values: { total: cards.length } })}>
      {cards.map(card => {
        const state: TrialGrade | 'pending' = grades[card.id] ?? 'pending';
        return <li key={card.id} className="onb-trial-word crystal-chamfer-sm" data-state={state}>
          <span lang={card.language || undefined} className="onb-trial-word-text">{card.word}</span>
          <span className="onb-trial-word-state">
            {state === 'known' && <Trans {...msg({ context: 'onboarding.trial.state.known', message: 'Got it' })} />}
            {state === 'again' && <Trans {...msg({ context: 'onboarding.trial.state.again', message: 'Again' })} />}
            {state === 'pending' && <Trans {...msg({ context: 'onboarding.trial.state.pending', message: 'Not yet' })} />}
          </span>
        </li>;
      })}
    </ul>
  </div>;
}
