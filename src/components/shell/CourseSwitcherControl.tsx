import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Archive, ChevronDown, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCourseSession } from '../../features/courses/CourseGate';
import {
  COURSE_NATIVE_LANGUAGES,
  COURSE_TARGET_LANGUAGES,
  type Course,
  type CourseNativeLanguage,
  type CourseTargetLanguage,
} from '../../features/courses/courseModel';
import { NATIVE_LANGUAGE_LABEL, TARGET_LANGUAGE_FLAG, TARGET_LANGUAGE_LABEL } from '../../features/courses/courseLanguageLabels';
import { goalKindLabel } from '../../features/courses/courseGoalCatalog';
import { CourseGoalsPanel } from '../../features/courses/CourseGoalsPanel';
import './course-switcher.css';

const rowClass = 'flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
const iconButtonClass = 'grid size-9 shrink-0 place-items-center rounded-lg text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2';

function CourseRow({ course, isActive, onSwitch, onArchive, onReopen, onManageGoals, pending }: {
  readonly course: Course; readonly isActive: boolean; readonly pending: boolean;
  readonly onSwitch: () => void; readonly onArchive: () => void; readonly onReopen: () => void; readonly onManageGoals: () => void;
}) {
  const { _ } = useLingui();
  const targetLabel = _(TARGET_LANGUAGE_LABEL[course.targetLanguage]);
  const nativeLabel = _(NATIVE_LANGUAGE_LABEL[course.nativeLanguage]);
  const goal = course.goals.find(item => item.status === 'active') ?? course.goals[0];
  const goalLabel = goal ? goalKindLabel(course.targetLanguage, goal.kind) : null;
  return <li className={`claude-course-row rounded-xl ${isActive ? 'bg-[var(--sf-surface-raised)]' : ''}`}>
    <div className="flex items-center gap-1">
      <button type="button" disabled={pending || course.status !== 'active'} onClick={onSwitch} aria-current={isActive ? 'true' : undefined}
        className={`${rowClass} ${course.status !== 'active' ? 'opacity-60' : ''}`}>
        <span className="claude-course-language-mark" aria-hidden="true">{TARGET_LANGUAGE_FLAG[course.targetLanguage]}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-bold">{targetLabel} <span aria-hidden="true">←</span> {nativeLabel}</span>
          {goal && <span className="claude-course-goal-summary mt-0.5 truncate text-xs font-medium text-[var(--sf-text-muted)]">{goalLabel ? _(goalLabel) : goal.kind}{goal.level ? ` · ${goal.level}` : ''}</span>}</span>
        {course.status === 'archived' && <span className="claude-course-archived-badge shrink-0 rounded-full border border-[var(--sf-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--sf-text-muted)]"><Trans id="course.status.archived" message="Archived" /></span>}
        {isActive && <span className="sr-only"><Trans id="course.status.active" message="Active course" /></span>}
      </button>
      {course.status === 'active' && <button type="button" disabled={pending} onClick={onManageGoals} className={iconButtonClass} aria-label={_(msg({ id: 'course.action.manage-goals', message: 'Manage goals' }))} title={_(msg({ id: 'course.action.manage-goals', message: 'Manage goals' }))}><Settings2 size={16} aria-hidden="true" /></button>}
      {course.status === 'active' && <button type="button" disabled={pending} onClick={onArchive} className={iconButtonClass} aria-label={_(msg({ id: 'course.action.archive', message: 'Archive course' }))} title={_(msg({ id: 'course.action.archive', message: 'Archive course' }))}><Archive size={16} aria-hidden="true" /></button>}
      {course.status === 'archived' && <button type="button" disabled={pending} onClick={onReopen} className={iconButtonClass} aria-label={_(msg({ id: 'course.action.reopen', message: 'Reopen course' }))} title={_(msg({ id: 'course.action.reopen', message: 'Reopen course' }))}><RotateCcw size={16} aria-hidden="true" /></button>}
    </div>
  </li>;
}

function CreateCourseForm({ availableTargets, pending, onCreate, onCancel }: {
  readonly availableTargets: readonly CourseTargetLanguage[]; readonly pending: boolean;
  readonly onCreate: (target: CourseTargetLanguage, native: CourseNativeLanguage) => void; readonly onCancel: () => void;
}) {
  const { _ } = useLingui();
  const [target, setTarget] = useState<CourseTargetLanguage | null>(availableTargets[0] ?? null);
  const [native, setNative] = useState<CourseNativeLanguage>('vi');
  useEffect(() => {
    if (!target || !availableTargets.includes(target)) setTarget(availableTargets[0] ?? null);
  }, [availableTargets, target]);
  if (availableTargets.length === 0) {
    return <p className="px-3 py-2 text-sm text-[var(--sf-text-muted)]"><Trans id="course.create.no-target-left" message="All supported languages already have a course. Archive one to add another." /></p>;
  }
  return <form className="claude-course-create-form space-y-3 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3" onSubmit={event => { event.preventDefault(); if (target) onCreate(target, native); }}>
    <fieldset>
      <legend className="text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="course.create.target-label" message="Learn" /></legend>
      <div className="course-target-grid mt-1.5">
        {availableTargets.map(code => <button key={code} type="button" disabled={pending} aria-pressed={target === code} onClick={() => setTarget(code)}
          className="course-target-card min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-bold text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
          <span aria-hidden="true">{TARGET_LANGUAGE_FLAG[code]}</span><span>{_(TARGET_LANGUAGE_LABEL[code])}</span>
        </button>)}
      </div>
    </fieldset>
    <label className="block text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="course.create.native-label" message="Explain in" />
      <select className="mt-1 block w-full min-h-11 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-2 text-sm text-[var(--sf-text)]" value={native} onChange={event => setNative(event.target.value as CourseNativeLanguage)}>
        {COURSE_NATIVE_LANGUAGES.map(code => <option key={code} value={code}>{_(NATIVE_LANGUAGE_LABEL[code])}</option>)}
      </select>
    </label>
    <div className="flex gap-2 pt-1">
      <button type="submit" disabled={pending || !target} className="min-h-11 flex-1 rounded-xl bg-[var(--sf-brand)] px-3 text-sm font-bold text-[var(--sf-on-brand)] disabled:opacity-60"><Trans id="course.create.submit" message="Create course" /></button>
      <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--sf-border)] px-3 text-sm font-semibold text-[var(--sf-text-muted)]"><Trans id="course.create.cancel" message="Cancel" /></button>
    </div>
  </form>;
}

