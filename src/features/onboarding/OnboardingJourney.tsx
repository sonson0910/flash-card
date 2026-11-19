import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, BookOpen, BriefcaseBusiness, Check, GraduationCap, MapPin, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { useCourseSession } from '../courses/CourseGate';
import { COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage, type CreateCourseInput } from '../courses/courseModel';
import { examGoalKindsFor, goalKindsFor, isExamGoalKind } from '../courses/courseGoalCatalog';
import { NATIVE_ENDONYM, NATIVE_LANGUAGE_LABEL, TARGET_ENDONYM, TARGET_GLYPH, TARGET_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import { IELTS_GOAL_KIND } from '../../../functions/src/course-profile-contract';
import { IeltsBandPicker } from '../examProgress/IeltsBandPicker';
import { DAILY_PACE_OPTIONS, writeDailyPace, type DailyPace } from '../settings/dailyPacePreference';
import { ReminderSettingsSection } from '../reminders/ReminderSettingsSection';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useTheme } from '../theme/ThemeProvider';
import type { StarterCardOutcome } from './createStarterCards';
import { createOwnerStarterCards } from './createOwnerStarterCards';
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft } from './onboardingDraft';
import { StarterCardTrial } from './StarterCardTrial';
import { starterCardsFor } from './starterCardCatalog';
import { useAccountProfileNativeLanguage } from '../profileCompletion/AccountProfileContext';
import './onboarding-journey.css';
import {
  MAX_COUNTDOWN_WEEKS, clearOnboardingInProgress, clearOnboardingResumeStep, countdownWeeks, daysUntilGoalDate,
  markOnboardingInProgress, nextOnboardingStep, onboardingStepsFor, previousOnboardingStep, readOnboardingResumeStep,
  writeOnboardingResumeStep, type OnboardingStepId,
} from './onboardingModel';

const primaryButtonClass = 'onb-primary';
const secondaryButtonClass = 'onb-secondary';
const responsivePrimaryButtonClass = `${primaryButtonClass} w-full sm:w-auto`;
const responsiveSecondaryButtonClass = `${secondaryButtonClass} w-full sm:w-auto`;
const optionButtonClass = 'onb-option crystal-chamfer min-h-20';
const stepTitleClass = 'onb-title';
const stepSubtitleClass = 'onb-subtitle';
const goalFieldClass = 'onb-field';
const goalIconClass = 'onb-goal-icon';
const goalCardTextClass = 'onb-goal-text';
const goalCardTitleClass = 'onb-goal-title';
const goalCardDescriptionClass = 'onb-goal-description';
const goalLabelClass = 'onb-field-label';
const ahaNeutralMessageClass = 'onb-message';
const accent = { 0: <em className="onb-accent" /> };

const NO_GOAL_KEY = 'none';

const goalIcon = (kind: string) => {
  if (kind === 'study-abroad') return BookOpen;
  if (kind === 'business' || kind === 'eps-topik') return BriefcaseBusiness;
  if (kind === 'conversation') return MapPin;
  if (kind === NO_GOAL_KEY) return Sparkles;
  return GraduationCap;
};

const goalCardClass = 'onboarding-journey__goal-card crystal-chamfer';

/** What each non-exam goal card promises; exam goals share one card that leads to the exam step. */
const GOAL_DESCRIPTION: Readonly<Record<string, MessageDescriptor>> = {
  'study-abroad': msg({ context: 'onboarding.goal.description.study-abroad', message: 'Words for lectures, campus life and daily errands.' }),
  business: msg({ context: 'onboarding.goal.description.business', message: 'Speak up in meetings with confident, precise words.' }),
  conversation: msg({ context: 'onboarding.goal.description.conversation', message: 'Everyday phrases for trips and people.' }),
};

