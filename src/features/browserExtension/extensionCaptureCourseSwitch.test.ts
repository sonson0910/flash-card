import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_EXTENSION_IMPORT_STORAGE_KEY, type BrowserExtensionImportBrowser, type BrowserExtensionImportStorage } from './browserExtensionImport';
import { startBrowserExtensionImportRuntime } from './browserExtensionImportRuntime';
import { activeCourseNativeLanguage, languageProfileForCourse } from '../courses/courseLanguageProfile';
import type { Course, CourseProfile } from '../courses/courseModel';
import type { CoursePort, CourseProfileListener } from '../courses/coursePort';
import { createCourseSessionController } from '../courses/courseSessionController';
import type { CardIntakeControllerPort, CardIntakeDraftPort } from '../intake/cardIntakeController';
import { createCardIntakeBindingOwner, type CardIntakeBindingOptions } from '../intake/useCardIntake';
import { createSharedDeckCoursePort, resolveShareCourseAction } from '../sharing/shareCourseMatching';
import type { SharedDeckIncomingPreview } from '../sharing/sharedDeckSessionController';
import type { CardData } from '../../types/card';

class MemoryStorage implements BrowserExtensionImportStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const course = (id: string, targetLanguage: Course['targetLanguage']): Course => ({
  id,
  targetLanguage,
  nativeLanguage: 'vi',
  status: 'active',
  goals: [],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
});

const englishActive: CourseProfile = { activeCourseId: 'course-en', courses: [course('course-en', 'en'), course('course-ko', 'ko')] };
const koreanActive: CourseProfile = { ...englishActive, activeCourseId: 'course-ko' };

describe('silent extension capture that needs a course switch', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('generates and saves the word in the course the learner just switched to, even when the profile listener lags the callable', async () => {
    vi.stubGlobal('postMessage', () => undefined);

    // Course profile: one Firestore listener plus callables, as firebaseCourseAdapter wires it.
    // The callable answers first; the listener snapshot carrying the new active course lands 30 ms later
    // (the two travel on independent channels).
    let onProfile: CourseProfileListener | null = null;
    const reject = () => Promise.reject(new Error('not used'));
    const coursePort: CoursePort = {
      available: true,
      load: reject,
      subscribe: (_owner, listener) => {
        onProfile = listener;
        listener({ source: 'cloud', profile: englishActive });
        return () => undefined;
      },
      createCourse: reject,
      updateCourse: reject,
      archiveCourse: reject,
      reopenCourse: reject,
      setActiveCourse: async () => {
        setTimeout(() => onProfile?.({ source: 'cloud', profile: koreanActive }), 30);
        return koreanActive;
      },
      addGoal: reject,
      updateGoal: reject,
      removeGoal: reject,
    };
    const courses = createCourseSessionController(async () => coursePort);
    await courses.activate('owner-1');
    expect(courses.getSnapshot().activeCourse?.targetLanguage).toBe('en');

    // Card intake port: records the language pair each AI generation and save uses.
    const generatedWith: string[] = [];
    const saved: CardData[] = [];
    const cardsPort: CardIntakeControllerPort = {
      findExisting: async () => new Map(),
      persistStructured: async plan => ({ createdCount: plan.creates.length }),
      touchExisting: async () => undefined,
      generate: async () => ({ created: true, category: 'Imported' }),
      completeFlat: async () => undefined,
      generateCard: async request => {
        generatedWith.push(request.language.id);
        return {
          card: {
            id: `word-${request.term}`, word: request.term, normalizedWord: request.term,
            language: request.language.source.code, translationLanguage: request.language.target.code,
            translation: 't', explanation: '', phonetic: '', emoji: '', category: 'General',
            audioUrl: null, imageUrl: null, origin: 'ai', createdAt: '2026-11-23T00:00:00.000Z',
          } as CardData,
          mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
        };
      },
      persistCards: async cards => {
        saved.push(...cards);
        return cards.map(card => ({ card, created: true }));
      },
      createConfirmedCatalogCards: async cards => ({ status: 'completed' as const, cards, createdCount: cards.length, reusedCount: 0 }),
      applyMedia: async () => undefined,
    };
    let draftValue: string | null = null;
    const draft: CardIntakeDraftPort = {
      read: () => draftValue,
      write: value => { draftValue = value; },
      clear: () => { draftValue = null; },
    };
    const bindingOptions = (): CardIntakeBindingOptions => ({
      ownerKey: 'owner-1',
      ports: { cards: cardsPort, draft },
      language: languageProfileForCourse(courses.getSnapshot().activeCourse),
    });
    const intake = createCardIntakeBindingOwner(bindingOptions());
    // AppRuntime rebinds the intake controller to the new pair after React re-renders with the new
    // active course. Most favourable timing for the code: rebind synchronously, the moment the
    // course session publishes.
    courses.subscribe(() => intake.replace(bindingOptions()));

    // A capture gate that switches to the matching course before it lets the capture proceed.
    const ensureCaptureCourse = async (targetLanguage: Course['targetLanguage']) => {
      const session = { model: courses.getSnapshot(), actions: courses.actions };
      const preview: SharedDeckIncomingPreview = {
        shareId: '', category: '', cardCount: 0, sampleWords: [], createdAt: null, expiresAt: null, containsAiGeneratedCards: false,
        languagePairs: [{ targetLanguage, translationLanguage: activeCourseNativeLanguage(session.model.activeCourse) }],
      };
      const decision = resolveShareCourseAction(preview, session.model.profile);
      if (!decision || decision.action === 'none') return 'proceed' as const;
      await createSharedDeckCoursePort(session).ensureCourseForIncomingShare(preview);
      return 'proceed' as const;
    };

    const storage = new MemoryStorage();
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3, id: 'intent_korean_capture_123', nonce: 'nonce_123456789012345678',
      text: '회복력', createdAt: Date.now(), mode: 'silent', sourceLanguage: 'ko',
    }));
    const browser: BrowserExtensionImportBrowser = {
      getCurrentUrl: () => 'https://app.example.test/?view=library',
      replaceLocation: () => undefined,
      getSessionStorage: () => storage,
      listenHashChange: () => () => undefined,
      listenMessage: () => () => undefined,
      postMessage: () => undefined,
      isTopFrame: () => true,
    };
    const runtime = startBrowserExtensionImportRuntime({
      ownerId: 'owner-1',
      identityLoading: false,
      customDecks: [],
      libraryReady: true,
      isBusy: false,
      changeDraft: intake.actions.changeDraft,
      generate: intake.actions.generate,
      openLibrary: () => undefined,
      notify: () => undefined,
      reportError: () => undefined,
      ensureCaptureCourse,
    }, browser);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    runtime.dispose();

    // The switch happened: the account's active course is now Korean.
    expect(courses.getSnapshot().activeCourse?.targetLanguage).toBe('ko');
    // So the Korean word must be generated and saved as a Korean card.
    expect(generatedWith).toEqual(['ko-vi']);
    expect(saved.map(card => card.language)).toEqual(['ko']);
  });
});
