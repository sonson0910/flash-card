/**
 * Playwright fixture for specs that need a real signed-in owner against the
 * Firebase Auth + Firestore emulators (the same emulator pair `npm run
 * test:rules` already drives — see firebase.json and package.json). It
 * replaces the retired guest-mode `localStorage` seeding
 * (`lingoflash_cards` / `lingoflash_cards_scoped_v1`) now that the app
 * requires sign-in to study: guest/local-only mode, the IndexedDB mirror, and
 * the offline queue were removed in favor of Firestore as the single source
 * of truth (plans/reports/fullstack-developer-260926-0917-offline-sidecar-removal.md).
 *
 * Split responsibilities:
 *  - `seedCards` writes directly to Firestore through firebase-admin, never
 *    through the browser. Order relative to navigation does not matter.
 *  - `signIn(page, url)` signs the test user in through a Firebase Auth
 *    custom token via a small test-only hook (`window.__SONFLASH_TEST__`)
 *    that `src/lib/firebase.ts` installs when built with
 *    `VITE_SONFLASH_E2E_EMULATOR=true`. That hook only exists once the app's
 *    lazy-loaded runtime bundle has been evaluated at least once, which only
 *    happens when the current view resolves to something other than
 *    `'landing'` (see `useAppNavigation.readAppViewMode` and
 *    `App.tsx`'s `runtimeActivated` gate). A bare `/` (or any URL without a
 *    routed `view=`) never loads that bundle, so `signIn` always visits a
 *    `view=today` "bootstrap" URL first to force it to load, signs in there,
 *    then navigates to the real `url` — see the `signIn` fixture body below
 *    for why a single `goto` is not enough (AppRuntime.tsx's signed-out
 *    bounce-to-landing effect is deterministic on a fresh browser context: the
 *    first `onAuthStateChanged` callback always reports no user before a
 *    queued `signInWithCustomToken` can resolve). If the hook is still
 *    missing after the bootstrap visit, `signIn`/`signInInPlace` fail fast
 *    with a descriptive error instead of hanging or silently talking to
 *    production.
 *
 * Call order inside a test: blockExternalNetwork(page) BEFORE signIn(page,
 * url) BEFORE any assertion. seedCards can run any time before the
 * assertions that depend on it.
 */
import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/** Matches the `demo-lingoflash` project firebase.json / test:rules already use. */
export const EMULATOR_PROJECT_ID = 'demo-lingoflash';
/** The single named Firestore database this app uses in every environment. */
export const EMULATOR_DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';

const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
// firebase-admin reads these from the environment; set them before the first
// initializeApp() call so admin traffic never reaches production, matching
// the pattern already used by firestore.rules.test.ts and the
// functions/test/*Firestore.integration.test.ts suite.
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = FIREBASE_AUTH_EMULATOR_HOST;

const [, EMULATOR_FIRESTORE_PORT] = FIRESTORE_EMULATOR_HOST.split(':');
const [, EMULATOR_AUTH_PORT] = FIREBASE_AUTH_EMULATOR_HOST.split(':');
// Matches firebase.json's emulators.functions.port and the host/port
// src/lib/firebase.ts's getSonFlashFunctions() calls connectFunctionsEmulator
// with in the e2e build. Every protected callable (createCard, reviewCardV2,
// bulkMutateCards, ...) now goes over this port instead of being aborted by
// blockExternalNetwork, so specs exercise the real callable path.
const FUNCTIONS_EMULATOR_HOST = process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001';
const [, EMULATOR_FUNCTIONS_PORT] = FUNCTIONS_EMULATOR_HOST.split(':');
const PREVIEW_PORT = '4173';

/**
 * Legacy guest-card literal shape every migrated spec already declares
 * inline (word/translation/createdAt plus assorted optional fields such as
 * reviews, reviewHistory, cefrLevel, exampleSentence, ...). Extra fields pass
 * through untouched into the seeded Firestore document.
 */
