import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appUrl = new URL('../App.tsx', import.meta.url);
const runtimeUrl = new URL('./AppRuntime.tsx', import.meta.url);
const signInRequestUrl = new URL('./landingSignInRequest.ts', import.meta.url);
const libraryRuntimeUrl = new URL('./useAppLibraryRuntime.ts', import.meta.url);
const learningCoordinationUrl = new URL('./useAppLearningCoordination.ts', import.meta.url);

const readIfPresent = (url: URL): string => {
  const file = fileURLToPath(url);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const physicalLineCount = (source: string): number => source.split(/\r?\n/).length;

describe('App composition root contract', () => {
  it('keeps App at least 25% below the former 600-line gate', () => {
    const source = readFileSync(appUrl, 'utf8');

    expect(physicalLineCount(source)).toBeLessThanOrEqual(450);
  });

  it('moves feature coordination behind two bounded app hooks', () => {
    const appSource = readFileSync(appUrl, 'utf8');
    const runtimeSource = readIfPresent(runtimeUrl);
    const signInRequestSource = readIfPresent(signInRequestUrl);
    const libraryRuntimeSource = readIfPresent(libraryRuntimeUrl);
    const learningCoordinationSource = readIfPresent(learningCoordinationUrl);

    expect(appSource).toContain("lazy(() => import('./app/AppRuntimeInitial.virtual'))");
    expect(appSource).toContain("lazy(() => import('./app/AppRuntimeRetry.virtual'))");
    expect(appSource).not.toContain("from './app/appDependencies'");
    expect(appSource).not.toContain("from './app/useAppLibraryRuntime'");
    expect(appSource).not.toContain("from './app/useAppLearningCoordination'");
    expect(appSource).not.toContain('useBrowserExtensionImport');
    expect(runtimeSource).toContain("from './appDependencies'");
    expect(runtimeSource).toContain("from './useAppLibraryRuntime'");
    expect(runtimeSource).toContain("from './useAppLearningCoordination'");
    expect(runtimeSource).toContain('useBrowserExtensionImport');
    expect(runtimeSource).toContain('consumeLandingSignInRequest');
    expect(appSource).toContain('setSignInRequest(request => request + 1)');
    expect(signInRequestSource).toContain('request <= handledRequestRef.current');
    const signInAcknowledgement = signInRequestSource.indexOf('acknowledge(request)');
    const signInDispatch = signInRequestSource.indexOf('await signIn()');
    expect(signInAcknowledgement).toBeGreaterThanOrEqual(0);
    expect(signInDispatch).toBeGreaterThan(signInAcknowledgement);
    expect(runtimeSource).toContain('onLandingUserChange(user ?');
    expect(runtimeSource).toContain('displayName: user.displayName');
    expect(runtimeSource).toContain('email: user.email');
    expect(runtimeSource).toContain('photoURL: user.photoURL');
    expect(appSource).toContain('const [acknowledgedSignInRequest, setAcknowledgedSignInRequest] = useState(0);');
    expect(appSource).toContain('signInRequest={signInRequest > acknowledgedSignInRequest ? signInRequest : null}');
    expect(appSource).toContain("fallback={navigation.viewMode === 'landing' ? null :");

    expect(libraryRuntimeSource).not.toBe('');
    expect(learningCoordinationSource).not.toBe('');
    expect(physicalLineCount(libraryRuntimeSource)).toBeLessThanOrEqual(300);
    expect(physicalLineCount(learningCoordinationSource)).toBeLessThanOrEqual(350);

    expect(runtimeSource).toContain("from './useAppLibraryRuntime'");
    expect(runtimeSource).toContain("from './useAppLearningCoordination'");
    expect(appSource).not.toMatch(/from '\.\/features\/(?:librarySession\/(?:useLibrarySessionPorts|useLibrarySession|useLibraryCloudProjection)|learning\/useLearningWorkspace|intake\/useIntakeSharingSession|practice\/usePracticeWorkspace|library\/(?:useCardMediaHydration|useCustomDeckWorkspace|useLibraryScreenContract|libraryMutationRecovery)|importExport\/useLibraryExport|browser\/useBrowserCapabilities|catalog\/useLibraryCatalogQuery)'/);

    expect(libraryRuntimeSource).toContain('useLibraryCatalogQuery');
    expect(libraryRuntimeSource).toContain('useLibrarySessionPorts');
    expect(libraryRuntimeSource).toContain('useLibrarySession');
    expect(libraryRuntimeSource).toContain('useLibraryCloudProjection');
    expect(libraryRuntimeSource).toContain('useLibraryExport');
    expect(libraryRuntimeSource).toContain('useBrowserCapabilities');

    expect(learningCoordinationSource).toContain('usePracticeWorkspace');
    expect(learningCoordinationSource).toContain('useLearningWorkspace');
    expect(learningCoordinationSource).toContain('useIntakeSharingSession');
    expect(learningCoordinationSource).toContain('useCardMediaHydration');
    expect(learningCoordinationSource).toContain('useCustomDeckWorkspace');
    expect(learningCoordinationSource).toContain('useLibraryScreenContract');
  });

  it('keeps Catalog, Today and Progress composition in AppViewStage', () => {
    const runtimeSource = readIfPresent(runtimeUrl);
    const viewStageSource = readFileSync(new URL('./AppViewStage.tsx', import.meta.url), 'utf8');

    expect(runtimeSource).toContain('AppViewStage');
    expect(viewStageSource).toContain("import('../features/catalogWorkspace/CatalogWorkspace')");
    expect(viewStageSource).toContain("import('../features/dailyLearning/DailyLearningWorkspace')");
    expect(viewStageSource).toContain("import('../features/dailyLearning/ProgressWorkspace')");
  });
});
