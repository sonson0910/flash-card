import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[] }));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function'
        ? (initial as () => T)()
        : initial;
      return [hooks.states[index] as T, (value: T | ((current: T) => T)) => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof value === 'function'
          ? (value as (current: T) => T)(current)
          : value;
      }] as const;
    },
  };
});

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({
    _: (descriptor: { id?: string; message?: string } | string) => {
      if (typeof descriptor === 'string') return descriptor;
      return descriptor.message ?? descriptor.id ?? '';
    },
  }),
}));

const service = vi.hoisted(() => ({
  submitCardReport: vi.fn(),
  reportCardFailureMessage: vi.fn((error: unknown) => (error instanceof Error ? error.message : 'unknown failure')),
}));

vi.mock('./cardReportService', () => ({
  CARD_REPORT_REASONS: ['wrong-meaning', 'wrong-example', 'wrong-pronunciation', 'wrong-image', 'offensive', 'other'],
  submitCardReport: service.submitCardReport,
  reportCardFailureMessage: service.reportCardFailureMessage,
}));

import { ReportCardDialog } from './ReportCardDialog';

type Tree = { type?: unknown; props?: Record<string, unknown> };

const walk = (node: unknown, visit: (element: Tree) => void): void => {
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (!node || typeof node !== 'object') return;
  const element = node as Tree;
  visit(element);
  walk(element.props?.children, visit);
};

const findAllByType = (node: unknown, type: string): Tree[] => {
  const out: Tree[] = [];
  walk(node, element => { if (element.type === type) out.push(element); });
  return out;
};

const findRole = (node: unknown, role: string): Tree | undefined => {
  let match: Tree | undefined;
  walk(node, element => { if (!match && element.props?.role === role) match = element; });
  return match;
};

const render = (props: Parameters<typeof ReportCardDialog>[0]) => {
  hooks.cursor = 0;
  const tree = ReportCardDialog(props);
  return {
    tree,
    form: findAllByType(tree, 'form')[0],
    submit: findAllByType(tree, 'form')[0]?.props?.onSubmit as ((event: { preventDefault(): void }) => Promise<void>) | undefined,
    select: findAllByType(tree, 'select')[0],
    textarea: findAllByType(tree, 'textarea')[0],
    submitButton: findAllByType(tree, 'button').find(button => button.props?.type === 'submit'),
    status: findRole(tree, 'status'),
    alert: findRole(tree, 'alert'),
  };
};

const baseProps = { cardId: 'card-1', cardWord: 'lead', open: true, onOpenChange: vi.fn() };

describe('ReportCardDialog', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    vi.clearAllMocks();
  });

  it('starts on the request state with the default reason selected and no error shown', () => {
    const view = render(baseProps);

    expect(view.select?.props?.value).toBe('wrong-meaning');
    expect(view.alert).toBeUndefined();
    expect(view.status).toBeUndefined();
    expect(view.submitButton?.props?.disabled).toBe(false);
  });

  it('disables the submit button while the report is working, then shows the success state', async () => {
    let resolveSubmit: () => void = () => {};
    service.submitCardReport.mockReturnValue(new Promise<void>(resolve => { resolveSubmit = resolve; }));

    let view = render(baseProps);
    const submitPromise = view.submit!({ preventDefault: vi.fn() });
    view = render(baseProps);

    expect(view.submitButton?.props?.disabled).toBe(true);
    expect(service.submitCardReport).toHaveBeenCalledWith({ cardId: 'card-1', reason: 'wrong-meaning' });

    resolveSubmit();
    await submitPromise;
    view = render(baseProps);

    expect(view.status).toBeDefined();
    expect(JSON.stringify(view.status?.props?.children)).toContain('Thank you');
  });

  it('surfaces the mapped failure message and keeps the form open for a retry', async () => {
    service.submitCardReport.mockRejectedValue(new Error('cardReport unavailable'));
    service.reportCardFailureMessage.mockReturnValue("Couldn't send the report. Please try again or contact support.");

    let view = render(baseProps);
    await view.submit!({ preventDefault: vi.fn() });
    view = render(baseProps);

    expect(view.alert?.props?.children).toBe("Couldn't send the report. Please try again or contact support.");
    expect(view.status).toBeUndefined();
    expect(view.submitButton?.props?.disabled).toBe(false);
  });

  it('includes a trimmed note only when one was entered', async () => {
    service.submitCardReport.mockResolvedValue(undefined);
    let view = render(baseProps);
    (view.textarea!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: '  Sai nghĩa.  ' } });
    view = render(baseProps);

    await view.submit!({ preventDefault: vi.fn() });

    expect(service.submitCardReport).toHaveBeenCalledWith({ cardId: 'card-1', reason: 'wrong-meaning', note: 'Sai nghĩa.' });
  });

  it('ignores a second submit while the first is still in flight', () => {
    service.submitCardReport.mockReturnValue(new Promise<void>(() => {}));

    let view = render(baseProps);
    void view.submit!({ preventDefault: vi.fn() });
    view = render(baseProps);
    void view.submit!({ preventDefault: vi.fn() });

    expect(service.submitCardReport).toHaveBeenCalledTimes(1);
  });
});