const PACE_TAG: Readonly<Record<DailyPace, MessageDescriptor>> = {
  5: msg({ context: 'onboarding.pace.tag.light', message: 'Light' }),
  10: msg({ context: 'onboarding.pace.tag.recommended', message: 'Recommended' }),
  15: msg({ context: 'onboarding.pace.tag.serious', message: 'Serious' }),
  20: msg({ context: 'onboarding.pace.tag.intense', message: 'Intense' }),
};

function SelectionMark({ on }: { readonly on: boolean }) {
  return <span className="onb-mark" data-on={on} aria-hidden="true"><Check size={14} strokeWidth={3} /></span>;
}

function PrimaryLabel({ children }: { readonly children: ReactNode }) {
  return <><span>{children}</span><ArrowRight aria-hidden="true" size={16} className="onb-primary-icon" /></>;
}

function StepEyebrow({ index, total, label }: { readonly index: number; readonly total: number; readonly label: string }) {
  return <p className="onb-eyebrow">
    <span><Trans {...msg({ context: 'onboarding.eyebrow.step', message: 'Step {step} of {total}' })} values={{ step: index, total }} /></span>
    <span className="onb-eyebrow-sep" aria-hidden="true" />
    <span>{label}</span>
  </p>;
}

function LumiGuide({ step }: { readonly step: OnboardingStepId }) {
  const { _ } = useLingui();
  const lines: Record<OnboardingStepId, readonly [string, string]> = {
    language: [_(msg({ context: 'onboarding.lumi.language.title', message: 'Hi, I’m Lumi!' })), _(msg({ context: 'onboarding.lumi.language.body', message: 'Pick the language you read best. Every meaning and explanation will be written in it.' }))],
    target: [_(msg({ context: 'onboarding.lumi.target.title', message: 'What shall we learn?' })), _(msg({ context: 'onboarding.lumi.target.body', message: 'Pick one language for now. You can add more from the course switcher.' }))],
    goal: [_(msg({ context: 'onboarding.lumi.goal.title', message: 'Got a goal in mind?' })), _(msg({ context: 'onboarding.lumi.goal.body', message: 'Choose a path and your cards will follow it.' }))],
    exam: [_(msg({ context: 'onboarding.lumi.exam.title', message: 'When is the big day?' })), _(msg({ context: 'onboarding.lumi.exam.body', message: 'Set a date and I’ll count the days down with you.' }))],
    pace: [_(msg({ context: 'onboarding.lumi.pace.title', message: 'How fast shall we go?' })), _(msg({ context: 'onboarding.lumi.pace.body', message: 'Start small. You can change this later.' }))],
    aha: [_(msg({ context: 'onboarding.lumi.trial.title', message: 'Flip your first cards!' })), _(msg({ context: 'onboarding.lumi.trial.body', message: 'Turn a card to see its meaning, then tell me if you knew it.' }))],
    reminder: [_(msg({ context: 'onboarding.lumi.reminder.title', message: 'Want a nudge?' })), _(msg({ context: 'onboarding.lumi.reminder.body', message: 'Pick a time and SonFlash will remind you to review.' }))],
  };
  const [title, body] = lines[step];
  return <aside className="onb-lumi" aria-label={_(msg({ context: 'onboarding.lumi.label', message: 'Lumi' }))}>
    <div className="onb-lumi-bubble">
      <p className="onb-lumi-kicker"><Trans {...msg({ context: 'onboarding.lumi.kicker', message: 'Lumi · online' })} /></p>
      <p className="onb-lumi-title">{title}</p>
      <p className="onb-lumi-body">{body}</p>
    </div>
    <Lumi pose={step === 'aha' ? 'proud' : 'happy'} size={290} className="crystal-ornament onb-lumi-figure" />
  </aside>;
}

