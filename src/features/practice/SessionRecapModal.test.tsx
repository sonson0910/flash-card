import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { messages as enPractice } from '../../i18n/locales/en/practice.po';
import type { CardData } from '../../types/card';
import { SessionRecapModal, type SessionRecapPromotion } from './SessionRecapModal';

const source = readFileSync(new URL('./SessionRecapModal.tsx', import.meta.url), 'utf8');

// The real Portal renders nothing without a DOM; render the dialog parts in place.
vi.mock('@radix-ui/react-dialog', () => {
  const part = ({ children, asChild: _asChild, ...rest }: { children?: ReactNode; asChild?: boolean } & Record<string, unknown>) => <div {...rest}>{children}</div>;
  return { Root: ({ children }: { children?: ReactNode }) => <>{children}</>, Portal: part, Overlay: part, Content: part, Close: part, Title: part, Description: part };
});

const theme = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: theme.family, mode: 'dark', setMode: () => undefined, setFamily: () => undefined }) }));
vi.mock('./session-recap-service', () => ({ loadTomorrowDueCount: () => new Promise<number>(() => undefined) }));

i18n.load('en', enPractice);
i18n.activate('en');

const card = (id: string, word: string, translation: string): CardData => ({
  id, word, normalizedWord: word, translation, explanation: '', phonetic: '', emoji: '', category: 'Test', audioUrl: null, imageUrl: null, language: 'en',
} as CardData);

const promotions: SessionRecapPromotion[] = [
  { card: card('instant', 'instant', 'khoảnh khắc'), from: 'learning', to: 'mastered' },
  { card: card('immediate', 'immediate', 'ngay lập tức'), from: 'new', to: 'learning' },
];

const render = (props: Partial<Parameters<typeof SessionRecapModal>[0]> = {}) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>
    <SessionRecapModal
      open
      onClose={() => undefined}
      onRetryWeak={() => undefined}
      onViewWeeklyRecap={() => undefined}
      totalCards={12}
      goodCount={10}
      againCount={2}
      xpEarned={175}
      weakCards={[card('nuance', 'nuance', 'sắc thái'), card('resilient', 'resilient', 'kiên cường')]}
      {...props}
    />
  </I18nProvider>,
);

describe('SessionRecapModal', () => {
  it('lays out the classic recap: count headline, promoted cards, four results and three actions', () => {
    theme.family = 'classic';
    const html = render({ promotions, streakDays: 13, returnsToToday: true });
    expect(html).toContain('data-session-recap="true"');
    expect(html).toContain('Session complete');
    expect(html).toMatch(/words, <em>locked in\.<\/em>/);
    expect(html).toContain('You remembered 10 of 12, and 2 words moved up a level.');
    expect(html).toContain('aria-label="Words that moved up a level"');
    expect(html.match(/class="practice-recap-card"/g)).toHaveLength(2);
    expect(html).toContain('Moved from Learning to Mastered');
    expect(html).toContain('+1 level');
    expect(html).toContain('aria-label="10 remembered, 2 to revisit"');
    expect(html).toContain('+1 today');
    expect(html).toContain('Tomorrow');
    expect(html).toContain('Checking cards due…');
    expect(html).toContain('Back to Today');
    expect(html).toContain('Retry the 2 missed words');
    expect(html).toContain('View weekly recap');
    expect(html).not.toMatch(/IELTS|band|Pro\b|Claim/i);
  });

  it('leaves out results it has no source for', () => {
    theme.family = 'classic';
    const html = render({ weakCards: [], onRetryWeak: undefined });
    expect(html).toContain('You remembered 10 of 12.');
    expect(html).not.toContain('practice-recap-cards');
    expect(html).not.toContain('Streak');
    expect(html).not.toContain('Retry the');
    expect(html).toContain('Continue learning');
  });

  it('lays out the Crystal recap with stat tiles, glowed-up cards, words to revisit and what comes next', () => {
    theme.family = 'crystal';
    const html = render({ promotions, streakDays: 13, bestRun: 9 });
    expect(html).toContain('data-family="crystal"');
    expect(html).toMatch(/Day 13.*Session complete/);
    expect(html).toContain('All done!');
    expect(html).toContain('Best combo');
    expect(html).toContain('×9');
    expect(html).toContain('10 of 12 remembered');
    expect(html).toContain('Cards glowed up');
    expect(html).toContain('Moved from Bloom to Star');
    expect(html).toContain('To revisit');
    expect(html).toContain('lang="en">nuance</li>');
    expect(html).toContain('Review misses');
    expect(html).toContain('What next');
    expect(html).toContain('Continue learning');
  });

  it('counts up the saved cards, accuracy and XP in the order each board reads them', () => {
    const expected = { classic: ['12', '83%', '175'], crystal: ['83%', '175', '12'] } as const;
    for (const family of ['classic', 'crystal'] as const) {
      theme.family = family;
      const html = render({ promotions });
      const counts = [...html.matchAll(/data-count-up="true" aria-hidden="true">[^<]*<\/span><span class="sr-only">([^<]+)<\/span>/g)].map(match => match[1]);
      expect(counts, family).toEqual(expected[family]);
    }
  });

  it('shows the proud Lumi pose only for Crystal Star when enabled', () => {
    expect(source).toContain("const isCrystal = family === 'crystal'");
    expect(source).toContain('readLumiEnabled()');
    expect(source).toContain('<Lumi pose="proud"');
  });

  it('celebrates reaching the recap once through the shared, already-gated sound/haptic helpers', () => {
    // The sound-off/haptics-off/reduced-motion gating itself is covered where those helpers
    // live: haptics.test.ts, interactionSounds.test.ts and motion.test.ts.
    expect(source).toContain("import { triggerHaptic } from '../../lib/haptics'");
    expect(source).toContain("import { playRewardSound } from '../../lib/interactionSounds'");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(!open \|\| !complete\) return;\s*playRewardSound\(\);\s*triggerHaptic\('success'\);/);
    expect(source).not.toContain('navigator.vibrate');
  });

  it('gives the recap a GSAP entrance that collapses under reduced motion', () => {
    expect(source).toContain('<Dialog.Content asChild');
    expect(source).toContain('<GsapEntrance');
    expect(source).toContain('variant="result"');
  });
});
