import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { capListenPracticeCards, listenPracticeUnavailableMessage } from '../app/AppViewStage';
import {
  canStartTextPractice,
  IncomingSharePreview,
  OutgoingShareDetails,
  ShareManagementButton,
} from './AppOverlays';

describe('share overlays', () => {
  it('renders an explicit, write-free incoming preview decision', () => {
    const html = renderToStaticMarkup(
      <IncomingSharePreview
        preview={{
          shareId: 'deck-1',
          category: 'IELTS',
          cardCount: 100,
          sampleWords: ['airport', 'boarding pass'],
        }}
        isSharing={false}
        onAccept={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('Review shared deck');
    expect(html).toContain('IELTS');
    expect(html).toContain('100 cards');
    expect(html).toContain('airport');
    expect(html).toContain('Nothing will be added until you accept');
    expect(html).toContain('Accept deck');
    expect(html).toContain('Cancel');
  });

  it('keeps truncation guidance inside the outgoing share dialog', () => {
    const warning = 'This link includes the first 100 of 120 cards. Split this category into smaller decks to share the rest.';
    const html = renderToStaticMarkup(
      <OutgoingShareDetails
        shareLink="https://example.test/?share=deck-1"
        shareWarning={warning}
        copied={false}
        copyFailed={false}
        canRevokeShare
        isSharing={false}
        onCopy={vi.fn()}
        onDismissCopyError={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(html).toContain(warning);
    expect(html).toContain('Revoke link');
  });

  it('offers a visible way to reopen management after the dialog closes', () => {
    const html = renderToStaticMarkup(<ShareManagementButton onClick={vi.fn()} />);

    expect(html).toContain('Manage shared link');
  });
});

describe('practice menu copy', () => {
  const cards = [{
    id: 'card-1', word: 'hello', translation: 'xin chào',
  } as CardData];

  it('only enables text practice for an authenticated online owner with usable cards', () => {
    expect(canStartTextPractice(cards, 'owner-a', false)).toBe(true);
    expect(canStartTextPractice(cards, null, false)).toBe(false);
    expect(canStartTextPractice(cards, 'owner-a', true)).toBe(false);
    expect(canStartTextPractice([{ ...cards[0], translation: ' ' }], 'owner-a', false)).toBe(false);
  });

  it('bounds a listening handoff to the existing conversation card limit', () => {
    const selected = Array.from({ length: 8 }, (_, index) => ({
      ...cards[0], id: `card-${index}`,
    }));

    expect(capListenPracticeCards(selected)).toHaveLength(5);
    expect(capListenPracticeCards(selected).map(card => card.id)).toEqual([
      'card-0', 'card-1', 'card-2', 'card-3', 'card-4',
    ]);
  });

  it('explains why a guest or offline learner cannot open AI practice', () => {
    expect(listenPracticeUnavailableMessage(null, false)).toBe('Sign in to practise this phrase.');
    expect(listenPracticeUnavailableMessage('owner-a', true)).toBe('Reconnect to practise this phrase.');
    expect(listenPracticeUnavailableMessage('owner-a', false)).toBeNull();
  });
});
