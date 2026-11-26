import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlashcardProps } from '../../components/Flashcard';
import { CrystalRevealTurn, revealTurnsCard, turnRevealedCard } from './StudyView';

const crystalRoot = { dataset: { themeFamily: 'crystal' } };

const stubMotion = ({ reduced = false, zen = false } = {}) => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'sonflash_zen_glass_mode' && zen ? 'true' : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  vi.stubGlobal('window', globalThis);
};

const cardShell = (side: 'front' | 'back', flipping = 'false') => {
  const click = vi.fn();
  const stage = { click };
  const shell = {
    dataset: { cardSide: side, cardFlipping: flipping },
    querySelector: (selector: string) => (selector === '[data-flashcard-stage]' ? stage : null),
  };
  const studyCard = {
    querySelector: (selector: string) => (selector === '[data-card-side][data-card-flipping]' ? shell : null),
  };
  return { studyCard: studyCard as unknown as Pick<ParentNode, 'querySelector'>, click };
};

describe('study reveal turn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns the revealed card over only in Crystal with motion allowed', () => {
    stubMotion();
    expect(revealTurnsCard(crystalRoot)).toBe(true);
    expect(revealTurnsCard({ dataset: { themeFamily: 'classic' } })).toBe(false);
    expect(revealTurnsCard(undefined)).toBe(false);

    stubMotion({ reduced: true });
    expect(revealTurnsCard(crystalRoot)).toBe(false);

    stubMotion({ zen: true });
    expect(revealTurnsCard(crystalRoot)).toBe(false);
  });

  it('mounts the revealed card on the prompt side only for a reveal that turns it over', () => {
    const SideProbe = ({ initialSide }: Partial<FlashcardProps>) => <i data-side={initialSide} />;
    const mount = (family: string, fromPrompt: boolean) => {
      vi.stubGlobal('document', { documentElement: { dataset: { themeFamily: family } } });
      return renderToStaticMarkup(
        <CrystalRevealTurn studyCard={{ current: null }} fromPrompt={fromPrompt}>
          {<SideProbe initialSide="back" /> as ReactElement<FlashcardProps>}
        </CrystalRevealTurn>,
      );
    };

    stubMotion();
    expect(mount('crystal', true)).toBe('<i data-side="front"></i>');
    expect(mount('crystal', false)).toBe('<i data-side="back"></i>');
    expect(mount('classic', true)).toBe('<i data-side="back"></i>');
    stubMotion({ reduced: true });
    expect(mount('crystal', true)).toBe('<i data-side="back"></i>');
  });

  it('starts the turn by tapping the card face while it rests on the prompt side', () => {
    const resting = cardShell('front');
    expect(turnRevealedCard(resting.studyCard, 'front')).toBe(true);
    expect(resting.click).toHaveBeenCalledOnce();
  });

  it('leaves a card alone that already shows another side or is mid-turn', () => {
    const answered = cardShell('back');
    expect(turnRevealedCard(answered.studyCard, 'front')).toBe(false);
    expect(answered.click).not.toHaveBeenCalled();

    const turning = cardShell('front', 'to-back');
    expect(turnRevealedCard(turning.studyCard, 'front')).toBe(false);
    expect(turning.click).not.toHaveBeenCalled();

    expect(turnRevealedCard(null, 'front')).toBe(false);
  });
});
