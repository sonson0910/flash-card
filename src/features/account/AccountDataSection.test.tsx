import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_DELETION_CACHE_NOTICE_STORAGE_KEY, ACCOUNT_DELETION_STARTED_NOTICE_STORAGE_KEY, consumeAccountDeletionCacheNotice, consumeAccountDeletionStartedNotice } from './account-deletion-notice';

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
    useRef: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = { current: initial };
      return hooks.states[index] as { current: T };
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

const findByProp = (node: unknown, prop: string): Tree | undefined => {
  let match: Tree | undefined;
  walk(node, element => { if (!match && prop in (element.props ?? {})) match = element; });
  return match;
};

const findDisabledDialogCloses = (node: unknown): Tree[] => {
  const out: Tree[] = [];
  walk(node, element => {
    if (element.type !== 'button' && element.props?.disabled === true) out.push(element);
  });
  return out;
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

  afterEach(() => vi.unstubAllGlobals());

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

  it('distinguishes the card Excel export from JSON account data', () => {
    const tree = AccountDataSection({ open: true, onOpenChange: vi.fn(), onExportLibrary: vi.fn() });
    const buttons = findAllByType(tree, 'button');

    expect(JSON.stringify(buttons[0]?.props?.children)).toContain('Download cards as Excel');
    expect(JSON.stringify(buttons[1]?.props?.children)).toContain('JSON, excluding cards');
  });

  it('keeps the confirm button disabled until the exact phrase is typed, then completes deletion', async () => {
    accountService.deleteAccount.mockResolvedValue({ status: 'completed', restartRequired: false, cacheCleared: true });
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
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
    expect(reload).not.toHaveBeenCalled();
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

  it('reports an unconfirmed deletion without claiming the switched account was signed out or deleted', async () => {
    accountService.deleteAccount.mockResolvedValue({ status: 'started', restartRequired: false, cacheCleared: true });
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
      'We could not confirm whether account deletion finished. If you can still sign in later, contact support.',
    );
  });

  it('keeps deletion notices visible until the request settles', async () => {
    let resolveDelete: (result: { status: 'started'; restartRequired: false; cacheCleared: true }) => void = () => {};
    accountService.deleteAccount.mockReturnValue(new Promise<{ status: 'started'; restartRequired: false; cacheCleared: true }>(resolve => { resolveDelete = resolve; }));
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange });
    (view.confirmButton!.props!.onClick as () => void)();
    (view.confirmButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });

    expect(accountService.deleteAccount).toHaveBeenCalledOnce();
    expect(findByProp(view.tree, 'onOpenChange')?.props?.onOpenChange).toBeTypeOf('function');
    (findByProp(view.tree, 'onOpenChange')!.props!.onOpenChange as (open: boolean) => void)(false);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(findDisabledDialogCloses(view.tree)).toHaveLength(2);

    resolveDelete({ status: 'started', restartRequired: false, cacheCleared: true });
    await flush();
    view = render({ open: true, onOpenChange });

    expect(view.status?.props?.children).toBe(
      'We could not confirm whether account deletion finished. If you can still sign in later, contact support.',
    );
    (findByProp(view.tree, 'onOpenChange')!.props!.onOpenChange as (open: boolean) => void)(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reloads only after the same-owner Firestore cache lifecycle was attempted', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    accountService.deleteAccount.mockResolvedValue({ status: 'completed', restartRequired: true, cacheCleared: true });
    const onOpenChange = vi.fn();

    let view = render({ open: true, onOpenChange });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange });
    (view.confirmButton!.props!.onClick as () => void)();
    await flush();

    expect(reload).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('preserves a started-deletion notice for the signed-out landing before reloading', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    vi.stubGlobal('location', { reload: vi.fn() });
    accountService.deleteAccount.mockResolvedValue({ status: 'started', restartRequired: true, cacheCleared: true });

    let view = render({ open: true, onOpenChange: vi.fn() });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange: vi.fn() });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange: vi.fn() });
    (view.confirmButton!.props!.onClick as () => void)();
    await flush();

    expect(values.get(ACCOUNT_DELETION_STARTED_NOTICE_STORAGE_KEY)).toBe('1');
    expect(consumeAccountDeletionStartedNotice()).toBe(true);
    expect(consumeAccountDeletionStartedNotice()).toBe(false);
  });

  it('shows a persistent site-data warning after cache clearing fails', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    accountService.deleteAccount.mockResolvedValue({ status: 'completed', restartRequired: true, cacheCleared: false });

    let view = render({ open: true, onOpenChange: vi.fn() });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange: vi.fn() });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange: vi.fn() });
    (view.confirmButton!.props!.onClick as () => void)();
    await flush();

    expect(values.get(ACCOUNT_DELETION_CACHE_NOTICE_STORAGE_KEY)).toBe('1');
    expect(consumeAccountDeletionCacheNotice()).toBe(true);
    expect(consumeAccountDeletionCacheNotice()).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('shows warnings before reload when neither storage nor URL history is writable', async () => {
    vi.stubGlobal('sessionStorage', { setItem: () => { throw new Error('storage blocked'); } });
    vi.stubGlobal('location', { href: 'https://sonflash.app/', reload: vi.fn() });
    vi.stubGlobal('history', { state: null, replaceState: () => { throw new Error('history blocked'); } });
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    accountService.deleteAccount.mockResolvedValue({ status: 'started', restartRequired: true, cacheCleared: false });

    let view = render({ open: true, onOpenChange: vi.fn() });
    (view.deleteOpenButton!.props!.onClick as () => void)();
    view = render({ open: true, onOpenChange: vi.fn() });
    (view.inputs[0]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'XÓA TÀI KHOẢN' } });
    view = render({ open: true, onOpenChange: vi.fn() });
    (view.confirmButton!.props!.onClick as () => void)();
    await flush();

    expect(alert).toHaveBeenCalledWith('We could not confirm whether account deletion finished. If you can still sign in later, contact support.');
    expect(alert).toHaveBeenCalledWith("SonFlash couldn't clear saved account data from this device. Clear SonFlash site data in your browser.");
    expect(globalThis.location.reload).toHaveBeenCalledOnce();
  });

  it('shows incomplete device cleanup when the original owner changed during deletion', async () => {
    accountService.deleteAccount.mockResolvedValue({ status: 'completed', restartRequired: false, cacheCleared: false });
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
      "SonFlash couldn't clear saved account data from this device. Clear SonFlash site data in your browser.",
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
