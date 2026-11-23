import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Archive, Flag, Plus, RotateCcw, X } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useTheme } from '../theme/ThemeProvider';
import { useCourseSession } from './CourseGate';
import { CourseGoalsPanel } from './CourseGoalsPanel';
import { COURSE_TARGET_LANGUAGES, MAX_COURSES_PER_PROFILE, type Course, type CourseTargetLanguage } from './courseModel';
import { goalKindsFor } from './courseGoalCatalog';
import { NATIVE_ENDONYM, TARGET_ENDONYM, TARGET_GLYPH } from './courseLanguageLabels';
import { CourseNativeLine, goalSummaryText, primaryGoal, translatedTargetName } from './CourseVisuals';
import type { CourseDueCounts } from './useCourseDueCounts';
import {
  newWordCount, reviewedPercent, useCourseCardCounts, type CourseCardCount, type CourseCardCountReader,
} from './useCourseCardCounts';
import './manage-courses.css';

export interface CourseSwitch {
  readonly from: CourseTargetLanguage | null;
  readonly to: CourseTargetLanguage;
}

/** What the surface hands its close control; the dialog renders Radix's Close with it. */
export interface CoursesSurfaceCloseSlot {
  readonly className: string;
  readonly label: string;
  readonly icon: ReactNode;
}

export interface CoursesSurfaceProps {
  /** Cards due now per course language, as the switcher already reads them; a missing language shows no number. */
  readonly dueCounts: CourseDueCounts;
  /** The last switch made from this surface, announced in its header. */
  readonly switched: CourseSwitch | null;
  readonly onSwitch: (course: Course) => void;
  /** Opens the add-a-language flow, preselecting a language when one was picked here. */
  readonly onAddLanguage: (language?: CourseTargetLanguage) => void;
  /** Starts today's study for the active course; the start button shows only when given. */
  readonly onStudy?: () => void;
  /** Leaves the surface from its close button; a page mount passes its way back. */
  readonly onClose?: () => void;
  /** Draws the heading; the dialog passes its Title so the heading names the dialog. Defaults to an h1. */
  readonly renderTitle?: (title: ReactNode) => ReactNode;
  /** Draws the close control instead of the default button; the dialog passes its Close. */
  readonly renderClose?: (slot: CoursesSurfaceCloseSlot) => ReactNode;
  /** Reads the card counts of one course; defaults to two Firestore aggregate counts. */
  readonly readCardCount?: CourseCardCountReader;
  /** The course whose goals are open; an unknown id shows the course list. Without `onGoalsCourseChange` it is only the opening value. */
  readonly goalsCourseId?: string | null;
  /** Makes the caller the owner of which goals are open, so a page can keep it in its address; `null` is the course list. */
  readonly onGoalsCourseChange?: (courseId: string | null) => void;
}

function readingAidLabel(course: Course, _: ReturnType<typeof useLingui>['_']): string | null {
  if (course.targetLanguage === 'zh') {
    return course.preferences.zhScript === 'hant'
      ? _(msg({ context: 'course.manage.reading-aid.traditional', message: 'Traditional characters' }))
      : _(msg({ context: 'course.manage.reading-aid.simplified', message: 'Simplified characters' }));
  }
  if (course.targetLanguage === 'ko' || course.targetLanguage === 'ja') {
    return course.preferences.showRomanization
      ? _(msg({ context: 'course.manage.reading-aid.romanization-on', message: 'Romanization preferred' }))
      : _(msg({ context: 'course.manage.reading-aid.romanization-off', message: 'Romanization not needed' }));
  }
  return null;
}

