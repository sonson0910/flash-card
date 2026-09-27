import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import '../../src/index.css';
import '../../src/styles/app-bootstrap.css';
import '../../src/styles/shell.css';
import { AppOverlays } from '../../src/components/AppOverlays';
import { ApplicationErrorPanel } from '../../src/components/ApplicationErrorPanel';
import { WorkspaceLoadingPanel } from '../../src/components/WorkspaceLoadingPanel';
import { AppFeedback } from '../../src/components/shell/AppFeedback';
import { AppFooter } from '../../src/components/shell/AppFooter';
import { DesktopNavigation } from '../../src/components/shell/DesktopNavigation';
import { FloatingMobileNav } from '../../src/components/shell/FloatingMobileNav';
import { UndoToast, type UndoToastItem } from '../../src/components/ui/UndoToast';
import { ThemeProvider, useTheme } from '../../src/features/theme/ThemeProvider';
import { TodayScreen } from '../../src/features/dailyLearning/TodayScreen';
import type { TodayScreenActions, TodayScreenModel } from '../../src/features/dailyLearning/dailyLearningPresentation';
import { EmptyLibraryPanel } from '../../src/features/library/EmptyLibraryPanel';
import { useSharedDeckSession } from '../../src/features/sharing/useSharedDeckSession';
import type { SharedDeckAdapter, SharedDeckIntakePort } from '../../src/features/sharing/sharedDeckSessionController';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import type { CardData } from '../../src/types/card';

type DeferredGate = {
  load?: () => void;
  create?: () => void;
  revoke?: () => void;
  adoption?: () => void;
  auth?: () => void;
};

type AdapterCounts = {
  create: number;
  revoke: number;
  adoption: number;
};

const sharedWords = [
  ['adapt', 'thích nghi'], ['benefit', 'lợi ích'], ['context', 'bối cảnh'],
  ['develop', 'phát triển'], ['evidence', 'bằng chứng'], ['focus', 'tập trung'],
  ['goal', 'mục tiêu'], ['improve', 'cải thiện'], ['maintain', 'duy trì'],
  ['observe', 'quan sát'], ['practice', 'luyện tập'], ['review', 'ôn tập'],
] as const;

const shareCards: CardData[] = sharedWords.map(([word, translation], index) => ({
  id: `shell-share-fixture-${index}`,
  word,
  normalizedWord: word,
  translation,
  explanation: `A real card-shaped fixture for ${word}.`,
  phonetic: '',
  emoji: '📘',
  category: 'IELTS',
  audioUrl: null,
  imageUrl: null,
  language: 'en',
  translationLanguage: 'vi',
  createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
  difficulty: index % 2 ? 'good' : 'easy',
  customDeck: 'IELTS',
  exampleSentence: `We ${word} with a clear example.`,
  exampleTranslation: `Ví dụ ${index + 1}`,
  origin: index === 4 ? 'ai' : 'manual',
}));

const sharePayload = {
  category: 'IELTS',
  targetLanguage: 'en',
  nativeLanguage: 'vi',
  createdAt: '2026-09-23T10:00:00.000Z',
  expiresAt: '2026-10-23T10:00:00.000Z',
  cards: shareCards,
};

const caughtUpToday: TodayScreenModel = {
  status: 'caught-up',
  isOffline: false,
  message: 'No due or new cards are available in this daily plan.',
  courseLabel: 'English ← Vietnamese',
  plan: { total: 0, due: 0, weak: 0, fresh: 0, isShort: true },
  placementAvailable: false,
  caughtUp: { availableNewCount: 0 },
};

const shareStorageKey = (shareId: string) => `shell-share-workflow:${shareId}`;
const adoptedStorageKey = 'shell-share-workflow:adopted-card-ids';

function resolveGate(gates: MutableRefObject<DeferredGate>, key: keyof DeferredGate) {
  const resolve = gates.current[key];
  delete gates.current[key];
  resolve?.();
}

function waitAtGate(
  gates: MutableRefObject<DeferredGate>,
  key: keyof DeferredGate,
  setPendingGate: (gate: keyof DeferredGate | null) => void,
) {
  return new Promise<void>(resolve => {
    gates.current[key] = () => {
      setPendingGate(null);
      resolve();
    };
    setPendingGate(key);
  });
}

function readMode(key: string, fallback = '') {
  return new URLSearchParams(location.search).get(key) ?? fallback;
}

