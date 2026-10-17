import { describe, expect, it, vi } from 'vitest';
import {
  createCeremonyQueueState,
  dismissQueuedCeremony,
  equipCeremonyFrame,
  orderCeremonyEvents,
  queueCeremonies,
  streakCeremonyRewardLabels,
  type QueuedCeremony,
} from './AppRuntime';
import { i18n } from '@lingui/core';

const ceremony = (
  event: QueuedCeremony['event'],
  ownerId = 'owner-a',
  operationId = 'operation-a',
): QueuedCeremony => ({ ownerId, operationId, event, payload: {}, focusReturnTarget: null });

describe('AppRuntime ceremony behavior', () => {
  it('shows only the verified streak badge reward', () => {
    i18n.load('en', {});
    i18n.activate('en');

    expect(streakCeremonyRewardLabels(i18n._.bind(i18n))).toEqual(['Web Wanderer']);
  });

  it('orders a shared outcome with streak before levelup and dedupes by owner, operation, and event', () => {
    const ordered = orderCeremonyEvents(['levelup', 'streak']);
    expect(ordered).toEqual(['streak', 'levelup']);

    const queued = queueCeremonies(createCeremonyQueueState(), [
      ...ordered.map(event => ceremony(event)),
      ceremony('streak'),
      ceremony('streak', 'owner-b'),
      ceremony('streak', 'owner-a', 'operation-b'),
    ]);

    expect(queued.queue.map(item => [item.ownerId, item.operationId, item.event])).toEqual([
      ['owner-a', 'operation-a', 'streak'],
      ['owner-a', 'operation-a', 'levelup'],
      ['owner-b', 'operation-a', 'streak'],
      ['owner-a', 'operation-b', 'streak'],
    ]);
  });

  it('clears queue and dedupe receipts when the account changes', () => {
    const activeAccount = queueCeremonies(createCeremonyQueueState(), [ceremony('levelup')]);
    const switchedAccount = createCeremonyQueueState();
    const nextAccount = queueCeremonies(switchedAccount, [ceremony('levelup', 'owner-b')]);

    expect(activeAccount.queue).toHaveLength(1);
    expect(switchedAccount.queue).toEqual([]);
    expect(nextAccount.queue).toEqual([ceremony('levelup', 'owner-b')]);
  });

  it('uses the same one-item dismissal for Continue, Close, and Later', () => {
    const state = queueCeremonies(createCeremonyQueueState(), [ceremony('streak'), ceremony('levelup')]);

    const afterContinue = dismissQueuedCeremony(state).state;
    const afterClose = dismissQueuedCeremony(afterContinue).state;
    const afterLater = dismissQueuedCeremony(state).state;

    expect(afterContinue.queue.map(item => item.event)).toEqual(['levelup']);
    expect(afterClose.queue).toEqual([]);
    expect(afterLater.queue.map(item => item.event)).toEqual(['levelup']);
  });

  it('dismisses after a successful equip and leaves the dialog active when equip rejects for retry alert', async () => {
    const dismiss = vi.fn();
    const equip = vi.fn(async () => undefined);

    await equipCeremonyFrame(equip, dismiss);
    expect(equip).toHaveBeenCalledWith('crimson-wing');
    expect(dismiss).toHaveBeenCalledOnce();

    const retryDismiss = vi.fn();
    const failedEquip = vi.fn(async () => { throw new Error('network'); });
    await expect(equipCeremonyFrame(failedEquip, retryDismiss)).rejects.toThrow('network');
    expect(retryDismiss).not.toHaveBeenCalled();
  });
});
