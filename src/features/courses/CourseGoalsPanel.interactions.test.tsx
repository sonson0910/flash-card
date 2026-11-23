import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from './courseModel';

const hooks = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[] }));
const addGoal = vi.hoisted(() => vi.fn());
const updateGoal = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ ownerId: 'owner-1' as string | null }));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.states[index] as T, (value: T | ((current: T) => T)) => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof value === 'function' ? (value as (current: T) => T)(current) : value;
      }] as const;
    },
    useEffect: (effect: () => void) => { effect(); },
  };
});

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ _: (value: { message?: string } | string) => typeof value === 'string' ? value : value.message ?? '' }),
}));

vi.mock('./CourseGate', () => ({
  useCourseSession: () => ({ model: { pending: false, ownerId: session.ownerId }, actions: { addGoal, updateGoal, removeGoal: vi.fn() } }),
}));

import { CourseGoalsPanel } from './CourseGoalsPanel';
import { IeltsBandPicker } from '../examProgress/IeltsBandPicker';
import { LatestExamScoreEditor } from '../examProgress/LatestExamScoreEditor';

type Tree = { type?: unknown; props?: Record<string, unknown> };

const walk = (node: unknown, visit: (element: Tree) => void): void => {
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!node || typeof node !== 'object') return;
  const element = node as Tree;
  visit(element);
  walk(element.props?.children, visit);
};

const findAll = (node: unknown, type: string): Tree[] => {
  const found: Tree[] = [];
  walk(node, element => { if (element.type === type) found.push(element); });
  return found;
};

