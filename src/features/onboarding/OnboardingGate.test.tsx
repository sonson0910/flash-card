import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CourseContext, type CourseGateValue } from '../courses/CourseGate';
import { OnboardingGate } from './OnboardingGate';
import { onboardingCourseInput, onboardingLatestScoreRequest, OnboardingJourney, useOnboardingReminderSaveLock } from './OnboardingJourney';
import { ReminderPhonePreview } from './ReminderPhonePreview';
import { writeOnboardingDraft } from './onboardingDraft';
import { writeOnboardingResumeStep } from './onboardingModel';

// Step headings wrap their accent words in an inline element, so compare the rendered text.
const visibleText = (html: string) => html.replace(/<[^>]+>/g, '');
const localDateFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

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
    expect(visibleText(html)).toContain('Choose your language');
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

      // Korean with a goal walks every step: the exam, the starting level and the Hangul primer.
      expect(html).toContain('aria-valuenow="9"');
      expect(html).toContain('aria-valuemax="9"');
      expect(visibleText(html)).toContain('When should we nudge you?');
      // No starter cards were added in this resumed session, so the preview shows no card count.
      expect(html).toContain('aria-label="Reminder preview"');
      expect(html).not.toContain('ready for review');
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
      expect(visibleText(html)).toContain('What are you learning?');
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
      // Minutes price the new words Today adds at the new-card time and the rest of the pace as reviews.
      for (const [count, minutes, tag] of [[5, 4, 'Light'], [10, 6, 'Recommended'], [15, 8, 'Serious'], [20, 9, 'Intense']] as const) {
        expect(html).toContain(`<span class="onb-pace-number">${count}</span><span class="onb-option-sub">cards / day</span><span class="onb-pace-minutes">≈ ${minutes} min a day</span><span class="onb-pace-tag">${tag}</span>`);
      }
      // Without a goal date the plan restates the chosen pace over one week, and the exam step is not counted.
      expect(visibleText(html)).toContain('70cards a week at 10 a day.');
      // The pace is a study goal; the copy must not promise more new words than Today introduces.
      expect(visibleText(html)).toContain('How many cards each day?');
      expect(visibleText(html)).toContain('Today adds up to 5 new words a day.');
      expect(visibleText(html)).not.toContain('How many new words');
      expect(visibleText(html)).toContain('About 6 min a day at this pace.');
      expect(html).toContain('aria-valuemax="8"');
      expect(html).toContain('Try 5 cards');
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

      // IELTS and TOEIC share one exam card; study abroad, business, conversation and "just curious" follow.
      expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Pass IELTS \/ TOEIC/);
      expect(html.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(5);
      expect(visibleText(html)).toContain('What are you learning for?');
      expect(html).toContain('Continue');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resumes at the exam step with band chips and a countdown to the goal date', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      writeOnboardingResumeStep('owner-exam', 'exam');
      writeOnboardingDraft('owner-exam', {
        nativeLanguage: 'vi', targetLanguage: 'en', goalKind: 'ielts', goalLevel: '7.0',
        goalTargetDate: localDateFromToday(30), zhScript: null, pace: 10,
      });
      const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-exam" /></CourseContext.Provider>
      </I18nProvider>);
      const text = visibleText(html);

      expect(html).toContain('aria-valuenow="4"');
      expect(text).toContain('Which test, and what score?');
      expect(html).toMatch(/aria-pressed="true"[^>]*>IELTS</);
      expect(html).toMatch(/aria-pressed="false"[^>]*>TOEIC</);
      expect(html).toMatch(/checked="" value="7\.0"/);
      expect(text).toContain('Exam date (optional)');
      expect(text).toContain('30days to IELTS');
      expect(html.match(/data-week="/g)).toHaveLength(5);
      expect(text).toContain('5 weeks until exam day.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restates the pace over the days left until the goal date as the learner\'s own plan', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      writeOnboardingResumeStep('owner-plan', 'pace');
      writeOnboardingDraft('owner-plan', {
        nativeLanguage: 'vi', targetLanguage: 'ko', goalKind: 'topik', goalLevel: 'TOPIK II',
        goalTargetDate: localDateFromToday(40), zhScript: null, pace: 15,
      });
      const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-plan" /></CourseContext.Provider>
      </I18nProvider>);

      expect(html).toContain('<span class="onb-projection-number">600</span>');
      expect(visibleText(html)).toMatch(/cards to study by .+: 15 a day for 40 days\./);
      expect(html).toContain('aria-valuemax="9"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends a resumed exam step without a goal back to the goal choice', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      writeOnboardingResumeStep('owner-no-goal', 'exam');
      writeOnboardingDraft('owner-no-goal', {
        nativeLanguage: 'vi', targetLanguage: 'ja', goalKind: null, goalLevel: '',
        goalTargetDate: '', zhScript: null, pace: 10,
      });
      const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-no-goal" /></CourseContext.Provider>
      </I18nProvider>);

      expect(html).toContain('data-onboarding-step="goal"');
      expect(html).toContain('aria-valuemax="7"');
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

  it('keeps a reading choice only for a language with a script primer', () => {
    expect(onboardingCourseInput({
      targetLanguage: 'ko', nativeLanguage: 'vi', goalKind: null, goalLevel: '', goalTargetDate: '', zhScript: null, romanization: true,
    })).toEqual({ targetLanguage: 'ko', nativeLanguage: 'vi', activateOnCreate: true, goals: [], preferences: { showRomanization: true } });
    expect(onboardingCourseInput({
      targetLanguage: 'ko', nativeLanguage: 'vi', goalKind: null, goalLevel: '', goalTargetDate: '', zhScript: null, romanization: null,
    })).toEqual({ targetLanguage: 'ko', nativeLanguage: 'vi', activateOnCreate: true, goals: [] });
    expect(onboardingCourseInput({
      targetLanguage: 'ja', nativeLanguage: 'vi', goalKind: null, goalLevel: '', goalTargetDate: '', zhScript: null, romanization: true,
    })).toEqual({ targetLanguage: 'ja', nativeLanguage: 'vi', activateOnCreate: true, goals: [] });
  });

  it('saves the latest score only against the IELTS goal the create reported', () => {
    const created = { courseId: 'course-en', goals: [{ kind: 'ielts', id: 'goal-ielts' }] };
    expect(onboardingLatestScoreRequest('owner-1', created, 'ielts', '6.5'))
      .toEqual({ ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-ielts', latestScore: '6.5' });
    expect(onboardingLatestScoreRequest('owner-1', created, 'ielts', null)).toBeNull();
    expect(onboardingLatestScoreRequest('owner-1', created, 'toeic', '6.5')).toBeNull();
    expect(onboardingLatestScoreRequest('owner-1', null, 'ielts', '6.5')).toBeNull();
    expect(onboardingLatestScoreRequest('owner-1', { courseId: 'course-en', goals: [] }, 'ielts', '6.5')).toBeNull();
  });

  const renderResumed = (ownerId: string, step: Parameters<typeof writeOnboardingResumeStep>[1], draft: Parameters<typeof writeOnboardingDraft>[1]) => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      writeOnboardingResumeStep(ownerId, step);
      writeOnboardingDraft(ownerId, draft);
      return renderToStaticMarkup(<I18nProvider i18n={i18n}>
        <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId={ownerId} /></CourseContext.Provider>
      </I18nProvider>);
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it('asks for the latest IELTS score next to the target band and keeps the draft choice', () => {
    const html = renderResumed('owner-latest', 'exam', {
      nativeLanguage: 'vi', targetLanguage: 'en', goalKind: 'ielts', goalLevel: '7.0',
      goalTargetDate: '', zhScript: null, pace: 10, latestScore: '6.5',
    });
    const text = visibleText(html);

    expect(text).toContain('Target band');
    expect(text).toContain('Your latest IELTS score');
    expect(text).toContain('Optional. It is saved with your course when you finish.');
    expect(html).toMatch(/checked="" value="7\.0"/);
    expect(html).toMatch(/checked="" value="6\.5"/);
    expect(text).toContain('Clear score');
    expect(text).not.toContain('Save score');
  });

  it('offers Foundation, Core and Advanced as the starting level, never CEFR codes', () => {
    const html = renderResumed('owner-level', 'level', {
      nativeLanguage: 'vi', targetLanguage: 'ja', goalKind: null, goalLevel: '',
      goalTargetDate: '', zhScript: null, pace: 10, startingTier: 'core',
    });
    const text = visibleText(html);

    expect(text).toContain('Where are you starting from?');
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?Foundation/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Core/);
    expect(text).toContain('Advanced');
    expect(text).not.toMatch(/\b[ABC][12]\b/);
    expect(html).toContain('aria-valuenow="4"');
  });

  it('teaches Hangul blocks and letters before a Korean course and records the reading choice', () => {
    const html = renderResumed('owner-primer', 'script', {
      nativeLanguage: 'vi', targetLanguage: 'ko', goalKind: null, goalLevel: '',
      goalTargetDate: '', zhScript: null, pace: 10, romanization: false,
    });
    const text = visibleText(html);

    expect(text).toContain('Read Hangul before your first words');
    expect(html.match(/class="onb-primer-jamo crystal-chamfer-sm"/g)).toHaveLength(14 + 10 + 3);
    expect(text).toContain('한국');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?I can already read Hangul/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?still learning to read/);
    // The letters run past a phone screen, so Continue stays pinned while they scroll.
    expect(html).toContain('onboarding-journey__footer onb-footer onboarding-journey__footer--sticky');
  });

  it('previews the reminder with the message the sender uses for the cards the learner has', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <ReminderPhonePreview cardCount={5} countdown={{ days: 30, goal: 'IELTS' }} today={new Date(2026, 10, 19)} />
    </I18nProvider>);
    const text = visibleText(html);

    expect(text).toContain('SonFlash');
    expect(text).toContain('5 cards are ready for review.');
    expect(text).toContain('IELTS in 30 days');
    expect(text).toContain('Thursday, November 19');
    expect(html).not.toContain('onb-phone-time');
  });
});
