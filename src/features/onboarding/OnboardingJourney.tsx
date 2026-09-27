import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useEffect, useState } from 'react';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { useCourseSession } from '../courses/CourseGate';
import { COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage } from '../courses/courseModel';
import { goalKindsFor } from '../courses/courseGoalCatalog';
import { TARGET_LANGUAGE_FLAG, TARGET_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import { DAILY_PACE_OPTIONS, writeDailyPace, type DailyPace } from '../settings/dailyPacePreference';
import type { StarterCardOutcome } from './createStarterCards';
import { createOwnerStarterCards } from './createOwnerStarterCards';
import {
  clearOnboardingResumeStep, nextOnboardingStep, previousOnboardingStep,
  readOnboardingResumeStep, writeOnboardingResumeStep, type OnboardingStepId,
} from './onboardingModel';

const cardClass = 'mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-3xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-6 shadow-2xl';
const primaryButtonClass = 'min-h-11 w-full rounded-xl bg-[var(--sf-brand)] px-4 text-sm font-bold text-[var(--sf-on-brand)] disabled:opacity-60';
const secondaryButtonClass = 'min-h-11 w-full rounded-xl border border-[var(--sf-border)] px-4 text-sm font-bold text-[var(--sf-text)]';
const optionButtonClass = (active: boolean) => `flex min-h-11 w-full items-center justify-between rounded-xl border px-4 text-left text-sm font-semibold transition-colors ${active ? 'border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]' : 'border-[var(--sf-border)] text-[var(--sf-text)] hover:bg-[var(--sf-surface-muted)]'}`;

export interface OnboardingJourneyProps {
  readonly ownerId: string;
}

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
    const result = await actions.createCourse({
      targetLanguage,
      nativeLanguage,
      goals: goalKind ? [{ kind: goalKind }] : [],
    });
    if (!result.ok) { setError(result.error.message); return; }
    writeDailyPace(pace);
    clearOnboardingResumeStep(ownerId);
  };

  return <div className="claude-onboarding-journey fixed inset-0 z-50 flex items-center justify-center bg-[var(--sf-scrim)] p-4">
    <div className={cardClass} role="dialog" aria-modal="true" aria-label={_(msg({ id: 'onboarding.title', message: 'Set up your course' }))}>
      {step === 'language' && <>
        <h2 className="text-lg font-bold text-[var(--sf-text)]"><Trans id="onboarding.language.title" message="Choose your language" /></h2>
        <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="onboarding.language.subtitle" message="This sets the app's interface and the language your explanations will be written in." /></p>
        <div className="space-y-2">
          {(['vi', 'en'] as const).map(locale => <button key={locale} type="button" className={optionButtonClass(nativeLanguage === locale)}
            onClick={() => { setNativeLanguage(locale); void setUiLocale(locale); }}>
            {locale === 'vi' ? 'Tiếng Việt' : 'English'}
          </button>)}
        </div>
        <button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
      </>}

      {step === 'target' && <>
        <h2 className="text-lg font-bold text-[var(--sf-text)]"><Trans id="onboarding.target.title" message="What are you learning?" /></h2>
        <div className="space-y-2">
          {targetOptions.map(language => <button key={language} type="button" className={optionButtonClass(targetLanguage === language)} onClick={() => setTargetLanguage(language)}>
            <span>{TARGET_LANGUAGE_FLAG[language]} {_(TARGET_LANGUAGE_LABEL[language])}</span>
          </button>)}
        </div>
        <div className="flex gap-2">
          <button type="button" className={secondaryButtonClass} onClick={goBack}><Trans id="onboarding.back" message="Back" /></button>
          <button type="button" className={primaryButtonClass} disabled={!targetLanguage} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </div>
      </>}

      {step === 'goal' && <>
        <h2 className="text-lg font-bold text-[var(--sf-text)]"><Trans id="onboarding.goal.title" message="Have an exam or goal in mind?" /></h2>
        <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="onboarding.goal.subtitle" message="Optional. You can add or change this later in the course switcher." /></p>
        <div className="space-y-2">
          <button type="button" className={optionButtonClass(goalKind === null)} onClick={() => setGoalKind(null)}><Trans id="onboarding.goal.none" message="No specific goal yet" /></button>
          {goalOptions.map(option => <button key={option.kind} type="button" className={optionButtonClass(goalKind === option.kind)} onClick={() => setGoalKind(option.kind)}>{_(option.label)}</button>)}
        </div>
        <div className="flex gap-2">
          <button type="button" className={secondaryButtonClass} onClick={goBack}><Trans id="onboarding.back" message="Back" /></button>
          <button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </div>
      </>}

      {step === 'pace' && <>
        <h2 className="text-lg font-bold text-[var(--sf-text)]"><Trans id="onboarding.pace.title" message="How many cards a day?" /></h2>
        <div className="space-y-2">
          {DAILY_PACE_OPTIONS.map(option => <button key={option} type="button" className={optionButtonClass(pace === option)} onClick={() => setPace(option)}>
            <Trans id="onboarding.pace.option" message="{count} cards / day" values={{ count: option }} />
          </button>)}
        </div>
        <div className="flex gap-2">
          <button type="button" className={secondaryButtonClass} onClick={goBack}><Trans id="onboarding.back" message="Back" /></button>
          <button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </div>
      </>}

      {step === 'aha' && <>
        <h2 className="text-lg font-bold text-[var(--sf-text)]"><Trans id="onboarding.aha.title" message="Let's add your first cards" /></h2>
        {ahaOutcome === null && <>
          <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.subtitle" message="Five common words to get you started." /></p>
          <button type="button" className={primaryButtonClass} onClick={() => void startAha()}><Trans id="onboarding.aha.create" message="Add 5 starter cards" /></button>
          <button type="button" className={secondaryButtonClass} onClick={goNext}><Trans id="onboarding.aha.skip" message="Skip for now" /></button>
        </>}
        {ahaOutcome === 'pending' && <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.pending" message="Adding your cards…" /></p>}
        {ahaOutcome === 'error' && <>
          <p className="text-sm font-semibold text-[var(--sf-danger)]"><Trans id="onboarding.aha.error" message="Something went wrong adding cards. You can add them later from the library." /></p>
          <button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </>}
        {ahaOutcome !== null && ahaOutcome !== 'pending' && ahaOutcome !== 'error' && <>
          {ahaOutcome.created.length > 0
            ? <p className="text-sm font-semibold text-[var(--sf-success)]"><Trans id="onboarding.aha.success" message="Added {count} cards to your library." values={{ count: ahaOutcome.created.length }} /></p>
            : <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.none-added" message="No cards were added." /></p>}
          {ahaOutcome.skippedForQuota > 0 && <p className="text-xs text-[var(--sf-text-muted)]"><Trans id="onboarding.aha.quota-note" message="Your monthly Free card allowance is almost used up, so {count} card(s) were not added." values={{ count: ahaOutcome.skippedForQuota }} /></p>}
          <button type="button" className={primaryButtonClass} onClick={goNext}><Trans id="onboarding.continue" message="Continue" /></button>
        </>}
      </>}

      {step === 'reminder' && <>
        <h2 className="text-lg font-bold text-[var(--sf-text)]"><Trans id="onboarding.reminder.title" message="Daily reminders" /></h2>
        <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="onboarding.reminder.not-ready" message="Reminders aren't turned on yet. When they are, you'll be able to choose the days and time here and in Settings." /></p>
        {error && <p className="text-sm font-semibold text-[var(--sf-danger)]">{error}</p>}
        <button type="button" className={primaryButtonClass} disabled={model.pending} onClick={() => void finish()}><Trans id="onboarding.finish" message="Start learning" /></button>
      </>}
    </div>
  </div>;
}
