import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, BookOpen, BriefcaseBusiness, Check, GraduationCap, MapPin, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { useCourseSession } from '../courses/CourseGate';
import { COURSE_TARGET_LANGUAGES, type CourseNativeLanguage, type CourseTargetLanguage, type CreateCourseInput } from '../courses/courseModel';
import { goalKindsFor } from '../courses/courseGoalCatalog';
import { NATIVE_LANGUAGE_LABEL, TARGET_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import { DAILY_PACE_OPTIONS, writeDailyPace, type DailyPace } from '../settings/dailyPacePreference';
import { ReminderSettingsSection } from '../reminders/ReminderSettingsSection';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useTheme } from '../theme/ThemeProvider';
import type { StarterCardOutcome } from './createStarterCards';
import { createOwnerStarterCards } from './createOwnerStarterCards';
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft } from './onboardingDraft';
import { useAccountProfileNativeLanguage } from '../profileCompletion/AccountProfileContext';
import './onboarding-journey.css';
import {
  clearOnboardingInProgress, clearOnboardingResumeStep, markOnboardingInProgress,
  nextOnboardingStep, previousOnboardingStep, readOnboardingResumeStep,
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

/** Each language written in its own script; the course labels carry the translated name. */
const NATIVE_ENDONYM: Readonly<Record<CourseNativeLanguage, string>> = { vi: 'Tiếng Việt', en: 'English' };
const TARGET_ENDONYM: Readonly<Record<CourseTargetLanguage, string>> = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文' };
const TARGET_GLYPH: Readonly<Record<CourseTargetLanguage, string>> = { en: 'A', ko: '한', ja: 'あ', zh: '中' };
const ONBOARDING_STEP_ORDER: readonly OnboardingStepId[] = ['language', 'target', 'goal', 'pace', 'aha', 'reminder'];

const goalIcon = (kind: string) => {
  if (kind === 'study-abroad') return BookOpen;
  if (kind === 'business' || kind === 'eps-topik') return BriefcaseBusiness;
  if (kind === 'conversation') return MapPin;
  if (kind === 'none') return Sparkles;
  return GraduationCap;
};

const NoSpecificGoalIcon = Sparkles;
const goalCardClass = 'onboarding-journey__goal-card crystal-chamfer';

function SelectionMark({ on }: { readonly on: boolean }) {
  return <span className="onb-mark" data-on={on} aria-hidden="true"><Check size={14} strokeWidth={3} /></span>;
}

function PrimaryLabel({ children }: { readonly children: ReactNode }) {
  return <><span>{children}</span><ArrowRight aria-hidden="true" size={16} className="onb-primary-icon" /></>;
}

function StepEyebrow({ step, index }: { readonly step: OnboardingStepId; readonly index: number }) {
  const { _ } = useLingui();
  const labels: Record<OnboardingStepId, string> = {
    language: _(msg({ context: 'onboarding.eyebrow.language', message: 'Your language' })),
    target: _(msg({ context: 'onboarding.eyebrow.target', message: 'What to learn' })),
    goal: _(msg({ context: 'onboarding.eyebrow.goal', message: 'Your goal' })),
    pace: _(msg({ context: 'onboarding.eyebrow.pace', message: 'Daily pace' })),
    aha: _(msg({ context: 'onboarding.eyebrow.aha', message: 'First cards' })),
    reminder: _(msg({ context: 'onboarding.eyebrow.reminder', message: 'Reminders' })),
  };
  return <p className="onb-eyebrow">
    <span><Trans {...msg({ context: 'onboarding.eyebrow.step', message: 'Step {step} of {total}' })} values={{ step: index, total: ONBOARDING_STEP_ORDER.length }} /></span>
    <span className="onb-eyebrow-sep" aria-hidden="true" />
    <span>{labels[step]}</span>
  </p>;
}

function LumiGuide({ step }: { readonly step: OnboardingStepId }) {
  const { _ } = useLingui();
  const lines: Record<OnboardingStepId, readonly [string, string]> = {
    language: [_(msg({ context: 'onboarding.lumi.language.title', message: 'Hi, I’m Lumi!' })), _(msg({ context: 'onboarding.lumi.language.body', message: 'Pick the language you read best. Every meaning and explanation will be written in it.' }))],
    target: [_(msg({ context: 'onboarding.lumi.target.title', message: 'What shall we learn?' })), _(msg({ context: 'onboarding.lumi.target.body', message: 'Pick one language for now. You can add more from the course switcher.' }))],
    goal: [_(msg({ context: 'onboarding.lumi.goal.title', message: 'Got a goal in mind?' })), _(msg({ context: 'onboarding.lumi.goal.body', message: 'Choose a path and your cards will follow it.' }))],
    pace: [_(msg({ context: 'onboarding.lumi.pace.title', message: 'How fast shall we go?' })), _(msg({ context: 'onboarding.lumi.pace.body', message: 'Start small. You can change this later.' }))],
    aha: [_(msg({ context: 'onboarding.lumi.aha.title', message: 'Ready for your first cards?' })), _(msg({ context: 'onboarding.lumi.aha.body', message: 'Five common words, so you can start right away.' }))],
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
  const profileNativeLanguage = useAccountProfileNativeLanguage();
  const { family } = useTheme();
  const [saved] = useState(() => ({ step: readOnboardingResumeStep(ownerId), draft: readOnboardingDraft(ownerId) }));
  const [step, setStep] = useState<OnboardingStepId>(() =>
    saved.draft?.targetLanguage || saved.step === 'language' || saved.step === 'target' ? saved.step : 'target');
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

  const targetOptions = COURSE_TARGET_LANGUAGES.filter(language => language !== nativeLanguage);
  const goalOptions = targetLanguage ? goalKindsFor(targetLanguage) : [];
  const selectedGoal = goalOptions.find(option => option.kind === goalKind);
  const stepIndex = ONBOARDING_STEP_ORDER.indexOf(step) + 1;

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

  const crystal = family === 'crystal';
  const showLumi = crystal && readLumiEnabled();
  const backButton = <button type="button" disabled={step === 'reminder' && reminderSaveLocked} className={responsiveSecondaryButtonClass} onClick={goBack}><Trans {...msg({ context: 'onboarding.back', message: 'Back' })} /></button>;
  const continueButton = (disabled = false) => <button type="button" className={responsivePrimaryButtonClass} disabled={disabled} onClick={goNext}><PrimaryLabel><Trans {...msg({ context: 'onboarding.continue', message: 'Continue' })} /></PrimaryLabel></button>;
  const goalSummary = selectedGoal
    ? [_(selectedGoal.label), goalLevel.trim(), goalTargetDate].filter(Boolean).join(' · ')
    : _(msg({ context: 'onboarding.goal.none', message: 'No specific goal yet' }));

  let content: ReactNode = null;
  let footer: ReactNode = null;
  let layout: 'start' | 'center' = 'start';

  if (step === 'language') {
    content = <>
      <StepEyebrow step={step} index={stepIndex} />
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
      <StepEyebrow step={step} index={stepIndex} />
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
    </>;
    footer = <>{backButton}{continueButton(!targetLanguage)}</>;
  }

  if (step === 'goal') {
    layout = 'center';
    content = <>
      <StepEyebrow step={step} index={stepIndex} />
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.goal.heading', message: 'Have an exam or <0>goal in mind?</0>' })} components={accent} /></h2>
      <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.goal.subtitle', message: 'Optional. You can add or change this later in the course switcher.' })} /></p>
      <div className="onboarding-journey__goal-grid" data-goal-count={goalOptions.length + 1}>
        <button type="button" aria-pressed={goalKind === null} className={goalCardClass} onClick={() => setGoalKind(null)}>
          <span className={goalIconClass}><NoSpecificGoalIcon aria-hidden="true" size={24} /></span>
          <span className={goalCardTextClass}><span className={goalCardTitleClass}><Trans {...msg({ context: 'onboarding.goal.none', message: 'No specific goal yet' })} /></span><span className={goalCardDescriptionClass}><Trans {...msg({ context: 'onboarding.goal.none.description', message: 'Learn at your own pace and set a goal whenever you like.' })} /></span></span>
          <SelectionMark on={goalKind === null} />
        </button>
        {goalOptions.map(option => {
          const GoalIcon = goalIcon(option.kind);
          return <button key={option.kind} type="button" aria-pressed={goalKind === option.kind} className={goalCardClass} onClick={() => setGoalKind(option.kind)}>
            <span className={goalIconClass}><GoalIcon aria-hidden="true" size={24} /></span>
            <span className={goalCardTextClass}><span className={goalCardTitleClass}>{_(option.label)}</span><span className={goalCardDescriptionClass}>{_(option.levelHint)}</span></span>
            <SelectionMark on={goalKind === option.kind} />
          </button>;
        })}
      </div>
      {selectedGoal && <div className="onb-goal-fields">
        <label className={goalLabelClass}><Trans {...msg({ context: 'course.goal.add.level-label', message: 'Level or target (optional)' })} />
          <input className={goalFieldClass} value={goalLevel} onChange={event => setGoalLevel(event.target.value)} placeholder={_(selectedGoal.levelHint)} maxLength={32} />
        </label>
        <label className={goalLabelClass}><Trans {...msg({ context: 'course.goal.add.date-label', message: 'Exam or target date (optional)' })} />
          <input type="date" className={goalFieldClass} value={goalTargetDate} onChange={event => setGoalTargetDate(event.target.value)} />
        </label>
      </div>}
      {targetLanguage === 'zh' && <div className="onb-goal-fields"><label className={goalLabelClass}><Trans {...msg({ context: 'settings.course.script', message: 'Chinese script' })} />
        <select className={goalFieldClass} value={zhScript ?? 'hans'} onChange={event => setZhScript(event.target.value as 'hans' | 'hant')}>
          <option value="hans"><Trans {...msg({ context: 'settings.course.script.simplified', message: 'Simplified' })} /></option>
          <option value="hant"><Trans {...msg({ context: 'settings.course.script.traditional', message: 'Traditional' })} /></option>
        </select>
      </label></div>}
    </>;
    footer = <>
      {backButton}
      <p className="onb-footer-note"><Trans {...msg({ context: 'onboarding.goal.selected', message: 'Selected: <0>{goal}</0>' })} values={{ goal: goalSummary }} components={{ 0: <strong /> }} /></p>
      {continueButton()}
    </>;
  }

  if (step === 'pace') {
    layout = 'center';
    content = <>
      <StepEyebrow step={step} index={stepIndex} />
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.pace.heading', message: 'How many cards <0>a day?</0>' })} components={accent} /></h2>
      <div className="onboarding-pace-grid onb-pace-grid grid sm:grid-cols-4">
        {DAILY_PACE_OPTIONS.map(option => <button key={option} type="button" aria-pressed={pace === option} className={`${optionButtonClass} onb-pace-card`} onClick={() => setPace(option)}>
          <span className="onb-pace-number">{option}</span>
          <span className="onb-option-sub"><Trans {...msg({ context: 'onboarding.pace.option', message: '{count} cards / day' })} values={{ count: option }} /></span>
          <SelectionMark on={pace === option} />
        </button>)}
      </div>
    </>;
    footer = <>{backButton}{continueButton()}</>;
  }

  if (step === 'aha') {
    content = <>
      <StepEyebrow step={step} index={stepIndex} />
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.aha.heading', message: 'Let\'s add your <0>first cards</0>' })} components={accent} /></h2>
      {ahaOutcome === null && <>
        <p className={stepSubtitleClass}><Trans {...msg({ context: 'onboarding.aha.subtitle', message: 'Five common words to get you started.' })} /></p>
        <div className="onb-actions"><button type="button" className={responsivePrimaryButtonClass} onClick={() => void startAha()}><PrimaryLabel><Trans {...msg({ context: 'onboarding.aha.create', message: 'Add 5 starter cards' })} /></PrimaryLabel></button>
        <button type="button" className={responsiveSecondaryButtonClass} onClick={goNext}><Trans {...msg({ context: 'onboarding.aha.skip', message: 'Skip for now' })} /></button></div>
      </>}
      {ahaOutcome === 'pending' && <p className={ahaNeutralMessageClass} role="status"><Trans {...msg({ context: 'onboarding.aha.pending', message: 'Adding your cards…' })} /></p>}
      {ahaOutcome === 'error' && <>
        <p className="onb-message" data-tone="danger"><Trans {...msg({ context: 'onboarding.aha.error', message: 'Something went wrong adding cards. You can add them later from the library.' })} /></p>
        <div className="onb-actions">{continueButton()}</div>
      </>}
      {ahaOutcome !== null && ahaOutcome !== 'pending' && ahaOutcome !== 'error' && <>
        {ahaOutcome.created.length > 0
          ? <p className="onb-message" data-tone="success"><Trans {...msg({ context: 'onboarding.aha.success', message: 'Added {count} cards to your library.' })} values={{ count: ahaOutcome.created.length }} /></p>
          : <p className={ahaNeutralMessageClass}><Trans {...msg({ context: 'onboarding.aha.none-added', message: 'No cards were added.' })} /></p>}
        {ahaOutcome.created.length > 0 && <ul className="onboarding-created-starter-cards onb-starter-cards">
          {ahaOutcome.created.map(card => <li key={card.id} className="onb-starter-card">
            <span lang={card.language || undefined} className="onb-starter-word">{card.word}</span>
            {card.phonetic && <span className="onb-starter-phonetic">{card.phonetic}</span>}
            <span className="onb-starter-translation">{card.translation}</span>
          </li>)}
        </ul>}
        {ahaOutcome.skippedForQuota > 0 && <p className="onb-quota-note"><Trans {...msg({ context: 'onboarding.aha.quota-note', message: 'Your monthly Free card allowance is almost used up, so {count} card(s) were not added.' })} values={{ count: ahaOutcome.skippedForQuota }} /></p>}
        <div className="onb-actions">{continueButton()}</div>
      </>}
    </>;
  }

  if (step === 'reminder') {
    content = <>
      <StepEyebrow step={step} index={stepIndex} />
      <h2 className={stepTitleClass}><Trans {...msg({ context: 'onboarding.reminder.heading', message: 'Daily <0>reminders</0>' })} components={accent} /></h2>
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
        <div className="onb-progress" role="progressbar" aria-label={_(msg({ context: 'onboarding.progress.label', message: 'Setup progress' }))} aria-valuemin={1} aria-valuemax={6} aria-valuenow={stepIndex} aria-valuetext={`${stepIndex} / 6`}>
          <span className="onb-dots" aria-hidden="true">{ONBOARDING_STEP_ORDER.map((id, index) => <span key={id} data-state={index + 1 < stepIndex ? 'done' : index + 1 === stepIndex ? 'current' : 'upcoming'} />)}</span>
          <span className="onb-count" aria-hidden="true"><b>{stepIndex}</b><span> / 6</span></span>
        </div>
        <button type="button" disabled={reminderSaveLocked} className="onb-skip" onClick={() => setDismissedForSession(true)}><Trans {...msg({ context: 'onboarding.aha.skip', message: 'Skip for now' })} /></button>
      </header>
      <div className="onb-body" data-lumi={showLumi}>
        {showLumi && <LumiGuide step={step} />}
        <main className="onb-main" data-layout={layout}><div className="onb-content">{content}</div></main>
        {footer && <div className={`onboarding-journey__footer onb-footer${step === 'goal' ? ' onboarding-journey__footer--sticky' : ''}`} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>{footer}</div>}
      </div>
    </div>
  </div>;
}
