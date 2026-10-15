import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effectDeps: [] as (unknown[] | undefined)[],
  deferEffects: false,
  effects: [] as Array<() => void>,
}));

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
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index] as { current: T };
    },
    useEffect: (effect: () => void, deps?: unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.effectDeps[index];
      const changed = !previous || !deps || deps.length !== previous.length
        || deps.some((dep, i) => dep !== previous[i]);
      hooks.effectDeps[index] = deps;
      if (changed) {
        if (hooks.deferEffects) hooks.effects.push(effect);
        else effect();
      }
    },
    useLayoutEffect: (effect: () => void, deps?: unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.effectDeps[index];
      const changed = !previous || !deps || deps.length !== previous.length
        || deps.some((dep, i) => dep !== previous[i]);
      hooks.effectDeps[index] = deps;
      if (changed) effect();
    },
  };
});

const translate = (descriptor: { id?: string; message?: string } | string) => {
  if (typeof descriptor === 'string') return descriptor;
  return descriptor.message ?? descriptor.id ?? '';
};

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ _: translate }),
}));

const billing = vi.hoisted(() => ({
  getPilotOffer: vi.fn(),
  recordPurchaseIntent: vi.fn(),
}));

const owner = vi.hoisted(() => ({
  id: 'user-a' as string | null,
  onChange: undefined as undefined | ((ownerId: string | null) => void),
}));

const plan = vi.hoisted(() => ({
  state: { status: 'ready', usage: { tier: 'free', used: 0, limit: 30, periodEndsAt: new Date('2026-10-01T00:00:00.000Z') } } as unknown,
  enabled: [] as boolean[],
}));

vi.mock('./billingService', () => ({
  getPilotOffer: billing.getPilotOffer,
  recordPurchaseIntent: billing.recordPurchaseIntent,
}));

vi.mock('../session/ownerSessionPort', () => ({
  currentOwnerId: () => owner.id,
  observeOwner: (onChange: (ownerId: string | null) => void) => { owner.onChange = onChange; return vi.fn(); },
}));

vi.mock('../plan/usePlanUsage', () => ({ usePlanUsageState: (enabled: boolean) => {
  plan.enabled.push(enabled);
  return plan.state;
} }));

const analytics = vi.hoisted(() => ({ recordPilotClientEvent: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ recordPilotClientEvent: analytics.recordPilotClientEvent }));

import { UpgradeDialog } from './UpgradeDialog';
import { formatNumber } from '../../lib/format';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
const offerVersion = 'a'.repeat(64);

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

const render = (props: Parameters<typeof UpgradeDialog>[0]) => {
  hooks.cursor = 0;
  const tree = UpgradeDialog(props);
  return {
    tree,
    buttons: findAllByType(tree, 'button'),
    status: findRole(tree, 'status'),
    alert: findRole(tree, 'alert'),
  };
};