/** Days and weeks left until the goal's own date; nothing is shown until the learner picks one. */
function GoalCountdown({ days, goal, exam }: { readonly days: number | null; readonly goal: string; readonly exam: boolean }) {
  const { _ } = useLingui();
  const weeks = days !== null && days >= 0 ? countdownWeeks(days) : 0;
  const bars = Math.min(weeks, MAX_COUNTDOWN_WEEKS);
  return <section className="onb-countdown crystal-chamfer" aria-label={_(msg({ context: 'onboarding.countdown.label', message: 'Countdown' }))} data-state={days === null ? 'empty' : days < 0 ? 'past' : 'set'}>
    <p className="onb-kicker"><Trans {...msg({ context: 'onboarding.countdown.kicker', message: 'Countdown' })} /></p>
    {days === null && <p className="onb-countdown-empty"><Trans {...msg({ context: 'onboarding.countdown.empty', message: 'Pick a date to start your countdown.' })} /></p>}
    {days !== null && days < 0 && <p className="onb-countdown-empty"><Trans {...msg({ context: 'onboarding.countdown.past', message: 'This date has already passed. Pick a date ahead.' })} /></p>}
    {days !== null && days >= 0 && <>
      <p className="onb-countdown-days">
        <span className="onb-countdown-number">{days}</span>
        <span className="onb-countdown-unit"><Trans {...msg({ context: 'onboarding.countdown.days', message: '{days, plural, one {day to {goal}} other {days to {goal}}}' })} values={{ days, goal }} /></span>
      </p>
      <span className="onb-weeks" aria-hidden="true">
        {Array.from({ length: bars }, (_unused, index) => <span key={index} data-week={index === 0 ? 'now' : index === bars - 1 ? 'goal' : 'ahead'} />)}
      </span>
      <p className="onb-countdown-note">
        {exam
          ? <Trans {...msg({ context: 'onboarding.countdown.weeks.exam', message: '{weeks, plural, one {# week} other {# weeks}} until exam day.' })} values={{ weeks }} />
          : <Trans {...msg({ context: 'onboarding.countdown.weeks.goal', message: '{weeks, plural, one {# week} other {# weeks}} until your target date.' })} values={{ weeks }} />}
      </p>
    </>}
  </section>;
}

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

/** Formats a stored `YYYY-MM-DD` goal date in the learner's interface language, as a local calendar day. */
const formatGoalDate = (isoDate: string, locale: string): string => {
  const [year, month, day] = isoDate.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
  } catch {
    return isoDate;
  }
};

const formatCount = (value: number, locale: string): string => {
  try { return new Intl.NumberFormat(locale).format(value); } catch { return String(value); }
};

/**
 * The branched sign-in-only onboarding journey. Every step writes real state
 * (UI locale, a real course/goal via `useCourseSession()`, real starter
 * cards) — nothing here is a fabricated success. It renders until the course
 * profile it created makes `useNeedsOnboarding()` false on its own, so no
 * extra "onDone" plumbing is needed.
 */
