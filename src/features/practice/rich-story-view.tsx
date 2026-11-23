import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check } from 'lucide-react';
import { useState } from 'react';
import type { StoryInfo } from '../../lib/wordInfo';

export const normalizeGrammarAnswer = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export const isGrammarAnswerCorrect = (answer: string, acceptedAnswer: string): boolean => (
  Boolean(answer.trim()) && normalizeGrammarAnswer(answer) === normalizeGrammarAnswer(acceptedAnswer)
);

export const isComprehensionAnswerCorrect = (selectedIndex: number, correctIndex: number): boolean => (
  selectedIndex === correctIndex
);

/**
 * The exercises that follow a structured story: its target phrases, a comprehension check,
 * a grammar transformation and a retell draft. Callers key it by story so a new story starts
 * with empty answers.
 */
export function RichStoryExercises({ story }: { story: StoryInfo }) {
  const { i18n } = useLingui();
  const _ = (descriptor: ReturnType<typeof msg>, values?: Record<string, unknown>) => i18n._(descriptor.id, values, { message: descriptor.message });
  const [selectedComprehension, setSelectedComprehension] = useState<number | null>(null);
  const [grammarAnswer, setGrammarAnswer] = useState('');
  const [grammarChecked, setGrammarChecked] = useState(false);
  const [retellDraft, setRetellDraft] = useState('');
  const comprehensionCorrect = selectedComprehension !== null
    && isComprehensionAnswerCorrect(selectedComprehension, story.comprehension.correctIndex);
  const grammarCorrect = isGrammarAnswerCorrect(grammarAnswer, story.grammar.acceptedAnswer);

  return (
    <div className="practice-story__exercises">
      <section aria-labelledby="story-targets-heading" className="practice-story__exercise">
        <h3 id="story-targets-heading" className="practice-story__exercise-title"><Trans {...msg({ context: 'rich-story-view.target-phrases', message: 'Target phrases' })} /></h3>
        <ul className="practice-story__phrases" aria-label={_(msg({ id: 'rich-story-view.target-phrases-from-your-vocabulary', message: 'Target phrases from your vocabulary' }))}>
          {story.targetPhrases.map(phrase => <li key={phrase} className="crystal-chamfer-sm">{phrase}</li>)}
        </ul>
      </section>

      <section aria-labelledby="story-comprehension-heading" className="practice-story__exercise">
        <fieldset>
          <legend id="story-comprehension-heading" className="practice-story__exercise-title"><Trans {...msg({ context: 'rich-story-view.check-understanding', message: 'Check understanding' })} /></legend>
          <p className="practice-story__question">{story.comprehension.question}</p>
          <div className="practice-story__choices">
            {story.comprehension.options.map((option, index) => (
              <label key={option} className="practice-story__choice crystal-chamfer-sm">
                <input type="radio" name="story-comprehension" value={index} checked={selectedComprehension === index} onChange={() => setSelectedComprehension(index)} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {selectedComprehension !== null ? (
          <p role="status" aria-live="polite" className="practice-story__result" data-outcome={comprehensionCorrect ? 'correct' : 'wrong'}>
            {comprehensionCorrect ? <Check size={17} aria-hidden="true" /> : null}
            <span>
              {comprehensionCorrect
                ? _(msg({ id: 'practice.rich-story.correct', message: 'Correct.' }))
                : _(msg({ id: 'practice.rich-story.not-quite', message: 'Not quite.' }))} {story.comprehension.explanationVi}
            </span>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="story-grammar-heading" className="practice-story__exercise">
        <h3 id="story-grammar-heading" className="practice-story__exercise-title"><Trans {...msg({ context: 'rich-story-view.grammar-transformation', message: 'Grammar transformation:' })} /> {story.grammar.label}</h3>
        <p lang="vi" className="practice-story__note">{story.grammar.explanationVi}</p>
        <p className="practice-story__source crystal-chamfer-sm">{story.grammar.sourceSentence}</p>
        <form onSubmit={event => { event.preventDefault(); setGrammarChecked(true); }} className="practice-story__form">
          <label htmlFor="story-grammar-answer" className="practice-story__label">{story.grammar.prompt}</label>
          <input id="story-grammar-answer" value={grammarAnswer} onChange={event => { setGrammarAnswer(event.target.value); setGrammarChecked(false); }} className="practice-story__field crystal-chamfer-sm focus-visible:outline-2" autoComplete="off" />
          <button type="submit" className="practice-secondary crystal-chamfer-sm min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2"><Trans {...msg({ context: 'rich-story-view.check-grammar', message: 'Check grammar' })} /></button>
        </form>
        {grammarChecked ? (
          <p role="status" aria-live="polite" className="practice-story__result" data-outcome={grammarCorrect ? 'correct' : 'wrong'}>
            {grammarCorrect
              ? _(msg({ id: 'practice.rich-story.correct', message: 'Correct.' }))
              : _(msg({ id: 'practice.rich-story.grammar-retry', message: 'Try again. One accepted answer is “{answer}”.' }), { answer: story.grammar.acceptedAnswer })}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="story-retell-heading" className="practice-story__exercise">
        <h3 id="story-retell-heading" className="practice-story__exercise-title"><Trans {...msg({ context: 'rich-story-view.retell-in-your-own-words', message: 'Retell in your own words' })} /></h3>
        <label htmlFor="story-retell-draft" className="practice-story__label">{story.retellPrompt}</label>
        <textarea id="story-retell-draft" value={retellDraft} onChange={event => setRetellDraft(event.target.value)} rows={4} className="practice-story__field crystal-chamfer-sm focus-visible:outline-2" />
        <p className="practice-story__note"><Trans {...msg({ context: 'rich-story-view.this-draft-stays-on-this-screen-and-is-not-submitted', message: 'This draft stays on this screen and is not submitted.' })} /></p>
      </section>
    </div>
  );
}
