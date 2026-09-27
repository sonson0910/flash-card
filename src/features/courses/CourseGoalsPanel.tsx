import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useCourseSession } from './CourseGate';
import type { Course, CourseGoal } from './courseModel';
import { goalKindLabel, goalKindsFor } from './courseGoalCatalog';

const rowClass = 'flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-sm';
const iconButtonClass = 'grid size-9 shrink-0 place-items-center rounded-lg text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2';

function GoalRow({ course, goal, pending }: { readonly course: Course; readonly goal: CourseGoal; readonly pending: boolean }) {
  const { _ } = useLingui();
  const { actions } = useCourseSession();
  const label = goalKindLabel(course.targetLanguage, goal.kind);
  const togglePause = () => void actions.updateGoal(course.id, goal.id, { status: goal.status === 'paused' ? 'active' : 'paused' });
  return <li className={rowClass}>
    <span className="min-w-0 flex-1">
      <span className="block font-bold text-[var(--sf-text)]">{label ? _(label) : goal.kind}</span>
      <span className="mt-0.5 block text-xs text-[var(--sf-text-muted)]">
        {goal.level && <span>{goal.level}</span>}
        {goal.level && goal.targetDate && <span> · </span>}
        {goal.targetDate && <span>{goal.targetDate}</span>}
        {!goal.level && !goal.targetDate && <Trans id="course.goal.no-detail" message="No level or date set" />}
        {goal.status === 'paused' && <span className="ml-1 font-semibold"><Trans id="course.goal.paused" message="(paused)" /></span>}
        {goal.status === 'completed' && <span className="ml-1 font-semibold"><Trans id="course.goal.completed" message="(completed)" /></span>}
      </span>
    </span>
    {goal.status !== 'completed' && <button type="button" disabled={pending} onClick={togglePause} className={iconButtonClass}
      aria-label={_(goal.status === 'paused' ? msg({ id: 'course.goal.resume', message: 'Resume goal' }) : msg({ id: 'course.goal.pause', message: 'Pause goal' }))}>
      {goal.status === 'paused' ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
    </button>}
    <button type="button" disabled={pending} onClick={() => void actions.removeGoal(course.id, goal.id)} className={iconButtonClass}
      aria-label={_(msg({ id: 'course.goal.remove', message: 'Remove goal' }))}><Trash2 size={16} aria-hidden="true" /></button>
  </li>;
}

function AddGoalForm({ course, pending }: { readonly course: Course; readonly pending: boolean }) {
  const { _ } = useLingui();
  const { actions } = useCourseSession();
  const options = goalKindsFor(course.targetLanguage).filter(definition => !course.goals.some(goal => goal.kind === definition.kind));
  const [kind, setKind] = useState(options[0]?.kind ?? '');
  const [level, setLevel] = useState('');
  const [targetDate, setTargetDate] = useState('');
  if (options.length === 0) return null;
  const selected = options.find(option => option.kind === kind) ?? options[0];
  return <form className="mt-2 space-y-2 rounded-xl border border-dashed border-[var(--sf-border)] p-3" onSubmit={event => {
    event.preventDefault();
    void actions.addGoal(course.id, { kind, level: level.trim() || null, targetDate: targetDate || null }).then(result => {
      if (result.ok) { setLevel(''); setTargetDate(''); }
    });
  }}>
    <label className="block text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="course.goal.add.kind-label" message="Goal" />
      <select className="mt-1 block w-full min-h-11 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-2 text-sm text-[var(--sf-text)]" value={kind} onChange={event => setKind(event.target.value)}>
        {options.map(option => <option key={option.kind} value={option.kind}>{_(option.label)}</option>)}
      </select>
    </label>
    <label className="block text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="course.goal.add.level-label" message="Level or target (optional)" />
      <input className="mt-1 block w-full min-h-11 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-2 text-sm text-[var(--sf-text)]"
        value={level} onChange={event => setLevel(event.target.value)} placeholder={selected ? _(selected.levelHint) : ''} maxLength={32} />
    </label>
    <label className="block text-xs font-bold text-[var(--sf-text-muted)]"><Trans id="course.goal.add.date-label" message="Exam or target date (optional)" />
      <input type="date" className="mt-1 block w-full min-h-11 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-2 text-sm text-[var(--sf-text)]"
        value={targetDate} onChange={event => setTargetDate(event.target.value)} />
    </label>
    <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-[var(--sf-brand)] px-3 text-sm font-bold text-[var(--sf-on-brand)] disabled:opacity-60">
      <Plus size={16} aria-hidden="true" className="mr-1 inline" /><Trans id="course.goal.add.submit" message="Add goal" />
    </button>
  </form>;
}

/** Goals belong to one course; there is no such thing as a course-less goal or a goal shared across courses. */
export function CourseGoalsPanel({ course, onClose }: { readonly course: Course; readonly onClose: () => void }) {
  const { model } = useCourseSession();
  return <div className="claude-course-goals-panel">
    <button type="button" onClick={onClose} className="mb-2 text-sm font-bold text-[var(--sf-brand-text)]">&larr; <Trans id="course.goals.back" message="Back to courses" /></button>
    {course.goals.length === 0
      ? <p className="text-sm text-[var(--sf-text-muted)]"><Trans id="course.goals.empty" message="No goals yet. Studying without one is fine too." /></p>
      : <ul className="space-y-2">{course.goals.map(goal => <GoalRow key={goal.id} course={course} goal={goal} pending={model.pending} />)}</ul>}
    <AddGoalForm course={course} pending={model.pending} />
  </div>;
}
