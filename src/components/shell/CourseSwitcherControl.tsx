import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, Check, ChevronDown, MessageSquare, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useUiLocale } from '../../i18n/I18nProvider';
import { AddCourseDialog, defaultCourseNativeLanguage } from '../../features/courses/AddCourseDialog';
import { useCourseSession } from '../../features/courses/CourseGate';
import { COURSE_TARGET_LANGUAGES, type Course, type CourseNativeLanguage, type CreateCourseInput, type CourseTargetLanguage } from '../../features/courses/courseModel';
import { NATIVE_ENDONYM, TARGET_ENDONYM } from '../../features/courses/courseLanguageLabels';
import { CourseDuePill, CourseNativeLine, CourseTile, goalSummaryText, primaryGoal, translatedTargetName } from '../../features/courses/CourseVisuals';
import { ManageCoursesDialog, type CourseSwitch } from '../../features/courses/ManageCoursesDialog';
import { useCourseDueCounts, type CourseDueCounts } from '../../features/courses/useCourseDueCounts';
import { useAccountProfileNativeLanguage } from '../../features/profileCompletion/AccountProfileContext';
import './course-switcher.css';

type SwitcherView = 'closed' | 'popover' | 'add' | 'manage';

interface SwitchRecord extends CourseSwitch {
  readonly fromCourseId: string | null;
  readonly id: number;
}

const SWITCHED_TOAST_MS = 8000;

export interface CourseSwitcherControlProps {
  /** Opens Settings at Language & courses; the sheet's "Change" link shows only when given. */
  readonly onOpenLanguageSettings?: () => void;
  /** Starts today's study for the active course; the courses surface shows its start button only when given. */
  readonly onStudyActiveCourse?: () => void;
  /** Opens the courses page; without it "Manage courses" opens the courses surface as a dialog. */
  readonly onOpenCourses?: () => void;
}

function CourseRow({ course, isActive, due, pending, onSwitch }: {
  readonly course: Course; readonly isActive: boolean; readonly due: number | undefined; readonly pending: boolean; readonly onSwitch: () => void;
}) {
  const { _ } = useLingui();
  const translated = translatedTargetName(course.targetLanguage, _);
  const goal = goalSummaryText(course, primaryGoal(course), _);
  return <li className="claude-course-row">
    <button type="button" className="course-row crystal-chamfer-sm" disabled={pending} onClick={onSwitch} aria-current={isActive ? 'true' : undefined}>
      <CourseTile language={course.targetLanguage} />
      <span className="course-row__text">
        <span className="course-row__name"><span lang={course.targetLanguage}>{TARGET_ENDONYM[course.targetLanguage]}</span>{translated && <span className="course-row__translated">{translated}</span>}</span>
        <span className="course-row__meta">
          <span className="course-row__from"><CourseNativeLine course={course} /></span>
          {goal && <span className="course-row__goal"><span className="course-row__sep" aria-hidden="true"> · </span>{goal}</span>}
        </span>
      </span>
      <CourseDuePill count={due} active={isActive} />
      <span className="course-row__check" aria-hidden="true">{isActive && <Check size={18} strokeWidth={2.5} />}</span>
      {isActive && <span className="sr-only"><Trans {...msg({ context: 'course.status.active', message: 'Active course' })} /></span>}
    </button>
  </li>;
}

