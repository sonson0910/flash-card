import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { BookOpen, BriefcaseBusiness, Check, GraduationCap, MapPin, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { useCourseSession } from '../courses/CourseGate';
import { COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage, type CreateCourseInput } from '../courses/courseModel';
import { goalKindsFor } from '../courses/courseGoalCatalog';
import { TARGET_LANGUAGE_FLAG, TARGET_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import { DAILY_PACE_OPTIONS, writeDailyPace, type DailyPace } from '../settings/dailyPacePreference';
import { ReminderSettingsSection } from '../reminders/ReminderSettingsSection';
import type { StarterCardOutcome } from './createStarterCards';
import { createOwnerStarterCards } from './createOwnerStarterCards';
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft } from './onboardingDraft';
import './onboarding-journey.css';
import {
  clearOnboardingInProgress, clearOnboardingResumeStep, markOnboardingInProgress,
  nextOnboardingStep, previousOnboardingStep, readOnboardingResumeStep,
  writeOnboardingResumeStep, type OnboardingStepId,
} from './onboardingModel';

const primaryButtonClass = 'min-h-11 rounded-xl bg-[var(--sf-brand)] px-4 text-sm font-bold text-[var(--sf-on-brand)] disabled:opacity-60';
const secondaryButtonClass = 'min-h-11 rounded-xl border border-[var(--sf-border)] px-4 text-sm font-bold text-[var(--sf-text)]';
const responsivePrimaryButtonClass = `${primaryButtonClass} w-full sm:w-auto`;
const responsiveSecondaryButtonClass = `${secondaryButtonClass} w-full sm:w-auto`;
const optionButtonClass = (active: boolean, compact = false) => `relative flex ${compact ? 'min-h-16 sm:min-h-20' : 'min-h-20'} w-full flex-col items-start justify-center rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? 'border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)]' : 'border-[var(--sf-border)] text-[var(--sf-text)] hover:bg-[var(--sf-surface-muted)]'}`;
const footerClass = 'onboarding-journey__footer';
const goalFooterClass = `${footerClass} onboarding-journey__footer--sticky`;
const paceFooterClass = footerClass;
const stepTitleClass = 'font-serif-hero text-4xl font-bold tracking-tight sm:text-5xl';
const stepSubtitleClass = 'mt-4 max-w-2xl text-base leading-7 text-[var(--sf-text-muted)]';
const goalFieldClass = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm text-[var(--sf-text)]';
const goalIconClass = 'flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--sf-surface-muted)] text-[var(--sf-brand-text)]';
const selectedGoalMarkerClass = 'absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-[var(--sf-brand)] text-[var(--sf-on-brand)]';
const goalCardTextClass = 'min-w-0 sm:mt-auto';
const goalCardTitleClass = 'block font-serif-hero text-lg font-bold leading-tight';
const goalCardDescriptionClass = 'mt-1 block text-xs font-medium leading-5 opacity-75';
const selectionCheckClass = 'absolute right-3 top-3';
const goalLabelClass = 'text-sm font-bold text-[var(--sf-text)]';
const ahaNeutralMessageClass = 'mt-8 text-base text-[var(--sf-text-muted)]';

const goalIcon = (kind: string) => {
  if (kind === 'study-abroad') return BookOpen;
  if (kind === 'business' || kind === 'eps-topik') return BriefcaseBusiness;
  if (kind === 'conversation') return MapPin;
  if (kind === 'none') return Sparkles;
  return GraduationCap;
};

const NoSpecificGoalIcon = Sparkles;
const goalCardClass = 'onboarding-journey__goal-card';

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
  activateOnCreate: true,
  goals: goalKind ? [{ kind: goalKind, level: goalLevel.trim() || null, targetDate: goalTargetDate || null }] : [],
  ...(targetLanguage === 'zh' ? { preferences: { zhScript: zhScript ?? 'hans' } } : {}),
});

