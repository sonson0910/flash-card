import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Archive, BookOpen, Gauge, Keyboard, RotateCcw, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { ENABLED_UI_LOCALES, UI_LOCALES, type UiLocale } from '../../i18n/locales';
import { useCourseSession } from '../courses/CourseGate';
import { goalKindLabel } from '../courses/courseGoalCatalog';
import { NATIVE_LANGUAGE_LABEL, TARGET_LANGUAGE_FLAG, TARGET_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import { COURSE_NATIVE_LANGUAGES, type CourseNativeLanguage } from '../courses/courseModel';
import { DAILY_PACE_OPTIONS, readDailyPace, writeDailyPace, type DailyPace } from './dailyPacePreference';

const rowClass = 'flex min-h-14 flex-wrap items-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3';
const selectClass = 'min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm font-semibold text-[var(--sf-text)]';
const infoRowClass = 'flex min-h-14 items-start gap-3 rounded-2xl border border-dashed border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3 text-sm text-[var(--sf-text-muted)]';

/**
 * Reading/voice/script preferences are exactly `CoursePreferences`
 * (`showRomanization`, `pronunciationVariant`, `zhScript`) on the active
 * course — there is no separate settings-only copy of this state, so a
 * change here is one `updateCourse` write and nothing to keep in sync.
 */
export function CourseSettingsSection() {
  const { _ } = useLingui();
  const uiLocale = useUiLocale();
  const setUiLocale = useSetUiLocale();
  const { model, actions } = useCourseSession();
  const [pace, setPace] = useState<DailyPace>(readDailyPace);

  if (model.status !== 'ready' || !model.profile) return null;
  const activeCourse = model.activeCourse;
  const activeGoal = activeCourse?.goals.find(goal => goal.status === 'active');
  const activeGoalLabel = activeGoal && activeCourse ? goalKindLabel(activeCourse.targetLanguage, activeGoal.kind) : null;
  const archivedCourses = model.profile.courses.filter(course => course.status === 'archived');

  const updatePreferences = (patch: Partial<{ showRomanization: boolean; pronunciationVariant: string | null; zhScript: 'hans' | 'hant' | null }>) => {
    if (!activeCourse) return;
    void actions.updateCourse(activeCourse.id, { preferences: { ...activeCourse.preferences, ...patch } });
  };
  const changePace = (next: DailyPace) => { setPace(next); writeDailyPace(next); };

  return <section aria-labelledby="settings-course" className="settings-panel rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-4 shadow-[0_22px_56px_-38px_var(--sf-shadow)] sm:p-6">
    <div className="flex items-start gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-[var(--sf-surface-control)] text-[var(--sf-brand-text)]"><BookOpen size={20} aria-hidden="true" /></span>
      <div>
        <h2 id="settings-course" className="text-xl font-black text-[var(--sf-text)]"><Trans id="settings.course.title" message="Course and learning" /></h2>
        <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="settings.course.description" message="Language, goals and how words are read to you." /></p>
      </div>
    </div>

    <div className="settings-course-grid mt-5 grid gap-5">
      {activeCourse && <div data-settings-active-course className="flex items-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3">
        <span aria-hidden="true" className="text-2xl">{TARGET_LANGUAGE_FLAG[activeCourse.targetLanguage]}</span>
        <span className="min-w-0">
          <span className="block font-bold text-[var(--sf-text)]"><Trans id="course.status.active" message="Active course" /> · {_(TARGET_LANGUAGE_LABEL[activeCourse.targetLanguage])} <span aria-hidden="true">←</span> {_(NATIVE_LANGUAGE_LABEL[activeCourse.nativeLanguage])}</span>
          {activeGoal && <span className="mt-0.5 block text-sm text-[var(--sf-text-muted)]">{activeGoalLabel ? _(activeGoalLabel) : activeGoal.kind}{activeGoal.level ? ` · ${activeGoal.level}` : ''}{activeGoal.targetDate ? ` · ${activeGoal.targetDate}` : ''}</span>}
        </span>
      </div>}

      <div data-settings-course-language className="grid gap-3">
        <label className={rowClass}>
          <span className="min-w-0 flex-1 font-bold text-[var(--sf-text)]"><Trans id="settings.course.ui-language" message="App language" /></span>
          <select className={selectClass} value={uiLocale} onChange={event => void setUiLocale(event.target.value as UiLocale)}>
            {ENABLED_UI_LOCALES.map(locale => <option key={locale} value={locale}>{UI_LOCALES[locale].autonym}</option>)}
          </select>
        </label>

        {activeCourse && <label className={rowClass}>
          <span className="min-w-0 flex-1 font-bold text-[var(--sf-text)]"><Trans id="settings.course.meaning-language" message="Meaning language" /><span className="block text-xs font-normal text-[var(--sf-text-muted)]"><Trans id="settings.course.meaning-language.scope" message="Applies to new cards. Existing card meanings do not change." /></span></span>
          <select className={selectClass} value={activeCourse.nativeLanguage} onChange={event => void actions.updateCourse(activeCourse.id, { nativeLanguage: event.target.value as CourseNativeLanguage })}>
            {COURSE_NATIVE_LANGUAGES.map(language => <option key={language} value={language}>{_(NATIVE_LANGUAGE_LABEL[language])}</option>)}
          </select>
        </label>}
      </div>

      {activeCourse && <div data-settings-course-preferences className="grid gap-3 border-t border-[var(--sf-border)] pt-5">
        <div className={rowClass}>
          <Gauge size={18} aria-hidden="true" className="shrink-0 text-[var(--sf-text-muted)]" />
          <span className="min-w-0 flex-1 font-bold text-[var(--sf-text)]"><Trans id="settings.course.pace" message="Daily pace" /></span>
          <select className={selectClass} value={pace} onChange={event => changePace(Number(event.target.value) as DailyPace)}>
            {DAILY_PACE_OPTIONS.map(option => <option key={option} value={option}>{_(msg({ id: 'settings.course.pace.option', message: '{count} cards / day' }).id, { count: option })}</option>)}
          </select>
        </div>

        <label className={rowClass}>
          <Volume2 size={18} aria-hidden="true" className="shrink-0 text-[var(--sf-text-muted)]" />
          <span className="min-w-0 flex-1 font-bold text-[var(--sf-text)]"><Trans id="settings.course.romanization" message="Show romanization" /></span>
          <input type="checkbox" role="switch" checked={activeCourse.preferences.showRomanization} onChange={event => updatePreferences({ showRomanization: event.target.checked })} className="h-6 w-11 shrink-0 accent-[var(--sf-brand)]" />
        </label>

        {activeCourse.targetLanguage === 'zh' && <div className={rowClass}>
          <Keyboard size={18} aria-hidden="true" className="shrink-0 text-[var(--sf-text-muted)]" />
          <span className="min-w-0 flex-1 font-bold text-[var(--sf-text)]"><Trans id="settings.course.script" message="Chinese script" /></span>
          <select className={selectClass} value={activeCourse.preferences.zhScript ?? 'hans'} onChange={event => updatePreferences({ zhScript: event.target.value as 'hans' | 'hant' })}>
            <option value="hans"><Trans id="settings.course.script.simplified" message="Simplified" /></option>
            <option value="hant"><Trans id="settings.course.script.traditional" message="Traditional" /></option>
          </select>
        </div>}
      </div>}

      {archivedCourses.length > 0 && <div data-settings-grid-wide className={rowClass}>
        <Archive size={18} aria-hidden="true" className="shrink-0 text-[var(--sf-text-muted)]" />
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-[var(--sf-text)]"><Trans id="settings.course.archived" message="Archived courses" /></span>
          <span className="mt-1 flex flex-wrap gap-2">
            {archivedCourses.map(course => <button key={course.id} type="button" disabled={model.pending} onClick={() => void actions.reopenCourse(course.id)}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--sf-border)] px-2.5 text-xs font-bold text-[var(--sf-text)]">
              {TARGET_LANGUAGE_FLAG[course.targetLanguage]} {_(TARGET_LANGUAGE_LABEL[course.targetLanguage])} <RotateCcw size={12} aria-hidden="true" />
            </button>)}
          </span>
        </span>
      </div>}

      <div data-settings-grid-wide className={infoRowClass}>
        <Trans id="settings.course.extension-badge" message="If you have the browser extension installed, its badge shows how many cards are due — this is read-only information, there is nothing to turn on or off here." />
      </div>
      <div data-settings-grid-wide className={infoRowClass}>
        <Trans id="settings.course.reminder-not-ready" message="Daily reminders aren't turned on yet. When they are, you'll be able to choose the days and quiet hours here." />
      </div>
      <div data-settings-grid-wide className="text-sm text-[var(--sf-text-muted)]">
        <Trans id="settings.course.account-plan-hint" message="Account and plan settings are available from your profile menu." />
      </div>
    </div>
  </section>;
}
