import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useEffect, useState } from 'react';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { useCourseSession } from '../courses/CourseGate';
import { COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage, type CreateCourseInput } from '../courses/courseModel';
import { goalKindsFor } from '../courses/courseGoalCatalog';
import { TARGET_LANGUAGE_FLAG, TARGET_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import { DAILY_PACE_OPTIONS, writeDailyPace, type DailyPace } from '../settings/dailyPacePreference';
import type { StarterCardOutcome } from './createStarterCards';
import { createOwnerStarterCards } from './createOwnerStarterCards';
import {
  clearOnboardingResumeStep, nextOnboardingStep, previousOnboardingStep,
  readOnboardingResumeStep, writeOnboardingResumeStep, type OnboardingStepId,
} from './onboardingModel';

const primaryButtonClass = 'min-h-11 rounded-xl bg-[var(--sf-brand)] px-4 text-sm font-bold text-[var(--sf-on-brand)] disabled:opacity-60';
const secondaryButtonClass = 'min-h-11 rounded-xl border border-[var(--sf-border)] px-4 text-sm font-bold text-[var(--sf-text)]';
const optionButtonClass = (active: boolean) => `flex min-h-11 w-full flex-col items-start justify-center rounded-xl border px-4 text-left text-sm font-semibold transition-colors ${active ? 'border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]' : 'border-[var(--sf-border)] text-[var(--sf-text)] hover:bg-[var(--sf-surface-muted)]'}`;

export interface OnboardingJourneyProps {
  readonly ownerId: string;
}

export const onboardingCourseInput = ({
  targetLanguage,
  nativeLanguage,
  goalKind,
  goalLevel,
  goalTargetDate,
  zhScript,
}: {
  readonly targetLanguage: CourseTargetLanguage;
  readonly nativeLanguage: CourseNativeLanguage;
  readonly goalKind: string | null;
  readonly goalLevel: string;
  readonly goalTargetDate: string;
  readonly zhScript: 'hans' | 'hant' | null;
}): CreateCourseInput => ({
  targetLanguage,
  nativeLanguage,
  goals: goalKind ? [{ kind: goalKind, level: goalLevel.trim() || null, targetDate: goalTargetDate || null }] : [],
  ...(targetLanguage === 'zh' ? { preferences: { zhScript: zhScript ?? 'hans' } } : {}),
});

/**
 * The branched sign-in-only onboarding journey. Every step writes real state
 * (UI locale, a real course/goal via `useCourseSession()`, real starter
 * cards) — nothing here is a fabricated success. It renders until the course
 * profile it created makes `useNeedsOnboarding()` false on its own, so no
 * extra "onDone" plumbing is needed.
 */
export function OnboardingJourney({ ownerId }: OnboardingJourneyProps) {
  const { _ } = useLingui();
  const uiLocale = useUiLocale();
  const setUiLocale = useSetUiLocale();
  const { actions, model } = useCourseSession();
  const [step, setStep] = useState<OnboardingStepId>(() => readOnboardingResumeStep(ownerId));
  const [nativeLanguage, setNativeLanguage] = useState<CourseNativeLanguage>(uiLocale === 'en' ? 'en' : 'vi');
  const [targetLanguage, setTargetLanguage] = useState<CourseTargetLanguage | null>(null);
  const [goalKind, setGoalKind] = useState<string | null>(null);
  const [goalLevel, setGoalLevel] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [zhScript, setZhScript] = useState<'hans' | 'hant' | null>(null);
  const [pace, setPace] = useState<DailyPace>(10);
  const [ahaOutcome, setAhaOutcome] = useState<StarterCardOutcome | 'pending' | 'error' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedForSession, setDismissedForSession] = useState(false);

  useEffect(() => { writeOnboardingResumeStep(ownerId, step); }, [ownerId, step]);

  // Escape closes the overlay for this session only, the same as any other
  // dialog in the shell. Nothing is persisted: a real profile still does not
  // exist, so the overlay resumes at the saved step next time this owner is
  // activated (a fresh mount, e.g. after reload or sign-in again).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setDismissedForSession(true); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (dismissedForSession) return null;

  const targetOptions = COURSE_TARGET_LANGUAGES.filter(language => language !== nativeLanguage);
  const goalOptions = targetLanguage ? goalKindsFor(targetLanguage) : [];
  const selectedGoal = goalOptions.find(option => option.kind === goalKind);
  const stepIndex = ['language', 'target', 'goal', 'pace', 'aha', 'reminder'].indexOf(step) + 1;

  const goNext = () => { const next = nextOnboardingStep(step); if (next) setStep(next); };
  const goBack = () => { const previous = previousOnboardingStep(step); if (previous) setStep(previous); };

  const startAha = async () => {
    if (!targetLanguage) return;
    setAhaOutcome('pending');
    try {
      const outcome = await createOwnerStarterCards(ownerId, targetLanguage, nativeLanguage);
      setAhaOutcome(outcome);
    } catch {
      setAhaOutcome('error');
    }
  };

  const finish = async () => {
    if (!targetLanguage) return;
    setError(null);
    const result = await actions.createCourse(onboardingCourseInput({
      targetLanguage, nativeLanguage, goalKind, goalLevel, goalTargetDate, zhScript,
    }));
    if (!result.ok) { setError(result.error.message); return; }
    writeDailyPace(pace);
    clearOnboardingResumeStep(ownerId);
  };

  return <div className="claude-onboarding-journey fixed inset-0 z-[70] overflow-y-auto bg-[var(--sf-surface)] text-[var(--sf-text)]">
    <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-5 sm:px-8 lg:px-12" role="dialog" aria-modal="true" aria-label={_(msg({ id: 'onboarding.title', message: 'Set up your course' }))}>
      <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-[var(--sf-border)]">
        <span className="font-serif-hero text-xl font-bold tracking-tight">Son<span className="italic text-[var(--sf-brand-text)]">Flash</span></span>
        <div className="mx-auto flex items-center gap-3" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={stepIndex} aria-valuetext={`${stepIndex} / 6`}>
          <div className="flex gap-1.5" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className={`h-1.5 w-5 rounded-full ${index < stepIndex ? 'bg-[var(--sf-brand)]' : 'bg-[var(--sf-border)]'}`} />)}</div>
        </div>
        <button type="button" className="min-h-11 whitespace-nowrap rounded-xl px-4 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]" onClick={() => setDismissedForSession(true)}><Trans id="onboarding.aha.skip" message="Skip for now" /></button>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center py-10">
      {step === 'language' && <>
        <div className="max-w-3xl"><h2 className="font-serif-hero text-4xl font-bold tracking-tight sm:text-5xl"><Trans id="onboarding.language.title" message="Choose your language" /></h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--sf-text-muted)]"><Trans id="onboarding.language.subtitle" message="This sets the app's interface and the language your explanations will be written in." /></p></div>
        <div className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-2">
          {(['vi', 'en'] as const).map(locale => <button key={locale} type="button" className={optionButtonClass(nativeLanguage === locale)}
            onClick={() => { setNativeLanguage(locale); void setUiLocale(locale); }}>
            {locale === 'vi' ? 'Tiếng Việt' : 'English'}
          </button>)}
        </div>
        <div className="mt-10 flex justify-end"><button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button></div>
      </>}

      {step === 'target' && <>
        <h2 className="font-serif-hero text-4xl font-bold tracking-tight sm:text-5xl"><Trans id="onboarding.target.title" message="What are you learning?" /></h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {targetOptions.map(language => <button key={language} type="button" className={optionButtonClass(targetLanguage === language)} onClick={() => {
            if (language !== targetLanguage) {
              setGoalKind(null);
              setGoalLevel('');
              setGoalTargetDate('');
            }
            setTargetLanguage(language);
            if (language !== 'zh') setZhScript(null);
          }}>
            <span>{TARGET_LANGUAGE_FLAG[language]} {_(TARGET_LANGUAGE_LABEL[language])}</span>
          </button>)}
        </div>
        <div className="mt-10 flex justify-between gap-3">
          <button type="button" className={secondaryButtonClass} onClick={goBack}><Trans id="onboarding.back" message="Back" /></button>
          <button type="button" className={primaryButtonClass} disabled={!targetLanguage} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </div>
      </>}

      {step === 'goal' && <>
        <h2 className="font-serif-hero text-4xl font-bold tracking-tight sm:text-5xl"><Trans id="onboarding.goal.title" message="Have an exam or goal in mind?" /></h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--sf-text-muted)]"><Trans id="onboarding.goal.subtitle" message="Optional. You can add or change this later in the course switcher." /></p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button type="button" className={optionButtonClass(goalKind === null)} onClick={() => setGoalKind(null)}><Trans id="onboarding.goal.none" message="No specific goal yet" /></button>
          {goalOptions.map(option => <button key={option.kind} type="button" className={optionButtonClass(goalKind === option.kind)} onClick={() => setGoalKind(option.kind)}>{_(option.label)}</button>)}
        </div>
        {selectedGoal && <div className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-[var(--sf-text)]"><Trans id="course.goal.add.level-label" message="Level or target (optional)" />
            <input className="mt-1 block min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm text-[var(--sf-text)]" value={goalLevel} onChange={event => setGoalLevel(event.target.value)} placeholder={_(selectedGoal.levelHint)} maxLength={32} />
          </label>
          <label className="text-sm font-bold text-[var(--sf-text)]"><Trans id="course.goal.add.date-label" message="Exam or target date (optional)" />
            <input type="date" className="mt-1 block min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm text-[var(--sf-text)]" value={goalTargetDate} onChange={event => setGoalTargetDate(event.target.value)} />
          </label>
        </div>}
        {targetLanguage === 'zh' && <label className="mt-4 block max-w-2xl text-sm font-bold text-[var(--sf-text)]"><Trans id="settings.course.script" message="Chinese script" />
          <select className="mt-1 block min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm text-[var(--sf-text)]" value={zhScript ?? 'hans'} onChange={event => setZhScript(event.target.value as 'hans' | 'hant')}>
            <option value="hans"><Trans id="settings.course.script.simplified" message="Simplified" /></option>
            <option value="hant"><Trans id="settings.course.script.traditional" message="Traditional" /></option>
          </select>
        </label>}
        <div className="mt-10 flex justify-between gap-3">
          <button type="button" className={secondaryButtonClass} onClick={goBack}><Trans id="onboarding.back" message="Back" /></button>
          <button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </div>
      </>}

      {step === 'pace' && <>
        <h2 className="font-serif-hero text-4xl font-bold tracking-tight sm:text-5xl"><Trans id="onboarding.pace.title" message="How many cards a day?" /></h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {DAILY_PACE_OPTIONS.map(option => <button key={option} type="button" className={optionButtonClass(pace === option)} onClick={() => setPace(option)}>
            <Trans id="onboarding.pace.option" message="{count} cards / day" values={{ count: option }} />
          </button>)}
        </div>
        <div className="mt-10 flex justify-between gap-3">
          <button type="button" className={secondaryButtonClass} onClick={goBack}><Trans id="onboarding.back" message="Back" /></button>
          <button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </div>
      </>}

      {step === 'aha' && <>
        <h2 className="font-serif-hero text-4xl font-bold tracking-tight sm:text-5xl"><Trans id="onboarding.aha.title" message="Let's add your first cards" /></h2>
        {ahaOutcome === null && <>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.subtitle" message="Five common words to get you started." /></p>
          <div className="mt-8 flex flex-wrap gap-3"><button type="button" className={primaryButtonClass} onClick={() => void startAha()}><Trans id="onboarding.aha.create" message="Add 5 starter cards" /></button>
          <button type="button" className={secondaryButtonClass} onClick={goNext}><Trans id="onboarding.aha.skip" message="Skip for now" /></button></div>
        </>}
        {ahaOutcome === 'pending' && <p className="mt-8 text-base text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.pending" message="Adding your cards…" /></p>}
        {ahaOutcome === 'error' && <>
          <p className="mt-8 text-base font-semibold text-[var(--sf-danger)]"><Trans id="onboarding.aha.error" message="Something went wrong adding cards. You can add them later from the library." /></p>
          <button type="button" className={`${primaryButtonClass} mt-6`} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </>}
        {ahaOutcome !== null && ahaOutcome !== 'pending' && ahaOutcome !== 'error' && <>
          {ahaOutcome.created.length > 0
            ? <p className="mt-8 text-base font-semibold text-[var(--sf-success)]"><Trans id="onboarding.aha.success" message="Added {count} cards to your library." values={{ count: ahaOutcome.created.length }} /></p>
            : <p className="mt-8 text-base text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.none-added" message="No cards were added." /></p>}
          {ahaOutcome.skippedForQuota > 0 && <p className="mt-3 max-w-2xl text-sm text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.quota-note" message="Your monthly Free card allowance is almost used up, so {count} card(s) were not added." values={{ count: ahaOutcome.skippedForQuota }} /></p>}
          <button type="button" className={`${primaryButtonClass} mt-6`} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </>}
      </>}

      {step === 'reminder' && <>
        <h2 className="font-serif-hero text-4xl font-bold tracking-tight sm:text-5xl"><Trans id="onboarding.reminder.title" message="Daily reminders" /></h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--sf-text-muted)]"><Trans id="onboarding.reminder.not-ready" message="Reminders aren't turned on yet. When they are, you'll be able to choose the days and time here and in Settings." /></p>
        {error && <p className="mt-6 text-sm font-semibold text-[var(--sf-danger)]">{error}</p>}
        <div className="mt-10 flex justify-between gap-3"><button type="button" className={secondaryButtonClass} onClick={goBack}><Trans id="onboarding.back" message="Back" /></button>
        <button type="button" className={primaryButtonClass} disabled={model.pending} onClick={() => void finish()}><Trans id="onboarding.finish" message="Start learning" /></button></div>
      </>}
      </main>
    </div>
  </div>;
}