export function OnboardingJourney({ ownerId }: OnboardingJourneyProps) {
  const { _, i18n } = useLingui();
  const uiLocale = useUiLocale();
  const setUiLocale = useSetUiLocale();
  const { actions, model } = useCourseSession();
  const profileNativeLanguage = useAccountProfileNativeLanguage();
  const { family } = useTheme();
  const [saved] = useState(() => ({ step: readOnboardingResumeStep(ownerId), draft: readOnboardingDraft(ownerId) }));
  const [step, setStep] = useState<OnboardingStepId>(() => {
    const resumed = saved.draft?.targetLanguage || saved.step === 'language' || saved.step === 'target' ? saved.step : 'target';
    return resumed === 'exam' && !saved.draft?.goalKind ? 'goal' : resumed;
  });
  const [nativeLanguage, setNativeLanguage] = useState<CourseNativeLanguage>(saved.draft?.nativeLanguage ?? profileNativeLanguage ?? (uiLocale === 'en' ? 'en' : 'vi'));
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

  const steps = onboardingStepsFor(goalKind !== null);
  const targetOptions = COURSE_TARGET_LANGUAGES.filter(language => language !== nativeLanguage);
  const goalOptions = targetLanguage ? goalKindsFor(targetLanguage) : [];
  const examOptions = targetLanguage ? examGoalKindsFor(targetLanguage) : [];
  const otherGoalOptions = goalOptions.filter(option => !option.exam);
  const selectedGoal = goalOptions.find(option => option.kind === goalKind);
  const examGoal = targetLanguage !== null && isExamGoalKind(targetLanguage, goalKind);
  const stepIndex = steps.indexOf(step) + 1;
  const totalSteps = steps.length;
  const daysLeft = selectedGoal ? daysUntilGoalDate(goalTargetDate) : null;
  const starterCount = targetLanguage ? starterCardsFor(targetLanguage, nativeLanguage).length : 0;

  const goNext = () => { const next = nextOnboardingStep(step, steps); if (next) setStep(next); };
  const goBack = () => {
    if (step === 'reminder' && reminderSaveLocked) return;
    const previous = previousOnboardingStep(step, steps);
    if (previous) setStep(previous);
  };

  const chooseGoal = (kind: string | null) => {
    if (kind !== goalKind && (kind === IELTS_GOAL_KIND || goalKind === IELTS_GOAL_KIND)) setGoalLevel('');
    setGoalKind(kind);
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

  // "Try 5 cards" writes the starter cards once; returning to the pace step later just walks forward again.
  const startTrial = () => {
    if (starterCount > 0 && (ahaOutcome === null || ahaOutcome === 'error')) void startAha();
    goNext();
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

  const crystal = family === 'crystal';
  const showLumi = crystal && readLumiEnabled();
  const backButton = <button type="button" disabled={step === 'reminder' && reminderSaveLocked} className={responsiveSecondaryButtonClass} onClick={goBack}><Trans {...msg({ context: 'onboarding.back', message: 'Back' })} /></button>;
  const continueButton = (disabled = false) => <button type="button" className={responsivePrimaryButtonClass} disabled={disabled} onClick={goNext}><PrimaryLabel><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></PrimaryLabel></button>;
  const goalName = selectedGoal ? _(selectedGoal.label) : '';
  const goalSummary = selectedGoal
    ? [goalName, goalLevel.trim(), goalTargetDate].filter(Boolean).join(' · ')
    : _(msg({ context: 'onboarding.goal.none', message: 'No specific goal yet' }));
  const selectedNote = <p className="onb-footer-note"><Trans {...msg({ context: 'onboarding.goal.selected', message: 'Selected: <0>{goal}</0>' })} values={{ goal: goalSummary }} components={{ 0: <strong /> }} /></p>;
  const eyebrowLabels: Record<OnboardingStepId, string> = {
    language: _(msg({ context: 'onboarding.eyebrow.language', message: 'Your language' })),
    target: _(msg({ context: 'onboarding.eyebrow.target', message: 'What to learn' })),
    goal: _(msg({ context: 'onboarding.eyebrow.goal', message: 'Your goal' })),
    exam: examGoal
      ? _(msg({ context: 'onboarding.eyebrow.exam', message: 'Your exam' }))
      : _(msg({ context: 'onboarding.eyebrow.level', message: 'Your target' })),
    pace: _(msg({ context: 'onboarding.eyebrow.pace', message: 'Daily pace' })),
    aha: _(msg({ context: 'onboarding.eyebrow.aha', message: 'First cards' })),
    reminder: _(msg({ context: 'onboarding.eyebrow.reminder', message: 'Reminders' })),
  };
  const eyebrow = <StepEyebrow index={stepIndex} total={totalSteps} label={eyebrowLabels[step]} />;

  let content: ReactNode = null;
  let footer: ReactNode = null;
  let layout: 'start' | 'center' = 'start';

  if (step === 'language') {
    content = <>
      {eyebrow}
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.language.heading', message: 'Choose your <0>language</0>' })} components={accent} /></h2>
      <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.language.subtitle', message: 'This sets the app\'s interface and the language your explanations will be written in.' })} /></p>
      <div className="onb-language-grid">
        {(['vi', 'en'] as const).map(locale => <button key={locale} type="button" aria-pressed={nativeLanguage === locale} className={optionButtonClass}
          onClick={() => { setNativeLanguage(locale); void setUiLocale(locale); }}>
          <span lang={locale} className="onb-option-name">{NATIVE_ENDONYM[locale]}</span>
          {_(NATIVE_LANGUAGE_LABEL[locale]) !== NATIVE_ENDONYM[locale] && <span className="onb-option-sub">{_(NATIVE_LANGUAGE_LABEL[locale])}</span>}
          <SelectionMark on={nativeLanguage === locale} />
        </button>)}
      </div>
    </>;
    footer = <>
      <p className="onb-footer-note"><Trans {...msg({ context: 'onboarding.language.switch-note', message: 'The app switches to {language} right away.' })} values={{ language: NATIVE_ENDONYM[nativeLanguage] }} /></p>
      {continueButton()}
    </>;
  }

  if (step === 'target') {
    content = <>
      {eyebrow}
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.target.heading', message: 'What are you <0>learning?</0>' })} components={accent} /></h2>
      <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.target.subtitle', message: 'Each language is its own course, with its own cards and goals. You can add another later.' })} /></p>
      <div className="onb-target-grid">
        {targetOptions.map(language => {
          const exam = goalKindsFor(language)[0];
          return <button key={language} type="button" aria-pressed={targetLanguage === language} className={`${optionButtonClass} onb-target-card`} onClick={() => {
            if (language !== targetLanguage) {
              setGoalKind(null);
              setGoalLevel('');
              setGoalTargetDate('');
              setAhaOutcome(null);
            }
            setTargetLanguage(language);
            if (language !== 'zh') setZhScript(null);
          }}>
            <span className="onb-glyph" aria-hidden="true" lang={language}>{TARGET_GLYPH[language]}</span>
            <span lang={language} className="onb-option-name">{TARGET_ENDONYM[language]}</span>
            <span className="onb-option-sub">{_(TARGET_LANGUAGE_LABEL[language])}</span>
            {exam && <span className="onb-option-tag">{_(exam.label)}</span>}
            <SelectionMark on={targetLanguage === language} />
          </button>;
        })}
      </div>
      {targetLanguage === 'zh' && <div className="onb-target-options"><label className={goalLabelClass}><Trans {...msg({ context: 'settings.course.script', message: 'Chinese script' })} />
        <select className={goalFieldClass} value={zhScript ?? 'hans'} onChange={event => setZhScript(event.target.value as 'hans' | 'hant')}>
          <option value="hans">{_(msg({ context: 'settings.course.script.simplified', message: 'Simplified' }))}</option>
          <option value="hant">{_(msg({ context: 'settings.course.script.traditional', message: 'Traditional' }))}</option>
        </select>
      </label></div>}
    </>;
    footer = <>{backButton}{continueButton(!targetLanguage)}</>;
  }

  if (step === 'goal') {
    layout = 'center';
    const examLabels = examOptions.map(option => _(option.label)).join(' / ');
    const cardCount = (examOptions.length > 0 ? 1 : 0) + otherGoalOptions.length + 1;
    const NoGoalIcon = goalIcon(NO_GOAL_KEY);
    content = <>
      {eyebrow}
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.goal.heading', message: 'What are you <0>learning for?</0>' })} components={accent} /></h2>
      <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.goal.subtitle', message: 'Pick one. You can change it any time from the course switcher.' })} /></p>
      <div className="onboarding-journey__goal-grid" data-goal-count={cardCount}>
        {examOptions.length > 0 && <button type="button" aria-pressed={examGoal} className={goalCardClass} onClick={() => { if (!examGoal) chooseGoal(examOptions[0].kind); }}>
          <span className={goalIconClass}><GraduationCap aria-hidden="true" size={24} /></span>
          <span className={goalCardTextClass}>
            <span className={goalCardTitleClass}><Trans {...msg({ context: 'onboarding.goal.exam', message: 'Pass {exams}' })} values={{ exams: examLabels }} /></span>
            <span className={goalCardDescriptionClass}><Trans {...msg({ context: 'onboarding.goal.exam.description', message: 'Set a target score and count down to your test date.' })} /></span>
          </span>
          <SelectionMark on={examGoal} />
        </button>}
        {otherGoalOptions.map(option => {
          const GoalIcon = goalIcon(option.kind);
          const description = GOAL_DESCRIPTION[option.kind];
          return <button key={option.kind} type="button" aria-pressed={goalKind === option.kind} className={goalCardClass} onClick={() => chooseGoal(option.kind)}>
            <span className={goalIconClass}><GoalIcon aria-hidden="true" size={24} /></span>
            <span className={goalCardTextClass}><span className={goalCardTitleClass}>{_(option.label)}</span><span className={goalCardDescriptionClass}>{_(description ?? option.levelHint)}</span></span>
            <SelectionMark on={goalKind === option.kind} />
          </button>;
        })}
        <button type="button" aria-pressed={goalKind === null} className={goalCardClass} onClick={() => chooseGoal(null)}>
          <span className={goalIconClass}><NoGoalIcon aria-hidden="true" size={24} /></span>
          <span className={goalCardTextClass}><span className={goalCardTitleClass}><Trans {...msg({ context: 'onboarding.goal.curious', message: 'Just curious' })} /></span><span className={goalCardDescriptionClass}><Trans {...msg({ context: 'onboarding.goal.curious.description', message: 'No exam or deadline. Grow a vocabulary that feels like yours.' })} /></span></span>
          <SelectionMark on={goalKind === null} />
        </button>
      </div>
    </>;
    footer = <>{backButton}{selectedNote}{continueButton()}</>;
  }

  if (step === 'exam' && selectedGoal) {
    content = <div className="onb-exam">
      <div className="onb-exam-form">
        {eyebrow}
        <h2 className={stepTitleClass}>
          {examGoal
            ? <Trans {...msg({ context: 'onboarding.exam.heading', message: 'Which test, and <0>what score?</0>' })} components={accent} />
            : <Trans {...msg({ context: 'onboarding.exam.level-heading', message: 'What level, and <0>by when?</0>' })} components={accent} />}
        </h2>
        <p className={stepSubtitleClass}>
          {examGoal
            ? <Trans {...msg({ context: 'onboarding.exam.subtitle', message: 'Your target and test date. Both are optional and you can change them later.' })} />
            : <Trans {...msg({ context: 'onboarding.exam.level-subtitle', message: 'Both are optional and you can change them later.' })} />}
        </p>
        {examGoal && <div className="onb-chip-row" role="group" aria-label={_(msg({ context: 'onboarding.exam.choice-label', message: 'Exam' }))}>
          {examOptions.map(option => <button key={option.kind} type="button" aria-pressed={goalKind === option.kind} className="onb-chip crystal-chamfer-sm" onClick={() => chooseGoal(option.kind)}>{_(option.label)}</button>)}
        </div>}
        <div className="onb-goal-fields" data-goal-kind={selectedGoal.kind}>
          {selectedGoal.kind === IELTS_GOAL_KIND
            ? <div className="onb-goal-band"><IeltsBandPicker value={goalLevel || null} onChange={setGoalLevel} /></div>
            : <label className={goalLabelClass}><Trans {...msg({ context: 'course.goal.add.level-label', message: 'Level or target (optional)' })} />
              <input className={goalFieldClass} value={goalLevel} onChange={event => setGoalLevel(event.target.value)} placeholder={_(selectedGoal.levelHint)} maxLength={32} />
            </label>}
          <label className={goalLabelClass}>
            {examGoal
              ? <Trans {...msg({ context: 'onboarding.exam.date-label', message: 'Exam date (optional)' })} />
              : <Trans {...msg({ context: 'onboarding.exam.target-date-label', message: 'Target date (optional)' })} />}
            <input type="date" className={goalFieldClass} value={goalTargetDate} onChange={event => setGoalTargetDate(event.target.value)} />
          </label>
        </div>
      </div>
      <GoalCountdown days={daysLeft} goal={goalName} exam={examGoal} />
    </div>;
    footer = <>{backButton}{selectedNote}{continueButton()}</>;
  }

  // A resumed draft can name a goal this course no longer offers; the learner just walks on.
  if (step === 'exam' && !selectedGoal) footer = <>{backButton}{continueButton()}</>;

  if (step === 'pace') {
    layout = 'center';
    const planDays = daysLeft !== null && daysLeft > 0 ? daysLeft : null;
    content = <>
      {eyebrow}
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.pace.heading', message: 'How many new words <0>each day?</0>' })} components={accent} /></h2>
      <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.pace.subtitle', message: 'New words added to your reviews each day. You can change this any time in Settings.' })} /></p>
      <div className="onboarding-pace-grid onb-pace-grid grid sm:grid-cols-4">
        {DAILY_PACE_OPTIONS.map(option => <button key={option} type="button" aria-pressed={pace === option} className={`${optionButtonClass} onb-pace-card`} onClick={() => setPace(option)}>
          <span className="onb-pace-number">{option}</span>
          <span className="onb-option-sub"><Trans {...msg({ context: 'onboarding.pace.unit', message: 'cards / day' })} /></span>
          <span className="onb-pace-tag">{_(PACE_TAG[option])}</span>
          <SelectionMark on={pace === option} />
        </button>)}
      </div>
      <p className="onb-projection crystal-chamfer-sm">
        <span className="onb-projection-number">{formatCount(planDays !== null ? pace * planDays : pace * 7, i18n.locale)}</span>
        <span className="onb-projection-text">
          {planDays !== null
            ? <Trans {...msg({ context: 'onboarding.pace.plan.dated', message: 'new words in your plan by {date}: {pace} a day for {days, plural, one {# day} other {# days}}.' })} values={{ date: formatGoalDate(goalTargetDate, i18n.locale), pace, days: planDays }} />
            : <Trans {...msg({ context: 'onboarding.pace.plan.weekly', message: 'new words a week in your plan at {pace} a day.' })} values={{ pace }} />}
        </span>
      </p>
    </>;
    footer = <>
      {backButton}
      <button type="button" className={responsivePrimaryButtonClass} onClick={startTrial}><PrimaryLabel>
        {starterCount > 0
          ? <Trans {...msg({ context: 'onboarding.pace.try', message: 'Try {count} cards' })} values={{ count: starterCount }} />
          : <Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} />}
      </PrimaryLabel></button>
    </>;
  }

  if (step === 'aha') {
    const created = ahaOutcome !== null && ahaOutcome !== 'pending' && ahaOutcome !== 'error' ? ahaOutcome : null;
    content = created && created.created.length > 0
      ? <StarterCardTrial cards={created.created} eyebrow={eyebrow} />
      : <>
        {eyebrow}
        <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.aha.heading', message: 'Let\'s add your <0>first cards</0>' })} components={accent} /></h2>
        {ahaOutcome === null && <>
          <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.aha.subtitle', message: 'Five common words to get you started.' })} /></p>
          {starterCount > 0 && <div className="onb-actions"><button type="button" className={responsivePrimaryButtonClass} onClick={() => void startAha()}><PrimaryLabel><Trans {...msg({ context: 'onboarding.aha.create', message: 'Add 5 starter cards' })} /></PrimaryLabel></button></div>}
        </>}
        {ahaOutcome === 'pending' && <p className={ahaNeutralMessageClass} role="status"><Trans {...msg({ context: 'onboarding.aha.pending', message: 'Adding your cards…' })} /></p>}
        {ahaOutcome === 'error' && <p className="onb-message" data-tone="danger" role="alert"><Trans {...msg({ context: 'onboarding.aha.error', message: 'Something went wrong adding cards. You can add them later from the library.' })} /></p>}
        {created && <p className={ahaNeutralMessageClass}><Trans {...msg({ context: 'onboarding.aha.none-added', message: 'No cards were added.' })} /></p>}
      </>;
    footer = <>
      {backButton}
      {created && created.skippedForQuota > 0 && <p className="onb-footer-note onb-quota-note"><Trans {...msg({ context: 'onboarding.aha.quota-note', message: 'Your monthly Free card allowance is almost used up, so {count} card(s) were not added.' })} values={{ count: created.skippedForQuota }} /></p>}
      <button type="button" className={responsivePrimaryButtonClass} onClick={goNext}><PrimaryLabel><Trans {...msg({ context: 'onboarding.aha.next', message: 'Set my reminder' })} /></PrimaryLabel></button>
    </>;
  }

  if (step === 'reminder') {
    content = <>
      {eyebrow}
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.reminder.title', message: 'When should we <0>nudge you?</0>' })} components={accent} /></h2>
      <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.reminder.description', message: 'Choose when SonFlash can remind you to review.' })} /></p>
      <div className="onb-reminder-panel"><ReminderSettingsSection initialOwnerId={ownerId} embedded onSaveStateChange={onReminderSaveStateChange} onSkip={skipFailedSave} /></div>
      {error && <p className="onb-message" data-tone="danger" role="alert">{error}</p>}
    </>;
    footer = <>
      {backButton}
      <button type="button" className={responsivePrimaryButtonClass} disabled={model.pending || reminderSaveLocked} onClick={() => void finish()}><PrimaryLabel><Trans {...msg({ context: 'onboarding.finish', message: 'Start learning' })} /></PrimaryLabel></button>
    </>;
  }

  return <div className="claude-onboarding-journey fixed inset-0 z-[70] overflow-y-auto" data-onboarding-step={step}>
    {crystal && <>
      <span className="onb-shard onb-shard--left crystal-wing crystal-ornament" aria-hidden="true" />
      <span className="onb-shard onb-shard--right crystal-wing crystal-ornament" aria-hidden="true" />
    </>}
    <div className="onb-frame" role="dialog" aria-modal="true" aria-label={_(msg({ id: 'onboarding.title', message: 'Set up your course' }))}>
      <header className="onb-header">
        <span className="onb-brand">
          <span className="onb-logo" aria-hidden="true">{crystal ? <span className="onb-logo-star" /> : 'S'}</span>
          <span className="onb-wordmark">Son<em>Flash</em></span>
        </span>
        <span className="onb-tag" aria-hidden="true"><span><Trans {...msg({ context: 'onboarding.header.tag', message: 'Hello · let’s begin' })} /></span></span>
        <div className="onb-progress" role="progressbar" aria-label={_(msg({ context: 'onboarding.progress.label', message: 'Setup progress' }))} aria-valuemin={1} aria-valuemax={totalSteps} aria-valuenow={stepIndex} aria-valuetext={`${stepIndex} / ${totalSteps}`}>
          <span className="onb-dots" aria-hidden="true">{steps.map((id, index) => <span key={id} data-state={index + 1 < stepIndex ? 'done' : index + 1 === stepIndex ? 'current' : 'upcoming'} />)}</span>
          <span className="onb-count" aria-hidden="true"><b>{stepIndex}</b><span>{` / ${totalSteps}`}</span></span>
        </div>
        <button type="button" disabled={reminderSaveLocked} className="onb-skip" onClick={() => setDismissedForSession(true)}><Trans {...msg({ context: 'onboarding.aha.skip', message: 'Skip for now' })} /></button>
      </header>
      <div className="onb-body" data-lumi={showLumi}>
        {showLumi && <LumiGuide step={step} />}
        <main className="onb-main" data-layout={layout}><div className="onb-content">{content}</div></main>
        {footer && <div className={`onboarding-journey__footer onb-footer${step === 'goal' || step === 'exam' ? ' onboarding-journey__footer--sticky' : ''}`} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>{footer}</div>}
      </div>
    </div>
  </div>;
}
