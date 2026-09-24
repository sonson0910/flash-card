import { lazy, Suspense } from 'react';
import type { LibraryScreenProps } from '../features/library/LibraryScreen';
import type { PracticeWorkspace } from '../features/practice/usePracticeWorkspace';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';

const LibraryScreen = lazy(() => Promise.all([
  import('../features/library/LibraryScreen'), loadCatalog(getActiveUiLocale(), 'library'),
]).then(([module]) => ({ default: module.LibraryScreen })));
const PracticeScreen = lazy(() => Promise.all([
  import('../features/practice/PracticeScreen'), loadCatalog(getActiveUiLocale(), 'practice'),
]).then(([module]) => ({ default: module.PracticeScreen })));

export function AppViewFallback({ label }: { label: string }) {
  return (
    <div className="skeleton-sheen min-h-40 rounded-[26px] border border-[var(--sf-border)]" role="status">
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function AppDeferredLibraryView({ model, actions }: LibraryScreenProps) {
  return (
    <Suspense fallback={<AppViewFallback label="Loading library" />}>
      <div className="async-content-enter" data-async-content="library">
        <LibraryScreen model={model} actions={actions} />
      </div>
    </Suspense>
  );
}

interface AppDeferredPracticeViewProps {
  session: PracticeWorkspace['model']['session'];
  actions: PracticeWorkspace['actions'];
  customDecks: string[];
  addXp: (amount: number) => void;
}

export function AppDeferredPracticeView({ session, actions, customDecks, addXp }: AppDeferredPracticeViewProps) {
  return (
    <Suspense fallback={<AppViewFallback label="Loading practice" />}>
      <div className="async-content-enter" data-async-content="practice">
        <PracticeScreen session={session} actions={actions} customDecks={customDecks} addXp={addXp} />
      </div>
    </Suspense>
  );
}
