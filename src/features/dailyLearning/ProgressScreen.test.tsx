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

  it.each([
    [{ ...model, dueToday: 3, isOffline: true }, 'Review 3 due words'],
    [{ ...model, status: 'empty' as const, isOffline: true }, 'Start your first review'],
  ])('disables the offline review action: %s', (offlineModel, label) => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><ProgressScreen model={offlineModel} actions={{ startReview: () => undefined, openVocabulary: () => undefined }} /></I18nProvider>);

    expect(html).toContain(label);
    expect(html).toContain('disabled=""');
    expect(html).toContain('You’re offline. Reconnect to review and save your progress.');
  });
});
