import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { StudyView } from './StudyView';
import { SessionRecapModal } from './SessionRecapModal';

vi.mock('./SessionRecapModal', () => ({ SessionRecapModal: vi.fn(() => null) }));

it('falls back to closing Study when a controlled recap has no dismiss callback', () => {
  const onClose = vi.fn();
  renderToStaticMarkup(<StudyView
    cards={[{ id: 'word', word: 'word', translation: 'word', explanation: '', phonetic: '', emoji: '', category: '', audioUrl: null, imageUrl: null }]}
    index={0} recallMode="en-to-vi" revealed reviewedCardId={null} customDecks={[]} showRecap
    onClose={onClose} onRecallMode={vi.fn()} onReveal={vi.fn()} onBookmark={vi.fn()}
    onAssignDeck={vi.fn()} onUpdateCard={vi.fn()} onRate={vi.fn()} onIndex={vi.fn()}
  />);
  vi.mocked(SessionRecapModal).mock.lastCall![0].onClose();
  expect(onClose).toHaveBeenCalledOnce();
});
