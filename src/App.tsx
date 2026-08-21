import { lazy, Suspense, useState, type ComponentProps } from 'react';
import { useAppNavigation } from './features/navigation/useAppNavigation';
import type { LandingQuickStartIntent } from './features/navigation/landingQuickStartIntent';

const LandingPage = lazy(() => import('./features/landing/LandingPage'));
const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp'));

const landingFallback = (
  <div className="h-screen w-full bg-[#071014] flex items-center justify-center text-cyan-400 font-bold">
    Loading SonFlash…
  </div>
);

type AuthenticatedLandingProps = NonNullable<ComponentProps<typeof AuthenticatedApp>['renderLanding']>;

export default function App() {
  const navigation = useAppNavigation();
  const [authBootstrapRequested, setAuthBootstrapRequested] = useState(false);
  const [pendingLandingIntent, setPendingLandingIntent] = useState<LandingQuickStartIntent | null>(null);
  const isLanding = navigation.viewMode === 'landing';
  const shouldBootstrap = !isLanding || authBootstrapRequested || pendingLandingIntent !== null;
  const renderLanding: AuthenticatedLandingProps = props => (
    <Suspense fallback={landingFallback}>
      <LandingPage {...props} />
    </Suspense>
  );

  if (!shouldBootstrap) {
    return (
      <Suspense fallback={landingFallback}>
        <LandingPage
          onEnterApp={() => navigation.setViewMode('today')}
          onQuickStart={intent => {
            setPendingLandingIntent(intent);
            navigation.setViewMode('library');
          }}
          onOpenLibrary={() => navigation.setViewMode('library')}
          onOpenCatalog={() => navigation.setViewMode('catalog')}
          onSignIn={() => setAuthBootstrapRequested(true)}
          user={null}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={landingFallback}>
      <AuthenticatedApp
        navigation={navigation}
        autoSignIn={isLanding && authBootstrapRequested}
        pendingLandingIntent={pendingLandingIntent}
        onPendingLandingIntentConsumed={() => setPendingLandingIntent(null)}
        renderLanding={renderLanding}
      />
    </Suspense>
  );
}
