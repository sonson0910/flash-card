import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AppRuntimeBoundary } from './app/AppRuntimeBoundary';
import { useAppNavigation } from './features/navigation/useAppNavigation';

const LandingPage = lazy(() => import('./features/landing/LandingPage'));
const runtimeRetry = new URLSearchParams(globalThis.location?.search ?? '').has('runtime-retry');
const AppRuntime = runtimeRetry
  ? lazy(() => import('./app/AppRuntimeRetry.virtual'))
  : lazy(() => import('./app/AppRuntimeInitial.virtual'));

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

  useEffect(() => {
    if (navigation.viewMode !== 'landing') setRuntimeActivated(true);
  }, [navigation.viewMode]);

  const activateRuntime = useCallback(() => setRuntimeActivated(true), []);
  const enterApp = useCallback(() => {
    activateRuntime();
    navigation.setViewMode('today');
  }, [activateRuntime, navigation]);
  const openLibrary = useCallback(() => {
    activateRuntime();
    navigation.setViewMode('library');
  }, [activateRuntime, navigation]);
  const openCatalog = useCallback(() => {
    activateRuntime();
    navigation.setViewMode('catalog');
  }, [activateRuntime, navigation]);
  const openProgress = useCallback(() => {
    activateRuntime();
    navigation.setViewMode('progress');
  }, [activateRuntime, navigation]);
  const requestLandingSignIn = useCallback(() => {
    activateRuntime();
    setSignInRequest(request => request + 1);
  }, [activateRuntime]);
  const handleSignInRequestHandled = useCallback((request: number) => {
    setAcknowledgedSignInRequest(previous => Math.max(previous, request));
  }, []);
  const handleRuntimeError = useCallback(() => {
    navigation.setViewMode('landing');
  }, [navigation]);
  const retryRuntime = useCallback(() => {
    const retryUrl = new URL(window.location.href);
    retryUrl.searchParams.set('runtime-retry', String(Date.now()));
    window.location.replace(retryUrl.toString());
  }, []);

  return (
    <>
      <Fragment key="landing">
        {navigation.viewMode === 'landing' && (
          <Suspense fallback={<div className="h-screen w-full bg-[#071014] flex items-center justify-center text-cyan-400 font-bold">Loading SonFlash…</div>}>
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
      </Fragment>
      <Fragment key="runtime">
        {runtimeActivated && (
          <AppRuntimeBoundary onError={handleRuntimeError} onRetry={retryRuntime}>
            <Suspense fallback={navigation.viewMode === 'landing' ? null : <div className="h-screen w-full bg-[var(--sf-surface)]" role="status">Loading workspace…</div>}>
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
      </Fragment>
    </>
  );
}
