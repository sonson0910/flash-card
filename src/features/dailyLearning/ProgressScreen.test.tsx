import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressScreen } from './ProgressScreen';
import type { ProgressScreenModel } from './dailyLearningPresentation';

i18n.load('en', {});
i18n.activate('en');

const model: ProgressScreenModel = {
  status: 'ready',
  message: 'Progress is calculated from your learning history.',
  reviewed: 12,
  mastered: 4,
  dueToday: 0,
  isOffline: false,
  hasVocabulary: true,
};

describe('ProgressScreen', () => {
  it('places ready learning insights before the saved-progress summary', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ProgressScreen model={model} actions={{ startReview: () => undefined, openVocabulary: () => undefined }}><div data-testid="progress-insights">Charts</div></ProgressScreen></I18nProvider>);

    expect(html.indexOf('data-testid="progress-insights"')).toBeLessThan(html.indexOf('progress-summary-heading'));
  });
});