describe('UpgradeDialog', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    hooks.refs = [];
    hooks.effectDeps = [];
    hooks.deferEffects = false;
    hooks.effects = [];
    plan.enabled = [];
    owner.id = 'user-a';
    owner.onChange = undefined;
    plan.state = { status: 'ready', usage: { tier: 'free', used: 0, limit: 30, periodEndsAt: new Date('2026-10-01T00:00:00.000Z') } };
    vi.clearAllMocks();
  });

  it('shows a loading state while the offer request is in flight', () => {
    billing.getPilotOffer.mockReturnValue(new Promise(() => {}));

    render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    // The mount effect sets `loading` synchronously, but this fake `useEffect` (unlike React's real
    // one) runs inline during the same call, so the tree it returns still reflects the pre-effect
    // value; render once more to read the state the effect just wrote.
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });

    expect(analytics.recordPilotClientEvent).toHaveBeenCalledWith(
      { name: 'paywall_viewed', props: { trigger: 'quota', offerId: 'pro-vn-30d-v1' } },
    );
    expect(view.status).toBeDefined();
  });

  it('only enables plan listeners while the dialog is open', () => {
    billing.getPilotOffer.mockReturnValue(new Promise(() => {}));

    render({ open: false, onOpenChange: vi.fn(), trigger: 'menu' });
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    render({ open: false, onOpenChange: vi.fn(), trigger: 'menu' });

    expect(plan.enabled).toEqual([false, true, false]);
  });

  it('renders the offer once the request succeeds', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });

    expect(view.status).toBeUndefined();
    expect(findAllByType(view.tree, 'p').some(element =>
      String(element.props?.className).includes('font-serif text-4xl'))).toBe(false);
    const registerButton = view.buttons.find(button => JSON.stringify(button.props?.children).includes('Register interest'));
    expect(registerButton).toBeDefined();
    expect(registerButton?.props?.disabled).toBe(false);
  });

  it('shows a price only when the server has published one', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: 85_320, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });

    const price = findAllByType(view.tree, 'p').find(element =>
      String(element.props?.className).includes('font-serif text-4xl'));
    expect(price?.props?.children).toEqual([formatNumber(85_320), ' ₫']);
  });

  it('surfaces a load error and stops showing the loading state', async () => {
    billing.getPilotOffer.mockRejectedValue(new Error('network down'));

    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });

    expect(view.status).toBeUndefined();
    expect(view.alert).toBeDefined();
    expect(view.alert?.props?.children).toBe("Couldn't load the Pro plan. Please try again later.");
  });

  it('does not offer an intent while the entitlement is still loading', async () => {
    plan.state = { status: 'loading' };
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });

    expect(JSON.stringify(view.status?.props?.children)).toContain('Checking your current plan');
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
  });

  it('shows the active Pro state without recording purchase intent', async () => {
    plan.state = { status: 'ready', usage: { tier: 'pro', used: 0, limit: 1_000, periodEndsAt: new Date('2026-10-01T00:00:00.000Z') } };
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'already-pro', offerVersion });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });

    expect(JSON.stringify(view.status?.props?.children)).toContain('Pro is already active');
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    expect(billing.recordPurchaseIntent).not.toHaveBeenCalled();
  });

  it('uses server eligibility even when the local plan still says Free', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'already-pro', offerVersion });
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    expect(JSON.stringify(view.status?.props?.children)).toContain('Pro is already active');
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
  });

  it('fails closed when an older offer response omits eligibility', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, offerVersion });
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    expect(JSON.stringify(view.alert?.props?.children)).toContain('Registration is temporarily unavailable.');
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
  });

  it('shows unavailable when the initial offer disallows registration', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'unavailable', offerVersion });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });

    expect(JSON.stringify(view.alert?.props?.children)).toContain('Registration is temporarily unavailable.');
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    expect(billing.recordPurchaseIntent).not.toHaveBeenCalled();
  });

  it('keeps the interest action available at the real Free quota boundary', async () => {
    plan.state = { status: 'ready', usage: { tier: 'free', used: 30, limit: 30, periodEndsAt: new Date('2026-10-01T00:00:00.000Z') } };
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });

    expect(JSON.stringify(view.status?.props?.children)).toContain('allowance is exhausted');
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(true);
  });

  it('clears a previous offer while reopening so a failed refresh cannot record interest', async () => {
    billing.getPilotOffer.mockResolvedValueOnce({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion })
      .mockRejectedValueOnce(new Error('offline'));
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    expect(render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' }).buttons
      .some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(true);
    render({ open: false, onOpenChange: vi.fn(), trigger: 'menu' });
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    const loadingView = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    expect(loadingView.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    await flush();
    const errorView = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    expect(errorView.alert).toBeDefined();
    expect(errorView.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    expect(billing.recordPurchaseIntent).not.toHaveBeenCalled();
  });

  it('clears the previous offer before the first reopened paint', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    const props = { onOpenChange: vi.fn(), trigger: 'menu' as const };
    render({ ...props, open: true });
    await flush();
    expect(render({ ...props, open: true }).buttons
      .some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(true);
    render({ ...props, open: false });
    hooks.deferEffects = true;
    render({ ...props, open: true });
    // React flushes layout-effect state before paint. This render models that
    // synchronous rerender while the passive offer request remains deferred.
    const reopened = render({ ...props, open: true });

    expect(reopened.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    expect(JSON.stringify(reopened.status?.props?.children)).toContain('Loading plan details');
  });

  it('clears a previous offer before refetching for a changed trigger', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    const props = { onOpenChange: vi.fn() };
    render({ ...props, open: true, trigger: 'menu' });
    await flush();
    expect(render({ ...props, open: true, trigger: 'menu' }).buttons
      .some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(true);

    hooks.deferEffects = true;
    render({ ...props, open: true, trigger: 'quota' });
    const changedTrigger = render({ ...props, open: true, trigger: 'quota' });

    expect(changedTrigger.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    expect(JSON.stringify(changedTrigger.status?.props?.children)).toContain('Loading plan details');
  });

  it('records the purchase intent and shows confirmation on submit', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    billing.recordPurchaseIntent.mockResolvedValue({ recorded: true });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    await flush();
    let view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    const registerButton = view.buttons.find(button => JSON.stringify(button.props?.children).includes('Register interest'));

    (registerButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });

    expect(billing.recordPurchaseIntent).toHaveBeenCalledWith('quota', 'user-a', offerVersion);
    expect(JSON.stringify(view.status?.props?.children)).toContain('Your purchase interest is recorded.');
  });

  it('does not show a stale submit result after the dialog closes and reopens', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    let settle!: (value: { recorded: true }) => void;
    billing.recordPurchaseIntent.mockReturnValue(new Promise(resolve => { settle = resolve; }));
    const props = { onOpenChange: vi.fn(), trigger: 'menu' as const };
    render({ ...props, open: true });
    await flush();
    const button = render({ ...props, open: true }).buttons
      .find(item => JSON.stringify(item.props?.children).includes('Register interest'));
    (button!.props!.onClick as () => void)();
    render({ ...props, open: false });
    render({ ...props, open: true });
    await flush();
    settle({ recorded: true });
    await flush();
    const reopened = render({ ...props, open: true });
    expect(JSON.stringify(reopened.tree)).not.toContain('Your purchase interest is recorded.');
    const retry = reopened.buttons.find(item => JSON.stringify(item.props?.children).includes('Register interest'));
    expect(retry?.props?.disabled).toBe(false);
  });

  it('closes and clears an A offer when the owner observer changes to B', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    const onOpenChange = vi.fn();
    render({ open: true, onOpenChange, trigger: 'menu' });
    await flush();
    owner.id = 'user-b';
    owner.onChange?.('user-b');
    const view = render({ open: true, onOpenChange, trigger: 'menu' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    expect(billing.recordPurchaseIntent).not.toHaveBeenCalled();
  });

  it('drops an A offer that resolves after the owner observer changes to B', async () => {
    let settle!: (offer: { proMonthlyAiCards: number; displayPriceVnd: null; proDurationDays: number; intentEligibility: 'eligible'; offerVersion: string }) => void;
    billing.getPilotOffer.mockReturnValue(new Promise(resolve => { settle = resolve; }));
    const onOpenChange = vi.fn();
    render({ open: true, onOpenChange, trigger: 'menu' });
    owner.id = 'user-b';
    owner.onChange?.('user-b');
    settle({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    await flush();
    const view = render({ open: true, onOpenChange, trigger: 'menu' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(view.buttons.some(button => JSON.stringify(button.props?.children).includes('Register interest'))).toBe(false);
    expect(billing.recordPurchaseIntent).not.toHaveBeenCalled();
  });

  it('does not submit B intent from an offer loaded for A', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    owner.id = 'user-b';
    const button = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' }).buttons
      .find(item => JSON.stringify(item.props?.children).includes('Register interest'));
    (button!.props!.onClick as () => void)();
    await flush();

    expect(billing.recordPurchaseIntent).not.toHaveBeenCalled();
  });

  it('drops A submit confirmation when the owner observer changes to B', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    let settle!: (value: { recorded: true }) => void;
    billing.recordPurchaseIntent.mockReturnValue(new Promise(resolve => { settle = resolve; }));
    const onOpenChange = vi.fn();
    render({ open: true, onOpenChange, trigger: 'menu' });
    await flush();
    const button = render({ open: true, onOpenChange, trigger: 'menu' }).buttons
      .find(item => JSON.stringify(item.props?.children).includes('Register interest'));
    (button!.props!.onClick as () => void)();
    owner.id = 'user-b';
    owner.onChange?.('user-b');
    settle({ recorded: true });
    await flush();
    const view = render({ open: true, onOpenChange, trigger: 'menu' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(JSON.stringify(view.tree)).not.toContain('Your purchase interest is recorded.');
  });

  it('surfaces a submit error and lets the learner try again', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    billing.recordPurchaseIntent.mockRejectedValue(new Error('write failed'));

    render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    await flush();
    let view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    const registerButton = view.buttons.find(button => JSON.stringify(button.props?.children).includes('Register interest'));

    (registerButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });

    expect(view.alert?.props?.children).toBe("Your request wasn't recorded. Please try again later.");
    const retryButton = view.buttons.find(button => JSON.stringify(button.props?.children).includes('Register interest'));
    expect(retryButton?.props?.disabled).toBe(false);
  });

  it('hides a stale offer when its terms change before registration', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: 85_320, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    billing.recordPurchaseIntent.mockRejectedValue(new ProtectedFunctionError({
      message: 'The Pro offer changed.', kind: 'configuration',
      code: 'failed-precondition', retryable: false, reason: 'offer-changed',
    }));
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const button = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' }).buttons
      .find(item => JSON.stringify(item.props?.children).includes('Register interest'));
    (button!.props!.onClick as () => void)();
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    expect(JSON.stringify(view.alert?.props?.children)).toContain('Plan details changed. Reopen this dialog');
    expect(view.buttons.some(item => JSON.stringify(item.props?.children).includes('Register interest'))).toBe(false);
  });

  it('shows already Pro when the server grants Pro after the offer was fetched', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    billing.recordPurchaseIntent.mockRejectedValue(new ProtectedFunctionError({
      message: 'Pro is already active on your account.', kind: 'permission',
      code: 'failed-precondition', retryable: false, reason: 'already-pro',
    }));
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const button = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' }).buttons
      .find(item => JSON.stringify(item.props?.children).includes('Register interest'));
    (button!.props!.onClick as () => void)();
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    expect(JSON.stringify(view.status?.props?.children)).toContain('Pro is already active');
    expect(view.buttons.some(item => JSON.stringify(item.props?.children).includes('Register interest'))).toBe(false);
    expect(view.alert).toBeUndefined();
  });

  it('hides the stale intent action when the server disables purchase intent after the offer was fetched', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 1_000, displayPriceVnd: null, proDurationDays: 30, intentEligibility: 'eligible', offerVersion });
    billing.recordPurchaseIntent.mockRejectedValue(new ProtectedFunctionError({
      message: 'Purchase registration is temporarily unavailable.', kind: 'configuration',
      code: 'failed-precondition', retryable: false, reason: 'intent-unavailable',
    }));
    render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    await flush();
    const button = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' }).buttons
      .find(item => JSON.stringify(item.props?.children).includes('Register interest'));
    (button!.props!.onClick as () => void)();
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'menu' });
    expect(JSON.stringify(view.alert?.props?.children)).toContain('Registration is temporarily unavailable.');
    expect(view.buttons.some(item => JSON.stringify(item.props?.children).includes('Register interest'))).toBe(false);
  });
});