function ShellShareFixture() {
  const { _ } = useLingui();
  const locale = useUiLocale();
  const fixtureCopy = locale === 'vi'
    ? {
      authError: 'Phiên đăng nhập cần được chú ý.',
      feedbackError: 'Đồng bộ đám mây cần được chú ý.',
      notice: 'Các thay đổi đã được lưu.',
      undoMessage: 'Đã xóa thẻ khỏi thiết bị này.',
    }
    : {
      authError: 'Your account session needs attention.',
      feedbackError: 'Cloud updates need attention.',
      notice: 'Your changes are saved.',
      undoMessage: 'Card removed from this device.',
    };
  const localizedCaughtUpToday: TodayScreenModel = {
    ...caughtUpToday,
    message: _(msg({ id: 'today.plan.caught-up', message: 'No due or new cards are available in this daily plan.' })),
  };
  const theme = useTheme();
  const view = readMode('view', 'share');
  const state = readMode('state', 'all');
  const loadMode = readMode('load');
  const createMode = readMode('create');
  const revokeMode = readMode('revoke');
  const adoptionMode = readMode('adoption');
  const authMode = readMode('auth');
  const gates = useRef<DeferredGate>({});
  const counts = useRef<AdapterCounts>({ create: 0, revoke: 0, adoption: 0 });
  const [ready, setReady] = useState(false);
  const [pendingGate, setPendingGate] = useState<keyof DeferredGate | null>(null);
  const [identityMode, setIdentityMode] = useState<'authenticated' | 'signed-out' | 'loading'>(
    readMode('identity') === 'connecting' ? 'loading' : readMode('identity') === 'signed-out' ? 'signed-out' : 'authenticated',
  );
  const [sessionLost, setSessionLost] = useState(readMode('state') === 'session-lost');
  const [isRetryingAuth, setIsRetryingAuth] = useState(false);
  const [errorPanelBusy, setErrorPanelBusy] = useState(false);
  const [authError, setAuthError] = useState(view === 'feedback' || view === 'combined' || sessionLost ? fixtureCopy.authError : null);
  const [feedbackError, setFeedbackError] = useState(view === 'feedback' || view === 'combined' ? fixtureCopy.feedbackError : null);
  const [notice, setNotice] = useState(view === 'feedback' || view === 'combined' ? fixtureCopy.notice : null);
  const [feedbackSync, setFeedbackSync] = useState<'error' | 'offline' | 'syncing' | 'saved' | 'checking'>(
    view === 'feedback' || view === 'combined' ? 'syncing' : state === 'sync-error' ? 'error' : state === 'offline' ? 'offline' : state === 'connecting' ? 'checking' : 'saved',
  );
  const [syncRetryCount, setSyncRetryCount] = useState(0);
  const [authRetryCount, setAuthRetryCount] = useState(0);
  const [accountActionCounts, setAccountActionCounts] = useState({ sync: 0, export: 0, clear: 0 });
  const [accountClearFocusTarget, setAccountClearFocusTarget] = useState('');
  const [fixtureAction, setFixtureAction] = useState('idle');
  const [wordInput, setWordInput] = useState('');
  const [fixtureUndoCards, setFixtureUndoCards] = useState<string[]>(['benefit']);
  const shareOpenerRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const practiceOpenerRef = useRef<HTMLElement | null>(null);
  const statsOpenerRef = useRef<HTMLElement | null>(null);
  const clearOpenerRef = useRef<HTMLElement | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToastItem | null>(() => view === 'undo' || view === 'combined' ? {
    id: 'shell-share-undo',
    message: fixtureCopy.undoMessage,
    subject: 'adapt',
    durationMs: 5_000,
    onUndo: () => {
      setFixtureUndoCards(cards => cards.includes('adapt') ? cards : ['adapt', ...cards]);
      window.__shellShareUndoCount = (window.__shellShareUndoCount ?? 0) + 1;
    },
  } : null);

  useEffect(() => {
    void Promise.all([
      loadCatalog(locale, 'shell'),
      loadCatalog(locale, 'components'),
      loadCatalog(locale, 'library'),
      loadCatalog(locale, 'progress'),
      loadCatalog(locale, 'today'),
    ]).then(() => setReady(true));
  }, [locale]);

  const adapter = useMemo<SharedDeckAdapter>(() => ({
    async load(shareId) {
      if (loadMode === 'defer') {
        await waitAtGate(gates, 'load', setPendingGate);
      }
      if (loadMode === 'fail') throw new Error('Fixture share load failed.');
      if (shareId === 'fixture-missing' || loadMode === 'missing') return null;
      if (shareId === 'fixture-incoming') return sharePayload;
      const stored = localStorage.getItem(shareStorageKey(shareId));
      return stored ? JSON.parse(stored) as unknown : null;
    },
    async create() {
      counts.current.create += 1;
      const call = counts.current.create;
      if (createMode === 'defer') {
        await waitAtGate(gates, 'create', setPendingGate);
      }
      if (createMode === 'fail' || (createMode === 'fail-once' && call === 1)) {
        throw new Error('Fixture share create failed.');
      }
      const shareId = `fixture-created-${call}`;
      localStorage.setItem(shareStorageKey(shareId), JSON.stringify(sharePayload));
      return { shareId, expiresAt: '2026-10-23T10:00:00.000Z' };
    },
    async revoke() {
      counts.current.revoke += 1;
      if (revokeMode === 'defer') {
        await waitAtGate(gates, 'revoke', setPendingGate);
      }
      if (revokeMode === 'fail' || (revokeMode === 'fail-once' && counts.current.revoke === 1)) {
        throw new Error('Fixture share revoke failed.');
      }
    },
  }), [createMode, loadMode, revokeMode]);

  const intake = useMemo<SharedDeckIntakePort>(() => ({
    async adoptShared({ cards }) {
      counts.current.adoption += 1;
      const call = counts.current.adoption;
      if (adoptionMode === 'defer') {
        await waitAtGate(gates, 'adoption', setPendingGate);
      }
      if (adoptionMode === 'busy') return { status: 'busy' };
      if (adoptionMode === 'fail' || (adoptionMode === 'fail-once' && call === 1)) {
        return { status: 'failed', error: new Error('Fixture card intake failed.') };
      }
      const ids = cards.flatMap(card => (
        card && typeof card === 'object' && 'id' in card && typeof card.id === 'string' ? [card.id] : []
      ));
      const previousIds = new Set<string>(JSON.parse(localStorage.getItem(adoptedStorageKey) ?? '[]') as string[]);
      const newIds = ids.filter(id => !previousIds.has(id));
      localStorage.setItem(adoptedStorageKey, JSON.stringify([...previousIds, ...newIds]));
      window.__shellShareAdoptedCount = cards.length;
      return { status: 'completed', candidateCount: cards.length, createdCount: newIds.length, reusedCount: ids.length - newIds.length };
    },
  }), [adoptionMode]);

  const browser = useMemo(() => ({
    getCurrentUrl: () => window.location.href,
    replaceLocation: (nextLocation: string) => window.history.replaceState(window.history.state, document.title, nextLocation),
  }), []);
  const sharing = useSharedDeckSession({
    ownerKey: 'fixture-owner',
    adapter,
    intake,
    browser,
  });
  const noOp = () => undefined;
  const asyncNoOp = async () => undefined;
  const runAction = <T extends { status: string }>(label: string, action: Promise<T>) => {
    void action.then(result => setFixtureAction(`${label}:${result.status}`));
  };
  const startShare = () => runAction('create', sharing.actions.createShare({
    category: 'IELTS',
    cards: shareCards,
    total: shareCards.length,
    hasNext: false,
  }));

  useEffect(() => {
    const controls = {
      repeatCreate: startShare,
      repeatAccept: () => runAction('accept', sharing.actions.acceptShared()),
      repeatRevoke: () => runAction('revoke', sharing.actions.revokeShare()),
      resolveLoad: () => resolveGate(gates, 'load'),
      resolveCreate: () => resolveGate(gates, 'create'),
      resolveRevoke: () => resolveGate(gates, 'revoke'),
      resolveAdoption: () => resolveGate(gates, 'adoption'),
      resolveAuth: () => resolveGate(gates, 'auth'),
    };
    window.__shellShareControls = controls;
    return () => {
      if (window.__shellShareControls === controls) delete window.__shellShareControls;
    };
  });

  if (!ready) return null;

  const syncStatus = feedbackSync === 'offline'
    ? { isOnline: false, error: null, cloudUnavailable: false }
    : feedbackSync === 'error'
      ? { isOnline: true, error: 'Cloud is temporarily unreachable. Your changes are safe on this device and will retry automatically.', cloudUnavailable: false }
      : feedbackSync === 'checking'
        ? { isOnline: true, error: null, cloudUnavailable: false, isCheckingCloud: true }
        : { isOnline: true, error: null, cloudUnavailable: false };
  const authIdentity = identityMode === 'authenticated'
    ? { status: 'authenticated' as const, displayName: 'Mina Tran', email: 'mina@example.test', photoUrl: null }
    : identityMode === 'signed-out'
      ? { status: 'signed-out' as const, isConfigured: true, isSigningIn: false }
      : { status: 'loading' as const };
  const cancelShare = () => {
    sharing.actions.cancelShared();
    setFixtureAction('cancelled');
  };
  const handleSyncRetry = async () => {
    setSyncRetryCount(count => count + 1);
    setFeedbackSync('syncing');
  };
  const retryAuth = async () => {
    setAuthRetryCount(count => count + 1);
    setIsRetryingAuth(true);
    setFixtureAction('account:auth-retry:requested');
    if (authMode === 'defer') await waitAtGate(gates, 'auth', setPendingGate);
    setIdentityMode('authenticated');
    setSessionLost(false);
    setIsRetryingAuth(false);
    setFixtureAction('account:auth-recovered');
  };
  const recordAccountAction = (action: keyof typeof accountActionCounts) => {
    setAccountActionCounts(counts => ({ ...counts, [action]: counts[action] + 1 }));
    setFixtureAction(`account:${action}:requested`);
  };
  const recordTodayAction = (action: string) => () => setFixtureAction(`today:${action}`);
  const todayActions: TodayScreenActions = {
    openVocabulary: recordTodayAction('vocabulary'),
    openPaths: recordTodayAction('paths'),
    retry: recordTodayAction('retry'),
    startSession: recordTodayAction('session'),
    startLesson: mode => setFixtureAction(`today:lesson:${mode}`),
    startPlacement: recordTodayAction('placement'),
    openMorePractice: recordTodayAction('more-practice'),
  };
  const standaloneSystemPanel = view === 'system' && (state === 'error' || state === 'loading');
  const fixtureViewMode = view === 'today-caught-up' ? 'today' : 'library';

  return (
    <div data-shell-share-fixture data-view={standaloneSystemPanel ? undefined : fixtureViewMode} className={standaloneSystemPanel ? 'min-h-dvh' : 'app-canvas claude-app-shell min-h-dvh h-dvh text-[var(--sf-text)] font-sans flex flex-col overflow-hidden transition-colors relative'}>
      {view !== 'system' ? (
        <DesktopNavigation
          viewMode={fixtureViewMode}
          syncIdentity={authIdentity}
          syncStatus={syncStatus}
          isDarkMode={theme.mode === 'dark'}
          libraryCountLabel="12 words"
          streak={4}
          level={3}
          xp={480}
          onOpenToday={noOp}
          onOpenLibrary={noOp}
          onOpenCatalog={noOp}
          onOpenProgress={noOp}
          onOpenSettings={noOp}
          onSignIn={retryAuth}
          onSignOut={() => setIdentityMode('signed-out')}
          isRetryingSync={feedbackSync === 'syncing'}
          canSyncNow={identityMode === 'authenticated' && !sessionLost}
          onRetrySync={() => recordAccountAction('sync')}
          onExportLibrary={() => recordAccountAction('export')}
          onClearLibrary={focusReturnTarget => {
            setAccountClearFocusTarget(focusReturnTarget.getAttribute('aria-controls') ?? 'missing');
            recordAccountAction('clear');
          }}
          sessionLost={sessionLost}
        />
      ) : null}

      {view === 'system' && state === 'error' ? (
        <ApplicationErrorPanel
          title="SonFlash needs a reload"
          description="Your saved data is safe. Reload the app to restore the interface."
          actionLabel="Retry workspace"
          actionBusyLabel="Retrying workspace…"
          isActionBusy={errorPanelBusy}
          onAction={() => {
            setErrorPanelBusy(true);
            window.setTimeout(() => setErrorPanelBusy(false), 1_000);
          }}
          reportHref="mailto:support@example.test"
          reportLabel="Report this issue"
        />
      ) : view === 'system' && state === 'loading' ? (
        <div className="app-loading">
          <WorkspaceLoadingPanel />
        </div>
      ) : view === 'today-caught-up' ? (
        <main id="learning-workspace" tabIndex={0} aria-label="Learning workspace" className="claude-workspace flex-1 relative w-full overflow-y-auto z-10 scrollbar-thin focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
          <div className="claude-workspace-inner relative w-full max-w-[1440px] mx-auto px-5 pt-5 pb-28 sm:px-8 lg:px-11 lg:pt-3 lg:pb-8">
            <TodayScreen model={localizedCaughtUpToday} actions={todayActions} />
          </div>
        </main>
      ) : view === 'empty-library' ? (
        <main id="learning-workspace" tabIndex={0} aria-label="Learning workspace" className="claude-workspace flex-1 relative w-full overflow-y-auto z-10 scrollbar-thin focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
          <div className="claude-workspace-inner relative w-full max-w-[1440px] mx-auto px-5 pt-5 pb-28 sm:px-8 lg:px-11 lg:pt-3 lg:pb-8">
            <EmptyLibraryPanel
              fileInputRef={fileInputRef}
              wordInput={wordInput}
              onWordInputChange={setWordInput}
              onGenerate={async event => {
                event.preventDefault();
                setFixtureAction('empty-library:generate-requested');
              }}
              onImport={event => setFixtureAction(event.currentTarget.files?.length ? 'empty-library:import-selected' : 'empty-library:import-cleared')}
              onOpenPaths={() => setFixtureAction('empty-library:paths')}
              isLoading={false}
              isGenerating={false}
              isImporting={false}
              generationAccess={{ available: true }}
              importProgress={null}
              importResult={null}
            />
          </div>
        </main>
      ) : (
        <main id="learning-workspace" tabIndex={0} aria-label="Learning workspace" className="claude-workspace flex-1 relative w-full overflow-y-auto z-10 scrollbar-thin focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
          <div className="claude-workspace-inner relative w-full max-w-[1440px] mx-auto px-5 pt-5 pb-28 sm:px-8 lg:px-11 lg:pt-3 lg:pb-8">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--sf-brand-text)]">Shell and sharing fixture</p>
            <h1 tabIndex={-1} className="mt-2 text-3xl font-black">{view === 'share' ? 'Share a real deck fixture' : view === 'account' ? 'Account and library menu' : view === 'undo' ? 'Undo a local change' : view === 'combined' ? 'Combined shell notifications' : 'System feedback states'}</h1>
            {view === 'share' ? (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button type="button" data-fixture-action="create" onClick={event => { shareOpenerRef.current = event.currentTarget; startShare(); }} className="min-h-11 rounded-full bg-[var(--sf-brand)] px-5 font-bold text-[var(--sf-on-brand)]">Create outgoing share</button>
                <output data-fixture-action-status aria-live="polite">{fixtureAction}</output>
              </div>
            ) : view === 'account' ? (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setIdentityMode(value => value === 'authenticated' ? 'signed-out' : 'authenticated')} className="min-h-11 rounded-full border border-[var(--sf-border)] px-4">Toggle account connection</button>
              </div>
            ) : view === 'undo' || view === 'combined' ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-[var(--sf-text-muted)]">Undo restores the removed card in the fixture adapter.</p>
                <output data-undo-cards aria-live="polite">{fixtureUndoCards.join(', ')}</output>
                <button type="button" onClick={() => {
                  setFixtureUndoCards(cards => cards.filter(card => card !== 'adapt'));
                  setUndoToast({
                    id: `shell-share-undo-${Date.now()}`,
                    message: fixtureCopy.undoMessage,
                    subject: 'adapt',
                    durationMs: 5_000,
                    onUndo: () => {
                      setFixtureUndoCards(cards => cards.includes('adapt') ? cards : ['adapt', ...cards]);
                      window.__shellShareUndoCount = (window.__shellShareUndoCount ?? 0) + 1;
                    },
                  });
                }} className="min-h-11 rounded-full border border-[var(--sf-border)] px-4">Remove adapt card</button>
              </div>
            ) : (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setAuthError(fixtureCopy.authError)} className="min-h-11 rounded-full border px-4">Show account message</button>
              </div>
            )}

          </div>
          </div>
        </main>
      )}

      {!standaloneSystemPanel ? (
        <AppFooter viewMode={fixtureViewMode} libraryCountLabel="12 WORDS" syncStatus={syncStatus} />
      ) : null}

      {view === 'feedback' || view === 'combined' || (view === 'account' && sessionLost) ? (
        <AppFeedback
          authError={authError}
          error={feedbackError}
          notice={notice}
          syncStatus={syncStatus}
          onDismissAuthError={() => setAuthError(null)}
          onDismissError={() => setFeedbackError(null)}
          onDismissNotice={() => setNotice(null)}
          onRetrySync={handleSyncRetry}
          sessionLost={view === 'account' && sessionLost}
          onRetryAuth={retryAuth}
          isRetryingAuth={isRetryingAuth}
        >
          {view === 'combined' && undoToast ? <UndoToast toast={undoToast} onDismiss={() => setUndoToast(null)} stacked /> : null}
        </AppFeedback>
      ) : null}
      {view === 'share' ? (
        <>
          <AppFeedback
            error={sharing.model.isShareDialogOpen ? null : sharing.model.error}
            notice={sharing.model.notice}
            onDismissError={sharing.actions.clearError}
            onDismissNotice={sharing.actions.clearNotice}
          />
            <AppOverlays
            shareDialogOpen={sharing.model.isShareDialogOpen || sharing.model.isLoading}
            shareLink={sharing.model.shareLink}
            shareWarning={sharing.model.shareWarning}
            shareExpiresAt={sharing.model.expiresAt}
            shareError={sharing.model.error}
            onDismissShareError={sharing.actions.clearError}
            outgoingSharePreview={sharing.model.outgoingPreview}
            incomingSharePreview={sharing.model.incomingPreview}
            dismissShareDialog={sharing.actions.dismissShareLink}
            showShareDialog={sharing.actions.showShareDialog}
            acceptSharedDeck={async () => runAction('accept', sharing.actions.acceptShared())}
            cancelSharedDeck={cancelShare}
            canRevokeShare={Boolean(sharing.model.activeShareId)}
            revokeShare={async () => runAction('revoke', sharing.actions.revokeShare())}
            isSharing={sharing.model.isLoading}
            isPracticeMenuOpen={false}
            setIsPracticeMenuOpen={noOp}
            startQuiz={asyncNoOp}
            startSpelling={asyncNoOp}
            startMatch={asyncNoOp}
            startShadowing={asyncNoOp}
            practiceCards={shareCards}
            visibleLibraryCount={shareCards.length}
            generateStory={asyncNoOp}
            isStatsOpen={false}
            setIsStatsOpen={noOp}
            statsData={{ total: 12, learned: 4, learning: 6, dueToday: 2, categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [] }}
            isDarkMode={theme.mode === 'dark'}
            showClearConfirm={false}
            setShowClearConfirm={noOp}
            clearAll={asyncNoOp}
            isLoading={sharing.model.isLoading}
            shareOpenerRef={shareOpenerRef}
            practiceOpenerRef={practiceOpenerRef}
            statsOpenerRef={statsOpenerRef}
            clearOpenerRef={clearOpenerRef}
          />
        </>
      ) : null}
      {view === 'undo' ? <UndoToast toast={undoToast} onDismiss={() => setUndoToast(null)} /> : null}
      <output data-fixture-status hidden>{fixtureAction}</output>
      <output data-fixture-identity hidden>{identityMode}</output>
      <output data-fixture-sync-status hidden>{feedbackSync}:{syncRetryCount}</output>
      <output data-sync-retry-count hidden>{syncRetryCount}</output>
      <output data-auth-retry-count hidden>{authRetryCount}</output>
      <output data-fixture-session-lost hidden>{String(sessionLost)}</output>
      <output data-fixture-auth-retrying hidden>{String(isRetryingAuth)}</output>
      <output data-account-sync-count hidden>{accountActionCounts.sync}</output>
      <output data-account-export-count hidden>{accountActionCounts.export}</output>
      <output data-account-clear-count hidden>{accountActionCounts.clear}</output>
      <output data-account-clear-focus hidden>{accountClearFocusTarget}</output>
      <output data-fixture-gate-ready hidden>{pendingGate ?? ''}</output>
      {view !== 'system' ? <FloatingMobileNav activeView={fixtureViewMode} onSelectView={noOp} /> : null}
    </div>
  );
}

declare global {
  interface Window {
    __shellShareUndoCount?: number;
    __shellShareAdoptedCount?: number;
    __shellShareControls?: {
      repeatCreate: () => void;
      repeatAccept: () => void;
      repeatRevoke: () => void;
      resolveLoad: () => void;
      resolveCreate: () => void;
      resolveRevoke: () => void;
      resolveAdoption: () => void;
      resolveAuth: () => void;
    };
  }
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <I18nProvider>
      <ShellShareFixture />
    </I18nProvider>
  </ThemeProvider>,
);
