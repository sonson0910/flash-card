import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpeechMatchFeedback } from './SpeechMatchFeedback';

describe('SpeechMatchFeedback', () => {
  it('labels word checks and states the browser matching limitation', () => {
    const html = renderToStaticMarkup(
      <SpeechMatchFeedback
        value={{ score: 82, confidence: 0.9, transcript: 'resilient', type: 'word' }}
        target="resilient"
      />,
    );

    expect(html).toContain('Word match: 82%');
    expect(html).toContain('checks whether the intended words were recognised');
    expect(html).toContain('does not assess individual sounds, phonemes, or accent');
    [
      'Pronunciation match',
      'Natural and accurate pronunciation',
      'Emphasize the stress',
      'Pronounce the ending',
      'repeat each syllable',
      'Fluency:',
      'Prosody:',
      'Intonation:',
      'Native-like',
    ].forEach(claim => expect(html).not.toContain(claim));
  });

  it('labels explanation checks as sentence matches', () => {
    const html = renderToStaticMarkup(
      <SpeechMatchFeedback
        value={{ score: 71, confidence: 0.8, transcript: 'A clear explanation', type: 'explanation' }}
        target="A clear explanation"
      />,
    );

    expect(html).toContain('Sentence match: 71%');
  });
});
