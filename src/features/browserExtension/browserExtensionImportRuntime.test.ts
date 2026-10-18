import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { captureFailureMessage } from '../../lib/captureFailureMessage';
import { CourseError } from '../courses/courseModel';
import { createSharedDeckCoursePort } from '../sharing/shareCourseMatching';
import {
  BROWSER_EXTENSION_IMPORT_STORAGE_KEY,
  BROWSER_EXTENSION_IMPORT_OWNER_STORAGE_KEY,
  readPendingBrowserExtensionImportOwner,
  type BrowserExtensionImportBrowser,
  type BrowserExtensionImportStorage,
} from './browserExtensionImport';
import {
  startBrowserExtensionImportRuntime,
  type BrowserExtensionImportOptions,
} from './browserExtensionImportRuntime';

describe('capture error guidance', () => {
  it('keeps quota and spend refusals actionable in Vietnamese', () => {
    for (const reason of ['ai-card-quota', 'ai-daily-allowance', 'account-daily-spend', 'service-daily-cap']) {
      const error = classifyProtectedFunctionError({ code: 'functions/resource-exhausted', details: { reason } }, 'AI generation');
      expect(captureFailureMessage(error)).toMatch(/hạn mức|lượt|thẻ AI/);
    }
    expect(captureFailureMessage(classifyProtectedFunctionError({ code: 'functions/unauthenticated' }, 'AI generation')))
      .toContain('đăng nhập Google');
    expect(captureFailureMessage(classifyProtectedFunctionError({ code: 'functions/deadline-exceeded' }, 'AI generation')))
      .toContain('thử lại');
  });
});

class MemoryStorage implements BrowserExtensionImportStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class OwnerBindingWriteFailureStorage extends MemoryStorage {
  setItem(key: string, value: string): void {
    if (key === BROWSER_EXTENSION_IMPORT_OWNER_STORAGE_KEY) throw new Error('quota exceeded');
    super.setItem(key, value);
  }
}

const createBrowser = (url: string, storage = new MemoryStorage(), topFrame = true) => {
  const messages: unknown[] = [];
  const listeners = new Set<(event: { source: unknown; origin: string; data: unknown }) => void>();
  const browser: BrowserExtensionImportBrowser = {
    getCurrentUrl: () => url,
    replaceLocation: () => undefined,
    getSessionStorage: () => storage,
    listenHashChange: () => () => undefined,
    listenMessage: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    postMessage: message => messages.push(message),
    isTopFrame: () => topFrame,
  };
  return {
    browser,
    messages,
    storage,
    dispatchMessage: (data: unknown) => {
      for (const listener of listeners) {
        listener({
          source: globalThis,
          origin: 'https://app.example.test',
          data,
        });
      }
    },
  };
};

const nonce = 'nonce_123456789012345678';

const optionsFor = (
  generate: BrowserExtensionImportOptions['generate'],
  overrides: { changeDraft?: (value: string) => void; openLibrary?: () => void } = {},
) => ({
  ownerId: 'user-1',
  identityLoading: false,
  customDecks: ['Reading'],
  libraryReady: true,
  isBusy: false,
  changeDraft: overrides.changeDraft ?? (() => undefined),
  generate,
  openLibrary: overrides.openLibrary ?? (() => undefined),
  notify: () => undefined,
  reportError: () => undefined,
});

const encodePayload = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

