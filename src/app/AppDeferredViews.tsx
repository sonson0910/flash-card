import { lazy, Suspense } from 'react';
import type { LibraryScreenProps } from '../features/library/LibraryScreen';
import type { PracticeWorkspace } from '../features/practice/usePracticeWorkspace';

const LibraryScreen = lazy(() => import('../features/library/LibraryScreen').then(module => ({ default: module.LibraryScreen })));
const loadPracticeView = (() => {
  let promise: Promise<{ default: typeof import('../features/practice/PracticeScreen').PracticeScreen }> | null = null;
  return () => promise ??= import('../features/practice/PracticeScreen').then(module => ({ default: module.PracticeScreen }));
})();
const PracticeScreen = lazy(loadPracticeView);

export function preloadPracticeView() {
  void loadPracticeView();
}

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
      <LibraryScreen model={model} actions={actions} />
    </Suspense>
  );
}

interface AppDeferredPracticeViewProps {
  session: PracticeWorkspace['model']['session'];
  actions: PracticeWorkspace['actions'];
  customDecks: string[];
}

export function AppDeferredPracticeView({ session, actions, customDecks }: AppDeferredPracticeViewProps) {
  return (
    <Suspense fallback={<AppViewFallback label="Loading practice" />}>
      <PracticeScreen session={session} actions={actions} customDecks={customDecks} />
    </Suspense>
  );
}
