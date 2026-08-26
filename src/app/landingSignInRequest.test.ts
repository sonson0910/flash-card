import { describe, expect, it, vi } from 'vitest';
import { consumeLandingSignInRequest } from './landingSignInRequest';

describe('consumeLandingSignInRequest', () => {
  it('consumes each new token once and acknowledges before awaiting sign-in', async () => {
    const handledRequestRef = { current: 0 };
    const events: string[] = [];
    let releaseSignIn: () => void = () => undefined;
    const signIn = vi.fn(() => new Promise<void>(resolve => {
      releaseSignIn = resolve;
      events.push('signIn');
    }));
    const acknowledge = vi.fn((request: number) => events.push(`ack:${request}`));

    expect(await consumeLandingSignInRequest(null, handledRequestRef, acknowledge, signIn)).toBe(false);
    const first = consumeLandingSignInRequest(1, handledRequestRef, acknowledge, signIn);

    await Promise.resolve();
    expect(events).toEqual(['ack:1', 'signIn']);
    expect(await consumeLandingSignInRequest(1, handledRequestRef, acknowledge, signIn)).toBe(false);

    releaseSignIn();
    expect(await first).toBe(true);
    const second = consumeLandingSignInRequest(2, handledRequestRef, acknowledge, signIn);

    await Promise.resolve();
    expect(events).toEqual(['ack:1', 'signIn', 'ack:2', 'signIn']);
    releaseSignIn();
    expect(await second).toBe(true);
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});