function CourseCard({ course, index, active, due, cards, pending, onSwitch, onManageGoals }: {
  readonly course: Course; readonly index: number; readonly active: boolean; readonly due: number | undefined;
  readonly cards: CourseCardCount | undefined; readonly pending: boolean;
  readonly onSwitch: () => void; readonly onManageGoals: () => void;
}) {
  const { _ } = useLingui();
  const { actions } = useCourseSession();
  const archived = course.status === 'archived';
  const translated = translatedTargetName(course.targetLanguage, _);
  const goal = primaryGoal(course);
  const goalSummary = goalSummaryText(course, goal, _);
  const progress = cards && cards.total > 0 ? cards : null;
  return <li className="course-manage__item" data-active={active}><div className="course-card crystal-chamfer" data-active={active} data-status={course.status} data-course-language={course.targetLanguage}>
    <button type="button" className="course-card__select" aria-current={active ? 'true' : undefined} disabled={pending || archived} onClick={() => { if (!active) onSwitch(); }}>
      <span className="course-card__top">
        <span className="course-card__index"><Trans {...msg({ context: 'course.manage.card-index', message: 'Course {number}' })} values={{ number: String(index + 1).padStart(2, '0') }} /></span>
        {active && <span className="course-card__tag"><Trans {...msg({ context: 'course.manage.active-tag', message: 'Active' })} /></span>}
        {archived && <span className="course-card__tag" data-tone="muted"><Trans {...msg({ context: 'course.status.archived', message: 'Archived' })} /></span>}
      </span>
      <span className="course-tile course-card__glyph" data-course-language={course.targetLanguage} lang={course.targetLanguage} aria-hidden="true">{TARGET_GLYPH[course.targetLanguage]}</span>
      <span className="course-card__name" lang={course.targetLanguage}>{TARGET_ENDONYM[course.targetLanguage]}</span>
      <span className="course-card__from">{translated && <>{translated} · </>}<CourseNativeLine course={course} /></span>
      {(due !== undefined || cards) && <span className="course-card__stats">
        {due !== undefined && <span className="course-card__stat" data-stat="due">
          <span className="course-card__stat-value">{due}</span>
          <span className="course-card__stat-label"><Trans {...msg({ context: 'course.manage.stat.due', message: 'Due' })} /></span>
        </span>}
        {cards && <span className="course-card__stat" data-stat="new">
          <span className="course-card__stat-value">{newWordCount(cards)}</span>
          <span className="course-card__stat-label"><Trans {...msg({ context: 'course.manage.stat.new', message: 'New words' })} /></span>
        </span>}
      </span>}
      {(goalSummary || goal?.targetDate || progress) && <span className="course-card__goal">
        {(goalSummary || goal?.targetDate) && <span className="course-card__goal-line">
          {goalSummary && <span className="course-card__goal-name">{goalSummary}</span>}
          {goal?.targetDate && <span><Trans {...msg({ context: 'course.manage.goal-date', message: 'Exam date {date}' })} values={{ date: goal.targetDate }} /></span>}
        </span>}
        {progress && <span className="course-card__progress" style={{ '--course-progress': `${reviewedPercent(progress)}%` } as CSSProperties}>
          <span className="course-card__progress-text"><Trans {...msg({ context: 'course.manage.progress', message: '{reviewed} / {total} reviewed' })} values={{ reviewed: progress.reviewed, total: progress.total }} /></span>
          <span className="course-card__bar" aria-hidden="true"><span className="course-card__bar-fill" /></span>
        </span>}
      </span>}
      {active && <span className="sr-only"><Trans {...msg({ context: 'course.status.active', message: 'Active course' })} /></span>}
    </button>
    <span className="course-card__actions">
      {!archived && <button type="button" className="course-card__action crystal-chamfer-sm" disabled={pending} onClick={onManageGoals}
        aria-label={_(msg({ id: 'course.action.manage-goals', message: 'Manage goals' }))} title={_(msg({ id: 'course.action.manage-goals', message: 'Manage goals' }))}>
        <Flag size={16} aria-hidden="true" />
      </button>}
      {!archived && <button type="button" className="course-card__action crystal-chamfer-sm" disabled={pending} onClick={() => void actions.archiveCourse(course.id)}
        aria-label={_(msg({ id: 'course.action.archive', message: 'Archive course' }))} title={_(msg({ id: 'course.action.archive', message: 'Archive course' }))}>
        <Archive size={16} aria-hidden="true" />
      </button>}
      {archived && <button type="button" className="course-card__action crystal-chamfer-sm" disabled={pending} onClick={() => void actions.reopenCourse(course.id)}
        aria-label={_(msg({ id: 'course.action.reopen', message: 'Reopen course' }))} title={_(msg({ id: 'course.action.reopen', message: 'Reopen course' }))}>
        <RotateCcw size={16} aria-hidden="true" />
      </button>}
    </span>
  </div></li>;
}