export function useOnboardingReminderSaveLock() {
  const [state, setState] = useState({ saving: false, failed: false });
  const onSaveStateChange = useCallback((next: { readonly saving: boolean; readonly failed: boolean }) => {
    setState(current => current.saving === next.saving && current.failed === next.failed ? current : next);
  }, []);
  const skipFailedSave = useCallback(() => setState({ saving: false, failed: false }), []);
  return { locked: state.saving || state.failed, onSaveStateChange, skipFailedSave };
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
  const [saved] = useState(() => ({ step: readOnboardingResumeStep(ownerId), draft: readOnboardingDraft(ownerId) }));
  const [step, setStep] = useState<OnboardingStepId>(() =>
    saved.draft?.targetLanguage || saved.step === 'language' || saved.step === 'target' ? saved.step : 'target');
  const [nativeLanguage, setNativeLanguage] = useState<CourseNativeLanguage>(saved.draft?.nativeLanguage ?? (uiLocale === 'en' ? 'en' : 'vi'));
  const [targetLanguage, setTargetLanguage] = useState<CourseTargetLanguage | null>(saved.draft?.targetLanguage ?? null);
  const [goalKind, setGoalKind] = useState<string | null>(saved.draft?.goalKind ?? null);
  const [goalLevel, setGoalLevel] = useState(saved.draft?.goalLevel ?? '');
  const [goalTargetDate, setGoalTargetDate] = useState(saved.draft?.goalTargetDate ?? '');
  const [zhScript, setZhScript] = useState<'hans' | 'hant' | null>(saved.draft?.zhScript ?? null);
  const [pace, setPace] = useState<DailyPace>(saved.draft?.pace ?? 10);
  const [ahaOutcome, setAhaOutcome] = useState<StarterCardOutcome | 'pending' | 'error' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissedForSession, setDismissedForSession] = useState(false);
  const { locked: reminderSaveLocked, onSaveStateChange: onReminderSaveStateChange, skipFailedSave } = useOnboardingReminderSaveLock();

  useEffect(() => {
    markOnboardingInProgress(ownerId);
    writeOnboardingResumeStep(ownerId, step);
    writeOnboardingDraft(ownerId, { nativeLanguage, targetLanguage, goalKind, goalLevel, goalTargetDate, zhScript, pace });
  }, [ownerId, step, nativeLanguage, targetLanguage, goalKind, goalLevel, goalTargetDate, zhScript, pace]);

  // Escape closes the overlay for this session only, the same as any other
  // dialog in the shell. Nothing is persisted: a real profile still does not
  // exist, so the overlay resumes at the saved step next time this owner is
  // activated (a fresh mount, e.g. after reload or sign-in again).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !reminderSaveLocked) setDismissedForSession(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [reminderSaveLocked]);

  if (dismissedForSession) return null;

  const targetOptions = COURSE_TARGET_LANGUAGES.filter(language => language !== nativeLanguage);
  const goalOptions = targetLanguage ? goalKindsFor(targetLanguage) : [];
  const selectedGoal = goalOptions.find(option => option.kind === goalKind);
  const stepIndex = ['language', 'target', 'goal', 'pace', 'aha', 'reminder'].indexOf(step) + 1;

  const goNext = () => { const next = nextOnboardingStep(step); if (next) setStep(next); };
  const goBack = () => {
    if (step === 'reminder' && reminderSaveLocked) return;
    const previous = previousOnboardingStep(step);
    if (previous) setStep(previous);
  };

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
    if (!targetLanguage || reminderSaveLocked) return;
    setError(null);
    const result = await actions.createCourse(onboardingCourseInput({
      targetLanguage, nativeLanguage, goalKind, goalLevel, goalTargetDate, zhScript,
    }));
    if (!result.ok) { setError(result.error.message); return; }
    writeDailyPace(pace);
    clearOnboardingDraft(ownerId);
    clearOnboardingResumeStep(ownerId);
    clearOnboardingInProgress(ownerId);
  };

  return <div className="claude-onboarding-journey fixed inset-0 z-[70] overflow-y-auto bg-[var(--sf-surface)] text-[var(--sf-text)]">
    <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-5 sm:px-8 lg:px-12" role="dialog" aria-modal="true" aria-label={_(msg({ id: 'onboarding.title', message: 'Set up your course' }))}>
      <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-[var(--sf-border)]">
        <span className="font-serif-hero text-xl font-bold tracking-tight">Son<span className="italic text-[var(--sf-brand-text)]">Flash</span></span>
        <div className="mx-auto flex items-center gap-3" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={stepIndex} aria-valuetext={`${stepIndex} / 6`}>
          <div className="flex gap-1.5" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className={`h-1.5 w-5 rounded-full ${index < stepIndex ? 'bg-[var(--sf-brand)]' : 'bg-[var(--sf-border)]'}`} />)}</div>
        </div>
        <button type="button" disabled={reminderSaveLocked} className="min-h-11 whitespace-nowrap rounded-xl px-4 text-sm font-semibold text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] disabled:opacity-60" onClick={() => setDismissedForSession(true)}><Trans {...msg({ context: 'onboarding.aha.skip', message: 'Skip for now' })} /></button>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center py-10">
      {step === 'language' && <>
        <div className="max-w-3xl"><h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.language.title', message: 'Choose your language' })} /></h2>
        <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.language.subtitle', message: 'This sets the app\'s interface and the language your explanations will be written in.' })} /></p></div>
        <div className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-2">
          {(['vi', 'en'] as const).map(locale => <button key={locale} type="button" aria-pressed={nativeLanguage === locale} className={optionButtonClass(nativeLanguage === locale)}
            onClick={() => { setNativeLanguage(locale); void setUiLocale(locale); }}>
            <span lang={locale} className="font-serif-hero text-lg font-bold">{locale === 'vi' ? 'Tiếng Việt' : 'English'}</span>
            <span aria-hidden="true" className="mt-1 text-xs font-bold uppercase tracking-[0.14em] opacity-70">{locale}</span>
            {nativeLanguage === locale && <Check aria-hidden="true" size={18} className={selectionCheckClass} />}
          </button>)}
        </div>
        <div className="mt-10 flex justify-end"><button type="button" className={responsivePrimaryButtonClass} onClick={goNext}><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></button></div>
      </>}

      {step === 'target' && <>
        <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.target.title', message: 'What are you learning?' })} /></h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {targetOptions.map(language => <button key={language} type="button" aria-pressed={targetLanguage === language} className={optionButtonClass(targetLanguage === language)} onClick={() => {
            if (language !== targetLanguage) {
              setGoalKind(null);
              setGoalLevel('');
              setGoalTargetDate('');
            }
            setTargetLanguage(language);
            if (language !== 'zh') setZhScript(null);
          }}>
            <span className="text-lg font-bold">{TARGET_LANGUAGE_FLAG[language]} {_(TARGET_LANGUAGE_LABEL[language])}</span>
            {targetLanguage === language && <Check aria-hidden="true" size={18} className={selectionCheckClass} />}
          </button>)}
        </div>
        <div className={footerClass}>
          <button type="button" className={responsiveSecondaryButtonClass} onClick={goBack}><Trans {...msg({ context: 'onboarding.back', message: 'Back' })} /></button>
          <button type="button" className={responsivePrimaryButtonClass} disabled={!targetLanguage} onClick={goNext}><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></button>
        </div>
      </>}

      {step === 'goal' && <>
        <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.goal.title', message: 'Have an exam or goal in mind?' })} /></h2>
        <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.goal.subtitle', message: 'Optional. You can add or change this later in the course switcher.' })} /></p>
        <div className="onboarding-journey__goal-grid" data-goal-count={goalOptions.length + 1}>
          <button type="button" aria-pressed={goalKind === null} className={goalCardClass} onClick={() => setGoalKind(null)}>
            <span className={goalIconClass}><NoSpecificGoalIcon aria-hidden="true" size={22} /></span>
            <span className={goalCardTextClass}><span className={goalCardTitleClass}><Trans {...msg({ context: 'onboarding.goal.none', message: 'No specific goal yet' })} /></span><span className={goalCardDescriptionClass}><Trans {...msg({ context: 'onboarding.goal.subtitle', message: 'Optional. You can add or change this later in the course switcher.' })} /></span></span>
            {goalKind === null && <span className={selectedGoalMarkerClass}><Check aria-hidden="true" size={14} /></span>}
          </button>
          {goalOptions.map(option => {
            const GoalIcon = goalIcon(option.kind);
            return <button key={option.kind} type="button" aria-pressed={goalKind === option.kind} className={goalCardClass} onClick={() => setGoalKind(option.kind)}>
              <span className={goalIconClass}><GoalIcon aria-hidden="true" size={22} /></span>
              <span className={goalCardTextClass}><span className={goalCardTitleClass}>{_(option.label)}</span><span className={goalCardDescriptionClass}>{_(option.levelHint)}</span></span>
              {goalKind === option.kind && <span className={selectedGoalMarkerClass}><Check aria-hidden="true" size={14} /></span>}
            </button>;
          })}
        </div>
        {selectedGoal && <div className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2">
          <label className={goalLabelClass}><Trans {...msg({ context: 'course.goal.add.level-label', message: 'Level or target (optional)' })} />
            <input className={goalFieldClass} value={goalLevel} onChange={event => setGoalLevel(event.target.value)} placeholder={_(selectedGoal.levelHint)} maxLength={32} />
          </label>
          <label className={goalLabelClass}><Trans {...msg({ context: 'course.goal.add.date-label', message: 'Exam or target date (optional)' })} />
            <input type="date" className={goalFieldClass} value={goalTargetDate} onChange={event => setGoalTargetDate(event.target.value)} />
          </label>
        </div>}
        {targetLanguage === 'zh' && <label className="mt-4 block max-w-2xl text-sm font-bold text-[var(--sf-text)]"><Trans {...msg({ context: 'settings.course.script', message: 'Chinese script' })} />
          <select className={goalFieldClass} value={zhScript ?? 'hans'} onChange={event => setZhScript(event.target.value as 'hans' | 'hant')}>
            <option value="hans"><Trans {...msg({ context: 'settings.course.script.simplified', message: 'Simplified' })} /></option>
            <option value="hant"><Trans {...msg({ context: 'settings.course.script.traditional', message: 'Traditional' })} /></option>
          </select>
        </label>}
        <div className={goalFooterClass}>
          <button type="button" className={responsiveSecondaryButtonClass} onClick={goBack}><Trans {...msg({ context: 'onboarding.back', message: 'Back' })} /></button>
          <button type="button" className={responsivePrimaryButtonClass} onClick={goNext}><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></button>
        </div>
      </>}

      {step === 'pace' && <>
        <div className="flex flex-1 flex-col">
          <div className="mx-auto my-auto w-full max-w-5xl text-center">
            <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.pace.title', message: 'How many cards a day?' })} /></h2>
            <div className="onboarding-pace-grid mt-8 grid gap-4 sm:grid-cols-4">
              {DAILY_PACE_OPTIONS.map(option => <button key={option} type="button" aria-pressed={pace === option} className={optionButtonClass(pace === option)} style={{ minHeight: 'clamp(5rem, 12vw, 11rem)' }} onClick={() => setPace(option)}>
                <span className="font-serif-hero text-2xl font-bold">{option}</span>
                <span className="mt-1 text-xs font-medium opacity-75"><Trans {...msg({ context: 'onboarding.pace.option', message: '{count} cards / day' })} values={{ count: option }} /></span>
                {pace === option && <Check aria-hidden="true" size={18} className={selectionCheckClass} />}
              </button>)}
            </div>
          </div>
          <div className={paceFooterClass} style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
            <button type="button" className={responsiveSecondaryButtonClass} onClick={goBack}><Trans {...msg({ context: 'onboarding.back', message: 'Back' })} /></button>
            <button type="button" className={responsivePrimaryButtonClass} onClick={goNext}><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></button>
          </div>
        </div>
      </>}

      {step === 'aha' && <>
        <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.aha.title', message: 'Let\'s add your first cards' })} /></h2>
        {ahaOutcome === null && <>
          <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.aha.subtitle', message: 'Five common words to get you started.' })} /></p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row"><button type="button" className={responsivePrimaryButtonClass} onClick={() => void startAha()}><Trans {...msg({ context: 'onboarding.aha.create', message: 'Add 5 starter cards' })} /></button>
          <button type="button" className={responsiveSecondaryButtonClass} onClick={goNext}><Trans {...msg({ context: 'onboarding.aha.skip', message: 'Skip for now' })} /></button></div>
        </>}
        {ahaOutcome === 'pending' && <p className={ahaNeutralMessageClass}><Trans {...msg({ context: 'onboarding.aha.pending', message: 'Adding your cards…' })} /></p>}
        {ahaOutcome === 'error' && <>
          <p className="mt-8 text-base font-semibold text-[var(--sf-danger)]"><Trans {...msg({ context: 'onboarding.aha.error', message: 'Something went wrong adding cards. You can add them later from the library.' })} /></p>
          <button type="button" className={`${primaryButtonClass} mt-6`} onClick={goNext}><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></button>
        </>}
        {ahaOutcome !== null && ahaOutcome !== 'pending' && ahaOutcome !== 'error' && <>
          {ahaOutcome.created.length > 0
            ? <p className="mt-8 text-base font-semibold text-[var(--sf-success)]"><Trans {...msg({ context: 'onboarding.aha.success', message: 'Added {count} cards to your library.' })} values={{ count: ahaOutcome.created.length }} /></p>
            : <p className={ahaNeutralMessageClass}><Trans {...msg({ context: 'onboarding.aha.none-added', message: 'No cards were added.' })} /></p>}
          {ahaOutcome.created.length > 0 && <ul className="onboarding-created-starter-cards mt-4 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ahaOutcome.created.map(card => <li key={card.id} className="rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 text-left">
              <span lang={card.language || undefined} className="block font-serif-hero text-lg font-bold text-[var(--sf-text)]">{card.word}</span>
              {card.phonetic && <span className="mt-1 block text-xs text-[var(--sf-text-muted)]">{card.phonetic}</span>}
              <span className="mt-2 block text-sm text-[var(--sf-brand-text)]">{card.translation}</span>
            </li>)}
          </ul>}
          {ahaOutcome.skippedForQuota > 0 && <p className="mt-3 max-w-2xl text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'onboarding.aha.quota-note', message: 'Your monthly Free card allowance is almost used up, so {count} card(s) were not added.' })} values={{ count: ahaOutcome.skippedForQuota }} /></p>}
          <button type="button" className={`${primaryButtonClass} mt-6`} onClick={goNext}><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></button>
        </>}
      </>}

      {step === 'reminder' && <>
        <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.reminder.title', message: 'Daily reminders' })} /></h2>
        <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.reminder.description', message: 'Choose when SonFlash can remind you to review.' })} /></p>
        <div className="mt-6 max-w-3xl"><ReminderSettingsSection initialOwnerId={ownerId} embedded onSaveStateChange={onReminderSaveStateChange} onSkip={skipFailedSave} /></div>
        {error && <p className="mt-6 text-sm font-semibold text-[var(--sf-danger)]">{error}</p>}
        <div className={footerClass}><button type="button" disabled={reminderSaveLocked} className={`${secondaryButtonClass} w-full sm:w-auto disabled:opacity-60`} onClick={goBack}><Trans {...msg({ context: 'onboarding.back', message: 'Back' })} /></button>
        <button type="button" className={responsivePrimaryButtonClass} disabled={model.pending || reminderSaveLocked} onClick={() => void finish()}><Trans {...msg({ context: 'onboarding.finish', message: 'Start learning' })} /></button></div>
      </>}
      </main>
    </div>
  </div>;
}
