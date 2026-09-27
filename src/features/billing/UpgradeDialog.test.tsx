import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  effectDeps: [] as (unknown[] | undefined)[],
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
    useEffect: (effect: () => void, deps?: unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.effectDeps[index];
      const changed = !previous || !deps || deps.length !== previous.length
        || deps.some((dep, i) => dep !== previous[i]);
      hooks.effectDeps[index] = deps;
      if (changed) effect();
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

const billing = vi.hoisted(() => ({
  getPilotOffer: vi.fn(),
  recordPurchaseIntent: vi.fn(),
}));

vi.mock('./billingService', () => ({
  getPilotOffer: billing.getPilotOffer,
  recordPurchaseIntent: billing.recordPurchaseIntent,
}));

const analytics = vi.hoisted(() => ({ recordPilotClientEvent: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ recordPilotClientEvent: analytics.recordPilotClientEvent }));

import { UpgradeDialog } from './UpgradeDialog';

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
    hooks.effectDeps = [];
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

  it('renders the offer once the request succeeds', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30 });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    await flush();
    const view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });

    expect(view.status).toBeUndefined();
    const registerButton = view.buttons.find(button => JSON.stringify(button.props?.children).includes('Register interest'));
    expect(registerButton).toBeDefined();
    expect(registerButton?.props?.disabled).toBe(false);
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

  it('records the purchase intent and shows confirmation on submit', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30 });
    billing.recordPurchaseIntent.mockResolvedValue({ recorded: true });

    render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    await flush();
    let view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });
    const registerButton = view.buttons.find(button => JSON.stringify(button.props?.children).includes('Register interest'));

    (registerButton!.props!.onClick as () => void)();
    await flush();
    view = render({ open: true, onOpenChange: vi.fn(), trigger: 'quota' });

    expect(billing.recordPurchaseIntent).toHaveBeenCalledWith('quota');
    expect(JSON.stringify(view.status?.props?.children)).toContain('Your purchase interest is recorded.');
  });

  it('surfaces a submit error and lets the learner try again', async () => {
    billing.getPilotOffer.mockResolvedValue({ proMonthlyAiCards: 60, displayPriceVnd: null, proDurationDays: 30 });
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
});
