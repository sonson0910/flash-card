import { describe, expect, it, vi } from 'vitest';
import { createPilotAnalyticsClient, type PilotClientEvent } from './analytics';

const event: PilotClientEvent = { name: 'paywall_viewed', props: { trigger: 'menu', offerId: 'pro-vn-30d-v1' } };

describe('pilot analytics client', () => {
  it('batches at 20 and never sends an event without an owner', async () => {
    let owner: string | null = null;
    const send = vi.fn(async (_events: PilotClientEvent[]) => undefined);
    let scheduled: (() => void) | undefined;
    const client = createPilotAnalyticsClient({ owner: () => owner, send,
      schedule: callback => { scheduled = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
      clear: () => undefined, onHidden: () => () => undefined });
    client.record(event);
    expect(send).not.toHaveBeenCalled();
    owner = 'owner-a';
    for (let index = 0; index < 20; index++) client.record(event);
    await client.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(20);
    scheduled?.();
    client.dispose();
  });

  it('drops queued events when the signed-in owner changes', async () => {
    let owner = 'owner-a';
    const send = vi.fn(async (_events: PilotClientEvent[]) => undefined);
    const client = createPilotAnalyticsClient({ owner: () => owner, send,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clear: () => undefined, onHidden: () => () => undefined });
    client.record(event);
    owner = 'owner-b';
    await client.flush();
    expect(send).not.toHaveBeenCalled();
    client.record(event);
    await client.flush();
    expect(send).toHaveBeenCalledWith([event]);
    client.dispose();
  });

  it('retries transient transport failure without duplicating an acknowledged batch', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const client = createPilotAnalyticsClient({ owner: () => 'owner-a', send,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clear: () => undefined, onHidden: () => () => undefined });
    client.record(event);
    await client.flush();
    await client.flush();
    await client.flush();
    expect(send).toHaveBeenCalledTimes(2);
    client.dispose();
  });
});
