import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courseVoicePreferenceKey } from '../../lib/courseVoicePreference';

const hooks = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as Array<readonly unknown[] | undefined> }));
const updateCourse = vi.hoisted(() => vi.fn());
const reopenCourse = vi.hoisted(() => vi.fn());
const writeDailyPace = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({
  model: {
    ownerId: 'owner-a', status: 'ready' as const, pending: false,
    activeCourse: {
      id: 'course-zh', targetLanguage: 'zh' as const, nativeLanguage: 'vi' as const, status: 'active' as const, goals: [],
      preferences: { showRomanization: false, pronunciationVariant: null, zhScript: 'hans' as const },
    },
    profile: { courses: [] },
  },
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.states[index] as T, (value: T | ((current: T) => T)) => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof value === 'function' ? (value as (current: T) => T)(current) : value;
      }] as const;
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.cursor++;
      return hooks.refs[index] ??= { current: initial } as { current: T };
    },
    useEffect: (effect: () => void, dependencies?: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.effects[index];
      hooks.effects[index] = dependencies;
      if (!previous || !dependencies || dependencies.some((dependency, dependencyIndex) => dependency !== previous[dependencyIndex])) effect();
    },
  };
});
vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ _: (value: unknown) => typeof value === 'string' ? value : 'label' }),
}));
vi.mock('../../i18n/I18nProvider', () => ({ useUiLocale: () => 'en', useSetUiLocale: () => vi.fn() }));
vi.mock('../courses/CourseGate', () => ({ useCourseSession: () => ({ model: session.model, actions: { updateCourse, reopenCourse } }) }));
vi.mock('./dailyPacePreference', () => ({
  DAILY_PACE_OPTIONS: [5, 10, 15, 20], DEFAULT_DAILY_PACE: 10,
  readDailyPace: () => 10, writeDailyPace,
}));

import { CourseSettingsSection } from './CourseSettingsSection';

type Tree = { type?: unknown; props?: Record<string, unknown> };
const find = (node: unknown, match: (value: Tree) => boolean): Tree | undefined => {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  const value = node as Tree;
  if (match(value)) return value;
  return find(value.props?.children, match);
};
const findButtons = (node: unknown): Tree[] => {
  if (Array.isArray(node)) return node.flatMap(findButtons);
  if (!node || typeof node !== 'object') return [];
  const value = node as Tree;
  return [...(value.type === 'button' ? [value] : []), ...findButtons(value.props?.children)];
};
const render = () => { hooks.cursor = 0; return CourseSettingsSection(); };
const flush = () => new Promise(resolve => { setTimeout(resolve, 0); });

afterEach(() => vi.unstubAllGlobals());