/**
 * The panel adapts by CSS breakpoint instead of shipping two components: a
 * popover anchored under the trigger at `lg` and up, a full-width bottom
 * sheet below it. This is the real course switcher: create, switch, archive
 * and reopen all call the shared `CourseGate` session, which already holds
 * the profile from its single activation read, so none of these actions
 * cost an extra Firestore read here.
 */
export function CourseSwitcherControl() {
  const { _ } = useLingui();
  const { model, actions } = useCourseSession();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [managingCourseId, setManagingCourseId] = useState<string | null>(null);
  const [switchedTo, setSwitchedTo] = useState<CourseTargetLanguage | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  if (model.status !== 'ready' || !model.profile) return null;
  const { profile } = model;
  const activeCourse = model.activeCourse;
  const takenTargets = new Set(profile.courses.map(course => course.targetLanguage));
  const availableTargets = COURSE_TARGET_LANGUAGES.filter(code => !takenTargets.has(code));
  const managedCourse = managingCourseId ? profile.courses.find(course => course.id === managingCourseId) ?? null : null;

  const closeAndFocus = () => { setOpen(false); setCreating(false); setManagingCourseId(null); triggerRef.current?.focus(); };
  const switchCourse = async (course: Course) => {
    setSwitchedTo(null);
    const result = await actions.switchCourse(course.id);
    if (!result.ok) return;
    setSwitchedTo(course.targetLanguage);
    closeAndFocus();
  };

  return <div ref={rootRef} className="claude-course-switcher relative flex min-w-0 items-center">
    {switchedTo && <p role="status" className="sr-only"><Trans id="course.switcher.switched" message="Switched to {language}" values={{ language: _(TARGET_LANGUAGE_LABEL[switchedTo]) }} /></p>}
    <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(current => !current)}
      className="claude-course-switcher-trigger flex min-h-11 min-w-0 items-center gap-1.5 truncate rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 text-sm font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none">
      {activeCourse ? <><span aria-hidden="true">{TARGET_LANGUAGE_FLAG[activeCourse.targetLanguage]}</span><span className="truncate">{_(TARGET_LANGUAGE_LABEL[activeCourse.targetLanguage])}</span></>
        : <Trans id="course.switcher.no-active" message="Choose a course" />}
      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''} motion-reduce:transition-none`} />
    </button>
    {open && <div role="dialog" aria-label={_(msg({ id: 'course.switcher.dialog-label', message: 'Courses' }))}
      className="claude-course-switcher-panel fixed inset-x-0 bottom-0 z-50 overflow-y-auto border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 shadow-xl crystal-chamfer">
      <div className="flex items-center justify-between px-1 pb-2">
        <h2 className="text-sm font-black text-[var(--sf-text)]"><Trans id="course.switcher.title" message="Your courses" /></h2>
        <button type="button" onClick={closeAndFocus} className={iconButtonClass} aria-label={_(msg({ id: 'course.switcher.close', message: 'Close' }))}><X size={18} aria-hidden="true" /></button>
      </div>
      {model.errorCode && <p role="alert" className="mb-2 rounded-lg border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] px-3 py-2 text-sm font-semibold text-[var(--sf-danger)]">
        <Trans id="course.error.generic" message="That course action did not go through. Please try again." /></p>}
      {managedCourse
        ? <CourseGoalsPanel course={managedCourse} onClose={() => setManagingCourseId(null)} />
        : <>
          <ul className="claude-course-list space-y-1">
            {profile.courses.map(course => <CourseRow key={course.id} course={course} isActive={course.id === profile.activeCourseId} pending={model.pending}
              onSwitch={() => void switchCourse(course)}
              onArchive={() => void actions.archiveCourse(course.id)}
              onReopen={() => void actions.reopenCourse(course.id)}
              onManageGoals={() => setManagingCourseId(course.id)} />)}
          </ul>
          {creating
            ? <div className="mt-2"><CreateCourseForm availableTargets={availableTargets} pending={model.pending}
                onCreate={(target, native) => { void actions.createCourse({ targetLanguage: target, nativeLanguage: native }).then(result => { if (result.ok) setCreating(false); }); }}
                onCancel={() => setCreating(false)} /></div>
            : availableTargets.length > 0 && <button type="button" onClick={() => setCreating(true)} className={`${rowClass} mt-1 justify-center border border-dashed border-[var(--sf-border)] text-[var(--sf-brand-text)]`}>
              <Plus size={16} aria-hidden="true" /><Trans id="course.switcher.add" message="Add a language" /></button>}
        </>}
    </div>}
  </div>;
}
