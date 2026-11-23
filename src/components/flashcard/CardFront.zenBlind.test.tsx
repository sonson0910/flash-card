import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { CardFront } from './CardFront';

vi.mock('../../features/account/accountDataService', () => ({ isAccountSignedIn: () => false }));
i18n.load('en', {});
i18n.activate('en');

const card = {
  id: 'zen-blind', word: 'luminous', translation: 'phát sáng', explanation: 'Giving off light.',
  phonetic: '/ˈluːmɪnəs/', emoji: '✨', category: 'Science', audioUrl: null, imageUrl: null,
} as CardData;

const ref = { current: null };
const renderFront = (isBlindMode: boolean) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>
    <CardFront
      isZenMode tier="new" data={card} faceRef={ref} spotlightRef={ref} spotlightBackground="" isHovered={false}
      supportedImageUrl={null} imagePriority={false} isBlindMode={isBlindMode} showReading={false}
      toggleShowReading={vi.fn()} audioSpeed={1} toggleAudioSpeed={vi.fn()} playAudio={vi.fn()}
      playExplanationAudio={vi.fn()} isPlayingAudio={false} isRecording={false} recordingTarget={null}
      startPronunciationCheck={vi.fn()} pronunciationScore={null} pronunciationError={null}
      showQuickQuiz={false} setShowQuickQuiz={vi.fn()} customDecks={[]} showDeckSelector={false}
      setShowDeckSelector={vi.fn()} deckButtonRef={ref} frontFlipRef={ref} focusAfterFlipRef={{ current: null }}
      showCardSide={vi.fn()}
    />
  </I18nProvider>,
);

describe('Zen Glass card front in blind mode', () => {
  it('shows the definition normally when hints are visible', () => {
    const html = renderFront(false);
    expect(html).toContain('Giving off light.');
    expect(html).not.toContain('aria-hidden="true">Giving off light.');
  });

  it('hides the definition from view and from assistive technology when hints are hidden', () => {
    const html = renderFront(true);
    expect(html).toMatch(/<p[^>]*aria-hidden="true"[^>]*>Giving off light\.<\/p>/);
    expect(html).toContain('Definition hidden');
  });
});
