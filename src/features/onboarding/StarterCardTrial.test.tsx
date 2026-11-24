import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { StarterCardTrial, StarterCardTrialLoading } from './StarterCardTrial';

i18n.load('en', {});
i18n.activate('en');

const card = (word: string, translation: string): CardData => ({
  id: `starter-${word}`, word, translation, explanation: '', phonetic: '', emoji: '📝', category: 'greetings',
  audioUrl: null, imageUrl: null, language: 'ko', translationLanguage: 'vi', origin: 'manual', bookmarked: false, difficulty: 'unrated',
});

const cards = [card('안녕하세요', 'xin chào'), card('감사합니다', 'cảm ơn'), card('물', 'nước')];
const visibleText = (html: string) => html.replace(/<[^>]+>/g, '');

describe('StarterCardTrial', () => {
  it('opens on the first real starter card with both self-grades and an ungraded tally', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><StarterCardTrial cards={cards} eyebrow={<p>Step 6 of 7</p>} /></I18nProvider>);
    const text = visibleText(html);

    expect(text).toContain('Step 6 of 7');
    expect(text).toContain('Flip each card, then grade yourself.');
    expect(text).toContain('Card 1 of 3');
    expect(html).toContain('role="group" aria-label="Did you know this word?"');
    expect(text).toContain('Forgot');
    expect(text).toContain('Got it');
    expect(html).toContain('aria-label="Your first 3 cards"');
    expect(html.match(/data-state="pending"/g)).toHaveLength(3);
    for (const { word } of cards) expect(html).toContain(`<span lang="ko" class="onb-trial-word-text">${word}</span>`);
  });

  it('loads the library card lazily instead of drawing its own', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><StarterCardTrial cards={cards} /></I18nProvider>);

    expect(html).toContain('onb-trial-card-loading');
    expect(html).not.toContain('xin chào');
  });

  it('holds the trial layout while the cards are written, showing only what is already true', () => {
    const loading = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <StarterCardTrialLoading count={5} eyebrow={<p>Step 7 of 8</p>} heading="Adding your first cards" status="Adding your cards…" />
    </I18nProvider>);
    const trial = renderToStaticMarkup(<I18nProvider i18n={i18n}><StarterCardTrial cards={cards} /></I18nProvider>);
    const intro = trial.match(/<h2 class="onb-title onb-title--compact">.*?<\/p>/)?.[0];
    const grades = (html: string) => html.match(/<div class="onb-trial-grade[^>]*>(.*?)<\/div>/)?.[1];

    // The trial's heading, instructions and grades take their room unseen and unannounced until the cards exist.
    expect(intro).toContain('Flip each card, then');
    expect(loading).toContain(`<div class="onb-trial-reserve" aria-hidden="true">${intro}</div>`);
    expect(loading).toContain('<div class="onb-trial-grade onb-trial-reserve" aria-hidden="true">');
    expect(grades(trial)).toContain('Got it');
    expect(grades(loading)).toBe(grades(trial));
    expect(loading).not.toContain('role="group"');
    // What shows is the loading heading and progress, the card's own placeholder and a tile per card on its way.
    expect(loading).toContain('<h2 class="onb-title onb-title--compact">Adding your first cards</h2>');
    expect(loading).toContain('<p class="onb-trial-count" role="status">Adding your cards…</p>');
    expect(loading).toContain('<div class="onb-trial-card"><div class="onb-trial-card-loading" aria-hidden="true"></div></div>');
    expect(loading.match(/<li class="onb-trial-word crystal-chamfer-sm" data-state="pending"><\/li>/g)).toHaveLength(5);
  });

  it('notes that meanings follow the earlier language only when the native language changed after the cards were written', () => {
    const render = (props: { meaningsFollowEarlierLanguage?: boolean }) => visibleText(renderToStaticMarkup(
      <I18nProvider i18n={i18n}><StarterCardTrial cards={cards} {...props} /></I18nProvider>));
    const note = 'The meanings on these cards follow the language you chose when they were added.';

    expect(render({})).not.toContain(note);
    expect(render({ meaningsFollowEarlierLanguage: false })).not.toContain(note);
    expect(render({ meaningsFollowEarlierLanguage: true })).toContain(note);
  });
});