function SwitchedToast({ record, dueCounts, canGoBack, pending, onBack, onDismiss }: {
  readonly record: SwitchRecord; readonly dueCounts: CourseDueCounts; readonly canGoBack: boolean; readonly pending: boolean;
  readonly onBack: () => void; readonly onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setTimeout(onDismiss, SWITCHED_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [paused, onDismiss, record.id]);
  const due = dueCounts[record.to];
  return <div className="course-switched-toast crystal-chamfer-sm" role="status"
    onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    {record.from && <><CourseTile language={record.from} className="course-switched-toast__from" /><ArrowRight size={14} aria-hidden="true" className="course-switched-toast__arrow" /></>}
    <CourseTile language={record.to} className="course-switched-toast__to" />
    <p className="course-switched-toast__text">
      <Trans {...msg({ context: 'course.switcher.switched', message: 'Switched to {language}' })} values={{ language: <strong lang={record.to}>{TARGET_ENDONYM[record.to]}</strong> }} />
      {due !== undefined && <span className="course-switched-toast__due"> · <Trans {...msg({ context: 'course.due-count', message: '{count} due' })} values={{ count: due }} /></span>}
      <span className="course-switched-toast__note"> · <Trans {...msg({ context: 'course.switcher.switched-extension', message: 'the extension now saves new words here' })} /></span>
    </p>
    {canGoBack && record.from && <button type="button" className="course-switched-toast__back crystal-chamfer-sm" disabled={pending} onClick={onBack}>
      <Trans {...msg({ context: 'course.switcher.switch-back', message: 'Back to {language}' })} values={{ language: <span lang={record.from}>{TARGET_ENDONYM[record.from]}</span> }} />
    </button>}
  </div>;
}

/**
 * The course switcher in the top bar. The panel adapts by CSS breakpoint instead of shipping two
 * components: a popover under the trigger at `lg` and up, a bottom sheet below it. Create,
 * switch, archive, reopen and goals all call the shared `CourseGate` session, which already
 * holds the profile from its single activation read; the only extra reads are one aggregate due
 * count per course while a course surface is open.
 */
export function CourseSwitcherControl({ onOpenLanguageSettings, onStudyActiveCourse, onOpenCourses }: CourseSwitcherControlProps = {}) {
  const { _ } = useLingui();
  const uiLocale = useUiLocale();
  const profileNativeLanguage = useAccountProfileNativeLanguage();
  const { model, actions } = useCourseSession();
  const [view, setView] = useState<SwitcherView>('closed');
  const [addReturn, setAddReturn] = useState<'popover' | 'manage'>('popover');
  const [addTarget, setAddTarget] = useState<CourseTargetLanguage | null>(null);
  const [switched, setSwitched] = useState<SwitchRecord | null>(null);
  const [scrimTop, setScrimTop] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const switchCount = useRef(0);
  // Stable, so a re-render of the switcher does not restart the toast's dismiss timer.
  const dismissSwitched = useCallback(() => setSwitched(null), []);
  const courses = model.profile?.courses ?? [];
  const openCourses = courses.filter(course => course.status === 'active');
  const dueCounts = useCourseDueCounts(model.ownerId, openCourses.map(course => course.targetLanguage), view !== 'closed');
  const popoverOpen = view === 'popover';

  useEffect(() => {
    if (!popoverOpen) return undefined;
    const topbar = rootRef.current?.closest('.claude-topbar');
    const anchor = topbar ?? triggerRef.current;
    if (anchor) setScrimTop(Math.round(anchor.getBoundingClientRect().bottom));
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setView('closed'); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setView('closed'); triggerRef.current?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', closeOnEscape); };
  }, [popoverOpen]);

  if (model.status === 'error') return <div className="flex min-w-0 items-center gap-2">
    <p role="alert" className="text-xs font-semibold text-[var(--sf-danger)]"><Trans {...msg({ context: 'course.error.read', message: 'Courses could not be loaded.' })} /></p>
    <button type="button" onClick={() => void actions.retry()} className="liquid-control min-h-11 shrink-0 rounded-xl border border-[var(--sf-border)] px-3 text-sm font-bold text-[var(--sf-text)]">
      <Trans {...msg({ context: 'course.action.retry', message: 'Retry' })} />
    </button>
  </div>;
  if (model.status !== 'ready' || !model.profile) return null;
  const { profile } = model;
  const activeCourse = model.activeCourse;
  const takenTargets = new Set(profile.courses.map(course => course.targetLanguage));
  const canAddCourse = COURSE_TARGET_LANGUAGES.some(code => !takenTargets.has(code));
  const defaultNativeLanguage = defaultCourseNativeLanguage(profileNativeLanguage, activeCourse, uiLocale);
  const appLanguage: CourseNativeLanguage = uiLocale === 'vi' ? 'vi' : 'en';

  const focusTrigger = () => triggerRef.current?.focus();
  const closeAndFocus = () => { setView('closed'); focusTrigger(); };
  const switchTo = async (course: Course, keepSurfaceOpen: boolean) => {
    const from = activeCourse;
    setSwitched(null);
    const result = await actions.switchCourse(course.id);
    if (!result.ok) return;
    switchCount.current += 1;
    setSwitched({ from: from?.targetLanguage ?? null, fromCourseId: from?.id ?? null, to: course.targetLanguage, id: switchCount.current });
    if (!keepSurfaceOpen) closeAndFocus();
  };
  const openAdd = (from: 'popover' | 'manage', language: CourseTargetLanguage | null = null) => {
    setAddReturn(from);
    setAddTarget(language);
    setView('add');
  };
  const createCourse = async (input: CreateCourseInput) => (await actions.createCourse(input)).ok;
  const backCourse = switched?.fromCourseId ? profile.courses.find(course => course.id === switched.fromCourseId && course.status === 'active') ?? null : null;
  const returnFocus = (event: Event) => { event.preventDefault(); focusTrigger(); };

  return <div ref={rootRef} className="claude-course-switcher relative flex min-w-0 items-center" data-open={popoverOpen}
    style={{ '--course-scrim-top': `${scrimTop}px` } as CSSProperties}>
    <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={popoverOpen}
      onClick={() => setView(current => current === 'popover' ? 'closed' : 'popover')}
      className="claude-course-switcher-trigger" data-course-language={activeCourse?.targetLanguage}>
      {activeCourse ? <>
        <CourseTile language={activeCourse.targetLanguage} className="course-trigger__glyph" />
        <span className="course-trigger__name truncate" lang={activeCourse.targetLanguage}>{TARGET_ENDONYM[activeCourse.targetLanguage]}</span>
        {translatedTargetName(activeCourse.targetLanguage, _) && <span className="sr-only">{translatedTargetName(activeCourse.targetLanguage, _)}</span>}
        <span className="course-trigger__from"><CourseNativeLine course={activeCourse} /></span>
      </> : <span className="course-trigger__name truncate"><Trans {...msg({ context: 'course.switcher.no-active', message: 'Choose a course' })} /></span>}
      <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" className="course-trigger__chevron" />
    </button>
    {popoverOpen && <>
      <div className="course-switcher-scrim" aria-hidden="true" onClick={closeAndFocus} />
      <div role="dialog" aria-label={_(msg({ id: 'course.switcher.dialog-label', message: 'Courses' }))} className="claude-course-switcher-panel crystal-chamfer">
        <span className="course-panel__handle" aria-hidden="true" />
        <div className="course-panel__header">
          <h2 className="course-panel__title"><Trans {...msg({ context: 'course.switcher.heading', message: 'Your <0>courses</0>' })} components={{ 0: <em /> }} /></h2>
          <p className="course-panel__subline"><Trans {...msg({ context: 'course.switcher.shared-progress', message: 'Level, XP and streak are shared' })} /></p>
          <button type="button" onClick={closeAndFocus} className="course-panel__close crystal-chamfer-sm" aria-label={_(msg({ id: 'course.switcher.close', message: 'Close' }))}><X size={16} aria-hidden="true" /></button>
        </div>
        {model.errorCode && <p role="alert" className="course-panel__error">
          <Trans {...msg({ context: 'course.error.generic', message: 'That course action did not go through. Please try again.' })} /></p>}
        <ul className="claude-course-list">
          {openCourses.map(course => <CourseRow key={course.id} course={course} isActive={course.id === profile.activeCourseId} pending={model.pending}
            due={dueCounts[course.targetLanguage]}
            onSwitch={() => { if (course.id === profile.activeCourseId) closeAndFocus(); else void switchTo(course, false); }} />)}
        </ul>
        <div className="course-panel__actions">
          {canAddCourse && <button type="button" onClick={() => openAdd('popover')} className="course-panel__add crystal-chamfer-sm">
            <Plus size={16} aria-hidden="true" /><Trans {...msg({ context: 'course.switcher.add', message: 'Add a language' })} /></button>}
          <button type="button" onClick={() => { if (!onOpenCourses) { setView('manage'); return; } setView('closed'); onOpenCourses(); }} className="course-panel__manage crystal-chamfer-sm">
            <Trans {...msg({ context: 'course.switcher.manage', message: 'Manage courses' })} /></button>
        </div>
        <p className="course-panel__extension"><MessageSquare size={14} aria-hidden="true" />
          <span><Trans {...msg({ context: 'course.switcher.extension-note', message: 'The browser extension saves new words to your active course.' })} /></span></p>
        <div className="course-panel__languages crystal-chamfer-sm">
          <p><span className="course-panel__languages-label"><Trans {...msg({ context: 'course.switcher.app-language', message: 'App language' })} /></span>
            <span lang={appLanguage}>{NATIVE_ENDONYM[appLanguage]}</span></p>
          {activeCourse && <p><span className="course-panel__languages-label"><Trans {...msg({ context: 'course.manage.meanings-in', message: 'Meanings in' })} /></span>
            <span lang={activeCourse.nativeLanguage}>{NATIVE_ENDONYM[activeCourse.nativeLanguage]}</span></p>}
          {onOpenLanguageSettings && <button type="button" className="course-panel__change" onClick={() => { setView('closed'); onOpenLanguageSettings(); }}>
            <Trans {...msg({ context: 'course.switcher.change-languages', message: 'Change' })} /></button>}
        </div>
      </div>
    </>}
    <AddCourseDialog open={view === 'add'} onOpenChange={open => { if (!open) setView(addReturn); }}
      courses={profile.courses} pending={model.pending} initialTarget={addTarget}
      defaultNativeLanguage={defaultNativeLanguage} profileNativeLanguage={profileNativeLanguage}
      onCreate={createCourse} onCloseAutoFocus={returnFocus} />
    <ManageCoursesDialog open={view === 'manage'} onOpenChange={open => { if (!open) setView('closed'); }}
      dueCounts={dueCounts} switched={view === 'manage' ? switched : null}
      onSwitch={course => void switchTo(course, true)}
      onAddLanguage={language => openAdd('manage', language ?? null)}
      onStudy={onStudyActiveCourse ? () => { setView('closed'); onStudyActiveCourse(); } : undefined}
      onCloseAutoFocus={returnFocus} />
    {switched && view !== 'manage' && typeof document !== 'undefined' && createPortal(
      <SwitchedToast key={switched.id} record={switched} dueCounts={dueCounts} canGoBack={backCourse !== null} pending={model.pending}
        onBack={() => { if (backCourse) void switchTo(backCourse, false); }} onDismiss={dismissSwitched} />,
      document.body,
    )}
  </div>;
}
