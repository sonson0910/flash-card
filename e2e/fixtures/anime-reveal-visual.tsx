import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import '../../src/index.css';
import { AnimeReveal, type AnimeRevealEventKind, type AnimeRevealSourcePayload } from '../../src/features/rewards/AnimeReveal';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';

// The sample card is from the Canvas board; reward labels follow the approved
// server outcome that the production ceremony displays.
const canvasImage = new URL('../../docs/design/sonflash-redesign/canvas/assets/blob/4e8348b18995828a6faaee433ba17ccd.jpg', import.meta.url).href;
const canvasPayloads: Record<AnimeRevealEventKind, AnimeRevealSourcePayload> = {
  tierup: {
    headword: 'Instant', translation: 'Khoảnh khắc', imageUrl: canvasImage,
    previousValue: 'new', currentValue: 'mastered',
  },
  streak: {
    currentValue: '30',
  },
  levelup: {
    previousValue: '12', currentValue: '13',
  },
};

function AnimeRevealFixture() {
  const locale = useUiLocale();
  const { _ } = useLingui();
  const [ready, setReady] = useState(false);
  const requested = new URLSearchParams(location.search).get('event');
  const event: AnimeRevealEventKind = requested === 'streak' || requested === 'levelup' ? requested : 'tierup';

  useEffect(() => { void Promise.all([loadCatalog(locale, 'rewards'), loadCatalog(locale, 'shell')]).then(() => setReady(true)); }, [locale]);
  if (!ready) return null;
  const rewardLabels = event === 'streak' ? [
    _(msg({ id: 'rewards.reveal.streak.badge', message: 'Web Wanderer' })),
    _(msg({ id: 'rewards.reveal.streak.freeze', message: 'Streak freeze · limit 1' })),
  ] : event === 'levelup' ? [
    _(msg({ id: 'rewards.reveal.level.frame', message: 'Crimson Wing frame' })),
    _(msg({ id: 'rewards.reveal.level.title', message: 'Word Collector title' })),
    _(msg({ id: 'rewards.reveal.level.hint', message: 'Hint tokens · limit 3' })),
  ] : undefined;

  return <main data-anime-reveal-visual-view={event}>
    <AnimeReveal
      open
      event={event}
      payload={{ ...canvasPayloads[event], rewardLabels }}
      onContinue={() => undefined}
      onLater={() => undefined}
      onEquip={async () => undefined}
      reducedMotion
    />
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider><I18nProvider><AnimeRevealFixture /></I18nProvider></ThemeProvider>,
);
