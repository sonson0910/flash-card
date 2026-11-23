import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, ChevronRight, Globe, Info, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { ENABLED_UI_LOCALES, UI_LOCALES, type UiLocale } from '../../i18n/locales';
import { courseVoicePreferenceKey, readSpeechSynthesisVoices, voicesForTargetLanguage } from '../../lib/courseVoicePreference';
import { useCourseSession } from '../courses/CourseGate';
import { goalKindLabel } from '../courses/courseGoalCatalog';
import { NATIVE_LANGUAGE_LABEL, TARGET_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import { COURSE_NATIVE_LANGUAGES, COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage } from '../courses/courseModel';
import { DAILY_PACE_OPTIONS, readDailyPace, writeDailyPace, type DailyPace } from './dailyPacePreference';
import './settings-theme.css';

/** Course names in their own script, as the board shows them; they are not translated. */
const TARGET_ENDONYM: Readonly<Record<CourseTargetLanguage, { readonly name: string; readonly glyph: string }>> = {
  en: { name: 'English', glyph: 'A' },
  ko: { name: '한국어', glyph: '한' },
  ja: { name: '日本語', glyph: '日' },
  zh: { name: '中文', glyph: '中' },
};
const NATIVE_AUTONYM: Readonly<Record<CourseNativeLanguage, string>> = { vi: 'Tiếng Việt', en: 'English' };
/** One fixed example word per course language shows where the meaning language appears on a card. */
const MEANING_EXAMPLE: Readonly<Record<CourseTargetLanguage, { readonly word: string; readonly reading: string | null }>> = {
  en: { word: 'apple', reading: null },
  ko: { word: '사과', reading: 'sagwa' },
  ja: { word: 'りんご', reading: 'ringo' },
  zh: { word: '苹果', reading: 'píngguǒ' },
};
const MEANING_IN: Readonly<Record<CourseNativeLanguage, string>> = { vi: 'quả táo', en: 'apple' };

export interface CourseSettingsSectionProps {
  /** The page title, rendered at the top of the form column. */
  readonly heading?: ReactNode;
}

/**
 * Reading/voice/script preferences are exactly `CoursePreferences`
 * (`showRomanization`, `pronunciationVariant`, `zhScript`) on the active
 * course — there is no separate settings-only copy of this state, so a
 * change here is one `updateCourse` write and nothing to keep in sync.
 */
export function CourseSettingsSection(props: CourseSettingsSectionProps = {}) {
  const { heading } = props;
  const { _ } = useLingui();
  const uiLocale = useUiLocale();
  const setUiLocale = useSetUiLocale();
  const { model, actions } = useCourseSession();
  const [pace, setPace] = useState<DailyPace>(readDailyPace);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null | false>(null);
  const [saveError, setSaveError] = useState<'course' | 'pace' | null>(null);
  const savingRef = useRef(false);
  const attemptRef = useRef(0);
  const addLanguageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    savingRef.current = false;
    attemptRef.current += 1;
    setSaveError(null);
  }, [model.ownerId, model.activeCourse?.id]);

  useEffect(() => {
    const synthesis = typeof window === 'undefined' ? undefined : window.speechSynthesis;
    if (!synthesis || typeof synthesis.getVoices !== 'function') {
      setVoices(false);
      return;
    }
    let disposed = false;
    const refreshVoices = () => {
      if (disposed) return;
      setVoices(readSpeechSynthesisVoices());
    };
    refreshVoices();
    synthesis.addEventListener?.('voiceschanged', refreshVoices);
    return () => {
      disposed = true;
      synthesis.removeEventListener?.('voiceschanged', refreshVoices);
    };
  }, [model.ownerId, model.activeCourse?.id, model.activeCourse?.targetLanguage]);

  const appLanguageLabel = _(msg({ id: 'settings.course.ui-language.label', message: 'App language' }));
  const appLanguage = <div className="ss-lang-row">
    <div className="min-w-0 flex-1">
      <p className="ss-lang-row__title"><Trans {...msg({ context: 'settings.course.ui-language', message: 'App language' })} /></p>
      <p className="ss-lang-row__sub"><Trans {...msg({ context: 'settings.course.ui-language.scope', message: 'Menus, buttons, emails and notifications' })} /></p>
    </div>
    <span className="ss-lang-select">
      <Globe size={16} aria-hidden="true" className="ss-lang-select__globe" />
      <select className="ss-select crystal-chamfer-sm" aria-label={appLanguageLabel} value={uiLocale} onChange={event => void setUiLocale(event.target.value as UiLocale)}>
        {ENABLED_UI_LOCALES.map(locale => <option key={locale} value={locale}>{UI_LOCALES[locale].autonym}</option>)}
      </select>
    </span>
  </div>;
  const appLanguageChips = <div className="ss-lang-chips" role="group" aria-label={appLanguageLabel}>
    {ENABLED_UI_LOCALES.map(locale => <button key={locale} type="button" lang={locale} className="ss-lang-chip" aria-pressed={uiLocale === locale} onClick={() => void setUiLocale(locale)}><span className="ss-lang-chip__face">{UI_LOCALES[locale].autonym}</span></button>)}
  </div>;

  if (model.status !== 'ready' || !model.profile) {
    return <section aria-label={_(msg({ id: 'settings.course.region', message: 'Language & courses' }))} className="ss-split ss-split--language">
      {heading && <div className="ss-split__head">{heading}</div>}
      <div className="ss-split__main">
        <div data-settings-course-language className="ss-panel ss-lang-card crystal-chamfer">{appLanguage}{appLanguageChips}</div>
      </div>
    </section>;
  }
  const activeCourse = model.activeCourse;
  const activeGoal = activeCourse?.goals.find(goal => goal.status === 'active');
  const activeGoalLabel = activeGoal && activeCourse ? goalKindLabel(activeCourse.targetLanguage, activeGoal.kind) : null;
  const courses = model.profile.courses;
  const archivedCourses = courses.filter(course => course.status === 'archived');
  const otherActiveCourses = courses.filter(course => course.status === 'active' && course.id !== activeCourse?.id);
  const usedTargets = new Set(courses.map(course => course.targetLanguage));
  const addableTargets = COURSE_TARGET_LANGUAGES.filter(language => !usedTargets.has(language));
  const newCourseNative: CourseNativeLanguage = activeCourse?.nativeLanguage ?? (uiLocale === 'vi' ? 'vi' : 'en');
  const targetVoices = activeCourse && Array.isArray(voices) ? voicesForTargetLanguage(voices, activeCourse.targetLanguage) : [];
  const savedVoiceKey = activeCourse?.preferences.pronunciationVariant ?? null;
  const savedVoiceAvailable = Boolean(savedVoiceKey && targetVoices.some(voice => courseVoicePreferenceKey(voice) === savedVoiceKey));
  const savedVoiceUnavailable = Boolean(savedVoiceKey && voices !== null && !savedVoiceAvailable);
  const voiceLabel = _(msg({ id: 'settings.voice.label', message: 'Voice' }));
  const voiceStatus = voices === false
    ? _(msg({ id: 'settings.voice.unsupported', message: 'Device voices unavailable.' }))
    : savedVoiceUnavailable
      ? _(msg({ id: 'settings.voice.missing', message: 'Saved voice unavailable. Using automatic selection.' }))
      : Array.isArray(voices) && targetVoices.length === 0
        ? _(msg({ id: 'settings.voice.empty', message: 'No installed {language} voices. Automatic selection is available.' }).id, { language: _(TARGET_LANGUAGE_LABEL[activeCourse?.targetLanguage ?? 'en']) })
        : null;

  const runCourseAction = async (action: () => Promise<{ ok: boolean }>) => {
    if (savingRef.current || model.pending) return;
    savingRef.current = true;
    const attempt = ++attemptRef.current;
    setSaveError(null);
    let failed = false;
    try { failed = !(await action()).ok; } catch { failed = true; }
    if (attempt === attemptRef.current) {
      if (failed) setSaveError('course');
      savingRef.current = false;
    }
  };
  const updateCourse = (input: Parameters<typeof actions.updateCourse>[1]) => {
    if (!activeCourse) return;
    runCourseAction(() => actions.updateCourse(activeCourse.id, input));
  };
  const updatePreferences = (patch: Partial<{ showRomanization: boolean; pronunciationVariant: string | null; zhScript: 'hans' | 'hant' | null }>) => {
    updateCourse({ preferences: patch });
  };
  const changePace = (next: DailyPace) => {
    const saved = writeDailyPace(next);
    setPace(saved ? next : readDailyPace());
    setSaveError(saved ? null : 'pace');
  };
  const courseMeta = (target: CourseTargetLanguage, native: CourseNativeLanguage) => `${_(TARGET_LANGUAGE_LABEL[target])} ← ${_(NATIVE_LANGUAGE_LABEL[native])}`;
  const example = activeCourse ? MEANING_EXAMPLE[activeCourse.targetLanguage] : null;

  return <section aria-label={_(msg({ id: 'settings.course.region', message: 'Language & courses' }))} className="ss-split ss-split--language">
    {heading && <div className="ss-split__head">{heading}</div>}
    <aside aria-label={_(msg({ id: 'settings.course.list.label', message: 'Your courses' }))} className="ss-split__aside ss-courses">
      <div className="ss-courses__head">
        <h2 className="ss-eyebrow"><Trans {...msg({ context: 'settings.course.list.title', message: 'Your courses · {count}' })} values={{ count: courses.filter(course => course.status === 'active').length }} /></h2>
        {addableTargets.length > 0 && <button type="button" className="ss-courses__add" onClick={() => { addLanguageRef.current?.scrollIntoView?.({ block: 'nearest' }); addLanguageRef.current?.querySelector('button')?.focus(); }}><Plus size={14} aria-hidden="true" /><Trans {...msg({ context: 'settings.course.add', message: 'Add a language' })} /></button>}
      </div>

      {activeCourse && <div data-settings-active-course className="ss-course-active crystal-chamfer">
        <div className="ss-course-active__head">
          <span className="ss-course-glyph" lang={activeCourse.targetLanguage} aria-hidden="true">{TARGET_ENDONYM[activeCourse.targetLanguage].glyph}</span>
          <div className="min-w-0 flex-1">
            <div className="ss-course-active__title"><span className="ss-course-active__name" lang={activeCourse.targetLanguage}>{TARGET_ENDONYM[activeCourse.targetLanguage].name}</span><span className="ss-course-active__badge"><Trans {...msg({ context: 'settings.course.active-badge', message: 'Active' })} /></span></div>
            <div className="ss-course-active__meta">{courseMeta(activeCourse.targetLanguage, activeCourse.nativeLanguage)}{activeGoal && <> · {activeGoalLabel ? _(activeGoalLabel) : activeGoal.kind}{activeGoal.level ? ` · ${activeGoal.level}` : ''}{activeGoal.targetDate ? ` · ${activeGoal.targetDate}` : ''}</>}</div>
          </div>
        </div>
        <div data-settings-course-preferences className="ss-course-rows">
          <label className="ss-row ss-switch-row">
            <span className="ss-row__text"><span className="ss-row__title"><Trans {...msg({ context: 'settings.course.romanization', message: 'Show romanization' })} /></span><span className="ss-row__sub">{activeCourse.targetLanguage === 'en' ? <Trans {...msg({ context: 'settings.course.romanization.description-en', message: 'Your saved choice for this course.' })} /> : <Trans {...msg({ context: 'settings.course.romanization.description', message: 'Your saved choice for this course. Each card has its own reading switch.' })} />}</span></span>
            <input type="checkbox" role="switch" disabled={model.pending} checked={activeCourse.preferences.showRomanization} onChange={event => updatePreferences({ showRomanization: event.target.checked })} />
          </label>
          <div data-settings-course-voice className="ss-row">
            <span className="ss-row__text"><span className="ss-row__title"><Trans {...msg({ context: 'settings.voice', message: 'Voice' })} /></span>{voiceStatus ? <span data-settings-voice-status role="status" className="ss-row__sub">{voiceStatus}</span> : <span className="ss-row__sub"><Trans {...msg({ context: 'settings.voice.description', message: 'Read words aloud with a voice on this device' })} /></span>}</span>
            <select
              className="ss-select crystal-chamfer-sm"
              aria-label={voiceLabel}
              disabled={model.pending || voices === false || targetVoices.length === 0}
              value={savedVoiceKey ?? ''}
              onChange={event => updatePreferences({ pronunciationVariant: event.target.value || null })}
            >
              <option value=""><Trans {...msg({ context: 'settings.voice.automatic', message: 'Automatic' })} /></option>
              {savedVoiceKey && savedVoiceUnavailable && <option value={savedVoiceKey} disabled><Trans {...msg({ context: 'settings.voice.unavailable', message: 'Saved voice unavailable · Automatic' })} /></option>}
              {targetVoices.map(voice => <option key={courseVoicePreferenceKey(voice)} value={courseVoicePreferenceKey(voice)}>{voice.name} · {voice.lang}</option>)}
            </select>
          </div>
          {activeCourse.targetLanguage === 'ko' && <div className="ss-row">
            <span className="ss-row__text"><span className="ss-row__title"><Trans {...msg({ context: 'settings.course.keyboard', message: 'Keyboard' })} /> · <span lang="ko">두벌식</span></span><span className="ss-row__sub"><Trans {...msg({ context: 'settings.course.keyboard.ko-help', message: 'Korean 2-set (두벌식): add Korean in your device keyboard settings, or use the on-screen keys in Korean practice.' })} /></span></span>
          </div>}
          {activeCourse.targetLanguage === 'zh' && <div className="ss-row">
            <span className="ss-row__text"><span className="ss-row__title"><Trans {...msg({ context: 'settings.course.script', message: 'Chinese script' })} /></span></span>
            <select className="ss-select crystal-chamfer-sm" aria-label={_(msg({ id: 'settings.course.script.label', message: 'Chinese script' }))} disabled={model.pending} value={activeCourse.preferences.zhScript ?? 'hans'} onChange={event => updatePreferences({ zhScript: event.target.value as 'hans' | 'hant' })}>
              <option value="hans"><Trans {...msg({ context: 'settings.course.script.simplified', message: 'Simplified' })} /></option>
              <option value="hant"><Trans {...msg({ context: 'settings.course.script.traditional', message: 'Traditional' })} /></option>
            </select>
          </div>}
          <div className="ss-row">
            <span className="ss-row__text"><span className="ss-row__title"><Trans {...msg({ context: 'settings.course.pace', message: 'Daily pace' })} /></span><span className="ss-row__sub"><Trans {...msg({ context: 'settings.course.pace.description', message: 'Cards you aim to study each day' })} /></span></span>
            <select className="ss-select crystal-chamfer-sm" aria-label={_(msg({ id: 'settings.course.pace.label', message: 'Daily pace' }))} value={pace} onChange={event => changePace(Number(event.target.value) as DailyPace)}>
              {DAILY_PACE_OPTIONS.map(option => <option key={option} value={option}>{_(msg({ id: 'settings.course.pace.option', message: '{count} cards / day' }).id, { count: option })}</option>)}
            </select>
          </div>
        </div>
        {otherActiveCourses.length > 0 && <div className="ss-course-active__foot">
          <button type="button" className="ss-link-button" disabled={model.pending} onClick={() => runCourseAction(() => actions.archiveCourse(activeCourse.id))}><Trans {...msg({ context: 'settings.course.archive', message: 'Archive course' })} /></button>
        </div>}
      </div>}

      {otherActiveCourses.map(course => <button key={course.id} type="button" className="ss-course-other crystal-chamfer" disabled={model.pending} onClick={() => runCourseAction(() => actions.switchCourse(course.id))}>
        <span className="ss-course-glyph ss-course-glyph--small" lang={course.targetLanguage} aria-hidden="true">{TARGET_ENDONYM[course.targetLanguage].glyph}</span>
        <span className="ss-course-other__text"><span className="ss-course-other__name" lang={course.targetLanguage}>{TARGET_ENDONYM[course.targetLanguage].name}</span><span className="ss-course-other__meta">{courseMeta(course.targetLanguage, course.nativeLanguage)}</span></span>
        <ChevronRight size={18} aria-hidden="true" className="ss-course-other__chevron" />
      </button>)}

      {archivedCourses.length > 0 && <div className="ss-course-add crystal-chamfer">
        <h3 className="ss-eyebrow"><Trans {...msg({ context: 'settings.course.archived', message: 'Archived courses' })} /></h3>
        <div className="ss-course-add__options">
          {archivedCourses.map(course => <button key={course.id} type="button" disabled={model.pending} onClick={() => runCourseAction(() => actions.reopenCourse(course.id))} className="ss-course-add__option crystal-chamfer-sm">
            <span className="ss-course-add__name" lang={course.targetLanguage}>{TARGET_ENDONYM[course.targetLanguage].name}</span>
            <span className="ss-course-add__sub">{_(TARGET_LANGUAGE_LABEL[course.targetLanguage])} · <Trans {...msg({ context: 'settings.course.reopen', message: 'Reopen' })} /> <RotateCcw size={11} aria-hidden="true" className="inline" /></span>
          </button>)}
        </div>
      </div>}

      {addableTargets.length > 0 && <div ref={addLanguageRef} className="ss-course-add crystal-chamfer">
        <h3 className="ss-eyebrow"><Trans {...msg({ context: 'settings.course.add.title', message: 'Start another language' })} /></h3>
        <div className="ss-course-add__options">
          {addableTargets.map(language => <button key={language} type="button" disabled={model.pending} onClick={() => runCourseAction(() => actions.createCourse({ targetLanguage: language, nativeLanguage: newCourseNative }))} className="ss-course-add__option crystal-chamfer-sm">
            <span className="ss-course-add__name" lang={language}>{TARGET_ENDONYM[language].name}</span>
            <span className="ss-course-add__sub">{courseMeta(language, newCourseNative)}</span>
          </button>)}
        </div>
      </div>}
    </aside>
    <div className="ss-split__main">
      <div data-settings-course-language className="ss-panel ss-lang-card crystal-chamfer">
        {appLanguage}
        {appLanguageChips}
        {activeCourse && <fieldset className="ss-lang-meaning">
          <legend className="ss-lang-meaning__legend"><span className="ss-lang-row__title block"><Trans {...msg({ context: 'settings.course.meaning-language.title', message: 'Meanings and explanations in' })} /></span></legend>
          <p className="ss-lang-row__sub"><Trans {...msg({ context: 'settings.course.meaning-language.scope', message: 'Applies to new cards. Existing card meanings do not change.' })} /></p>
          <div className="ss-lang-meaning__options">
            {COURSE_NATIVE_LANGUAGES.map(language => <label key={language} className="ss-lang-meaning__option crystal-chamfer-sm" data-checked={activeCourse.nativeLanguage === language ? 'true' : undefined}>
              <input type="radio" className="sr-only" name="settings-meaning-language" value={language} disabled={model.pending} checked={activeCourse.nativeLanguage === language} onChange={() => updateCourse({ nativeLanguage: language })} />
              <span className="ss-lang-meaning__name">{_(NATIVE_LANGUAGE_LABEL[language])}</span>
              <span className="ss-lang-meaning__sub" lang={language}>{NATIVE_AUTONYM[language]}</span>
            </label>)}
          </div>
          {example && <div className="ss-lang-preview crystal-chamfer-sm" aria-hidden="true">
            <span className="ss-lang-preview__word" lang={activeCourse.targetLanguage}>{example.word}</span>
            {example.reading && <span className="ss-lang-preview__reading">{example.reading}</span>}
            <ArrowRight size={14} className="ss-lang-preview__arrow" />
            <span className="ss-lang-preview__meaning" lang={activeCourse.nativeLanguage}>{MEANING_IN[activeCourse.nativeLanguage]}</span>
            <span className="ss-lang-preview__note"><Trans {...msg({ context: 'settings.course.meaning-language.preview', message: 'preview on a card' })} /></span>
          </div>}
        </fieldset>}
      </div>
      <p className="ss-lang-note crystal-chamfer-sm"><Info size={16} aria-hidden="true" /><span><strong><Trans {...msg({ context: 'settings.course.note.title', message: 'Switching the app language never changes your cards.' })} /></strong> <Trans {...msg({ context: 'settings.course.note.body', message: 'Meanings stay in the language they were written in.' })} /></span></p>
      {saveError && <p role="alert" className="ss-alert">
        {saveError === 'course'
          ? <Trans {...msg({ context: 'course.error.generic', message: 'That course action did not go through. Please try again.' })} />
          : <Trans {...msg({ context: 'settings.course.pace.error', message: 'Daily pace could not be saved. Please try again.' })} />}
      </p>}
    </div>

  </section>;
}
