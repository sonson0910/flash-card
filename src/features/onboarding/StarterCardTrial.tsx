import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { lazy, Suspense, useState } from 'react';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import type { CardData } from '../../types/card';

let cardFace: Promise<{ default: typeof import('../../components/Flashcard').Flashcard }> | undefined;

/**
 * Loads the library card the trial shows, with its styles and catalog, once a learner asks for starter cards. The
 * import settles only after the card's stylesheet has loaded, which the journey waits for before showing the trial.
 */
export const loadStarterCardFace = () => cardFace ??= Promise.all([
  import('../../components/Flashcard'), loadCatalog(getActiveUiLocale(), 'components'),
]).then(([module]) => ({ default: module.Flashcard }), (error: unknown) => {
  cardFace = undefined;
  throw error;
});

const Flashcard = lazy(loadStarterCardFace);

export type TrialGrade = 'known' | 'again';

export interface StarterCardTrialProps {
  /** The starter cards the server actually wrote to the learner's library. */
  readonly cards: readonly CardData[];
  /** The journey's step line, shown above the heading. */
  readonly eyebrow?: ReactNode;
  /** True when the native language changed after these cards were written, so their meanings still follow the earlier choice. */
  readonly meaningsFollowEarlierLanguage?: boolean;
}

const accent = { 0: <em className="onb-accent" /> };
const gradingHeading = msg({ context: 'onboarding.trial.heading', message: 'Flip each card, then <0>grade yourself.</0>' });
const gradingBody = msg({ context: 'onboarding.trial.body', message: 'Turn the card to see its meaning. These cards are already in your library.' });

/** The two self-grades. Without `onGrade` they are laid out unseen, only to hold their room. */
function GradeButtons({ onGrade }: { readonly onGrade?: (value: TrialGrade) => void }) {
  const { _ } = useLingui();
  const group = onGrade
    ? { className: 'onb-trial-grade', role: 'group', 'aria-label': _(msg({ context: 'onboarding.trial.grade-label', message: 'Did you know this word?' })) }
    : { className: 'onb-trial-grade onb-trial-reserve', 'aria-hidden': true };
  return <div {...group}>
    <button type="button" className="onb-trial-again fx-press crystal-chamfer-sm" onClick={() => onGrade?.('again')}>
      <RotateCcw aria-hidden="true" size={16} />
      <Trans {...msg({ context: 'onboarding.trial.again', message: 'Forgot' })} />
    </button>
    <button type="button" className="onb-trial-known fx-press crystal-chamfer-sm" onClick={() => onGrade?.('known')}>
      <Check aria-hidden="true" size={16} />
      <Trans {...msg({ context: 'onboarding.trial.known', message: 'Got it' })} />
    </button>
  </div>;
}

/**
 * A first pass over the starter cards on the real flashcard: the learner flips
 * each card and says whether they knew it. The grades only drive this summary;
 * they are the learner's own answers and are never stored as reviews.
 */
export function StarterCardTrial({ cards, eyebrow, meaningsFollowEarlierLanguage = false }: StarterCardTrialProps) {
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
          : <Trans {...gradingHeading} components={accent} />}
      </h2>
      <p className="onb-subtitle">
        {done
          ? <Trans {...msg({ context: 'onboarding.trial.result-body', message: 'All {total} cards are already in your library, ready for your first review.' })} values={{ total: cards.length }} />
          : <Trans {...gradingBody} />}
      </p>
      {meaningsFollowEarlierLanguage && <p className="onb-subtitle" data-testid="starter-meanings-note">
        <Trans {...msg({ context: 'onboarding.trial.meanings-language-note', message: 'The meanings on these cards follow the language you chose when they were added.' })} />
      </p>}
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
      {!done && <GradeButtons onGrade={grade} />}
    </div>

    <ul className="onb-trial-list fx-stagger" aria-label={_({ ...msg({ context: 'onboarding.trial.list-label', message: 'Your first {total} cards' }), values: { total: cards.length } })}>
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

export interface StarterCardTrialLoadingProps {
  /** How many starter cards are being written; the word row keeps a tile for each. */
  readonly count: number;
  /** The journey's step line, shown above the heading. */
  readonly eyebrow?: ReactNode;
  /** The heading shown until the cards arrive. */
  readonly heading: ReactNode;
  /** The progress line, shown where the card position will be. */
  readonly status: ReactNode;
}

/**
 * The trial's frame while the server writes the starter cards. It takes the room the trial will take, with the
 * trial's own heading, instructions and grades laid out unseen, so the journey footer under it stays where it is
 * when the cards arrive rather than moving away from a tap in progress.
 */
export function StarterCardTrialLoading({ count, eyebrow, heading, status }: StarterCardTrialLoadingProps) {
  return <div className="onb-trial" data-state="loading">
    <div className="onb-trial-head">
      {eyebrow}
      <div className="onb-trial-intro">
        <div className="onb-trial-reserve" aria-hidden="true">
          <h2 className="onb-title onb-title--compact"><Trans {...gradingHeading} components={accent} /></h2>
          <p className="onb-subtitle"><Trans {...gradingBody} /></p>
        </div>
        <h2 className="onb-title onb-title--compact">{heading}</h2>
      </div>
    </div>

    <div className="onb-trial-deck">
      <p className="onb-trial-count" role="status">{status}</p>
      <div className="onb-trial-card"><div className="onb-trial-card-loading" aria-hidden="true" /></div>
      <GradeButtons />
    </div>

    <ul className="onb-trial-list fx-stagger" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <li key={index} className="onb-trial-word crystal-chamfer-sm" data-state="pending" />)}
    </ul>
  </div>;
}