describe('CourseSettingsSection preference writes', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    hooks.refs = [];
    hooks.effects = [];
    updateCourse.mockReset();
    reopenCourse.mockReset();
    writeDailyPace.mockReset();
    session.model.ownerId = 'owner-a';
    session.model.pending = false;
    session.model.profile = { courses: [] };
    session.model.activeCourse = {
      id: 'course-zh', targetLanguage: 'zh', nativeLanguage: 'vi', status: 'active', goals: [],
      preferences: { showRomanization: false, pronunciationVariant: null, zhScript: 'hans' },
    };
  });

  it('sends only the changed preference so another device can retain its independent edit', async () => {
    const tree = render();
    const romanization = find(tree, value => value.type === 'input' && value.props?.role === 'switch');
    const script = find(tree, value => value.type === 'select'
      && Boolean(find(value.props?.children, child => child.type === 'option' && child.props?.value === 'hant')));

    expect(romanization).toBeDefined();
    expect(script).toBeDefined();
    updateCourse.mockResolvedValue({ ok: true });
    (romanization?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    await flush();
    (script?.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'hant' } });

    expect(updateCourse).toHaveBeenNthCalledWith(1, 'course-zh', { preferences: { showRomanization: true } });
    expect(updateCourse).toHaveBeenNthCalledWith(2, 'course-zh', { preferences: { zhScript: 'hant' } });
  });

  it('keeps the persisted value and shows an in-context retry alert after a rejected settings write', async () => {
    updateCourse.mockResolvedValueOnce({ ok: false });
    let tree = render();
    const romanization = find(tree, value => value.type === 'input' && value.props?.role === 'switch');
    (romanization?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    await flush();

    tree = render();
    const alert = find(tree, value => value.type === 'p' && value.props?.role === 'alert');
    expect((alert?.props?.children as Tree)?.props?.message).toBe('That course action did not go through. Please try again.');
    expect(find(tree, value => value.type === 'input' && value.props?.role === 'switch')?.props?.checked).toBe(false);

    updateCourse.mockReturnValueOnce(new Promise(() => {}));
    (find(tree, value => value.type === 'input' && value.props?.role === 'switch')?.props?.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    tree = render();
    expect(find(tree, value => value.type === 'p' && value.props?.role === 'alert')).toBeUndefined();

    session.model.ownerId = 'owner-b';
    render();
    tree = render();
    expect(find(tree, value => value.type === 'p' && value.props?.role === 'alert')).toBeUndefined();
  });

  it('keeps the saved pace after a storage failure and allows retry', () => {
    writeDailyPace.mockReturnValueOnce(false).mockReturnValueOnce(true);
    let tree = render();
    const pace = find(tree, value => value.type === 'select'
      && Boolean(find(value.props?.children, child => child.type === 'option' && child.props?.value === 20)));
    (pace?.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '20' } });
    tree = render();
    expect(find(tree, value => value.type === 'select'
      && Boolean(find(value.props?.children, child => child.type === 'option' && child.props?.value === 20)) )?.props?.value).toBe(10);
    const alert = find(tree, value => value.type === 'p' && value.props?.role === 'alert');
    expect((alert?.props?.children as Tree)?.props?.message).toBe('Daily pace could not be saved. Please try again.');

    (pace?.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '20' } });
    tree = render();
    expect(find(tree, value => value.type === 'select'
      && Boolean(find(value.props?.children, child => child.type === 'option' && child.props?.value === 20)) )?.props?.value).toBe(20);
    expect(find(tree, value => value.type === 'p' && value.props?.role === 'alert')).toBeUndefined();
  });

  it('shows the same feedback and permits retry when reopening an archived course fails', async () => {
    const archivedCourse = { ...session.model.activeCourse, id: 'course-ja', targetLanguage: 'ja' as const, status: 'archived' as const };
    session.model.profile = { courses: [archivedCourse] } as never;
    reopenCourse.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    let tree = render();
    (findButtons(tree).at(-1)?.props?.onClick as () => void)();
    await flush();
    tree = render();
    expect(find(tree, value => value.type === 'p' && value.props?.role === 'alert')).toBeDefined();

    (findButtons(tree).at(-1)?.props?.onClick as () => void)();
    await flush();
    expect(reopenCourse).toHaveBeenCalledTimes(2);
  });

  it('lists matching device voices, keeps an unavailable saved key, and resets feedback after an owner switch', async () => {
    const englishVoice = {
      default: false, lang: 'en-US', localService: true, name: 'English device voice', voiceURI: 'english-device',
    } as SpeechSynthesisVoice;
    const missingVoice = {
      default: true, lang: 'en-US', localService: true, name: 'Missing device voice', voiceURI: 'missing-device',
    } as SpeechSynthesisVoice;
    const secondEnglishVoice = {
      default: false, lang: 'en-US', localService: true, name: 'Second English voice', voiceURI: 'english-device-2',
    } as SpeechSynthesisVoice;
    let availableVoices = [englishVoice];
    let voicesChanged: (() => void) | undefined;
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => availableVoices,
        addEventListener: (_event: string, listener: () => void) => { voicesChanged = listener; },
        removeEventListener: vi.fn(),
      },
    });
    session.model.activeCourse = {
      id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active', goals: [],
      preferences: { showRomanization: false, pronunciationVariant: courseVoicePreferenceKey(missingVoice), zhScript: null },
    } as never;
    updateCourse.mockResolvedValueOnce({ ok: false });

    let tree = render();
    tree = render();
    const voiceSelect = () => find(tree, value => value.type === 'select'
      && Boolean(find(value.props?.children, child => child.type === 'option' && child.props?.value === '')));
    expect(voiceSelect()?.props?.value).toBe(courseVoicePreferenceKey(missingVoice));
    expect(find(voiceSelect()?.props?.children, value => value.type === 'option' && value.props?.value === courseVoicePreferenceKey(englishVoice))).toBeDefined();
    expect(find(voiceSelect()?.props?.children, value => value.type === 'option' && value.props?.disabled === true)).toBeDefined();
    (voiceSelect()?.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '' } });
    await flush();
    tree = render();
    expect(voiceSelect()?.props?.value).toBe(courseVoicePreferenceKey(missingVoice));
    expect(find(tree, value => value.type === 'p' && value.props?.role === 'alert')).toBeDefined();

    availableVoices = [englishVoice, secondEnglishVoice];
    voicesChanged?.();
    tree = render();
    expect(find(voiceSelect()?.props?.children, value => value.type === 'option' && value.props?.value === courseVoicePreferenceKey(secondEnglishVoice))).toBeDefined();

    session.model.ownerId = 'owner-b';
    session.model.activeCourse = {
      id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'vi', status: 'active', goals: [],
      preferences: { showRomanization: false, pronunciationVariant: null, zhScript: null },
    } as never;
    render();
    tree = render();
    expect(find(tree, value => value.type === 'p' && value.props?.role === 'alert')).toBeUndefined();
    expect(voiceSelect()?.props?.value).toBe('');
    expect(voicesChanged).toBeDefined();
  });
});