export interface GuestCard {
  id: string;
  word: string;
  translation: string;
  createdAt: string;
  language?: string;
  [field: string]: unknown;
}

export interface EmulatorTestUser {
  uid: string;
  email: string;
  customToken: string;
}

const MISSING_HOOK_MESSAGE = [
  '[e2e/fixtures/firebase-emulator] window.__SONFLASH_TEST__.signInWithCustomToken is not available.',
  'src/lib/firebase.ts only installs this hook once VITE_SONFLASH_E2E_EMULATOR=true AND the app has',
  'loaded its lazy runtime bundle (any view other than \'landing\' — see readAppViewMode). Either the',
  'build was not run with that flag, or this call navigated to a URL that resolves to the landing',
  'view and never evaluated the bundle at all.',
].join(' ');

type SonFlashTestHooks = {
  signInWithCustomToken(token: string): Promise<void>;
  getCurrentUid(): string | null;
};

declare global {
  interface Window {
    __SONFLASH_TEST__?: SonFlashTestHooks;
  }
}

/**
 * Matches `COURSE_TARGET_LANGUAGES`/`COURSE_NATIVE_LANGUAGES`
 * (functions/src/course-profile-contract.ts) as plain literals instead of
 * importing that module: the contract module also pulls in
 * firebase-admin-adjacent server code that has no reason to load inside a
 * Playwright fixture, and the enum values are stable wire constants, not an
 * implementation detail likely to drift silently.
 */
export type SeedCourseTargetLanguage = 'en' | 'ko' | 'ja' | 'zh';
export type SeedCourseNativeLanguage = 'vi' | 'en';

export interface SeedCourseProfileOptions {
  /**
   * When given, the seeded profile's one course becomes active with this
   * target language, so `useAppLibraryRuntime`'s course-scoped Today/Library/
   * practice queries see it instead of the no-profile default of 'en' (see
   * `languageProfileForCourse`/AppRuntime.tsx). Omit to keep the empty-courses
   * shape that only suppresses the onboarding overlay (OnboardingGate.tsx)
   * while leaving the default 'en' language scope untouched — the right
   * choice for the majority of specs, which seed English-language cards.
   */
  readonly targetLanguage?: SeedCourseTargetLanguage;
  /** Defaults to 'vi', SonFlash's primary native-language audience. */
  readonly nativeLanguage?: SeedCourseNativeLanguage;
}

interface EmulatorFixtures {
  db: Firestore;
  adminAuth: Auth;
  testUser: EmulatorTestUser;
  seedCards: (cards: readonly GuestCard[]) => Promise<void>;
  seedCourseProfile: (options?: SeedCourseProfileOptions) => Promise<void>;
  signIn: (page: Page, url: string) => Promise<void>;
  signInInPlace: (page: Page) => Promise<void>;
  blockExternalNetwork: (page: Page, extraPorts?: readonly number[]) => Promise<void>;
}

interface EmulatorWorkerFixtures {
  adminApp: App;
}

