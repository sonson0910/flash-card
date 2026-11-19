import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ChevronDown, X } from 'lucide-react';
import { useId, useState } from 'react';
import {
  COURSE_NATIVE_LANGUAGES, COURSE_TARGET_LANGUAGES,
  type Course, type CourseNativeLanguage, type CourseTargetLanguage, type CreateCourseInput,
} from './courseModel';
import { goalKindsFor } from './courseGoalCatalog';
import { NATIVE_ENDONYM, TARGET_ENDONYM, TARGET_GLYPH, TARGET_GREETING } from './courseLanguageLabels';
import { translatedTargetName } from './CourseVisuals';
import './add-course-dialog.css';

/**
 * The exams named on each language card, as "안녕하세요 · TOPIK". The goal list below still offers
 * every goal kind, EPS-TOPIK included; the card keeps to the short, widely known names.
 */
const EXAM_GOAL_KINDS = new Set(['ielts', 'toeic', 'topik', 'jlpt', 'hsk']);

export interface AddCourseDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly courses: readonly Course[];
  readonly pending: boolean;
  /** The language to preselect, when the learner picked one before opening the dialog. */
  readonly initialTarget?: CourseTargetLanguage | null;
  /** The meanings language the dialog starts on: the account's native language when it is known. */
  readonly defaultNativeLanguage: CourseNativeLanguage;
  /** The account's native language, marked as such in the meanings select. */
  readonly profileNativeLanguage: CourseNativeLanguage | null;
  /** Resolves true once the course exists; the dialog then closes itself. */
  readonly onCreate: (input: CreateCourseInput) => Promise<boolean>;
  readonly onCloseAutoFocus?: (event: Event) => void;
}

