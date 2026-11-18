import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from './courseModel';

const hooks = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[] }));
const addGoal = vi.hoisted(() => vi.fn());
const updateGoal = vi.hoisted(() => vi.fn());

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
  useCourseSession: () => ({ model: { pending: false }, actions: { addGoal, updateGoal, removeGoal: vi.fn() } }),
}));

import { CourseGoalsPanel } from './CourseGoalsPanel';

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

const renderRow = (): Tree => {
  hooks.cursor = 0;
  const panel = CourseGoalsPanel({ course, onClose: vi.fn() });
  let row: Tree | undefined;
  walk(panel, element => {
    if (typeof element.type === 'function' && (element.props?.goal as { id?: string } | undefined)?.id === 'goal-ielts') row = element;
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

describe('existing course goal editing', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    addGoal.mockReset();
    updateGoal.mockReset();
  });

  it('retains the draft after a failed save and allows retry with the same values', async () => {
    let finishFirst!: (value: { ok: false }) => void;
    updateGoal.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true });

    let row = renderRow();
    (findAll(row, 'button')[0].props?.onClick as () => void)();
    row = renderRow();
    const [levelInput, dateInput] = findAll(row, 'input');
    (levelInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: ' 7.5 ' } });
    (dateInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2027-01-15' } });
    row = renderRow();
    const form = findAll(row, 'form')[0];
    (form.props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    expect(updateGoal).toHaveBeenCalledWith('course-en', 'goal-ielts', { level: '7.5', targetDate: '2027-01-15' });

    row = renderRow();
    expect(findAll(row, 'form')).toHaveLength(1);
    expect(findAll(row, 'button').filter(button => button.props?.disabled)).toHaveLength(4);
    expect(findAll(row, 'input').every(input => input.props?.disabled)).toBe(true);

    finishFirst({ ok: false });
    await flush();
    row = renderRow();
    expect(findAll(row, 'input').map(input => input.props?.value)).toEqual([' 7.5 ', '2027-01-15']);
    expect(findAll(row, 'button').find(button => button.props?.type === 'submit')?.props?.disabled).toBe(false);

    (findAll(row, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });
    await flush();
    row = renderRow();
    expect(updateGoal).toHaveBeenCalledTimes(2);
    expect(findAll(row, 'form')).toHaveLength(0);
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
    const [levelInput, dateInput] = findAll(form, 'input');
    (levelInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '7.5' } });
    (dateInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2027-01-15' } });
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
    const [levelInput, dateInput] = findAll(form, 'input');
    (levelInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '7.5' } });
    (dateInput.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2027-01-15' } });
    form = renderAddForm(emptyCourse);
    (findAll(form, 'form')[0].props?.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: vi.fn() });

    form = renderAddForm(emptyCourse);
    expect([...findAll(form, 'select'), ...findAll(form, 'input'), ...findAll(form, 'button')].every(control => control.props?.disabled)).toBe(true);

    finish({ ok: true });
    await flush();
    form = renderAddForm(emptyCourse);
    expect(findAll(form, 'input').map(input => input.props?.value)).toEqual(['', '']);
    expect(findAll(form, 'button')[0].props?.disabled).toBe(false);
  });

  it('keeps an available selection and draft when an add fails', async () => {
    addGoal.mockResolvedValue({ ok: false });

    let form = renderAddForm(emptyCourse);
    (findAll(form, 'select')[0].props?.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'business' } });
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
