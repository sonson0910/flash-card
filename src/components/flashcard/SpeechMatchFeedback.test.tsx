import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { messages as viComponents } from '../../i18n/locales/vi/components.po';
import { SPEECH_RECOGNITION_UNSUPPORTED } from '../../lib/speechMessages';
import { localizeSpeechMessage } from './localizeSpeechMessage';
import { SpeechMatchFeedback } from './SpeechMatchFeedback';

i18n.load({ en: {}, vi: viComponents });

const render = (locale: string, node: React.ReactNode) => {
  i18n.activate(locale);
  return renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
};

describe('SpeechMatchFeedback', () => {
  it('labels word checks and states the browser matching limitation', () => {
    const html = render('en',
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
    const html = render('en',
      <SpeechMatchFeedback
        value={{ score: 71, confidence: 0.8, transcript: 'A clear explanation', type: 'explanation' }}
        target="A clear explanation"
      />,
    );

    expect(html).toContain('Sentence match: 71%');
  });

  it('shows the labels and the unsupported-browser message in the Vietnamese catalog', () => {
    const html = render('vi', <SpeechMatchFeedback value={{ score: 90, confidence: 1, transcript: 'hello', type: 'word' }} target="hello" />);
    expect(html).toContain('Khớp từ: 90%');
    expect(html).toContain('Trình duyệt nhận diện: “hello”');
    expect(html).not.toContain('Word match');
    expect(html).not.toContain('Browser recognised');
    expect(localizeSpeechMessage(SPEECH_RECOGNITION_UNSUPPORTED, descriptor => i18n._(descriptor)))
      .toBe('Trình duyệt này không hỗ trợ nhận diện giọng nói. Hãy thử Google Chrome.');
  });

  it('shows an unknown speech error as it came', () => {
    expect(localizeSpeechMessage('not-known', descriptor => i18n._(descriptor))).toBe('not-known');
  });
});
