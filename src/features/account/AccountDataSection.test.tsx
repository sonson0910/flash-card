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

const accountService = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
  downloadAccountData: vi.fn(),
  isAccountSignedIn: vi.fn(() => true),
}));

vi.mock('./accountDataService', () => ({
  // A local stand-in avoids loading the real module, which initializes Firebase at import time.
  LocalAccountCleanupError: class LocalAccountCleanupError extends Error {},
  deleteAccount: accountService.deleteAccount,
  downloadAccountData: accountService.downloadAccountData,
  isAccountSignedIn: accountService.isAccountSignedIn,
}));

import { LocalAccountCleanupError } from './accountDataService';
import { AccountDataSection } from './AccountDataSection';

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

const flush = () => new Promise(resolve => { setTimeout(resolve, 0); });

const render = (props: Parameters<typeof AccountDataSection>[0]) => {
  hooks.cursor = 0;
  const tree = AccountDataSection(props);
  // Positional lookup, not text matching: the export and confirm buttons swap their label
  // (e.g. "Download account data" -> "Exporting...") for the busy state, and that label is an
  // unrendered `<Trans>` element in this tree, not a plain string. With `onExportLibrary`
  // omitted (as in every test below), button order is stable: export, delete-open, [confirm].
  const buttons = findAllByType(tree, 'button');
  return {
    tree,
    inputs: findAllByType(tree, 'input'),
    status: findRole(tree, 'status'),
    alert: findRole(tree, 'alert'),
    exportButton: buttons[0],
    deleteOpenButton: buttons[1],
    confirmButton: buttons[2],
  };
};

describe('AccountDataSection', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    vi.clearAllMocks();
    accountService.isAccountSignedIn.mockReturnValue(true);
  });

  it('shows a busy export button while the download request is in flight, then re-enables it on success', async () => {
    let resolveExport: () => void = () => {};
    accountService.downloadAccountData.mockReturnValue(new Promise<void>(resolve => { resolveExport = resolve; }));
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.exportButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });

    expect(JSON.stringify(view.exportButton?.props?.children)).toContain('Exporting');
    expect(view.exportButton?.props?.disabled).toBe(true);

    resolveExport();
    await flush();
    view = render({ open: true, onOpenChange });

    expect(view.exportButton?.props?.disabled).toBe(false);
    expect(view.alert).toBeUndefined();
  });

  it('surfaces an export error without touching the delete flow', async () => {
    accountService.downloadAccountData.mockRejectedValue(new Error('network down'));
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.exportButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange });

    expect(view.alert?.props?.children).toBe("Couldn't download account data. Please try again later.");
  });

  it('keeps the confirm button disabled until the exact phrase is typed, then completes deletion', async () => {
    accountService.deleteAccount.mockResolvedValue('completed');
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });
    expect(view.confirmButton?.props?.disabled).toBe(true);

    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange });
    expect(view.confirmButton?.props?.disabled).toBe(false);

    (view.confirmButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange });

    expect(accountService.deleteAccount).toHaveBeenCalledWith('XÓA TÀI KHOẢN');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('accepts an NFD-normalized confirmation phrase typed in a different Unicode form', () => {
    const onOpenChange = vi.fn();
    let view = render({ open: true, onOpenChange });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });

    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'XÓA TÀI KHOẢN'.normalize('NFD') } },
    );
    view = render({ open: true, onOpenChange });

    expect(view.confirmButton?.props?.disabled).toBe(false);
  });

  it('reports a started deletion (server-side timeout) without closing the dialog', async () => {
    accountService.deleteAccount.mockResolvedValue('started');
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange });
    (view.confirmButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(view.status?.props?.children).toBe(
      'The account deletion request is recorded and will finish on the server. You have been signed out of this device.',
    );
  });

  it('distinguishes a local-cleanup failure from a full delete failure, both surfacing without closing the dialog', async () => {
    accountService.deleteAccount.mockRejectedValue(new LocalAccountCleanupError('storage unavailable'));
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange });
    (view.confirmButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(view.alert?.props?.children).toBe(
      "The account was deleted on the server, but device data wasn't fully cleared. Clear SonFlash site data in your browser.",
    );
  });

  it('surfaces a generic delete failure, covering the reauthentication rejection path', async () => {
    accountService.deleteAccount.mockRejectedValue(Object.assign(new Error('auth/popup-closed-by-user'), { code: 'auth/popup-closed-by-user' }));
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange });
    (view.confirmButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange });

    expect(view.alert?.props?.children).toBe("The account wasn't fully deleted. Contact support if the error continues.");
  });

  it('disables export and delete actions for a signed-out visitor', () => {
    accountService.isAccountSignedIn.mockReturnValue(false);
    const view = render({ open: true, onOpenChange: vi.fn() });

    expect(view.exportButton?.props?.disabled).toBe(true);
    expect(view.deleteOpenButton?.props?.disabled).toBe(true);
  });
});