export const test = base.extend<EmulatorFixtures, EmulatorWorkerFixtures>({
  // One firebase-admin App per Playwright worker process; each worker needs a
  // uniquely named app because firebase-admin keys apps by name per process.
  adminApp: [async ({}, use, workerInfo) => {
    const app = initializeApp({ projectId: EMULATOR_PROJECT_ID }, `e2e-worker-${workerInfo.workerIndex}`);
    await use(app);
    await deleteApp(app);
  }, { scope: 'worker' }],

  adminAuth: async ({ adminApp }, use) => {
    await use(getAuth(adminApp));
  },

  db: async ({ adminApp }, use) => {
    await use(getFirestore(adminApp, EMULATOR_DATABASE_ID));
  },

  // A fresh Firebase Auth user per test, created directly against the
  // emulator through firebase-admin (never through the browser, never
  // against production). Deleted again after the test so emulator state does
  // not leak across specs in the same run.
  testUser: async ({ adminAuth }, use, testInfo) => {
    const uid = `e2e-${randomUUID()}`;
    const email = `${uid}@e2e.sonflash.test`;
    await adminAuth.createUser({
      uid,
      email,
      displayName: testInfo.title.slice(0, 60) || 'E2E test user',
    });
    const customToken = await adminAuth.createCustomToken(uid);
    await use({ uid, email, customToken });
    await adminAuth.deleteUser(uid).catch(() => undefined);
  },

  // Writes seeded cards straight to Firestore via firebase-admin, under
  // users/{uid}/cards/{id}, matching the CardData shape in src/types/card.ts.
  // `language` defaults to 'en' the same way the client and the createCard
  // callable both do post-migration (see cardRepository.ts
  // prepareTargetAwareCardForCreate / functions/src/cardPersistence.ts
  // canonicalCard). `libraryEpoch: 0` matches a freshly created test user who
  // never bumped their epoch.
  seedCards: async ({ db, testUser }, use) => {
    await use(async cards => {
      if (cards.length === 0) return;
      const batch = db.batch();
      const collection = db.collection('users').doc(testUser.uid).collection('cards');
      for (const card of cards) {
        const { id, ...fields } = card;
        // No `ownerId` field: CardData (and firestore.rules' canPatchOwnedCard
        // allow-list) has no such field on a card document — the owner is the
        // parent `users/{uid}` path segment. Writing it here used to be
        // harmless because nothing re-saved a seeded card, but any client
        // patch/bookmark/review on a card carrying it is rejected by
        // firestore.rules' isValidCardUpdate() with permission-denied.
        //
        // `id` IS kept as a document field below (not just the doc path):
        // a real `createCard` call persists `canonicalCard()`'s own `id`
        // into the document body (functions/src/cardPersistence.ts), and
        // `cardForValidation` (functions/src/reviewPersistence.ts) requires
        // `storedDoc.id === cardId` before it will validate a review
        // submission against that card — an id-less seed document always
        // fails that check with `identity-conflict`.
        batch.set(collection.doc(id), {
          ...fields,
          id,
          language: typeof fields.language === 'string' ? fields.language : 'en',
          libraryEpoch: typeof fields.libraryEpoch === 'number' ? fields.libraryEpoch : 0,
        });
      }
      await batch.commit();
    });
  },

  // Writes a minimal course-profile doc straight to Firestore under
  // users/{uid}/profile/courses via the Admin SDK (clients can't write this
  // path themselves; firestore.rules denies it). The onboarding lane's fix
  // suppresses the full-screen OnboardingJourney overlay
  // (src/features/onboarding/OnboardingJourney.tsx) once this doc exists,
  // whenever the cloud check has settled, and whenever the user already has
  // at least one card; only an EMPTY library with no course-profile doc still
  // needs this seed. The doc's existence is what matters — content is
  // otherwise unused, so this stays at the minimal empty-courses shape.
  // Call this before `signIn` in any spec that signs in with an empty
  // library and must not see onboarding.
  seedCourseProfile: async ({ db, testUser }, use) => {
    await use(async (options) => {
      const targetLanguage = options?.targetLanguage;
      const courseId = targetLanguage ? `e2e-course-${targetLanguage}` : null;
      await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').set({
        courses: targetLanguage ? [{
          id: courseId,
          targetLanguage,
          nativeLanguage: options?.nativeLanguage ?? 'vi',
          status: 'active',
          goals: [],
          preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
          createdAt: '2026-09-24T00:00:00.000Z',
        }] : [],
        activeCourseId: courseId,
      });
    });
  },

  // Aborts every request outside the Playwright preview server and the two
  // emulators, replacing the ad hoc
  // `page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, route => route.abort())`
  // pattern every migrated spec used to inline. This is also the safety net
  // that keeps a run with a not-yet-patched app from ever reaching production
  // Firebase: even if src/lib/firebase.ts tries to call a real project, the
  // request is aborted before it leaves the page. Pass extraPorts for specs
  // that also stand up their own local Vite fixture server (e.g. 4174/4175).
  blockExternalNetwork: async ({}, use) => {
    await use(async (page, extraPorts = []) => {
      const allowedPorts = new Set([
        PREVIEW_PORT, EMULATOR_FIRESTORE_PORT, EMULATOR_AUTH_PORT, EMULATOR_FUNCTIONS_PORT,
        ...extraPorts.map(String),
      ]);
      await page.route(
        url => url.hostname !== '127.0.0.1' || !allowedPorts.has(url.port),
        route => route.abort(),
      );
    });
  },

  // Signs the emulator test user into the already-loaded `page` through a
  // custom token via the test-only hook proposed for src/lib/firebase.ts
  // (see MISSING_HOOK_MESSAGE / the report). Fails fast and descriptively if
  // that hook is absent instead of hanging on a real Google popup or a
  // network call — blockExternalNetwork() would abort that call anyway, but
  // this gives a much clearer failure message naming exactly what is missing.
  // Use this (instead of signIn) when a test must stay on the current
  // document — e.g. asserting no extra navigation happened — and only needs
  // the identity to change, not a fresh page load.
  signInInPlace: async ({ testUser }, use) => use(async page => {
    const hookReady = await page.waitForFunction(
      () => typeof window.__SONFLASH_TEST__?.signInWithCustomToken === 'function',
      undefined,
      { timeout: 5_000 },
    ).then(() => true).catch(() => false);
    if (!hookReady) throw new Error(MISSING_HOOK_MESSAGE);

    await page.evaluate(async token => {
      await window.__SONFLASH_TEST__!.signInWithCustomToken(token);
    }, testUser.customToken);

    await page.waitForFunction(
      uid => window.__SONFLASH_TEST__?.getCurrentUid?.() === uid,
      testUser.uid,
      { timeout: 10_000 },
    );
  }),

  // Navigates to `url` and signs in there. Two-phase by necessity: a fresh,
  // unauthenticated load of `url` loses a deterministic race in
  // AppRuntime.tsx — Firebase Auth's first onAuthStateChanged callback
  // always reports "no user" before a just-queued signInWithCustomToken can
  // resolve, and AppRuntime's signed-out effect bounces the view to
  // 'landing' one-way with no code path that ever restores the original
  // view afterward, even once the user becomes truthy. So this first loads a
  // throwaway `view=today` bootstrap URL (forcing the lazy runtime bundle —
  // and the test hook it installs — to evaluate) and signs in there, which
  // persists a real Auth session (IndexedDB) in this browser context. Only
  // then does it navigate to the real `url`; that load's identity resolves
  // straight to "signed in" from the persisted session instead of racing the
  // bounce. If `url` itself resolves to the landing view (no routed
  // `view=`), the hook never loads there either — that is a deliberate
  // landing-view target, not a failure, so the final uid wait is skipped.
  signIn: async ({ signInInPlace, testUser }, use) => {
    await use(async (page, url) => {
      const bootstrapUrl = new URL(url, 'http://sonflash.e2e.invalid');
      bootstrapUrl.searchParams.set('view', 'today');
      await page.goto(`${bootstrapUrl.pathname}?${bootstrapUrl.searchParams.toString()}`);
      await signInInPlace(page);
      await page.goto(url);
      const hookLoaded = await page.evaluate(
        () => typeof window.__SONFLASH_TEST__?.getCurrentUid === 'function',
      );
      if (hookLoaded) {
        await page.waitForFunction(
          uid => window.__SONFLASH_TEST__?.getCurrentUid?.() === uid,
          testUser.uid,
          { timeout: 10_000 },
        );
      }
    });
  },
});

export { expect };
export type { Page } from '@playwright/test';
