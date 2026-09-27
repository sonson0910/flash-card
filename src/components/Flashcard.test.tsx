import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Flashcard } from './Flashcard';

const accountSession = vi.hoisted(() => ({ signedIn: false }));
vi.mock('../features/account/accountDataService', () => ({
  isAccountSignedIn: () => accountSession.signedIn,
}));

const cardSurfaceSource = ['./Flashcard.tsx', './flashcard/CardFront.tsx', './flashcard/CardBack.tsx']
  .map(path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'))
  .join('\n');
i18n.load('en', {});
i18n.activate('en');
const renderCard = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const effectCard = {
  id: 'canvas-effects-contract',
  word: 'luminous',
  translation: 'phát sáng',
  explanation: 'Giving off light.',
  phonetic: '/ˈluːmɪnəs/',
  emoji: '✨',
  category: 'Science',
  audioUrl: null,
  imageUrl: null,
  origin: 'ai' as const,
  difficulty: 'easy' as const,
};

describe('Flashcard mobile controls', () => {
  it('keeps the Canvas effect hooks on the live card and preserves edit lifecycle callbacks', () => {
    const html = renderCard(
      <Flashcard
        data={effectCard}
        onToggleBookmark={vi.fn()}
        onUpdateCard={vi.fn()}
        onEditOpenChange={vi.fn()}
      />,
    );
    const source = cardSurfaceSource;

    expect(html).toContain('data-card-effects="tilt spotlight aura flip star blind audio tier-rim hover-wings"');
    expect(html).toContain('data-card-effect="hover-wings"');
    expect(html).toContain('data-card-effect="star-pop"');
    expect(html).toContain('data-card-effect="blind-image"');
    expect(html).toContain('data-card-effect="audio"');
    expect(source).toContain('onEditOpenChange?: (open: boolean) => void;');
    expect(source).toContain('onOpenChange={setEditDialogOpen}');
  });

  it('renders the revealed face with Canvas effect layers and disclosure actions', () => {
    const html = renderCard(
      <Flashcard
        data={effectCard}
        initialSide="back"
        onUpdateCard={vi.fn()}
      />,
    );

    expect(html).toContain('data-card-face="back"');
    expect(html).toContain('data-card-effect="spotlight"');
    expect(html).toContain('data-card-effect="holo"');
    expect(html).toContain('data-card-effect="specular"');
    expect(html).toContain('data-card-effect="tier-rim"');
    expect(html).toContain('data-ai-disclosure="true"');
  });

  it('keeps Crystal wings and reduced motion as local card-only styles', () => {
    const canvasStyles = readFileSync(fileURLToPath(new URL('./flashcard/flashcard-canvas.css', import.meta.url)), 'utf8');

    expect(canvasStyles).toContain(':root[data-theme-family="crystal"]');
    expect(canvasStyles).toContain('.flashcard-hover-wings');
    expect(canvasStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(canvasStyles).toContain('html[data-motion="reduced"] .flashcard-hover-wings');
  });

  it('groups pronunciation controls with the front action dock', () => {
    const source = cardSurfaceSource;

    expect(source).toContain('mt-4 flex flex-wrap items-center gap-1 border-t');
    expect(source).toContain('flex items-center rounded-full border border-slate-200/90 bg-slate-100/90 p-1');
  });

  it('keeps explanation and memory hook visible while only secondary tools are disclosed', () => {
    const html = renderCard(
      <Flashcard
        data={{
          id: 'order-check',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          explanationTranslation: 'Một lời giải thích rõ ràng.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
          mnemonic: 'Think of a camera lens.',
        }}
        initialSide="back"
      />,
    );

    const meaning = html.indexOf('data-card-section="meaning"');
    const explanation = html.indexOf('data-card-section="explanation"');
    const memoryHook = html.indexOf('data-card-section="memory-hook"');
    const learningTools = html.indexOf('data-card-disclosure="learning-tools"');

    expect(meaning).toBeGreaterThanOrEqual(0);
    expect(explanation).toBeGreaterThan(meaning);
    expect(memoryHook).toBeGreaterThan(explanation);
    expect(learningTools).toBeGreaterThan(memoryHook);
    expect(html).not.toContain('data-card-disclosure="explanation"');
    expect(html).not.toContain('data-card-disclosure="memory-hook"');
    expect(html).toContain('mnemonic-card mt-3.5 w-full p-4 text-left');
    expect(html).toContain('AI Mnemonic · Memory Hook');
    expect(html).not.toContain('<details open=""');
    expect(html).toContain('data-translation-reveal="true"');
  });

  it('discloses AI-generated content on the revealed side only', () => {
    const html = renderCard(
      <Flashcard
        data={{
          id: 'ai-disclosure',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'Concentrate attention.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
          origin: 'ai',
        }}
        initialSide="back"
      />,
    );

    expect(html).toContain('data-ai-disclosure="true"');
    expect(html).toContain('AI-generated content may be incorrect. Please check the meaning.');
  });

  it('renders markdown emphasis in the memory hook', () => {
    const html = renderCard(
      <Flashcard
        data={{
          id: 'mnemonic-format',
          word: 'brush up on',
          translation: 'ôn tập',
          explanation: 'Review something again.',
          phonetic: '/brʌʃ ʌp ɒn/',
          emoji: '📚',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
          mnemonic: '“Bờ rát úp” — **bờ** tường **rát** nên phải **úp** mặt vào sách để **ôn tập**.',
        }}
        initialSide="back"
      />,
    );

    expect(html).toContain('<strong');
    expect(html).toContain('>bờ</strong>');
    expect(html).not.toContain('**bờ**');
  });

  it('uses the same centered minimal action for returning to English', () => {
    const html = renderCard(
      <Flashcard
        data={{
          id: 'return-action',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
        }}
        initialSide="back"
      />,
    );

    expect(html).toContain('data-return-to-english="true"');
    expect(html).toContain('group/back relative z-20 flex min-h-[60px] w-full');
    expect(html).toContain('items-center justify-center gap-2');
    expect(html).toContain('bg-transparent');
    expect(html).toContain('data-return-hover-edge="true"');
    expect(html).toContain('border-t border-cyan-500/20');
    expect(html).toContain('from-cyan-500/10 via-cyan-400/55 to-cyan-500/10 opacity-75');
    expect(html).not.toContain('Return to “focus”');
  });

  it('renders meaning reveal as a centered unframed secondary action', () => {
    const html = renderCard(
      <Flashcard
        data={{
          id: 'reveal-action',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
        }}
      />,
    );

    expect(html).not.toContain('data-color-role="primary"');
    expect(html).toContain('data-reveal-meaning="true"');
    expect(html).toContain('group/flip relative z-20 flex min-h-[60px] w-full');
    expect(html).toContain('items-center justify-center gap-2');
    expect(html).toContain('bg-transparent');
    expect(html).toContain('border-t border-cyan-500/20');
    expect(html).toContain('data-reveal-hover-edge="true"');
    expect(html).toContain('from-cyan-500/10 via-cyan-400/55 to-cyan-500/10 opacity-75');
    expect(html).toContain('transition-opacity duration-200 group-hover/flip:opacity-100');
    expect(html).toContain('data-reveal-translate-icon="true"');
    expect(html).not.toContain('group-hover/flip:translate-x-0.5');
    expect(html).not.toContain('flashcard-reveal-button');
    expect(html).toContain('text-[10px] font-black uppercase tracking-[0.14em]');
    expect(html).not.toContain('box-border flex-shrink-0 overflow-hidden rounded-b-[31px]');
    expect(html).not.toContain('Flip to the Vietnamese side');
    expect(html).toContain('aria-label="flashcard.reveal-meaning-label"');
  });

  it('keeps the yellow mnemonic hover free of scale and all-property transitions', () => {
    const html = renderCard(
      <Flashcard
        data={{
          id: 'mnemonic-hover',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
        }}
        initialSide="back"
      />,
    );

    expect(html).toContain('data-mnemonic-generate="true"');
    expect(html).toContain('transition-[background-color,box-shadow] duration-200');
    expect(html).not.toContain('hover:scale-[1.02]');
  });

  it('uses restrained metadata and spotlight styling', () => {
    const source = cardSurfaceSource;

    expect(source).toContain('data-card-metadata');
    expect(source).toContain('rgba(2, 132, 199, 0.11)');
    expect(source).toContain('rgba(6, 182, 212, 0.025)');
    expect(source).not.toContain('Meaning revealed');
  });

  it('keeps the refreshed card controls at least 44px on each touch dimension', () => {
    const source = cardSurfaceSource;

    expect(source).not.toMatch(/touch-manipulation flex (?:h-8|size-8|min-h-9)/);
    expect(source).toContain('flex min-h-11 min-w-11 items-center justify-center gap-[3px]');
    expect(source).toContain('relative group inline-flex min-h-11 items-center justify-center');
    expect(source).toContain('touch-manipulation flex min-h-11 min-w-11 shrink-0 items-center justify-center');
    expect(source).toContain('liquid-control flex size-11 shrink-0 items-center justify-center rounded-full');
  });

  it('keeps mnemonic regeneration controls at least 44px on each touch dimension', () => {
    const source = readFileSync(fileURLToPath(new URL('./flashcard/CardMnemonicSection.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('flex size-11 cursor-pointer items-center justify-center');
    expect(source).toContain('mnemonic-generate-button flex min-h-11 w-full');
  });

  const cardFixture = {
    id: 'report-visibility',
    word: 'focus',
    translation: 'tập trung',
    explanation: 'A clear explanation.',
    phonetic: '/ˈfəʊkəs/',
    emoji: '🎯',
    category: 'Study',
    audioUrl: null,
    imageUrl: null,
  } as const;

  it('hides the "Báo thẻ sai" report action from a guest on the revealed (Vietnamese meaning) side', () => {
    accountSession.signedIn = false;

    const back = renderCard(<Flashcard data={cardFixture} initialSide="back" />);

    expect(back).not.toContain('Báo thẻ sai');
  });

  it('shows the "Báo thẻ sai" report action for a signed-in learner on the revealed (Vietnamese meaning) side', () => {
    accountSession.signedIn = true;
    try {
      const back = renderCard(<Flashcard data={cardFixture} initialSide="back" />);

      expect(back).toContain('Report incorrect card');
    } finally {
      accountSession.signedIn = false;
    }
  });
});

describe('Flashcard language presentation', () => {
  it.each(['en', 'ja', 'zh'])('does not add the Korean Hangul breakdown to %s cards', language => {
    const markup = renderCard(<Flashcard data={{
      id: `no-hangul-panel-${language}`,
      word: 'word',
      translation: 'meaning',
      explanation: '',
      phonetic: '',
      emoji: '',
      category: 'General',
      audioUrl: null,
      imageUrl: null,
      language,
    }} initialSide="back" />);

    expect(markup).not.toContain('data-hangul-breakdown');
  });

  it('keeps the Hangul breakdown available beside an unflipped Korean review card, including ko-KR', () => {
    const source = cardSurfaceSource;

    expect(source).toContain("/^ko(?:-|$)/i.test(data.language ?? '')");
    expect(source).toContain("editorContext?.kind === 'review'");
    expect(source).toContain('hangul-breakdown-slot');
    const styles = readFileSync(fileURLToPath(new URL('./flashcard/hangul-breakdown.css', import.meta.url)), 'utf8');
    expect(styles).toContain('left: calc(50% + 310px)');
  });

  it.each(['en', 'vi', 'en-XA', 'ja'])('renders the stored word and language spans with %s UI locale', locale => {
    i18n.load(locale, {});
    i18n.activate(locale);
    try {
      const card = {
        id: `locale-${locale}`,
        word: 'der Apfel',
        translation: 'quả táo',
        explanation: 'A fruit.',
        phonetic: '/ˈapfəl/',
        emoji: '🍎',
        category: 'Food',
        audioUrl: null,
        imageUrl: null,
        language: 'de',
        translationLanguage: 'vi',
      } as const;
      const back = renderCard(<Flashcard data={card} initialSide="back" />);
      const front = renderCard(<Flashcard data={card} initialSide="front" />);

      expect(front).toContain('lang="de"');
      expect(back).toContain('lang="vi"');
      expect(front).toContain('>der Apfel</h2>');
      expect(front).not.toContain('>Der Apfel</h2>');
      expect(back).toContain('>quả táo</h2>');
    } finally {
      i18n.activate('en');
    }
  });
});