function NewLanguageCard({ available, pending, onAddLanguage }: {
  readonly available: readonly CourseTargetLanguage[]; readonly pending: boolean; readonly onAddLanguage: (language?: CourseTargetLanguage) => void;
}) {
  const { _ } = useLingui();
  return <li className="course-manage__item"><div className="course-card course-card--new crystal-chamfer">
    <button type="button" className="course-card__new" disabled={pending} onClick={() => onAddLanguage()}>
      <span className="course-card__plus" aria-hidden="true"><Plus size={22} strokeWidth={2.5} /></span>
      <span className="course-card__new-title"><Trans {...msg({ context: 'course.manage.new-language', message: 'New language' })} /></span>
    </button>
    <ul className="course-card__chips">
      {available.map(language => {
        const exam = goalKindsFor(language)[0];
        const name = translatedTargetName(language, _) ?? TARGET_ENDONYM[language];
        return <li key={language}>
          <button type="button" className="course-chip crystal-chamfer-sm" disabled={pending} onClick={() => onAddLanguage(language)}
            aria-label={_({ ...msg({ context: 'course.manage.add-language', message: 'Add {language}' }), values: { language: name } })}>
            <span className="course-chip__glyph" lang={language} aria-hidden="true">{TARGET_GLYPH[language]}</span>
            {exam && <span aria-hidden="true">{_(exam.label)}</span>}
          </button>
        </li>;
      })}
    </ul>
  </div></li>;
}

/**
 * Every course of the profile with its real numbers: language pair, goal, cards due now, new
 * words never reviewed and the share of the course's cards reviewed at least once. Crystal
 * draws it as the "Pick your star" screen. Switching, goals, archive and reopen all go through
 * the shared course session, as in the switcher.
 *
 * Mount contract:
 * - Providers: a `CourseContext` value (the app's course provider, read through
 *   `useCourseSession`), Lingui's `I18nProvider` with the `shell` catalog loaded (this folder's
 *   catalog area), and `ThemeProvider` for the Crystal title and Lumi.
 * - Data: `dueCounts` comes from the caller (`useCourseDueCounts`, one aggregate read per open
 *   course). The surface reads the card counts itself, two aggregate reads per open course, each
 *   time it mounts, so a mount is an open. It renders nothing invented: a count that fails to
 *   load leaves its number out.
 * - Layout: the root is `.course-manage__frame`. The dialog sits it on the full-screen overlay;
 *   a page mount places it in the page flow on the app canvas and passes `onClose` for its
 *   close button, or leaves the button out when the page has its own way back.
 */