describe('browser extension import runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not process verified storage from a subframe', async () => {
    const now = Date.now();
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_subframe_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    const { browser } = createBrowser('https://app.example.test/?view=library', storage, false);
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();
    expect(generated).toBe(0);
  });

  it('does not let a same-id stale nonce block the current pending intent', async () => {
    const now = Date.now();
    const storage = new MemoryStorage();
    const firstNonce = 'nonce_A_123456789012345678';
    const secondNonce = 'nonce_B_123456789012345678';
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_same_id_123',
      nonce: firstNonce,
      text: 'first',
      createdAt: now,
      mode: 'silent',
    }));
    const { browser, storage: browserStorage } = createBrowser('https://app.example.test/?view=library', storage);
    let generated = 0;
    let draft = '';
    const initialOptions = optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('expected test failure') };
    }, { changeDraft: value => { draft = value; } });
    initialOptions.identityLoading = true;
    const runtime = startBrowserExtensionImportRuntime(initialOptions, browser);

    browserStorage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_same_id_123',
      nonce: secondNonce,
      text: 'second',
      createdAt: now,
      mode: 'silent',
    }));
    runtime.acceptVerifiedIntent({
      v: 3,
      id: 'intent_same_id_123',
      nonce: secondNonce,
      text: 'second',
      createdAt: now,
      mode: 'silent',
    });
    runtime.update({ ...initialOptions, identityLoading: false });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(1);
    expect(draft).toBe('second');
  });

  it('does not process a raw URL hash without a verified pending intent', async () => {
    const rawUrl = `https://app.example.test/?view=library#lf-import=${encodePayload({
      v: 3,
      id: 'intent_forged_123',
      nonce,
      text: 'forged',
      createdAt: Date.now(),
      mode: 'silent',
    })}`;
    const { browser } = createBrowser(rawUrl);
    let generated = 0;

    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });

  it('processes only a verified silent intent from session storage', async () => {
    const now = Date.now();
    const { browser, storage, messages } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_verified_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    let generated = 0;

    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('expected test failure') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(1);
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'LINGOFLASH_EXTENSION_IMPORT_CLAIMED',
      payload: { id: 'intent_verified_123', nonce },
    }));
  });

  it('passes verified page context and deck routing to card generation', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_context_123',
      nonce,
      text: 'lead',
      context: 'The lead actor arrived.',
      requestedDeck: 'Reading',
      createdAt: now,
      mode: 'silent',
    }));
    let generationOptions: unknown;

    const runtime = startBrowserExtensionImportRuntime(optionsFor(async options => {
      generationOptions = options;
      return { status: 'failed', error: new Error('expected test failure') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generationOptions).toMatchObject({
      context: 'The lead actor arrived.',
      surface: 'extension',
      requestedDeck: 'Reading',
      requestedDeckAvailable: expect.any(Function),
    });
  });

  it('passes verified captured source url and page title to card generation', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_source_123',
      nonce,
      text: 'lead',
      sourceUrl: 'https://example.com/article',
      pageTitle: 'An Example Article',
      createdAt: now,
      mode: 'silent',
    }));
    let generationOptions: unknown;

    const runtime = startBrowserExtensionImportRuntime(optionsFor(async options => {
      generationOptions = options;
      return { status: 'failed', error: new Error('expected test failure') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generationOptions).toMatchObject({
      surface: 'extension',
      sourceUrl: 'https://example.com/article',
      pageTitle: 'An Example Article',
    });
  });

  it('does not claim a ready message whose sourceUrl does not match what was actually written to storage', async () => {
    const now = Date.now();
    const { browser, storage, dispatchMessage } = createBrowser('https://app.example.test/?view=library');
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);

    // The storage write happens only after the runtime has already started
    // (and found nothing pending), so the later ready message is the first
    // and only claim attempt for this id — exercising `isBackedByVerifiedStorage`
    // for real rather than the bootstrap `capturePending()` path.
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_source_tamper_123',
      nonce,
      text: 'lead',
      sourceUrl: 'https://example.com/article',
      createdAt: now,
      mode: 'silent',
    }));
    dispatchMessage({
      source: 'lingoflash-extension-bridge',
      type: 'LINGOFLASH_EXTENSION_IMPORT_READY',
      payload: {
        v: 3,
        id: 'intent_source_tamper_123',
        nonce,
        text: 'lead',
        sourceUrl: 'https://forged.example/',
        createdAt: now,
        mode: 'silent',
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });

  it('does not claim a ready message whose sourceLanguage does not match what was actually written to storage', async () => {
    const now = Date.now();
    const { browser, storage, dispatchMessage } = createBrowser('https://app.example.test/?view=library');
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);

    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_language_tamper_123',
      nonce,
      text: 'lead',
      sourceLanguage: 'ko',
      createdAt: now,
      mode: 'silent',
    }));
    dispatchMessage({
      source: 'lingoflash-extension-bridge',
      type: 'LINGOFLASH_EXTENSION_IMPORT_READY',
      payload: {
        v: 3,
        id: 'intent_language_tamper_123',
        nonce,
        text: 'lead',
        sourceLanguage: 'en',
        createdAt: now,
        mode: 'silent',
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });

  it('ignores a ready message whose nonce is not backed by verified storage', async () => {
    const now = Date.now();
    const { browser, storage, dispatchMessage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_nonce_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);
    dispatchMessage({
      source: 'lingoflash-extension-bridge',
      type: 'LINGOFLASH_EXTENSION_IMPORT_READY',
      payload: { v: 3, id: 'intent_nonce_123', nonce: 'nonce_wrong_123456789012345678', text: 'resilient', createdAt: now, mode: 'silent' },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();
    expect(generated).toBe(1);
  });

  it('ignores a same-origin ready message that is not backed by verified storage', async () => {
    const { browser, dispatchMessage } = createBrowser('https://app.example.test/?view=library');
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);

    dispatchMessage({
      source: 'lingoflash-extension-bridge',
      type: 'LINGOFLASH_EXTENSION_IMPORT_READY',
      payload: {
        v: 3,
        id: 'intent_forged_123',
        nonce,
        text: 'forged',
        createdAt: Date.now(),
        mode: 'silent',
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });

  it('fails closed when verified session storage is unavailable', async () => {
    const { browser, dispatchMessage } = createBrowser('https://app.example.test/?view=library');
    browser.getSessionStorage = () => null;
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);

    dispatchMessage({
      source: 'lingoflash-extension-bridge',
      type: 'LINGOFLASH_EXTENSION_IMPORT_READY',
      payload: {
        v: 3,
        id: 'intent_no_storage_123',
        nonce,
        text: 'forged',
        createdAt: Date.now(),
        mode: 'silent',
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });

  it('only fills the draft for an unverified intent and never generates', async () => {
    const { browser } = createBrowser('https://app.example.test/?view=library');
    let generated = 0;
    let draft = '';
    let opened = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }, {
      changeDraft: value => { draft = value; },
      openLibrary: () => { opened += 1; },
    }), browser);

    runtime.acceptUnverifiedIntent({
      v: 3,
      id: 'intent_manual_123',
      nonce,
      text: 'forged',
      createdAt: Date.now(),
      mode: 'silent',
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(draft).toBe('forged');
    expect(opened).toBe(1);
    expect(generated).toBe(0);
  });

  it('drops a silent capture with no side effects when ensureCaptureCourse resolves cancel', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_course_mismatch_cancel_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    const posted: unknown[] = [];
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    let generated = 0;
    const options = {
      ...optionsFor(async () => {
        generated += 1;
        return { status: 'failed' as const, error: new Error('should not run') };
      }),
      ensureCaptureCourse: async () => 'cancel' as const,
    };

    const runtime = startBrowserExtensionImportRuntime(options, browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).toBeNull();
    expect(posted).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        id: 'intent_course_mismatch_cancel_123',
        status: 'error',
        message: 'Import cancelled: switch to a matching course, then capture the word again.',
      }),
    }));

    const secondRuntime = startBrowserExtensionImportRuntime(options, browser);
    await new Promise(resolve => setImmediate(resolve));
    secondRuntime.dispose();
    expect(generated).toBe(0);
  });

  it('generates once ensureCaptureCourse resolves proceed', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_course_mismatch_proceed_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    let generated = 0;
    let gateCalls = 0;
    const runtime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => {
        generated += 1;
        return { status: 'failed' as const, error: new Error('expected test failure') };
      }),
      ensureCaptureCourse: async () => {
        gateCalls += 1;
        return 'proceed' as const;
      },
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(gateCalls).toBe(1);
    expect(generated).toBe(1);
  });

  it('passes the extension\'s captured target language to ensureCaptureCourse, defaulting to en when the extension reported none', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_no_source_language_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    const seenTargetLanguages: string[] = [];
    const runtime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('expected test failure') })),
      ensureCaptureCourse: async targetLanguage => {
        seenTargetLanguages.push(targetLanguage);
        return 'proceed' as const;
      },
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(seenTargetLanguages).toEqual(['en']);
  });

  it('passes the extension\'s synced course target language to ensureCaptureCourse when the extension reported one', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_korean_source_language_123',
      nonce,
      text: '회복력',
      createdAt: now,
      mode: 'silent',
      sourceLanguage: 'ko',
    }));
    const seenTargetLanguages: string[] = [];
    const runtime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('expected test failure') })),
      ensureCaptureCourse: async targetLanguage => {
        seenTargetLanguages.push(targetLanguage);
        return 'proceed' as const;
      },
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(seenTargetLanguages).toEqual(['ko']);
  });

  it('drops a silent capture when ensureCaptureCourse rejects', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_course_mismatch_error_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    const posted: unknown[] = [];
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    let generated = 0;
    const actions = {
      createCourse: vi.fn().mockResolvedValue({
        ok: false,
        error: new CourseError('cloud-write-failed', 'course lookup failed'),
      }),
      reopenCourse: vi.fn(), switchCourse: vi.fn(), updateCourse: vi.fn(), archiveCourse: vi.fn(),
      addGoal: vi.fn(), updateGoal: vi.fn(), removeGoal: vi.fn(), clearError: vi.fn(),
    };
    const coursePort = createSharedDeckCoursePort({
      model: { status: 'ready', source: 'cloud', profile: null, activeCourse: null, pending: false, errorCode: null },
      actions: actions as never,
    });
    const runtime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => {
        generated += 1;
        return { status: 'failed' as const, error: new Error('expected test failure') };
      }),
      ensureCaptureCourse: async () => {
        await coursePort.ensureCourseForIncomingShare({
          shareId: '', category: '', cardCount: 0, sampleWords: [],
          languagePairs: [{ targetLanguage: 'en', translationLanguage: 'vi' }],
          createdAt: null, expiresAt: null, containsAiGeneratedCards: false,
        });
        return 'proceed';
      },
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
    expect(actions.createCourse).toHaveBeenCalledWith({
      targetLanguage: 'en', nativeLanguage: 'vi', activateOnCreate: true,
    });
    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).toBeNull();
    expect(posted).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        id: 'intent_course_mismatch_error_123',
        status: 'error',
        message: 'Could not prepare the matching course. The word was not saved.',
      }),
    }));
  });

  it('does not generate the same verified operation again after an app reload', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_reload_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    let generated = 0;
    const generate = async () => {
      generated += 1;
      return { status: 'failed' as const, error: new Error('expected test failure') };
    };

    const firstRuntime = startBrowserExtensionImportRuntime(optionsFor(generate), browser);
    await new Promise(resolve => setImmediate(resolve));
    firstRuntime.dispose();
    const reloadedRuntime = startBrowserExtensionImportRuntime(optionsFor(generate), browser);
    await new Promise(resolve => setImmediate(resolve));
    reloadedRuntime.dispose();

    expect(generated).toBe(1);
  });

  it('drops an anonymous pending capture when its first owner changes, including a switch back', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3, id: 'intent_owner_switch_123', nonce, text: 'first owner', createdAt: now, mode: 'silent',
    }));
    const drafts: string[] = [];
    let generated = 0;
    const initial = {
      ...optionsFor(async () => {
        generated += 1;
        return { status: 'failed' as const, error: new Error('should not run') };
      }, { changeDraft: value => { drafts.push(value); } }),
      ownerId: null,
      identityLoading: true,
    };
    const runtime = startBrowserExtensionImportRuntime(initial, browser);
    runtime.update({ ...initial, ownerId: 'owner-a', identityLoading: false, libraryReady: false });
    runtime.update({ ...initial, ownerId: 'owner-b', identityLoading: false, libraryReady: true });
    runtime.update({ ...initial, ownerId: 'owner-a', identityLoading: false, libraryReady: true });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(drafts).toEqual(['first owner']);
    expect(generated).toBe(0);
    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).toBeNull();
  });

  it('rejects an A-owned replay after a reload starts under B', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    const intent = {
      v: 3 as const, id: 'intent_reload_owner_123', nonce, text: 'bound', createdAt: now, mode: 'silent' as const,
    };
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify(intent));
    const posted: unknown[] = [];
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const aRuntime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('should not run') })),
      ownerId: 'owner-a',
      libraryReady: false,
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    aRuntime.dispose();
    expect(readPendingBrowserExtensionImportOwner(storage, intent)).toBe('owner-a');

    let bDrafts = 0;
    let bGenerated = 0;
    const bRuntime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => {
        bGenerated += 1;
        return { status: 'failed' as const, error: new Error('should not run') };
      }, { changeDraft: () => { bDrafts += 1; } }),
      ownerId: 'owner-b',
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    bRuntime.dispose();

    expect(bDrafts).toBe(0);
    expect(bGenerated).toBe(0);
    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).toBeNull();
    expect(posted.filter(message => (
      typeof message === 'object' && message !== null
      && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_RESULT'
    ))).toHaveLength(1);
  });

  it('fails closed when the owner binding cannot persist before a reload', async () => {
    const now = Date.now();
    const storage = new OwnerBindingWriteFailureStorage();
    const { browser } = createBrowser('https://app.example.test/?view=library', storage);
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3, id: 'intent_binding_write_123', nonce, text: 'bound', createdAt: now, mode: 'silent',
    }));
    const aRuntime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('should not run') })),
      ownerId: 'owner-a',
      libraryReady: false,
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    aRuntime.dispose();

    let bGenerated = 0;
    const bRuntime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => {
        bGenerated += 1;
        return { status: 'failed' as const, error: new Error('should not run') };
      }),
      ownerId: 'owner-b',
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    bRuntime.dispose();

    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).toBeNull();
    expect(bGenerated).toBe(0);
  });

  it('reports a single terminal result when a claimed capture is invalidated by an owner switch', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3, id: 'intent_owner_result_123', nonce, text: 'bound', createdAt: now, mode: 'silent',
    }));
    const posted: unknown[] = [];
    vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
    const runtime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('should not run') })),
      ownerId: 'owner-a',
      libraryReady: false,
    }, browser);
    runtime.update({ ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('should not run') })), ownerId: 'owner-b' });
    runtime.update({ ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('should not run') })), ownerId: 'owner-a' });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    const results = posted.filter(message => (
      typeof message === 'object' && message !== null
      && (message as { type?: unknown }).type === 'LINGOFLASH_EXTENSION_RESULT'
    ));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ payload: { id: 'intent_owner_result_123', status: 'error' } });
  });

  it('stops a busy retry after the owner changes, while allowing a fresh capture for that owner', async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const { browser, storage } = createBrowser('https://app.example.test/?view=library');
      storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
        v: 3, id: 'intent_owner_retry_123', nonce, text: 'old owner', createdAt: now, mode: 'silent',
      }));
      const drafts: string[] = [];
      let generated = 0;
      let freshGenerated = 0;
      const runtime = startBrowserExtensionImportRuntime({
        ...optionsFor(async () => {
          generated += 1;
          return { status: 'busy' as const };
        }, { changeDraft: value => { drafts.push(value); } }),
      }, browser);
      await vi.runAllTicks();
      runtime.update({
        ...optionsFor(async () => {
          freshGenerated += 1;
          return { status: 'failed' as const, error: new Error('expected test failure') };
        }, { changeDraft: value => { drafts.push(value); } }),
        ownerId: 'owner-b',
      });
      await vi.advanceTimersByTimeAsync(250);

      storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
        v: 3, id: 'intent_owner_fresh_123', nonce, text: 'new owner', createdAt: now, mode: 'silent',
      }));
      runtime.acceptVerifiedIntent({ v: 3, id: 'intent_owner_fresh_123', nonce, text: 'new owner', createdAt: now, mode: 'silent' });
      await vi.runAllTicks();
      runtime.dispose();

      expect(generated).toBe(1);
      expect(freshGenerated).toBe(1);
      expect(drafts).toEqual(['old owner', 'new owner']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not generate after an owner change while ensureCaptureCourse is still pending', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3, id: 'intent_owner_course_123', nonce, text: 'deferred', createdAt: now, mode: 'silent',
    }));
    let release: ((decision: 'proceed') => void) | undefined;
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime({
      ...optionsFor(async () => {
        generated += 1;
        return { status: 'failed' as const, error: new Error('should not run') };
      }),
      ensureCaptureCourse: () => new Promise(resolve => { release = resolve; }),
    }, browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.update({ ...optionsFor(async () => ({ status: 'failed' as const, error: new Error('should not run') })), ownerId: 'owner-b' });
    release?.('proceed');
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).toBeNull();
  });
});