const course: Course = {
  id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active',
  goals: [{ id: 'goal-ielts', kind: 'ielts', level: '7.0', targetDate: '2026-12-01', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const renderRow = (currentCourse: Course = course, goalId = 'goal-ielts'): Tree => {
  hooks.cursor = 0;
  const panel = CourseGoalsPanel({ course: currentCourse, onClose: vi.fn() });
  let row: Tree | undefined;
  walk(panel, element => {
    if (typeof element.type === 'function' && (element.props?.goal as { id?: string } | undefined)?.id === goalId) row = element;
  });
  if (!row || typeof row.type !== 'function') throw new Error('Goal row not found');
  return (row.type as (props: Record<string, unknown>) => Tree)(row.props ?? {});
};

const renderAddForm = (currentCourse: Course): Tree => {
  hooks.cursor = 0;
  const panel = CourseGoalsPanel({ course: currentCourse, onClose: vi.fn() });
  let addForm: Tree | undefined;
  walk(panel, element => {
    if (typeof element.type === 'function' && element.props?.course && !element.props?.goal) addForm = element;
  });
  if (!addForm || typeof addForm.type !== 'function') throw new Error('Add goal form not found');
  return (addForm.type as (props: Record<string, unknown>) => Tree)(addForm.props ?? {});
};

const flush = () => new Promise(resolve => { setTimeout(resolve, 0); });

/** IELTS goals take their level from the band picker; other kinds keep the free-text level field. */
const bandPicker = (node: unknown): Tree => {
  let picker: Tree | undefined;
  walk(node, element => { if (element.type === IeltsBandPicker) picker = element; });
  if (!picker) throw new Error('Band picker not found');
  return picker;
};
const pickBand = (node: unknown, band: string) => (bandPicker(node).props?.onChange as (value: string) => void)(band);
const change = (input: Tree, value: string) => (input.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
const scoreEditors = (node: unknown): Tree[] => {
  const found: Tree[] = [];
  walk(node, element => { if (element.type === LatestExamScoreEditor) found.push(element); });
  return found;
};

describe('existing course goal editing', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    session.ownerId = 'owner-1';
    addGoal.mockReset();
    updateGoal.mockReset();
  });

  it('offers the latest IELTS score beside an IELTS goal that is not being edited', () => {
    let row = renderRow();
    expect(scoreEditors(row).map(editor => editor.props)).toEqual([{ ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-ielts' }]);
    (findAll(row, 'button')[0].props?.onClick as () => void)();
    row = renderRow();
    expect(scoreEditors(row)).toHaveLength(0);

    hooks.states = [];
    session.ownerId = null;
    expect(scoreEditors(renderRow())).toHaveLength(0);
  });

  it('retains the draft after a failed save and allows retry with the same values', async () => {
    let finishFirst!: (value: { ok: false }) => void;
    updateGoal.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true });

    let row = renderRow();
    (findAll(row, 'button')[0].props?.onClick as () => void)();
    row = renderRow();
    expect(bandPicker(row).props?.value).toBe('7.0');
    pickBand(row, '7.5');
    const [dateInput] = findAll(row, 'input');
    change(dateInput, '2027-01-15');
    row = renderRow();
    const form = findAll(row, 'form')[0];
    (form.props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    expect(updateGoal).toHaveBeenCalledWith('course-en', 'goal-ielts', { level: '7.5', targetDate: '2027-01-15' });

    row = renderRow();
    expect(findAll(row, 'form')).toHaveLength(1);
    expect(findAll(row, 'button').filter(button => button.props?.disabled)).toHaveLength(4);
    expect(findAll(row, 'input').every(input => input.props?.disabled)).toBe(true);
    expect(bandPicker(row).props?.disabled).toBe(true);

    finishFirst({ ok: false });
    await flush();
    row = renderRow();
    expect(bandPicker(row).props?.value).toBe('7.5');
    expect(findAll(row, 'input').map(input => input.props?.value)).toEqual(['2027-01-15']);
    expect(findAll(row, 'button').find(button => button.props?.type === 'submit')?.props?.disabled).toBe(false);

    (findAll(row, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();
    row = renderRow();
    expect(updateGoal).toHaveBeenCalledTimes(2);
    expect(findAll(row, 'form')).toHaveLength(0);
  });
});

describe('a goal level typed in a compatibility form', () => {
  const toeicCourse: Course = {
    ...course,
    goals: [{ id: 'goal-toeic', kind: 'toeic', level: '700', targetDate: null, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
  };

  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    addGoal.mockReset();
    updateGoal.mockReset();
  });

  it('is saved in its canonical form when an existing goal is edited', async () => {
    updateGoal.mockResolvedValue({ ok: true });
    let row = renderRow(toeicCourse, 'goal-toeic');
    (findAll(row, 'button')[0].props?.onClick as () => void)();
    row = renderRow(toeicCourse, 'goal-toeic');
    change(findAll(row, 'input')[0], '　８００　点 ');
    row = renderRow(toeicCourse, 'goal-toeic');
    (findAll(row, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();
    expect(updateGoal).toHaveBeenCalledWith('course-en', 'goal-toeic', { level: '800 点', targetDate: null });
  });

  it('is resent exactly as stored when only the date of an old goal is edited', async () => {
    updateGoal.mockResolvedValue({ ok: true });
    const oldIelts: Course = {
      ...course,
      goals: [{ id: 'goal-old', kind: 'ielts', level: '7.5  overall', targetDate: null, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
    };
    let row = renderRow(oldIelts, 'goal-old');
    (findAll(row, 'button')[0].props?.onClick as () => void)();
    row = renderRow(oldIelts, 'goal-old');
    change(findAll(row, 'input')[0], '2027-01-15');
    row = renderRow(oldIelts, 'goal-old');
    (findAll(row, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();
    expect(updateGoal).toHaveBeenCalledWith('course-en', 'goal-old', { level: '7.5  overall', targetDate: '2027-01-15' });
  });

  it('is saved in its canonical form when a goal is added', async () => {
    addGoal.mockResolvedValue({ ok: true });
    const emptyCourse: Course = { ...course, goals: [] };
    let form = renderAddForm(emptyCourse);
    pickBand(form, '7.5');
    form = renderAddForm({ ...course, goals: [course.goals[0]] });
    change(findAll(form, 'input')[0], 'ＴＯＥＩＣ　８００');
    form = renderAddForm({ ...course, goals: [course.goals[0]] });
    (findAll(form, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();
    expect(addGoal).toHaveBeenCalledWith('course-en', { kind: 'toeic', level: 'TOEIC 800', targetDate: null });
  });
});

describe('adding course goals', () => {
  const emptyCourse: Course = { ...course, goals: [] };
  const courseWithIelts: Course = { ...course, goals: [course.goals[0]] };

  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    addGoal.mockReset();
    updateGoal.mockReset();
  });

  it('advances the default selector after consecutive successful adds', async () => {
    addGoal.mockResolvedValue({ ok: true });

    let form = renderAddForm(emptyCourse);
    pickBand(form, '7.5');
    change(findAll(form, 'input')[0], '2027-01-15');
    form = renderAddForm(emptyCourse);
    (findAll(form, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();
    expect(addGoal).toHaveBeenCalledWith('course-en', { kind: 'ielts', level: '7.5', targetDate: '2027-01-15' });

    renderAddForm(courseWithIelts);
    form = renderAddForm(courseWithIelts);
    expect(findAll(form, 'select')[0].props?.value).toBe('toeic');
    expect(findAll(form, 'input').map(input => input.props?.value)).toEqual(['', '']);

    const [secondLevel, secondDate] = findAll(form, 'input');
    (secondLevel.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '800' } });
    (secondDate.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2027-06-01' } });
    form = renderAddForm(courseWithIelts);
    (findAll(form, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();
    expect(addGoal).toHaveBeenLastCalledWith('course-en', { kind: 'toeic', level: '800', targetDate: '2027-06-01' });
  });

  it('locks the add draft until a successful request completes', async () => {
    let finish!: (value: { ok: true }) => void;
    addGoal.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));

    let form = renderAddForm(emptyCourse);
    pickBand(form, '7.5');
    change(findAll(form, 'input')[0], '2027-01-15');
    form = renderAddForm(emptyCourse);
    (findAll(form, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });

    form = renderAddForm(emptyCourse);
    expect([...findAll(form, 'select'), ...findAll(form, 'input'), ...findAll(form, 'button')].every(control => control.props?.disabled)).toBe(true);
    expect(bandPicker(form).props?.disabled).toBe(true);

    finish({ ok: true });
    await flush();
    form = renderAddForm(emptyCourse);
    expect(bandPicker(form).props?.value).toBeNull();
    expect(findAll(form, 'input').map(input => input.props?.value)).toEqual(['']);
    expect(findAll(form, 'button')[0].props?.disabled).toBe(false);
  });

  it('keeps an available selection and draft when an add fails', async () => {
    addGoal.mockResolvedValue({ ok: false });

    let form = renderAddForm(emptyCourse);
    (findAll(form, 'select')[0].props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'business' } });
    form = renderAddForm(emptyCourse);
    const [levelInput, dateInput] = findAll(form, 'input');
    (levelInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'B2' } });
    (dateInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2027-01-15' } });

    form = renderAddForm(courseWithIelts);
    expect(findAll(form, 'select')[0].props?.value).toBe('business');
    expect(findAll(form, 'input').map(input => input.props?.value)).toEqual(['B2', '2027-01-15']);
    (findAll(form, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();

    form = renderAddForm(courseWithIelts);
    expect(findAll(form, 'select')[0].props?.value).toBe('business');
    expect(findAll(form, 'input').map(input => input.props?.value)).toEqual(['B2', '2027-01-15']);
  });
});