export function CoursesSurface({
  dueCounts, switched, onSwitch, onAddLanguage, onStudy, onClose, renderTitle, renderClose, readCardCount, goalsCourseId: givenGoalsCourseId = null, onGoalsCourseChange,
}: CoursesSurfaceProps) {
  const { _ } = useLingui();
  const { model } = useCourseSession();
  const { family } = useTheme();
  const [ownGoalsCourseId, setOwnGoalsCourseId] = useState<string | null>(givenGoalsCourseId);
  const goalsCourseId = onGoalsCourseChange ? givenGoalsCourseId : ownGoalsCourseId;
  const setGoalsCourseId = onGoalsCourseChange ?? setOwnGoalsCourseId;
  const profile = model.profile;
  const crystal = family === 'crystal';
  const activeCourse = model.activeCourse;
  const courses = profile?.courses ?? [];
  const openLanguages = courses.filter(course => course.status === 'active').map(course => course.targetLanguage);
  const cardCounts = useCourseCardCounts(model.ownerId, openLanguages, true, readCardCount);
  const activeCount = openLanguages.length;
  const taken = new Set(courses.map(course => course.targetLanguage));
  const available = COURSE_TARGET_LANGUAGES.filter(language => !taken.has(language));
  const goalsCourse = goalsCourseId ? courses.find(course => course.id === goalsCourseId) ?? null : null;
  const activeDue = activeCourse ? dueCounts[activeCourse.targetLanguage] : undefined;
  const readingAid = activeCourse ? readingAidLabel(activeCourse, _) : null;
  const showLumi = crystal && readLumiEnabled() && activeCourse !== null;
  const meaningsLanguage = activeCourse ? NATIVE_ENDONYM[activeCourse.nativeLanguage] : null;
  const title = crystal
    ? <Trans {...msg({ context: 'course.manage.title.crystal', message: 'Pick your <0>star</0>' })} components={{ 0: <em /> }} />
    : <Trans {...msg({ context: 'course.manage.title', message: 'Your <0>languages</0>' })} components={{ 0: <em /> }} />;
  const closeSlot: CoursesSurfaceCloseSlot = {
    className: 'course-manage__close crystal-chamfer-sm',
    label: _(msg({ context: 'course.manage.close', message: 'Close courses' })),
    icon: <X size={18} aria-hidden="true" />,
  };

  return <div className="course-manage__frame">
    <header className="course-manage__header">
      <div className="course-manage__heading">
        <p className="course-manage__kicker">
          {meaningsLanguage
            ? <Trans {...msg({ context: 'course.manage.kicker', message: 'My languages · {count} active · meanings in {language}' })} values={{ count: activeCount, language: meaningsLanguage }} />
            : <Trans {...msg({ context: 'course.manage.kicker.no-active', message: 'My languages · {count} active' })} values={{ count: activeCount }} />}
        </p>
        {renderTitle ? renderTitle(title) : <h1 className="course-manage__title">{title}</h1>}
      </div>
      <p className="course-manage__switched" role="status">
        {switched && <span className="course-manage__switched-badge crystal-chamfer-sm">
          <Trans {...msg({ context: 'course.manage.switched', message: 'Switched to {language}' })} values={{ language: <span lang={switched.to}>{TARGET_ENDONYM[switched.to]}</span> }} />
        </span>}
      </p>
      {renderClose
        ? renderClose(closeSlot)
        : onClose && <button type="button" className={closeSlot.className} aria-label={closeSlot.label} onClick={onClose}>{closeSlot.icon}</button>}
    </header>
    {model.errorCode && <p role="alert" className="course-manage__error"><Trans {...msg({ context: 'course.error.generic', message: 'That course action did not go through. Please try again.' })} /></p>}
    {goalsCourse
      ? <div className="course-manage__goals crystal-chamfer"><CourseGoalsPanel course={goalsCourse} onClose={() => setGoalsCourseId(null)} /></div>
      : <>
        <div className="course-manage__body" data-lumi={showLumi}>
          <ul className="course-manage__cards">
            {courses.map((course, index) => <CourseCard key={course.id} course={course} index={index} active={course.id === profile?.activeCourseId}
              due={dueCounts[course.targetLanguage]} cards={course.status === 'active' ? cardCounts[course.targetLanguage] : undefined} pending={model.pending}
              onSwitch={() => onSwitch(course)} onManageGoals={() => setGoalsCourseId(course.id)} />)}
            {available.length > 0 && courses.length < MAX_COURSES_PER_PROFILE && <NewLanguageCard available={available} pending={model.pending} onAddLanguage={onAddLanguage} />}
          </ul>
          {showLumi && activeCourse && <aside className="course-manage__lumi" aria-label={_(msg({ context: 'onboarding.lumi.label', message: 'Lumi' }))}>
            <div className="course-manage__bubble">
              <p className="course-manage__bubble-kicker"><Trans {...msg({ context: 'course.manage.lumi.kicker', message: 'Lumi · link' })} /></p>
              <p className="course-manage__bubble-title"><Trans {...msg({ context: 'course.manage.lumi.title', message: 'Ready for {language}?' })} values={{ language: <span lang={activeCourse.targetLanguage}>{TARGET_ENDONYM[activeCourse.targetLanguage]}</span> }} /></p>
              {activeDue !== undefined && <p className="course-manage__bubble-body"><Trans {...msg({ context: 'course.manage.lumi.due', message: '{count, plural, one {# card is due right now.} other {# cards are due right now.}}' })} values={{ count: activeDue }} /></p>}
            </div>
            <Lumi pose="happy" size={250} className="crystal-ornament course-manage__lumi-figure" />
          </aside>}
        </div>
        {activeCourse && <div className="course-manage__footer">
          {onStudy && <button type="button" className="course-manage__cta crystal-chamfer" onClick={onStudy}>
            <span className="course-manage__cta-title"><Trans {...msg({ context: 'course.manage.study', message: 'Start {language} lesson' })} values={{ language: <span lang={activeCourse.targetLanguage}>{TARGET_ENDONYM[activeCourse.targetLanguage]}</span> }} /></span>
            {activeDue !== undefined && <span className="course-manage__cta-sub"><Trans {...msg({ context: 'course.due-count', message: '{count} due' })} values={{ count: activeDue }} /></span>}
          </button>}
          <dl className="course-manage__loadout crystal-chamfer">
            <div><dt><Trans {...msg({ context: 'course.manage.extension-saves-to', message: 'Extension saves to' })} /></dt><dd lang={activeCourse.targetLanguage}>{TARGET_ENDONYM[activeCourse.targetLanguage]}</dd></div>
            {readingAid && <div><dt><Trans {...msg({ context: 'course.manage.reading-aid', message: 'Reading aid' })} /></dt><dd>{readingAid}</dd></div>}
            <div><dt><Trans {...msg({ context: 'course.manage.meanings-in', message: 'Meanings in' })} /></dt><dd lang={activeCourse.nativeLanguage}>{NATIVE_ENDONYM[activeCourse.nativeLanguage]}</dd></div>
          </dl>
        </div>}
      </>}
  </div>;
}
