import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { SessionRecapModal } from '../../src/features/practice/SessionRecapModal';
import { UndoToast, type UndoToastItem } from '../../src/components/ui/UndoToast';

const weakCard = {
  id: 'weak-card', word: 'focus', normalizedWord: 'focus', translation: 'tập trung', explanation: '',
  phonetic: '', emoji: '📘', category: 'Accessibility', audioUrl: null, imageUrl: null,
};

function UndoHarness() {
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<UndoToastItem | null>({
    id: 'undo-target', message: 'Card deleted', onUndo: () => undefined, durationMs: 5_000,
  });
  return <>
    <button type="button" onClick={() => setVersion(value => value + 1)}>Replace dismiss callback</button>
    <UndoToast toast={toast} onDismiss={() => {
      (window as Window & { undoDismissVersion?: number }).undoDismissVersion = version;
      setToast(null);
    }} />
  </>;
}

function RecapHarness() {
  return <SessionRecapModal
    open
    onClose={() => undefined}
    onRetryWeak={() => undefined}
    totalCards={1}
    goodCount={0}
    againCount={1}
    xpEarned={0}
    weakCards={[weakCard]}
  />;
}

const root = createRoot(document.getElementById('root')!);
root.render(new URLSearchParams(location.search).get('view') === 'recap' ? <RecapHarness /> : <UndoHarness />);