function AddCourseForm({ courses, pending, initialTarget, defaultNativeLanguage, profileNativeLanguage, onCreate, onDone }: Omit<AddCourseDialogProps, 'open' | 'onOpenChange' | 'onCloseAutoFocus'> & { readonly onDone: () => void }) {
  const { _ } = useLingui();
  const groupName = useId();
  const nativeHintId = useId();
  const takenTargets = new Set(courses.map(course => course.targetLanguage));
  const available = COURSE_TARGET_LANGUAGES.filter(language => !takenTargets.has(language));
  const [target, setTarget] = useState<CourseTargetLanguage | null>(
    initialTarget && available.includes(initialTarget) ? initialTarget : available[0] ?? null,
  );
  const [native, setNative] = useState<CourseNativeLanguage>(defaultNativeLanguage);
  const [goalKind, setGoalKind] = useState('');
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const goalOptions = target ? goalKindsFor(target) : [];
  const busy = pending || saving;

  const submit = async () => {
    if (!target || busy) return;
    setFailed(false);
    setSaving(true);
    const created = await onCreate({
      targetLanguage: target,
      nativeLanguage: native,
      ...(goalKind ? { goals: [{ kind: goalKind, level: null, targetDate: null }] } : {}),
    }).finally(() => setSaving(false));
    if (created) onDone();
    else setFailed(true);
  };

  return <form className="course-add__form" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset className="course-add__languages" disabled={busy}>
      <legend className="course-add__label course-add__label--caps"><Trans {...msg({ context: 'course.add.languages-label', message: 'I want to learn' })} /></legend>
      <div className="course-add__grid">
        {COURSE_TARGET_LANGUAGES.map(language => {
          const taken = takenTargets.has(language);
          const selected = target === language;
          const translated = translatedTargetName(language, _);
          const exams = goalKindsFor(language).filter(definition => EXAM_GOAL_KINDS.has(definition.kind)).map(definition => _(definition.label)).join(', ');
          return <label key={language} className="course-target-card crystal-chamfer-sm" data-course-language={language} data-state={taken ? 'added' : selected ? 'selected' : 'idle'}>
            <input type="radio" className="course-target-card__input" name={groupName} value={language} checked={selected} disabled={taken}
              onChange={() => { setTarget(language); setGoalKind(''); }} />
            <span className="course-target-card__glyph" lang={language} aria-hidden="true">{TARGET_GLYPH[language]}</span>
            {taken && <span className="course-target-card__tag"><Trans {...msg({ context: 'course.add.language-added', message: 'Added' })} /></span>}
            {!taken && selected && <span className="course-target-card__tag" aria-hidden="true"><Trans {...msg({ context: 'course.add.language-selected', message: 'Selected' })} /></span>}
            <span className="course-target-card__name" lang={language}>{TARGET_ENDONYM[language]}</span>
            {translated && <span className="sr-only">{translated}</span>}
            <span className="course-target-card__sample"><span lang={language}>{TARGET_GREETING[language]}</span>{exams && <> · {exams}</>}</span>
          </label>;
        })}
      </div>
    </fieldset>
    {available.length === 0 && <p className="course-add__note"><Trans {...msg({ context: 'course.create.no-target-left', message: 'All supported languages already have a course. Archive one to add another.' })} /></p>}
    <div className="course-add__fields">
      <div className="course-add__field">
        <label className="course-add__label" htmlFor={`${groupName}-native`}><Trans {...msg({ context: 'course.add.native-label', message: 'Explain meanings in' })} /></label>
        <span className="course-add__select crystal-chamfer-sm">
          <select id={`${groupName}-native`} value={native} disabled={busy} aria-describedby={profileNativeLanguage === native ? nativeHintId : undefined}
            onChange={event => setNative(event.target.value as CourseNativeLanguage)}>
            {COURSE_NATIVE_LANGUAGES.map(code => <option key={code} value={code} lang={code}>{NATIVE_ENDONYM[code]}</option>)}
          </select>
          {profileNativeLanguage === native && <span id={nativeHintId} className="course-add__select-hint"><Trans {...msg({ context: 'course.add.native-hint', message: 'your native language' })} /></span>}
          <ChevronDown size={16} aria-hidden="true" className="course-add__select-icon" />
        </span>
      </div>
      <div className="course-add__field">
        <label className="course-add__label" htmlFor={`${groupName}-goal`}><Trans {...msg({ context: 'course.goal.add.kind-label', message: 'Goal' })} /></label>
        <span className="course-add__select crystal-chamfer-sm">
          <select id={`${groupName}-goal`} value={goalKind} disabled={busy || !target} onChange={event => setGoalKind(event.target.value)}>
            <option value="">{_(msg({ context: 'onboarding.goal.none', message: 'No specific goal yet' }))}</option>
            {goalOptions.map(option => <option key={option.kind} value={option.kind}>{_(option.label)}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" className="course-add__select-icon" />
        </span>
      </div>
    </div>
    {failed && <p className="course-add__error" role="alert"><Trans {...msg({ context: 'course.error.generic', message: 'That course action did not go through. Please try again.' })} /></p>}
    <div className="course-add__actions">
      <button type="submit" className="course-add__primary crystal-chamfer-sm" disabled={busy || !target}>
        {target
          ? <Trans {...msg({ context: 'course.add.submit', message: 'Add {language}' })} values={{ language: <span lang={target}>{TARGET_ENDONYM[target]}</span> }} />
          : <Trans {...msg({ context: 'course.create.submit', message: 'Create course' })} />}
      </button>
      <Dialog.Close type="button" className="course-add__secondary crystal-chamfer-sm"><Trans {...msg({ context: 'course.create.cancel', message: 'Cancel' })} /></Dialog.Close>
    </div>
  </form>;
}

/**
 * Adds a course: one card per supported language (the ones already added stay visible and
 * disabled), the meanings language and an optional goal. A new course does not become the active
 * one; the learner switches to it from the course list.
 */
export function AddCourseDialog({ open, onOpenChange, onCloseAutoFocus, ...formProps }: AddCourseDialogProps) {
  const { _ } = useLingui();
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="course-dialog-overlay" />
      <Dialog.Content className="course-add crystal-chamfer" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <div className="course-add__head">
          <div>
            <Dialog.Title className="course-add__title"><Trans {...msg({ context: 'course.add.title', message: 'Add a <0>language</0>' })} components={{ 0: <em /> }} /></Dialog.Title>
            <p className="course-add__subtitle"><Trans {...msg({ context: 'course.add.subtitle', message: 'Your current courses stay as they are. Each language gets its own cards, goals and daily queue.' })} /></p>
          </div>
          <Dialog.Close className="course-add__close crystal-chamfer-sm" aria-label={_(msg({ id: 'course.switcher.close', message: 'Close' }))}><X size={16} aria-hidden="true" /></Dialog.Close>
        </div>
        <AddCourseForm {...formProps} onDone={() => onOpenChange(false)} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
