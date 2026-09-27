import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AppRuntimeBoundary } from './app/AppRuntimeBoundary';
import { useAppNavigation } from './features/navigation/useAppNavigation';
import { getActiveUiLocale, loadCatalog } from './i18n/loadCatalog';
import { Trans } from '@lingui/react';
import { WorkspaceLoadingPanel } from './components/WorkspaceLoadingPanel';
import './styles/app-bootstrap.css';

const LandingPage = lazy(() => Promise.all([
  import('./features/landing/LandingPage'), loadCatalog(getActiveUiLocale(), 'landing'),
]).then(([component]) => component));
const runtimeRetry = new URLSearchParams(globalThis.location?.search).has('runtime-retry');
const AppRuntime = runtimeRetry
  ? lazy(() => Promise.all([
    import('./app/AppRuntimeRetry.virtual'),
    loadCatalog(getActiveUiLocale(), 'components'),
    loadCatalog(getActiveUiLocale(), 'shell'),
    loadCatalog(getActiveUiLocale(), 'practice'),
  ]).then(([component]) => component))
  : lazy(() => Promise.all([
    import('./app/AppRuntimeInitial.virtual'),
    loadCatalog(getActiveUiLocale(), 'components'),
    loadCatalog(getActiveUiLocale(), 'shell'),
    loadCatalog(getActiveUiLocale(), 'practice'),
  ]).then(([component]) => component));

interface LandingUser {
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly photoURL?: string | null;
}

export default function App() {
  const practiceOpenerRef = useRef<HTMLElement | null>(null);
  const navigation = useAppNavigation({ practiceOpenerRef });
  const [runtimeActivated, setRuntimeActivated] = useState(() => navigation.viewMode !== 'landing');
  const [signInRequest, setSignInRequest] = useState(0);
  const [acknowledgedSignInRequest, setAcknowledgedSignInRequest] = useState(0);
  const [landingUser, setLandingUser] = useState<LandingUser | null>(null);
  const [runtimeFailed, setRuntimeFailed] = useState(false);

  useEffect(() => {
    if (navigation.viewMode !== 'landing') setRuntimeActivated(true);
  }, [navigation.viewMode]);

  const enterApp = useCallback(() => {
    setRuntimeActivated(true);
    navigation.setViewMode('today');
  }, [navigation]);
  const openLibrary = useCallback(() => {
    setRuntimeActivated(true);
    navigation.setViewMode('library');
  }, [navigation]);
  const openCatalog = useCallback(() => {
    setRuntimeActivated(true);
    navigation.setViewMode('catalog');
  }, [navigation]);
  const openProgress = useCallback(() => {
    setRuntimeActivated(true);
    navigation.setViewMode('progress');
  }, [navigation]);
  const requestLandingSignIn = useCallback(() => {
    setRuntimeActivated(true);
    setSignInRequest(request => request + 1);
  }, []);
  const handleSignInRequestHandled = useCallback((request: number) => {
    setAcknowledgedSignInRequest(previous => Math.max(previous, request));
  }, []);
  const handleRuntimeError = useCallback(() => {
    setRuntimeFailed(true);
    navigation.setViewMode('landing');
  }, [navigation]);
  const retryRuntime = useCallback(() => {
    const retryUrl = new URL(window.location.href);
    retryUrl.searchParams.set('runtime-retry', String(Date.now()));
    window.location.replace(retryUrl.toString());
  }, []);

  return (
    <>
      {navigation.viewMode === 'landing' && !runtimeFailed && (
          <Suspense fallback={<div className="app-loading crystal-starfield font-bold text-[var(--sf-brand-text)]"><Trans id="shell.loading.app" message="Loading SonFlash…" /></div>}>
            <LandingPage
              onEnterApp={enterApp}
              onOpenLibrary={openLibrary}
              onOpenCatalog={openCatalog}
              onOpenProgress={openProgress}
              onSignIn={requestLandingSignIn}
              user={landingUser}
            />
          </Suspense>
      )}
      {runtimeActivated && (
          <AppRuntimeBoundary onError={handleRuntimeError} onRetry={retryRuntime}>
            <Suspense fallback={navigation.viewMode === 'landing' ? null : <div className="app-loading"><WorkspaceLoadingPanel /></div>}>
              <AppRuntime
                navigation={navigation}
                practiceOpenerRef={practiceOpenerRef}
                visible={navigation.viewMode !== 'landing'}
                signInRequest={signInRequest > acknowledgedSignInRequest ? signInRequest : null}
                onSignInRequestHandled={handleSignInRequestHandled}
                onLandingUserChange={setLandingUser}
              />
            </Suspense>
          </AppRuntimeBoundary>
      )}
    </>
  );
}
