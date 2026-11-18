import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CourseContext, type CourseGateValue } from '../courses/CourseGate';
import { OnboardingGate } from './OnboardingGate';
import { onboardingCourseInput, OnboardingJourney, useOnboardingReminderSaveLock } from './OnboardingJourney';
import { writeOnboardingDraft } from './onboardingDraft';
import { writeOnboardingResumeStep } from './onboardingModel';

i18n.load('en', {});
i18n.activate('en');

const snapshot = (source: 'cloud' | 'absent'): CourseGateValue => ({
  model: {
    status: 'ready', source, pending: false, errorCode: null,
    profile: { activeCourseId: null, courses: [] },
    activeCourse: null,
  },
  actions: {} as CourseGateValue['actions'],
});

const renderGate = (props: { ownerId: string | null; suppress: boolean; hasCards?: boolean }, source: 'cloud' | 'absent' = 'absent') =>
  renderToStaticMarkup(<I18nProvider i18n={i18n}>
    <CourseContext.Provider value={snapshot(source)}><OnboardingGate hasCards={false} libraryReady {...props} /></CourseContext.Provider>
  </I18nProvider>);

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

describe('OnboardingGate', () => {
  it('mounts a reminder save lock that blocks Back, forward, Finish, and dismissal until save success or explicit skip', () => {
    let saveState!: (state: { readonly saving: boolean; readonly failed: boolean }) => void;
    let skipFailedSave!: () => void;
    let locked = false;
    let backCalls = 0;
    let skipCalls = 0;
    let forwardCalls = 0;
    let finishCalls = 0;
    function Probe() {
      const lock = useOnboardingReminderSaveLock();
      saveState = lock.onSaveStateChange;
      skipFailedSave = lock.skipFailedSave;
      locked = lock.locked;
      return null;
    }
    const root = createRoot(installMinimalReactDom());
    const attempt = (action: 'back' | 'skip' | 'forward' | 'finish') => {
      if (locked) return;
      if (action === 'back') backCalls++;
      if (action === 'skip') skipCalls++;
      if (action === 'forward') forwardCalls++;
      if (action === 'finish') finishCalls++;
    };
    try {
      act(() => root.render(<Probe />));
      act(() => saveState({ saving: true, failed: false }));
      attempt('back'); attempt('skip'); attempt('forward'); attempt('finish');
      expect([backCalls, skipCalls, forwardCalls, finishCalls]).toEqual([0, 0, 0, 0]);

      act(() => saveState({ saving: false, failed: true }));
      attempt('back'); attempt('skip'); attempt('forward'); attempt('finish');
      expect([backCalls, skipCalls, forwardCalls, finishCalls]).toEqual([0, 0, 0, 0]);

      act(() => skipFailedSave());
      attempt('back'); attempt('skip'); attempt('forward'); attempt('finish');
      expect([backCalls, skipCalls, forwardCalls, finishCalls]).toEqual([1, 1, 1, 1]);
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('renders nothing without a signed-in owner, even if the profile is absent', () => {
    expect(renderGate({ ownerId: null, suppress: false })).toBe('');
  });

  it('renders nothing when suppressed, even though the profile is absent and onboarding would otherwise be needed', () => {
    expect(renderGate({ ownerId: 'owner-1', suppress: true })).toBe('');
  });

  it('renders nothing once a course profile document already exists, regardless of suppress', () => {
    expect(renderGate({ ownerId: 'owner-1', suppress: false }, 'cloud')).toBe('');
  });

  it('takes the onboarding branch without throwing for a genuinely new, unsuppressed owner', () => {
    expect(() => renderGate({ ownerId: 'owner-1', suppress: false }, 'absent')).not.toThrow();
  });

  it('renders the first journey step with a modal contract and language choices', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-1" /></CourseContext.Provider>
    </I18nProvider>);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Choose your language');
    expect(html).toContain('Tiếng Việt');
    expect(html).toContain('English');
    expect(html).toContain('Continue');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('min-h-20');
  });

  it('resumes at the saved reminder step with its owner-scoped reminder controls', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      writeOnboardingResumeStep('owner-resume', 'reminder');
      writeOnboardingDraft('owner-resume', {
        nativeLanguage: 'vi', targetLanguage: 'ko', goalKind: 'topik', goalLevel: 'II',
        goalTargetDate: '2027-05-12', zhScript: null, pace: 15,
      });
      const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-resume" /></CourseContext.Provider>
      </I18nProvider>);

      expect(html).toContain('aria-valuenow="6"');
      expect(html).toContain('Daily reminders');
      expect(html).toContain('Choose when SonFlash can remind you to review.');
      expect(html).toContain('aria-label="Study reminders"');
      expect(html).toContain('Loading reminders…');
      expect(html).not.toContain('Sign in to set reminders.');
      expect(html).toContain('Start learning');
      expect(html).toContain('Back');
      expect(html).not.toContain('Choose your language');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns to target choice when an older saved step has no target draft', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'reminder') });
    try {
      const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-old-resume" /></CourseContext.Provider>
      </I18nProvider>);
      expect(html).toContain('aria-valuenow="2"');
      expect(html).toContain('What are you learning?');
      expect(html).not.toContain('Start learning');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders all four real pace choices in the desktop grid', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      writeOnboardingResumeStep('owner-pace', 'pace');
      writeOnboardingDraft('owner-pace', {
        nativeLanguage: 'vi', targetLanguage: 'ko', goalKind: null, goalLevel: '',
        goalTargetDate: '', zhScript: null, pace: 10,
      });
      const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-pace" /></CourseContext.Provider>
      </I18nProvider>);

      expect(html).toContain('onboarding-pace-grid');
      expect(html).toContain('sm:grid-cols-4');
      expect(html).toContain('5 cards / day');
      expect(html).toContain('10 cards / day');
      expect(html).toContain('15 cards / day');
      expect(html).toContain('20 cards / day');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restores the selected goal and the Continue action', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      writeOnboardingResumeStep('owner-goal', 'goal');
      writeOnboardingDraft('owner-goal', {
        nativeLanguage: 'vi', targetLanguage: 'en', goalKind: 'ielts', goalLevel: '',
        goalTargetDate: '', zhScript: null, pace: 10,
      });
      const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-goal" /></CourseContext.Provider>
      </I18nProvider>);

      expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?IELTS/);
      expect(html.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(6);
      expect(html).toContain('Continue');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps selected goal details and Chinese script in the course creation input', () => {
    expect(onboardingCourseInput({
      targetLanguage: 'zh', nativeLanguage: 'vi', goalKind: 'hsk', goalLevel: ' HSK 4 ', goalTargetDate: '2027-01-17', zhScript: 'hant',
    })).toEqual({
      targetLanguage: 'zh', nativeLanguage: 'vi', activateOnCreate: true, goals: [{ kind: 'hsk', level: 'HSK 4', targetDate: '2027-01-17' }], preferences: { zhScript: 'hant' },
    });
    expect(onboardingCourseInput({
      targetLanguage: 'ja', nativeLanguage: 'vi', goalKind: null, goalLevel: '', goalTargetDate: '', zhScript: null,
    })).toEqual({ targetLanguage: 'ja', nativeLanguage: 'vi', activateOnCreate: true, goals: [] });
    expect(onboardingCourseInput({
      targetLanguage: 'zh', nativeLanguage: 'vi', goalKind: null, goalLevel: '', goalTargetDate: '', zhScript: null,
    })).toEqual({ targetLanguage: 'zh', nativeLanguage: 'vi', activateOnCreate: true, goals: [], preferences: { zhScript: 'hans' } });
  });
});
